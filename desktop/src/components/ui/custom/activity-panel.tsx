import * as React from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

const ActivityPanel = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<typeof Card>
>(function ActivityPanel({ className, ...props }, ref) {
  return (
    <Card
      ref={ref}
      data-slot="activity-panel"
      className={cn(
        'flex flex-col overflow-hidden bg-[var(--color-surface)]',
        className,
      )}
      {...props}
    />
  )
})
ActivityPanel.displayName = 'ActivityPanel'

const ActivityPanelScrollArea = React.forwardRef<
  React.ElementRef<typeof ScrollArea>,
  React.ComponentProps<typeof ScrollArea>
>(function ActivityPanelScrollArea({ className, ...props }, ref) {
  return (
    <ScrollArea
      ref={ref}
      data-slot="activity-panel-scroll-area"
      className={cn('min-h-0 flex-1', className)}
      {...props}
    />
  )
})
ActivityPanelScrollArea.displayName = 'ActivityPanelScrollArea'

const ActivityPanelRowButton = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<typeof Button>
>(function ActivityPanelRowButton({ className, ...props }, ref) {
  return (
    <Button
      ref={ref}
      variant="ghost"
      data-activity-row-action="true"
      className={cn(
        'h-auto min-w-0 justify-start gap-2.5 whitespace-normal rounded-lg px-2.5 py-2.5 text-left font-normal',
        className,
      )}
      {...props}
    />
  )
})
ActivityPanelRowButton.displayName = 'ActivityPanelRowButton'

function ActivityPanelCountBadge({
  className,
  ...props
}: React.ComponentProps<typeof Badge>) {
  return (
    <Badge
      variant="secondary"
      data-slot="activity-panel-count"
      className={cn(
        'min-h-0 rounded-full border-0 bg-[var(--color-surface-container)] px-1.5 py-0.5 text-[9px] font-normal leading-none text-[var(--color-text-tertiary)]',
        className,
      )}
      {...props}
    />
  )
}

export {
  ActivityPanel,
  ActivityPanelCountBadge,
  ActivityPanelRowButton,
  ActivityPanelScrollArea,
}
