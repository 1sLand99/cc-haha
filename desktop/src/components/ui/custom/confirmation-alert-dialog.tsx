import * as React from 'react'

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { LoadingButton } from '@/components/ui/custom/loading-button'

type ConfirmationAlertDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: React.ReactElement
  title: string
  description: React.ReactNode
  cancelLabel: string
  actionLabel: string
  onConfirm: () => void | Promise<void>
  loading?: boolean
  destructive?: boolean
  error?: string | null
}

function ConfirmationAlertDialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  cancelLabel,
  actionLabel,
  onConfirm,
  loading = false,
  destructive = false,
  error,
}: ConfirmationAlertDialogProps) {
  const cancelRef = React.useRef<HTMLButtonElement>(null)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const previousOpenRef = React.useRef(open)
  const restoreTriggerFocusRef = React.useRef(false)

  React.useEffect(() => {
    if (previousOpenRef.current && !open) {
      restoreTriggerFocusRef.current = true
    }
    previousOpenRef.current = open

    if (!open && !loading && restoreTriggerFocusRef.current) {
      const trigger = triggerRef.current
      queueMicrotask(() => {
        if (!trigger?.isConnected || trigger.disabled) return
        trigger.focus()
        restoreTriggerFocusRef.current = false
      })
    }
  }, [loading, open])

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!loading) onOpenChange(nextOpen)
      }}
    >
      <AlertDialogTrigger ref={triggerRef} asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent
        onEscapeKeyDown={(event) => {
          if (loading) event.preventDefault()
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          queueMicrotask(() => cancelRef.current?.focus())
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          restoreTriggerFocusRef.current = true
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            {typeof description === 'string' ? <p>{description}</p> : <div>{description}</div>}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription className="text-[var(--color-error)]">{error}</AlertDescription>
          </Alert>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel ref={cancelRef} disabled={loading}>
            {cancelLabel}
          </AlertDialogCancel>
          <LoadingButton
            variant={destructive ? 'destructive' : 'default'}
            loading={loading}
            onClick={() => void onConfirm()}
          >
            {actionLabel}
          </LoadingButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export { ConfirmationAlertDialog }
