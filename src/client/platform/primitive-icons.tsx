import { createElement, type ComponentType } from 'react'
import * as Primitives from '@deepseek-ai/dsh-client-ui-primitives'

interface IconProps {
  readonly size?: number
  readonly className?: string
}

type IconComponent = ComponentType<IconProps>
const registry = Primitives as unknown as Record<string, unknown>

/**
 * DSH 0.2.1 renamed numeric icon exports to weight-based names. Prefer the
 * current export and fall back to the 0.1.5 name so one client bundle can run
 * on both supported host lines.
 */
function icon(current: string, legacy: string): IconComponent {
  return function CompatIcon(props: IconProps) {
    const candidate = registry[current] ?? registry[legacy]
    if (typeof candidate !== 'function' && (typeof candidate !== 'object' || candidate === null)) {
      throw new Error(`dsh-airdrop: missing UI primitive ${current} / ${legacy}`)
    }
    return createElement(candidate as IconComponent, props)
  }
}

export const IconChevronLeftOutline14 = icon('IconChevronLeftOutlineMedium', 'IconChevronLeftOutline14')
export const IconChevronRightOutline14 = icon('IconChevronRightOutlineMedium', 'IconChevronRightOutline14')
export const IconCloseFill14 = icon('IconCloseFillMedium', 'IconCloseFill14')
export const IconCloseOutline16 = icon('IconCloseOutlineMedium', 'IconCloseOutline16')
export const IconDownloadOutline16 = icon('IconDownloadOutlineMedium', 'IconDownloadOutline16')
export const IconFolderClose16 = icon('IconFolderCloseMedium', 'IconFolderClose16')
export const IconFolderOpenOutline16 = icon('IconFolderOpenOutlineMedium', 'IconFolderOpenOutline16')
export const IconLoadingOutline16 = icon('IconLoadingOutlineMedium', 'IconLoadingOutline16')
export const IconPaperclipOutline16 = icon('IconPaperclipOutlineMedium', 'IconPaperclipOutline16')
export const IconPlayOutline16 = icon('IconPlayOutlineMedium', 'IconPlayOutline16')
