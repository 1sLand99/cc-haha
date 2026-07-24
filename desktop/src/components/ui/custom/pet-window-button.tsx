import * as React from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type PetWindowButtonSurface = 'mascot' | 'taskBadge' | 'session' | 'panelToggle'

const surfaceClassNames: Record<PetWindowButtonSurface, string> = {
  mascot: 'pet-mascot-button !h-auto !w-auto !rounded-none !p-0 hover:!bg-transparent',
  taskBadge: 'pet-task-badge',
  session: 'pet-session-row !justify-start !whitespace-normal',
  panelToggle: 'pet-panel-toggle',
}

type PetWindowButtonProps = Omit<
  React.ComponentProps<typeof Button>,
  'size' | 'variant'
> & {
  surface: PetWindowButtonSurface
}

const PetWindowButton = React.forwardRef<HTMLButtonElement, PetWindowButtonProps>(
  function PetWindowButton({ surface, className, ...props }, ref) {
    return (
      <Button
        ref={ref}
        variant="ghost"
        size="icon"
        data-custom-slot="pet-window-button"
        data-surface={surface}
        className={cn(surfaceClassNames[surface], className)}
        {...props}
      />
    )
  },
)

export { PetWindowButton }
