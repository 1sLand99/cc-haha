import { useCallback, useState, useRef } from 'react'
import type { CronTask } from '../../types/task'
import { useTaskStore } from '../../stores/taskStore'
import { useTranslation } from '../../i18n'
import { describeCron } from '../../lib/cronDescribe'
import { TaskRunsPanel } from './TaskRunsPanel'
import { NewTaskModal } from './NewTaskModal'
import { ConfirmPopover } from '@/components/tasks/ConfirmPopover'
import { StatusDot } from '@/components/ui/Badge'
import { IconButton } from '@/components/ui/IconButton'
import { useDismissable } from '@/hooks/useDismissable'

type Props = {
  task: CronTask
  showLogs: boolean
  onToggleLogs: () => void
}

type ConfirmAction = 'run' | 'toggle' | 'delete' | null

export function TaskRow({ task, showLogs, onToggleLogs }: Props) {
  const { deleteTask, updateTask, runTask } = useTaskStore()
  const t = useTranslation()
  const [showEdit, setShowEdit] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null)
  const [logsRefreshKey, setLogsRefreshKey] = useState(0)
  const menuRef = useRef<HTMLDivElement>(null)
  const confirmRef = useRef<HTMLDivElement>(null)

  // Two overlays with independent open states, so two subscriptions rather
  // than one handler branching on both. The hand-rolled version listened on
  // `mousedown`, which does not fire reliably for touch — on the H5 build
  // tapping outside left this menu open. Escape now closes them too; neither
  // overlay lives inside a dialog, so no propagation guard is needed.
  const closeMenu = useCallback(() => setShowMenu(false), [])
  const closeConfirm = useCallback(() => setConfirmAction(null), [])

  useDismissable({ open: showMenu, refs: [menuRef], onDismiss: closeMenu })
  useDismissable({ open: confirmAction !== null, refs: [confirmRef], onDismiss: closeConfirm })

  const handleRunNow = async () => {
    setConfirmAction(null)
    setIsRunning(true)
    if (!showLogs) onToggleLogs() // open logs panel (accordion will close others)
    try {
      await runTask(task.id)
      setLogsRefreshKey((k) => k + 1)
    } catch (err) {
      console.error('Failed to run task:', err)
    } finally {
      setIsRunning(false)
    }
  }

  const handleToggle = () => {
    setConfirmAction(null)
    setShowMenu(false)
    updateTask(task.id, { enabled: !task.enabled })
  }

  const handleDelete = () => {
    setConfirmAction(null)
    setShowMenu(false)
    deleteTask(task.id)
  }

  const menuItem = 'flex items-center gap-2.5 w-full px-3 py-2 text-xs text-left rounded-[var(--radius-sm)] transition-colors'

  return (
    <div className="border-b border-[var(--color-border-separator)]">
      <div className="flex items-center justify-between px-4 py-3 hover:bg-[var(--color-surface-hover)] transition-colors group">
        {/* Left: status + info */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <StatusDot
            tone={task.enabled ? 'success' : 'neutral'}
            size="md"
            label={task.enabled ? t('tasks.active') : t('tasks.disabled')}
          />
          <div className="min-w-0">
            <div className="text-sm font-medium text-[var(--color-text-primary)] truncate">{task.name}</div>
            {task.description && (
              <div className="text-xs text-[var(--color-text-secondary)] truncate">{task.description}</div>
            )}
            <div className="flex items-center gap-3 text-[11px] text-[var(--color-text-tertiary)] mt-0.5">
              <span>{t('tasks.createdAt')}{new Date(task.createdAt).toLocaleDateString()}</span>
              {task.lastFiredAt && (
                <span>{t('tasks.lastRunAt')}{new Date(task.lastFiredAt).toLocaleDateString()}</span>
              )}
            </div>
          </div>
        </div>

        {/* Right: cron + actions */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="text-xs text-[var(--color-text-tertiary)]" title={task.cron}>
            {describeCron(task.cron, t)}
          </span>

          <div className="flex items-center gap-0.5">
            {/* Run Now */}
            <div className="relative" ref={confirmAction === 'run' ? confirmRef : undefined}>
              <IconButton
                icon={
                  <span className={`material-symbols-outlined text-[18px] ${isRunning ? 'animate-spin' : ''}`}>
                    {isRunning ? 'sync' : 'play_arrow'}
                  </span>
                }
                label={t('tasks.runNow')}
                showTooltip={task.enabled}
                tone={task.enabled ? 'brand' : 'muted'}
                disabled={isRunning || !task.enabled}
                onClick={() => setConfirmAction(confirmAction === 'run' ? null : 'run')}
              />
              {confirmAction === 'run' && (
                <ConfirmPopover
                  message={t('tasks.confirmRun')}
                  confirmLabel={t('tasks.runNow')}
                  onConfirm={handleRunNow}
                  onCancel={() => setConfirmAction(null)}
                  cancelLabel={t('common.cancel')}
                />
              )}
            </div>

            {/* View Logs */}
            <IconButton
              icon={<span className="material-symbols-outlined text-[18px]">receipt_long</span>}
              label={t('tasks.viewLogs')}
              tone={showLogs ? 'brand' : 'muted'}
              // `tone` sets no resting background, so this does not collide.
              className={showLogs ? 'bg-[var(--color-surface-selected)]' : undefined}
              onClick={onToggleLogs}
            />

            {/* More menu */}
            <div className="relative" ref={menuRef}>
              <IconButton
                icon={<span className="material-symbols-outlined text-[18px]">more_vert</span>}
                label={t('tasks.moreActions')}
                tone="muted"
                aria-haspopup="menu"
                aria-expanded={showMenu}
                onClick={() => { setShowMenu(!showMenu); setConfirmAction(null) }}
              />

              {showMenu && !confirmAction && (
                <div className="absolute right-0 top-full mt-1 z-50 w-44 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg py-1">
                  {/* Edit */}
                  <button
                    onClick={() => { setShowMenu(false); setShowEdit(true) }}
                    className={`${menuItem} text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]`}
                  >
                    <span className="material-symbols-outlined text-[16px] text-[var(--color-text-secondary)]">edit</span>
                    {t('tasks.edit')}
                  </button>

                  {/* Toggle */}
                  <button
                    onClick={() => setConfirmAction('toggle')}
                    className={`${menuItem} text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]`}
                  >
                    <span className="material-symbols-outlined text-[16px] text-[var(--color-text-secondary)]">
                      {task.enabled ? 'pause_circle' : 'play_circle'}
                    </span>
                    {task.enabled ? t('common.disable') : t('common.enable')}
                  </button>

                  <div className="my-1 h-px bg-[var(--color-border-separator)]" />

                  {/* Delete */}
                  <button
                    onClick={() => setConfirmAction('delete')}
                    className={`${menuItem} text-[var(--color-error)] hover:bg-[var(--color-error-container)]/18`}
                  >
                    <span className="material-symbols-outlined text-[16px]">delete</span>
                    {t('common.delete')}
                  </button>
                </div>
              )}

              {/* Confirm popovers for menu actions */}
              {confirmAction === 'toggle' && (
                <div ref={confirmRef}>
                  <ConfirmPopover
                    message={task.enabled ? t('tasks.confirmDisable') : t('tasks.confirmEnable')}
                    confirmLabel={task.enabled ? t('common.disable') : t('common.enable')}
                    onConfirm={handleToggle}
                    onCancel={() => { setConfirmAction(null); setShowMenu(false) }}
                    cancelLabel={t('common.cancel')}
                  />
                </div>
              )}
              {confirmAction === 'delete' && (
                <div ref={confirmRef}>
                  <ConfirmPopover
                    message={t('tasks.confirmDelete')}
                    confirmLabel={t('common.delete')}
                    onConfirm={handleDelete}
                    onCancel={() => { setConfirmAction(null); setShowMenu(false) }}
                    cancelLabel={t('common.cancel')}
                    confirmVariant="danger"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Runs panel */}
      {showLogs && (
        <div className="px-4 pb-3">
          <TaskRunsPanel taskId={task.id} onClose={onToggleLogs} refreshKey={logsRefreshKey} />
        </div>
      )}

      {/* Edit modal */}
      {showEdit && (
        <NewTaskModal open editTask={task} onClose={() => setShowEdit(false)} />
      )}
    </div>
  )
}
