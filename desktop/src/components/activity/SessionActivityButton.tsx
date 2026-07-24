import { ListChecks } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useActivityPanelStore } from '../../stores/activityPanelStore'
import { IconButton } from '../ui/custom/icon-button'

type SessionActivityButtonProps = {
  sessionId: string
  label?: string
}

export function SessionActivityButton({
  sessionId,
  label,
}: SessionActivityButtonProps) {
  const t = useTranslation()
  const resolvedLabel = label ?? t('session.activity.title')
  const isOpen = useActivityPanelStore((state) => state.isOpen(sessionId))
  const toggle = useActivityPanelStore((state) => state.toggle)
  return (
    <IconButton
      variant="ghost"
      size="icon-sm"
      label={resolvedLabel}
      aria-label={resolvedLabel}
      aria-expanded={isOpen}
      aria-pressed={isOpen}
      aria-controls={`session-activity-panel-${sessionId}`}
      id={`session-activity-trigger-${sessionId}`}
      title={resolvedLabel}
      onClick={() => toggle(sessionId)}
      data-active={isOpen ? 'true' : 'false'}
      data-session-id={sessionId}
      data-session-activity-trigger="true"
      className={`relative rounded-[10px] ${
        isOpen
          ? 'bg-[var(--color-surface-hover)] text-[var(--color-text-primary)]'
          : 'text-[var(--color-text-tertiary)]'
      }`}
    >
      <ListChecks size={17} strokeWidth={1.9} aria-hidden="true" />
    </IconButton>
  )
}
