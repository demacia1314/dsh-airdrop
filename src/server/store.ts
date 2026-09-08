import { createHash, randomBytes } from 'node:crypto'
import { constants, type BigIntStats } from 'node:fs'
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat, writeFile, type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import { isPathInside, splitRelativePath } from './path.js'
import {
  STORAGE_VERSION,
  type AttachmentState,
  type DraftState,
  type EntryState,
  type PendingClaimState,
  type RootState,
} from './types.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const NOFOLLOW = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0

export interface FileIdentity {
  readonly dev: string
  readonly ino: string
}

export interface VerifiedFile {
  readonly handle: FileHandle
  readonly identity: FileIdentity
  readonly size: number
}

function identityOf(info: BigIntStats): FileIdentity {
  return { dev: info.dev.toString(), ino: info.ino.toString() }
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

function assertRegularUniqueFile(info: BigIntStats): void {
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1n) {
    throw new Error('Attachment content is not a unique regular file')
  }
}

function safeFileSize(info: BigIntStats): number {
  if (info.size > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Attachment file is too large')
  return Number(info.size)
}

function expectString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string') throw new Error(`Attachment metadata has an invalid ${key}`)
  return value
}

function expectInteger(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`Attachment metadata has an invalid ${key}`)
  return Number(value)
}

function parseEntry(value: unknown): EntryState {
  if (!isRecord(value)) throw new Error('Attachment metadata has an invalid entry')
  const status = value.status
  if (status !== 'uploading' && status !== 'ready' && status !== 'error') {
    throw new Error('Attachment metadata has an invalid entry status')
  }
  const error = value.error
  if (error !== undefined && typeof error !== 'string') throw new Error('Attachment metadata has an invalid entry error')
  return {
    entryId: expectString(value, 'entryId'),
    relativePath: expectString(value, 'relativePath'),
    safeRelativePath: expectString(value, 'safeRelativePath'),
    name: expectString(value, 'name'),
    size: expectInteger(value, 'size'),
    mime: expectString(value, 'mime'),
    lastModified: expectInteger(value, 'lastModified'),
    received: expectInteger(value, 'received'),
    status,
    relPath: expectString(value, 'relPath'),
    fileDev: expectString(value, 'fileDev'),
    fileIno: expectString(value, 'fileIno'),
    ...(error === undefined ? {} : { error }),
  }
}

function parseRoot(value: unknown): RootState {
  if (!isRecord(value)) throw new Error('Attachment metadata has an invalid root')
  const kind = value.kind
  if (kind !== 'file' && kind !== 'folder') throw new Error('Attachment metadata has an invalid root kind')
  if (!Array.isArray(value.aliases) || !Array.isArray(value.entries)) {
    throw new Error('Attachment metadata has invalid root collections')
  }
  const aliases = value.aliases.map(alias => {
    if (!isRecord(alias)) throw new Error('Attachment metadata has an invalid path alias')
    return { raw: expectString(alias, 'raw'), safe: expectString(alias, 'safe') }
  })
  const error = value.error
  if (error !== undefined && typeof error !== 'string') throw new Error('Attachment metadata has an invalid root error')
  return {
    rootId: expectString(value, 'rootId'),
    clientKey: expectString(value, 'clientKey'),
    name: expectString(value, 'name'),
    kind,
    relPath: expectString(value, 'relPath'),
    fileCount: expectInteger(value, 'fileCount'),
    totalSize: expectInteger(value, 'totalSize'),
    createdAt: expectInteger(value, 'createdAt'),
    aliases,
    entries: value.entries.map(parseEntry),
    ...(error === undefined ? {} : { error }),
  }
}

function parseDraft(value: unknown): DraftState | null {
  if (value === null) return null
  if (!isRecord(value) || !Array.isArray(value.roots)) throw new Error('Attachment metadata has an invalid draft')
  return {
    draftId: expectString(value, 'draftId'),
    createdAt: expectInteger(value, 'createdAt'),
    roots: value.roots.map(parseRoot),
  }
}

