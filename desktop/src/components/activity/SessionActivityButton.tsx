import { ListChecks } from 'lucide-react'
import { IconButton } from '@/components/ui/IconButton'
import { useTranslation } from '../../i18n'
import { useActivityPanelStore } from '../../stores/activityPanelStore'

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
      icon={<ListChecks size={17} strokeWidth={1.9} />}
      label={resolvedLabel}
      size="md"
      tone={isOpen ? 'default' : 'muted'}
      // `default` sets no resting background, so this adds one without colliding
      // with a tone class.
      className={isOpen ? 'bg-[var(--color-surface-hover)]' : undefined}
      aria-expanded={isOpen}
      aria-pressed={isOpen}
      onClick={() => toggle(sessionId)}
      data-active={isOpen ? 'true' : 'false'}
      data-session-activity-trigger="true"
    />
  )
}
