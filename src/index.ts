import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef, ImageMediaType, SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import type { Session, SessionEvent, SessionId, UserMessage } from '@deepseek-ai/dsh-session'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-session'
import { ATTACHMENT_ONLY_DRAFT_MARKER, readAttachmentManifest } from './shared/manifest.js'
import {
  AirdropBackend,
  type PendingClaimSnapshot,
  type ReadyRootClaim,
  type ReadyRootReservation,
} from './server/backend.js'
import {
  attachClaimToHumanMessage,
  createAttachmentManifest,
  createAttachmentMessage,
  insertAttachmentMessageOnce,
} from './server/injection.js'

export * from './server/injection.js'
export * from './server/path.js'
export * from './server/range.js'
export * from './server/types.js'

export const name = 'airdrop'
export const inject = ['webServer', 'sessions', 'attachments', 'sessionController', 'agents']

const CLAIM_ACK_RETRY_BASE_MS = 250
const CLAIM_ACK_RETRY_MAX_MS = 4_000
const SUPPORTED_IMAGE_MEDIA_TYPES = new Set<ImageMediaType>([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
])
const REMOTE_METHOD_NAMES = [
  'prepareBatch',
  'beginFile',
  'listDraft',
  'listRoot',
  'listStoredRoot',
  'removeRoot',
  'clearDraft',
  'submitDraft',
  'issuePreview',
] as const
const remoteInitializers: Array<(this: AirdropGateway) => void> = []

function imageMediaType(mime: string, name: string): ImageMediaType | undefined {
  const normalized = mime.trim().toLowerCase()
  if (SUPPORTED_IMAGE_MEDIA_TYPES.has(normalized as ImageMediaType)) return normalized as ImageMediaType
  const lowerName = name.toLowerCase()
  if (lowerName.endsWith('.png')) return 'image/png'
  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) return 'image/jpeg'
  if (lowerName.endsWith('.webp')) return 'image/webp'
  if (lowerName.endsWith('.gif')) return 'image/gif'
  return undefined
}

function firstClaimedHumanMessage(messages: readonly UserMessage[], claimedMessages: readonly UserMessage[]): UserMessage | undefined {
  const claimedIds = new Set(
    claimedMessages
      .filter(message => message.role === 'user' && message.source.kind === 'user')
      .map(message => message.id),
  )
  return messages.find(message => claimedIds.has(message.id) && message.source.kind === 'user')
}

interface AgentLike {
  readonly id: SessionId
  readonly session: Session
  readonly inbox: {
    readonly nextTurn: readonly UserMessage[]
    readonly nextStep: readonly UserMessage[]
  }
  readonly status: 'idle' | 'running'
  whenIdle(): Promise<void>
}

interface AgentRegistryFace {
  get(id: SessionId): AgentLike | undefined
  list(): AgentLike[]
}

function agentIsRunning(agent: AgentLike): boolean {
  return agent.status === 'running'
}


/**
 * The in-process Session command surface that replaced the removed `apiProxy`
 * service in dsh 0.1.2: `dsh-api-session-controller` registers the
 * `sessionController` Context service, and its `prompt` admits one browser
 * prompt after Agent resume and image validation.
 */
interface SessionPromptFace {
  readonly requestId: string
  readonly sessionId: string
  readonly mode: 'queue' | 'steer'
  readonly content: readonly [{ readonly type: 'text'; readonly text: string }]
}

interface SessionControllerFace {
  prompt(request: SessionPromptFace, signal?: AbortSignal): Promise<{ readonly accepted: true }>
}

interface SavedClaimImages {
  readonly attachments: readonly ImageAttachmentRef[]
  readonly rootIds: ReadonlySet<string>
}

interface InboxClaimReservation {
  readonly key: string
  readonly agent: AgentLike
  message: UserMessage
  readonly rpcId: string
  readonly cwd: string
  readonly sessionId: string
  readonly reservation: ReadyRootReservation
  readonly settled: Promise<void>
  readonly resolveSettled: () => void
  running?: Promise<void>
}

type PreStepDecision =
  | { readonly kind: 'reject' }
  | { readonly kind: 'enter'; readonly messages: UserMessage[] }

interface PreStepPayload {
  readonly agent: AgentLike
  readonly messages: UserMessage[]
  readonly turn: number
  readonly step: number
  readonly signal: AbortSignal
}

type RegisterPreStep = (
  event: 'agent/pre-step',
  listener: (payload: PreStepPayload, next: () => Promise<PreStepDecision>) => Promise<PreStepDecision>,
) => () => void

interface InboxEventPayload {
  readonly agent: AgentLike
  readonly message: UserMessage
}

type RegisterInboxEvent = (
  event: 'agent/inbox/inserted' | 'agent/inbox/discarded',
  listener: (payload: InboxEventPayload) => void,
) => () => void

type RegisterAgentCreated = (
  event: 'agent/created',
  listener: (payload: { readonly agent: AgentLike }) => void,
) => () => void

type RegisterAgentStatus = (
  event: 'agent/status',
  listener: (payload: { readonly agent: AgentLike; readonly status: 'idle' | 'running' }) => void,
) => () => void

function messageRpcId(message: UserMessage): string | undefined {
  if (message.source.kind !== 'user') return undefined
  const rpcId = (message.source as typeof message.source & { readonly rpcId?: unknown }).rpcId
  return typeof rpcId === 'string' ? rpcId : undefined
}

