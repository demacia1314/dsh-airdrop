import { describe, expect, it } from 'vitest'
import {
  allocateSafeRelativePath,
  sanitizePathSegment,
  splitRelativePath,
} from '../../src/server/path.js'

describe('portable attachment paths', () => {
  it.each([
    '../secret.txt',
    'folder/../secret.txt',
    '/etc/passwd',
    'C:\\Windows\\system.ini',
    '\\\\server\\share\\file.txt',
    'folder//file.txt',
    'folder/./file.txt',
    `folder/${String.fromCharCode(0)}file.txt`,
  ])('rejects traversal or absolute path %j', value => {
    expect(() => splitRelativePath(value)).toThrow()
  })

  it('cleans Windows reserved names and trailing dots/spaces', () => {
    expect(sanitizePathSegment('CON.txt')).toBe('_CON.txt')
    expect(sanitizePathSegment('report...   ')).toBe('report')
    expect(sanitizePathSegment('a<b>c.txt')).toBe('a_b_c.txt')
  })

  it('allocates case-insensitive sibling collisions without flattening paths', () => {
    const first = allocateSafeRelativePath('A/readme.txt', [])
    const second = allocateSafeRelativePath('a/notes.txt', first.aliases)
    expect(first.safeRelativePath).toBe('A/readme.txt')
    expect(second.safeRelativePath).toBe('a~2/notes.txt')
  })

  it('reuses a previously allocated directory alias', () => {
    const first = allocateSafeRelativePath('reports/one.txt', [])
    const second = allocateSafeRelativePath('reports/two.txt', first.aliases)
    expect(second.safeRelativePath).toBe('reports/two.txt')
  })
})
