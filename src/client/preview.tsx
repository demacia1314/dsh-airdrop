import { useEffect, useState, type ReactNode } from 'react'
import { ImageLightbox } from './platform/image-lightbox.js'
import {
  IconDownloadOutline16,
  Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { formatSize } from './intake.js'
import { rpcText, tr } from './locales.js'
import type { UploadStore } from './store.js'
import type { RootEntry, RootSummary, UniversalAttachmentsCalls } from './types.js'

export interface PreviewEnv {
  readonly api: () => UniversalAttachmentsCalls | undefined
  readonly store: UploadStore
}

export interface RootPreviewProps {
  readonly env: PreviewEnv
  readonly sessionId: string
  readonly draftId?: string
  readonly root: RootSummary | undefined
  readonly onClose: () => void
}

interface ResolvedFile {
  readonly url: string
  readonly name: string
  readonly mime: string
  readonly size: number
  readonly downloadable: boolean
}

type PreviewState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'folder'; readonly entries: readonly RootEntry[] }
  | { readonly kind: 'file'; readonly file: ResolvedFile }

const TEXT_MIMES = new Set([
  'application/json',
  'application/xml',
  'application/yaml',
  'application/toml',
  'application/javascript',
  'application/typescript',
])

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isText(name: string, mime: string): boolean {
  if (mime.startsWith('text/') || TEXT_MIMES.has(mime)) return true
  return /\.(?:md|txt|log|jsonc?|ya?ml|toml|ini|csv|tsv|tsx?|jsx?|mjs|cjs|py|rb|go|rs|java|kt|c|h|cpp|hpp|cs|php|swift|sh|sql|html?|css|scss|less|vue|svelte|env)$/iu.test(name)
}

function isPdf(name: string, mime: string): boolean {
  return mime === 'application/pdf' || name.toLowerCase().endsWith('.pdf')
}

function FolderPreview({ entries }: { readonly entries: readonly RootEntry[] }): ReactNode {
  const visible = entries.slice(0, 500)
  return (
    <div className="dua-folder-list">
      {visible.map(entry => (
        <div key={entry.entryId}>
          <span>{entry.relativePath || entry.name}</span>
          <small>{`${formatSize(entry.size)} \u00b7 ${entry.status}`}</small>
        </div>
      ))}
      {entries.length > visible.length && (
        <p className="dua-preview-note">{tr('preview.folderTruncated', { count: visible.length })}</p>
      )}
    </div>
  )
}

function TextPreview({ url }: { readonly url: string }): ReactNode {
  const [text, setText] = useState(tr('preview.loading'))

  useEffect(() => {
    let live = true
    setText(tr('preview.loading'))
    void fetch(url, {
      headers: { Range: 'bytes=0-262143' },
      credentials: 'same-origin',
    }).then(async response => {
      if (!response.ok && response.status !== 206) {
        throw new Error(`Preview request failed (${response.status})`)
      }
      const content = await response.text()
      if (live) setText(response.status === 206 ? `${content}\n\n${tr('preview.textTruncated')}` : content)
    }).catch(error => {
      if (live) setText(tr('preview.failed', { message: errorText(error) }))
    })
    return () => { live = false }
  }, [url])

  return <pre className="dua-preview-text">{text}</pre>
}

function FilePreview({ file }: { readonly file: ResolvedFile }): ReactNode {
  if (file.mime.startsWith('video/')) {
    return <video className="dua-preview-media" controls preload="metadata" src={file.url} />
  }
  if (file.mime.startsWith('audio/')) {
    return <audio className="dua-preview-audio" controls preload="metadata" src={file.url} />
  }
  if (isPdf(file.name, file.mime)) {
    return <iframe className="dua-preview-pdf" src={file.url} title={file.name} />
  }
  if (isText(file.name, file.mime)) return <TextPreview url={file.url} />
  return <p className="dua-preview-note">{tr('preview.unsupported')}</p>
}

export function RootPreview({ env, sessionId, draftId, root, onClose }: RootPreviewProps): ReactNode {
  const [state, setState] = useState<PreviewState>({ kind: 'idle' })

  useEffect(() => {
    if (root === undefined) {
      setState({ kind: 'idle' })
      return
    }

    let live = true
    const calls = env.api()
    if (calls === undefined) {
      setState({ kind: 'error', message: tr('upload.noApi') })
      return
    }
    setState({ kind: 'loading' })

    if (root.kind === 'folder') {
      const request = draftId === undefined
        ? calls.listStoredRoot(sessionId, root.rootId)
        : calls.listRoot(sessionId, draftId, root.rootId)
      void request.then(result => {
        if (!result.ok) throw new Error(rpcText(result.error))
        if (live) setState({ kind: 'folder', entries: result.value.root.entries })
      }).catch(error => {
        if (live) setState({ kind: 'error', message: errorText(error) })
      })
      return () => { live = false }
    }

    const local = env.store.root(root.rootId)
    if (local?.previewUrl !== undefined && local.previewMime !== undefined) {
      setState({
        kind: 'file',
        file: {
          url: local.previewUrl,
          name: root.name,
          mime: local.previewMime,
          size: root.totalSize,
          downloadable: false,
        },
      })
      return () => { live = false }
    }

    void calls.issuePreview(sessionId, root.relPath).then(result => {
      if (!result.ok) throw new Error(rpcText(result.error))
      if (!live) return
      setState({
        kind: 'file',
        file: {
          ...result.value,
          url: new URL(result.value.url, location.origin).toString(),
          downloadable: true,
        },
      })
    }).catch(error => {
      if (live) setState({ kind: 'error', message: errorText(error) })
    })
    return () => { live = false }
  }, [draftId, env.api, env.store, root, sessionId])

  if (root === undefined || state.kind === 'idle') return null
  if (state.kind === 'file' && state.file.mime.startsWith('image/')) {
    return (
      <ImageLightbox
        src={state.file.url}
        alt={state.file.name}
        labels={{ dialog: root.name, close: tr('preview.close') }}
        onClose={onClose}
      />
    )
  }

  let body: ReactNode
  if (state.kind === 'loading') body = <p className="dua-preview-note">{tr('preview.loading')}</p>
  else if (state.kind === 'error') body = <p className="dua-preview-error">{tr('preview.failed', { message: state.message })}</p>
  else if (state.kind === 'folder') body = <FolderPreview entries={state.entries} />
  else body = <FilePreview file={state.file} />

  const footer = state.kind === 'file' && state.file.downloadable
    ? (
        <a className="dua-preview-download" href={state.file.url} download={state.file.name}>
          <IconDownloadOutline16 />
          <span>{tr('preview.download')}</span>
        </a>
      )
    : undefined

  return (
    <Modal
      open
      onClose={onClose}
      title={root.name}
      closeLabel={tr('preview.close')}
      className="dua-preview-modal"
      contentClassName="dua-preview-content"
      footer={footer}
    >
      {body}
    </Modal>
  )
}
