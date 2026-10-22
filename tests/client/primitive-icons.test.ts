import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

const MODULE = '@deepseek-ai/dsh-client-ui-primitives'

async function renderCloseIcon(exports: Record<string, unknown>): Promise<string> {
  vi.resetModules()
  vi.doMock(MODULE, () => exports)
  const { IconCloseOutline16 } = await import('../../src/client/platform/primitive-icons.js')
  return renderToStaticMarkup(createElement(IconCloseOutline16, { size: 16 }))
}

afterEach(() => {
  vi.resetModules()
  vi.doUnmock(MODULE)
})

describe('DSH primitive icon compatibility', () => {
  it('prefers the weight-based DSH 0.2.1 export', async () => {
    const html = await renderCloseIcon({
      IconCloseOutlineMedium: () => createElement('span', { 'data-icon': 'medium' }),
      IconCloseOutline16: () => createElement('span', { 'data-icon': 'legacy' }),
    })
    expect(html).toContain('data-icon="medium"')
    expect(html).not.toContain('data-icon="legacy"')
  })

  it('falls back to the numeric DSH 0.1.5 export', async () => {
    const html = await renderCloseIcon({
      IconCloseOutlineMedium: undefined,
      IconCloseOutline16: () => createElement('span', { 'data-icon': 'legacy' }),
    })
    expect(html).toContain('data-icon="legacy"')
  })
})
