import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SessionId } from '@deepseek-ai/dsh-session'
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
import { createUploadStore, type InputActionsFace, type UploadStore } from './store.js'
import { installStyles } from './styles.js'
import type { RemoteFace, AirdropCalls } from './types.js'
import { UploadDock } from './UploadDock.js'

interface LocaleServiceFace {
  register(namespace: string, dictionaries: Record<string, Record<string, string>>): unknown
  bind(namespace: string): (key: string, params?: Record<string, unknown>) => string
}

const REMOTE_MOUNT_TIMEOUT_MS = 10_000

export { AttachButton } from './AttachButton.js'
export { rootsFromDrop, rootsFromFiles } from './files.js'
export { runIntake } from './intake.js'

export const inject = ['slots', 'sessions', 'locale', 'uiConversation', 'remote']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => installStyles(), 'dsh-airdrop: styles')
  const store = createUploadStore()
  let disposed = false
  ctx.effect(() => () => {
    disposed = true
    store.dispose()
  }, 'dsh-airdrop: local upload state')
  void mountClient(ctx, store, () => disposed).catch(error => {
    console.error('[dsh-airdrop] Upload controls were not started.', error)
  })
}

async function mountClient(
  ctx: ClientContext,
  store: UploadStore,
  isDisposed: () => boolean,
): Promise<void> {
  const remote = (ctx as unknown as RemoteFace).remote
  let unmount: Awaited<ReturnType<typeof remote.$mount>>
  try {
    unmount = await mountRemoteDescriptors(remote)
  } catch (error) {
    console.error('[dsh-airdrop] Upload controls were not started because the DSH Remote API did not become ready.', error)
    return
  }
  if (isDisposed()) {
    await unmount()
    return
  }
  ctx.effect(() => () => { void unmount() }, 'dsh-airdrop: remote descriptors')

  let calls: AirdropCalls | undefined
  ctx.inject(['remote', 'remote.airdrop'], (remoteCtx: ClientContext): void => {
    calls = (remoteCtx as unknown as RemoteFace).remote.airdrop
  })
  const api = (): AirdropCalls | undefined => calls
  ctx.effect(
    () => ctx.uiConversation.events.register(attachmentConversationDefinition),
    'dsh-airdrop: conversation attachment nodes',
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
    }, 'dsh-airdrop: dictionaries')
    setBoundT(locale.bind(NS))

    ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
      name: 'conversation.input.left',
      id: 'airdrop',
      order: 20,
      locale: NS,
      inject: (sessionId: SessionId) => ({
        store,
        intake: (roots: readonly UploadRoot[], inputActions?: InputActionsFace) => intake(sessionId, roots, inputActions),
      }),
    }, AttachButton))

    ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
      name: 'conversation.input.dock',
      id: 'airdrop-dock',
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
      key: 'airdrop',
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
  }), 'dsh-airdrop: window drop and paste')
}

async function mountRemoteDescriptors(
  remote: RemoteFace['remote'],
): Promise<Awaited<ReturnType<RemoteFace['remote']['$mount']>>> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  let didTimeout = false
  const mounted = remote.$mount({
    package: 'dsh-airdrop',
    descriptors: buildDescriptors(),
  }).then(unmount => {
    if (!didTimeout) return unmount
    void Promise.resolve(unmount()).catch(error => {
      console.error('[dsh-airdrop] Late Remote mount cleanup failed.', error)
    })
    return new Promise<never>(() => {})
  })
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      didTimeout = true
      reject(new Error(`dsh-airdrop: Remote API did not mount within ${String(REMOTE_MOUNT_TIMEOUT_MS)}ms`))
    }, REMOTE_MOUNT_TIMEOUT_MS)
  })
  try {
    return await Promise.race([mounted, timeoutPromise])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}
