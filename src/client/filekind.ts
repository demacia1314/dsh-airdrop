/**
 * Shared file-type classification for attachment visuals. Both the upload
 * dock and the conversation history render type-aware tiles from this.
 */

export type FileVisualKind =
  | 'audio'
  | 'pdf'
  | 'archive'
  | 'code'
  | 'text'
  | 'generic'

const AUDIO_EXTENSIONS = new Set([
  'mp3', 'wav', 'ogg', 'oga', 'flac', 'm4a', 'aac', 'opus', 'wma', 'aiff', 'mid', 'midi',
])

const ARCHIVE_EXTENSIONS = new Set([
  'zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', 'lz4', 'jar', 'war', 'cab',
])

const ARCHIVE_MIMES = new Set([
  'application/zip',
  'application/x-7z-compressed',
  'application/x-rar-compressed',
  'application/vnd.rar',
  'application/gzip',
  'application/x-tar',
  'application/x-bzip2',
  'application/x-xz',
  'application/zstd',
  'application/java-archive',
])

const CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rb', 'go', 'rs', 'java', 'kt',
  'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'swift', 'sh', 'bash', 'zsh', 'sql',
  'html', 'htm', 'css', 'scss', 'less', 'vue', 'svelte', 'json', 'jsonc',
  'yaml', 'yml', 'toml', 'xml', 'lua', 'r', 'dart', 'scala', 'ex', 'exs',
])

const TEXT_EXTENSIONS = new Set([
  'md', 'markdown', 'txt', 'log', 'csv', 'tsv', 'ini', 'cfg', 'conf', 'env',
  'diff', 'patch', 'rst',
])

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return 'FILE'
  return name.slice(dot + 1).replace(/[^a-z0-9]/giu, '').slice(0, 5).toUpperCase() || 'FILE'
}

function lowerExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return ''
  return name.slice(dot + 1).toLowerCase()
}

export function fileVisualKind(name: string, mime?: string): FileVisualKind {
  const ext = lowerExtension(name)
  if (mime?.startsWith('audio/') === true || AUDIO_EXTENSIONS.has(ext)) return 'audio'
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf'
  if (ARCHIVE_MIMES.has(mime ?? '') || ARCHIVE_EXTENSIONS.has(ext)) return 'archive'
  if (CODE_EXTENSIONS.has(ext)) return 'code'
  if (mime?.startsWith('text/') === true || TEXT_EXTENSIONS.has(ext)) return 'text'
  return 'generic'
}
