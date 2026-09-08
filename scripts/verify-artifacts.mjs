import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'

const expectedMethods = [
  'prepareBatch',
  'beginFile',
  'listDraft',
  'listRoot',
  'listStoredRoot',
  'removeRoot',
  'clearDraft',
  'submitDraft',
  'issuePreview',
]

const hostUrl = new URL('../lib/index.js', import.meta.url)
hostUrl.searchParams.set('smoke', String(Date.now()))
const host = await import(hostUrl.href)
if (JSON.stringify(host.default.inject) !== JSON.stringify(['webServer', 'sessions', 'attachments', 'sessionController', 'agents'])) {
  throw new Error('Built Gateway inject metadata is invalid')
}

const ctx = new Context()
const stopWebServer = ctx.provide('webServer', { register: () => () => undefined })
const stopSessions = ctx.provide('sessions', {
  get: () => undefined,
  list: () => [],
  flush: async () => true,
})
const stopAttachments = ctx.provide('attachments', {
  imageLimits: {
    maxImageBytes: 10 * 1024 * 1024,
    maxImagesPerMessage: 10,
    maxMessageImageBytes: 20 * 1024 * 1024,
    maxImagePixels: 40_000_000,
    mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  },
  validateImage: async () => undefined,
  saveImage: async () => { throw new Error('artifact smoke does not save images') },
  readImage: async () => { throw new Error('artifact smoke does not read images') },
})
const stopSessionController = ctx.provide('sessionController', {
  prompt: async request => {
    if (typeof request.requestId !== 'string') throw new Error('prompt request missing requestId')
    return { accepted: true }
  },
})
const stopAgents = ctx.provide('agents', {
  get: () => undefined,
  list: () => [],
})
const fiber = ctx.plugin(host.default)
await fiber
try {
  const gateway = ctx.get('airdrop')
  const methods = remoteMethods(gateway).map(item => item.method)
  if (JSON.stringify(methods) !== JSON.stringify(expectedMethods)) {
    throw new Error(`Built Gateway Remote methods are invalid: ${methods.join(', ')}`)
  }
  if (host.TYPERT?.invocations?.length !== expectedMethods.length) {
    throw new Error('Built Typert manifest is incomplete')
  }
} finally {
  await fiber.dispose()
  stopAgents()
  stopSessionController()
  stopAttachments()
  stopSessions()
  stopWebServer()
}

const hostCode = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8')
const clientCode = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
if (!clientCode.startsWith('window.__ModuleLoader__.load(')) throw new Error('Client module wrapper is missing')
if (/^\s*import\s/mu.test(clientCode)) throw new Error('Client bundle contains an ESM import')
if (clientCode.includes('require("react-dom")')) throw new Error('Client bundle contains an unused react-dom dependency')
if (/from ["']zod["']|require\(["']zod["']\)/u.test(`${hostCode}\n${clientCode}`)) {
  throw new Error('Built artifacts contain a bare zod dependency')
}

let registration
const noop = () => undefined
const stub = new Proxy(noop, { get: () => stub })
vm.runInNewContext(clientCode, {
  window: { __ModuleLoader__: { load(value) { registration = value } } },
  console,
  URL,
  Blob,
  File,
  Response,
  Request,
  Headers,
  fetch: stub,
  crypto,
  setTimeout,
  clearTimeout,
})
if (registration?.id !== 'dsh-airdrop') throw new Error('Client module registration is invalid')
const client = registration.factory(() => stub)
if (typeof client.apply !== 'function' || !Array.isArray(client.inject)) {
  throw new Error('Client module exports are invalid')
}

console.log(`Verified host/client artifacts (${expectedMethods.length} Remote methods).`)
