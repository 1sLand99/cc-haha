import { IconButton } from '@/components/ui/IconButton'
import { useUIStore, type Toast as ToastType } from '../../stores/uiStore'
import { useTranslation } from '../../i18n'

const typeStyles: Record<ToastType['type'], string> = {
  success: 'border-l-4 border-l-[var(--color-success)]',
  error: 'border-l-4 border-l-[var(--color-error)]',
  warning: 'border-l-4 border-l-[var(--color-warning)]',
  info: 'border-l-4 border-l-[var(--color-text-accent)]',
}

function ToastItem({ toast }: { toast: ToastType }) {
  const t = useTranslation()
  const removeToast = useUIStore((s) => s.removeToast)
  const isUrgent = toast.type === 'warning' || toast.type === 'error'

  return (
    <div
      role={isUrgent ? 'alert' : 'status'}
      aria-live={isUrgent ? 'assertive' : 'polite'}
      aria-atomic="true"
      className={`
        bg-[var(--color-surface)] rounded-[var(--radius-md)] shadow-[var(--shadow-dropdown)]
        px-4 py-3 text-sm text-[var(--color-text-primary)]
        ${typeStyles[toast.type]}
        animate-overlay-in-right
      `}
    >
      <div className="flex items-center justify-between gap-2">
        <span>{toast.message}</span>
        <IconButton
          icon="close"
          label={t('common.dismissNotification')}
          onClick={() => removeToast(toast.id)}
          size="xs"
          tone="muted"
        />
      </div>
    </div>
  )
}

export function ToastContainer() {
  const toasts = useUIStore((s) => s.toasts)

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[var(--z-toast)] flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  )
}
