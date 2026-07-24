import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  LoaderCircle,
  TimerOff,
  X,
} from 'lucide-react'
import { useTaskStore } from '../../stores/taskStore'
import { useChatStore } from '../../stores/chatStore'
import { useTabStore } from '../../stores/tabStore'
import { useTranslation } from '../../i18n'
import { parseRunOutput } from '../../lib/parseRunOutput'
import type { TaskRun } from '../../types/task'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'
import { Alert, AlertDescription } from '../ui/alert'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible'
import { ScrollArea } from '../ui/scroll-area'
import { Skeleton } from '../ui/skeleton'
import { IconButton } from '../ui/custom/icon-button'

function RunOutput({ run }: { run: TaskRun }) {
  const t = useTranslation()

  // Show error prominently if present
  if (run.error) {
    return (
      <Alert variant="destructive" className="mt-2">
        <AlertDescription className="whitespace-pre-wrap break-words text-[var(--color-error)]">
          {run.error}
        </AlertDescription>
      </Alert>
    )
  }

  const text = parseRunOutput(run.output || '')

  if (!text) {
    return (
      <Card className="mt-2 border-transparent">
        <CardContent className="p-3 text-xs italic text-[var(--color-text-tertiary)]">
          {run.sessionId ? t('tasks.outputHintSession') : t('tasks.noOutputText')}
        </CardContent>
      </Card>
    )
  }

  return (
    <ScrollArea className="mt-2 h-48 rounded-[var(--radius-md)] bg-[var(--color-surface-container)]">
      <div className="p-3">
        <MarkdownRenderer
          content={text}
          variant="compact"
          className="break-words"
        />
      </div>
    </ScrollArea>
  )
}

type Props = {
  taskId: string
  onClose: () => void
  refreshKey?: number
}

const STATUS_CONFIG = {
  running: {
    icon: LoaderCircle,
    className: 'border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 text-[var(--color-warning)]',
  },
  completed: {
    icon: CheckCircle2,
    className: 'border-[var(--color-success)]/30 bg-[var(--color-success)]/10 text-[var(--color-success)]',
  },
  failed: {
    icon: CircleAlert,
    className: 'border-[var(--color-error)]/30 bg-[var(--color-error-container)] text-[var(--color-error)]',
  },
  timeout: {
    icon: TimerOff,
    className: 'border-[var(--color-error)]/30 bg-[var(--color-error-container)] text-[var(--color-error)]',
  },
}

