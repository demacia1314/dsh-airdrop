import type {
  ChatConversationViewNode,
  ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { AttachmentHistoryRoot } from '../shared/manifest.js'
import { readAttachmentManifest } from '../shared/manifest.js'
import { readLegacyAttachmentHistory } from './history.js'

export const ATTACHMENT_CHAT_NODE_KIND = 'universal-attachments' as const

export interface AttachmentChatData {
  readonly batchId: string
  readonly seq: number
  readonly time: number
  readonly roots: readonly AttachmentHistoryRoot[]
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    'universal-attachments': AttachmentChatData
  }
}

type ConversationEvent = Parameters<ConversationNodeDefinition['match']>[0]

function attachmentData(event: ConversationEvent): AttachmentChatData | undefined {
  if (event.type !== 'user/message' || event.surfaceOp !== 'append') return undefined

  const manifest = event.data.source.kind === 'user'
    ? readAttachmentManifest(event.data.source)
    : undefined
  const legacy = manifest === undefined
    ? readLegacyAttachmentHistory(event.data.source, event.data.content, String(event.data.id))
    : undefined
  const roots = manifest === undefined
    ? legacy?.roots
    : manifest.roots.filter(root => root.nativeImage !== true)
  if (roots === undefined || roots.length === 0) return undefined

  return {
    batchId: manifest?.batchId ?? legacy?.batchId ?? String(event.data.id),
    seq: event.seq,
    time: event.time,
    roots,
  }
}

export const attachmentConversationDefinition: ConversationNodeDefinition<AttachmentChatData> = {
  kind: 'dsh-universal-attachments',
  target: 'chat',
  match(event) {
    if (event.type !== 'user/message') return null
    return attachmentData(event) === undefined
      ? null
      : { id: String(event.data.id), role: 'start' }
  },
  start(_context, match) {
    const data = attachmentData(match.event)
    if (data === undefined) throw new Error('attachment conversation node has no attachment data')
    return data
  },
  update(context) {
    return context.state
  },
  buildViewNode(context): ChatConversationViewNode | null {
    const state = context.state
    if (state === undefined || state.roots.length === 0) return null
    return {
      key: context.key,
      kind: ATTACHMENT_CHAT_NODE_KIND,
      id: context.id,
      target: 'chat',
      anchorSeq: state.seq + 0.01,
      location: context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' },
      visibility: 'visible',
      data: state,
    }
  },
}
