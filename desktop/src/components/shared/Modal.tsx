import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { X } from 'lucide-react'

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { Button } from '../ui/button'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

type ModalProps = {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  width?: number
  footer?: ReactNode
}

/**
 * Compatibility shell for the two legacy transcript previews that still use
 * the Modal API. Focus trapping, Escape, outside-click and focus restoration
 * are delegated to the shared shadcn/Radix dialog primitive.
 */
export function Modal({ open, onClose, title, children, width = 560, footer }: ModalProps) {
  const wasOpenRef = useRef(false)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  if (open && !wasOpenRef.current) {
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  }

  useLayoutEffect(() => {
    if (!open && wasOpenRef.current && previousFocusRef.current?.isConnected) {
      const previousFocus = previousFocusRef.current
      queueMicrotask(() => {
        if (previousFocus.isConnected) previousFocus.focus()
      })
    }
    wasOpenRef.current = open
  }, [open])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    if (focusable.length === 0) {
      event.preventDefault()
      event.currentTarget.focus()
      return
    }

    const first = focusable[0]!
    const last = focusable[focusable.length - 1]!
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose()
      }}
    >
      <DialogContent
        showCloseButton={false}
        aria-label={title}
        aria-describedby={undefined}
        onKeyDown={handleKeyDown}
        overlayProps={{ onClick: onClose }}
        className="flex max-h-[85vh] max-w-[calc(100vw-48px)] flex-col gap-0 overflow-hidden p-0"
        style={{ width }}
      >
        {title ? (
          <DialogHeader className="flex-row items-start justify-between gap-4 px-6 pb-0 pt-6 pr-6">
            <DialogTitle>{title}</DialogTitle>
            <DialogClose asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close dialog"
                className="h-9 w-9 shrink-0 rounded-full"
              >
                <X size={18} aria-hidden="true" />
              </Button>
            </DialogClose>
          </DialogHeader>
        ) : (
          <DialogTitle className="sr-only">Dialog</DialogTitle>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {children}
        </div>

        {footer ? (
          <DialogFooter className="px-6 pb-6 pt-0">
            {footer}
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