function isAttachmentOnlyPrompt(message: UserMessage): boolean {
  if (message.source.kind !== 'user') return false
  let foundMarker = false
  for (const block of message.content) {
    if (block.type !== 'text') return false
    if (block.text.includes(ATTACHMENT_ONLY_DRAFT_MARKER)) foundMarker = true
    if (block.text.replaceAll(ATTACHMENT_ONLY_DRAFT_MARKER, '').trim() !== '') return false
  }
  return foundMarker
}

function attachmentOnlyRpcIds(messages: readonly UserMessage[]): ReadonlySet<string> {
  return new Set(messages.flatMap(message => {
    if (!isAttachmentOnlyPrompt(message)) return []
    const rpcId = messageRpcId(message)
    return rpcId === undefined ? [] : [rpcId]
  }))
}

function humanMessages(messages: readonly UserMessage[]): UserMessage[] {
  return messages.filter(message => message.role === 'user' && message.source.kind === 'user')
}

function rpcIds(messages: readonly UserMessage[]): ReadonlySet<string> {
  return new Set(messages.flatMap(message => {
    const rpcId = messageRpcId(message)
    return rpcId === undefined ? [] : [rpcId]
  }))
}

/** Preserve Inbox.claim order: all next-step steering followed by at most one next-turn item. */
function orderedClaimRpcIds(messages: readonly UserMessage[]): ReadonlySet<string> {
  const ordered = new Set<string>()
  for (const message of messages) {
    const rpcId = messageRpcId(message)
    if (rpcId !== undefined) ordered.add(rpcId)
  }
  return ordered
}

function messageIds(messages: readonly UserMessage[]): ReadonlySet<string> {
  return new Set(messages.map(message => String(message.id)))
}

function withoutAttachmentOnlyPrompts(
  base: PreStepDecision,
  markerRpcIds: ReadonlySet<string>,
): PreStepDecision {
  if (base.kind !== 'enter' || markerRpcIds.size === 0) return base
  const messages = base.messages.filter(message => {
    const rpcId = messageRpcId(message)
    if (rpcId === undefined || !markerRpcIds.has(rpcId)) return true
    if (readAttachmentManifest(message.source) !== undefined) return true
    return message.content.some(block => (
      block.type !== 'text'
      || block.text.replaceAll(ATTACHMENT_ONLY_DRAFT_MARKER, '').trim() !== ''
    ))
  })
  return messages.some(message => message.role === 'user' && message.source.kind === 'user')
    ? { kind: 'enter', messages }
    : { kind: 'reject' }
}

function sessionClaimIds(session: Session): ReadonlySet<string> {
  return new Set(session.snapshotEvents().flatMap(event => {
    if (event.type !== 'user/message' || event.data.source.kind !== 'user') return []
    const manifest = readAttachmentManifest(event.data.source)
    return manifest === undefined ? [] : [manifest.batchId]
  }))
}

export class AirdropGateway extends TypertRemoteService {
  static inject = ['webServer', 'sessions', 'attachments', 'sessionController', 'agents']

  private readonly backend = new AirdropBackend()
  private readonly ackJobs = new Set<string>()
  private readonly ackRetries = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly ackAttempts = new Map<string, number>()
  private readonly discardReleaseTokens = new Map<string, symbol>()
  private readonly inboxClaimReservations = new Map<string, InboxClaimReservation>()
  private readonly reconcileJobs = new Set<string>()
  private readonly reconcileReruns = new Set<string>()
  private readonly reconcileRetries = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly reconcileAttempts = new Map<string, number>()
  private disposed = false

