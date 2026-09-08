import { randomBytes, timingSafeEqual } from 'node:crypto'
import {
  lstat,
  mkdir,
  readdir,
  rm,
  statfs,
  type FileHandle,
} from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import {
  allocateSafeRelativePath,
  allocateStoredBasename,
  caseFold,
  normalizeEntryRelativePath,
  toWorkspaceRelative,
} from './path.js'
import { planContentResponse } from './range.js'
import { AttachmentStore, readWorkspaceUsage, SerialKeyedLock, sessionHash } from './store.js'
import {
  UPLOAD_CHUNK_SIZE,
  entrySummary,
  rootSummary,
  type AttachmentState,
  type BatchRootInput,
  type BeginFileResult,
  type DraftSummary,
  type EntryState,
  type PendingClaimState,
  type PrepareBatchResult,
  type RootState,
} from './types.js'

const MAX_ROOTS_PER_BATCH = 256
const MAX_ROOTS_PER_DRAFT = 512
const MAX_FILES_PER_ROOT = 100_000
const MAX_FILES_PER_DRAFT = 200_000
const MAX_FILE_BYTES = 20 * 1024 * 1024 * 1024
const MAX_ROOT_BYTES = 50 * 1024 * 1024 * 1024
const MAX_DRAFT_BYTES = 100 * 1024 * 1024 * 1024
const MAX_WORKSPACE_SESSIONS = 1_024
const MAX_WORKSPACE_ROOTS = 4_096n
const MAX_WORKSPACE_FILES = 500_000n
const MAX_WORKSPACE_BYTES = 200n * 1024n * 1024n * 1024n
const MAX_CLIENT_KEY_LENGTH = 512
const MAX_NAME_LENGTH = 512
const MAX_MIME_LENGTH = 255
const UPLOAD_GRANT_MS = 2 * 60 * 60 * 1000
const PREVIEW_GRANT_MS = 10 * 60 * 1000
const MAX_UPLOAD_GRANTS = 4_096
const MAX_PREVIEW_GRANTS = 4_096
const MIN_FREE_STORAGE_RESERVE = 64n * 1024n * 1024n

interface UploadGrant {
  readonly token: string
  readonly ticket: string
  readonly sessionId: string
  readonly cwd: string
  readonly draftId: string
  readonly rootId: string
  readonly entryId: string
  expiresAt: number
}

interface PreviewGrant {
  readonly ticket: string
  readonly cwd: string
  readonly sessionId: string
  readonly relPath: string
  readonly name: string
  readonly mime: string
  readonly fileDev: string
  readonly fileIno: string
  expiresAt: number
}

export interface ReadyRootClaim {
  readonly claimId: string
  readonly draftId: string
  readonly roots: readonly RootState[]
  readonly rpcId?: string
}

export interface ReadyRootReservation {
  readonly createdBefore: number
  snapshot?: {
    readonly draftId: string
    readonly rootIds: readonly string[]
  } | null
}

export interface PendingClaimSnapshot {
  readonly sessionId: string
  readonly claimId: string
  readonly draftId: string
  readonly rootIds: readonly string[]
  readonly createdAt: number
  readonly rpcId?: string
}

export interface ReadyClaimFile {
  readonly entryId: string
  readonly name: string
  readonly size: number
  readonly mime: string
  readonly data: Uint8Array
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly headers: Readonly<Record<string, string>> = {},
  ) {
    super(message)
  }
}

async function writeAll(handle: FileHandle, chunk: Buffer, position: number): Promise<number> {
  let offset = 0
  while (offset < chunk.length) {
    const result = await handle.write(chunk, offset, chunk.length - offset, position + offset)
    if (result.bytesWritten <= 0) throw new Error('Attachment upload write made no progress')
    offset += result.bytesWritten
  }
  return position + offset
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url')
}

function parseNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${label} must be a non-negative safe integer`)
  return Number(value)
}

export function parseBatchRoots(rootsJson: string): readonly BatchRootInput[] {
  if (rootsJson.length > 2 * 1024 * 1024) throw new Error('rootsJson is too large')
  const value = JSON.parse(rootsJson) as unknown
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ROOTS_PER_BATCH) {
    throw new Error(`rootsJson must contain 1-${MAX_ROOTS_PER_BATCH} roots`)
  }
  const clientKeys = new Set<string>()
  return value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`Root ${index + 1} is invalid`)
    const allowed = new Set(['clientKey', 'name', 'kind', 'fileCount', 'totalSize'])
    if (Object.keys(item).some(key => !allowed.has(key))) throw new Error(`Root ${index + 1} has unknown fields`)
    if (typeof item.clientKey !== 'string' || item.clientKey.length === 0 || item.clientKey.length > MAX_CLIENT_KEY_LENGTH) {
      throw new Error(`Root ${index + 1} has an invalid clientKey`)
    }
    if (clientKeys.has(item.clientKey)) throw new Error(`Duplicate clientKey ${item.clientKey}`)
    clientKeys.add(item.clientKey)
    if (
      typeof item.name !== 'string'
      || item.name.length === 0
      || item.name.length > MAX_NAME_LENGTH
      || item.name.includes('\0')
      || item.name.includes('/')
      || item.name.includes('\\')
    ) {
      throw new Error(`Root ${index + 1} has an invalid name`)
    }
    if (item.kind !== 'file' && item.kind !== 'folder') throw new Error(`Root ${index + 1} has an invalid kind`)
    const fileCount = parseNonNegativeInteger(item.fileCount, `Root ${index + 1} fileCount`)
    const totalSize = parseNonNegativeInteger(item.totalSize, `Root ${index + 1} totalSize`)
    if (fileCount > MAX_FILES_PER_ROOT) throw new Error(`Root ${index + 1} has too many files`)
    if (totalSize > MAX_ROOT_BYTES) throw new Error(`Root ${index + 1} exceeds the ${MAX_ROOT_BYTES}-byte limit`)
    if (item.kind === 'file' && fileCount !== 1) throw new Error('A file root must contain exactly one file')
    if (fileCount === 0 && totalSize !== 0) throw new Error('An empty folder cannot declare a non-zero size')
    return { clientKey: item.clientKey, name: item.name, kind: item.kind, fileCount, totalSize }
  })
}

function normalizeMime(mime: string): string {
  const value = mime.trim().toLowerCase()
  if (value.length === 0) return 'application/octet-stream'
  if (value.length > MAX_MIME_LENGTH || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(value)) {
    return 'application/octet-stream'
  }
  return value
}

function safeHeaderMime(mime: string): string {
  if (mime === 'image/svg+xml' || mime === 'text/html' || mime === 'application/xhtml+xml') {
    return 'application/octet-stream'
  }
  return normalizeMime(mime)
}

function shouldInline(mime: string): boolean {
  return (mime.startsWith('image/') && mime !== 'image/svg+xml')
    || mime.startsWith('video/')
    || mime.startsWith('audio/')
    || mime === 'application/pdf'
    || mime === 'text/plain'
}

function quotedFilename(name: string): string {
  return `UTF-8''${encodeURIComponent(name.replace(/[\r\n]/gu, ' '))}`
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function requestAuthority(value: string, isOrigin: boolean): string | undefined {
  try {
    return new URL(isOrigin ? value : `http://${value}`).host.toLowerCase()
  } catch {
    return undefined
  }
}

