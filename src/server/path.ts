import path from 'node:path'

const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu
const WINDOWS_INVALID = /[<>:"/\\|?*\u0000-\u001f]/gu
const DRIVE_PREFIX = /^[A-Za-z]:/u
const MAX_SEGMENT_CHARS = 180
const MAX_RELATIVE_PATH_CHARS = 4096

export function caseFold(value: string): string {
  return value.normalize('NFC').toLocaleLowerCase('en-US')
}

export function sanitizePathSegment(input: string): string {
  if (input.includes('\0')) throw new Error('Path segments cannot contain NUL bytes')
  let value = input.normalize('NFC').replace(WINDOWS_INVALID, '_').replace(/[ .]+$/gu, '')
  if (value === '' || value === '.' || value === '..') value = '_'
  if (WINDOWS_RESERVED.test(value)) value = `_${value}`
  if (value.length > MAX_SEGMENT_CHARS) {
    const extensionIndex = value.lastIndexOf('.')
    const extension = extensionIndex > 0 && value.length - extensionIndex <= 24
      ? value.slice(extensionIndex)
      : ''
    value = `${value.slice(0, MAX_SEGMENT_CHARS - extension.length)}${extension}`
  }
  return value
}

export function splitRelativePath(input: string): readonly string[] {
  if (input.length === 0) return []
  if (input.length > MAX_RELATIVE_PATH_CHARS) throw new Error('Relative path is too long')
  if (input.includes('\0')) throw new Error('Relative paths cannot contain NUL bytes')
  if (path.posix.isAbsolute(input) || path.win32.isAbsolute(input) || DRIVE_PREFIX.test(input)) {
    throw new Error('Absolute, drive-letter, and UNC paths are not allowed')
  }

  const normalized = input.replaceAll('\\', '/')
  if (normalized.startsWith('/') || normalized.startsWith('//')) {
    throw new Error('Absolute and UNC paths are not allowed')
  }
  const segments = normalized.split('/')
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new Error('Empty and traversal path segments are not allowed')
  }
  return segments.map(segment => segment.normalize('NFC'))
}

export function normalizeEntryRelativePath(
  kind: 'file' | 'folder',
  relativePath: string,
  name: string,
): string {
  if (name.length === 0 || name.length > MAX_SEGMENT_CHARS * 2 || name.includes('\0')) {
    throw new Error('Invalid file name')
  }
  if (name.includes('/') || name.includes('\\')) throw new Error('File names cannot contain path separators')

  const segments = splitRelativePath(relativePath)
  if (kind === 'file') {
    if (segments.length !== 0) throw new Error('A top-level file must use an empty relativePath')
    return ''
  }
  if (segments.length === 0) throw new Error('A folder entry must have a relativePath')
  const basename = segments.at(-1)
  if (basename?.normalize('NFC') !== name.normalize('NFC')) {
    throw new Error('The file name must match the last relativePath segment')
  }
  return segments.join('/')
}

export interface PathAliasLike {
  readonly raw: string
  readonly safe: string
}

function suffixSegment(segment: string, index: number): string {
  const dot = segment.lastIndexOf('.')
  const suffix = `~${index}`
  if (dot <= 0) return `${segment.slice(0, MAX_SEGMENT_CHARS - suffix.length)}${suffix}`
  const extension = segment.slice(dot)
  const stem = segment.slice(0, dot)
  return `${stem.slice(0, MAX_SEGMENT_CHARS - extension.length - suffix.length)}${suffix}${extension}`
}

function siblingNames(aliases: readonly PathAliasLike[], parentSafe: string, depth: number): readonly string[] {
  return aliases.flatMap(alias => {
    const safeSegments = alias.safe.split('/')
    if (safeSegments.length !== depth + 1) return []
    if (safeSegments.slice(0, -1).join('/') !== parentSafe) return []
    const name = safeSegments.at(-1)
    return name === undefined ? [] : [name]
  })
}

/** Allocate a stable, Windows-safe path while preserving the original directory hierarchy. */
export function allocateSafeRelativePath(
  rawRelativePath: string,
  existingAliases: readonly PathAliasLike[],
): { readonly safeRelativePath: string; readonly aliases: readonly PathAliasLike[] } {
  const rawSegments = splitRelativePath(rawRelativePath)
  if (rawSegments.length === 0) return { safeRelativePath: '', aliases: [...existingAliases] }

  const aliases: PathAliasLike[] = existingAliases.map(alias => ({ ...alias }))
  const safeSegments: string[] = []
  for (let depth = 0; depth < rawSegments.length; depth += 1) {
    const rawSegment = rawSegments[depth]
    if (rawSegment === undefined) throw new Error('Invalid relative path')
    const rawPrefix = rawSegments.slice(0, depth + 1).join('/')
    const existing = aliases.find(alias => alias.raw === rawPrefix)
    if (existing !== undefined) {
      const existingSegments = existing.safe.split('/')
      const safeSegment = existingSegments[depth]
      if (safeSegment === undefined || existingSegments.slice(0, depth).join('/') !== safeSegments.join('/')) {
        throw new Error('Stored path aliases are inconsistent')
      }
      safeSegments.push(safeSegment)
      continue
    }

    const parentSafe = safeSegments.join('/')
    const used = new Set(siblingNames(aliases, parentSafe, depth).map(caseFold))
    const base = sanitizePathSegment(rawSegment)
    let candidate = base
    for (let index = 2; used.has(caseFold(candidate)); index += 1) candidate = suffixSegment(base, index)
    safeSegments.push(candidate)
    aliases.push({ raw: rawPrefix, safe: safeSegments.join('/') })
  }
  return { safeRelativePath: safeSegments.join('/'), aliases }
}

export function formatStorageTimestamp(time: number): string {
  const date = new Date(time)
  if (!Number.isFinite(time) || Number.isNaN(date.valueOf())) throw new Error('Invalid timestamp')
  return date.toISOString().replace(/[-:.]/gu, '').replace('Z', 'Z')
}

export function allocateStoredBasename(
  time: number,
  originalName: string,
  usedBasenames: readonly string[],
): string {
  const base = `${formatStorageTimestamp(time)}-${sanitizePathSegment(originalName)}`
  const used = new Set(usedBasenames.map(caseFold))
  if (!used.has(caseFold(base))) return base
  for (let index = 2; ; index += 1) {
    const candidate = suffixSegment(base, index)
    if (!used.has(caseFold(candidate))) return candidate
  }
}

export function toWorkspaceRelative(...segments: readonly string[]): string {
  return path.posix.join('.dsh', 'uploads', ...segments)
}

export function isPathInside(base: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(base), path.resolve(candidate))
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)
}

export function resolveInside(base: string, relativePath: string): string {
  const candidate = path.resolve(base, ...splitRelativePath(relativePath))
  if (!isPathInside(base, candidate)) throw new Error('Resolved path escapes its storage root')
  return candidate
}
