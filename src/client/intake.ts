import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConversationController } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { Context } from '@deepseek-ai/cordis'
import type { UploadRoot } from './files.js'
import { rpcText, tr } from './locales.js'
import type { InputActionsFace, UploadStore } from './store.js'
import type { PreparedRoot, UniversalAttachmentsCalls } from './types.js'

const MAX_CONCURRENT_FILES = 3
const MAX_ATTEMPTS = 3

export interface IntakeEnv {
  readonly ctx: ClientContext
  readonly api: () => UniversalAttachmentsCalls | undefined
  readonly store: UploadStore
}

export interface IntakeReport {
  readonly uploadedRoots: number
  readonly failed: readonly { name: string; reason: string }[]
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => { window.setTimeout(resolve, ms) })
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function notification(env: IntakeEnv, sessionId: SessionId, level: 'info' | 'error', text: string): void {
  const conversation = env.ctx.get('conversation') as ConversationController | undefined
  const sessions = (env.ctx as unknown as { sessions: { scope(id: SessionId): Context | null | undefined } }).sessions
  const actx = sessions.scope(sessionId)
  if (conversation !== undefined && actx != null) {
    conversation.input.for(actx).notify(level, text)
    return
  }
  console[level === 'error' ? 'error' : 'log'](`[dsh-universal-attachments] ${text}`)
}

async function queryOffset(uploadUrl: string, ticket: string): Promise<number> {
  const response = await fetch(new URL(uploadUrl, location.origin), {
    method: 'HEAD',
    headers: { 'X-DSH-Upload-Ticket': ticket },
    credentials: 'same-origin',
  })
  if (!response.ok) throw new Error(`Upload probe failed (${response.status})`)
  const value = Number(response.headers.get('Upload-Offset'))
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Upload probe returned an invalid offset')
  return value
}

async function sendChunk(
  uploadUrl: string,
  ticket: string,
  offset: number,
  body: Blob,
): Promise<{ offset: number; complete: boolean }> {
  const response = await fetch(new URL(uploadUrl, location.origin), {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/offset+octet-stream',
      'Upload-Offset': String(offset),
      'X-DSH-Upload-Ticket': ticket,
    },
    body,
    credentials: 'same-origin',
  })
  const payload = await response.json().catch(() => undefined) as { offset?: unknown; complete?: unknown; error?: unknown } | undefined
  if (!response.ok) {
    throw new Error(typeof payload?.error === 'string' ? payload.error : `Upload failed (${response.status})`)
  }
  if (!Number.isSafeInteger(payload?.offset) || Number(payload?.offset) < 0) {
    throw new Error('Upload returned an invalid offset')
  }
  return { offset: Number(payload?.offset), complete: payload?.complete === true }
}

function localPreview(root: UploadRoot): { previewUrl?: string; previewMime?: string } {
  if (root.kind !== 'file') return {}
  const file = root.files[0]?.file
  if (file === undefined) return {}
  const mime = file.type.toLowerCase()
  if (!mime.startsWith('image/') && !mime.startsWith('video/') && !mime.startsWith('audio/')) return {}
  return { previewUrl: URL.createObjectURL(file), previewMime: mime }
}

async function uploadOne(
  api: UniversalAttachmentsCalls,
  sessionId: string,
  draftId: string,
  prepared: PreparedRoot,
  root: UploadRoot,
  entryIndex: number,
  uploadedByEntry: Map<string, number>,
  store: UploadStore,
): Promise<void> {
  const uploadFile = root.files[entryIndex]
  if (uploadFile === undefined) return
  const file = uploadFile.file
  const begin = await api.beginFile(
    sessionId,
    draftId,
    prepared.rootId,
    uploadFile.relativePath,
    file.name,
    file.size,
    file.type || 'application/octet-stream',
    file.lastModified,
  )
  if (!begin.ok) throw new Error(rpcText(begin.error))

  const entryKey = `${prepared.rootId}:${uploadFile.relativePath}:${file.name}`
  let offset = Math.min(begin.value.offset, file.size)
  uploadedByEntry.set(entryKey, offset)
  const reportProgress = (): void => {
    const uploaded = [...uploadedByEntry.entries()]
      .filter(([key]) => key.startsWith(`${prepared.rootId}:`))
      .reduce((sum, [, value]) => sum + value, 0)
    store.patchRoot(prepared.rootId, { progress: root.totalSize === 0 ? 1 : Math.min(1, uploaded / root.totalSize) })
    store.bump(sessionId)
  }
  reportProgress()

  while (offset < file.size) {
    const end = Math.min(file.size, offset + begin.value.chunkSize)
    let sent = false
    let lastError: unknown
    for (let attempt = 0; attempt < MAX_ATTEMPTS && !sent; attempt += 1) {
      try {
        const result = await sendChunk(begin.value.uploadUrl, begin.value.ticket, offset, file.slice(offset, end))
        const nextOffset = Math.min(result.offset, file.size)
        if (nextOffset <= offset) throw new Error('Upload response did not advance the offset')
        offset = nextOffset
        uploadedByEntry.set(entryKey, offset)
        reportProgress()
        sent = true
      } catch (error: unknown) {
        lastError = error
        if (attempt + 1 >= MAX_ATTEMPTS) break
        await delay(300 * 2 ** attempt)
        offset = Math.min(await queryOffset(begin.value.uploadUrl, begin.value.ticket), file.size)
        uploadedByEntry.set(entryKey, offset)
        reportProgress()
        if (offset >= end) sent = true
      }
    }
    if (!sent) throw lastError
  }
}

