import { useEffect, useRef } from 'react'
import { useTranslation } from '../../i18n'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'
import { UpdateReadyPrompt } from '../ui/custom/update-ready-prompt'
import { isDesktopRuntime } from '../../lib/desktopRuntime'
import { useUpdateStore } from '../../stores/updateStore'

export function UpdateChecker() {
  const t = useTranslation()
  const status = useUpdateStore((s) => s.status)
  const availableVersion = useUpdateStore((s) => s.availableVersion)
  const releaseNotes = useUpdateStore((s) => s.releaseNotes)
  const error = useUpdateStore((s) => s.error)
  const shouldPrompt = useUpdateStore((s) => s.shouldPrompt)
  const initialize = useUpdateStore((s) => s.initialize)
  const installUpdate = useUpdateStore((s) => s.installUpdate)
  const dismissPrompt = useUpdateStore((s) => s.dismissPrompt)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const wasShowingPromptRef = useRef(false)

  useEffect(() => {
    void initialize()
  }, [initialize])

  const isDesktop = isDesktopRuntime()
  const showPopup =
    isDesktop &&
    shouldPrompt &&
    !!availableVersion &&
    status === 'downloaded'

  useEffect(() => {
    if (showPopup && !wasShowingPromptRef.current) {
      returnFocusRef.current =
        document.activeElement instanceof HTMLElement && document.activeElement !== document.body
          ? document.activeElement
          : null
    }
    wasShowingPromptRef.current = showPopup
  }, [showPopup])

  if (!isDesktop) return null
  if (!showPopup) return null

  const statusText = t('update.readyBody', { version: availableVersion })
  const handleDismiss = () => {
    const returnFocusTarget = returnFocusRef.current
    dismissPrompt()
    queueMicrotask(() => {
      if (returnFocusTarget?.isConnected) {
        returnFocusTarget.focus()
      }
    })
  }

  return (
    <div className="fixed bottom-4 left-1/2 z-[120] w-[min(360px,calc(100vw-2rem))] -translate-x-1/2">
      <UpdateReadyPrompt
        title={t('update.readyTitle')}
        body={statusText}
        installLabel={t('update.installAndRestart')}
        dismissLabel={t('update.later')}
        error={error ? t('update.failed', { error }) : null}
        onInstall={() => void installUpdate()}
        onDismiss={handleDismiss}
        releaseNotes={
          releaseNotes ? (
            <MarkdownRenderer
              content={releaseNotes}
              className="text-xs leading-5 text-[var(--color-text-secondary)] [&_h1]:mb-2 [&_h1]:text-sm [&_h1]:font-semibold [&_h2]:mb-1.5 [&_h2]:text-xs [&_h2]:font-semibold [&_p]:my-1.5 [&_p]:text-xs [&_p]:leading-5 [&_ul]:my-1.5 [&_ol]:my-1.5"
            />
          ) : null
        }
      />
    </div>
  )
}
