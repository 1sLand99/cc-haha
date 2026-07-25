import * as React from 'react'

import { cn } from '@/lib/utils'
import { Card } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'

type ComposerOverlayPanelProps = React.ComponentProps<typeof Card> & {
  viewportClassName?: string
  footer?: React.ReactNode
}

const ComposerOverlayPanel = React.forwardRef<HTMLDivElement, ComposerOverlayPanelProps>(
  function ComposerOverlayPanel({
    className,
    viewportClassName,
    footer,
    children,
    ...props
  }, ref) {
    return (
      <Card
        ref={ref}
        data-slot="composer-overlay-panel"
        className={cn(
          'absolute bottom-full left-0 right-0 z-50 mb-2 overflow-hidden bg-[var(--color-surface-container-lowest)] shadow-[var(--shadow-dropdown)]',
          className,
        )}
        {...props}
      >
        <ScrollArea className={cn('max-h-[300px]', viewportClassName)}>
          {children}
        </ScrollArea>
        {footer}
      </Card>
    )
  },
)
ComposerOverlayPanel.displayName = 'ComposerOverlayPanel'

export { ComposerOverlayPanel }