function parsePendingClaim(value: unknown): PendingClaimState | null {
  if (value === null) return null
  if (!isRecord(value) || !Array.isArray(value.rootIds) || value.rootIds.some(id => typeof id !== 'string')) {
    throw new Error('Attachment metadata has an invalid pending claim')
  }
  const rpcId = value.rpcId
  if (rpcId !== undefined && typeof rpcId !== 'string') {
    throw new Error('Attachment metadata has an invalid pending claim rpcId')
  }
  return {
    claimId: expectString(value, 'claimId'),
    draftId: expectString(value, 'draftId'),
    rootIds: [...value.rootIds] as string[],
    createdAt: expectInteger(value, 'createdAt'),
    ...(rpcId === undefined ? {} : { rpcId }),
  }
}

function parsePendingClaims(value: unknown): PendingClaimState[] {
  if (!Array.isArray(value)) throw new Error('Attachment metadata has invalid pending claims')
  const claims = value.map(item => {
    const claim = parsePendingClaim(item)
    if (claim === null) throw new Error('Attachment metadata has an invalid pending claim')
    return claim
  })
  const claimIds = new Set<string>()
  const rpcIds = new Set<string>()
  const rootIds = new Set<string>()
  for (const claim of claims) {
    if (claimIds.has(claim.claimId)) throw new Error('Attachment metadata has duplicate pending claim ids')
    claimIds.add(claim.claimId)
    if (claim.rpcId !== undefined) {
      if (rpcIds.has(claim.rpcId)) throw new Error('Attachment metadata has duplicate pending claim rpcIds')
      rpcIds.add(claim.rpcId)
    }
    for (const rootId of claim.rootIds) {
      if (rootIds.has(rootId)) throw new Error('Attachment metadata has a root reserved by multiple claims')
      rootIds.add(rootId)
    }
  }
  return claims
}

function parseState(value: unknown, expectedSessionHash: string): AttachmentState {
  if (
    !isRecord(value)
    || (value.version !== 3 && value.version !== STORAGE_VERSION)
    || !Array.isArray(value.published)
  ) {
    throw new Error('Unsupported or corrupt attachment metadata')
  }
  if (expectString(value, 'sessionHash') !== expectedSessionHash) {
    throw new Error('Attachment metadata belongs to another session')
  }
  const draft = parseDraft(value.draft)
  const pendingClaims = value.version === 3
    ? (() => {
        const legacy = parsePendingClaim(value.pendingClaim)
        return legacy === null ? [] : [legacy]
      })()
    : parsePendingClaims(value.pendingClaims)
  if (pendingClaims.length > 0 && draft === null) {
    throw new Error('Pending attachment claims have no draft')
  }
  const draftRootIds = new Set(draft?.roots.map(root => root.rootId) ?? [])
  for (const claim of pendingClaims) {
    if (draft === null || claim.draftId !== draft.draftId) {
      throw new Error('Pending attachment claim has an invalid draft')
    }
    if (claim.rootIds.some(rootId => !draftRootIds.has(rootId))) {
      throw new Error('Pending attachment claim is incomplete')
    }
  }
  return {
    version: STORAGE_VERSION,
    sessionHash: expectedSessionHash,
    updatedAt: expectInteger(value, 'updatedAt'),
    draft,
    pendingClaims,
    published: value.published.map(parseRoot),
  }
}

export function sessionHash(sessionId: string): string {
  return createHash('sha256').update(sessionId, 'utf8').digest('hex')
}

export interface WorkspaceUsage {
  readonly sessionHashes: ReadonlySet<string>
  readonly roots: bigint
  readonly files: bigint
  readonly bytes: bigint
}

export async function readWorkspaceUsage(metadataDir: string): Promise<WorkspaceUsage> {
  const sessionHashes = new Set<string>()
  let roots = 0n
  let files = 0n
  let bytes = 0n
  for (const entry of await readdir(metadataDir, { withFileTypes: true })) {
    const match = entry.isFile() ? /^([a-f0-9]{64})\.json$/u.exec(entry.name) : null
    const hash = match?.[1]
    if (hash === undefined) continue
    const metadataPath = path.join(metadataDir, entry.name)
    const info = await lstat(metadataPath)
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) {
      throw new Error('Attachment metadata file is unsafe')
    }
    if (info.size > 256 * 1024 * 1024) throw new Error('Attachment metadata file is too large')
    const state = parseState(JSON.parse(await readFile(metadataPath, 'utf8')) as unknown, hash)
    sessionHashes.add(hash)
    const allRoots = [...(state.draft?.roots ?? []), ...state.published]
    roots += BigInt(allRoots.length)
    for (const root of allRoots) {
      files += BigInt(root.fileCount)
      bytes += BigInt(root.totalSize)
    }
  }
  return { sessionHashes, roots, files, bytes }
}

