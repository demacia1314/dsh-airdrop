import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, UserMessage } from '@deepseek-ai/dsh-session'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DefaultGateway, { UniversalAttachmentsGateway } from '../../src/index.js'
import { attachmentBatchId } from '../../src/server/injection.js'
import { sessionHash } from '../../src/server/store.js'

type PreStepDecision =
  | { readonly kind: 'reject' }
  | { readonly kind: 'enter'; readonly messages: UserMessage[] }

interface Harness {
  readonly ctx: Context
  readonly cwd: string
  readonly sessionId: string
  readonly session: Session
  readonly events: SessionEvent[]
  readonly flush: ReturnType<typeof vi.fn<(session: Session) => Promise<boolean>>>
}

interface StartedGateway {
  readonly gateway: UniversalAttachmentsGateway
  readonly dispose: () => Promise<void>
}

const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function createHarness(): Promise<Harness> {
  const cwd = await mkdtemp(path.join(tmpdir(), 'dsh-attachment-gateway-'))
  cleanups.push(() => rm(cwd, { recursive: true, force: true }))
  const sessionId = 'session-gateway'
  const events: SessionEvent[] = []
  const session = {
    id: sessionId,
    header: { id: sessionId, cwd },
    events,
  } as unknown as Session
  const flush = vi.fn<(subject: Session) => Promise<boolean>>()
  flush.mockResolvedValue(true)
  const ctx = new Context()
  const disposeWebServer = ctx.provide('webServer', {
    register: vi.fn(() => () => undefined),
  } as unknown as Context['webServer'])
  const disposeSessions = ctx.provide('sessions', {
    get: (id: unknown) => String(id) === sessionId ? session : undefined,
    list: () => [session],
    flush,
  } as unknown as Context['sessions'])
  const disposeAttachments = ctx.provide('attachments', {
    imageLimits: {
      maxImageBytes: 10 * 1024 * 1024,
      maxImagesPerMessage: 20,
      maxMessageImageBytes: 100 * 1024 * 1024,
      maxImagePixels: 40_000_000,
      mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    },
  } as unknown as Context['attachments'])
  cleanups.push(disposeWebServer, disposeSessions, disposeAttachments)
  return { ctx, cwd, sessionId, session, events, flush }
}

async function startGateway(ctx: Context): Promise<StartedGateway> {
  const fiber = ctx.plugin(UniversalAttachmentsGateway)
  await fiber
  cleanups.push(() => fiber.dispose())
  const gateway = ctx.get('universalAttachments') as UniversalAttachmentsGateway | undefined
  if (gateway === undefined) throw new Error('Gateway service did not start')
  return { gateway, dispose: fiber.dispose }
}

async function prepareReadyAttachment(gateway: UniversalAttachmentsGateway, sessionId: string): Promise<void> {
  const prepared = await gateway.prepareBatch(sessionId, JSON.stringify([{
    clientKey: 'client-file',
    name: 'note.txt',
    kind: 'file',
    fileCount: 1,
    totalSize: 0,
  }]))
  const root = prepared.roots[0]
  if (root === undefined) throw new Error('Attachment root was not prepared')
  await gateway.beginFile(sessionId, prepared.draftId, root.rootId, '', 'note.txt', 0, 'text/plain', 1)
}

async function runHumanPreStep(ctx: Context, session: Session, turn: number): Promise<PreStepDecision> {
  const human = createUserMessage({
    content: [{ type: 'text', text: `prompt ${turn}` }],
    source: { kind: 'user' },
  })
  const waterfall = ctx.waterfall as unknown as (
    event: 'agent/pre-step',
    payload: {
      readonly agent: { readonly session: Session }
      readonly messages: UserMessage[]
      readonly turn: number
      readonly step: number
      readonly signal: AbortSignal
    },
    next: () => Promise<PreStepDecision>,
  ) => Promise<PreStepDecision>
  return waterfall.call(ctx, 'agent/pre-step', {
    agent: { session },
    messages: [human],
    turn,
    step: 1,
    signal: new AbortController().signal,
  }, () => Promise.resolve({ kind: 'enter', messages: [human] }))
}

function attachmentFrom(decision: PreStepDecision): UserMessage {
  if (decision.kind !== 'enter') throw new Error('Pre-step was rejected')
  const attachment = decision.messages.find(message => attachmentBatchId(message) !== undefined)
  if (attachment === undefined) throw new Error('Attachment message was not injected')
  return attachment
}

function appendCommittedMessage(harness: Harness, message: UserMessage, emit: boolean): void {
  const event = {
    type: 'user/message',
    seq: harness.events.length,
    time: Date.now(),
    data: message,
    surfaceOp: 'append',
  } as SessionEvent
  harness.events.push(event)
  if (emit) harness.ctx.emit('session/event', harness.session, event)
}

