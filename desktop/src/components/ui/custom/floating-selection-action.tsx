import { createPortal } from 'react-dom'
import { forwardRef, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'

type FloatingSelectionActionProps = {
  x: number
  y: number
  label: string
  icon?: ReactNode
  onSelect: () => void
}

const FloatingSelectionAction = forwardRef<HTMLButtonElement, FloatingSelectionActionProps>(
  function FloatingSelectionAction({ x, y, label, icon, onSelect }, ref) {
    return createPortal(
      <Button
        ref={ref}
        type="button"
        variant="secondary"
        data-slot="floating-selection-action"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onSelect}
        className="fixed z-50 h-11 gap-2 rounded-full border-[var(--color-border)]/70 bg-[var(--color-surface-container-lowest)] px-5 text-[15px] font-semibold text-[var(--color-text-primary)] shadow-[0_10px_28px_rgba(15,23,42,0.14),0_2px_8px_rgba(15,23,42,0.08)] hover:bg-[var(--color-surface)]"
        style={{ left: x, top: y }}
      >
        {icon}
        <span>{label}</span>
      </Button>,
      document.body,
    )
  },
)

FloatingSelectionAction.displayName = 'FloatingSelectionAction'

export { FloatingSelectionAction }