export class SerialKeyedLock {
  private readonly tails = new Map<string, Promise<void>>()

  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve()
    let release: (() => void) | undefined
    const gate = new Promise<void>(resolve => { release = resolve })
    const tail = previous.then(() => gate)
    this.tails.set(key, tail)
    await previous
    try {
      return await task()
    } finally {
      release?.()
      if (this.tails.get(key) === tail) this.tails.delete(key)
    }
  }
}

export class AttachmentStore {
  readonly sessionHash: string
  readonly cwd: string
  readonly uploadRoot: string
  readonly contentRoot: string
  readonly metadataDir: string
  readonly metadataPath: string
  private initialized = false
  private contentInitialized = false

  constructor(cwd: string, sessionId: string) {
    this.cwd = path.resolve(cwd)
    this.sessionHash = sessionHash(sessionId)
    this.uploadRoot = path.join(this.cwd, '.dsh', 'uploads')
    this.contentRoot = path.join(this.uploadRoot, this.sessionHash)
    // On-disk name predates the plugin rename; kept so existing session drafts/claims resolve.
    this.metadataDir = path.join(this.uploadRoot, '.universal-attachments')
    this.metadataPath = path.join(this.metadataDir, `${this.sessionHash}.json`)
  }

  async initialize(): Promise<void> {
    if (this.initialized) return
    const cwdStat = await stat(this.cwd)
    if (!cwdStat.isDirectory()) throw new Error('The session cwd is not a directory')
    const realCwd = await realpath(this.cwd)
    await this.ensureDirectory(path.join(this.cwd, '.dsh'))
    await this.ensureDirectory(this.uploadRoot)
    await this.ensureDirectory(this.metadataDir)
    const [realUploadRoot, realMetadataDir] = await Promise.all([
      realpath(this.uploadRoot),
      realpath(this.metadataDir),
    ])
    if (
      !isPathInside(realCwd, realUploadRoot)
      || !isPathInside(realUploadRoot, realMetadataDir)
    ) {
      throw new Error('Attachment storage resolves outside the session cwd')
    }
    this.initialized = true
  }

  async ensureContentRoot(): Promise<void> {
    await this.initialize()
    if (this.contentInitialized) return
    await this.ensureDirectory(this.contentRoot)
    const [realUploadRoot, realContentRoot] = await Promise.all([
      realpath(this.uploadRoot),
      realpath(this.contentRoot),
    ])
    if (!isPathInside(realUploadRoot, realContentRoot)) {
      throw new Error('Attachment session storage resolves outside the upload root')
    }
    this.contentInitialized = true
  }