function assertTrustedBrowserRequest(req: IncomingMessage): void {
  const fetchSite = headerValue(req.headers['sec-fetch-site'])?.toLowerCase()
  if (fetchSite !== undefined && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    throw new HttpError(403, 'Cross-site requests are not allowed')
  }
  const origin = headerValue(req.headers.origin)
  if (origin === undefined) return
  const host = headerValue(req.headers.host)
  const originAuthority = requestAuthority(origin, true)
  const hostAuthority = host === undefined ? undefined : requestAuthority(host, false)
  if (originAuthority === undefined || hostAuthority === undefined || originAuthority !== hostAuthority) {
    throw new HttpError(403, 'Request origin is not trusted')
  }
}

function parseOffset(value: string | undefined): number {
  if (value === undefined || !/^\d+$/u.test(value)) throw new HttpError(400, 'Upload-Offset must be a decimal integer')
  const offset = Number(value)
  if (!Number.isSafeInteger(offset)) throw new HttpError(400, 'Upload-Offset is too large')
  return offset
}

function findRoot(state: AttachmentState, draftId: string, rootId: string): RootState {
  if (state.draft?.draftId !== draftId) throw new Error('Attachment draft not found')
  const root = state.draft.roots.find(candidate => candidate.rootId === rootId)
  if (root === undefined) throw new Error('Attachment root not found')
  return root
}

function findEntryAnywhere(state: AttachmentState, rootId: string, entryId: string): EntryState | undefined {
  const roots = [...(state.draft?.roots ?? []), ...state.published]
  return roots.find(root => root.rootId === rootId)?.entries.find(entry => entry.entryId === entryId)
}

function pendingClaimSnapshot(
  sessionId: string,
  pending: PendingClaimState,
): PendingClaimSnapshot {
  return {
    sessionId,
    claimId: pending.claimId,
    draftId: pending.draftId,
    rootIds: [...pending.rootIds],
    createdAt: pending.createdAt,
    ...(pending.rpcId === undefined ? {} : { rpcId: pending.rpcId }),
  }
}

function claimedRootIds(state: AttachmentState): Set<string> {
  return new Set(state.pendingClaims.flatMap(claim => claim.rootIds))
}

function pendingClaimRoots(state: AttachmentState, pending: PendingClaimState): RootState[] {
  const draft = state.draft
  if (draft === null || draft.draftId !== pending.draftId) throw new Error('Pending attachment claim has no draft')
  const claimedIds = new Set(pending.rootIds)
  const roots = draft.roots.filter(root => claimedIds.has(root.rootId))
  if (roots.length !== pending.rootIds.length) throw new Error('Pending attachment claim is incomplete')
  return roots
}

function acknowledgePendingClaim(state: AttachmentState, pending: PendingClaimState): void {
  const index = state.pendingClaims.findIndex(candidate => candidate.claimId === pending.claimId)
  if (index < 0) throw new Error('Attachment claim is no longer pending')
  const draft = state.draft
  const roots = pendingClaimRoots(state, pending)
  if (draft === null) throw new Error('Pending attachment claim has no draft')
  const claimedIds = new Set(pending.rootIds)
  draft.roots.splice(0, draft.roots.length, ...draft.roots.filter(root => !claimedIds.has(root.rootId)))
  for (const root of roots) {
    if (!state.published.some(candidate => candidate.rootId === root.rootId)) state.published.push(root)
  }
  state.pendingClaims.splice(index, 1)
  if (draft.roots.length === 0) state.draft = null
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await lstat(target)
    return true
  } catch (error: unknown) {
    if (isRecord(error) && error.code === 'ENOENT') return false
    throw error
  }
}

async function ensureSafeDirectories(store: AttachmentStore, targetDirectory: string): Promise<void> {
  const relative = path.relative(store.contentRoot, targetDirectory)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Attachment directory escapes storage')
  let cursor = store.contentRoot
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment)
    await mkdir(cursor).catch((error: unknown) => {
      if (!isRecord(error) || error.code !== 'EEXIST') throw error
    })
    const info = await lstat(cursor)
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Attachment path contains an unsafe component')
  }
}

function json(res: ServerResponse, status: number, payload: unknown, headers: Readonly<Record<string, string>> = {}): void {
  const body = Buffer.from(JSON.stringify(payload))
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(body.length),
    ...headers,
  })
  res.end(body)
}

export class AirdropBackend {
  private readonly locks = new SerialKeyedLock()
  private readonly workspaceLocks = new SerialKeyedLock()
  private readonly uploads = new Map<string, UploadGrant>()
  private readonly previews = new Map<string, PreviewGrant>()
  private attachmentClock = 0

  constructor(readonly prefix = '/_dsh/airdrop/v1') {}

