import { useCallback, useEffect, useMemo, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { AlertCircle, ExternalLink, RefreshCw, Search, Trash2, Workflow } from 'lucide-react'
import { tracesApi } from '../api/traces'
import { SETTINGS_TAB_ID, useTabStore } from '../stores/tabStore'
import { useUIStore } from '../stores/uiStore'
import { useTranslation } from '../i18n'
import { getDesktopHost } from '../lib/desktopHost'
import type { TraceSessionList, TraceSessionListItem } from '../types/trace'
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { ScrollArea } from '../components/ui/scroll-area'
import { Skeleton } from '../components/ui/skeleton'
import { ConfirmationAlertDialog } from '../components/ui/custom/confirmation-alert-dialog'
import { IconButton } from '../components/ui/custom/icon-button'
import { LoadingButton } from '../components/ui/custom/loading-button'

type TraceListState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: TraceSessionList }

const POLL_MS = 5_000
const PAGE_SIZE = 50
const SEARCH_DEBOUNCE_MS = 250
const MAX_MODEL_CHIPS = 2


export function TraceList() {
  const t = useTranslation()
  const [state, setState] = useState<TraceListState>({ status: 'loading' })
  const [queryInput, setQueryInput] = useState('')
  const [query, setQuery] = useState('')
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<TraceSessionListItem | null>(null)
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const host = getDesktopHost()

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(queryInput.trim())
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [queryInput])

  const load = useCallback(async (options?: {
    append?: boolean
    limit?: number
    offset?: number
    silent?: boolean
  }) => {
    const append = options?.append === true
    const offset = options?.offset ?? 0
    const limit = options?.limit ?? PAGE_SIZE
    try {
      if (append) {
        setIsLoadingMore(true)
      } else if (!options?.silent) {
        setState({ status: 'loading' })
      }
      const data = await tracesApi.list({ limit, offset, query })
      setState((previous) => {
        if (!append || previous.status !== 'ready') {
          return { status: 'ready', data }
        }
        return {
          status: 'ready',
          data: {
            ...data,
            traces: [...previous.data.traces, ...data.traces],
          },
        }
      })
    } catch (error) {
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : t('trace.list.loadFailed'),
      })
    } finally {
      if (append) setIsLoadingMore(false)
    }
  }, [query, t])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (state.status !== 'ready' || !state.data.settings.enabled) return
    const timer = window.setInterval(() => {
      void load({
        limit: Math.max(PAGE_SIZE, state.data.traces.length),
        silent: true,
      })
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [load, state])

  const summary = useMemo(() => {
    if (state.status !== 'ready') return { apiCalls: 0, failedCalls: 0, models: 0 }
    const modelNames = new Set<string>()
    let apiCalls = 0
    let failedCalls = 0
    for (const item of state.data.traces) {
      apiCalls += item.summary.apiCalls
      failedCalls += item.summary.failedCalls
      for (const model of item.summary.models) modelNames.add(model.model)
    }
    return { apiCalls, failedCalls, models: modelNames.size }
  }, [state])

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return
    const currentLimit = state.status === 'ready'
      ? Math.max(PAGE_SIZE, state.data.traces.length)
      : PAGE_SIZE
    setDeletingSessionId(deleteTarget.sessionId)
    setDeleteError(null)
    try {
      await tracesApi.deleteSession(deleteTarget.sessionId)
      setDeleteTarget(null)
      await load({ limit: currentLimit, silent: true })
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : t('trace.list.deleteFailed'))
    } finally {
      setDeletingSessionId(null)
    }
  }, [deleteTarget, load, state, t])

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col bg-[var(--color-surface)]">
        <header className="shrink-0 border-b border-[var(--color-border)] px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
                <Workflow className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                <span>{t('trace.list.eyebrow')}</span>
              </div>
              <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
                <h1 className="text-lg font-semibold tracking-tight text-[var(--color-text-primary)]">{t('trace.list.title')}</h1>
                {state.status === 'ready' && (
                  <Badge variant="outline" className={`min-h-5 rounded-[var(--radius-sm)] px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide ${
                    state.data.settings.enabled
                      ? 'border-[var(--color-success)]/25 bg-[var(--color-success)]/10 text-[var(--color-success)]'
                      : 'border-[var(--color-border)] bg-[var(--color-surface-container-low)] text-[var(--color-text-tertiary)]'
                  }`}>
                    {state.data.settings.enabled ? t('trace.list.collecting') : t('trace.list.paused')}
                  </Badge>
                )}
                {state.status === 'ready' && (
                  <span className="min-w-0 max-w-full truncate font-mono text-[11px] text-[var(--color-text-tertiary)]" title={state.data.storageDir}>
                    {state.data.storageDir}
                  </span>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => openTraceSettings(t)}>
                {t('trace.list.settings')}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void load()}>
                <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                {t('trace.refresh')}
              </Button>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MetaCard label={t('trace.list.sessions')} value={state.status === 'ready' ? String(state.data.total) : '-'} />
            <MetaCard label={t('trace.apiCalls')} value={String(summary.apiCalls)} />
            <MetaCard label={t('trace.failedCalls')} value={String(summary.failedCalls)} tone={summary.failedCalls > 0 ? 'danger' : 'default'} />
            <MetaCard label={t('trace.models')} value={String(summary.models)} />
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 border-b border-[var(--color-border)] px-5 py-3">
            <div className="relative max-w-xl">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-text-tertiary)]" strokeWidth={2} aria-hidden="true" />
              <Input
                value={queryInput}
                onChange={(event) => setQueryInput(event.currentTarget.value)}
                placeholder={t('trace.list.searchPlaceholder')}
                aria-label={t('trace.list.searchPlaceholder')}
                className="pl-9"
              />
            </div>
          </div>

          {state.status === 'loading' && <TraceListSkeleton label={t('common.loading')} />}
          {state.status === 'error' && (
            <Alert variant="destructive" className="m-5 w-auto">
              <AlertCircle aria-hidden="true" />
              <AlertTitle>{t('trace.list.loadFailed')}</AlertTitle>
              <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                <span>{state.message}</span>
                <Button size="sm" variant="outline" onClick={() => void load()}>
                  <RefreshCw aria-hidden="true" />
                  {t('common.retry')}
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {state.status === 'ready' && (
            <TraceRows
              traces={state.data.traces}
              total={state.data.total}
              loadingMore={isLoadingMore}
              deletingSessionId={deletingSessionId}
              onLoadMore={() => void load({
                append: true,
                offset: state.data.traces.length,
                silent: true,
              })}
              onOpenWindow={(sessionId) => {
                if (host.trace) void host.trace.openWindow(sessionId)
              }}
              deleteTarget={deleteTarget}
              deleteError={deleteError}
              onDeleteOpenChange={(trace, open) => {
                if (deletingSessionId) return
                setDeleteError(null)
                setDeleteTarget(open ? trace : null)
              }}
              onConfirmDelete={() => void confirmDelete()}
            />
          )}
        </div>
      </div>
    </>
  )
}

