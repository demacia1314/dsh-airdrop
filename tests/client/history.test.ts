import { describe, expect, it } from 'vitest'
import { readLegacyAttachmentHistory } from '../../src/client/history.js'

const content = [{ type: 'text', text: '📎 report.pdf (42 bytes) → .dsh/uploads/20260923T100000000Z-root_0123456789abcdef' }]

describe('legacy attachment message history', () => {
  it('keeps reading old package-name sources', () => {
    const history = readLegacyAttachmentHistory(
      { kind: 'plugin', plugin: 'dsh-universal-attachments', batchId: 'old-batch' },
      content,
      'fallback-batch',
    )
    expect(history?.batchId).toBe('old-batch')
    expect(history?.roots[0]?.name).toBe('report.pdf')
  })

  it('does not reinterpret current attachment notice messages as legacy history', () => {
    const history = readLegacyAttachmentHistory(
      { kind: 'dsh-airdrop', historyHandledBy: 'user-message' },
      content,
      'fallback-batch',
    )
    expect(history).toBeUndefined()
  })
})
