import { useSyncExternalStore, type ReactNode } from 'react'
import { DropOverlay } from '@deepseek-ai/dsh-client-ui-attachment'
import { rootsFromDrop, rootsFromFiles, type UploadRoot } from './files.js'
import { tr } from './locales.js'
import type { ComposerCapture, InputActionsFace, UploadStore } from './store.js'

export interface DropzoneEnv {
  readonly store: UploadStore
  readonly intake: (
    sessionId: string,
    roots: readonly UploadRoot[],
    inputActions?: InputActionsFace,
    preparationId?: string,
  ) => Promise<unknown>
}

let overlayVisible = false
const overlayListeners = new Set<() => void>()

function setOverlayVisible(visible: boolean): void {
  if (overlayVisible === visible) return
  overlayVisible = visible
  for (const listener of overlayListeners) listener()
}

function subscribeOverlay(listener: () => void): () => void {
  overlayListeners.add(listener)
  return () => { overlayListeners.delete(listener) }
}

export function DropOverlayHost(): ReactNode {
  const visible = useSyncExternalStore(subscribeOverlay, () => overlayVisible, () => false)
  if (!visible) return null
  return (
    <DropOverlay
      disabled={false}
      labels={{ title: tr('drop.title'), desc: tr('drop.sub') }}
    />
  )
}

function hasFiles(transfer: DataTransfer | null): boolean {
  return transfer !== null && [...transfer.types].includes('Files')
}

function targetsComposer(event: Event, capture: ComposerCapture): boolean {
  return capture.dropTarget.matches('[data-composer-seat]')
    && event.composedPath().includes(capture.dropTarget)
}

export function installDropzone(env: DropzoneEnv): () => void {
  let dragDepth = 0
  const reset = (): void => {
    dragDepth = 0
    setOverlayVisible(false)
  }
  const claimDrag = (event: DragEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
  }

  const dragEnter = (event: DragEvent): void => {
    const current = env.store.current()
    if (
      !hasFiles(event.dataTransfer)
      || current === undefined
      || !targetsComposer(event, current)
    ) {
      reset()
      return
    }
    claimDrag(event)
    dragDepth += 1
    setOverlayVisible(true)
  }
  const dragOver = (event: DragEvent): void => {
    const current = env.store.current()
    if (
      !hasFiles(event.dataTransfer)
      || current === undefined
      || !targetsComposer(event, current)
    ) {
      reset()
      return
    }
    claimDrag(event)
    setOverlayVisible(true)
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy'
  }
  const dragLeave = (event: DragEvent): void => {
    const current = env.store.current()
    if (
      !hasFiles(event.dataTransfer)
      || current === undefined
      || !targetsComposer(event, current)
    ) {
      reset()
      return
    }
    claimDrag(event)
    dragDepth = Math.max(0, dragDepth - 1)
    const leavingViewport = event.clientX <= 0
      || event.clientY <= 0
      || event.clientX >= window.innerWidth
      || event.clientY >= window.innerHeight
    if (dragDepth === 0 || leavingViewport) reset()
  }
  const drop = (event: DragEvent): void => {
    const current = env.store.current()
    const transfer = event.dataTransfer
    const withinComposer = current !== undefined && targetsComposer(event, current)
    reset()
    if (current === undefined || transfer === null || !hasFiles(transfer) || !withinComposer) return
    // Own file drops before DSH's document-level native image handler sees them.
    claimDrag(event)
    const preparationId = env.store.beginPreparation(current.sessionId)
    const roots = rootsFromDrop(transfer)
    void roots.then(items => {
      if (items.length === 0) {
        env.store.failPreparation(current.sessionId, preparationId, tr('drop.empty'))
        return
      }
      return env.intake(current.sessionId, items, current.inputActions, preparationId)
    }).catch(error => {
      env.store.failPreparation(current.sessionId, preparationId, error instanceof Error ? error.message : String(error))
      console.error('[dsh-universal-attachments] drop failed', error)
    })
  }
  const paste = (event: ClipboardEvent): void => {
    const current = env.store.current()
    const files = [...(event.clipboardData?.files ?? [])]
    if (current === undefined || files.length === 0 || !targetsComposer(event, current)) return
    event.preventDefault()
    event.stopPropagation()
    void env.intake(current.sessionId, rootsFromFiles(files), current.inputActions)
  }

  window.addEventListener('dragenter', dragEnter, true)
  window.addEventListener('dragover', dragOver, true)
  window.addEventListener('dragleave', dragLeave, true)
  window.addEventListener('drop', drop, true)
  window.addEventListener('dragend', reset, true)
  window.addEventListener('blur', reset, true)
  window.addEventListener('paste', paste, true)

  return () => {
    reset()
    window.removeEventListener('dragenter', dragEnter, true)
    window.removeEventListener('dragover', dragOver, true)
    window.removeEventListener('dragleave', dragLeave, true)
    window.removeEventListener('drop', drop, true)
    window.removeEventListener('dragend', reset, true)
    window.removeEventListener('blur', reset, true)
    window.removeEventListener('paste', paste, true)
  }
}