function TraceRows({
  loadingMore,
  onLoadMore,
  traces,
  total,
  onOpenWindow,
  deleteTarget,
  deleteError,
  onDeleteOpenChange,
  onConfirmDelete,
  deletingSessionId,
}: {
  loadingMore: boolean
  onLoadMore: () => void
  traces: TraceSessionListItem[]
  total: number
  onOpenWindow: (sessionId: string) => void
  deleteTarget: TraceSessionListItem | null
  deleteError: string | null
  onDeleteOpenChange: (trace: TraceSessionListItem, open: boolean) => void
  onConfirmDelete: () => void
  deletingSessionId: string | null
}) {
  const t = useTranslation()

  if (traces.length === 0) {
    return (
      <div className="flex flex-1 items-start justify-center px-6 py-10">
        <Card className="w-full max-w-md border-dashed bg-[var(--color-surface-container-low)] text-center">
          <CardContent className="px-6 py-12">
            <Workflow className="mx-auto size-8 text-[var(--color-text-tertiary)]" strokeWidth={2} aria-hidden="true" />
            <h2 className="mt-3 text-sm font-semibold text-[var(--color-text-primary)]">{t('trace.list.emptyTitle')}</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">{t('trace.list.emptyBody')}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="space-y-2 p-4" role="list">
        {traces.map((trace) => (
          <TraceRow
            key={trace.sessionId}
            trace={trace}
            onOpenWindow={onOpenWindow}
            isDeleting={deletingSessionId === trace.sessionId}
            deleteOpen={deleteTarget?.sessionId === trace.sessionId}
            deleteError={deleteTarget?.sessionId === trace.sessionId ? deleteError : null}
            onDeleteOpenChange={(open) => onDeleteOpenChange(trace, open)}
            onConfirmDelete={onConfirmDelete}
          />
        ))}
      </div>
      <div className="flex items-center justify-between border-t border-[var(--color-border)] px-5 py-3 text-xs text-[var(--color-text-tertiary)]">
        <span>{t('trace.list.loadedCount', { shown: traces.length, total })}</span>
        {traces.length < total && (
          <LoadingButton size="sm" variant="secondary" onClick={onLoadMore} loading={loadingMore}>
            {t('trace.list.loadMore')}
          </LoadingButton>
        )}
      </div>
    </ScrollArea>
  )
}

function TraceRow({
  trace,
  onOpenWindow,
  isDeleting,
  deleteOpen,
  deleteError,
  onDeleteOpenChange,
  onConfirmDelete,
}: {
  trace: TraceSessionListItem
  onOpenWindow: (sessionId: string) => void
  isDeleting: boolean
  deleteOpen: boolean
  deleteError: string | null
  onDeleteOpenChange: (open: boolean) => void
  onConfirmDelete: () => void
}) {
  const t = useTranslation()
  const title = getTraceTitle(trace, t)
  const updatedAt = trace.summary.updatedAt ?? trace.fileUpdatedAt
  const failedCalls = trace.summary.failedCalls
  const visibleModels = trace.summary.models.slice(0, MAX_MODEL_CHIPS)
  const hiddenModels = trace.summary.models.length - visibleModels.length
  const totalTokens = trace.summary.totalInputTokens + trace.summary.totalOutputTokens

  const open = () => openTrace(trace.sessionId, title, t)
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    open()
  }

  return (
    <Card
      role="listitem"
      aria-label={title}
      className="trace-list-row-cv group flex min-h-16 items-center gap-2 bg-[var(--color-surface)] px-2 transition-colors hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface-hover)] sm:gap-4 sm:px-3"
    >
      <Button
        variant="ghost"
        onClick={open}
        onKeyDown={onKeyDown}
        className="h-auto min-w-0 flex-1 justify-start gap-4 self-stretch whitespace-normal px-2 py-2 text-left"
        aria-label={title}
      >
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate text-sm font-semibold text-[var(--color-text-primary)]">{title}</span>
            {visibleModels.map((model) => (
              <Badge
                variant="outline"
                key={model.model}
                title={`${model.model} x${model.calls}`}
                className="min-h-4 shrink-0 rounded-[var(--radius-sm)] border-transparent bg-[var(--color-brand)]/10 px-1.5 py-0 font-mono text-[10px] leading-4 text-[var(--color-brand)]"
              >
                {shortModelName(model.model)}
              </Badge>
            ))}
            {hiddenModels > 0 && (
              <Badge variant="secondary" className="min-h-4 shrink-0 rounded-[var(--radius-sm)] px-1.5 py-0 font-mono text-[10px] leading-4 text-[var(--color-text-tertiary)]">
                +{hiddenModels}
              </Badge>
            )}
            {failedCalls > 0 && (
              <Badge variant="destructive" title={t('trace.failedCalls')} className="min-h-4 gap-1 rounded-[var(--radius-sm)] px-1.5 py-0 font-mono text-[10px]">
                <span className="size-1.5 rounded-full bg-[var(--color-error)]" aria-hidden="true" />
                {failedCalls}
              </Badge>
            )}
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[10px] text-[var(--color-text-tertiary)]">
            <span className="shrink-0 font-mono">{trace.sessionId.slice(0, 8)}</span>
            {trace.session?.projectPath && (
              <>
                <span aria-hidden="true">·</span>
                <span className="truncate" title={trace.session.projectPath}>{trace.session.projectPath}</span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span className="shrink-0 font-mono">{formatUpdatedAt(updatedAt)}</span>
          </div>
        </div>
        <div className="hidden shrink-0 grid-cols-[3.5rem_4rem_4rem] items-center gap-3 md:grid">
          <MetricCell label={t('trace.apiCalls')} value={String(trace.summary.apiCalls)} />
          <MetricCell label={t('trace.modelTime')} value={formatDuration(trace.summary.totalDurationMs)} />
          <MetricCell label={t('trace.tokens')} value={formatCompact(totalTokens)} />
        </div>
      </Button>
      <div className="flex shrink-0 items-center justify-end gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
        <IconButton
          label={t('trace.open')}
          variant="ghost"
          onClick={(event) => {
            event.stopPropagation()
            open()
          }}
        >
          <Workflow className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
        </IconButton>
        <IconButton
          label={t('trace.openWindow')}
          variant="ghost"
          onClick={(event) => {
            event.stopPropagation()
            onOpenWindow(trace.sessionId)
          }}
        >
          <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
        </IconButton>
        <ConfirmationAlertDialog
          open={deleteOpen}
          onOpenChange={onDeleteOpenChange}
          trigger={(
            <IconButton
              label={t('trace.delete')}
              variant="ghost"
              disabled={isDeleting}
              className="hover:text-[var(--color-error)]"
              onClick={(event) => event.stopPropagation()}
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            </IconButton>
          )}
          title={t('trace.list.deleteConfirmTitle')}
          description={t('trace.list.deleteConfirmBody', { title })}
          cancelLabel={t('common.cancel')}
          actionLabel={t('common.delete')}
          onConfirm={onConfirmDelete}
          loading={isDeleting}
          destructive
          error={deleteError}
        />
      </div>
    </Card>
  )
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <div className="font-mono text-[11px] leading-4 text-[var(--color-text-primary)]">{value}</div>
      <div className="truncate text-[10px] uppercase leading-4 tracking-wide text-[var(--color-text-tertiary)]" title={label}>{label}</div>
    </div>
  )
}

function MetaCard({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'danger' }) {
  return (
    <Card className="rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)]">
      <CardContent className="flex items-baseline justify-between gap-2 px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">{label}</span>
        <span className={`font-mono text-sm ${tone === 'danger' ? 'text-[var(--color-error)]' : 'text-[var(--color-text-primary)]'}`}>{value}</span>
      </CardContent>
    </Card>
  )
}

function TraceListSkeleton({ label }: { label: string }) {
  return (
    <div className="min-h-0 flex-1 overflow-hidden" role="status" aria-label={label}>
      <div className="divide-y divide-[var(--color-border)]" aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex h-14 items-center gap-4 px-5">
            <div className="min-w-0 flex-1">
              <Skeleton className="h-3 w-48 max-w-full" />
              <Skeleton className="mt-2 h-2.5 w-72 max-w-full" />
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <Skeleton className="h-3 w-10" />
              <Skeleton className="h-3 w-12" />
              <Skeleton className="h-3 w-12" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function openTrace(sessionId: string, title: string, t: ReturnType<typeof useTranslation>) {
  useTabStore.getState().openTraceTab(sessionId, `${t('trace.title')}: ${title}`)
}

function getTraceTitle(trace: TraceSessionListItem, t: ReturnType<typeof useTranslation>): string {
  return trace.session?.title || t('session.untitled')
}

function openTraceSettings(t: ReturnType<typeof useTranslation>) {
  useUIStore.getState().setPendingSettingsTab('general')
  useTabStore.getState().openTab(SETTINGS_TAB_ID, t('sidebar.settings'), 'settings')
}

/** `claude-sonnet-4-5-20250929` -> `sonnet-4-5`; non-Claude ids pass through. */
function shortModelName(model: string): string {
  const short = model.replace(/^claude-/i, '').replace(/-\d{8}$/, '')
  return short || model
}

/** Compact count: 847 -> "847", 1234 -> "1.2k", 2345678 -> "2.3m". */
function formatCompact(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  if (value < 1000) return String(value)
  const scaled = value < 1_000_000 ? value / 1000 : value / 1_000_000
  const unit = value < 1_000_000 ? 'k' : 'm'
  const text = scaled >= 100 ? String(Math.round(scaled)) : scaled.toFixed(1).replace(/\.0$/, '')
  return `${text}${unit}`
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '-'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatUpdatedAt(value: string | null): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString()
}
