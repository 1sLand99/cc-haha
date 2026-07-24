import type { ReactNode } from 'react'

import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

type EmptyStateProps = {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
  className?: string
  testId?: string
}

function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  testId,
}: EmptyStateProps) {
  return (
    <Card
      data-testid={testId}
      className={cn('border-dashed bg-[var(--color-surface-container-low)]', className)}
    >
      <CardContent className="flex flex-col items-center px-6 py-16 text-center">
        {icon ? (
          <div className="mb-3 text-[var(--color-text-tertiary)]" aria-hidden="true">
            {icon}
          </div>
        ) : null}
        <p className="text-sm font-medium text-[var(--color-text-secondary)]">{title}</p>
        {description ? (
          <p className="mt-1 max-w-lg text-xs leading-5 text-[var(--color-text-tertiary)]">
            {description}
          </p>
        ) : null}
        {action ? <div className="mt-4">{action}</div> : null}
      </CardContent>
    </Card>
  )
}

export { EmptyState }
