import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronRight, Circle, FileText, LoaderCircle, Square, Terminal, Users, X } from 'lucide-react'
import { AgentMascot } from '../ui/custom/agent-mascot'
import {
  ActivityPanel,
  ActivityPanelCountBadge,
  ActivityPanelRowButton,
  ActivityPanelScrollArea,
} from '../ui/custom/activity-panel'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../ui/collapsible'
import { IconButton } from '../ui/custom/icon-button'
import { LoadingButton } from '../ui/custom/loading-button'
import { Separator } from '../ui/separator'
import { getVisibleActivitySections, type ActivityRow, type ActivitySectionId, type SessionActivityModel } from './sessionActivityModel'
import { useTranslation } from '../../i18n'
import type { BackgroundAgentTask } from '../../types/chat'
import type { TeamMember } from '../../types/team'
import { formatTokenCount } from '../../lib/formatTokenCount'

export type OpenSubagentPayload = {
  sessionId: string
  taskId?: string
  toolUseId: string
  title: string
}

type SessionActivityPanelPlacement = 'overlay' | 'rail'

type TranslationFn = ReturnType<typeof useTranslation>

function fallbackStatusLabel(status: ActivityRow['status']): string {
  const label = String(status).replace(/[_-]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!label) return ''
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`
}

function getActivityStatusLabel(status: ActivityRow['status'], t: TranslationFn): string {
  switch (status) {
    case 'pending':
      return t('session.activity.status.pending')
    case 'in_progress':
      return t('session.activity.status.inProgress')
    case 'completed':
      return t('session.activity.status.completed')
    case 'running':
      return t('session.activity.status.running')
    case 'failed':
      return t('session.activity.status.failed')
    case 'stopped':
      return t('session.activity.status.stopped')
    case 'idle':
      return t('session.activity.status.idle')
    case 'error':
      return t('session.activity.status.error')
    default:
      return fallbackStatusLabel(status)
  }
}

function getSectionTitle(sectionId: ActivitySectionId, t: TranslationFn): string {
  switch (sectionId) {
    case 'tasks':
      return t('session.activity.section.tasks')
    case 'team':
      return t('session.activity.section.team')
    case 'backgroundTasks':
      return t('session.activity.section.backgroundTasks')
    case 'subagents':
      return t('session.activity.section.subagents')
    case 'sources':
      return t('session.activity.section.sources')
    case 'output':
      return t('subagentRun.output')
  }
}

function getTaskTypeLabel(taskType: BackgroundAgentTask['taskType'] | undefined, t: TranslationFn): string {
  if (taskType?.includes('agent')) return t('chat.backgroundTasks.type.agent')
  if (taskType === 'local_bash') return t('chat.backgroundTasks.type.bash')
  if (taskType === 'local_workflow') return t('chat.backgroundTasks.type.workflow')
  return t('chat.backgroundTasks.type.task')
}

function formatBackgroundDuration(ms: number | undefined, t: TranslationFn): string | undefined {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return undefined
  const totalSeconds = Math.max(1, Math.round(ms / 1000))
  if (totalSeconds < 60) return t('chat.duration.seconds', { seconds: totalSeconds })
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return t('chat.duration.minutesSeconds', { minutes, seconds })
}

function hasBackgroundTaskDetails(row: ActivityRow): boolean {
  return Boolean(
    row.description ||
      row.summary ||
      row.outputFile ||
      row.taskType ||
      row.workflowName ||
      row.usage?.totalTokens ||
      row.usage?.durationMs,
  )
}

function isActivityTriggerTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-session-activity-trigger="true"]') !== null
}

function focusActivityTrigger(sessionId: string): void {
  queueMicrotask(() => {
    document.getElementById(`session-activity-trigger-${sessionId}`)?.focus()
  })
}

function isBackgroundTaskStatus(status: ActivityRow['status']): status is BackgroundAgentTask['status'] {
  return status === 'running' || status === 'completed' || status === 'failed' || status === 'stopped'
}

function getFinishedBackgroundTaskKeys(model: SessionActivityModel): string[] {
  const keys = new Set<string>()

  for (const sectionId of ['backgroundTasks', 'subagents'] as const) {
    for (const row of model.sections[sectionId].rows) {
      if (row.dismissKey && isBackgroundTaskStatus(row.status) && row.status !== 'running') {
        keys.add(row.dismissKey)
      }
    }
  }

  return Array.from(keys)
}

function TaskStatusMarker({ status, t }: { status: ActivityRow['status']; t: TranslationFn }) {
  if (status === 'completed') {
    return (
      <span
        aria-label={t('session.activity.task.completed')}
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-[var(--color-success)] bg-[var(--color-success)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24)]"
      >
        <Check size={13} strokeWidth={3} aria-hidden="true" />
      </span>
    )
  }

  if (status === 'stopped') {
    return (
      <span
        aria-label={t('session.activity.status.stopped')}
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-[var(--color-text-tertiary)]/50 bg-[var(--color-surface)] text-[var(--color-text-tertiary)]"
      >
        <X size={12} strokeWidth={2.4} aria-hidden="true" />
      </span>
    )
  }

  if (status === 'in_progress' || status === 'running') {
    return (
      <span
        aria-label={t('session.activity.task.inProgress')}
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-[var(--color-brand)] bg-[var(--color-surface)] text-[var(--color-brand)]"
      >
        <LoaderCircle size={13} strokeWidth={2.4} aria-hidden="true" className="motion-safe:animate-spin motion-reduce:animate-none" />
      </span>
    )
  }

  return (
    <span
      aria-label={t('session.activity.task.pending')}
      className="inline-flex h-5 w-5 shrink-0 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]"
    />
  )
}

function getRowIcon(row: ActivityRow) {
  switch (row.section) {
    case 'team':
      return Users
    case 'backgroundTasks':
      return Terminal
    case 'subagents':
      return Users
    case 'sources':
    case 'output':
      return FileText
    case 'tasks':
      return Circle
  }
}

function getStatusTone(status: ActivityRow['status']) {
  if (status === 'running' || status === 'in_progress') {
    return 'bg-[var(--color-brand)]'
  }
  if (status === 'completed' || status === 'idle') {
    return 'bg-[var(--color-success)]'
  }
  if (status === 'failed' || status === 'error' || status === 'stopped') {
    return 'bg-[var(--color-error)]'
  }
  return 'bg-[var(--color-text-tertiary)]'
}

function ActivityRowIcon({ row, sessionId }: { row: ActivityRow; sessionId: string }) {
  if (row.section === 'subagents') {
    return <AgentMascot seed={`${sessionId}:${row.toolUseId ?? row.taskId ?? row.id}`} status={row.status} />
  }

  const Icon = getRowIcon(row)

  return (
    <span className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-lg text-[var(--color-text-tertiary)]">
      <Icon size={15} strokeWidth={2} aria-hidden="true" />
    </span>
  )
}

function ActivityStatusIndicator({
  status,
  label,
  animated = true,
}: {
  status: ActivityRow['status']
  label: string
  animated?: boolean
}) {
  const isRunning = animated && (status === 'running' || status === 'in_progress')

  return (
    <span
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="inline-flex shrink-0 items-center gap-1 text-[10px] font-medium text-[var(--color-text-tertiary)]"
    >
      <span className="relative inline-flex h-1.5 w-1.5" aria-hidden="true">
        {isRunning ? (
          <span className={`absolute inline-flex h-full w-full rounded-full opacity-35 motion-safe:animate-ping motion-reduce:animate-none ${getStatusTone(status)}`} />
        ) : null}
        <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${getStatusTone(status)}`} />
      </span>
      {label}
    </span>
  )
}

