import { useRef, type ReactNode, type Ref } from 'react'
import { X } from 'lucide-react'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '../ui/sheet'
import { Button } from '../ui/button'

type Props = {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  closeLabel?: string
  headerExtra?: ReactNode
  footer?: ReactNode
  id?: string
  role?: string
  ariaLabel?: string
  contentClassName?: string
  panelClassName?: string
  panelRef?: Ref<HTMLDivElement>
  testId?: string
}

export function MobileBottomSheet({
  open,
  onClose,
  title,
  children,
  closeLabel = 'Close',
  headerExtra,
  footer,
  id,
  ariaLabel,
  contentClassName = '',
  panelClassName = '',
  panelRef,
  testId,
}: Props) {
  const returnFocusRef = useRef<HTMLElement | null>(null)

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose()
      }}
    >
      <SheetContent
        ref={panelRef}
        id={id}
        aria-label={ariaLabel ?? (typeof title === 'string' ? title : undefined)}
        data-testid={testId}
        side="bottom"
        showCloseButton={false}
        overlayClassName="z-[10000] bg-black/25"
        className={`z-[10001] max-h-[min(78dvh,640px)] min-h-0 overflow-hidden rounded-t-2xl border-x-0 border-y border-[var(--color-border)] shadow-[0_-18px_48px_rgba(54,35,28,0.22)] ${panelClassName}`}
        onOpenAutoFocus={() => {
          returnFocusRef.current = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          returnFocusRef.current?.focus()
          returnFocusRef.current = null
        }}
      >
        <SheetHeader className="shrink-0 border-b border-[var(--color-border)] px-4 py-3">
          <div className="flex min-h-10 items-center justify-between gap-3">
            <SheetTitle className="min-w-0 text-[11px] font-bold uppercase tracking-widest text-[var(--color-outline)]">
              {title}
            </SheetTitle>
            <SheetClose asChild>
              <Button
                variant="ghost"
                size="icon-lg"
                aria-label={closeLabel}
                className="shrink-0 rounded-full"
              >
                <X className="size-5" aria-hidden="true" />
              </Button>
            </SheetClose>
          </div>
          {headerExtra && (
            <div className="mt-3">
              {headerExtra}
            </div>
          )}
        </SheetHeader>

        <div className={`min-h-0 flex-1 overflow-y-auto ${contentClassName}`}>
          {children}
        </div>

        {footer && (
          <SheetFooter className="shrink-0 border-t border-[var(--color-border)] p-0">
            {footer}
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  )
}