  constructor(ctx: Context) {
    super(ctx, 'airdrop')
    for (const initialize of remoteInitializers) initialize.call(this)
    ctx.effect(
      () => ctx.webServer.register({
        kind: 'prefix',
        path: this.backend.prefix,
        handler: (req, res) => this.backend.handleHttp(req, res),
      }),
      'airdrop HTTP routes',
    )
    ctx.effect(
      () => ctx.on('session/event', (session, event) => { this.observeClaimEvent(session, event) }),
      'airdrop committed-message observer',
    )
    ctx.effect(
      () => ctx.on('session/created', session => {
        for (const event of session.snapshotEvents()) this.observeClaimEvent(session, event)
      }),
      'airdrop recovery observer',
    )
    const registerInboxEvent = ctx.on as unknown as RegisterInboxEvent
    ctx.effect(
      () => registerInboxEvent.call(ctx, 'agent/inbox/inserted', ({ agent, message }) => {
        this.observeInboxInserted(agent, message)
      }),
      'airdrop inbox replacement observer',
    )
    ctx.effect(
      () => registerInboxEvent.call(ctx, 'agent/inbox/discarded', ({ agent, message }) => {
        this.scheduleDiscardRelease(agent, message)
      }),
      'airdrop inbox discard observer',
    )
    const registerAgentCreated = ctx.on as unknown as RegisterAgentCreated
    ctx.effect(
      () => registerAgentCreated.call(ctx, 'agent/created', ({ agent }) => {
        this.scheduleAgentReconcile(agent)
      }),
      'airdrop live-agent recovery observer',
    )
    const registerAgentStatus = ctx.on as unknown as RegisterAgentStatus
    ctx.effect(
      () => registerAgentStatus.call(ctx, 'agent/status', ({ agent, status }) => {
        if (status === 'idle') this.scheduleAgentReconcile(agent)
      }),
      'airdrop idle reconciliation observer',
    )
    ctx.effect(
      () => () => {
        this.disposed = true
        for (const timer of this.ackRetries.values()) clearTimeout(timer)
        this.ackRetries.clear()
        this.ackAttempts.clear()
        this.discardReleaseTokens.clear()
        for (const reservation of this.inboxClaimReservations.values()) reservation.resolveSettled()
        this.inboxClaimReservations.clear()
        for (const timer of this.reconcileRetries.values()) clearTimeout(timer)
        this.reconcileRetries.clear()
        this.reconcileAttempts.clear()
        this.reconcileReruns.clear()
      },
      'airdrop claim acknowledgement retries',
    )
    for (const session of ctx.sessions.list()) {
      for (const event of session.snapshotEvents()) this.observeClaimEvent(session, event)
    }
    const agents = (ctx as unknown as { readonly agents: AgentRegistryFace }).agents
    for (const agent of agents.list()) this.scheduleAgentReconcile(agent)
    const on = ctx.on as unknown as RegisterPreStep
    ctx.effect(
      () => on.call(ctx, 'agent/pre-step', async (payload, next) => {
        const payloadUsers = humanMessages(payload.messages)
        const allRpcIds = rpcIds(payloadUsers)
        const markerRpcIds = attachmentOnlyRpcIds(payloadUsers)
        try {
          await this.recoverInboxClaimReservations(payload.agent, payloadUsers)
        } catch (error: unknown) {
          this.ctx.logger.warn(
            `airdrop: inbox claim reservation recovery failed: ${error instanceof Error ? error.message : String(error)}`,
          )
          this.scheduleAgentReconcile(payload.agent)
        }
        const allReservationsWait = this.awaitInboxClaimReservations(payload.agent, payloadUsers, payload.signal)
        const sessionId = String(payload.agent.session.id)
        const cwd = payload.agent.session.header.cwd
        const releaseRpcIds = async (ids: ReadonlySet<string>): Promise<void> => {
          if (cwd === undefined || cwd.length === 0 || ids.size === 0) return
          try {
            await this.backend.releaseClaimForRpcIds(cwd, sessionId, ids)
          } catch (error: unknown) {
            this.ctx.logger.warn(
              `airdrop: matched claim release failed: ${error instanceof Error ? error.message : String(error)}`,
            )
            this.scheduleAgentReconcile(payload.agent)
          }
        }
        const releaseMatched = (): Promise<void> => releaseRpcIds(allRpcIds)
        const releaseClaim = async (claimId: string): Promise<void> => {
          if (cwd === undefined || cwd.length === 0) return
          try {
            await this.backend.releaseClaim(cwd, sessionId, claimId)
          } catch (error: unknown) {
            this.ctx.logger.warn(
              `airdrop: claim release failed: ${error instanceof Error ? error.message : String(error)}`,
            )
            this.scheduleAgentReconcile(payload.agent)
          }
        }
        const releaseClaims = async (claims: readonly ReadyRootClaim[]): Promise<void> => {
          for (const claim of claims) await releaseClaim(claim.claimId)
        }
        let base: PreStepDecision
        try {
          base = await next()
        } catch (error: unknown) {
          this.cancelInboxClaimReservations(payload.agent, payloadUsers)
          await allReservationsWait
          await releaseMatched()
          throw error
        }
        if (base.kind !== 'enter') {
          this.cancelInboxClaimReservations(payload.agent, payloadUsers)
          await allReservationsWait
          await releaseMatched()
          return base
        }
        const enteredIds = messageIds(humanMessages(base.messages))
        const enteredPayloadUsers = payloadUsers.filter(message => enteredIds.has(String(message.id)))
        const enteredRpcIds = rpcIds(enteredPayloadUsers)
        const droppedPayloadUsers = payloadUsers.filter(message => !enteredIds.has(String(message.id)))
        const droppedRpcIds = new Set([...allRpcIds].filter(rpcId => !enteredRpcIds.has(rpcId)))
        this.cancelInboxClaimReservations(payload.agent, droppedPayloadUsers)
        await releaseRpcIds(droppedRpcIds)
        await this.awaitInboxClaimReservations(payload.agent, enteredPayloadUsers, payload.signal)
        if (payload.signal.aborted) {
          await releaseMatched()
          return withoutAttachmentOnlyPrompts(base, markerRpcIds)
        }
        if (cwd === undefined || cwd.length === 0) {
          await releaseMatched()
          return withoutAttachmentOnlyPrompts(base, markerRpcIds)
        }
        if (enteredPayloadUsers.length === 0) {
          await releaseMatched()
          return withoutAttachmentOnlyPrompts(base, markerRpcIds)
        }
        let claims: readonly ReadyRootClaim[] = []
        let releasableClaims: readonly ReadyRootClaim[] = []
        try {
          claims = await this.backend.getReadyClaimsForRpcIds(
            cwd,
            sessionId,
            orderedClaimRpcIds(enteredPayloadUsers),
          )
          if (claims.length === 0) {
            return withoutAttachmentOnlyPrompts(base, markerRpcIds)
          }
          const committedClaimIds = sessionClaimIds(payload.agent.session)
          const activeClaims = claims.filter(claim => {
            if (!committedClaimIds.has(claim.claimId)) return true
            this.scheduleClaimAck(payload.agent.session, claim.claimId)
            return false
          })
          releasableClaims = activeClaims
          if (activeClaims.length === 0) {
            return withoutAttachmentOnlyPrompts(base, markerRpcIds)
          }
          if (payload.signal.aborted) {
            await releaseClaims(activeClaims)
            return withoutAttachmentOnlyPrompts(base, markerRpcIds)
          }
          let messages = base.messages
          for (let index = 0; index < activeClaims.length; index += 1) {
            const activeClaim = activeClaims[index]
            if (activeClaim === undefined) continue
            if (payload.signal.aborted) {
              await releaseClaims(activeClaims)
              return withoutAttachmentOnlyPrompts(base, markerRpcIds)
            }
            const claimedUsers = activeClaim.rpcId === undefined
              ? enteredPayloadUsers.slice(-1)
              : enteredPayloadUsers.filter(message => messageRpcId(message) === activeClaim.rpcId)
            const target = firstClaimedHumanMessage(messages, claimedUsers)
            if (target === undefined) {
              await releaseClaim(activeClaim.claimId)
              continue
            }
            let savedImages: SavedClaimImages = { attachments: [], rootIds: new Set() }
            try {
              savedImages = await this.saveClaimImages(cwd, sessionId, activeClaim, target, payload.signal)
            } catch (error: unknown) {
              this.ctx.logger.warn(`airdrop: native image persistence failed: ${error instanceof Error ? error.message : String(error)}`)
            }
            if (payload.signal.aborted) {
              await releaseClaims(activeClaims)
              return withoutAttachmentOnlyPrompts(base, markerRpcIds)
            }
            const attachment = createAttachmentMessage(activeClaim.claimId, activeClaim.roots)
            const manifest = createAttachmentManifest(activeClaim.claimId, activeClaim.roots, savedImages.rootIds)
            const withClaim = attachClaimToHumanMessage(
              messages,
              claimedUsers,
              manifest,
              savedImages.attachments,
            )
            if (!withClaim.attached) {
              await releaseClaim(activeClaim.claimId)
              continue
            }
            const merged = insertAttachmentMessageOnce(
              withClaim.messages,
              claimedUsers,
              attachment,
              activeClaim.claimId,
            )
            messages = merged.messages
          }
          return withoutAttachmentOnlyPrompts({ kind: 'enter', messages }, markerRpcIds)
        } catch (error: unknown) {
          if (releasableClaims.length > 0) await releaseClaims(releasableClaims)
          else await releaseMatched()
          this.ctx.logger.warn(`airdrop: pre-step injection failed: ${error instanceof Error ? error.message : String(error)}`)
          return withoutAttachmentOnlyPrompts(base, markerRpcIds)
        }
      }),
      'airdrop pre-step injection',
    )
  }

