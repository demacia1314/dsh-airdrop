import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'

export interface RpcError {
  readonly code?: string
  readonly message: string
  readonly params?: Record<string, unknown>
  readonly level?: string
}

export type RpcResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: RpcError }

export type AttachmentKind = 'file' | 'folder'
export type AttachmentStatus = 'uploading' | 'ready' | 'error'

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

export interface RootEntry {
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

export interface DraftSummary {
  readonly draftId: string
  readonly roots: readonly RootSummary[]
}

export interface UniversalAttachmentsCalls {
  prepareBatch(sessionId: string, rootsJson: string): Promise<RpcResult<PrepareBatchResult>>
  beginFile(
    sessionId: string,
    draftId: string,
    rootId: string,
    relativePath: string,
    name: string,
    size: number,
    mime: string,
    lastModified: number,
  ): Promise<RpcResult<BeginFileResult>>
  listDraft(sessionId: string): Promise<RpcResult<{ draft: DraftSummary | null }>>
  listRoot(sessionId: string, draftId: string, rootId: string): Promise<RpcResult<{ root: RootSummary & { entries: readonly RootEntry[] } }>>
  listStoredRoot(sessionId: string, rootId: string): Promise<RpcResult<{ root: RootSummary & { entries: readonly RootEntry[] } }>>
  removeRoot(sessionId: string, draftId: string, rootId: string): Promise<RpcResult<{ removed: boolean }>>
  clearDraft(sessionId: string, draftId: string): Promise<RpcResult<{ removed: boolean }>>
  submitDraft(sessionId: string, draftId: string): Promise<RpcResult<{ accepted: true; rootIds: readonly string[] }>>
  issuePreview(sessionId: string, relPath: string): Promise<RpcResult<{ url: string; name: string; mime: string; size: number }>>
}

export interface RemoteNamespace {
  universalAttachments?: UniversalAttachmentsCalls
  $mount(options: {
    package: string
    descriptors: readonly InvocationDescriptorLike[]
  }): Promise<() => void | Promise<void>>
}

export interface RemoteFace {
  readonly remote: RemoteNamespace
}

export interface SessionsSnapshot {
  readonly current?: string
  readonly byId: Record<string, { readonly cwd?: string } | undefined>
}

export interface SessionsFace {
  readonly list: {
    getSnapshot(): SessionsSnapshot
  }
  scope(sessionId: SessionId): unknown
}

export interface StrictCodec {
  readonly mode: 'strict'
  readonly typeSymbol: string
  readonly schema: { parse(value: unknown): unknown }
}

export interface ParameterDescriptor {
  readonly name: string
  readonly wire: string
  readonly source: 'json'
  readonly codec: StrictCodec
}

export interface InvocationDescriptorLike {
  readonly id: string
  readonly service: string
  readonly namespace: string
  readonly method: string
  readonly invocation: { readonly kind: 'direct' }
  readonly parameters: readonly ParameterDescriptor[]
  readonly result: StrictCodec
}
