import type { AttachmentHistoryRoot } from '../shared/manifest.js'

const PLUGIN_NAME = 'dsh-universal-attachments'
const REFERENCE_LINE = /^(?<symbol>\u{1F4CE}|\u{1F4C1})\s+(?<name>.+)\s+\((?<meta>[^)]*)\)\s+\u2192\s+(?<relPath>\.dsh\/uploads\/.+?)\s*$/u
const STORED_ROOT_BASENAME = /^\d{8}T\d{9}Z-(?<rootId>[A-Za-z0-9_-]{24})-/u

export interface LegacyAttachmentHistory {
  readonly batchId: string
  readonly roots: readonly AttachmentHistoryRoot[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeInteger(value: string): number | undefined {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined
}

function rootIdFromPath(relPath: string): string {
  const basename = relPath.split('/').at(-1) ?? ''
  return STORED_ROOT_BASENAME.exec(basename)?.groups?.rootId ?? `legacy:${relPath}`
}

function parseReference(line: string): AttachmentHistoryRoot | undefined {
  const groups = REFERENCE_LINE.exec(line)?.groups
  const name = groups?.name?.trim()
  const relPath = groups?.relPath
  if (groups === undefined || name === undefined || name === '' || relPath === undefined) return undefined

  if (groups.symbol === '\u{1F4C1}') {
    const meta = /^(?<count>\d+) files,\s*(?<size>\d+) bytes$/u.exec(groups.meta ?? '')?.groups
    const fileCount = meta?.count === undefined ? undefined : safeInteger(meta.count)
    const totalSize = meta?.size === undefined ? undefined : safeInteger(meta.size)
    if (fileCount === undefined || totalSize === undefined) return undefined
    return {
      rootId: rootIdFromPath(relPath),
      name,
      kind: 'folder',
      relPath,
      fileCount,
      totalSize,
    }
  }

  const size = /^(?<size>\d+) bytes$/u.exec(groups.meta ?? '')?.groups?.size
  const totalSize = size === undefined ? undefined : safeInteger(size)
  if (totalSize === undefined) return undefined
  return {
    rootId: rootIdFromPath(relPath),
    name,
    kind: 'file',
    relPath,
    fileCount: 1,
    totalSize,
  }
}

function textContent(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content.flatMap(block => (
    isRecord(block) && block.type === 'text' && typeof block.text === 'string' ? [block.text] : []
  )).join('\n')
}

/** Parse notices written before attachment metadata moved onto the human message. */
export function readLegacyAttachmentHistory(
  source: unknown,
  content: unknown,
  fallbackBatchId: string,
): LegacyAttachmentHistory | undefined {
  if (
    !isRecord(source)
    || source.kind !== 'plugin'
    || source.plugin !== PLUGIN_NAME
    || Object.hasOwn(source, 'historyHandledBy')
  ) return undefined

  const roots = textContent(content).split(/\r?\n/u).flatMap(line => {
    const root = parseReference(line)
    return root === undefined ? [] : [root]
  })
  if (roots.length === 0) return undefined
  return {
    batchId: typeof source.batchId === 'string' ? source.batchId : fallbackBatchId,
    roots,
  }
}
