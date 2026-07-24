import {
  Archive,
  Clipboard,
  Copy,
  Database,
  FolderOpen,
  RefreshCw,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  diagnosticsApi,
  type DiagnosticEvent,
  type DiagnosticsStatus,
  type LocalIndexState,
  type LocalIndexStatus,
} from '../api/diagnostics'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Button } from '../components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card'
import { ConfirmationAlertDialog } from '../components/ui/custom/confirmation-alert-dialog'
import {
  DiagnosticEventRow,
  formatDetails,
} from '../components/ui/custom/diagnostic-event-row'
import { LoadingButton } from '../components/ui/custom/loading-button'
import { Skeleton } from '../components/ui/skeleton'
import { copyTextToClipboard } from '../components/chat/clipboard'
import { useTranslation } from '../i18n'
import { formatBytes } from '../lib/formatBytes'
import { useUIStore } from '../stores/uiStore'
import { DoctorPanel } from '../components/doctor/DoctorPanel'

type DiagnosticsAction = 'open-directory' | 'export' | 'copy-summary' | 'copy-issue' | 'clear'

export function DiagnosticsSettings() {
  const t = useTranslation()
  const addToast = useUIStore((s) => s.addToast)
  const [status, setStatus] = useState<DiagnosticsStatus | null>(null)
  const [localIndexStatus, setLocalIndexStatus] = useState<LocalIndexStatus | null>(null)
  const [localIndexUnavailable, setLocalIndexUnavailable] = useState(false)
  const [events, setEvents] = useState<DiagnosticEvent[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [activeAction, setActiveAction] = useState<DiagnosticsAction | null>(null)
  const [isRebuildingIndex, setIsRebuildingIndex] = useState(false)
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  const [rebuildConfirmOpen, setRebuildConfirmOpen] = useState(false)
  const [clearError, setClearError] = useState<string | null>(null)
  const [rebuildError, setRebuildError] = useState<string | null>(null)
  const [rebuildSucceeded, setRebuildSucceeded] = useState(false)
  const [lastExportPath, setLastExportPath] = useState<string | null>(null)
  const mountedRef = useRef(true)
  const loadRequestIdRef = useRef(0)
  const localIndexReadIdRef = useRef(0)
  const localIndexMutationIdRef = useRef(0)
  const localIndexMutationGenerationRef = useRef(0)
  const rebuildInFlightRef = useRef(false)
  const actionRef = useRef<DiagnosticsAction | null>(null)
  const actionIdRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      loadRequestIdRef.current += 1
      localIndexReadIdRef.current += 1
      localIndexMutationIdRef.current += 1
      localIndexMutationGenerationRef.current += 1
      actionIdRef.current += 1
      actionRef.current = null
    }
  }, [])

  const load = useCallback(async () => {
    const loadRequestId = ++loadRequestIdRef.current
    const localIndexReadId = ++localIndexReadIdRef.current
    const mutationGeneration = localIndexMutationGenerationRef.current
    if (mountedRef.current) {
      setIsLoading(true)
      setRebuildSucceeded(false)
      setLoadError(null)
    }

    try {
      const [diagnosticsResult, localIndexResult] = await Promise.allSettled([
        Promise.all([diagnosticsApi.getStatus(), diagnosticsApi.getEvents(100)]),
        diagnosticsApi.getLocalIndexStatus(),
      ])

      if (!mountedRef.current) return

      if (loadRequestId === loadRequestIdRef.current) {
        if (diagnosticsResult.status === 'fulfilled') {
          const [nextStatus, eventResult] = diagnosticsResult.value
          setStatus(nextStatus)
          setEvents(eventResult.events)
          setLoadError(null)
        } else {
          const error = diagnosticsResult.reason
          const message = error instanceof Error ? error.message : t('settings.diagnostics.loadFailed')
          setLoadError(message)
          addToast({
            type: 'error',
            message,
          })
        }
      }

      // A mutation owns local-index state until it settles. Reads that began
      // before or during that mutation cannot overwrite the mutation result.
      const canCommitLocalIndexRead = localIndexReadId === localIndexReadIdRef.current
        && mutationGeneration === localIndexMutationGenerationRef.current
        && !rebuildInFlightRef.current
      if (canCommitLocalIndexRead) {
        if (localIndexResult.status === 'fulfilled') {
          setLocalIndexStatus(localIndexResult.value)
          setLocalIndexUnavailable(false)
        } else {
          // Older servers may not expose the additive local-index endpoint yet.
          // Keep all legacy diagnostics usable and show one quiet inline state.
          setLocalIndexStatus(null)
          setLocalIndexUnavailable(true)
        }
      }
    } finally {
      if (mountedRef.current && loadRequestId === loadRequestIdRef.current) {
        setIsLoading(false)
      }
    }
  }, [addToast, t])

  const beginAction = (action: DiagnosticsAction): number | null => {
    if (actionRef.current || rebuildInFlightRef.current) return null
    actionRef.current = action
    const actionId = ++actionIdRef.current
    if (mountedRef.current) setActiveAction(action)
    return actionId
  }

  const isCurrentAction = (actionId: number, action: DiagnosticsAction): boolean => {
    return mountedRef.current && actionIdRef.current === actionId && actionRef.current === action
  }

  const finishAction = (actionId: number, action: DiagnosticsAction) => {
    if (actionIdRef.current !== actionId || actionRef.current !== action) return
    actionRef.current = null
    if (mountedRef.current) setActiveAction(null)
  }

  useEffect(() => {
    void load()
  }, [load])

  const recentErrorSummary = useMemo(() => {
    return events
      .filter((event) => event.severity === 'error' || event.severity === 'warn')
      .slice(0, 20)
      .map(formatEventForCopy)
      .join('\n')
  }, [events])

  const handleOpenDir = async () => {
    const actionId = beginAction('open-directory')
    if (actionId === null) return
    try {
      await diagnosticsApi.openLogDir()
    } catch (error) {
      if (!isCurrentAction(actionId, 'open-directory')) return
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : t('settings.diagnostics.openFailed'),
      })
    } finally {
      finishAction(actionId, 'open-directory')
    }
  }

  const handleExport = async () => {
    const actionId = beginAction('export')
    if (actionId === null) return
    try {
      const { bundle } = await diagnosticsApi.exportBundle()
      if (!isCurrentAction(actionId, 'export')) return
      setLastExportPath(bundle.path)
      addToast({
        type: 'success',
        message: t('settings.diagnostics.exported', { file: bundle.fileName }),
      })
      await load()
    } catch (error) {
      if (!isCurrentAction(actionId, 'export')) return
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : t('settings.diagnostics.exportFailed'),
      })
    } finally {
      finishAction(actionId, 'export')
    }
  }

  const handleCopySummary = async () => {
    const actionId = beginAction('copy-summary')
    if (actionId === null) return
    try {
      const text = recentErrorSummary || t('settings.diagnostics.noRecentErrors')
      const copied = await copyTextToClipboard(text)
      if (!isCurrentAction(actionId, 'copy-summary')) return
      if (copied) {
        addToast({ type: 'success', message: t('settings.diagnostics.summaryCopied') })
        return
      }
      addToast({ type: 'error', message: t('settings.diagnostics.copyFailed') })
    } finally {
      finishAction(actionId, 'copy-summary')
    }
  }

  const handleCopyIssueReport = async () => {
    const actionId = beginAction('copy-issue')
    if (actionId === null) return
    try {
      const { report } = await diagnosticsApi.getIssueReport()
      const copied = await copyTextToClipboard(report)
      if (!isCurrentAction(actionId, 'copy-issue')) return
      addToast({
        type: copied ? 'success' : 'error',
        message: copied
          ? t('settings.diagnostics.issueReportCopied')
          : t('settings.diagnostics.issueReportCopyFailed'),
      })
    } catch (error) {
      if (!isCurrentAction(actionId, 'copy-issue')) return
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : t('settings.diagnostics.issueReportCopyFailed'),
      })
    } finally {
      finishAction(actionId, 'copy-issue')
    }
  }

  const handleClear = async () => {
    const actionId = beginAction('clear')
    if (actionId === null) return
    const invalidatedLoadRequestId = ++loadRequestIdRef.current
    setClearError(null)
    try {
      await diagnosticsApi.clear()
      if (!isCurrentAction(actionId, 'clear')) return
      setEvents([])
      setStatus((current) => current ? {
        ...current,
        totalBytes: 0,
        eventCount: 0,
        physicalLineCount: 0,
        corruptLineCount: 0,
        storageLimitExceeded: false,
        recentErrorCount: 0,
        lastEventAt: null,
      } : null)
      setLastExportPath(null)
      setClearConfirmOpen(false)
      addToast({ type: 'success', message: t('settings.diagnostics.cleared') })
      await load()
    } catch (error) {
      if (!isCurrentAction(actionId, 'clear')) return
      if (loadRequestIdRef.current === invalidatedLoadRequestId) setIsLoading(false)
      const message = error instanceof Error ? error.message : t('settings.diagnostics.clearFailed')
      setClearError(message)
      addToast({
        type: 'error',
        message,
      })
    } finally {
      finishAction(actionId, 'clear')
    }
  }

  const handleRebuildIndex = async () => {
    if (rebuildInFlightRef.current) return
    rebuildInFlightRef.current = true
    const mutationId = ++localIndexMutationIdRef.current
    localIndexMutationGenerationRef.current += 1
    setIsRebuildingIndex(true)
    setRebuildSucceeded(false)
    setRebuildError(null)
    try {
      const nextStatus = await diagnosticsApi.rebuildLocalIndex()
      if (!mountedRef.current || mutationId !== localIndexMutationIdRef.current) return
      setLocalIndexStatus(nextStatus)
      setLocalIndexUnavailable(false)
      setRebuildSucceeded(true)
      setRebuildConfirmOpen(false)
      addToast({ type: 'success', message: t('settings.diagnostics.localIndex.rebuildSucceeded') })
    } catch (error) {
      if (!mountedRef.current || mutationId !== localIndexMutationIdRef.current) return
      const message = error instanceof Error ? error.message : t('settings.diagnostics.localIndex.rebuildFailed')
      setRebuildError(message)
      addToast({
        type: 'error',
        message,
      })
    } finally {
      rebuildInFlightRef.current = false
      if (mutationId === localIndexMutationIdRef.current) {
        localIndexMutationGenerationRef.current += 1
      }
      if (mountedRef.current) setIsRebuildingIndex(false)
    }
  }

  const operationBusy = activeAction !== null
  const pageBusy = operationBusy || isRebuildingIndex

  return (
    <div className="max-w-4xl">
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{t('settings.diagnostics.title')}</h2>
          <p className="text-sm text-[var(--color-text-tertiary)] mt-0.5">{t('settings.diagnostics.description')}</p>
        </div>
        <LoadingButton
          variant="secondary"
          size="sm"
          onClick={load}
          loading={isLoading}
          disabled={pageBusy}
        >
          {!isLoading ? <RefreshCw aria-hidden="true" /> : null}
          {t('settings.diagnostics.refresh')}
        </LoadingButton>
      </div>

      {loadError ? (
        <Alert variant="destructive" className="mb-5">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2 text-[var(--color-error)]">
            <span>{loadError}</span>
            <Button variant="outline" size="sm" onClick={load} disabled={pageBusy}>
              <RefreshCw aria-hidden="true" />
              {t('settings.diagnostics.refresh')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <dl className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Metric
          label={t('settings.diagnostics.totalSize')}
          value={status ? formatBytes(status.totalBytes) : '-'}
          loading={isLoading && !status}
        />
        <Metric
          label={t('settings.diagnostics.completeEvents')}
          value={status ? t('settings.diagnostics.completeEventsValue', { count: status.eventCount }) : '-'}
          loading={isLoading && !status}
        />
        <Metric
          label={t('settings.diagnostics.visibleEvents')}
          value={t('settings.diagnostics.visibleEventsValue', { count: events.length })}
          loading={isLoading && !status}
        />
        <Metric
          label={t('settings.diagnostics.recentErrors')}
          value={status ? String(status.recentErrorCount) : '-'}
          loading={isLoading && !status}
        />
        <Metric
          label={t('settings.diagnostics.retention')}
          value={status ? t('settings.diagnostics.retentionValue', { days: String(status.retentionDays), size: formatBytes(status.maxBytes) }) : '-'}
          loading={isLoading && !status}
        />
      </dl>

      {status && status.corruptLineCount > 0 ? (
        <Alert className="mb-5 border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 text-[var(--color-warning)]">
          <TriangleAlert aria-hidden="true" />
          <AlertDescription className="text-[var(--color-warning)]">
            {t('settings.diagnostics.corruptLinesWarning', {
              count: status.corruptLineCount,
              physical: status.physicalLineCount,
            })}
          </AlertDescription>
        </Alert>
      ) : null}

      {status?.storageLimitExceeded ? (
        <Alert className="mb-5 border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 text-[var(--color-warning)]">
          <TriangleAlert aria-hidden="true" />
          <AlertDescription className="text-[var(--color-warning)]">
            {t('settings.diagnostics.storageLimitExceededWarning')}
          </AlertDescription>
        </Alert>
      ) : null}

      <LocalIndexPanel
        status={localIndexStatus}
        unavailable={localIndexUnavailable}
        rebuildSucceeded={rebuildSucceeded}
        rebuildAction={(
          <ConfirmationAlertDialog
            open={rebuildConfirmOpen}
            onOpenChange={(open) => {
              setRebuildConfirmOpen(open)
              if (open) setRebuildError(null)
            }}
            trigger={(
              <Button
                variant="secondary"
                size="sm"
                disabled={isRebuildingIndex || localIndexUnavailable}
              >
                <Database aria-hidden="true" />
                {t('settings.diagnostics.localIndex.rebuild')}
              </Button>
            )}
            title={t('settings.diagnostics.localIndex.rebuild')}
            description={t('settings.diagnostics.localIndex.confirmRebuild')}
            cancelLabel={t('common.cancel')}
            actionLabel={t('settings.diagnostics.localIndex.rebuild')}
            onConfirm={handleRebuildIndex}
            loading={isRebuildingIndex}
            error={rebuildError}
          />
        )}
      />

      <div className="mb-5">
        <DoctorPanel />
      </div>

      <Card className="mb-5">
        <CardHeader className="flex-row items-start justify-between gap-3 border-b border-[var(--color-border)]">
          <div>
            <CardTitle className="text-sm">{t('settings.diagnostics.logDirectory')}</CardTitle>
            <CardDescription className="mt-0.5 break-all font-mono text-xs">
              {status?.logDir ?? '-'}
            </CardDescription>
          </div>
          <LoadingButton
            variant="secondary"
            size="sm"
            onClick={handleOpenDir}
            loading={activeAction === 'open-directory'}
            disabled={pageBusy}
          >
            {activeAction !== 'open-directory' ? <FolderOpen aria-hidden="true" /> : null}
            {t('settings.diagnostics.openDirectory')}
          </LoadingButton>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <LoadingButton
            size="sm"
            onClick={handleExport}
            loading={activeAction === 'export'}
            disabled={pageBusy}
          >
            {activeAction !== 'export' ? <Archive aria-hidden="true" /> : null}
            {t('settings.diagnostics.exportBundle')}
          </LoadingButton>
          <LoadingButton
            variant="secondary"
            size="sm"
            onClick={handleCopySummary}
            loading={activeAction === 'copy-summary'}
            disabled={pageBusy}
          >
            {activeAction !== 'copy-summary' ? <Copy aria-hidden="true" /> : null}
            {t('settings.diagnostics.copySummary')}
          </LoadingButton>
          <LoadingButton
            variant="secondary"
            size="sm"
            onClick={handleCopyIssueReport}
            loading={activeAction === 'copy-issue'}
            disabled={pageBusy}
          >
            {activeAction !== 'copy-issue' ? <Clipboard aria-hidden="true" /> : null}
            {t('settings.diagnostics.copyIssueReport')}
          </LoadingButton>
          <ConfirmationAlertDialog
            open={clearConfirmOpen}
            onOpenChange={(open) => {
              setClearConfirmOpen(open)
              if (open) setClearError(null)
            }}
            trigger={(
              <Button variant="destructive" size="sm" disabled={pageBusy}>
                <Trash2 aria-hidden="true" />
                {t('settings.diagnostics.clearLogs')}
              </Button>
            )}
            title={t('settings.diagnostics.clearLogs')}
            description={t('settings.diagnostics.confirmClear')}
            cancelLabel={t('common.cancel')}
            actionLabel={t('settings.diagnostics.clearLogs')}
            onConfirm={handleClear}
            loading={activeAction === 'clear'}
            destructive
            error={clearError}
          />
          {lastExportPath && (
            <span
              role="status"
              className="w-full break-all font-mono text-xs text-[var(--color-text-tertiary)]"
            >
              {lastExportPath}
            </span>
          )}
        </CardContent>
      </Card>

      <div className="mb-3">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{t('settings.diagnostics.recentEvents')}</h3>
        <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">{t('settings.diagnostics.privacyNote')}</p>
      </div>

      <Card className="overflow-hidden">
        {events.length === 0 && isLoading ? (
          <CardContent className="space-y-3" aria-label={t('common.loading')}>
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </CardContent>
        ) : events.length === 0 ? (
          <CardContent className="py-8 text-center text-sm text-[var(--color-text-tertiary)]">
            {t('settings.diagnostics.noEvents')}
          </CardContent>
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {events.map((event) => (
              <DiagnosticEventRow
                key={event.id}
                event={event}
                detailsLabel={t('settings.diagnostics.eventDetails')}
                eventIdLabel={t('settings.diagnostics.eventId')}
                copyEventIdLabel={t('settings.diagnostics.copyEventId')}
                eventIdCopiedLabel={t('settings.diagnostics.eventIdCopied')}
                eventIdCopyFailedLabel={t('settings.diagnostics.eventIdCopyFailed')}
                onCopyResult={(message, copied) => {
                  addToast({ type: copied ? 'success' : 'error', message })
                }}
              />
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

function LocalIndexPanel({
  status,
  unavailable,
  rebuildSucceeded,
  rebuildAction,
}: {
  status: LocalIndexStatus | null
  unavailable: boolean
  rebuildSucceeded: boolean
  rebuildAction: ReactNode
}) {
  const t = useTranslation()
  const titleId = 'local-index-diagnostics-title'
  const stateMessage = status?.state === 'building'
    ? t('settings.diagnostics.localIndex.buildingMessage')
    : status?.state === 'degraded'
      ? t('settings.diagnostics.localIndex.degradedMessage')
      : null

  return (
    <Card
      role="region"
      aria-labelledby={titleId}
      className="mb-5"
    >
      <CardHeader className="flex-col gap-3 border-b border-[var(--color-border)] sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle id={titleId} className="text-sm">
            {t('settings.diagnostics.localIndex.title')}
          </CardTitle>
          <CardDescription className="mt-0.5 text-xs">
            {t('settings.diagnostics.localIndex.description')}
          </CardDescription>
        </div>
        {rebuildAction}
      </CardHeader>

      {status ? (
        <CardContent className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <IndexMetric label={t('settings.diagnostics.localIndex.state')} value={localIndexStateLabel(status.state, t)} />
          <IndexMetric
            label={t('settings.diagnostics.localIndex.indexed')}
            value={`${status.indexed} / ${status.discovered}`}
          />
          <IndexMetric label={t('settings.diagnostics.localIndex.degradedSources')} value={String(status.degradedSources)} />
          <IndexMetric label={t('settings.diagnostics.localIndex.databaseSize')} value={formatBytes(status.databaseBytes)} />
          <IndexMetric label={t('settings.diagnostics.localIndex.walSize')} value={formatBytes(status.walBytes)} />
          <IndexMetric
            label={t('settings.diagnostics.localIndex.lastUpdated')}
            value={status.lastUpdatedAt ? new Date(status.lastUpdatedAt).toLocaleString() : t('settings.diagnostics.localIndex.never')}
          />
          <IndexMetric
            label={t('settings.diagnostics.localIndex.errorCode')}
            value={status.lastErrorCode ?? t('settings.diagnostics.localIndex.none')}
            mono={Boolean(status.lastErrorCode)}
          />
        </CardContent>
      ) : (
        <CardContent className="text-xs text-[var(--color-text-tertiary)]">
          {unavailable ? t('settings.diagnostics.localIndex.unavailable') : t('common.loading')}
        </CardContent>
      )}

      {stateMessage ? (
        <div role="status" className="border-t border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-text-tertiary)]">
          {stateMessage}
        </div>
      ) : null}
      {rebuildSucceeded ? (
        <div role="status" className="border-t border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-success)]">
          {t('settings.diagnostics.localIndex.rebuildSucceeded')}
        </div>
      ) : null}
    </Card>
  )
}

function IndexMetric({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-[var(--color-text-tertiary)]">{label}</div>
      <div className={`mt-0.5 break-words text-xs font-medium text-[var(--color-text-primary)]${mono ? ' font-mono' : ''}`}>
        {value}
      </div>
    </div>
  )
}

type Translation = ReturnType<typeof useTranslation>

function localIndexStateLabel(state: LocalIndexState, t: Translation): string {
  return t(`settings.diagnostics.localIndex.state.${state}`)
}

function Metric({ label, value, loading }: { label: string; value: string; loading: boolean }) {
  return (
    <Card className="px-3 py-2">
      <dt className="text-xs text-[var(--color-text-tertiary)]">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-[var(--color-text-primary)]">
        {loading ? <Skeleton className="h-5 w-16" /> : value}
      </dd>
    </Card>
  )
}

function formatEventForCopy(event: DiagnosticEvent): string {
  const header = `[${event.timestamp}] ${event.severity.toUpperCase()} ${event.type}${event.sessionId ? ` session=${event.sessionId}` : ''}`
  const details = formatDetails(event.details)
  if (!details) return `${header}: ${event.summary}`
  return `${header}: ${event.summary}\nDetails:\n${details}`
}
