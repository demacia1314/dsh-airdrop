import { describe, expect, it } from 'vitest'
import { TYPERT, TYPERT_MANIFEST } from '../../src/index.js'

describe('hand-written Typert host manifest', () => {
  it('exports the host face and exact RPC method names', () => {
    expect(TYPERT).toBe(TYPERT_MANIFEST)
    expect(TYPERT_MANIFEST).toMatchObject({
      package: 'dsh-universal-attachments',
      face: 'host',
    })
    expect(TYPERT_MANIFEST.invocations.map(invocation => invocation.method)).toEqual([
      'prepareBatch',
      'beginFile',
      'listDraft',
      'listRoot',
      'listStoredRoot',
      'removeRoot',
      'clearDraft',
      'submitDraft',
      'issuePreview',
    ])
  })

  it('keeps the beginFile wire parameter names byte-for-byte stable', () => {
    const begin = TYPERT_MANIFEST.invocations.find(invocation => invocation.method === 'beginFile')
    expect(begin?.parameters.map(parameter => parameter.name)).toEqual([
      'sessionId',
      'draftId',
      'rootId',
      'relativePath',
      'name',
      'size',
      'mime',
      'lastModified',
    ])
    expect(begin?.parameters.map(parameter => parameter.wire)).toEqual(begin?.parameters.map(parameter => parameter.name))
  })
})
