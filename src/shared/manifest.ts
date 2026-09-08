export const ATTACHMENT_MANIFEST_VERSION = 1
export const ATTACHMENT_SOURCE_FIELD = 'airdrop'
export const ATTACHMENT_ONLY_DRAFT_MARKER = '\u2063'
export const ATTACHMENT_ONLY_SOURCE_FIELD = 'airdropOnly'
/** Pre-rename field spellings persisted in older session logs; read-only compat. */
export const LEGACY_ATTACHMENT_SOURCE_FIELD = 'universalAttachments'
export const LEGACY_ATTACHMENT_ONLY_SOURCE_FIELD = 'universalAttachmentsOnly'
export interface AttachmentHistoryRoot {
  readonly rootId: string
  readonly name: string
  readonly kind: 'file' | 'folder'
  readonly relPath: string
  readonly fileCount: number
  readonly totalSize: number
  readonly mime?: string
  readonly nativeImage?: boolean
}

export interface AttachmentHistoryManifest {
  readonly version: typeof ATTACHMENT_MANIFEST_VERSION
  readonly batchId: string
  readonly roots: readonly AttachmentHistoryRoot[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function parseRoot(value: unknown): AttachmentHistoryRoot | undefined {
  if (!isRecord(value)) return undefined
  if (
    typeof value.rootId !== 'string'
    || typeof value.name !== 'string'
    || (value.kind !== 'file' && value.kind !== 'folder')
    || typeof value.relPath !== 'string'
    || !nonNegativeInteger(value.fileCount)
    || !nonNegativeInteger(value.totalSize)
  ) return undefined
  if (value.mime !== undefined && typeof value.mime !== 'string') return undefined
  if (value.nativeImage !== undefined && typeof value.nativeImage !== 'boolean') return undefined
  return {
    rootId: value.rootId,
    name: value.name,
    kind: value.kind,
    relPath: value.relPath,
    fileCount: value.fileCount,
    totalSize: value.totalSize,
    ...(value.mime === undefined ? {} : { mime: value.mime }),
    ...(value.nativeImage === undefined ? {} : { nativeImage: value.nativeImage }),
  }
}

export function readAttachmentManifest(source: unknown): AttachmentHistoryManifest | undefined {
  if (!isRecord(source)) return undefined
  const value = source[ATTACHMENT_SOURCE_FIELD] ?? source[LEGACY_ATTACHMENT_SOURCE_FIELD]
  if (!isRecord(value) || value.version !== ATTACHMENT_MANIFEST_VERSION || typeof value.batchId !== 'string') {
    return undefined
  }
  if (!Array.isArray(value.roots)) return undefined
  const roots = value.roots.map(parseRoot)
  if (roots.some(root => root === undefined)) return undefined
  return {
    version: ATTACHMENT_MANIFEST_VERSION,
    batchId: value.batchId,
    roots: roots as AttachmentHistoryRoot[],
  }
}

export function isAttachmentOnlySource(source: unknown): boolean {
  return isRecord(source)
    && (source[ATTACHMENT_ONLY_SOURCE_FIELD] === true || source[LEGACY_ATTACHMENT_ONLY_SOURCE_FIELD] === true)
}
