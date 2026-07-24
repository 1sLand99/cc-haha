import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { TerminalStatus } from '@/lib/terminalRuntime'

const STATUS_DOT_CLASS: Record<TerminalStatus, string> = {
  idle: 'bg-[var(--color-text-tertiary)]',
  starting: 'bg-[var(--color-warning)]',
  running: 'bg-[var(--color-success)]',
  exited: 'bg-[var(--color-text-tertiary)]',
  error: 'bg-[var(--color-error)]',
  unavailable: 'bg-[var(--color-text-tertiary)]',
}

type TerminalStatusBadgeProps = {
  compact?: boolean
  label: string
  status: TerminalStatus
}

function TerminalStatusBadge({
  compact = false,
  label,
  status,
}: TerminalStatusBadgeProps) {
  return (
    <Badge
      variant="secondary"
      role="status"
      aria-live="polite"
      className={cn(
        'rounded-full',
        compact ? 'min-h-5 px-2 text-[10px]' : 'min-h-6 px-2.5 text-[11px]',
      )}
    >
      <span
        className={cn('size-1.5 rounded-full', STATUS_DOT_CLASS[status])}
        aria-hidden="true"
      />
      {label}
    </Badge>
  )
}

export { TerminalStatusBadge }