  private async ensureDirectory(target: string): Promise<void> {
    try {
      await mkdir(target, { mode: 0o700 })
    } catch (error: unknown) {
      if (!isRecord(error) || error.code !== 'EEXIST') throw error
    }
    const info = await lstat(target)
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error('Attachment storage contains an unsafe path component')
    }
  }

  emptyState(now = Date.now()): AttachmentState {
    return {
      version: STORAGE_VERSION,
      sessionHash: this.sessionHash,
      updatedAt: now,
      draft: null,
      pendingClaims: [],
      published: [],
    }
  }

  async load(): Promise<AttachmentState> {
    await this.initialize()
    let raw: string
    try {
      const info = await lstat(this.metadataPath)
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) {
        throw new Error('Attachment metadata file is unsafe')
      }
      if (info.size > 256 * 1024 * 1024) throw new Error('Attachment metadata file is too large')
      raw = await readFile(this.metadataPath, 'utf8')
    } catch (error: unknown) {
      if (isRecord(error) && error.code === 'ENOENT') return this.emptyState()
      throw error
    }
    const state = parseState(JSON.parse(raw) as unknown, this.sessionHash)
    if (state.draft !== null || state.pendingClaims.length > 0 || state.published.length > 0) {
      await this.ensureContentRoot()
    }
    for (const root of [...(state.draft?.roots ?? []), ...state.published]) {
      this.absolute(root.relPath)
      for (const entry of root.entries) {
        this.absolute(entry.relPath)
      }
    }
    return state
  }

  async save(state: AttachmentState): Promise<void> {
    await this.initialize()
    state.updatedAt = Date.now()
    if (state.draft === null && state.pendingClaims.length === 0 && state.published.length === 0) {
      await rm(this.metadataPath, { force: true })
      try {
        const info = await lstat(this.contentRoot)
        if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Attachment session root is unsafe')
        await rm(this.contentRoot, { recursive: true, force: true })
      } catch (error: unknown) {
        if (!isRecord(error) || error.code !== 'ENOENT') throw error
      }
      this.contentInitialized = false
      return
    }
    const temp = `${this.metadataPath}.${randomBytes(8).toString('hex')}.tmp`
    try {
      await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
      await rename(temp, this.metadataPath)
    } catch (error: unknown) {
      await rm(temp, { force: true }).catch(() => undefined)
      throw error
    }
  }

  absolute(workspaceRelativePath: string): string {
    const segments = splitRelativePath(workspaceRelativePath)
    if (
      segments[0] !== '.dsh'
      || segments[1] !== 'uploads'
      || segments[2] !== this.sessionHash
      || segments.length < 4
    ) {
      throw new Error('Attachment path is outside the session upload area')
    }
    const candidate = path.resolve(this.cwd, ...segments)
    if (!isPathInside(this.contentRoot, candidate)) throw new Error('Attachment path escapes the session upload area')
    return candidate
  }

  async assertSafeParent(target: string): Promise<void> {
    const parent = path.dirname(target)
    if (!isPathInside(this.contentRoot, parent) && path.resolve(parent) !== path.resolve(this.contentRoot)) {
      throw new Error('Attachment parent escapes the session upload area')
    }
    for (const anchor of [path.join(this.cwd, '.dsh'), this.uploadRoot, this.contentRoot]) {
      const info = await lstat(anchor)
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Attachment storage has an unsafe ancestor')
    }
    const relative = path.relative(this.contentRoot, parent)
    let cursor = this.contentRoot
    for (const segment of relative.split(path.sep).filter(Boolean)) {
      cursor = path.join(cursor, segment)
      const info = await lstat(cursor)
      if (info.isSymbolicLink() || !info.isDirectory()) {
        throw new Error('Attachment storage contains an unsafe path component')
      }
    }
    const [realContentRoot, realParent] = await Promise.all([
      realpath(this.contentRoot),
      realpath(parent),
    ])
    if (realParent !== realContentRoot && !isPathInside(realContentRoot, realParent)) {
      throw new Error('Attachment parent resolves outside its session storage')
    }
  }

  async createExclusiveFile(target: string): Promise<FileIdentity> {
    await this.assertSafeParent(target)
    const handle = await open(target, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | NOFOLLOW, 0o600)
    try {
      const opened = await handle.stat({ bigint: true })
      assertRegularUniqueFile(opened)
      await this.assertSafeParent(target)
      const after = await lstat(target, { bigint: true })
      assertRegularUniqueFile(after)
      const identity = identityOf(opened)
      if (!sameIdentity(identity, identityOf(after))) throw new Error('Attachment file changed during creation')
      return identity
    } finally {
      await handle.close()
    }
  }

  async openVerifiedFile(target: string, expected: FileIdentity, writable: boolean): Promise<VerifiedFile> {
    await this.assertSafeParent(target)
    const before = await lstat(target, { bigint: true })
    assertRegularUniqueFile(before)
    if (!sameIdentity(identityOf(before), expected)) throw new Error('Attachment file identity does not match metadata')
    const flags = (writable ? constants.O_RDWR : constants.O_RDONLY) | NOFOLLOW
    const handle = await open(target, flags)
    try {
      const opened = await handle.stat({ bigint: true })
      assertRegularUniqueFile(opened)
      const openedIdentity = identityOf(opened)
      if (!sameIdentity(openedIdentity, expected)) throw new Error('Attachment file changed while opening')
      await this.assertSafeParent(target)
      const after = await lstat(target, { bigint: true })
      assertRegularUniqueFile(after)
      if (!sameIdentity(identityOf(after), openedIdentity)) throw new Error('Attachment path changed while opening')
      return { handle, identity: openedIdentity, size: safeFileSize(opened) }
    } catch (error: unknown) {
      await handle.close().catch(() => undefined)
      throw error
    }
  }

}
