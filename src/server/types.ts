export const UPLOAD_CHUNK_SIZE = 4 * 1024 * 1024
export const STORAGE_VERSION = 4 as const

export type AttachmentKind = 'file' | 'folder'
export type AttachmentStatus = 'uploading' | 'ready' | 'error'

export interface BatchRootInput {
  readonly clientKey: string
  readonly name: string
  readonly kind: AttachmentKind
  readonly fileCount: number
  readonly totalSize: number
}

export interface PathAlias {
  readonly raw: string
  readonly safe: string
}

export interface EntryState {
  readonly entryId: string
  readonly relativePath: string
  readonly safeRelativePath: string
  readonly name: string
  readonly size: number
  readonly mime: string
  readonly lastModified: number
  received: number
  status: AttachmentStatus
  readonly relPath: string
  readonly fileDev: string
  readonly fileIno: string
  error?: string
}

export interface RootState {
  readonly rootId: string
  readonly clientKey: string
  readonly name: string
  readonly kind: AttachmentKind
  readonly relPath: string
  readonly fileCount: number
  readonly totalSize: number
  readonly createdAt: number
  readonly aliases: PathAlias[]
  readonly entries: EntryState[]
  error?: string
}

export interface DraftState {
  readonly draftId: string
  readonly createdAt: number
  readonly roots: RootState[]
}

export interface PendingClaimState {
  readonly claimId: string
  readonly draftId: string
  readonly rootIds: readonly string[]
  readonly createdAt: number
  readonly rpcId?: string
}

export interface AttachmentState {
  readonly version: typeof STORAGE_VERSION
  readonly sessionHash: string
  updatedAt: number
  draft: DraftState | null
  readonly pendingClaims: PendingClaimState[]
  readonly published: RootState[]
}

export interface PreparedRoot {
  readonly clientKey: string
  readonly rootId: string
  readonly relPath: string
}

export interface PrepareBatchResult {
  readonly draftId: string
  readonly chunkSize: number
  readonly roots: readonly PreparedRoot[]
}

export interface BeginFileResult {
  readonly uploadId: string
  readonly uploadUrl: string
  readonly ticket: string
  readonly offset: number
  readonly chunkSize: number
}

export interface EntrySummary {
  readonly entryId: string
  readonly relativePath: string
  readonly name: string
  readonly size: number
  readonly mime: string
  readonly received: number
  readonly status: AttachmentStatus
  readonly relPath?: string
  readonly error?: string
}

export interface RootSummary {
  readonly rootId: string
  readonly name: string
  readonly kind: AttachmentKind
  readonly relPath: string
  readonly fileCount: number
  readonly totalSize: number
  readonly completedFiles: number
  readonly completedSize: number
  readonly status: AttachmentStatus
  readonly error?: string
}

export interface DraftSummary {
  readonly draftId: string
  readonly roots: readonly RootSummary[]
}

export function rootSummary(root: RootState): RootSummary {
  const ready = root.entries.filter(entry => entry.status === 'ready')
  const failed = root.entries.find(entry => entry.status === 'error')
  const completedFiles = ready.length
  const completedSize = ready.reduce((sum, entry) => sum + entry.size, 0)
  const isReady = failed === undefined
    && completedFiles === root.fileCount
    && completedSize === root.totalSize
  const status: AttachmentStatus = failed !== undefined || root.error !== undefined
    ? 'error'
    : isReady ? 'ready' : 'uploading'
  const error = root.error ?? failed?.error

  return {
    rootId: root.rootId,
    name: root.name,
    kind: root.kind,
    relPath: root.relPath,
    fileCount: root.fileCount,
    totalSize: root.totalSize,
    completedFiles,
    completedSize,
    status,
    ...(error === undefined ? {} : { error }),
  }
}

export function entrySummary(entry: EntryState): EntrySummary {
  return {
    entryId: entry.entryId,
    relativePath: entry.relativePath,
    name: entry.name,
    size: entry.size,
    mime: entry.mime,
    received: entry.received,
    status: entry.status,
    ...(entry.status === 'ready' ? { relPath: entry.relPath } : {}),
    ...(entry.error === undefined ? {} : { error: entry.error }),
  }
}
