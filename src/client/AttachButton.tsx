import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import {
  Button,
  IconFolderOpenOutline16,
  IconPaperclipOutline16,
  Menu,
  Tooltip,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { rootsFromFiles, type UploadRoot } from './files.js'
import { tr, type LocaleProps } from './locales.js'
import type { InputActionsFace, UploadStore } from './store.js'

export interface AttachButtonProps extends LocaleProps {
  readonly sessionId?: SessionId
  readonly inputActions?: InputActionsFace
  readonly store?: UploadStore
  readonly intake?: (roots: readonly UploadRoot[], inputActions?: InputActionsFace) => Promise<unknown> | unknown
}

export function AttachButton({ sessionId, inputActions, store, intake, t }: AttachButtonProps) {
  const fileInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const lc = t ?? tr

  useEffect(() => {
    const dropTarget = root.current?.closest<HTMLElement>('[data-composer-seat]')
    if (store === undefined || sessionId === undefined || dropTarget == null) return
    return store.capture({
      sessionId: sessionId as unknown as string,
      inputActions,
      dropTarget,
    })
  }, [inputActions, sessionId, store])

  useEffect(() => {
    const input = folderInput.current
    input?.setAttribute('webkitdirectory', '')
    input?.setAttribute('directory', '')
  }, [])

  const run = useCallback((roots: readonly UploadRoot[]) => {
    if (roots.length === 0 || intake === undefined || sessionId === undefined) return
    setBusy(true)
    setOpen(false)
    void Promise.resolve(intake(roots, inputActions)).finally(() => { setBusy(false) })
  }, [inputActions, intake, sessionId])

  const handleFiles = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])]
    event.target.value = ''
    run(rootsFromFiles(files))
  }, [run])

  const handleFolder = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])]
    event.target.value = ''
    run(rootsFromFiles(files, true))
  }, [run])

  const items: readonly MenuEntry[] = [
    {
      id: 'files',
      icon: <IconPaperclipOutline16 />,
      label: <span data-dua-attach-choice>{lc('attach.files')}</span>,
    },
    {
      id: 'folder',
      icon: <IconFolderOpenOutline16 />,
      label: <span data-dua-attach-choice>{lc('attach.folder')}</span>,
    },
  ]

  return (
    <div className="dua-attach" ref={root} data-plugin="dsh-airdrop">
      <Menu
        open={open}
        side="top"
        align="start"
        portal
        dense
        compact
        className="dua-attach-menu"
        items={items}
        onClose={() => { setOpen(false) }}
        onSelect={id => {
          setOpen(false)
          if (id === 'files') fileInput.current?.click()
          if (id === 'folder') folderInput.current?.click()
        }}
        anchor={(
          <Tooltip label={lc('attach.title')} side="top">
            <Button
              type="button"
              variant="toolbar"
              size="sm"
              icon={<IconPaperclipOutline16 />}
              className="dua-attach-button"
              aria-label={lc('attach.title')}
              disabled={busy || sessionId === undefined}
              aria-expanded={open}
              onClick={() => { setOpen(value => !value) }}
            />
          </Tooltip>
        )}
      />
      <input ref={fileInput} hidden type="file" multiple onChange={handleFiles} />
      <input ref={folderInput} hidden type="file" multiple onChange={handleFolder} />
    </div>
  )
}