  private nextAttachmentTimestamp(): number {
    this.attachmentClock = Math.max(Date.now(), this.attachmentClock + 1)
    return this.attachmentClock
  }

  createReadyRootReservation(): ReadyRootReservation {
    return { createdBefore: this.nextAttachmentTimestamp() }
  }

  recoverReadyRootReservation(draftId: string, rootIds: readonly string[]): ReadyRootReservation {
    return {
      createdBefore: this.nextAttachmentTimestamp(),
      snapshot: { draftId, rootIds: [...rootIds] },
    }
  }

  private store(cwd: string, sessionId: string): AttachmentStore {
    return new AttachmentStore(cwd, sessionId)
  }

  private async locked<T>(cwd: string, sessionId: string, task: (store: AttachmentStore) => Promise<T>): Promise<T> {
    const store = this.store(cwd, sessionId)
    return this.locks.run(`${path.resolve(cwd)}:${sessionHash(sessionId)}`, async () => {
      await store.initialize()
      return task(store)
    })
  }

  async prepareBatch(cwd: string, sessionId: string, rootsJson: string): Promise<PrepareBatchResult> {
    const inputs = parseBatchRoots(rootsJson)
    const timestampedInputs = inputs.map(input => ({ input, createdAt: this.nextAttachmentTimestamp() }))
    return this.locked(cwd, sessionId, store => this.workspaceLocks.run(path.resolve(cwd), async () => {
      const state = await store.load()
      const usage = await readWorkspaceUsage(store.metadataDir)
      const workspaceIncomingRoots = BigInt(inputs.length)
      const workspaceIncomingFiles = BigInt(inputs.reduce((sum, root) => sum + root.fileCount, 0))
      const workspaceIncomingBytes = inputs.reduce((sum, root) => sum + BigInt(root.totalSize), 0n)
      const incomingSession = usage.sessionHashes.has(store.sessionHash) ? 0 : 1
      if (usage.sessionHashes.size + incomingSession > MAX_WORKSPACE_SESSIONS) {
        throw new Error(`Attachment workspace cannot exceed ${MAX_WORKSPACE_SESSIONS} sessions`)
      }
      if (usage.roots + workspaceIncomingRoots > MAX_WORKSPACE_ROOTS) {
        throw new Error(`Attachment workspace cannot exceed ${MAX_WORKSPACE_ROOTS} retained roots`)
      }
      if (usage.files + workspaceIncomingFiles > MAX_WORKSPACE_FILES) {
        throw new Error(`Attachment workspace cannot exceed ${MAX_WORKSPACE_FILES} retained files`)
      }
      if (usage.bytes + workspaceIncomingBytes > MAX_WORKSPACE_BYTES) {
        throw new Error(`Attachment workspace cannot exceed ${MAX_WORKSPACE_BYTES} retained bytes`)
      }
      await store.ensureContentRoot()
      const draft = state.draft ?? { draftId: randomToken(18), createdAt: Date.now(), roots: [] }
      if (draft.roots.length + inputs.length > MAX_ROOTS_PER_DRAFT) {
        throw new Error(`Attachment draft cannot exceed ${MAX_ROOTS_PER_DRAFT} roots`)
      }
      const existingFiles = draft.roots.reduce((sum, root) => sum + root.fileCount, 0)
      const incomingFiles = inputs.reduce((sum, root) => sum + root.fileCount, 0)
      if (existingFiles + incomingFiles > MAX_FILES_PER_DRAFT) {
        throw new Error(`Attachment draft cannot exceed ${MAX_FILES_PER_DRAFT} files`)
      }
      const existingDraftSize = draft.roots.reduce((sum, root) => sum + root.totalSize, 0)
      const incomingSize = inputs.reduce((sum, root) => sum + root.totalSize, 0)
      if (existingDraftSize + incomingSize > MAX_DRAFT_BYTES) {
        throw new Error(`Attachment draft exceeds the ${MAX_DRAFT_BYTES}-byte limit`)
      }
      const directoryNames = await readdir(store.contentRoot)
      const usedBasenames = [
        ...directoryNames,
        ...draft.roots.map(root => path.posix.basename(root.relPath)),
        ...state.published.map(root => path.posix.basename(root.relPath)),
      ]
      const prepared: { clientKey: string; rootId: string; relPath: string }[] = []
      const createdDirectories: string[] = []
      try {
        for (const [index, { input, createdAt }] of timestampedInputs.entries()) {
          const rootId = randomToken(18)
          const basename = allocateStoredBasename(Date.now() + index, `${rootId}-${input.name}`, usedBasenames)
          usedBasenames.push(basename)
          const relPath = toWorkspaceRelative(store.sessionHash, basename)
          const root: RootState = {
            rootId,
            clientKey: input.clientKey,
            name: input.name,
            kind: input.kind,
            relPath,
            fileCount: input.fileCount,
            totalSize: input.totalSize,
            createdAt,
            aliases: [],
            entries: [],
          }
          if (input.kind === 'folder') {
            const absolute = store.absolute(relPath)
            await ensureSafeDirectories(store, absolute)
            createdDirectories.push(absolute)
          }
          draft.roots.push(root)
          prepared.push({ clientKey: input.clientKey, rootId: root.rootId, relPath })
        }
        state.draft = draft
        await store.save(state)
      } catch (error: unknown) {
        for (const directory of createdDirectories.reverse()) await rm(directory, { recursive: true, force: true }).catch(() => undefined)
        throw error
      }
      return { draftId: draft.draftId, chunkSize: UPLOAD_CHUNK_SIZE, roots: prepared }
    }))
  }

