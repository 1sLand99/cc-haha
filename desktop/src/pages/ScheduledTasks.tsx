import { useEffect, useRef, useState } from 'react'
import { Clock3, Plus, RefreshCw } from 'lucide-react'
import { useTaskStore } from '../stores/taskStore'
import { useUIStore } from '../stores/uiStore'
import { useTranslation } from '../i18n'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Button } from '../components/ui/button'
import { Skeleton } from '../components/ui/skeleton'
import { TaskList } from '../components/tasks/TaskList'
import { TaskEmptyState } from '../components/tasks/TaskEmptyState'
import { NewTaskModal } from '../components/tasks/NewTaskModal'

export function ScheduledTasks() {
  const { tasks, fetchTasks, isLoading, error } = useTaskStore()
  const { activeModal, openModal, closeModal } = useUIStore()
  const t = useTranslation()
  const [initialized, setInitialized] = useState(false)
  const newTaskTriggerRef = useRef<HTMLButtonElement | null>(null)

  const openNewTask = (trigger: HTMLButtonElement) => {
    newTaskTriggerRef.current = trigger
    openModal('new-task')
  }

  useEffect(() => {
    let active = true
    void fetchTasks().finally(() => {
      if (active) setInitialized(true)
    })
    return () => {
      active = false
    }
  }, [fetchTasks])

  return (
    <div className="flex-1 overflow-y-auto">
      <main className="mx-auto w-full max-w-6xl px-5 py-6 sm:px-8 lg:px-10 lg:py-8">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">{t('scheduledPage.title')}</h1>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
              {(() => {
                const parts = t('scheduledPage.subtitle').split('{code}')
                return <>{parts[0]}<code className="px-1 py-0.5 rounded bg-[var(--color-surface-container)] text-xs font-[var(--font-mono)]">/schedule</code>{parts[1]}</>
              })()}
            </p>
          </div>
          <Button onClick={(event) => openNewTask(event.currentTarget)} className="shrink-0">
            <Plus aria-hidden="true" />
            {t('tasks.newTask').replace(/^\+\s*/, '')}
          </Button>
        </div>

        <Alert
          role="note"
          className="mb-6 grid-cols-[auto_1fr] items-center gap-x-2.5 border-[var(--color-warning)]/25 bg-[var(--color-warning)]/8"
        >
          <Clock3 className="size-[18px] text-[var(--color-warning)]" aria-hidden="true" />
          <AlertDescription className="text-[var(--color-text-secondary)]">
            {t('scheduledPage.desktopNotice')}
          </AlertDescription>
        </Alert>

        {!initialized && isLoading ? (
          <div aria-label={t('common.loading')} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {[0, 1, 2].map((item) => (
                <Skeleton key={item} className="h-[76px]" />
              ))}
            </div>
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
        ) : error ? (
          <Alert variant="destructive">
            <AlertDescription className="flex items-center justify-between gap-3 text-[var(--color-error)]">
              <span>{error}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void fetchTasks()}
                disabled={isLoading}
              >
                <RefreshCw className={isLoading ? 'animate-spin' : ''} aria-hidden="true" />
                {t('common.retry')}
              </Button>
            </AlertDescription>
          </Alert>
        ) : tasks.length === 0 ? (
          <TaskEmptyState onCreateTask={openNewTask} />
        ) : (
          <TaskList tasks={tasks} />
        )}
      </main>

      {activeModal === 'new-task' && (
        <NewTaskModal
          open
          onClose={closeModal}
          restoreFocusRef={newTaskTriggerRef}
        />
      )}
    </div>
  )
}