async function readPendingClaim(harness: Harness): Promise<unknown> {
  const metadataPath = path.join(
    harness.cwd,
    '.dsh',
    'uploads',
    '.universal-attachments',
    `${sessionHash(harness.sessionId)}.json`,
  )
  const state = JSON.parse(await readFile(metadataPath, 'utf8')) as { readonly pendingClaim?: unknown }
  return state.pendingClaim
}

async function waitForPendingClaim(harness: Harness, expected: 'present' | 'cleared'): Promise<void> {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const pending = await readPendingClaim(harness)
    if (expected === 'present' ? pending !== null : pending === null) return
    await delay(20)
  }
  throw new Error(`Timed out waiting for pending claim to be ${expected}`)
}

describe('universal attachment Gateway claim lifecycle', () => {
  it('exposes loader dependencies and all Typert remote methods', async () => {
    expect(DefaultGateway.inject).toEqual(['webServer', 'sessions', 'attachments'])

    const harness = await createHarness()
    const { gateway } = await startGateway(harness.ctx)
    expect(remoteMethods(gateway)).toEqual([
      { method: 'prepareBatch', invocation: { kind: 'direct' } },
      { method: 'beginFile', invocation: { kind: 'direct' } },
      { method: 'listDraft', invocation: { kind: 'direct' } },
      { method: 'listRoot', invocation: { kind: 'direct' } },
      { method: 'listStoredRoot', invocation: { kind: 'direct' } },
      { method: 'removeRoot', invocation: { kind: 'direct' } },
      { method: 'clearDraft', invocation: { kind: 'direct' } },
      { method: 'issuePreview', invocation: { kind: 'direct' } },
    ])
  })

  it('does not re-inject a committed claim while its durability acknowledgement is still pending', async () => {
    const harness = await createHarness()
    let resolveFlush!: (value: boolean) => void
    const flushGate = new Promise<boolean>((resolve) => {
      resolveFlush = resolve
    })
    harness.flush.mockImplementation(() => flushGate)
    const { gateway } = await startGateway(harness.ctx)
    await prepareReadyAttachment(gateway, harness.sessionId)

    const attachment = attachmentFrom(await runHumanPreStep(harness.ctx, harness.session, 1))
    const claimId = attachmentBatchId(attachment)
    appendCommittedMessage(harness, attachment, true)
    await vi.waitFor(() => { expect(harness.flush).toHaveBeenCalledTimes(1) })

    const retry = await runHumanPreStep(harness.ctx, harness.session, 2)
    expect(retry.kind).toBe('enter')
    if (retry.kind === 'enter') {
      expect(retry.messages.some(message => attachmentBatchId(message) === claimId)).toBe(false)
    }

    resolveFlush(true)
    await waitForPendingClaim(harness, 'cleared')
  })

  it('acknowledges a live claim when no durability listener participates', async () => {
    const harness = await createHarness()
    harness.flush.mockResolvedValue(false)
    const { gateway } = await startGateway(harness.ctx)
    await prepareReadyAttachment(gateway, harness.sessionId)

    const attachment = attachmentFrom(await runHumanPreStep(harness.ctx, harness.session, 1))
    appendCommittedMessage(harness, attachment, true)

    await waitForPendingClaim(harness, 'cleared')
    expect(harness.flush).toHaveBeenCalledTimes(1)
  })

  it('retries a transient durability failure without re-injecting the claim', async () => {
    const harness = await createHarness()
    harness.flush.mockRejectedValueOnce(new Error('persistence unavailable')).mockResolvedValue(true)
    const { gateway } = await startGateway(harness.ctx)
    await prepareReadyAttachment(gateway, harness.sessionId)

    const attachment = attachmentFrom(await runHumanPreStep(harness.ctx, harness.session, 1))
    appendCommittedMessage(harness, attachment, true)

    await waitForPendingClaim(harness, 'cleared')
    expect(harness.flush.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('scans sessions that were already live when the Gateway starts', async () => {
    const harness = await createHarness()
    const first = await startGateway(harness.ctx)
    await prepareReadyAttachment(first.gateway, harness.sessionId)
    const attachment = attachmentFrom(await runHumanPreStep(harness.ctx, harness.session, 1))
    appendCommittedMessage(harness, attachment, false)

    await first.dispose()

    await startGateway(harness.ctx)
    await waitForPendingClaim(harness, 'cleared')
    expect(harness.flush).toHaveBeenCalledTimes(1)
  })
})