  async beginFile(
    cwd: string,
    sessionId: string,
    draftId: string,
    rootId: string,
    relativePath: string,
    name: string,
    size: number,
    mime: string,
    lastModified: number,
  ): Promise<BeginFileResult> {
    const validSize = parseNonNegativeInteger(size, 'size')
    if (validSize > MAX_FILE_BYTES) throw new Error(`File exceeds the ${MAX_FILE_BYTES}-byte limit`)
    const validModified = parseNonNegativeInteger(lastModified, 'lastModified')
    const validMime = normalizeMime(mime)
    return this.locked(cwd, sessionId, async store => {
      const state = await store.load()
      const root = findRoot(state, draftId, rootId)
      if (root.error !== undefined) throw new Error(root.error)
      const normalizedRelative = normalizeEntryRelativePath(root.kind, relativePath, name)
      if (root.kind === 'file' && name.normalize('NFC') !== root.name.normalize('NFC')) {
        throw new Error('The top-level file name must match its prepared root')
      }
      let entry = root.entries.find(candidate => candidate.relativePath === normalizedRelative)
      if (entry !== undefined) {
        if (entry.name !== name || entry.size !== validSize || entry.mime !== validMime || entry.lastModified !== validModified) {
          throw new Error('A file already exists at this relativePath with different metadata')
        }
        await this.refreshEntry(store, entry)
      } else {
        if (root.entries.length >= root.fileCount) throw new Error('This root already contains its declared number of files')
        const declaredAfter = root.entries.reduce((sum, candidate) => sum + candidate.size, 0) + validSize
        if (declaredAfter > root.totalSize) throw new Error('File sizes exceed the root totalSize')
        const allocation = root.kind === 'folder'
          ? allocateSafeRelativePath(normalizedRelative, root.aliases)
          : { safeRelativePath: '', aliases: root.aliases }
        root.aliases.splice(0, root.aliases.length, ...allocation.aliases)
        const relPath = root.kind === 'folder'
          ? path.posix.join(root.relPath, allocation.safeRelativePath)
          : root.relPath
        const occupiedPaths = root.entries.map(candidate => candidate.relPath)
        if (occupiedPaths.some(candidate => caseFold(candidate) === caseFold(relPath))) {
          throw new Error('The sanitized file path collides with another entry')
        }
        const entryId = randomToken(18)
        const finalPath = store.absolute(relPath)
        await ensureSafeDirectories(store, path.dirname(finalPath))
        const identity = await store.createExclusiveFile(finalPath)
        entry = {
          entryId,
          relativePath: normalizedRelative,
          safeRelativePath: allocation.safeRelativePath,
          name,
          size: validSize,
          mime: validMime,
          lastModified: validModified,
          received: 0,
          status: validSize === 0 ? 'ready' : 'uploading',
          relPath,
          fileDev: identity.dev,
          fileIno: identity.ino,
        }
        root.entries.push(entry)
        if (root.entries.length === root.fileCount && declaredAfter !== root.totalSize) {
          root.error = 'Uploaded file sizes do not match the declared root totalSize'
          await store.save(state)
          throw new Error(root.error)
        }
      }
      await store.save(state)
      const grant = this.createUploadGrant(cwd, sessionId, draftId, rootId, entry.entryId)
      return {
        uploadId: grant.token,
        uploadUrl: `${this.prefix}/upload/${grant.token}`,
        ticket: grant.ticket,
        offset: entry.received,
        chunkSize: UPLOAD_CHUNK_SIZE,
      }
    })
  }

  private async refreshEntry(store: AttachmentStore, entry: EntryState): Promise<void> {
    if (entry.status === 'ready') {
      entry.received = entry.size
      return
    }
    const target = store.absolute(entry.relPath)
    const opened = await store.openVerifiedFile(target, { dev: entry.fileDev, ino: entry.fileIno }, false)
    try {
      if (opened.size > entry.size) throw new Error('Partial upload file is larger than declared')
      entry.received = opened.size
      if (entry.received === entry.size) entry.status = 'ready'
    } finally {
      await opened.handle.close()
    }
  }

  private createUploadGrant(cwd: string, sessionId: string, draftId: string, rootId: string, entryId: string): UploadGrant {
    this.pruneExpiredGrants()
    const existing = [...this.uploads.values()].find(grant => (
      grant.cwd === cwd
      && grant.sessionId === sessionId
      && grant.draftId === draftId
      && grant.rootId === rootId
      && grant.entryId === entryId
    ))
    if (existing !== undefined) {
      existing.expiresAt = Date.now() + UPLOAD_GRANT_MS
      return existing
    }
    if (this.uploads.size >= MAX_UPLOAD_GRANTS) throw new Error('Too many active attachment upload grants')
    const grant: UploadGrant = {
      token: randomToken(),
      ticket: randomToken(),
      cwd,
      sessionId,
      draftId,
      rootId,
      entryId,
      expiresAt: Date.now() + UPLOAD_GRANT_MS,
    }
    this.uploads.set(grant.token, grant)
    return grant
  }

  private pruneExpiredGrants(now = Date.now()): void {
    for (const [token, grant] of this.uploads) if (grant.expiresAt < now) this.uploads.delete(token)
    for (const [ticket, grant] of this.previews) if (grant.expiresAt < now) this.previews.delete(ticket)
  }

  async listDraft(cwd: string, sessionId: string): Promise<{ readonly draft: DraftSummary | null }> {
    return this.locked(cwd, sessionId, async store => {
      const state = await store.load()
      const draft = state.draft
      const claimed = claimedRootIds(state)
      const visibleRoots = draft?.roots.filter(root => !claimed.has(root.rootId)) ?? []
      return {
        draft: draft === null || visibleRoots.length === 0 ? null : {
          draftId: draft.draftId,
          roots: visibleRoots.map(rootSummary),
        },
      }
    })
  }

  async listRoot(cwd: string, sessionId: string, draftId: string, rootId: string): Promise<{
    readonly root: ReturnType<typeof rootSummary> & { readonly entries: ReturnType<typeof entrySummary>[] }
  }> {
    return this.locked(cwd, sessionId, async store => {
      const root = findRoot(await store.load(), draftId, rootId)
      return { root: { ...rootSummary(root), entries: root.entries.map(entrySummary) } }
    })
  }

