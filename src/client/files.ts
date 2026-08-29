import type { AttachmentKind } from './types.js'

export interface UploadFile {
  readonly file: File
  /** Path below the root. Empty for a top-level file root. */
  readonly relativePath: string
}

export interface UploadRoot {
  readonly clientKey: string
  readonly name: string
  readonly kind: AttachmentKind
  readonly files: readonly UploadFile[]
  readonly fileCount: number
  readonly totalSize: number
}

interface FileSystemFileHandleLike {
  readonly kind: 'file'
  readonly name: string
  getFile(): Promise<File>
}

interface FileSystemDirectoryHandleLike {
  readonly kind: 'directory'
  readonly name: string
  values(): AsyncIterableIterator<FileSystemFileHandleLike | FileSystemDirectoryHandleLike>
}

type FileSystemHandleLike = FileSystemFileHandleLike | FileSystemDirectoryHandleLike

interface WebkitFileEntryLike {
  readonly isFile: true
  readonly isDirectory: false
  readonly name: string
  file(success: (file: File) => void, failure?: (error: unknown) => void): void
}

interface WebkitDirectoryReaderLike {
  readEntries(success: (entries: readonly WebkitEntryLike[]) => void, failure?: (error: unknown) => void): void
}

interface WebkitDirectoryEntryLike {
  readonly isFile: false
  readonly isDirectory: true
  readonly name: string
  createReader(): WebkitDirectoryReaderLike
}

type WebkitEntryLike = WebkitFileEntryLike | WebkitDirectoryEntryLike

interface DataTransferItemWithDirectories {
  readonly kind: string
  getAsFileSystemHandle?: () => Promise<FileSystemHandleLike | null>
  webkitGetAsEntry?: () => WebkitEntryLike | null
  getAsEntry?: () => WebkitEntryLike | null
}

type FileWithRelativePath = File & { readonly webkitRelativePath?: string }

const MAX_DEPTH = 64

function randomKey(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function root(name: string, kind: AttachmentKind, files: readonly UploadFile[]): UploadRoot {
  return {
    clientKey: randomKey(),
    name,
    kind,
    files,
    fileCount: files.length,
    totalSize: files.reduce((sum, item) => sum + item.file.size, 0),
  }
}

function joinPath(parent: string, name: string): string {
  return parent === '' ? name : `${parent}/${name}`
}

function relativePathOf(file: FileWithRelativePath): string {
  return (file.webkitRelativePath ?? '').replaceAll('\\', '/').replace(/^\/+|\/+$/gu, '')
}

export function rootsFromFiles(files: readonly File[], directoryMode = false): readonly UploadRoot[] {
  if (!directoryMode) {
    return files.map(file => root(file.name, 'file', [{ file, relativePath: '' }]))
  }

  const grouped = new Map<string, UploadFile[]>()
  for (const file of files) {
    const relative = relativePathOf(file)
    const [top, ...rest] = relative.split('/').filter(Boolean)
    const rootName = top ?? 'folder'
    const belowRoot = rest.join('/') || file.name
    const group = grouped.get(rootName) ?? []
    group.push({ file, relativePath: belowRoot })
    grouped.set(rootName, group)
  }
  return [...grouped].map(([name, entries]) => root(name, 'folder', entries))
}

async function walkHandle(
  handle: FileSystemHandleLike,
  parent: string,
  output: UploadFile[],
  depth: number,
): Promise<void> {
  if (depth > MAX_DEPTH) throw new Error(`Directory depth exceeds ${MAX_DEPTH}`)
  if (handle.kind === 'file') {
    const file = await handle.getFile()
    output.push({ file, relativePath: joinPath(parent, handle.name) })
    return
  }
  for await (const child of handle.values()) {
    await walkHandle(child, joinPath(parent, handle.name), output, depth + 1)
  }
}

function entryFile(entry: WebkitFileEntryLike): Promise<File> {
  return new Promise((resolve, reject) => { entry.file(resolve, reject) })
}

function readDirectory(reader: WebkitDirectoryReaderLike): Promise<readonly WebkitEntryLike[]> {
  return new Promise((resolve, reject) => { reader.readEntries(resolve, reject) })
}

async function walkEntry(
  entry: WebkitEntryLike,
  parent: string,
  output: UploadFile[],
  depth: number,
): Promise<void> {
  if (depth > MAX_DEPTH) throw new Error(`Directory depth exceeds ${MAX_DEPTH}`)
  if (entry.isFile) {
    output.push({ file: await entryFile(entry), relativePath: joinPath(parent, entry.name) })
    return
  }
  const reader = entry.createReader()
  for (;;) {
    const entries = await readDirectory(reader)
    if (entries.length === 0) break
    for (const child of entries) await walkEntry(child, joinPath(parent, entry.name), output, depth + 1)
  }
}

function stripRoot(files: readonly UploadFile[], rootName: string): readonly UploadFile[] {
  const prefix = `${rootName}/`
  return files.map(item => ({
    file: item.file,
    relativePath: item.relativePath.startsWith(prefix)
      ? item.relativePath.slice(prefix.length)
      : item.relativePath,
  }))
}

/**
 * Reads directory handles during the original drop event and only awaits them
 * afterwards. Chromium requires this timing for getAsFileSystemHandle().
 */
export async function rootsFromDrop(transfer: DataTransfer): Promise<readonly UploadRoot[]> {
  const fallbackFiles = [...transfer.files]
  const items = [...transfer.items]
    .filter(item => item.kind === 'file')
    .map(item => item as unknown as DataTransferItemWithDirectories)
  // File System Access API is only available in secure contexts. Calling
  // getAsFileSystemHandle() on a non-secure origin (e.g. http://<lan-ip>) makes
  // Chromium kill the renderer with RESULT_CODE_KILLED_BAD_MESSAGE (crbug 1219885).
  // Guard it and fall back to the legacy entry APIs below.
  const handles = globalThis.isSecureContext
    ? items.map(item => {
        try { return item.getAsFileSystemHandle?.() }
        catch { return undefined }
      })
    : []
  const entries = items.map(item => {
    try { return item.webkitGetAsEntry?.() ?? item.getAsEntry?.() ?? null }
    catch { return null }
  })

  if (handles.some(Boolean)) {
    const resolved = await Promise.all(handles.map(async value => value === undefined ? null : value.catch(() => null)))
    if (resolved.length > 0 && resolved.every(handle => handle !== null)) {
      const roots: UploadRoot[] = []
      for (const handle of resolved) {
        if (handle === null) continue
        if (handle.kind === 'file') {
          const file = await handle.getFile()
          roots.push(root(handle.name, 'file', [{ file, relativePath: '' }]))
        } else {
          const files: UploadFile[] = []
          await walkHandle(handle, '', files, 0)
          roots.push(root(handle.name, 'folder', stripRoot(files, handle.name)))
        }
      }
      if (roots.length > 0) return roots
    }
  }

  if (entries.some(Boolean)) {
    const roots: UploadRoot[] = []
    for (const entry of entries) {
      if (entry === null) continue
      if (entry.isFile) {
        const file = await entryFile(entry)
        roots.push(root(entry.name, 'file', [{ file, relativePath: '' }]))
      } else {
        const files: UploadFile[] = []
        await walkEntry(entry, '', files, 0)
        roots.push(root(entry.name, 'folder', stripRoot(files, entry.name)))
      }
    }
    if (roots.length > 0) return roots
  }

  return rootsFromFiles(fallbackFiles)
}
