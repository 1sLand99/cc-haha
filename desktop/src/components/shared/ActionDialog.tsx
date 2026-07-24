import type { ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog'
import { buttonVariants } from '../ui/button'
import { cn } from '../../lib/utils'

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'

export type ActionDialogAction = {
  label: string
  onClick: () => void | Promise<void>
  variant?: ButtonVariant
  loading?: boolean
  disabled?: boolean
}

type ActionDialogProps = {
  open: boolean
  onClose: () => void
  title: string
  body: ReactNode
  actions: ActionDialogAction[]
  width?: number
  loading?: boolean
}

export function ActionDialog({
  open,
  onClose,
  title,
  body,
  actions,
  width = 460,
  loading = false,
}: ActionDialogProps) {
  const busy = loading || actions.some((action) => action.loading)

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !busy) onClose()
      }}
    >
      <AlertDialogContent style={{ maxWidth: width }}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            {typeof body === 'string' ? (
              <p>{body}</p>
            ) : (
              <div>{body}</div>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {actions.map((action, index) => {
            const isCancel = index === 0
            const Action = isCancel ? AlertDialogCancel : AlertDialogAction
            const variant = action.variant === 'danger'
              ? 'destructive'
              : action.variant === 'primary'
                ? 'default'
                : action.variant ?? 'secondary'
            return (
              <Action
                key={action.label}
                type="button"
                onClick={(event) => {
                  if (action.loading || busy || action.disabled) {
                    event.preventDefault()
                    return
                  }
                  if (!isCancel) event.preventDefault()
                  void action.onClick()
                }}
                disabled={busy || action.disabled}
                className={cn(buttonVariants({ variant }), 'gap-2')}
              >
                {action.loading && (
                  <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                )}
                {action.label}
              </Action>
            )
          })}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