  async listStoredRoot(cwd: string, sessionId: string, rootId: string): Promise<{
    readonly root: ReturnType<typeof rootSummary> & { readonly entries: ReturnType<typeof entrySummary>[] }
  }> {
    return this.locked(cwd, sessionId, async store => {
      const state = await store.load()
      const root = [...(state.draft?.roots ?? []), ...state.published]
        .find(candidate => candidate.rootId === rootId)
      if (root === undefined) throw new Error('Attachment root not found')
      return { root: { ...rootSummary(root), entries: root.entries.map(entrySummary) } }
    })
  }

  async removeRoot(cwd: string, sessionId: string, draftId: string, rootId: string): Promise<{ readonly removed: boolean }> {
    return this.locked(cwd, sessionId, async store => {
      const state = await store.load()
      if (state.draft?.draftId !== draftId) return { removed: false }
      if (claimedRootIds(state).has(rootId)) return { removed: false }
      const index = state.draft.roots.findIndex(root => root.rootId === rootId)
      if (index < 0) return { removed: false }
      const root = state.draft.roots[index]
      if (root === undefined) return { removed: false }
      await this.deleteRootFiles(store, root)
      state.draft.roots.splice(index, 1)
      if (state.draft.roots.length === 0) state.draft = null
      await store.save(state)
      return { removed: true }
    })
  }

  async clearDraft(cwd: string, sessionId: string, draftId: string): Promise<{ readonly removed: boolean }> {
    return this.locked(cwd, sessionId, async store => {
      const state = await store.load()
      if (state.draft?.draftId !== draftId) return { removed: false }
      const claimed = claimedRootIds(state)
      const removable = state.draft.roots.filter(root => !claimed.has(root.rootId))
      if (removable.length === 0) return { removed: false }
      for (const root of removable) await this.deleteRootFiles(store, root)
      state.draft.roots.splice(0, state.draft.roots.length, ...state.draft.roots.filter(root => claimed.has(root.rootId)))
      if (state.draft.roots.length === 0) state.draft = null
      await store.save(state)
      return { removed: true }
    })
  }

  private async deleteRootFiles(store: AttachmentStore, root: RootState): Promise<void> {
    const target = store.absolute(root.relPath)
    await store.assertSafeParent(target)
    if (await pathExists(target)) {
      const info = await lstat(target)
      if (info.isSymbolicLink()) throw new Error('Refusing to remove a symbolic-link attachment root')
      await rm(target, { recursive: info.isDirectory(), force: true })
    }
  }

  private async verifyReadyRoots(store: AttachmentStore, roots: readonly RootState[]): Promise<void> {
    for (const root of roots) {
      if (rootSummary(root).status !== 'ready') throw new Error('Attachment claim contains a non-ready root')
      if (root.kind === 'folder') {
        const rootPath = store.absolute(root.relPath)
        await store.assertSafeParent(rootPath)
        const info = await lstat(rootPath)
        if (info.isSymbolicLink() || !info.isDirectory()) {
          throw new Error('Attachment folder is unavailable or unsafe')
        }
      }
      for (const entry of root.entries) {
        if (entry.status !== 'ready') throw new Error('Attachment claim contains a non-ready file')
        const target = store.absolute(entry.relPath)
        const opened = await store.openVerifiedFile(target, { dev: entry.fileDev, ino: entry.fileIno }, false)
        try {
          if (opened.size !== entry.size) throw new Error('Ready attachment size does not match metadata')
        } finally {
          await opened.handle.close()
        }
      }
    }
  }

  private async materializeClaim(
    store: AttachmentStore,
    state: AttachmentState,
    pending: PendingClaimState,
  ): Promise<ReadyRootClaim> {
    const roots = pendingClaimRoots(state, pending)
    await this.verifyReadyRoots(store, roots)
    return {
      claimId: pending.claimId,
      draftId: pending.draftId,
      roots,
      ...(pending.rpcId === undefined ? {} : { rpcId: pending.rpcId }),
    }
  }

  async reserveReadyDraft(
    cwd: string,
    sessionId: string,
    draftId: string,
    rpcId: string,
  ): Promise<ReadyRootClaim> {
    return this.locked(cwd, sessionId, async store => {
      const state = await store.load()
      const draft = state.draft
      if (draft === null || draft.draftId !== draftId) throw new Error('Attachment draft not found')
      const claimed = claimedRootIds(state)
      const roots = draft.roots.filter(root => !claimed.has(root.rootId))
      if (roots.length === 0) throw new Error('Attachment draft is empty')
      if (roots.some(root => rootSummary(root).status !== 'ready')) {
        throw new Error('Attachments are still uploading')
      }
      await this.verifyReadyRoots(store, roots)
      const claimId = randomToken(18)
      state.pendingClaims.push({
        claimId,
        draftId: draft.draftId,
        rootIds: roots.map(root => root.rootId),
        createdAt: Date.now(),
        rpcId,
      })
      await store.save(state)
      return { claimId, draftId: draft.draftId, roots, rpcId }
    })
  }

  async reserveReadyRootsForRpcId(
    cwd: string,
    sessionId: string,
    rpcId: string,
    reservation: ReadyRootReservation = this.createReadyRootReservation(),
  ): Promise<ReadyRootClaim | null> {
    return this.locked(cwd, sessionId, store => this.workspaceLocks.run(path.resolve(cwd), async () => {
      const state = await store.load()
      const existing = state.pendingClaims.find(pending => pending.rpcId === rpcId)
      if (existing !== undefined) {
        const snapshot = reservation.snapshot
        if (snapshot === null || (snapshot !== undefined && (
          snapshot.draftId !== existing.draftId
          || snapshot.rootIds.length !== existing.rootIds.length
          || snapshot.rootIds.some((rootId, index) => rootId !== existing.rootIds[index])
        ))) {
          throw new Error('RPC attachment claim does not match its reservation snapshot')
        }
        reservation.snapshot ??= { draftId: existing.draftId, rootIds: [...existing.rootIds] }
        return this.materializeClaim(store, state, existing)
      }

      const draft = state.draft
      if (reservation.snapshot === undefined) {
        if (draft === null) reservation.snapshot = null
        else {
          const claimed = claimedRootIds(state)
          reservation.snapshot = {
            draftId: draft.draftId,
            rootIds: draft.roots
              .filter(root => !claimed.has(root.rootId) && root.createdAt <= reservation.createdBefore)
              .map(root => root.rootId),
          }
        }
      }
      const snapshot = reservation.snapshot
      if (snapshot === null || snapshot.rootIds.length === 0) return null
      if (draft === null || draft.draftId !== snapshot.draftId) {
        throw new Error('Attachment reservation draft no longer matches its snapshot')
      }
      const rootsById = new Map(draft.roots.map(root => [root.rootId, root] as const))
      const roots = snapshot.rootIds.flatMap(rootId => {
        const root = rootsById.get(rootId)
        return root === undefined ? [] : [root]
      })
      if (roots.length !== snapshot.rootIds.length) {
        throw new Error('Attachment reservation snapshot is no longer available')
      }
      const claimed = claimedRootIds(state)
      if (roots.some(root => claimed.has(root.rootId))) {
        throw new Error('Attachment reservation snapshot was claimed by another message')
      }
      if (roots.length === 0) return null
      const pending: PendingClaimState = {
        claimId: randomToken(18),
        draftId: draft.draftId,
        rootIds: roots.map(root => root.rootId),
        createdAt: Date.now(),
        rpcId,
      }
      state.pendingClaims.push(pending)
      await store.save(state)
      return this.materializeClaim(store, state, pending)
    }))
  }

