import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { rootsFromFiles } from '../../src/client/files.js'
import { runIntake } from '../../src/client/intake.js'
import { createUploadStore } from '../../src/client/store.js'
import type { UniversalAttachmentsCalls } from '../../src/client/types.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('runIntake', () => {
  it('continues after a lost chunk response when HEAD reports that chunk committed', async () => {
    vi.stubGlobal('location', { origin: 'http://dsh.test' })
    vi.stubGlobal('window', {
      setTimeout(callback: () => void) {
        callback()
        return 1
      },
    })
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('response lost after commit'))
      .mockResolvedValueOnce(new Response(null, {
        status: 204,
        headers: { 'Upload-Offset': '4' },
      }))
    vi.stubGlobal('fetch', fetchMock)

    const api = {
      prepareBatch: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          draftId: 'draft-1',
          chunkSize: 4,
          roots: [{ clientKey: 'client-1', rootId: 'root-1', relPath: '.dsh/uploads/hash/file.bin' }],
        },
      }),
      beginFile: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          uploadId: 'upload-1',
          uploadUrl: '/_dsh/universal-attachments/upload/token',
          ticket: 'ticket',
          offset: 0,
          chunkSize: 4,
        },
      }),
    } as unknown as UniversalAttachmentsCalls
    const roots = rootsFromFiles([new File(['data'], 'file.bin', { type: 'application/octet-stream', lastModified: 1 })])
    const root = roots[0]
    if (root === undefined) throw new Error('Test root was not created')
    Object.defineProperty(root, 'clientKey', { value: 'client-1' })

    const report = await runIntake(
      { ctx: {} as ClientContext, api: () => api, store: createUploadStore() },
      'session-1' as SessionId,
      roots,
    )

    expect(report).toEqual({ uploadedRoots: 1, failed: [] })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.map(([, init]) => (init as RequestInit).method)).toEqual(['PATCH', 'HEAD'])
  })
})
