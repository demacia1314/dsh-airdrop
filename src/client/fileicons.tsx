import type { ReactNode } from 'react'

interface GlyphProps {
  readonly size?: number
}

function glyph(path: ReactNode, size: number, viewBox = 16): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${viewBox} ${viewBox}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {path}
    </svg>
  )
}

/** Angle brackets, reads as code (the primitives' IconCodeOutline16 is a '#'). */
export function CodeGlyph({ size = 15 }: GlyphProps): ReactNode {
  return glyph(<><path d="M5.5 4.5 2 8l3.5 3.5" /><path d="M10.5 4.5 14 8l-3.5 3.5" /></>, size)
}

/** Archive box with a lid clasp. */
export function ArchiveGlyph({ size = 15 }: GlyphProps): ReactNode {
  return glyph(<><rect x="2" y="3" width="12" height="3.4" rx="0.8" /><path d="M3 6.4v5.4a1.4 1.4 0 0 0 1.4 1.4h7.2a1.4 1.4 0 0 0 1.4-1.4V6.4" /><path d="M6.6 9h2.8" /></>, size)
}

/** Document with folded corner, optionally with text lines. */
export function DocGlyph({ size = 15, lines = true }: GlyphProps & { readonly lines?: boolean }): ReactNode {
  return glyph(
    <>
      <path d="M4 1.8h5.2L12 4.6v9.6H4z" />
      <path d="M9 2v2.8h2.8" />
      {lines && <><path d="M6 8h4" /><path d="M6 10.6h4" /></>}
    </>,
    size,
  )
}