function BackgroundTaskStopButton({
  row,
  stopping,
  onStop,
}: {
  row: ActivityRow
  stopping: boolean
  onStop: (taskId: string) => void
}) {
  const t = useTranslation()
  if (row.status !== 'running' || !row.taskId) return null

  const label = stopping
    ? t('session.activity.stoppingBackgroundTask', { name: row.label })
    : t('session.activity.stopBackgroundTask', { name: row.label })

  return (
    <LoadingButton
      variant="ghost"
      size="icon-sm"
      loading={stopping}
      aria-label={label}
      title={label}
      onClick={() => onStop(row.taskId!)}
      className="h-8 w-8 shrink-0 rounded-lg text-[var(--color-text-tertiary)] hover:bg-[var(--color-error)]/10 hover:text-[var(--color-error)] disabled:cursor-wait"
    >
      {!stopping ? (
        <Square size={12} strokeWidth={2.4} aria-hidden="true" />
      ) : null}
    </LoadingButton>
  )
}

function ActivityRowView({
  row,
  sessionId,
  onOpenSubagent,
  onOpenMember,
  onStopBackgroundTask,
  stoppingBackgroundTask,
  backgroundTaskExpandable,
  selected,
}: {
  row: ActivityRow
  sessionId: string
  onOpenSubagent: (payload: OpenSubagentPayload) => void
  onOpenMember?: (member: TeamMember) => void
  onStopBackgroundTask?: (taskId: string) => void
  stoppingBackgroundTask?: boolean
  backgroundTaskExpandable?: boolean
  selected?: boolean
}) {
  const t = useTranslation()
  const isTask = row.section === 'tasks'
  const label = row.taskHistory
    ? t('session.activity.tasks.earlier')
    : row.label
  const detail = row.taskHistory
    ? t('session.activity.tasks.earlierSummary', {
      completed: row.taskHistory.completed,
      total: row.taskHistory.total,
      turns: row.taskHistory.turnCount,
    })
    : isTask && row.description && row.description !== row.label
      ? row.description
      : isTask && row.summary && row.summary !== row.label
        ? row.summary
        : undefined
  const content = (
    <>
      {isTask ? (
        <TaskStatusMarker status={row.status} t={t} />
      ) : (
        <ActivityRowIcon row={row} sessionId={sessionId} />
      )}
      <span className="min-w-0 flex-1 truncate text-left">
        <span
          className={`block truncate text-[12px] font-semibold leading-4 ${isTask && row.status === 'completed' ? 'text-[var(--color-text-tertiary)] line-through decoration-[var(--color-text-tertiary)]/60' : 'text-[var(--color-text-primary)]'}`}
          title={label}
        >
          {label}
        </span>
        {detail ? (
          <span
            className="block truncate text-[10px] leading-4 text-[var(--color-text-tertiary)]"
            title={detail}
          >
            {detail}
          </span>
        ) : null}
      </span>
      {isTask ? null : (
        <ActivityStatusIndicator
          status={row.status}
          label={getActivityStatusLabel(row.status, t)}
          animated={row.section !== 'subagents'}
        />
      )}
      {!isTask && row.openable ? (
        <ChevronRight size={13} strokeWidth={2.2} className="shrink-0 text-[var(--color-text-tertiary)]" aria-hidden="true" />
      ) : null}
    </>
  )
  const stopButton = row.section === 'backgroundTasks' && onStopBackgroundTask ? (
    <BackgroundTaskStopButton
      row={row}
      stopping={Boolean(stoppingBackgroundTask)}
      onStop={onStopBackgroundTask}
    />
  ) : null

  if (row.section === 'team' && row.member && onOpenMember) {
    return (
      <ActivityPanelRowButton
        aria-label={t('session.activity.openTeamMember', { name: row.label })}
        onClick={() => onOpenMember(row.member!)}
        className="w-full"
      >
        {content}
      </ActivityPanelRowButton>
    )
  }

  if (row.section === 'subagents' && row.openable && row.toolUseId) {
    const statusLabel = getActivityStatusLabel(row.status, t)
    const openButton = (
      <ActivityPanelRowButton
        aria-label={`${t('session.activity.openRun', { name: row.label })} · ${statusLabel}`}
        onClick={() => onOpenSubagent({
          sessionId,
          ...(row.taskId ? { taskId: row.taskId } : {}),
          toolUseId: row.toolUseId!,
          title: row.label,
        })}
        className={stopButton ? 'flex-1' : 'w-full'}
      >
        {content}
      </ActivityPanelRowButton>
    )

    return stopButton ? (
      <div className="flex w-full items-center gap-1">
        {openButton}
        {stopButton}
      </div>
    ) : openButton
  }

  if (row.section === 'backgroundTasks' && backgroundTaskExpandable) {
    const openButton = (
      <ActivityPanelRowButton
        aria-label={t('session.activity.openBackgroundTask', { name: row.label })}
        className={`${stopButton ? 'flex-1' : 'w-full'} ${selected ? 'bg-[var(--color-surface-container)]' : ''}`}
      >
        {content}
      </ActivityPanelRowButton>
    )
    const trigger = (
      <CollapsibleTrigger asChild>
        {openButton}
      </CollapsibleTrigger>
    )

    return stopButton ? (
      <div className="flex w-full items-center gap-1">
        {trigger}
        {stopButton}
      </div>
    ) : trigger
  }

  if (stopButton) {
    return (
      <div className="flex w-full items-center gap-1">
        <div className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 py-2.5">
          {content}
        </div>
        {stopButton}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2.5 rounded-lg px-2.5 py-2.5">
      {content}
    </div>
  )
}

function BackgroundTaskDetail({ row }: { row: ActivityRow }) {
  const t = useTranslation()
  const duration = formatBackgroundDuration(row.usage?.durationMs, t)
  const usageParts = [
    typeof row.usage?.totalTokens === 'number'
      ? t('chat.backgroundAgents.tokens', { count: formatTokenCount(row.usage.totalTokens) })
      : '',
    duration,
  ].filter(Boolean)
  const details = [
    row.taskType || row.workflowName
      ? { label: t('session.activity.details.type'), value: getTaskTypeLabel(row.taskType, t) }
      : null,
    row.description
      ? { label: t('session.activity.details.description'), value: row.description }
      : null,
    row.summary
      ? { label: t('session.activity.details.summary'), value: row.summary }
      : null,
    row.outputFile
      ? { label: t('session.activity.details.outputFile'), value: row.outputFile }
      : null,
    usageParts.length > 0
      ? { label: t('session.activity.details.usage'), value: usageParts.join(' · ') }
      : null,
  ].filter((item): item is { label: string; value: string } => Boolean(item?.value))

  if (details.length === 0) return null

  return (
    <Card className="mx-2.5 mb-1.5 rounded-xl p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.54)]">
      <div className="mb-1.5 text-[10px] font-semibold text-[var(--color-text-tertiary)]">
        {t('session.activity.details.title')}
      </div>
      <dl className="space-y-1.5">
        {details.map((detail) => (
          <div key={detail.label} className="min-w-0">
            <dt className="text-[10px] font-semibold text-[var(--color-text-tertiary)]">
              {detail.label}
            </dt>
            <dd className="max-h-28 overflow-auto whitespace-pre-wrap break-words text-[10px] leading-relaxed text-[var(--color-text-secondary)]">
              {detail.value}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  )
}

export function SessionActivityPanel({
  model,
  open,
  onClose,
  onOpenSubagent,
  onClearFinishedBackgroundTasks,
  onOpenMember,
  onStopBackgroundTask,
  stoppingBackgroundTaskIds,
  placement = 'overlay',
}: {
  model: SessionActivityModel
  open: boolean
  onClose: () => void
  onOpenSubagent: (payload: OpenSubagentPayload) => void
  onClearFinishedBackgroundTasks?: (taskKeys: string[]) => void
  onOpenMember?: (member: TeamMember) => void
  onStopBackgroundTask?: (taskId: string) => void
  stoppingBackgroundTaskIds?: Record<string, boolean>
  placement?: SessionActivityPanelPlacement
}) {
  const t = useTranslation()
  const panelRef = useRef<HTMLDivElement>(null)
  const [selectedBackgroundTaskId, setSelectedBackgroundTaskId] = useState<string | null>(null)
  const finishedBackgroundTaskKeys = useMemo(() => getFinishedBackgroundTaskKeys(model), [model])
  const visibleSections = useMemo(() => getVisibleActivitySections(model), [model])
  const panelId = `session-activity-panel-${model.sessionId}`
  const titleId = `${panelId}-title`
  const closeAndRestoreFocus = useCallback(() => {
    onClose()
    focusActivityTrigger(model.sessionId)
  }, [model.sessionId, onClose])

  useEffect(() => {
    if (!open) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeAndRestoreFocus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [closeAndRestoreFocus, open])

  useEffect(() => {
    if (open && placement === 'overlay') {
      panelRef.current?.focus()
    }
  }, [open, placement])

  useEffect(() => {
    if (!open || placement === 'rail') return

    const handlePointerDown = (event: PointerEvent) => {
      if (isActivityTriggerTarget(event.target)) return
      if (panelRef.current?.contains(event.target as Node)) return
      onClose()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [onClose, open, placement])

  useEffect(() => {
    setSelectedBackgroundTaskId(null)
  }, [model.sessionId])

  useEffect(() => {
    if (!open) {
      setSelectedBackgroundTaskId(null)
      return
    }

    if (
      selectedBackgroundTaskId &&
      !model.sections.backgroundTasks.rows.some((row) => row.id === selectedBackgroundTaskId)
    ) {
      setSelectedBackgroundTaskId(null)
    }
  }, [model.sections.backgroundTasks.rows, open, selectedBackgroundTaskId])

  if (!open) return null
  const className = placement === 'rail'
    ? 'my-4 ml-3 mr-3 flex max-h-[min(620px,calc(100vh-72px))] w-[336px] shrink-0 self-start flex-col overflow-hidden rounded-[22px] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[0_24px_72px_-48px_rgba(15,23,42,0.54),0_10px_26px_-22px_rgba(15,23,42,0.32),inset_0_1px_0_rgba(255,255,255,0.82)]'
    : 'absolute right-4 top-4 z-40 flex max-h-[calc(100%-80px)] w-[min(336px,calc(100%-32px))] flex-col overflow-hidden rounded-[22px] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[0_24px_72px_-48px_rgba(15,23,42,0.54),0_10px_26px_-22px_rgba(15,23,42,0.32),inset_0_1px_0_rgba(255,255,255,0.82)]'

  return (
    <ActivityPanel
      ref={panelRef}
      id={panelId}
      role={placement === 'rail' ? 'complementary' : 'dialog'}
      aria-modal={placement === 'overlay' ? false : undefined}
      aria-labelledby={titleId}
      tabIndex={placement === 'overlay' ? -1 : undefined}
      data-testid="session-activity-panel"
      data-placement={placement}
      className={className}
    >
      <div className="flex items-center justify-between px-4 pb-1.5 pt-3.5">
        <h2 id={titleId} className="text-[12px] font-semibold text-[var(--color-text-secondary)]">
          {t('session.activity.title')}
        </h2>
        <IconButton
          variant="ghost"
          size="icon-sm"
          label={t('session.activity.close')}
          onClick={closeAndRestoreFocus}
          data-activity-panel-close="true"
          className="rounded-lg text-[var(--color-text-tertiary)]"
        >
          <X size={14} strokeWidth={2.2} aria-hidden="true" />
        </IconButton>
      </div>

      <ActivityPanelScrollArea
        data-testid="session-activity-scroll"
      >
        <div className="space-y-3 px-4 pb-4 pt-0.5">
          {visibleSections.map((section, index) => {
            const sectionTitle = getSectionTitle(section.id, t)

            return (
              <section
                key={section.id}
                aria-label={sectionTitle}
              >
                {index > 0 ? <Separator className="mb-3" /> : null}
                <div className="mb-1.5 flex items-center justify-between gap-2 px-0.5">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <h3 className="text-[11px] font-semibold text-[var(--color-text-tertiary)]">
                      {sectionTitle}
                    </h3>
                    {section.rows.length > 0 ? (
                      <ActivityPanelCountBadge>
                        {section.rows.length}
                      </ActivityPanelCountBadge>
                    ) : null}
                  </div>
                  {section.id === 'backgroundTasks' && finishedBackgroundTaskKeys.length > 0 && onClearFinishedBackgroundTasks ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(event) => {
                        const section = event.currentTarget.closest('section')
                        const nextSectionAction = section?.nextElementSibling?.querySelector<HTMLElement>(
                          '[data-activity-row-action="true"]',
                        )
                        onClearFinishedBackgroundTasks(finishedBackgroundTaskKeys)
                        queueMicrotask(() => {
                          if (nextSectionAction?.isConnected) {
                            nextSectionAction.focus()
                            return
                          }
                          const nextAction = panelRef.current?.querySelector<HTMLElement>(
                            '[data-activity-row-action="true"], [data-activity-panel-close="true"]',
                          )
                          if (nextAction) {
                            nextAction.focus()
                            return
                          }
                          focusActivityTrigger(model.sessionId)
                        })
                      }}
                      className="h-auto rounded px-1.5 py-0.5 text-[11px] text-[var(--color-text-tertiary)]"
                    >
                      {t('session.activity.clearFinished')}
                    </Button>
                  ) : null}
                </div>
                <div className="space-y-1.5">
                  {section.rows.map((row) => {
                    const expandableBackgroundTask = section.id === 'backgroundTasks' && hasBackgroundTaskDetails(row)
                    const selected = expandableBackgroundTask && selectedBackgroundTaskId === row.id
                    const rowView = (
                      <ActivityRowView
                        row={row}
                        sessionId={model.sessionId}
                        onOpenSubagent={onOpenSubagent}
                        onOpenMember={onOpenMember}
                        onStopBackgroundTask={onStopBackgroundTask}
                        stoppingBackgroundTask={Boolean(row.taskId && stoppingBackgroundTaskIds?.[row.taskId])}
                        backgroundTaskExpandable={expandableBackgroundTask}
                        selected={selected}
                      />
                    )

                    if (!expandableBackgroundTask) {
                      return <div key={row.id}>{rowView}</div>
                    }

                    return (
                      <Collapsible
                        key={row.id}
                        open={selected}
                        onOpenChange={(nextOpen) => {
                          setSelectedBackgroundTaskId(nextOpen ? row.id : null)
                        }}
                      >
                        {rowView}
                        <CollapsibleContent
                          role="region"
                          aria-label={`${t('session.activity.details.title')}: ${row.label}`}
                        >
                          <BackgroundTaskDetail row={row} />
                        </CollapsibleContent>
                      </Collapsible>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
      </ActivityPanelScrollArea>
    </ActivityPanel>
  )
}
