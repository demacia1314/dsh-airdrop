import { createServer, request } from 'node:http'
import { link, mkdir, mkdtemp, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { UniversalAttachmentBackend, parseBatchRoots } from '../../src/server/backend.js'

const cleanups: Array<() => Promise<void>> = []

async function waitForFileSize(filePath: string, expected: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if ((await stat(filePath)).size === expected) return
    await delay(5)
  }
  throw new Error(`Timed out waiting for ${filePath} to reach ${expected} bytes`)
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

describe('universal attachment backend', () => {
  it('bounds declared storage and rejects separator-bearing root names', () => {
    expect(() => parseBatchRoots(JSON.stringify([{
      clientKey: 'too-large',
      name: 'large.bin',
      kind: 'file',
      fileCount: 1,
      totalSize: 51 * 1024 * 1024 * 1024,
    }]))).toThrow(/limit/u)
    expect(() => parseBatchRoots(JSON.stringify([{
      clientKey: 'bad-name',
      name: '../escape',
      kind: 'file',
      fileCount: 1,
      totalSize: 1,
    }]))).toThrow(/invalid name/u)
  })

  it('streams an upload, resumes by offset, and serves a single preview range', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'dsh-attachments-'))
    cleanups.push(() => rm(cwd, { recursive: true, force: true }))
    const backend = new UniversalAttachmentBackend()
    const server = createServer((req, res) => { void backend.handleHttp(req, res) })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    cleanups.push(() => new Promise<void>((resolve, reject) => {
      server.close(error => { if (error === undefined) resolve(); else reject(error) })
    }))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('Test server has no TCP address')
    const origin = `http://127.0.0.1:${address.port}`

    const prepared = await backend.prepareBatch(cwd, 'session-1', JSON.stringify([{
      clientKey: 'client-1',
      name: 'hello.txt',
      kind: 'file',
      fileCount: 1,
      totalSize: 5,
    }]))
    const root = prepared.roots[0]
    if (root === undefined) throw new Error('Root was not prepared')
    const begin = await backend.beginFile(
      cwd,
      'session-1',
      prepared.draftId,
      root.rootId,
      '',
      'hello.txt',
      5,
      'text/plain',
      1,
    )
    const repeatedBegin = await backend.beginFile(
      cwd,
      'session-1',
      prepared.draftId,
      root.rootId,
      '',
      'hello.txt',
      5,
      'text/plain',
      1,
    )
    expect(repeatedBegin).toMatchObject({ uploadUrl: begin.uploadUrl, ticket: begin.ticket, offset: 0 })

    const probe = await fetch(`${origin}${begin.uploadUrl}`, {
      method: 'HEAD',
      headers: { 'X-DSH-Upload-Ticket': begin.ticket },
    })
    expect(probe.status).toBe(204)
    expect(probe.headers.get('upload-offset')).toBe('0')

    const firstChunk = await fetch(`${origin}${begin.uploadUrl}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/offset+octet-stream',
        'Upload-Offset': '0',
        'X-DSH-Upload-Ticket': begin.ticket,
      },
      body: Buffer.from('he'),
    })
    expect(firstChunk.status).toBe(200)
    await expect(firstChunk.json()).resolves.toMatchObject({ offset: 2, complete: false })

    const resumedProbe = await fetch(`${origin}${begin.uploadUrl}`, {
      method: 'HEAD',
      headers: { 'X-DSH-Upload-Ticket': begin.ticket },
    })
    expect(resumedProbe.headers.get('upload-offset')).toBe('2')

    const wrongOffset = await fetch(`${origin}${begin.uploadUrl}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/offset+octet-stream',
        'Upload-Offset': '0',
        'X-DSH-Upload-Ticket': begin.ticket,
      },
      body: Buffer.from('x'),
    })
    expect(wrongOffset.status).toBe(409)
    expect(wrongOffset.headers.get('upload-offset')).toBe('2')

    const upload = await fetch(`${origin}${begin.uploadUrl}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/offset+octet-stream',
        'Upload-Offset': '2',
        'X-DSH-Upload-Ticket': begin.ticket,
      },
      body: Buffer.from('llo'),
    })
    expect(upload.status).toBe(200)
    const completed = await upload.json() as { offset: number; complete: boolean; relPath: string }
    expect(completed).toMatchObject({ offset: 5, complete: true, relPath: root.relPath })
    expect(await readFile(path.join(cwd, ...root.relPath.split('/')), 'utf8')).toBe('hello')

    const preview = await backend.issuePreview(cwd, 'session-1', root.relPath)
    await expect(backend.issuePreview(cwd, 'session-1', root.relPath)).resolves.toMatchObject({ url: preview.url })
    const ranged = await fetch(`${origin}${preview.url}`, { headers: { Range: 'bytes=1-3' } })
    expect(ranged.status).toBe(206)
    expect(ranged.headers.get('content-range')).toBe('bytes 1-3/5')
    expect(ranged.headers.get('x-content-type-options')).toBe('nosniff')
    expect(ranged.headers.get('referrer-policy')).toBe('no-referrer')
    expect(await ranged.text()).toBe('ell')

    const crossSite = await fetch(`${origin}${preview.url}`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })
    expect(crossSite.status).toBe(403)
    const wrongOrigin = await fetch(`${origin}${preview.url}`, { headers: { Origin: 'https://attacker.example' } })
    expect(wrongOrigin.status).toBe(403)

    const claim = await backend.claimReadyRoots(cwd, 'session-1')
    expect(claim?.roots).toHaveLength(1)
    await expect(backend.claimReadyRoots(cwd, 'session-1')).resolves.toMatchObject({ claimId: claim?.claimId })
    expect((await backend.listDraft(cwd, 'session-1')).draft).toBeNull()
    await expect(backend.ackClaim(cwd, 'session-1', 'wrong-claim')).resolves.toBe(false)
    await expect(backend.ackClaim(cwd, 'session-1', claim?.claimId ?? '')).resolves.toBe(true)
    await expect(backend.ackClaim(cwd, 'session-1', claim?.claimId ?? '')).resolves.toBe(false)
    await expect(backend.issuePreview(cwd, 'session-1', root.relPath)).resolves.toMatchObject({ size: 5 })
  })

  it('finishes an in-flight write before rolling an oversized streamed request back', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'dsh-attachments-'))
    cleanups.push(() => rm(cwd, { recursive: true, force: true }))
    const backend = new UniversalAttachmentBackend()
    const server = createServer((req, res) => { void backend.handleHttp(req, res) })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    cleanups.push(() => new Promise<void>((resolve, reject) => {
      server.close(error => { if (error === undefined) resolve(); else reject(error) })
    }))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('Test server has no TCP address')
    const origin = `http://127.0.0.1:${address.port}`

    const prepared = await backend.prepareBatch(cwd, 'session-rollback', JSON.stringify([{
      clientKey: 'rollback', name: 'rollback.bin', kind: 'file', fileCount: 1, totalSize: 3,
    }]))
    const root = prepared.roots[0]
    if (root === undefined) throw new Error('Root was not prepared')
    const begin = await backend.beginFile(
      cwd,
      'session-rollback',
      prepared.draftId,
      root.rootId,
      '',
      'rollback.bin',
      3,
      'application/octet-stream',
      1,
    )
    const target = path.join(cwd, ...root.relPath.split('/'))

    const responsePromise = new Promise<{ status: number; body: string }>((resolve, reject) => {
      const upload = request(`${origin}${begin.uploadUrl}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/offset+octet-stream',
          'Upload-Offset': '0',
          'X-DSH-Upload-Ticket': begin.ticket,
        },
      }, response => {
        const chunks: Buffer[] = []
        response.on('data', chunk => chunks.push(Buffer.from(chunk)))
        response.once('error', reject)
        response.once('end', () => resolve({
          status: response.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
        }))
      })
      upload.once('error', reject)
      upload.write(Buffer.from('ab'))
      void waitForFileSize(target, 2).then(
        () => upload.end(Buffer.from('cd')),
        error => {
          upload.destroy()
          reject(error)
        },
      )
    })

    const response = await responsePromise
    expect(response.status).toBe(413)
    expect(JSON.parse(response.body)).toMatchObject({ error: expect.stringMatching(/cannot exceed/u) })
    await waitForFileSize(target, 0)
    await delay(50)
    expect((await stat(target)).size).toBe(0)

    const probe = await fetch(`${origin}${begin.uploadUrl}`, {
      method: 'HEAD',
      headers: { 'X-DSH-Upload-Ticket': begin.ticket },
    })
    expect(probe.status).toBe(204)
    expect(probe.headers.get('upload-offset')).toBe('0')
  })

  it('rejects an empty upload chunk without advancing its offset', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'dsh-attachments-'))
    cleanups.push(() => rm(cwd, { recursive: true, force: true }))
    const backend = new UniversalAttachmentBackend()
    const server = createServer((req, res) => { void backend.handleHttp(req, res) })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    cleanups.push(() => new Promise<void>((resolve, reject) => {
      server.close(error => { if (error === undefined) resolve(); else reject(error) })
    }))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('Test server has no TCP address')
    const origin = `http://127.0.0.1:${address.port}`
    const prepared = await backend.prepareBatch(cwd, 'session-empty', JSON.stringify([{
      clientKey: 'empty', name: 'empty.bin', kind: 'file', fileCount: 1, totalSize: 3,
    }]))
    const root = prepared.roots[0]
    if (root === undefined) throw new Error('Root was not prepared')
    const begin = await backend.beginFile(
      cwd,
      'session-empty',
      prepared.draftId,
      root.rootId,
      '',
      'empty.bin',
      3,
      'application/octet-stream',
      1,
    )
    const target = path.join(cwd, ...root.relPath.split('/'))

    const response = await fetch(`${origin}${begin.uploadUrl}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/offset+octet-stream',
        'Upload-Offset': '0',
        'X-DSH-Upload-Ticket': begin.ticket,
      },
    })
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/empty/u) })
    expect((await stat(target)).size).toBe(0)

    const probe = await fetch(`${origin}${begin.uploadUrl}`, {
      method: 'HEAD',
      headers: { 'X-DSH-Upload-Ticket': begin.ticket },
    })
    expect(probe.status).toBe(204)
    expect(probe.headers.get('upload-offset')).toBe('0')
  })

  it('rolls a partially received chunk back when the client disconnects', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'dsh-attachments-'))
    cleanups.push(() => rm(cwd, { recursive: true, force: true }))
    const backend = new UniversalAttachmentBackend()
    const server = createServer((req, res) => { void backend.handleHttp(req, res) })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    cleanups.push(() => new Promise<void>((resolve, reject) => {
      server.close(error => { if (error === undefined) resolve(); else reject(error) })
    }))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('Test server has no TCP address')
    const origin = `http://127.0.0.1:${address.port}`
    const prepared = await backend.prepareBatch(cwd, 'session-disconnect', JSON.stringify([{
      clientKey: 'disconnect', name: 'disconnect.bin', kind: 'file', fileCount: 1, totalSize: 5,
    }]))
    const root = prepared.roots[0]
    if (root === undefined) throw new Error('Root was not prepared')
    const begin = await backend.beginFile(
      cwd,
      'session-disconnect',
      prepared.draftId,
      root.rootId,
      '',
      'disconnect.bin',
      5,
      'application/octet-stream',
      1,
    )
    const target = path.join(cwd, ...root.relPath.split('/'))
    const upload = request(`${origin}${begin.uploadUrl}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/offset+octet-stream',
        'Content-Length': '4',
        'Upload-Offset': '0',
        'X-DSH-Upload-Ticket': begin.ticket,
      },
    })
    upload.on('error', () => undefined)
    upload.write(Buffer.from('ab'))
    await waitForFileSize(target, 2)
    upload.destroy(new Error('intentional test disconnect'))
    await waitForFileSize(target, 0)

    const probe = await fetch(`${origin}${begin.uploadUrl}`, {
      method: 'HEAD',
      headers: { 'X-DSH-Upload-Ticket': begin.ticket },
    })
    expect(probe.status).toBe(204)
    expect(probe.headers.get('upload-offset')).toBe('0')
    expect((await stat(target)).size).toBe(0)
  })

  it('isolates physical roots between sessions sharing one cwd', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'dsh-attachments-'))
    cleanups.push(() => rm(cwd, { recursive: true, force: true }))
    const backend = new UniversalAttachmentBackend()
    const manifest = (clientKey: string) => JSON.stringify([{
      clientKey,
      name: 'same.txt',
      kind: 'file',
      fileCount: 1,
      totalSize: 0,
    }])
    const [first, second] = await Promise.all([
      backend.prepareBatch(cwd, 'session-a', manifest('a')),
      backend.prepareBatch(cwd, 'session-b', manifest('b')),
    ])
    const firstRoot = first.roots[0]
    const secondRoot = second.roots[0]
    if (firstRoot === undefined || secondRoot === undefined) throw new Error('Roots were not prepared')
    expect(firstRoot.relPath).not.toBe(secondRoot.relPath)
    await backend.beginFile(cwd, 'session-a', first.draftId, firstRoot.rootId, '', 'same.txt', 0, 'text/plain', 1)
    await backend.beginFile(cwd, 'session-b', second.draftId, secondRoot.rootId, '', 'same.txt', 0, 'text/plain', 1)
    await backend.removeRoot(cwd, 'session-a', first.draftId, firstRoot.rootId)
    await expect(stat(path.join(cwd, ...secondRoot.relPath.split('/')))).resolves.toMatchObject({ size: 0 })
  })

  it('rejects a hard-link replacement without modifying the linked victim', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'dsh-attachments-'))
    cleanups.push(() => rm(cwd, { recursive: true, force: true }))
    const backend = new UniversalAttachmentBackend()
    const server = createServer((req, res) => { void backend.handleHttp(req, res) })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    cleanups.push(() => new Promise<void>((resolve, reject) => {
      server.close(error => { if (error === undefined) resolve(); else reject(error) })
    }))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('Test server has no TCP address')
    const origin = `http://127.0.0.1:${address.port}`
    const prepared = await backend.prepareBatch(cwd, 'session-hardlink', JSON.stringify([{
      clientKey: 'hardlink', name: 'target.bin', kind: 'file', fileCount: 1, totalSize: 5,
    }]))
    const root = prepared.roots[0]
    if (root === undefined) throw new Error('Root was not prepared')
    const begin = await backend.beginFile(cwd, 'session-hardlink', prepared.draftId, root.rootId, '', 'target.bin', 5, 'application/octet-stream', 1)
    const target = path.join(cwd, ...root.relPath.split('/'))
    const victim = path.join(cwd, 'victim.bin')
    await writeFile(victim, 'xxxxx')
    await rm(target)
    await link(victim, target)
    const response = await fetch(`${origin}${begin.uploadUrl}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/offset+octet-stream',
        'Upload-Offset': '0',
        'X-DSH-Upload-Ticket': begin.ticket,
      },
      body: Buffer.from('hello'),
    })
    expect(response.status).toBe(500)
    expect(await readFile(victim, 'utf8')).toBe('xxxxx')
  })

  it('rejects a new claim after ready content is statically replaced without hiding the draft', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'dsh-attachments-'))
    cleanups.push(() => rm(cwd, { recursive: true, force: true }))
    const backend = new UniversalAttachmentBackend()
    const prepared = await backend.prepareBatch(cwd, 'session-claim-replace', JSON.stringify([{
      clientKey: 'claim-replace', name: 'claim.txt', kind: 'file', fileCount: 1, totalSize: 0,
    }]))
    const root = prepared.roots[0]
    if (root === undefined) throw new Error('Root was not prepared')
    await backend.beginFile(cwd, 'session-claim-replace', prepared.draftId, root.rootId, '', 'claim.txt', 0, 'text/plain', 1)
    const target = path.join(cwd, ...root.relPath.split('/'))
    const victim = path.join(cwd, 'claim-victim.txt')
    await writeFile(victim, 'secret')
    await rm(target)
    await link(victim, target)

    await expect(backend.claimReadyRoots(cwd, 'session-claim-replace')).rejects.toThrow(/unique regular|identity/u)
    await expect(backend.listDraft(cwd, 'session-claim-replace')).resolves.toMatchObject({
      draft: { draftId: prepared.draftId, roots: [{ rootId: root.rootId, status: 'ready' }] },
    })
  })

  it('revalidates a reused claim after deletion and preserves the pending claim', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'dsh-attachments-'))
    cleanups.push(() => rm(cwd, { recursive: true, force: true }))
    const backend = new UniversalAttachmentBackend()
    const prepared = await backend.prepareBatch(cwd, 'session-claim-delete', JSON.stringify([{
      clientKey: 'claim-delete', name: 'claim.txt', kind: 'file', fileCount: 1, totalSize: 0,
    }]))
    const root = prepared.roots[0]
    if (root === undefined) throw new Error('Root was not prepared')
    await backend.beginFile(cwd, 'session-claim-delete', prepared.draftId, root.rootId, '', 'claim.txt', 0, 'text/plain', 1)
    const firstClaim = await backend.claimReadyRoots(cwd, 'session-claim-delete')
    if (firstClaim === null) throw new Error('Ready root was not claimed')
    const target = path.join(cwd, ...root.relPath.split('/'))
    const backup = `${target}.backup`
    await rename(target, backup)

    await expect(backend.claimReadyRoots(cwd, 'session-claim-delete')).rejects.toThrow()
    await rename(backup, target)
    await expect(backend.claimReadyRoots(cwd, 'session-claim-delete')).resolves.toMatchObject({
      claimId: firstClaim.claimId,
      draftId: firstClaim.draftId,
    })
  })

  it('rejects preview when the session storage is replaced by a symlink or junction', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'dsh-attachments-'))
    cleanups.push(() => rm(cwd, { recursive: true, force: true }))
    const backend = new UniversalAttachmentBackend()
    const server = createServer((req, res) => { void backend.handleHttp(req, res) })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    cleanups.push(() => new Promise<void>((resolve, reject) => {
      server.close(error => { if (error === undefined) resolve(); else reject(error) })
    }))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('Test server has no TCP address')
    const origin = `http://127.0.0.1:${address.port}`
    const prepared = await backend.prepareBatch(cwd, 'session-link', JSON.stringify([{
      clientKey: 'link', name: 'safe.txt', kind: 'file', fileCount: 1, totalSize: 0,
    }]))
    const root = prepared.roots[0]
    if (root === undefined) throw new Error('Root was not prepared')
    await backend.beginFile(cwd, 'session-link', prepared.draftId, root.rootId, '', 'safe.txt', 0, 'text/plain', 1)
    const preview = await backend.issuePreview(cwd, 'session-link', root.relPath)
    const segments = root.relPath.split('/')
    const contentRoot = path.join(cwd, ...segments.slice(0, 3))
    const backupRoot = `${contentRoot}-backup`
    const externalRoot = path.join(cwd, 'external-content')
    await mkdir(externalRoot)
    await writeFile(path.join(externalRoot, segments.at(-1) ?? 'safe.txt'), 'secret')
    await rename(contentRoot, backupRoot)
    await symlink(externalRoot, contentRoot, process.platform === 'win32' ? 'junction' : 'dir')
    const response = await fetch(`${origin}${preview.url}`)
    expect(response.status).toBe(404)
  })

  it('enforces a retained-byte quota across sessions in one workspace', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'dsh-attachments-'))
    cleanups.push(() => rm(cwd, { recursive: true, force: true }))
    const backend = new UniversalAttachmentBackend()
    const fiftyGiB = 50 * 1024 * 1024 * 1024
    const fullDraft = (prefix: string) => JSON.stringify([
      { clientKey: `${prefix}-1`, name: `${prefix}-1.bin`, kind: 'file', fileCount: 1, totalSize: fiftyGiB },
      { clientKey: `${prefix}-2`, name: `${prefix}-2.bin`, kind: 'file', fileCount: 1, totalSize: fiftyGiB },
    ])
    await backend.prepareBatch(cwd, 'quota-a', fullDraft('a'))
    await backend.prepareBatch(cwd, 'quota-b', fullDraft('b'))
    await expect(backend.prepareBatch(cwd, 'quota-c', JSON.stringify([{
      clientKey: 'c-1', name: 'one.bin', kind: 'file', fileCount: 1, totalSize: 1,
    }]))).rejects.toThrow(/retained bytes/u)
  })
})