  private async saveClaimImages(
    cwd: string,
    sessionId: string,
    claim: ReadyRootClaim,
    target: UserMessage,
    signal: AbortSignal,
  ): Promise<SavedClaimImages> {
    const limits = this.ctx.attachments.imageLimits
    const existing = target.content.filter(block => block.type === 'image')
    let imageCount = existing.length
    let totalBytes = existing.reduce((sum, block) => sum + block.attachment.bytes, 0)
    const prepared: Array<{ readonly rootId: string; readonly input: SaveImageAttachment }> = []

    for (const root of claim.roots) {
      if (root.kind !== 'file' || signal.aborted || imageCount >= limits.maxImagesPerMessage) continue
      const entry = root.entries[0]
      if (entry === undefined) continue
      const mediaType = imageMediaType(entry.mime, entry.name)
      if (mediaType === undefined || !limits.mediaTypes.includes(mediaType)) continue
      if (entry.size > limits.maxImageBytes || totalBytes + entry.size > limits.maxMessageImageBytes) continue
      try {
        const file = await this.backend.readClaimFile(cwd, sessionId, claim.claimId, root.rootId, entry.entryId)
        const input: SaveImageAttachment = { data: file.data, mediaType, name: file.name }
        await this.ctx.attachments.validateImage(input)
        prepared.push({ rootId: root.rootId, input })
        imageCount += 1
        totalBytes += file.data.byteLength
      } catch (error: unknown) {
        this.ctx.logger.warn(
          `airdrop: skipped native image ${entry.name}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
      if (signal.aborted || imageCount >= limits.maxImagesPerMessage) break
    }

    if (signal.aborted) return { attachments: [], rootIds: new Set() }
    const refs: ImageAttachmentRef[] = []
    const rootIds = new Set<string>()
    for (const candidate of prepared) {
      if (signal.aborted) break
      try {
        refs.push(await this.ctx.attachments.saveImage(candidate.input))
        rootIds.add(candidate.rootId)
      } catch (error: unknown) {
        this.ctx.logger.warn(
          `airdrop: failed to save native image ${candidate.input.name ?? '(unnamed)'}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    return { attachments: refs, rootIds }
  }

  private inboxReleaseKey(agent: AgentLike, rpcId: string): string {
    return `${String(agent.id)}:${rpcId}`
  }

  private settleInboxClaimReservation(reservation: InboxClaimReservation): void {
    if (this.inboxClaimReservations.get(reservation.key) === reservation) {
      this.inboxClaimReservations.delete(reservation.key)
    }
    reservation.resolveSettled()
    if (!this.disposed && [...this.inboxClaimReservations.values()].some(candidate => candidate.agent === reservation.agent)) {
      this.scheduleAgentReconcile(reservation.agent)
    }
  }

  private createInboxClaimReservation(
    agent: AgentLike,
    message: UserMessage,
    rpcId: string,
    cwd: string,
    sessionId: string,
    reservation: ReadyRootReservation,
  ): InboxClaimReservation {
    const key = this.inboxReleaseKey(agent, rpcId)
    let resolveSettled!: () => void
    const settled = new Promise<void>(resolve => { resolveSettled = resolve })
    return {
      key,
      agent,
      message,
      rpcId,
      cwd,
      sessionId,
      reservation,
      settled,
      resolveSettled,
    }
  }

  private async recoverInboxClaimReservations(agent: AgentLike, messages: readonly UserMessage[]): Promise<void> {
    const missing = messages.flatMap(message => {
      const rpcId = messageRpcId(message)
      if (rpcId === undefined || this.inboxClaimReservations.has(this.inboxReleaseKey(agent, rpcId))) return []
      return [{ message, rpcId }]
    })
    if (missing.length === 0) return
    const cwd = agent.session.header.cwd
    if (cwd === undefined || cwd.length === 0) return
    const sessionId = String(agent.id)
    const pending = await this.backend.getPendingClaims(cwd, sessionId)
    const byRpcId = new Map(pending.flatMap(claim => (
      claim.rpcId === undefined ? [] : [[claim.rpcId, claim] as const]
    )))
    let recovered = false
    for (const { message, rpcId } of missing) {
      const key = this.inboxReleaseKey(agent, rpcId)
      if (this.inboxClaimReservations.has(key)) continue
      const claim: PendingClaimSnapshot | undefined = byRpcId.get(rpcId)
      if (claim === undefined) continue
      this.inboxClaimReservations.set(key, this.createInboxClaimReservation(
        agent,
        message,
        rpcId,
        cwd,
        sessionId,
        this.backend.recoverReadyRootReservation(claim.draftId, claim.rootIds),
      ))
      recovered = true
    }
    if (recovered) this.scheduleAgentReconcile(agent)
  }

  private cancelInboxClaimReservations(agent: AgentLike, messages: readonly UserMessage[]): void {
    for (const rpcId of orderedClaimRpcIds(messages)) {
      const reservation = this.inboxClaimReservations.get(this.inboxReleaseKey(agent, rpcId))
      if (reservation?.agent === agent) this.settleInboxClaimReservation(reservation)
    }
  }

  private async awaitInboxClaimReservations(
    agent: AgentLike,
    messages: readonly UserMessage[],
    signal: AbortSignal,
  ): Promise<boolean> {
    const reservations = [...orderedClaimRpcIds(messages)].flatMap(rpcId => {
      const reservation = this.inboxClaimReservations.get(this.inboxReleaseKey(agent, rpcId))
      return reservation?.agent === agent ? [reservation] : []
    })
    if (reservations.length === 0) return !signal.aborted
    if (signal.aborted) {
      for (const reservation of reservations) this.settleInboxClaimReservation(reservation)
      return false
    }
    return new Promise<boolean>(resolve => {
      let finished = false
      const finish = (ready: boolean): void => {
        if (finished) return
        finished = true
        signal.removeEventListener('abort', onAbort)
        resolve(ready)
      }
      const onAbort = (): void => {
        for (const reservation of reservations) this.settleInboxClaimReservation(reservation)
        finish(false)
      }
      signal.addEventListener('abort', onAbort, { once: true })
      void Promise.all(reservations.map(reservation => reservation.settled)).then(() => { finish(true) })
    })
  }

  private async releaseLateInboxClaim(
    reservation: InboxClaimReservation,
    claim: ReadyRootClaim,
  ): Promise<void> {
    try {
      const released = await this.backend.releaseClaim(
        reservation.cwd,
        reservation.sessionId,
        claim.claimId,
        reservation.rpcId,
      )
      if (!released) this.scheduleAgentReconcile(reservation.agent)
    } catch (error: unknown) {
      this.ctx.logger.warn(
        `airdrop: late inbox claim release failed: ${error instanceof Error ? error.message : String(error)}`,
      )
      this.scheduleAgentReconcile(reservation.agent)
    }
  }

  private async releaseLateInboxReservation(reservation: InboxClaimReservation): Promise<void> {
    try {
      await this.backend.releaseClaimForRpcId(
        reservation.cwd,
        reservation.sessionId,
        reservation.rpcId,
      )
    } catch (error: unknown) {
      this.ctx.logger.warn(
        `airdrop: late inbox reservation release failed: ${error instanceof Error ? error.message : String(error)}`,
      )
      this.scheduleAgentReconcile(reservation.agent)
    }
  }

  private reserveInboxClaim(reservation: InboxClaimReservation): Promise<void> {
    if (reservation.running !== undefined) return reservation.running
    const attempt = (async () => {
      let claim: ReadyRootClaim | null
      try {
        claim = await this.backend.reserveReadyRootsForRpcId(
          reservation.cwd,
          reservation.sessionId,
          reservation.rpcId,
          reservation.reservation,
        )
      } catch (error: unknown) {
        if (this.inboxClaimReservations.get(reservation.key) !== reservation || this.disposed) {
          await this.releaseLateInboxReservation(reservation)
          return
        }
        throw error
      }
      if (this.inboxClaimReservations.get(reservation.key) !== reservation) {
        if (claim !== null) await this.releaseLateInboxClaim(reservation, claim)
        return
      }
      if (this.disposed) return
      if (claim === null) {
        this.settleInboxClaimReservation(reservation)
        return
      }
      const stillPending = [...reservation.agent.inbox.nextStep, ...reservation.agent.inbox.nextTurn]
        .some(candidate => candidate === reservation.message || (
          candidate.id === reservation.message.id && messageRpcId(candidate) === reservation.rpcId
        ))
      if (stillPending) {
        this.settleInboxClaimReservation(reservation)
        return
      }
      if (sessionClaimIds(reservation.agent.session).has(claim.claimId)) {
        this.scheduleClaimAck(reservation.agent.session, claim.claimId)
        this.settleInboxClaimReservation(reservation)
        return
      }
      if (reservation.agent.status === 'running') {
        this.settleInboxClaimReservation(reservation)
        this.scheduleAgentReconcile(reservation.agent)
        return
      }
      await this.releaseLateInboxClaim(reservation, claim)
      this.settleInboxClaimReservation(reservation)
    })()
    let tracked!: Promise<void>
    tracked = attempt.finally(() => {
      if (reservation.running === tracked) delete reservation.running
    })
    reservation.running = tracked
    return tracked
  }

  private async retryInboxClaimReservations(agent: AgentLike): Promise<void> {
    let firstError: unknown
    for (const reservation of [...this.inboxClaimReservations.values()]) {
      if (reservation.agent !== agent) continue
      try {
        await this.reserveInboxClaim(reservation)
      } catch (error: unknown) {
        if (this.inboxClaimReservations.get(reservation.key) === reservation && firstError === undefined) {
          firstError = error
        }
      }
    }
    if (firstError !== undefined) throw firstError
  }

  private observeInboxInserted(agent: AgentLike, message: UserMessage): void {
    const rpcId = messageRpcId(message)
    if (rpcId === undefined) return
    const key = this.inboxReleaseKey(agent, rpcId)
    const existing = this.inboxClaimReservations.get(key)
    if (this.discardReleaseTokens.delete(key)) {
      if (existing?.agent === agent) existing.message = message
      return
    }
    if (existing !== undefined) {
      if (existing.agent === agent) {
        existing.message = message
        return
      }
      this.settleInboxClaimReservation(existing)
    }
    const cwd = agent.session.header.cwd
    if (cwd === undefined || cwd.length === 0) return
    const sessionId = String(agent.id)
    const reservation = this.createInboxClaimReservation(
      agent,
      message,
      rpcId,
      cwd,
      sessionId,
      this.backend.createReadyRootReservation(),
    )
    this.inboxClaimReservations.set(key, reservation)
    this.scheduleAgentReconcile(agent)
  }

  private scheduleDiscardRelease(agent: AgentLike, message: UserMessage): void {
    const rpcId = messageRpcId(message)
    if (rpcId === undefined) return
    const key = this.inboxReleaseKey(agent, rpcId)
    const token = Symbol('discard-release')
    this.discardReleaseTokens.set(key, token)
    queueMicrotask(() => {
      if (this.disposed || this.discardReleaseTokens.get(key) !== token) return
      this.discardReleaseTokens.delete(key)
      const reservation = this.inboxClaimReservations.get(key)
      if (reservation?.agent === agent) this.settleInboxClaimReservation(reservation)
      const cwd = agent.session.header.cwd
      if (cwd === undefined || cwd.length === 0) return
      void this.backend.releaseClaimForRpcId(cwd, String(agent.id), rpcId).catch((error: unknown) => {
        this.ctx.logger.warn(
          `airdrop: discarded inbox claim release failed: ${error instanceof Error ? error.message : String(error)}`,
        )
        this.scheduleAgentReconcile(agent)
      })
    })
  }

  private scheduleAgentReconcile(agent: AgentLike): void {
    const key = String(agent.id)
    if (this.disposed) return
    const pendingRetry = this.reconcileRetries.get(key)
    if (pendingRetry !== undefined) {
      clearTimeout(pendingRetry)
      this.reconcileRetries.delete(key)
    }
    if (this.reconcileJobs.has(key)) {
      this.reconcileReruns.add(key)
      return
    }
    this.reconcileJobs.add(key)
    queueMicrotask(() => {
      void (async () => {
        let retry = false
        try {
          await this.reconcileAgent(agent)
          this.reconcileAttempts.delete(key)
        } catch (error: unknown) {
          const attempt = (this.reconcileAttempts.get(key) ?? 0) + 1
          const agents = (this.ctx as unknown as { readonly agents: AgentRegistryFace }).agents
          retry = !this.disposed && agents.get(agent.id) === agent
          if (retry) this.reconcileAttempts.set(key, attempt)
          else this.reconcileAttempts.delete(key)
          this.ctx.logger.warn(
            `airdrop: pending claim reconciliation failed: ${error instanceof Error ? error.message : String(error)}${retry ? `; retry ${attempt} scheduled` : ''}`,
          )
        } finally {
          this.reconcileJobs.delete(key)
          if (this.reconcileReruns.delete(key)) this.scheduleAgentReconcile(agent)
          else if (retry) this.scheduleAgentReconcileRetry(agent, key)
        }
      })()
    })
  }

  private scheduleAgentReconcileRetry(agent: AgentLike, key: string): void {
    if (this.disposed || this.reconcileJobs.has(key) || this.reconcileRetries.has(key)) return
    const attempt = this.reconcileAttempts.get(key) ?? 1
    const delay = Math.min(CLAIM_ACK_RETRY_BASE_MS * (2 ** (attempt - 1)), CLAIM_ACK_RETRY_MAX_MS)
    const timer = setTimeout(() => {
      this.reconcileRetries.delete(key)
      this.scheduleAgentReconcile(agent)
    }, delay)
    timer.unref?.()
    this.reconcileRetries.set(key, timer)
  }

  private async reconcileAgent(agent: AgentLike): Promise<void> {
    const cwd = agent.session.header.cwd
    if (cwd === undefined || cwd.length === 0) return
    const sessionId = String(agent.id)
    const agents = (this.ctx as unknown as { readonly agents: AgentRegistryFace }).agents
    for (;;) {
      if (this.disposed || agents.get(agent.id) !== agent) return
      await this.retryInboxClaimReservations(agent)
      if (agent.status === 'running') return
      if (this.disposed || agents.get(agent.id) !== agent) return
      const pendingClaims = await this.backend.getPendingClaims(cwd, sessionId)
      if (pendingClaims.length === 0) return
      const committed = sessionClaimIds(agent.session)
      for (const pending of pendingClaims) {
        if (committed.has(pending.claimId)) this.scheduleClaimAck(agent.session, pending.claimId)
      }
      const pendingMessages = [...agent.inbox.nextStep, ...agent.inbox.nextTurn]
      if (agentIsRunning(agent)) continue
      const liveRpcIds = rpcIds(pendingMessages)
      let stale = false
      let releasedOne = false
      for (const pending of pendingClaims) {
        if (committed.has(pending.claimId)) continue
        if (pending.rpcId !== undefined && liveRpcIds.has(pending.rpcId)) continue
        if (agentIsRunning(agent)) {
          stale = true
          break
        }
        const released = await this.backend.releaseClaim(cwd, sessionId, pending.claimId, pending.rpcId)
        if (!released) {
          stale = true
          break
        }
        releasedOne = true
        break
      }
      if (stale || releasedOne) continue
      return
    }
  }

  private observeClaimEvent(session: Session, event: SessionEvent): void {
    if (event.type !== 'user/message' || event.data.source.kind !== 'user') return
    const manifest = readAttachmentManifest(event.data.source)
    if (manifest === undefined) return
    this.scheduleClaimAck(session, manifest.batchId)
  }

  private scheduleClaimAck(session: Session, claimId: string): void {
    if (this.disposed) return
    const sessionId = String(session.id)
    const key = `${sessionId}:${claimId}`
    if (this.ackJobs.has(key) || this.ackRetries.has(key)) return
    this.ackJobs.add(key)
    queueMicrotask(() => {
      void (async () => {
        let retry = false
        try {
          if (this.disposed) return
          const durable = await this.ctx.sessions.flush(session)
          if (!durable) throw new Error('No session durability listener participated')
          const cwd = session.header.cwd
          if (cwd === undefined || cwd.length === 0) return
          await this.backend.ackClaim(cwd, sessionId, claimId)
          this.ackAttempts.delete(key)
        } catch (error: unknown) {
          const attempt = (this.ackAttempts.get(key) ?? 0) + 1
          const sessionIsLive = this.ctx.sessions.get(session.id) === session
          retry = !this.disposed && sessionIsLive
          if (retry) this.ackAttempts.set(key, attempt)
          else this.ackAttempts.delete(key)
          this.ctx.logger.warn(
            `airdrop: claim acknowledgement failed: ${error instanceof Error ? error.message : String(error)}${retry ? `; retry ${attempt} scheduled` : ''}`,
          )
        } finally {
          this.ackJobs.delete(key)
          if (retry) this.scheduleClaimAckRetry(session, claimId, key)
        }
      })()
    })
  }

  private scheduleClaimAckRetry(session: Session, claimId: string, key: string): void {
    if (this.disposed || this.ackJobs.has(key) || this.ackRetries.has(key)) return
    const attempt = this.ackAttempts.get(key) ?? 1
    const delay = Math.min(CLAIM_ACK_RETRY_BASE_MS * (2 ** (attempt - 1)), CLAIM_ACK_RETRY_MAX_MS)
    const timer = setTimeout(() => {
      this.ackRetries.delete(key)
      this.scheduleClaimAck(session, claimId)
    }, delay)
    timer.unref?.()
    this.ackRetries.set(key, timer)
  }

  private cwdFor(sessionId: string): string {
    const session = this.ctx.sessions.get(sessionId as SessionId)
    if (session === undefined) throw new Error('Session not found')
    const cwd = session.header.cwd
    if (cwd === undefined || cwd.length === 0) throw new Error('The session has no cwd')
    return cwd
  }

  async prepareBatch(sessionId: string, rootsJson: string) {
    return this.backend.prepareBatch(this.cwdFor(sessionId), sessionId, rootsJson)
  }

  async beginFile(
    sessionId: string,
    draftId: string,
    rootId: string,
    relativePath: string,
    name: string,
    size: number,
    mime: string,
    lastModified: number,
  ) {
    return this.backend.beginFile(
      this.cwdFor(sessionId),
      sessionId,
      draftId,
      rootId,
      relativePath,
      name,
      size,
      mime,
      lastModified,
    )
  }

  async listDraft(sessionId: string) {
    return this.backend.listDraft(this.cwdFor(sessionId), sessionId)
  }

  async listRoot(sessionId: string, draftId: string, rootId: string) {
    return this.backend.listRoot(this.cwdFor(sessionId), sessionId, draftId, rootId)
  }

  async listStoredRoot(sessionId: string, rootId: string) {
    return this.backend.listStoredRoot(this.cwdFor(sessionId), sessionId, rootId)
  }

  async removeRoot(sessionId: string, draftId: string, rootId: string) {
    return this.backend.removeRoot(this.cwdFor(sessionId), sessionId, draftId, rootId)
  }

  async clearDraft(sessionId: string, draftId: string) {
    return this.backend.clearDraft(this.cwdFor(sessionId), sessionId, draftId)
  }

  async submitDraft(sessionId: string, draftId: string) {
    const cwd = this.cwdFor(sessionId)
    const rpcId = randomUUID()
    const claim = await this.backend.reserveReadyDraft(cwd, sessionId, draftId, rpcId)
    try {
      // dsh 0.1.2 removed `apiProxy`; `sessionController` owns in-process prompt admission.
      const { sessionController } = this.ctx as unknown as { readonly sessionController: SessionControllerFace }
      await sessionController.prompt({
        requestId: rpcId,
        sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: ATTACHMENT_ONLY_DRAFT_MARKER }],
      })
      return { accepted: true as const, rootIds: claim.roots.map(root => root.rootId) }
    } catch (error: unknown) {
      try {
        await this.backend.releaseClaim(cwd, sessionId, claim.claimId, rpcId)
      } catch (releaseError: unknown) {
        this.ctx.logger.warn(
          `airdrop: rejected submission claim release failed: ${releaseError instanceof Error ? releaseError.message : String(releaseError)}`,
        )
        const agents = (this.ctx as unknown as { readonly agents: AgentRegistryFace }).agents
        const agent = agents.get(sessionId as SessionId)
        if (agent !== undefined) this.scheduleAgentReconcile(agent)
      }
      throw error
    }
  }

  async issuePreview(sessionId: string, relPath: string) {
    return this.backend.issuePreview(this.cwdFor(sessionId), sessionId, relPath)
  }
}

type GatewayRemoteMethod = (this: AirdropGateway, ...args: unknown[]) => unknown

for (const methodName of REMOTE_METHOD_NAMES) {
  const implementation = Reflect.get(AirdropGateway.prototype, methodName)
  if (typeof implementation !== 'function') throw new Error(`Missing Remote method: ${methodName}`)
  Remote(
    implementation as GatewayRemoteMethod,
    {
      kind: 'method',
      name: methodName,
      static: false,
      private: false,
      addInitializer(initializer: (this: AirdropGateway) => void) {
        remoteInitializers.push(initializer)
      },
    } as unknown as ClassMethodDecoratorContext<AirdropGateway, GatewayRemoteMethod>,
  )
}

const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const status = z.enum(['uploading', 'ready', 'error'])
const rootSummarySchema = z.object({
  rootId: z.string(),
  name: z.string(),
  kind: z.enum(['file', 'folder']),
  relPath: z.string(),
  fileCount: integer,
  totalSize: integer,
  completedFiles: integer,
  completedSize: integer,
  status,
  error: z.string().optional(),
}).strict()
const entrySchema = z.object({
  entryId: z.string(),
  relativePath: z.string(),
  name: z.string(),
  size: integer,
  mime: z.string(),
  received: integer,
  status,
  relPath: z.string().optional(),
  error: z.string().optional(),
}).strict()
const resultSchemas = {
  prepareBatch: z.object({
    draftId: z.string(),
    chunkSize: integer,
    roots: z.array(z.object({ clientKey: z.string(), rootId: z.string(), relPath: z.string() }).strict()),
  }).strict(),
  beginFile: z.object({
    uploadId: z.string(),
    uploadUrl: z.string(),
    ticket: z.string(),
    offset: integer,
    chunkSize: integer,
  }).strict(),
  listDraft: z.object({
    draft: z.object({ draftId: z.string(), roots: z.array(rootSummarySchema) }).strict().nullable(),
  }).strict(),
  listRoot: z.object({ root: rootSummarySchema.extend({ entries: z.array(entrySchema) }).strict() }).strict(),
  removed: z.object({ removed: z.boolean() }).strict(),
  submitted: z.object({ accepted: z.literal(true), rootIds: z.array(z.string()) }).strict(),
  preview: z.object({ url: z.string(), name: z.string(), mime: z.string(), size: integer }).strict(),
} as const

function parameter(name: string, schema: z.ZodType, symbol = name) {
  return {
    name,
    wire: name,
    source: 'json' as const,
    codec: {
      mode: 'strict' as const,
      typeSymbol: `dsh-airdrop#${symbol}`,
      schema,
    },
  }
}

function invocation(method: string, parameters: readonly ReturnType<typeof parameter>[], schema: z.ZodType, resultSymbol: string) {
  return {
    id: `dsh-airdrop#airdrop/${method}`,
    service: 'airdrop',
    namespace: 'airdrop',
    method,
    invocation: { kind: 'direct' as const },
    parameters,
    result: {
      mode: 'strict' as const,
      typeSymbol: `dsh-airdrop#${resultSymbol}`,
      schema,
    },
  }
}

const session = () => parameter('sessionId', z.string(), 'SessionId')
const draft = () => parameter('draftId', z.string(), 'DraftId')
const root = () => parameter('rootId', z.string(), 'RootId')

export const TYPERT_MANIFEST = {
  package: 'dsh-airdrop',
  face: 'host',
  schemas: [],
  invocations: [
    invocation('prepareBatch', [session(), parameter('rootsJson', z.string(), 'RootsJson')], resultSchemas.prepareBatch, 'PrepareBatchResult'),
    invocation('beginFile', [
      session(),
      draft(),
      root(),
      parameter('relativePath', z.string(), 'RelativePath'),
      parameter('name', z.string(), 'Name'),
      parameter('size', integer, 'Size'),
      parameter('mime', z.string(), 'Mime'),
      parameter('lastModified', integer, 'LastModified'),
    ], resultSchemas.beginFile, 'BeginFileResult'),
    invocation('listDraft', [session()], resultSchemas.listDraft, 'ListDraftResult'),
    invocation('listRoot', [session(), draft(), root()], resultSchemas.listRoot, 'ListRootResult'),
    invocation('listStoredRoot', [session(), root()], resultSchemas.listRoot, 'ListStoredRootResult'),
    invocation('removeRoot', [session(), draft(), root()], resultSchemas.removed, 'RemovedResult'),
    invocation('clearDraft', [session(), draft()], resultSchemas.removed, 'RemovedResult'),
    invocation('submitDraft', [session(), draft()], resultSchemas.submitted, 'SubmitDraftResult'),
    invocation('issuePreview', [session(), parameter('relPath', z.string(), 'RelPath')], resultSchemas.preview, 'PreviewResult'),
  ],
  model: { services: [], events: [], objects: [] },
} as const

/** Alias required by the DSH `./typert` host-face loader. */
export const TYPERT = TYPERT_MANIFEST

export default AirdropGateway