export async function runIntake(
  env: IntakeEnv,
  sessionId: SessionId,
  roots: readonly UploadRoot[],
  _inputActions?: InputActionsFace,
  preparationId?: string,
): Promise<IntakeReport> {
  const failed: { name: string; reason: string }[] = []
  const key = sessionId as unknown as string
  const api = env.api()
  if (api === undefined) {
    const message = tr('upload.noApi')
    if (preparationId !== undefined) env.store.failPreparation(key, preparationId, message)
    notification(env, sessionId, 'error', message)
    return { uploadedRoots: 0, failed: roots.map(root => ({ name: root.name, reason: 'no-api' })) }
  }
  if (roots.length === 0) {
    if (preparationId !== undefined) env.store.failPreparation(key, preparationId, tr('drop.empty'))
    return { uploadedRoots: 0, failed }
  }

  let preparedResult: Awaited<ReturnType<UniversalAttachmentsCalls['prepareBatch']>>
  try {
    preparedResult = await api.prepareBatch(key, JSON.stringify(roots.map(root => ({
      clientKey: root.clientKey,
      name: root.name,
      kind: root.kind,
      fileCount: root.fileCount,
      totalSize: root.totalSize,
    }))))
  } catch (error: unknown) {
    const message = errorText(error)
    if (preparationId !== undefined) env.store.failPreparation(key, preparationId, message)
    notification(env, sessionId, 'error', tr('upload.failed', { message }))
    return { uploadedRoots: 0, failed: roots.map(root => ({ name: root.name, reason: message })) }
  }
  if (!preparedResult.ok) {
    const message = rpcText(preparedResult.error)
    if (preparationId !== undefined) env.store.failPreparation(key, preparationId, message)
    notification(env, sessionId, 'error', tr('upload.failed', { message }))
    return { uploadedRoots: 0, failed: roots.map(root => ({ name: root.name, reason: message })) }
  }

  const rootByKey = new Map(roots.map(root => [root.clientKey, root]))
  const preparedByKey = new Map(preparedResult.value.roots.map(root => [root.clientKey, root]))
  for (const prepared of preparedResult.value.roots) {
    const source = rootByKey.get(prepared.clientKey)
    if (source !== undefined) env.store.setRoot(prepared.rootId, { ...localPreview(source), progress: 0 })
  }
  if (preparationId === undefined) env.store.bump(key)
  else env.store.markPreparationPrepared(key, preparationId, preparedResult.value.roots.map(root => root.rootId))

  const work = roots.flatMap(root => {
    const prepared = preparedByKey.get(root.clientKey)
    return prepared === undefined
      ? []
      : root.files.map((_, index) => ({ root, prepared, index }))
  })
  const uploadedByEntry = new Map<string, number>()
  let cursor = 0
  const rootFailures = new Map<string, string>()

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor
      cursor += 1
      const item = work[index]
      if (item === undefined) return
      if (rootFailures.has(item.prepared.rootId)) continue
      try {
        await uploadOne(api, key, preparedResult.value.draftId, item.prepared, item.root, item.index, uploadedByEntry, env.store)
      } catch (error: unknown) {
        const message = errorText(error)
        rootFailures.set(item.prepared.rootId, message)
        env.store.patchRoot(item.prepared.rootId, { error: message })
        failed.push({ name: item.root.name, reason: message })
        notification(env, sessionId, 'error', tr('upload.partial', { name: item.root.name, message }))
      } finally {
        env.store.bump(key)
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_FILES, Math.max(1, work.length)) }, worker))
  env.store.bump(key)
  return { uploadedRoots: roots.length - rootFailures.size, failed }
}
