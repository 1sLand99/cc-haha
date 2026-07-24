import { useId, useRef, useState } from 'react'
import {
  EllipsisVertical,
  FileClock,
  LoaderCircle,
  PauseCircle,
  Pencil,
  Play,
  PlayCircle,
  Trash2,
} from 'lucide-react'
import type { CronTask } from '../../types/task'
import { useTaskStore } from '../../stores/taskStore'
import { useTranslation } from '../../i18n'
import { describeCron } from '../../lib/cronDescribe'
import { TaskRunsPanel } from './TaskRunsPanel'
import { NewTaskModal } from './NewTaskModal'
import { Badge } from '../ui/badge'
import { Card, CardContent } from '../ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { IconButton } from '../ui/custom/icon-button'
import { ScheduledTaskActionDialog } from '../ui/custom/scheduled-task-action-dialog'

type Props = {
  task: CronTask
  showLogs: boolean
  onToggleLogs: () => void
}

type ConfirmAction = 'run' | 'toggle' | 'delete'

export function TaskRow({ task, showLogs, onToggleLogs }: Props) {
  const { deleteTask, updateTask, runTask } = useTaskStore()
  const t = useTranslation()
  const [showEdit, setShowEdit] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)
  const [pendingAction, setPendingAction] = useState<ConfirmAction | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [logsRefreshKey, setLogsRefreshKey] = useState(0)
  const runButtonRef = useRef<HTMLButtonElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const restoreActionRef = useRef<ConfirmAction>('run')
  const logsPanelId = useId()

  const openConfirmation = (action: ConfirmAction) => {
    restoreActionRef.current = action
    setActionError(null)
    setConfirmAction(action)
  }

  const closeConfirmation = () => {
    if (pendingAction) return
    setConfirmAction(null)
    setActionError(null)
  }

  const handleConfirm = async () => {
    const action = confirmAction
    if (!action || pendingAction) return
    setPendingAction(action)
    setActionError(null)
    try {
      if (action === 'run') {
        if (!showLogs) onToggleLogs()
        await runTask(task.id)
        setLogsRefreshKey((current) => current + 1)
      } else if (action === 'toggle') {
        await updateTask(task.id, { enabled: !task.enabled })
      } else {
        await deleteTask(task.id)
      }
      setConfirmAction(null)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t('common.error'))
    } finally {
      setPendingAction(null)
    }
  }

  const dialogTitle = confirmAction === 'run'
    ? t('tasks.confirmRun')
    : confirmAction === 'toggle'
      ? task.enabled ? t('tasks.confirmDisable') : t('tasks.confirmEnable')
      : t('tasks.confirmDelete')
  const actionLabel = confirmAction === 'run'
    ? t('tasks.runNow')
    : confirmAction === 'toggle'
      ? task.enabled ? t('common.disable') : t('common.enable')
      : t('common.delete')

  return (
    <Card role="listitem" className="overflow-hidden bg-[var(--color-surface)]">
      <Collapsible
        open={showLogs}
        onOpenChange={(nextOpen) => {
          if (nextOpen !== showLogs) onToggleLogs()
        }}
      >
        <CardContent className="p-0">
          <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
                  {task.name}
                </span>
                <Badge
                  variant={task.enabled ? 'default' : 'secondary'}
                  className={task.enabled
                    ? 'bg-[var(--color-success)] text-white'
                    : undefined}
                >
                  {task.enabled ? t('tasks.active') : t('tasks.disabled')}
                </Badge>
              </div>
              {task.description ? (
                <p className="mt-1 truncate text-xs text-[var(--color-text-secondary)]">
                  {task.description}
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--color-text-tertiary)]">
                <span>{t('tasks.createdAt')}{new Date(task.createdAt).toLocaleDateString()}</span>
                {task.lastFiredAt ? (
                  <span>{t('tasks.lastRunAt')}{new Date(task.lastFiredAt).toLocaleDateString()}</span>
                ) : null}
                <Badge variant="outline" title={task.cron} className="font-normal">
                  {describeCron(task.cron, t)}
                </Badge>
              </div>
            </div>

            <div className="flex shrink-0 items-center justify-end gap-1">
              <IconButton
                ref={runButtonRef}
                label={task.enabled ? t('tasks.runNow') : `${t('tasks.runNow')} · ${t('tasks.disabled')}`}
                variant="ghost"
                disabled={!task.enabled || pendingAction === 'run'}
                onClick={() => openConfirmation('run')}
              >
                {pendingAction === 'run'
                  ? <LoaderCircle className="animate-spin" aria-hidden="true" />
                  : <Play aria-hidden="true" />}
              </IconButton>

              <CollapsibleTrigger asChild>
                <IconButton
                  label={t('tasks.viewLogs')}
                  variant={showLogs ? 'secondary' : 'ghost'}
                  aria-controls={logsPanelId}
                  aria-expanded={showLogs}
                >
                  <FileClock aria-hidden="true" />
                </IconButton>
              </CollapsibleTrigger>

              <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
                <DropdownMenuTrigger asChild>
                  <IconButton
                    ref={menuButtonRef}
                    label={t('tasks.actions')}
                    variant="ghost"
                  >
                    <EllipsisVertical aria-hidden="true" />
                  </IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  onCloseAutoFocus={(event) => {
                    if (confirmAction) event.preventDefault()
                  }}
                >
                  <DropdownMenuItem onSelect={() => setShowEdit(true)}>
                    <Pencil aria-hidden="true" />
                    {t('tasks.edit')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => openConfirmation('toggle')}>
                    {task.enabled
                      ? <PauseCircle aria-hidden="true" />
                      : <PlayCircle aria-hidden="true" />}
                    {task.enabled ? t('common.disable') : t('common.enable')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-[var(--color-error)] focus:bg-[var(--color-error-container)]"
                    onSelect={() => openConfirmation('delete')}
                  >
                    <Trash2 aria-hidden="true" />
                    {t('common.delete')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <CollapsibleContent id={logsPanelId}>
            <div className="border-t border-[var(--color-border-separator)] p-4">
              <TaskRunsPanel taskId={task.id} onClose={onToggleLogs} refreshKey={logsRefreshKey} />
            </div>
          </CollapsibleContent>
        </CardContent>
      </Collapsible>

      {showEdit ? (
        <NewTaskModal
          open
          editTask={task}
          onClose={() => setShowEdit(false)}
          restoreFocusRef={menuButtonRef}
        />
      ) : null}

      <ScheduledTaskActionDialog
        open={confirmAction !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) closeConfirmation()
        }}
        restoreFocusRef={restoreActionRef.current === 'run' ? runButtonRef : menuButtonRef}
        title={dialogTitle}
        description={(
          <span>
            <strong className="font-medium text-[var(--color-text-primary)]">{task.name}</strong>
            {task.description ? <span className="mt-1 block">{task.description}</span> : null}
          </span>
        )}
        cancelLabel={t('common.cancel')}
        actionLabel={actionLabel}
        onConfirm={handleConfirm}
        loading={pendingAction !== null}
        destructive={confirmAction === 'delete'}
        error={actionError}
      />
    </Card>
  )
}