  async releaseClaim(
    cwd: string,
    sessionId: string,
    claimId: string,
    rpcId?: string,
  ): Promise<boolean> {
    return this.locked(cwd, sessionId, async store => {
      const state = await store.load()
      const index = state.pendingClaims.findIndex(pending => (
        pending.claimId === claimId
        && (rpcId === undefined || pending.rpcId === rpcId)
      ))
      if (index < 0) return false
      state.pendingClaims.splice(index, 1)
      await store.save(state)
      return true
    })
  }

  async releaseClaimForRpcIds(
    cwd: string,
    sessionId: string,
    rpcIds: ReadonlySet<string>,
  ): Promise<boolean> {
    if (rpcIds.size === 0) return false
    return this.locked(cwd, sessionId, async store => {
      const state = await store.load()
      const retained = state.pendingClaims.filter(pending => (
        pending.rpcId === undefined || !rpcIds.has(pending.rpcId)
      ))
      if (retained.length === state.pendingClaims.length) return false
      state.pendingClaims.splice(0, state.pendingClaims.length, ...retained)
      await store.save(state)
      return true
    })
  }

  async getPendingClaims(cwd: string, sessionId: string): Promise<readonly PendingClaimSnapshot[]> {
    return this.locked(cwd, sessionId, async store => {
      const pending = (await store.load()).pendingClaims
      return pending.map(claim => pendingClaimSnapshot(sessionId, claim))
    })
  }

  async listPendingClaims(
    sessions: readonly { readonly cwd: string; readonly sessionId: string }[],
  ): Promise<readonly PendingClaimSnapshot[]> {
    const claims = await Promise.all(sessions.map(session => this.getPendingClaims(session.cwd, session.sessionId)))
    return claims.flat()
  }

  async releaseClaimForRpcId(cwd: string, sessionId: string, rpcId: string): Promise<boolean> {
    return this.locked(cwd, sessionId, async store => {
      const state = await store.load()
      const index = state.pendingClaims.findIndex(pending => pending.rpcId === rpcId)
      if (index < 0) return false
      state.pendingClaims.splice(index, 1)
      await store.save(state)
      return true
    })
  }

  async getReadyClaimsForRpcIds(
    cwd: string,
    sessionId: string,
    rpcIds: ReadonlySet<string>,
  ): Promise<readonly ReadyRootClaim[]> {
    if (rpcIds.size === 0) return []
    return this.locked(cwd, sessionId, async store => {
      const state = await store.load()
      if (state.draft === null || state.pendingClaims.length === 0) return []
      const byRpcId = new Map(state.pendingClaims.flatMap(pending => (
        pending.rpcId === undefined ? [] : [[pending.rpcId, pending] as const]
      )))
      const selected: PendingClaimState[] = []
      for (const rpcId of rpcIds) {
        const pending = byRpcId.get(rpcId)
        if (pending !== undefined) selected.push(pending)
      }
      const legacy = state.pendingClaims.find(pending => pending.rpcId === undefined)
      if (selected.length === 0 && legacy !== undefined) selected.push(legacy)
      const claims: ReadyRootClaim[] = []
      for (const pending of selected) claims.push(await this.materializeClaim(store, state, pending))
      return claims
    })
  }

  async claimReadyRoots(
    cwd: string,
    sessionId: string,
    rpcIds: ReadonlySet<string> = new Set(),
  ): Promise<ReadyRootClaim | null> {
    return this.locked(cwd, sessionId, async store => {
      const state = await store.load()
      const draft = state.draft
      if (draft === null) return null
      const existing = rpcIds.size === 0
        ? state.pendingClaims.find(pending => pending.rpcId === undefined)
        : state.pendingClaims.find(pending => pending.rpcId !== undefined && rpcIds.has(pending.rpcId))
      if (existing !== undefined) return this.materializeClaim(store, state, existing)
      if (rpcIds.size > 0) return null
      const claimed = claimedRootIds(state)
      const roots = draft.roots.filter(root => !claimed.has(root.rootId) && rootSummary(root).status === 'ready')
      if (roots.length === 0) return null
      await this.verifyReadyRoots(store, roots)
      const claimId = randomToken(18)
      state.pendingClaims.push({
        claimId,
        draftId: draft.draftId,
        rootIds: roots.map(root => root.rootId),
        createdAt: Date.now(),
      })
      await store.save(state)
      return { claimId, draftId: draft.draftId, roots }
    })
  }

