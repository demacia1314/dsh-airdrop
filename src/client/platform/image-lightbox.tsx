/**
 * Document-level original-image preview (lightbox).
 *
 * Vendored from deepseek-ai/deepseek-harness (MIT License),
 * `packages/client/ui-attachment/src/ImageLightbox.tsx` @ aa6c361a9
 * (release dsh 0.1.1-rc.2; byte-identical to the 0.1.0-rc.6 file).
 *
 * Upstream ships this as a zero-cordis pure-React atom. rc.6 exported it from
 * `@deepseek-ai/dsh-client-ui-attachment`; rc.2 internalized it behind the
 * slot-registered presentation plugin. This in-repo copy keeps the plugin
 * renderable on both rc lines. See NOTICE for license and source references.
 *
 * Changes from upstream: CSS-module import replaced with plain `dua-lightbox-*`
 * class names styled by the plugin's `styles.ts` (the rc.6 npm build shipped
 * the atom without its CSS payload, so the plugin restyles it in-repo).
 */

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'

/** Lightbox strings the owner resolves from its own locale namespace. */
export interface ImageLightboxLabels {
  /** Accessible name of the preview dialog. */
  dialog: string
  /** Accessible label of the close control. */
  close: string
}

/**
 * Document-level original-image preview opened by clicking a thumbnail.
 * Closes on Escape, backdrop press, or the close control, and restores focus
 * to the opener on unmount. Rendered through a body portal: an opener inside
 * a transformed or filtered ancestor would otherwise trap the fixed backdrop
 * in that ancestor's box instead of covering the viewport.
 *
 * @param props.src - the original image URL.
 * @param props.alt - the image's alt text.
 * @param props.labels - dialog and close-control strings.
 * @param props.onClose - dismiss callback owned by the opener.
 * @returns the modal preview dialog.
 */
export function ImageLightbox({ src, alt, labels, onClose }: {
  src: string
  alt: string
  labels: ImageLightboxLabels
  onClose: () => void
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const restoreRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      restoreRef.current?.focus()
    }
  }, [onClose])

  return createPortal(
    <div
      className="dua-lightbox-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={labels.dialog}
    >
      <div className="dua-lightbox-mask" aria-hidden="true" onMouseDown={onClose} />
      <img className="dua-lightbox-image" src={src} alt={alt} />
      <button ref={closeRef} type="button" className="dua-lightbox-close" aria-label={labels.close} onClick={onClose}>
        <IconCloseOutline16 size={16} />
      </button>
    </div>,
    document.body,
  )
}
