import { CircleAlert, Copy, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from '../../i18n'
import { DoctorPanel } from '../doctor/DoctorPanel'
import { copyTextToClipboard } from '../chat/clipboard'
import { Alert, AlertDescription, AlertTitle } from '../ui/alert'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { StartupSurface } from '../ui/custom/startup-surface'

const LOG_MARKER = '\n\nRecent server logs:\n'

export function splitStartupError(error: string) {
  const markerIndex = error.indexOf(LOG_MARKER)
  if (markerIndex === -1) {
    return {
      message: error,
      logs: '',
      diagnostics: error,
    }
  }

  const message = error.slice(0, markerIndex).trim()
  const logs = error.slice(markerIndex + LOG_MARKER.length).trim()
  return {
    message,
    logs,
    diagnostics: `${message}\n\nRecent server logs:\n${logs}`,
  }
}

type StartupErrorViewProps = {
  error: string
}

export function StartupErrorView({ error }: StartupErrorViewProps) {
  const t = useTranslation()
  const { message, logs, diagnostics } = useMemo(() => splitStartupError(error), [error])
  const [copied, setCopied] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  const handleCopy = async () => {
    const ok = await copyTextToClipboard(diagnostics)
    if (!ok) return

    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <StartupSurface
      title={t('app.serverFailed')}
      description={t('app.serverFailedHint')}
      headingRef={headingRef}
      icon={<CircleAlert aria-hidden="true" />}
      panelClassName="max-w-3xl"
      actions={(
        <>
          <Button
            type="button"
            variant="secondary"
            onClick={handleCopy}
          >
            <Copy aria-hidden="true" />
            <span aria-live="polite">
              {copied ? t('app.copiedDiagnostics') : t('app.copyDiagnostics')}
            </span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => window.location.reload()}
          >
            <RefreshCw aria-hidden="true" />
            {t('common.retry')}
          </Button>
        </>
      )}
    >
      <Alert variant="destructive">
        <AlertTitle>{t('app.startupError')}</AlertTitle>
        <AlertDescription>
          <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-[var(--color-error)]">
              {message}
            </pre>
        </AlertDescription>
      </Alert>

      {logs ? (
        <Card className="bg-[var(--color-surface)] shadow-none">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-xs uppercase text-[var(--color-text-tertiary)]">
              {t('app.serverLogs')}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-[var(--color-text-secondary)]">
                {logs}
              </pre>
          </CardContent>
        </Card>
      ) : null}

      <DoctorPanel compact />
    </StartupSurface>
  )
}