export function TaskRunsPanel({ taskId, onClose, refreshKey }: Props) {
  const t = useTranslation()
  const { fetchTaskRuns, fetchTaskRunDetail } = useTaskStore()
  const connectToSession = useChatStore((s) => s.connectToSession)
  const openTab = useTabStore((s) => s.openTab)
  const [runs, setRuns] = useState<TaskRun[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [detailState, setDetailState] = useState<{
    runId: string
    status: 'loading' | 'error'
  } | null>(null)
  const requestGeneration = useRef(0)
  const detailGeneration = useRef(0)
  const selectedRunId = useRef<string | null>(null)
  const currentTaskId = useRef(taskId)
  const mounted = useRef(true)
  const detailAbortController = useRef<AbortController | null>(null)

  const openSession = (sessionId: string, taskName?: string) => {
    openTab(sessionId, taskName || 'Task Run')
    connectToSession(sessionId)
  }

  const cancelDetailRequest = useCallback(() => {
    detailAbortController.current?.abort()
    detailAbortController.current = null
  }, [])

  const refresh = useCallback(() => {
    const generation = ++requestGeneration.current
    fetchTaskRuns(taskId, { limit: 100, summaryOnly: true }).then((r) => {
      if (generation !== requestGeneration.current) return
      setListError(false)
      setRuns((current) => {
        const previousById = new Map(current.map(run => [run.id, run]))
        return r.map((run) => {
          const previous = previousById.get(run.id)
          return {
            ...run,
            ...(run.output === undefined && previous?.output !== undefined
              ? { output: previous.output }
              : {}),
            ...(run.error === undefined && previous?.error !== undefined
              ? { error: previous.error }
              : {}),
          }
        })
      })
      const selectedId = selectedRunId.current
      if (selectedId && r.some(run =>
        run.id === selectedId && (!!run.output || !!run.error),
      )) {
        cancelDetailRequest()
        detailGeneration.current += 1
        setDetailState(null)
      }
      setLoading(false)
    }).catch(() => {
      if (generation === requestGeneration.current) {
        setListError(true)
        setLoading(false)
      }
    })
  }, [cancelDetailRequest, fetchTaskRuns, taskId])

  const loadDetail = async (run: TaskRun) => {
    cancelDetailRequest()
    const controller = new AbortController()
    detailAbortController.current = controller
    const requestedTaskId = taskId
    const requestedDetailGeneration = detailGeneration.current + 1
    detailGeneration.current = requestedDetailGeneration
    selectedRunId.current = run.id
    setDetailState({ runId: run.id, status: 'loading' })
    try {
      const detail = await fetchTaskRunDetail(run.id, { signal: controller.signal })
      if (
        controller.signal.aborted ||
        !mounted.current ||
        currentTaskId.current !== requestedTaskId ||
        detailGeneration.current !== requestedDetailGeneration ||
        selectedRunId.current !== run.id
      ) return
      setRuns((current) => current.map((item) => {
        if (item.id !== detail.id || item.taskId !== requestedTaskId) return item
        if (item.output || item.error) return item
        return detail
      }))
      setDetailState(null)
    } catch {
      if (
        !controller.signal.aborted &&
        mounted.current &&
        currentTaskId.current === requestedTaskId &&
        detailGeneration.current === requestedDetailGeneration &&
        selectedRunId.current === run.id
      ) {
        setDetailState({ runId: run.id, status: 'error' })
      }
    } finally {
      if (detailAbortController.current === controller) {
        detailAbortController.current = null
      }
    }
  }

  const toggleOutput = (run: TaskRun) => {
    if (expandedId === run.id) {
      cancelDetailRequest()
      selectedRunId.current = null
      detailGeneration.current += 1
      setDetailState(null)
      setExpandedId(null)
      return
    }
    cancelDetailRequest()
    selectedRunId.current = run.id
    setDetailState(null)
    setExpandedId(run.id)
    if (!run.output && !run.error && (run.hasOutput || run.hasError)) {
      void loadDetail(run)
    }
  }

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      cancelDetailRequest()
      selectedRunId.current = null
      detailGeneration.current += 1
    }
  }, [cancelDetailRequest])

  useEffect(() => {
    cancelDetailRequest()
    currentTaskId.current = taskId
    selectedRunId.current = null
    detailGeneration.current += 1
    setDetailState(null)
    setExpandedId(null)
  }, [cancelDetailRequest, taskId])

  // Initial fetch + re-fetch when refreshKey changes
  useEffect(() => {
    setLoading(true)
    setListError(false)
    refresh()
    return () => { requestGeneration.current += 1 }
  }, [refresh, refreshKey])

  // Auto-poll while any run is "running" or shortly after a manual trigger.
  // Uses faster 1s polling for the first 10s after refreshKey changes, then 3s.
  const hasRunning = runs.some((r) => r.status === 'running')
  useEffect(() => {
    if (!hasRunning && refreshKey === 0) return // no reason to poll initially
    // Start with fast polling (1s) to give snappy feedback after "Run Now"
    let interval = 1000
    let timer = setInterval(refresh, interval)
    // After 10s, switch to slower 3s polling if still running
    const slowDown = setTimeout(() => {
      clearInterval(timer)
      if (hasRunning) {
        timer = setInterval(refresh, 3000)
      }
    }, 10000)
    // If nothing is running and initial window passes, stop entirely
    const stopTimer = hasRunning ? undefined : setTimeout(() => clearInterval(timer), 12000)
    return () => {
      clearInterval(timer)
      clearTimeout(slowDown)
      if (stopTimer) clearTimeout(stopTimer)
    }
  }, [hasRunning, taskId, refreshKey, refresh])

  return (
    <Card
      role="region"
      aria-label={t('tasks.logsTitle')}
      aria-busy={loading || undefined}
      className="overflow-hidden bg-[var(--color-surface)]"
    >
      <CardHeader className="flex-row items-center justify-between border-b border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)] px-4 py-3">
        <CardTitle className="text-sm">{t('tasks.logsTitle')}</CardTitle>
        <IconButton label={t('tasks.close')} variant="ghost" onClick={onClose}>
          <X aria-hidden="true" />
        </IconButton>
      </CardHeader>

      <CardContent className="p-0">
        {loading ? (
          <div aria-label={t('common.loading')} className="space-y-3 p-4">
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </div>
        ) : listError ? (
          <Alert variant="destructive" className="m-4 w-auto">
            <AlertDescription className="flex items-center justify-between gap-3 text-[var(--color-error)]">
              <span>{t('common.error')}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setLoading(true)
                  setListError(false)
                  refresh()
                }}
              >
                {t('common.retry')}
              </Button>
            </AlertDescription>
          </Alert>
        ) : runs.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-[var(--color-text-tertiary)]">
            {t('tasks.noLogs')}
          </div>
        ) : (
          <ScrollArea className="h-72">
            <div className="divide-y divide-[var(--color-border-separator)]">
              {runs.map((run) => {
                const config = STATUS_CONFIG[run.status] || STATUS_CONFIG.failed
                const StatusIcon = config.icon
                const isExpanded = expandedId === run.id
                const hasDetails = !!(run.output || run.error || run.hasOutput || run.hasError)

                return (
                  <Collapsible
                    key={run.id}
                    open={isExpanded}
                    onOpenChange={() => {
                      if (hasDetails) toggleOutput(run)
                    }}
                    className="px-4 py-3"
                  >
                    <div className="flex flex-wrap items-center gap-2.5">
                      <Badge variant="outline" className={config.className}>
                        <StatusIcon
                          className={run.status === 'running' ? 'animate-spin' : undefined}
                          aria-hidden="true"
                        />
                        {t(`tasks.runStatus.${run.status}` as any)}
                      </Badge>

                      <span className="text-xs text-[var(--color-text-tertiary)]">
                        {new Date(run.startedAt).toLocaleString()}
                      </span>
                      {run.durationMs != null ? (
                        <span className="text-xs text-[var(--color-text-tertiary)]">
                          {t('tasks.duration', { s: Math.round(run.durationMs / 1000) })}
                        </span>
                      ) : null}

                      <div className="ml-auto flex items-center gap-2">
                        {run.sessionId && run.status !== 'running' ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openSession(run.sessionId!, run.taskName)}
                          >
                            <ExternalLink aria-hidden="true" />
                            {t('tasks.openSession')}
                          </Button>
                        ) : null}

                        {hasDetails ? (
                          <CollapsibleTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-expanded={isExpanded}
                            >
                              {isExpanded ? t('tasks.hideOutput') : t('tasks.viewOutput')}
                            </Button>
                          </CollapsibleTrigger>
                        ) : null}
                      </div>
                    </div>

                    <CollapsibleContent>
                      {run.output || run.error ? (
                        <RunOutput run={run} />
                      ) : detailState?.runId === run.id && detailState.status === 'loading' ? (
                        <div
                          role="status"
                          className="mt-2 space-y-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container)] p-3"
                        >
                          <span className="sr-only">{t('common.loading')}</span>
                          <Skeleton className="h-3 w-3/4" />
                          <Skeleton className="h-3 w-1/2" />
                        </div>
                      ) : detailState?.runId === run.id && detailState.status === 'error' ? (
                        <Alert variant="destructive" className="mt-2">
                          <AlertDescription className="flex items-center justify-between gap-3 text-[var(--color-error)]">
                            <span>{t('common.error')}</span>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => { void loadDetail(run) }}
                            >
                              {t('common.retry')}
                            </Button>
                          </AlertDescription>
                        </Alert>
                      ) : (
                        <RunOutput run={run} />
                      )}
                    </CollapsibleContent>
                  </Collapsible>
                )
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  )
}
