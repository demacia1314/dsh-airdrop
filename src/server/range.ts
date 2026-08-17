export type ParsedRange =
  | { readonly kind: 'full'; readonly start: 0; readonly end: number; readonly length: number }
  | { readonly kind: 'partial'; readonly start: number; readonly end: number; readonly length: number }
  | { readonly kind: 'unsatisfiable' }

const DECIMAL = /^\d+$/u

/** Parse one RFC 9110 byte range. Multiple ranges are deliberately unsupported. */
export function parseSingleRange(header: string | undefined, size: number): ParsedRange {
  if (!Number.isSafeInteger(size) || size < 0) throw new Error('Invalid content size')
  if (header === undefined) {
    return { kind: 'full', start: 0, end: size === 0 ? -1 : size - 1, length: size }
  }
  if (!header.startsWith('bytes=') || header.includes(',')) return { kind: 'unsatisfiable' }
  const value = header.slice('bytes='.length).trim()
  const separator = value.indexOf('-')
  if (separator < 0 || value.indexOf('-', separator + 1) >= 0) return { kind: 'unsatisfiable' }
  if (size === 0) return { kind: 'unsatisfiable' }

  const startText = value.slice(0, separator).trim()
  const endText = value.slice(separator + 1).trim()
  if (startText === '') {
    if (!DECIMAL.test(endText)) return { kind: 'unsatisfiable' }
    const suffix = Number(endText)
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return { kind: 'unsatisfiable' }
    const length = Math.min(size, suffix)
    return { kind: 'partial', start: size - length, end: size - 1, length }
  }
  if (!DECIMAL.test(startText) || (endText !== '' && !DECIMAL.test(endText))) {
    return { kind: 'unsatisfiable' }
  }

  const start = Number(startText)
  const requestedEnd = endText === '' ? size - 1 : Number(endText)
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start >= size || requestedEnd < start) {
    return { kind: 'unsatisfiable' }
  }
  const end = Math.min(requestedEnd, size - 1)
  return { kind: 'partial', start, end, length: end - start + 1 }
}

export interface ContentResponsePlan {
  readonly status: 200 | 206 | 416
  readonly start: number
  readonly end: number
  readonly length: number
  readonly contentRange?: string
}

export function planContentResponse(rangeHeader: string | undefined, size: number): ContentResponsePlan {
  const parsed = parseSingleRange(rangeHeader, size)
  if (parsed.kind === 'unsatisfiable') {
    return { status: 416, start: 0, end: -1, length: 0, contentRange: `bytes */${size}` }
  }
  if (parsed.kind === 'partial') {
    return {
      status: 206,
      start: parsed.start,
      end: parsed.end,
      length: parsed.length,
      contentRange: `bytes ${parsed.start}-${parsed.end}/${size}`,
    }
  }
  return { status: 200, start: parsed.start, end: parsed.end, length: parsed.length }
}
