import * as React from 'react'

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { LoadingButton } from '@/components/ui/custom/loading-button'

type ScheduledTaskActionDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  restoreFocusRef: React.RefObject<HTMLButtonElement | null>
  title: string
  description: React.ReactNode
  cancelLabel: string
  actionLabel: string
  onConfirm: () => void | Promise<void>
  loading?: boolean
  destructive?: boolean
  error?: string | null
}

function ScheduledTaskActionDialog({
  open,
  onOpenChange,
  restoreFocusRef,
  title,
  description,
  cancelLabel,
  actionLabel,
  onConfirm,
  loading = false,
  destructive = false,
  error,
}: ScheduledTaskActionDialogProps) {
  const cancelRef = React.useRef<HTMLButtonElement>(null)

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!loading) onOpenChange(nextOpen)
      }}
    >
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
          queueMicrotask(() => {
            if (restoreFocusRef.current?.isConnected) {
              restoreFocusRef.current.focus()
            }
          })
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

export { ScheduledTaskActionDialog }
