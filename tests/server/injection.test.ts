import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import {
  ATTACHMENT_SAFETY_LINE,
  buildAttachmentText,
  createAttachmentMessage,
  insertAttachmentMessageOnce,
} from '../../src/server/injection.js'
import type { RootState } from '../../src/server/types.js'

function root(overrides: Partial<RootState> = {}): RootState {
  return {
    rootId: 'root-1',
    clientKey: 'client-1',
    name: 'report.pdf',
    kind: 'file',
    relPath: '.dsh/uploads/20260817-report.pdf',
    fileCount: 1,
    totalSize: 42,
    createdAt: 1,
    aliases: [],
    entries: [],
    ...overrides,
  }
}

describe('attachment pre-step injection', () => {
  it('uses the stable file and folder line protocol plus one safety line', () => {
    const text = buildAttachmentText([
      root(),
      root({
        rootId: 'root-2',
        name: 'assets',
        kind: 'folder',
        fileCount: 3,
        totalSize: 99,
        relPath: '.dsh/uploads/20260817-assets',
      }),
    ])
    expect(text.split('\n')).toEqual([
      '📎 report.pdf (42 bytes) → .dsh/uploads/20260817-report.pdf',
      '📁 assets (3 files, 99 bytes) → .dsh/uploads/20260817-assets',
      ATTACHMENT_SAFETY_LINE,
    ])
  })

  it('inserts once immediately before the first claimed human message', () => {
    const pluginContext = createUserMessage({
      content: [{ type: 'text', text: 'existing context' }],
      source: { kind: 'plugin', plugin: 'other' },
    })
    const human = createUserMessage({
      content: [{ type: 'text', text: 'Please inspect these.' }],
      source: { kind: 'user' },
    })
    const attachment = createAttachmentMessage('claim-1', [root()])
    const first = insertAttachmentMessageOnce([pluginContext, human], [human], attachment, 'claim-1')
    expect(first.inserted).toBe(true)
    expect(first.messages).toEqual([pluginContext, attachment, human])

    const second = insertAttachmentMessageOnce(first.messages, [human], attachment, 'claim-1')
    expect(second.inserted).toBe(false)
    expect(second.messages).toEqual(first.messages)
  })

  it('waits when a tool-only step has no claimed human message', () => {
    const pluginContext = createUserMessage({
      content: [{ type: 'text', text: 'tool continuation context' }],
      source: { kind: 'plugin', plugin: 'other' },
    })
    const attachment = createAttachmentMessage('claim-2', [root()])
    expect(insertAttachmentMessageOnce([pluginContext], [pluginContext], attachment, 'claim-2').inserted).toBe(false)
  })

  it('inserts before the first claimed identity, not an older user message', () => {
    const older = createUserMessage({
      content: [{ type: 'text', text: 'older history' }],
      source: { kind: 'user' },
    })
    const claimed = createUserMessage({
      content: [{ type: 'text', text: 'new prompt' }],
      source: { kind: 'user' },
    })
    const attachment = createAttachmentMessage('claim-3', [root()])
    const result = insertAttachmentMessageOnce([older, claimed], [claimed], attachment, 'claim-3')
    expect(result.messages).toEqual([older, attachment, claimed])
  })

  it('skips claimed plugin context and targets the first claimed human message', () => {
    const pluginContext = createUserMessage({
      content: [{ type: 'text', text: 'claimed plugin context' }],
      source: { kind: 'plugin', plugin: 'other' },
    })
    const human = createUserMessage({
      content: [{ type: 'text', text: 'claimed prompt' }],
      source: { kind: 'user' },
    })
    const attachment = createAttachmentMessage('claim-4', [root()])
    const result = insertAttachmentMessageOnce(
      [pluginContext, human],
      [pluginContext, human],
      attachment,
      'claim-4',
    )
    expect(result.messages).toEqual([pluginContext, attachment, human])
  })
})
