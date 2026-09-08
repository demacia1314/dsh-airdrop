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

const session = stringParameter('sessionId', 'dsh-airdrop#SessionId')

function descriptor(
  method: string,
  parameters: readonly ParameterDescriptor[],
  result: StrictCodec,
): InvocationDescriptorLike {
  return {
    id: `dsh-airdrop#airdrop/${method}`,
    service: 'airdrop',
    namespace: 'airdrop',
    method,
    invocation: { kind: 'direct' },
    parameters,
    result,
  }
}

export function buildDescriptors(): readonly InvocationDescriptorLike[] {
  const draft = stringParameter('draftId', 'dsh-airdrop#DraftId')
  const root = stringParameter('rootId', 'dsh-airdrop#RootId')
  return [
    descriptor('prepareBatch', [session, stringParameter('rootsJson', 'dsh-airdrop#RootsJson')], resultCodec('dsh-airdrop#PrepareBatchResult', prepareResult)),
    descriptor('beginFile', [
      session,
      draft,
      root,
      stringParameter('relativePath', 'dsh-airdrop#RelativePath'),
      stringParameter('name', 'dsh-airdrop#Name'),
      numberParameter('size', 'dsh-airdrop#Size'),
      stringParameter('mime', 'dsh-airdrop#Mime'),
      numberParameter('lastModified', 'dsh-airdrop#LastModified'),
    ], resultCodec('dsh-airdrop#BeginFileResult', beginResult)),
    descriptor('listDraft', [session], resultCodec('dsh-airdrop#ListDraftResult', listDraftResult)),
    descriptor('listRoot', [session, draft, root], resultCodec('dsh-airdrop#ListRootResult', listRootResult)),
    descriptor('listStoredRoot', [session, root], resultCodec('dsh-airdrop#ListStoredRootResult', listRootResult)),
    descriptor('removeRoot', [session, draft, root], resultCodec('dsh-airdrop#RemovedResult', removedResult)),
    descriptor('clearDraft', [session, draft], resultCodec('dsh-airdrop#RemovedResult', removedResult)),
    descriptor('submitDraft', [session, draft], resultCodec('dsh-airdrop#SubmitDraftResult', submittedResult)),
    descriptor('issuePreview', [session, stringParameter('relPath', 'dsh-airdrop#RelPath')], resultCodec('dsh-airdrop#PreviewResult', previewResult)),
  ]
}