  async readClaimFile(
    cwd: string,
    sessionId: string,
    claimId: string,
    rootId: string,
    entryId: string,
  ): Promise<ReadyClaimFile> {
    return this.locked(cwd, sessionId, async store => {
      const state = await store.load()
      const pending = state.pendingClaims.find(candidate => candidate.claimId === claimId)
      const draft = state.draft
      if (pending === undefined || draft === null || draft.draftId !== pending.draftId) {
        throw new Error('Attachment claim is no longer pending')
      }
      if (!pending.rootIds.includes(rootId)) throw new Error('Attachment root is not part of the pending claim')
      const root = draft.roots.find(candidate => candidate.rootId === rootId)
      const entry = root?.entries.find(candidate => candidate.entryId === entryId)
      if (entry === undefined || entry.status !== 'ready') throw new Error('Ready claimed attachment file not found')

      const target = store.absolute(entry.relPath)
      const opened = await store.openVerifiedFile(target, { dev: entry.fileDev, ino: entry.fileIno }, false)
      try {
        if (opened.size !== entry.size) throw new Error('Ready claimed attachment size does not match metadata')
        const data = await opened.handle.readFile()
        if (data.byteLength !== entry.size) throw new Error('Ready claimed attachment changed while being read')
        return {
          entryId: entry.entryId,
          name: entry.name,
          size: entry.size,
          mime: entry.mime,
          data: new Uint8Array(data),
        }
      } finally {
        await opened.handle.close()
      }
    })
  }

  async ackClaim(cwd: string, sessionId: string, claimId: string): Promise<boolean> {
    return this.locked(cwd, sessionId, async store => {
      const state = await store.load()
      const pending = state.pendingClaims.find(candidate => candidate.claimId === claimId)
      if (pending === undefined) return false
      acknowledgePendingClaim(state, pending)
      await store.save(state)
      return true
    })
  }

  async ackClaimForRpcId(cwd: string, sessionId: string, rpcId: string): Promise<boolean> {
    return this.locked(cwd, sessionId, async store => {
      const state = await store.load()
      const pending = state.pendingClaims.find(candidate => candidate.rpcId === rpcId)
      if (pending === undefined) return false
      acknowledgePendingClaim(state, pending)
      await store.save(state)
      return true
    })
  }

  async issuePreview(cwd: string, sessionId: string, relPath: string): Promise<{
    readonly url: string
    readonly name: string
    readonly mime: string
    readonly size: number
  }> {
    return this.locked(cwd, sessionId, async store => {
      const state = await store.load()
      const roots = [...(state.draft?.roots ?? []), ...state.published]
      const entry = roots.flatMap(root => root.entries).find(candidate => candidate.relPath === relPath && candidate.status === 'ready')
      if (entry === undefined) throw new Error('Ready attachment not found')
      const absolute = store.absolute(entry.relPath)
      const opened = await store.openVerifiedFile(absolute, { dev: entry.fileDev, ino: entry.fileIno }, false)
      await opened.handle.close()
      const mime = safeHeaderMime(entry.mime)
      this.pruneExpiredGrants()
      let grant = [...this.previews.values()].find(candidate => (
        candidate.cwd === cwd
        && candidate.sessionId === sessionId
        && candidate.relPath === entry.relPath
        && candidate.fileDev === entry.fileDev
        && candidate.fileIno === entry.fileIno
      ))
      if (grant === undefined) {
        if (this.previews.size >= MAX_PREVIEW_GRANTS) throw new Error('Too many active attachment preview grants')
        const ticket = randomToken(32)
        grant = {
          ticket,
          cwd,
          sessionId,
          relPath: entry.relPath,
          name: entry.name,
          mime,
          fileDev: entry.fileDev,
          fileIno: entry.fileIno,
          expiresAt: Date.now() + PREVIEW_GRANT_MS,
        }
        this.previews.set(ticket, grant)
      } else {
        grant.expiresAt = Date.now() + PREVIEW_GRANT_MS
      }
      return { url: `${this.prefix}/content/${grant.ticket}`, name: entry.name, mime, size: opened.size }
    })
  }

