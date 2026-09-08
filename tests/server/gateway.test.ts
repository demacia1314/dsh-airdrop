import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, UserMessage } from '@deepseek-ai/dsh-session'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DefaultGateway, { AirdropGateway } from '../../src/index.js'
import { AirdropBackend } from '../../src/server/backend.js'
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
  readonly gateway: AirdropGateway
  readonly dispose: () => Promise<void>
}

/** Unmatched rpcId: the legacy (rpcId-less) claim is matched through the fallback in getReadyClaimsForRpcIds. */
const RPC_ID = 'test-rpc'
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
    snapshotEvents: () => events,
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
  const disposeSessionController = ctx.provide('sessionController', {
    prompt: async () => ({ accepted: true }),
  })
  const disposeAgents = ctx.provide('agents', {
    get: () => undefined,
    list: () => [],
  })
  cleanups.push(disposeWebServer, disposeSessions, disposeAttachments, disposeSessionController, disposeAgents)
  return { ctx, cwd, sessionId, session, events, flush }
}

async function startGateway(ctx: Context): Promise<StartedGateway> {
  const fiber = ctx.plugin(AirdropGateway)
  await fiber
  cleanups.push(() => fiber.dispose())
  const gateway = ctx.get('airdrop') as AirdropGateway | undefined
  if (gateway === undefined) throw new Error('Gateway service did not start')
  return { gateway, dispose: fiber.dispose }
}

/**
 * Prepare a ready single-file draft through the gateway and reserve a legacy
 * (rpcId-less) pending claim through its own backend, mirroring the historical
 * claimReadyRoots flow the ack lifecycle is built around.
 */
async function prepareReadyClaim(gateway: AirdropGateway, harness: Harness): Promise<string> {
  const prepared = await gateway.prepareBatch(harness.sessionId, JSON.stringify([{
    clientKey: 'client-file',
    name: 'note.txt',
    kind: 'file',
    fileCount: 1,
    totalSize: 0,
  }]))
  const root = prepared.roots[0]
  if (root === undefined) throw new Error('Attachment root was not prepared')
  await gateway.beginFile(harness.sessionId, prepared.draftId, root.rootId, '', 'note.txt', 0, 'text/plain', 1)
  const backend = (gateway as unknown as { readonly backend: AirdropBackend }).backend
  const claim = await backend.claimReadyRoots(harness.cwd, harness.sessionId)
  if (claim === null) throw new Error('Attachment claim was not prepared')
  return claim.claimId
}

function humanTurn(turn: number): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text: `prompt ${turn}` }],
    source: { kind: 'user', rpcId: RPC_ID } as unknown as UserMessage['source'],
  })
}

async function runHumanPreStep(ctx: Context, session: Session, turn: number): Promise<PreStepDecision> {
  const human = humanTurn(turn)
  const waterfall = ctx.waterfall as unknown as (
    event: 'agent/pre-step',
    payload: {
      readonly agent: { readonly id: Session['id']; readonly session: Session }
      readonly messages: UserMessage[]
      readonly turn: number
      readonly step: number
      readonly signal: AbortSignal
    },
    next: () => Promise<PreStepDecision>,
  ) => Promise<PreStepDecision>
  return waterfall.call(ctx, 'agent/pre-step', {
    agent: { id: session.id, session },
    messages: [human],
    turn,
    step: 1,
    signal: new AbortController().signal,
  }, () => Promise.resolve({ kind: 'enter', messages: [human] }))
}

/** The claimed human message (the one carrying the attachment manifest) that gets committed. */
function committedHuman(decision: PreStepDecision): UserMessage {
  if (decision.kind !== 'enter') throw new Error('Pre-step was rejected')
  const human = decision.messages.find(message => message.role === 'user' && message.source.kind === 'user')
  if (human === undefined) throw new Error('Committed human message was not injected')
  return human
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

/** Current storage format keeps pendingClaims as an array and removes the metadata file when fully empty. */
async function readPendingClaims(harness: Harness): Promise<readonly unknown[]> {
  const metadataPath = path.join(
    harness.cwd,
    '.dsh',
    'uploads',
    '.universal-attachments',
    `${sessionHash(harness.sessionId)}.json`,
  )
  try {
    const state = JSON.parse(await readFile(metadataPath, 'utf8')) as { readonly pendingClaims?: readonly unknown[] }
    return state.pendingClaims ?? []
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return []
    throw error
  }
}

async function waitForPendingClaims(harness: Harness, expected: 'present' | 'cleared'): Promise<void> {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const pending = await readPendingClaims(harness)
    if (expected === 'present' ? pending.length > 0 : pending.length === 0) return
    await delay(20)
  }
  throw new Error(`Timed out waiting for pending claims to be ${expected}`)
}

describe('airdrop Gateway claim lifecycle', () => {
  it('exposes loader dependencies and all Typert remote methods', async () => {
    expect(DefaultGateway.inject).toEqual(['webServer', 'sessions', 'attachments', 'sessionController', 'agents'])

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
      { method: 'submitDraft', invocation: { kind: 'direct' } },
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
    const claimId = await prepareReadyClaim(gateway, harness)

    const first = await runHumanPreStep(harness.ctx, harness.session, 1)
    appendCommittedMessage(harness, committedHuman(first), true)
    await vi.waitFor(() => { expect(harness.flush).toHaveBeenCalledTimes(1) })

    const retry = await runHumanPreStep(harness.ctx, harness.session, 2)
    expect(retry.kind).toBe('enter')
    if (retry.kind === 'enter') {
      expect(retry.messages.some(message => attachmentBatchId(message) === claimId)).toBe(false)
    }

    resolveFlush(true)
    await waitForPendingClaims(harness, 'cleared')
  })

  it('retains a claim when no durability listener participates', async () => {
    const harness = await createHarness()
    harness.flush.mockResolvedValue(false)
    const { gateway } = await startGateway(harness.ctx)
    await prepareReadyClaim(gateway, harness)

    const decision = await runHumanPreStep(harness.ctx, harness.session, 1)
    appendCommittedMessage(harness, committedHuman(decision), true)

    await vi.waitFor(() => { expect(harness.flush).toHaveBeenCalledTimes(1) })
    await delay(50)
    expect(await readPendingClaims(harness)).toHaveLength(1)
  })

  it('retries a transient durability failure without re-injecting the claim', async () => {
    const harness = await createHarness()
    harness.flush.mockRejectedValueOnce(new Error('persistence unavailable')).mockResolvedValue(true)
    const { gateway } = await startGateway(harness.ctx)
    await prepareReadyClaim(gateway, harness)

    const decision = await runHumanPreStep(harness.ctx, harness.session, 1)
    appendCommittedMessage(harness, committedHuman(decision), true)

    await waitForPendingClaims(harness, 'cleared')
    expect(harness.flush.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('scans sessions that were already live when the Gateway starts', async () => {
    const harness = await createHarness()
    const first = await startGateway(harness.ctx)
    await prepareReadyClaim(first.gateway, harness)
    const decision = await runHumanPreStep(harness.ctx, harness.session, 1)
    appendCommittedMessage(harness, committedHuman(decision), false)

    await first.dispose()

    await startGateway(harness.ctx)
    await waitForPendingClaims(harness, 'cleared')
    expect(harness.flush).toHaveBeenCalledTimes(1)
  })
})