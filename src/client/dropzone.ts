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

const OVERLAY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4"/><path d="m6 10 6-6 6 6"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>'

let overlayElement: HTMLDivElement | undefined

function setOverlayVisible(visible: boolean): void {
  if (visible) {
    if (overlayElement !== undefined) return
    const element = document.createElement('div')
    element.className = 'dua-drop-overlay'
    element.dataset.plugin = 'dsh-airdrop'
    element.setAttribute('role', 'status')
    const card = document.createElement('div')
    card.className = 'dua-drop-card'
    const icon = document.createElement('span')
    icon.className = 'dua-drop-icon'
    icon.setAttribute('aria-hidden', 'true')
    icon.innerHTML = OVERLAY_ICON
    const title = document.createElement('strong')
    title.textContent = tr('drop.title')
    const sub = document.createElement('small')
    sub.textContent = tr('drop.sub')
    card.append(icon, title, sub)
    element.append(card)
    document.body.append(element)
    overlayElement = element
    return
  }
  overlayElement?.remove()
  overlayElement = undefined
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
    if (!hasFiles(event.dataTransfer) || env.store.current() === undefined) {
      reset()
      return
    }
    claimDrag(event)
    dragDepth += 1
    setOverlayVisible(true)
  }
  const dragOver = (event: DragEvent): void => {
    if (!hasFiles(event.dataTransfer) || env.store.current() === undefined) {
      reset()
      return
    }
    claimDrag(event)
    setOverlayVisible(true)
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy'
  }
  const dragLeave = (event: DragEvent): void => {
    if (!hasFiles(event.dataTransfer) || env.store.current() === undefined) {
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
    reset()
    if (current === undefined || transfer === null || !hasFiles(transfer)) return
    // Own file drops anywhere in the window before DSH's document-level
    // native image handler or the browser's default navigation sees them.
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
      console.error('[dsh-airdrop] drop failed', error)
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
