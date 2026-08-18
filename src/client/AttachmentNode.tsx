import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  IconArchiveOutline20,
  IconCodeOutline16,
  IconFolderClose16,
  IconPaperclipOutline16,
  IconPlayOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { AttachmentHistoryRoot } from '../shared/manifest.js'
import { fileExtension, fileVisualKind } from './filekind.js'
import { formatSize } from './intake.js'
import { tr, type LocaleProps } from './locales.js'
import { RootPreview } from './preview.js'
import type { UploadStore } from './store.js'
import type { RootSummary, UniversalAttachmentsCalls } from './types.js'

export interface StoredAttachmentPreview {
  readonly url: string
  readonly mime: string
}

export interface AttachmentNodeProps
  extends Omit<ChatNodeViewProps<'universal-attachments'>, 't'>,
  LocaleProps {
  readonly resolvePreview?: (
    sessionId: string,
    root: AttachmentHistoryRoot,
  ) => Promise<StoredAttachmentPreview | undefined>
  readonly api?: () => UniversalAttachmentsCalls | undefined
  readonly store?: UploadStore
}

function storedRootSummary(root: AttachmentHistoryRoot): RootSummary {
  return {
    rootId: root.rootId,
    name: root.name,
    kind: root.kind,
    relPath: root.relPath,
    fileCount: root.fileCount,
    totalSize: root.totalSize,
    completedFiles: root.fileCount,
    completedSize: root.totalSize,
    status: 'ready',
  }
}

function meta(root: AttachmentHistoryRoot): string {
  if (root.kind === 'folder') return `${root.fileCount.toLocaleString()} · ${formatSize(root.totalSize)}`
  return formatSize(root.totalSize)
}

function AttachmentVisual({ root, preview }: {
  readonly root: AttachmentHistoryRoot
  readonly preview: StoredAttachmentPreview | undefined
}): ReactNode {
  if (root.kind === 'folder') {
    return <span className="dua-chat-visual dua-chat-folder" aria-hidden="true"><IconFolderClose16 size={18} /></span>
  }
  if (preview?.mime.startsWith('image/') === true) {
    return <span className="dua-chat-visual dua-chat-media" aria-hidden="true"><img src={preview.url} alt="" /></span>
  }
  if (preview?.mime.startsWith('video/') === true) {
    return (
      <span className="dua-chat-visual dua-chat-media" aria-hidden="true">
        <video src={preview.url} muted preload="metadata" />
        <span className="dua-chat-play"><IconPlayOutline16 size={13} /></span>
      </span>
    )
  }
  const kind = fileVisualKind(root.name, root.mime)
  const icon = kind === 'archive'
    ? <IconArchiveOutline20 size={15} />
    : kind === 'code'
      ? <IconCodeOutline16 size={15} />
      : kind === 'audio'
        ? <IconPlayOutline16 size={13} />
        : <IconPaperclipOutline16 size={15} />
  return (
    <span className={`dua-chat-visual dua-chat-file dua-kind-${kind}`} aria-hidden="true">
      {icon}
      <small>{fileExtension(root.name)}</small>
    </span>
  )
}

export function AttachmentNode({
  node,
  sessionId,
  resolvePreview,
  api,
  store,
  t,
}: AttachmentNodeProps): ReactNode {
  const lc = t ?? tr
  const roots = node.data.roots
  const key = String(sessionId)
  const [previews, setPreviews] = useState<Readonly<Record<string, StoredAttachmentPreview>>>({})
  const [selectedRoot, setSelectedRoot] = useState<AttachmentHistoryRoot>()
  const previewable = useMemo(() => roots.filter(root => (
    root.kind === 'file'
    && /^(?:image|video)\//u.test(root.mime ?? '')
  )), [roots])

  useEffect(() => {
    if (resolvePreview === undefined || previewable.length === 0) return
    let disposed = false
    for (const root of previewable) {
      void resolvePreview(key, root).then(preview => {
        if (disposed || preview === undefined) return
        setPreviews(current => ({ ...current, [root.rootId]: preview }))
      }).catch(() => undefined)
    }
    return () => { disposed = true }
  }, [key, previewable, resolvePreview])

  return (
    <div className="dua-chat-row" data-plugin="dsh-universal-attachments">
      <div className="dua-chat-attachments" role="group" aria-label={lc('history.attachments')}>
        {roots.map(root => (
          <button
            type="button"
            className="dua-chat-attachment"
            key={root.rootId}
            title={lc('upload.preview', { name: root.name })}
            onClick={() => { setSelectedRoot(root) }}
          >
            <AttachmentVisual root={root} preview={previews[root.rootId]} />
            <span className="dua-chat-copy">
              <strong>{root.name}</strong>
              <small>{meta(root)}</small>
            </span>
          </button>
        ))}
      </div>
      {api !== undefined && store !== undefined && (
        <RootPreview
          env={{ api, store }}
          sessionId={key}
          root={selectedRoot === undefined ? undefined : storedRootSummary(selectedRoot)}
          onClose={() => { setSelectedRoot(undefined) }}
        />
      )}
    </div>
  )
}
