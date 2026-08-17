import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { AttachmentHistoryRoot } from '../shared/manifest.js'
import { AttachmentNode, type StoredAttachmentPreview } from './AttachmentNode.js'
import { AttachButton } from './AttachButton.js'
import { buildDescriptors } from './descriptors.js'
import { attachmentConversationDefinition } from './conversation.js'
import { installDropzone } from './dropzone.js'
import type { UploadRoot } from './files.js'
import { runIntake, type IntakeEnv } from './intake.js'
import { NS, en, rpcText, setBoundT, zh } from './locales.js'
import {
  createAttachmentAwareContextRenderer,
  createAttachmentAwareUserRenderer,
  nativeRendererGuard,
} from './message-renderers.js'
import { createUploadStore, type InputActionsFace } from './store.js'
import { installStyles } from './styles.js'
import type { RemoteFace, UniversalAttachmentsCalls } from './types.js'
import { UploadDock } from './UploadDock.js'

interface LocaleServiceFace {
  register(namespace: string, dictionaries: Record<string, Record<string, string>>): unknown
  bind(namespace: string): (key: string, params?: Record<string, unknown>) => string
}

export { AttachButton } from './AttachButton.js'
export { rootsFromDrop, rootsFromFiles } from './files.js'
export { runIntake } from './intake.js'

export const inject = ['slots', 'sessions', 'conversation', 'conversationEvents', 'remote']

export async function apply(ctx: ClientContext): Promise<void> {
  ctx.effect(() => installStyles(), 'dsh-universal-attachments: styles')
  const store = createUploadStore()
  ctx.effect(() => () => { store.dispose() }, 'dsh-universal-attachments: local upload state')

  const remote = (ctx as unknown as RemoteFace).remote
  const unmount = await remote.$mount({
    package: 'dsh-universal-attachments',
    descriptors: buildDescriptors(),
  })
  ctx.effect(() => () => { void unmount() }, 'dsh-universal-attachments: remote descriptors')

  let calls: UniversalAttachmentsCalls | undefined
  ctx.inject(['remote', 'remote.universalAttachments'], (remoteCtx: ClientContext): void => {
    calls = (remoteCtx as unknown as RemoteFace).remote.universalAttachments
  })
  const api = (): UniversalAttachmentsCalls | undefined => calls
  ctx.effect(
    () => ctx.conversationEvents.register(attachmentConversationDefinition),
    'dsh-universal-attachments: conversation attachment nodes',
  )
  const intakeEnv: IntakeEnv = { ctx, api, store }
  const intake = (
    sessionId: SessionId,
    roots: readonly UploadRoot[],
    inputActions?: InputActionsFace,
    preparationId?: string,
  ): Promise<unknown> => runIntake(intakeEnv, sessionId, roots, inputActions, preparationId)

  ctx.inject(['locale'], (localeCtx: ClientContext): void => {
    const locale = (localeCtx as unknown as { locale: LocaleServiceFace }).locale
    ctx.effect(() => {
      const dispose = locale.register(NS, { zh, en })
      return () => { if (typeof dispose === 'function') dispose() }
    }, 'dsh-universal-attachments: dictionaries')
    setBoundT(locale.bind(NS))

    ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
      name: 'conversation.input.left',
      id: 'universal-attachments',
      order: 20,
      locale: NS,
      inject: (sessionId: SessionId) => ({
        store,
        intake: (roots: readonly UploadRoot[], inputActions?: InputActionsFace) => intake(sessionId, roots, inputActions),
      }),
    }, AttachButton))

    ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
      name: 'conversation.input.dock',
      id: 'universal-attachments-dock',
      order: 30,
      locale: NS,
      inject: () => ({
        store,
        api,
      }),
    }, UploadDock))

    ctx.slots.inject('conversation.chat.node', () => {
      const entries = ctx.slots.entries('conversation.chat.node')
      const nativeUser = nativeRendererGuard(entries, 'user')
      const nativeContext = nativeRendererGuard(entries, 'context')
      const disposers: Array<() => void> = []
      if (nativeUser !== undefined) {
        disposers.push(ctx.slots.register({
          name: 'conversation.chat.node',
          key: 'user',
          priority: nativeUser.priority,
          locale: 'conversation',
        }, createAttachmentAwareUserRenderer(nativeUser.component)))
      }
      if (nativeContext !== undefined) {
        disposers.push(ctx.slots.register({
          name: 'conversation.chat.node',
          key: 'context',
          priority: nativeContext.priority,
          locale: 'conversation',
        }, createAttachmentAwareContextRenderer(nativeContext.component)))
      }
      return disposers
    })

    ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
      name: 'conversation.chat.node',
      key: 'universal-attachments',
      locale: NS,
      inject: () => ({
        resolvePreview: async (
          sessionId: string,
          root: AttachmentHistoryRoot,
        ): Promise<StoredAttachmentPreview | undefined> => {
          const service = api()
          if (service === undefined || root.kind !== 'file') return undefined
          const result = await service.issuePreview(sessionId, root.relPath)
          if (!result.ok) throw new Error(rpcText(result.error))
          if (!/^(?:image|video)\//u.test(result.value.mime)) return undefined
          return {
            url: new URL(result.value.url, location.origin).toString(),
            mime: result.value.mime,
          }
        },
        api,
        store,
      }),
    }, AttachmentNode))
  })

  ctx.effect(() => installDropzone({
    store,
    intake: (sessionId, roots, inputActions, preparationId) => intake(
      sessionId as unknown as SessionId,
      roots,
      inputActions,
      preparationId,
    ),
  }), 'dsh-universal-attachments: window drop and paste')
}
