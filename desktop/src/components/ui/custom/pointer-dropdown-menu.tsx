import { useCallback, useEffect, useRef, type ReactNode } from 'react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

type PointerDropdownAnchor = {
  top: number
  bottom: number
  left: number
  right: number
}

type PointerDropdownMenuProps = {
  open: boolean
  anchor: PointerDropdownAnchor
  onOpenChange: (open: boolean) => void
  triggerEl?: HTMLElement | null
  dismissOnViewportChange?: boolean
  className?: string
  children: ReactNode
}

function PointerDropdownMenu({
  open,
  anchor,
  onOpenChange,
  triggerEl,
  dismissOnViewportChange = false,
  className,
  children,
}: PointerDropdownMenuProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  const openRef = useRef(open)
  openRef.current = open

  const requestOpenChange = useCallback((nextOpen: boolean) => {
    if (openRef.current === nextOpen) return
    openRef.current = nextOpen
    onOpenChange(nextOpen)
  }, [onOpenChange])

  useEffect(() => {
    if (!open || !dismissOnViewportChange) return

    const dismiss = () => requestOpenChange(false)
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    return () => {
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
    }
  }, [dismissOnViewportChange, open, requestOpenChange])

  useEffect(() => {
    if (!open) return

    const dismissOutside = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target || contentRef.current?.contains(target) || triggerEl?.contains(target)) return
      requestOpenChange(false)
    }
    document.addEventListener('pointerdown', dismissOutside, true)
    return () => document.removeEventListener('pointerdown', dismissOutside, true)
  }, [open, requestOpenChange, triggerEl])

  return (
    <DropdownMenu open={open} onOpenChange={requestOpenChange} modal={false}>
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden="true"
          data-slot="pointer-dropdown-anchor"
          className="pointer-events-none fixed opacity-0"
          style={{
            left: anchor.left,
            top: anchor.top,
            width: Math.max(1, anchor.right - anchor.left),
            height: Math.max(1, anchor.bottom - anchor.top),
          }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        ref={contentRef}
        align="start"
        side="bottom"
        sideOffset={6}
        collisionPadding={8}
        className={cn('min-w-[220px]', className)}
        onInteractOutside={(event) => {
          if (triggerEl?.contains(event.target as Node)) event.preventDefault()
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          window.requestAnimationFrame(() => {
            if (document.activeElement === document.body) triggerEl?.focus()
          })
        }}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { PointerDropdownMenu, type PointerDropdownAnchor }
