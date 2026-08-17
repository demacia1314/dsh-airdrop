export interface InputActionsFace {
  setDraft(text: string): void
}

export interface ComposerCapture {
  readonly sessionId: string
  readonly inputActions: InputActionsFace | undefined
  readonly dropTarget: HTMLElement
}

export interface LocalRootState {
  readonly previewUrl?: string
  readonly previewMime?: string
  readonly progress?: number
  readonly error?: string
}

export interface DropPreparation {
  readonly id: string
  readonly rootIds?: readonly string[]
  readonly error?: string
}

export interface UploadStore {
  subscribe(listener: () => void): () => void
  version(sessionId: string): number
  bump(sessionId: string): void
  capture(entry: ComposerCapture): () => void
  current(): ComposerCapture | undefined
  beginPreparation(sessionId: string): string
  preparations(sessionId: string): readonly DropPreparation[]
  markPreparationPrepared(sessionId: string, preparationId: string, rootIds: readonly string[]): void
  failPreparation(sessionId: string, preparationId: string, error: string): void
  clearPreparation(sessionId: string, preparationId: string): void
  reconcilePreparations(sessionId: string, rootIds: ReadonlySet<string>): void
  setRoot(rootId: string, state: LocalRootState): void
  patchRoot(rootId: string, state: Partial<LocalRootState>): void
  root(rootId: string): LocalRootState | undefined
  clearRoot(rootId: string): void
  dispose(): void
}

export function createUploadStore(): UploadStore {
  const versions = new Map<string, number>()
  const localRoots = new Map<string, LocalRootState>()
  const dropPreparations = new Map<string, Map<string, DropPreparation>>()
  const listeners = new Set<() => void>()
  let captured: ComposerCapture | undefined
  let captureToken: symbol | undefined

  const emit = (): void => {
    for (const listener of listeners) listener()
  }

  const bump = (sessionId: string): void => {
    versions.set(sessionId, (versions.get(sessionId) ?? 0) + 1)
    emit()
  }

  const preparationMap = (sessionId: string): Map<string, DropPreparation> => {
    const existing = dropPreparations.get(sessionId)
    if (existing !== undefined) return existing
    const created = new Map<string, DropPreparation>()
    dropPreparations.set(sessionId, created)
    return created
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    version: sessionId => versions.get(sessionId) ?? 0,
    bump,
    capture(entry) {
      const token = Symbol('composer-capture')
      captured = entry
      captureToken = token
      return () => {
        if (captureToken !== token) return
        captured = undefined
        captureToken = undefined
      }
    },
    current: () => captured,
    beginPreparation(sessionId) {
      const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
      preparationMap(sessionId).set(id, { id })
      bump(sessionId)
      return id
    },
    preparations: sessionId => [...(dropPreparations.get(sessionId)?.values() ?? [])],
    markPreparationPrepared(sessionId, preparationId, rootIds) {
      const preparations = dropPreparations.get(sessionId)
      const previous = preparations?.get(preparationId)
      if (preparations === undefined || previous === undefined) return
      preparations.set(preparationId, { id: preparationId, rootIds: [...rootIds] })
      bump(sessionId)
    },
    failPreparation(sessionId, preparationId, error) {
      const preparations = dropPreparations.get(sessionId)
      if (preparations?.has(preparationId) !== true) return
      preparations.set(preparationId, { id: preparationId, error })
      bump(sessionId)
    },
    clearPreparation(sessionId, preparationId) {
      const preparations = dropPreparations.get(sessionId)
      if (preparations?.delete(preparationId) !== true) return
      if (preparations.size === 0) dropPreparations.delete(sessionId)
      bump(sessionId)
    },
    reconcilePreparations(sessionId, rootIds) {
      const preparations = dropPreparations.get(sessionId)
      if (preparations === undefined) return
      let changed = false
      for (const [id, preparation] of preparations) {
        if (preparation.rootIds === undefined) continue
        const visible = preparation.rootIds.every(rootId => rootIds.has(rootId))
        const settled = preparation.rootIds.every(rootId => {
          const root = localRoots.get(rootId)
          return root?.error !== undefined || (root?.progress ?? 0) >= 1
        })
        if (!visible && !settled) continue
        preparations.delete(id)
        changed = true
      }
      if (!changed) return
      if (preparations.size === 0) dropPreparations.delete(sessionId)
      bump(sessionId)
    },
    setRoot(rootId, state) {
      const previous = localRoots.get(rootId)
      if (previous?.previewUrl !== undefined && previous.previewUrl !== state.previewUrl) {
        URL.revokeObjectURL(previous.previewUrl)
      }
      localRoots.set(rootId, state)
      emit()
    },
    patchRoot(rootId, state) {
      localRoots.set(rootId, { ...localRoots.get(rootId), ...state })
      emit()
    },
    root: rootId => localRoots.get(rootId),
    clearRoot(rootId) {
      const state = localRoots.get(rootId)
      if (state?.previewUrl !== undefined) URL.revokeObjectURL(state.previewUrl)
      localRoots.delete(rootId)
      emit()
    },
    dispose() {
      for (const state of localRoots.values()) {
        if (state.previewUrl !== undefined) URL.revokeObjectURL(state.previewUrl)
      }
      localRoots.clear()
      dropPreparations.clear()
      listeners.clear()
      captured = undefined
      captureToken = undefined
    },
  }
}
