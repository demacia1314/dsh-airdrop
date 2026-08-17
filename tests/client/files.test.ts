import { describe, expect, it } from 'vitest'
import { rootsFromDrop, rootsFromFiles } from '../../src/client/files.js'

function file(name: string, contents = 'x', type = 'application/octet-stream'): File {
  return new File([contents], name, { type, lastModified: 1 })
}

describe('rootsFromFiles', () => {
  it('treats ordinary selections as independent file roots', () => {
    const roots = rootsFromFiles([file('a.txt', 'abc'), file('b.bin', '12')])
    expect(roots.map(root => [root.name, root.kind, root.fileCount, root.totalSize])).toEqual([
      ['a.txt', 'file', 1, 3],
      ['b.bin', 'file', 1, 2],
    ])
  })

  it('groups webkitdirectory files and preserves paths below the selected root', () => {
    const first = file('a.txt') as File & { webkitRelativePath?: string }
    const second = file('b.txt') as File & { webkitRelativePath?: string }
    Object.defineProperty(first, 'webkitRelativePath', { value: 'docs/a.txt' })
    Object.defineProperty(second, 'webkitRelativePath', { value: 'docs/nested/b.txt' })
    const roots = rootsFromFiles([first, second], true)
    expect(roots).toHaveLength(1)
    expect(roots[0]?.name).toBe('docs')
    expect(roots[0]?.files.map(item => item.relativePath)).toEqual(['a.txt', 'nested/b.txt'])
  })
})

describe('rootsFromDrop', () => {
  it('captures file-system handles before awaiting and walks directories', async () => {
    let resolveHandle: ((value: unknown) => void) | undefined
    let called = false
    const handlePromise = new Promise(resolve => { resolveHandle = resolve })
    const transfer = {
      items: [{
        kind: 'file',
        getAsFileSystemHandle() {
          called = true
          return handlePromise
        },
      }],
      files: [],
      types: ['Files'],
    } as unknown as DataTransfer

    const pending = rootsFromDrop(transfer)
    expect(called).toBe(true)
    resolveHandle?.({
      kind: 'directory',
      name: 'project',
      async *values() {
        yield { kind: 'file', name: 'README.md', getFile: async () => file('README.md', '# hi', 'text/markdown') }
        yield {
          kind: 'directory',
          name: 'src',
          async *values() {
            yield { kind: 'file', name: 'index.ts', getFile: async () => file('index.ts', 'export {}', 'text/typescript') }
          },
        }
      },
    })

    const roots = await pending
    expect(roots).toHaveLength(1)
    expect(roots[0]?.name).toBe('project')
    expect(roots[0]?.files.map(item => item.relativePath)).toEqual(['README.md', 'src/index.ts'])
  })
})
