import { Clock3, Plus } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { Button } from '../ui/button'
import { Card, CardContent } from '../ui/card'

type Props = {
  onCreateTask: (trigger: HTMLButtonElement) => void
}

export function TaskEmptyState({ onCreateTask }: Props) {
  const t = useTranslation()
  return (
    <Card className="bg-[var(--color-surface)]">
      <CardContent className="flex flex-col items-center justify-center px-6 py-16 text-center">
        <div className="mb-4 flex size-16 items-center justify-center rounded-full bg-[var(--color-surface-info)]">
          <Clock3 className="size-8 text-[var(--color-text-tertiary)]" strokeWidth={1.5} aria-hidden="true" />
        </div>

        <h2 className="mb-1 text-sm font-medium text-[var(--color-text-primary)]">
          {t('tasks.emptyTitle')}
        </h2>
        <p className="mb-4 max-w-sm text-sm text-[var(--color-text-tertiary)]">
          {t('tasks.emptyDesc')}
        </p>

        <Button onClick={(event) => onCreateTask(event.currentTarget)}>
          <Plus aria-hidden="true" />
          {t('tasks.newTask').replace(/^\+\s*/, '')}
        </Button>
      </CardContent>
    </Card>
  )
}