  async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      assertTrustedBrowserRequest(req)
      const url = new URL(req.url ?? '/', 'http://dsh.invalid')
      const uploadMatch = url.pathname.match(new RegExp(`^${this.prefix.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}/upload/([A-Za-z0-9_-]+)$`, 'u'))
      if (uploadMatch?.[1] !== undefined) {
        await this.handleUpload(req, res, uploadMatch[1])
        return
      }
      const contentMatch = url.pathname.match(new RegExp(`^${this.prefix.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}/content/([A-Za-z0-9_-]+)$`, 'u'))
      if (contentMatch?.[1] !== undefined) {
        await this.handleContent(req, res, contentMatch[1])
        return
      }
      throw new HttpError(404, 'Attachment route not found')
    } catch (error: unknown) {
      if (res.headersSent || res.writableEnded) {
        res.destroy(error instanceof Error ? error : undefined)
        return
      }
      const status = error instanceof HttpError ? error.status : 500
      const message = error instanceof Error ? error.message : 'Attachment request failed'
      const headers = error instanceof HttpError ? error.headers : {}
      json(res, status, { error: message }, headers)
    }
  }

  private uploadGrant(req: IncomingMessage, token: string): UploadGrant {
    const grant = this.uploads.get(token)
    if (grant === undefined || grant.expiresAt < Date.now()) {
      this.uploads.delete(token)
      throw new HttpError(404, 'Upload token not found or expired')
    }
    const ticket = headerValue(req.headers['x-dsh-upload-ticket'])
    if (ticket === undefined || !constantTimeEqual(ticket, grant.ticket)) throw new HttpError(403, 'Invalid upload ticket')
    grant.expiresAt = Date.now() + UPLOAD_GRANT_MS
    return grant
  }

  private async handleUpload(req: IncomingMessage, res: ServerResponse, token: string): Promise<void> {
    const grant = this.uploadGrant(req, token)
    if (req.method === 'HEAD') {
      const offset = await this.currentOffset(grant)
      res.writeHead(204, {
        'Cache-Control': 'no-store',
        'Upload-Offset': String(offset),
        'Upload-Chunk-Size': String(UPLOAD_CHUNK_SIZE),
      })
      res.end()
      return
    }
    if (req.method !== 'PATCH') throw new HttpError(405, 'Method not allowed', { Allow: 'HEAD, PATCH' })
    const contentType = headerValue(req.headers['content-type'])?.split(';', 1)[0]?.trim().toLowerCase()
    if (contentType !== 'application/offset+octet-stream') throw new HttpError(415, 'PATCH requires application/offset+octet-stream')
    const requestedOffset = parseOffset(headerValue(req.headers['upload-offset']))
    const result = await this.patchUpload(req, grant, requestedOffset)
    json(res, 200, result, { 'Upload-Offset': String(result.offset) })
  }

  private async currentOffset(grant: UploadGrant): Promise<number> {
    return this.locked(grant.cwd, grant.sessionId, async store => {
      const state = await store.load()
      const entry = findEntryAnywhere(state, grant.rootId, grant.entryId)
      if (entry === undefined) throw new HttpError(404, 'Upload entry no longer exists')
      await this.refreshEntry(store, entry)
      await store.save(state)
      return entry.received
    })
  }

  private async patchUpload(req: IncomingMessage, grant: UploadGrant, requestedOffset: number): Promise<{
    readonly offset: number
    readonly complete: boolean
    readonly relPath?: string
  }> {
    return this.locked(grant.cwd, grant.sessionId, async store => {
      const state = await store.load()
      const entry = findEntryAnywhere(state, grant.rootId, grant.entryId)
      if (entry === undefined) throw new HttpError(404, 'Upload entry no longer exists')
      await this.refreshEntry(store, entry)
      if (requestedOffset !== entry.received) {
        req.resume()
        throw new HttpError(409, 'Upload offset mismatch', { 'Upload-Offset': String(entry.received) })
      }
      if (entry.status === 'ready') {
        req.resume()
        return { offset: entry.size, complete: true, relPath: entry.relPath }
      }

      const remaining = entry.size - entry.received
      const limit = Math.min(UPLOAD_CHUNK_SIZE, remaining)
      const contentLengthText = headerValue(req.headers['content-length'])
      let declaredChunkLength: number | undefined
      if (contentLengthText !== undefined) {
        const contentLength = parseOffset(contentLengthText)
        declaredChunkLength = contentLength
        if (contentLength > limit) {
          req.resume()
          throw new HttpError(413, `Upload chunk exceeds the remaining ${limit} bytes`)
        }
      }
      const filesystem = await statfs(store.contentRoot, { bigint: true })
      const available = filesystem.bavail * filesystem.bsize
      const requestedStorage = BigInt(declaredChunkLength ?? limit)
      if (available < requestedStorage + MIN_FREE_STORAGE_RESERVE) {
        req.resume()
        throw new HttpError(507, 'Insufficient server storage for this upload chunk')
      }
      const target = store.absolute(entry.relPath)
      let opened
      try {
        opened = await store.openVerifiedFile(target, { dev: entry.fileDev, ino: entry.fileIno }, true)
        if (opened.size !== entry.received) throw new HttpError(409, 'Upload file changed unexpectedly')
        let position = entry.received
        try {
          for await (const value of req) {
            const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
            if (position - entry.received + chunk.length > limit) {
              throw new HttpError(413, `Upload chunks cannot exceed ${limit} bytes`)
            }
            position = await writeAll(opened.handle, chunk, position)
          }
        } catch (error: unknown) {
          await opened.handle.truncate(entry.received).catch(() => undefined)
          req.resume()
          throw error
        }
        const after = await opened.handle.stat({ bigint: true })
        if (after.size > BigInt(Number.MAX_SAFE_INTEGER)) throw new HttpError(413, 'Upload file is too large')
        const afterSize = Number(after.size)
        if (afterSize === entry.received && remaining > 0) throw new HttpError(400, 'PATCH body is empty')
        entry.received = afterSize
        if (entry.received > entry.size) {
          await opened.handle.truncate(requestedOffset)
          entry.received = requestedOffset
          throw new HttpError(413, 'Upload exceeds the declared file size')
        }
        if (entry.received === entry.size) entry.status = 'ready'
      } finally {
        await opened?.handle.close().catch(() => undefined)
      }
      await store.save(state)
      return {
        offset: entry.received,
        complete: entry.status === 'ready',
        ...(entry.status === 'ready' ? { relPath: entry.relPath } : {}),
      }
    })
  }

  private async handleContent(req: IncomingMessage, res: ServerResponse, ticket: string): Promise<void> {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed', { Allow: 'GET, HEAD' })
    const grant = this.previews.get(ticket)
    if (grant === undefined || grant.expiresAt < Date.now() || !constantTimeEqual(ticket, grant.ticket)) {
      this.previews.delete(ticket)
      throw new HttpError(404, 'Content ticket not found or expired')
    }
    grant.expiresAt = Date.now() + PREVIEW_GRANT_MS
    const store = this.store(grant.cwd, grant.sessionId)
    await store.initialize()
    const absolute = store.absolute(grant.relPath)
    let opened
    try {
      opened = await store.openVerifiedFile(absolute, { dev: grant.fileDev, ino: grant.fileIno }, false)
    } catch {
      throw new HttpError(404, 'Attachment content is unavailable')
    }
    try {
      const plan = planContentResponse(headerValue(req.headers.range), opened.size)
      const mime = safeHeaderMime(grant.mime)
      const headers: Record<string, string> = {
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, no-store',
        'Content-Length': String(plan.length),
        'Content-Type': mime,
        'Content-Disposition': `${shouldInline(mime) ? 'inline' : 'attachment'}; filename*=${quotedFilename(grant.name)}`,
        'Content-Security-Policy': "sandbox; default-src 'none'",
        'Cross-Origin-Resource-Policy': 'same-origin',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      }
      if (plan.contentRange !== undefined) headers['Content-Range'] = plan.contentRange
      res.writeHead(plan.status, headers)
      if (req.method === 'HEAD' || plan.status === 416 || plan.length === 0) {
        res.end()
        return
      }
      await pipeline(opened.handle.createReadStream({ start: plan.start, end: plan.end, autoClose: false }), res)
    } finally {
      await opened.handle.close().catch(() => undefined)
    }
  }
}
