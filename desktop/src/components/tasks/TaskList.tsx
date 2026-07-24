import { useState } from 'react'
import type { CronTask } from '../../types/task'
import { TaskRow } from './TaskRow'
import { useTranslation } from '../../i18n'
import { Card, CardContent } from '../ui/card'

type Props = {
  tasks: CronTask[]
}

export function TaskList({ tasks }: Props) {
  const t = useTranslation()
  const enabledCount = tasks.filter((task) => task.enabled).length
  const [expandedLogsId, setExpandedLogsId] = useState<string | null>(null)

  return (
    <div>
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label={t('tasks.totalTasks')} value={String(tasks.length)} />
        <StatCard label={t('tasks.active')} value={String(enabledCount)} />
        <StatCard label={t('tasks.disabled')} value={String(tasks.length - enabledCount)} />
      </div>

      <div className="flex flex-col gap-3" role="list">
        {tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            showLogs={expandedLogsId === task.id}
            onToggleLogs={() => setExpandedLogsId(expandedLogsId === task.id ? null : task.id)}
          />
        ))}
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="border-transparent bg-[var(--color-surface-info)]">
      <CardContent className="px-4 py-3">
        <div className="text-2xl font-bold text-[var(--color-text-primary)]">{value}</div>
        <div className="text-xs text-[var(--color-text-secondary)]">{label}</div>
      </CardContent>
    </Card>
  )
}
