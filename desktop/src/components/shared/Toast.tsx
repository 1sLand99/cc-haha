import { useUIStore, type Toast as ToastType } from '../../stores/uiStore'
import { useTranslation } from '../../i18n'
import { X } from 'lucide-react'
import { Card } from '../ui/card'
import { IconButton } from '../ui/custom/icon-button'

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
    <Card
      role={isUrgent ? 'alert' : 'status'}
      aria-live={isUrgent ? 'assertive' : 'polite'}
      aria-atomic="true"
      className={`
        bg-[var(--color-surface)] rounded-[var(--radius-md)] shadow-[var(--shadow-dropdown)] border-0
        px-4 py-3 text-sm text-[var(--color-text-primary)]
        ${typeStyles[toast.type]}
        animate-in slide-in-from-right fade-in duration-200
      `}
    >
      <div className="flex items-center justify-between gap-2">
        <span>{toast.message}</span>
        <IconButton
          variant="ghost"
          size="icon-sm"
          onClick={() => removeToast(toast.id)}
          label={t('common.dismissNotification')}
          className="text-[var(--color-text-tertiary)]"
        >
          <X size={16} aria-hidden="true" />
        </IconButton>
      </div>
    </Card>
  )
}

export function ToastContainer() {
  const toasts = useUIStore((s) => s.toasts)

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  )
}
