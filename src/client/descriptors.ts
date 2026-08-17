import { z } from 'zod'
import type { InvocationDescriptorLike, ParameterDescriptor, StrictCodec } from './types.js'

const stringParameter = (name: string, typeSymbol: string): ParameterDescriptor => ({
  name,
  wire: name,
  source: 'json',
  codec: { mode: 'strict', typeSymbol, schema: z.string() },
})

const numberParameter = (name: string, typeSymbol: string): ParameterDescriptor => ({
  name,
  wire: name,
  source: 'json',
  codec: { mode: 'strict', typeSymbol, schema: z.number().finite().nonnegative() },
})

const resultCodec = (symbol: string, schema: { parse(value: unknown): unknown }): StrictCodec => ({
  mode: 'strict',
  typeSymbol: symbol,
  schema,
})

const rootSummary = z.object({
  rootId: z.string(),
  name: z.string(),
  kind: z.enum(['file', 'folder']),
  relPath: z.string(),
  fileCount: z.number(),
  totalSize: z.number(),
  completedFiles: z.number(),
  completedSize: z.number(),
  status: z.enum(['uploading', 'ready', 'error']),
  error: z.string().optional(),
})

const entry = z.object({
  entryId: z.string(),
  relativePath: z.string(),
  name: z.string(),
  size: z.number(),
  mime: z.string(),
  received: z.number(),
  status: z.enum(['uploading', 'ready', 'error']),
  relPath: z.string().optional(),
  error: z.string().optional(),
})

const prepareResult = z.object({
  draftId: z.string(),
  chunkSize: z.number(),
  roots: z.array(z.object({ clientKey: z.string(), rootId: z.string(), relPath: z.string() })),
})

const beginResult = z.object({
  uploadId: z.string(),
  uploadUrl: z.string(),
  ticket: z.string(),
  offset: z.number(),
  chunkSize: z.number(),
})

const listDraftResult = z.object({
  draft: z.object({ draftId: z.string(), roots: z.array(rootSummary) }).nullable(),
})

const listRootResult = z.object({
  root: rootSummary.extend({ entries: z.array(entry) }),
})

const removedResult = z.object({ removed: z.boolean() })
const submittedResult = z.object({ accepted: z.literal(true), rootIds: z.array(z.string()) })
const previewResult = z.object({ url: z.string(), name: z.string(), mime: z.string(), size: z.number() })

const session = stringParameter('sessionId', 'dsh-universal-attachments#SessionId')

function descriptor(
  method: string,
  parameters: readonly ParameterDescriptor[],
  result: StrictCodec,
): InvocationDescriptorLike {
  return {
    id: `dsh-universal-attachments#universalAttachments/${method}`,
    service: 'universalAttachments',
    namespace: 'universalAttachments',
    method,
    invocation: { kind: 'direct' },
    parameters,
    result,
  }
}

export function buildDescriptors(): readonly InvocationDescriptorLike[] {
  const draft = stringParameter('draftId', 'dsh-universal-attachments#DraftId')
  const root = stringParameter('rootId', 'dsh-universal-attachments#RootId')
  return [
    descriptor('prepareBatch', [session, stringParameter('rootsJson', 'dsh-universal-attachments#RootsJson')], resultCodec('dsh-universal-attachments#PrepareBatchResult', prepareResult)),
    descriptor('beginFile', [
      session,
      draft,
      root,
      stringParameter('relativePath', 'dsh-universal-attachments#RelativePath'),
      stringParameter('name', 'dsh-universal-attachments#Name'),
      numberParameter('size', 'dsh-universal-attachments#Size'),
      stringParameter('mime', 'dsh-universal-attachments#Mime'),
      numberParameter('lastModified', 'dsh-universal-attachments#LastModified'),
    ], resultCodec('dsh-universal-attachments#BeginFileResult', beginResult)),
    descriptor('listDraft', [session], resultCodec('dsh-universal-attachments#ListDraftResult', listDraftResult)),
    descriptor('listRoot', [session, draft, root], resultCodec('dsh-universal-attachments#ListRootResult', listRootResult)),
    descriptor('listStoredRoot', [session, root], resultCodec('dsh-universal-attachments#ListStoredRootResult', listRootResult)),
    descriptor('removeRoot', [session, draft, root], resultCodec('dsh-universal-attachments#RemovedResult', removedResult)),
    descriptor('clearDraft', [session, draft], resultCodec('dsh-universal-attachments#RemovedResult', removedResult)),
    descriptor('submitDraft', [session, draft], resultCodec('dsh-universal-attachments#SubmitDraftResult', submittedResult)),
    descriptor('issuePreview', [session, stringParameter('relPath', 'dsh-universal-attachments#RelPath')], resultCodec('dsh-universal-attachments#PreviewResult', previewResult)),
  ]
}
