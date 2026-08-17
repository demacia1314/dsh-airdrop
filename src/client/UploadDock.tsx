import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from 'react'
import {
  AttachmentRail,
  type AttachmentRailItem,
} from '@deepseek-ai/dsh-client-ui-attachment'
import {
  Button,
  IconCloseOutline16,
  IconFolderClose16,
  IconLoadingOutline16,
  IconPaperclipOutline16,
  IconPlayOutline16,
  IconSendOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { formatSize } from './intake.js'
import { rpcText, tr, type Key, type LocaleProps } from './locales.js'
import { RootPreview } from './preview.js'
import type { UploadStore } from './store.js'
import type { DraftSummary, RootSummary, UniversalAttachmentsCalls } from './types.js'

export interface UploadDockProps extends LocaleProps {
  readonly sessionId?: SessionId
  readonly input?: {
    readonly draft: string
    readonly imageIds?: readonly unknown[]
    readonly draftRev?: number
  }
  readonly store?: UploadStore
  readonly api?: () => UniversalAttachmentsCalls | undefined
}

interface ImageRailRoot extends AttachmentRailItem {
  readonly root: RootSummary
}

interface NativeSubmissionLatch {
  readonly draftId: string
  readonly rootIds: readonly string[]
}

function progressFor(root: RootSummary, localProgress: number | undefined): number {
  return Math.min(1, localProgress ?? (root.totalSize === 0 ? 1 : root.completedSize / root.totalSize))
}

function statusText(
  root: RootSummary,
  localProgress: number | undefined,
  localError: string | undefined,
  lc: (key: Key, params?: Record<string, unknown>) => string,
): string | undefined {
  if (localError !== undefined) return lc('upload.failed', { message: localError })
  if (root.status === 'ready') return undefined
  return lc('upload.progress', { percent: Math.round(progressFor(root, localProgress) * 100) })
}

function metaText(
  root: RootSummary,
  lc: (key: Key, params?: Record<string, unknown>) => string,
): string {
  return root.kind === 'folder'
    ? lc('upload.folderMeta', { count: root.fileCount, size: formatSize(root.totalSize) })
    : lc('upload.fileMeta', { size: formatSize(root.totalSize) })
}

function FileVisual({ root, store }: { readonly root: RootSummary; readonly store: UploadStore | undefined }): ReactNode {
  const local = store?.root(root.rootId)
  if (root.kind === 'folder') {
    return <span className="dua-file-visual dua-file-folder" aria-hidden="true"><IconFolderClose16 size={18} /></span>
  }
  if (local?.previewUrl !== undefined && local.previewMime?.startsWith('video/')) {
    return (
      <span className="dua-file-visual dua-file-video" aria-hidden="true">
        <video src={local.previewUrl} muted preload="metadata" />
        <span><IconPlayOutline16 size={14} /></span>
      </span>
    )
  }
  return <span className="dua-file-visual dua-file-generic" aria-hidden="true"><IconPaperclipOutline16 size={17} /></span>
}

export function UploadDock({ sessionId, input, store, api, t }: UploadDockProps): ReactNode {
  const key = sessionId as unknown as string | undefined
  const lc = t ?? tr
  const previewRequests = useRef(new Set<string>())
  const previousNativeInput = useRef({ imageCount: input?.imageIds?.length ?? 0, draftRev: input?.draftRev ?? 0 })
  const version = useSyncExternalStore(
    store?.subscribe ?? (() => () => {}),
    () => key === undefined ? 0 : store?.version(key) ?? 0,
    () => 0,
  )
  const [draft, setDraft] = useState<DraftSummary | null>(null)
  const [previewRoot, setPreviewRoot] = useState<RootSummary>()
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string>()
  const [nativeSubmission, setNativeSubmission] = useState<NativeSubmissionLatch>()

  useEffect(() => {
    if (key === undefined) return
    let disposed = false
    let inFlight = false
    const pull = (): void => {
      if (inFlight) return
      const calls = api?.()
      if (calls === undefined) return
      inFlight = true
      void calls.listDraft(key).then(result => {
        if (!disposed && result.ok) {
          const next = result.value.draft
          store?.reconcilePreparations(key, new Set(next?.roots.map(root => root.rootId) ?? []))
          setDraft(previous => {
            const retained = new Set(next?.roots.map(root => root.rootId) ?? [])
            for (const root of previous?.roots ?? []) {
              if (!retained.has(root.rootId)) {
                previewRequests.current.delete(root.rootId)
                store?.clearRoot(root.rootId)
              }
            }
            return next
          })
        }
      }).catch(() => undefined).finally(() => { inFlight = false })
    }
    pull()
    const timer = window.setInterval(pull, 1500)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [api, key, version])

  useEffect(() => {
    if (key === undefined || draft === null) return
    const calls = api?.()
    if (calls === undefined) return
    for (const root of draft.roots) {
      if (
        root.kind !== 'file'
        || root.status !== 'ready'
        || store?.root(root.rootId)?.previewUrl !== undefined
        || previewRequests.current.has(root.rootId)
      ) continue
      previewRequests.current.add(root.rootId)
      void calls.issuePreview(key, root.relPath).then(result => {
        if (!result.ok) throw new Error(result.error.message)
        if (!/^(?:image|video|audio)\//u.test(result.value.mime)) return
        store?.patchRoot(root.rootId, {
          previewUrl: new URL(result.value.url, location.origin).toString(),
          previewMime: result.value.mime,
        })
        store?.bump(key)
      }).catch(() => {
        previewRequests.current.delete(root.rootId)
      })
    }
  }, [api, draft, key, store])

  const preparations = key === undefined ? [] : store?.preparations(key) ?? []
  const roots = draft?.roots ?? []
  const attachmentDraftId = draft?.draftId
  const attachmentOnlyReady = roots.length > 0
    && preparations.length === 0
    && roots.every(root => root.status === 'ready' && store?.root(root.rootId)?.error === undefined)
  const inputDraft = input?.draft ?? ''
  const hasNativeImages = (input?.imageIds?.length ?? 0) > 0
  const nativeImageCount = input?.imageIds?.length ?? 0
  const inputDraftRev = input?.draftRev ?? 0
  const awaitingNativeSubmission = nativeSubmission !== undefined
    && nativeSubmission.draftId === attachmentDraftId
    && nativeSubmission.rootIds.some(rootId => roots.some(root => root.rootId === rootId))

  useEffect(() => {
    const previous = previousNativeInput.current
    previousNativeInput.current = { imageCount: nativeImageCount, draftRev: inputDraftRev }
    const nativeCommit = previous.imageCount > 0
      && nativeImageCount === 0
      && previous.draftRev !== inputDraftRev
    let next = nativeSubmission
    if (next !== undefined) {
      const stillVisible = next.draftId === attachmentDraftId
        && next.rootIds.some(rootId => roots.some(root => root.rootId === rootId))
      if (!stillVisible || nativeImageCount > 0) next = undefined
    }
    if (nativeCommit && attachmentOnlyReady && attachmentDraftId !== undefined) {
      next = {
        draftId: attachmentDraftId,
        rootIds: roots.map(root => root.rootId),
      }
    }
    if (next !== nativeSubmission) setNativeSubmission(next)
  }, [attachmentDraftId, attachmentOnlyReady, inputDraftRev, nativeImageCount, nativeSubmission, roots])

  const imageRoots = roots.filter(root => {
    const local = store?.root(root.rootId)
    return local !== undefined
      && local.error === undefined
      && local.previewUrl !== undefined
      && local.previewMime?.startsWith('image/') === true
  })
  const imageIds = new Set(imageRoots.map(root => root.rootId))
  const otherRoots = roots.filter(root => !imageIds.has(root.rootId))
  const imageItems: readonly ImageRailRoot[] = imageRoots.flatMap(root => {
    const previewUrl = store?.root(root.rootId)?.previewUrl
    return previewUrl === undefined ? [] : [{
      id: root.rootId,
      previewUrl,
      alt: root.name,
      removeLabel: lc('upload.remove', { name: root.name }),
      root,
    }]
  })
  if (key === undefined || (roots.length === 0 && preparations.length === 0)) return null

  const submitAttachments = (): void => {
    const calls = api?.()
    if (
      calls === undefined
      || draft === null
      || !attachmentOnlyReady
      || inputDraft.trim() !== ''
      || hasNativeImages
      || awaitingNativeSubmission
      || submitting
    ) return
    const submittedDraft = draft
    setSubmitting(true)
    setSubmitError(undefined)
    void calls.submitDraft(key, submittedDraft.draftId).then(result => {
      if (!result.ok) throw new Error(rpcText(result.error))
      const submittedRootIds = new Set(result.value.rootIds)
      setDraft(current => {
        if (current?.draftId !== submittedDraft.draftId) return current
        const remaining = current.roots.filter(root => !submittedRootIds.has(root.rootId))
        return remaining.length === 0 ? null : { ...current, roots: remaining }
      })
      setPreviewRoot(current => current !== undefined && submittedRootIds.has(current.rootId) ? undefined : current)
      for (const rootId of submittedRootIds) {
        previewRequests.current.delete(rootId)
        store?.clearRoot(rootId)
      }
      store?.bump(key)
    }).catch(error => {
      setSubmitError(error instanceof Error ? error.message : String(error))
    }).finally(() => {
      setSubmitting(false)
    })
  }

  const remove = (root: RootSummary): void => {
    const calls = api?.()
    if (calls === undefined || draft === null) return
    void calls.removeRoot(key, draft.draftId, root.rootId).finally(() => {
      if (previewRoot?.rootId === root.rootId) setPreviewRoot(undefined)
      previewRequests.current.delete(root.rootId)
      store?.clearRoot(root.rootId)
      store?.bump(key)
    })
  }

  const open = (root: RootSummary): void => {
    setPreviewRoot(root)
  }

  return (
    <div className="dua-dock" data-plugin="dsh-universal-attachments">
      {imageItems.length > 0 && (
        <div className="dua-native-image-rail">
          <AttachmentRail
            items={imageItems}
            labels={{
              group: lc('upload.images'),
              open: lc('history.preview'),
              scrollLeft: lc('upload.scrollLeft'),
              scrollRight: lc('upload.scrollRight'),
            }}
            onOpen={item => { open(item.root) }}
            onRemove={item => { remove(item.root) }}
          />
        </div>
      )}

      {(preparations.length > 0 || otherRoots.length > 0) && (
        <div className="dua-file-list">
          {preparations.map(preparation => (
            <article
              className={`dua-file-row dua-file-preparing ${preparation.error !== undefined ? 'dua-file-error' : ''}`}
              key={preparation.id}
            >
              <span className="dua-file-visual dua-file-generic dua-file-spinner" aria-hidden="true">
                <IconLoadingOutline16 size={17} />
              </span>
              <span className="dua-file-copy">
                <strong>{lc('drop.pending')}</strong>
                <small>{preparation.error === undefined
                  ? lc('upload.preparing')
                  : lc('upload.failed', { message: preparation.error })}</small>
              </span>
              {preparation.error !== undefined && (
                <button
                  type="button"
                  className="dua-file-remove"
                  title={lc('upload.remove', { name: lc('drop.pending') })}
                  aria-label={lc('upload.remove', { name: lc('drop.pending') })}
                  onClick={() => { store?.clearPreparation(key, preparation.id) }}
                >
                  <IconCloseOutline16 size={13} />
                </button>
              )}
              {preparation.error === undefined && <span className="dua-file-progress dua-progress-indeterminate" />}
            </article>
          ))}

          {otherRoots.map(root => {
            const local = store?.root(root.rootId)
            const progress = progressFor(root, local?.progress)
            const status = statusText(root, local?.progress, local?.error, lc)
            const meta = metaText(root, lc)
            return (
              <article className={`dua-file-row ${local?.error !== undefined ? 'dua-file-error' : ''}`} key={root.rootId}>
                <button
                  type="button"
                  className="dua-file-open"
                  title={lc('upload.preview', { name: root.name })}
                  onClick={() => { open(root) }}
                >
                  <FileVisual root={root} store={store} />
                  <span className="dua-file-copy">
                    <strong>{root.name}</strong>
                    <small>{status === undefined ? meta : `${meta} \u00b7 ${status}`}</small>
                  </span>
                </button>
                <button
                  type="button"
                  className="dua-file-remove"
                  title={lc('upload.remove', { name: root.name })}
                  aria-label={lc('upload.remove', { name: root.name })}
                  onClick={() => { remove(root) }}
                >
                  <IconCloseOutline16 size={13} />
                </button>
                {root.status !== 'ready' && local?.error === undefined && (
                  <span
                    className="dua-file-progress"
                    style={{ '--dua-progress': `${Math.round(progress * 100)}%` } as CSSProperties}
                  />
                )}
              </article>
            )
          })}
        </div>
      )}
      {inputDraft.trim() === '' && !hasNativeImages && !awaitingNativeSubmission && (
        <div className="dua-submit-row">
          {submitError !== undefined && <span role="alert">{submitError}</span>}
          <Button
            type="button"
            variant="primary"
            size="sm"
            icon={<IconSendOutline16 />}
            className="dua-submit-button"
            disabled={!attachmentOnlyReady || submitting}
            aria-busy={submitting || undefined}
            onClick={submitAttachments}
          >
            {submitting ? lc('upload.sending') : lc('upload.send')}
          </Button>
        </div>
      )}
      {store !== undefined && api !== undefined && draft !== null && (
        <RootPreview
          env={{ api, store }}
          sessionId={key}
          draftId={draft.draftId}
          root={previewRoot}
          onClose={() => { setPreviewRoot(undefined) }}
        />
      )}
    </div>
  )
}
