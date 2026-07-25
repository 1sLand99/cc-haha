import * as React from 'react'
import { Collapsible as CollapsiblePrimitive } from 'radix-ui'

function Collapsible(props: React.ComponentProps<typeof CollapsiblePrimitive.Root>) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />
}

const CollapsibleTrigger = React.forwardRef<
  React.ElementRef<typeof CollapsiblePrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof CollapsiblePrimitive.Trigger>
>(function CollapsibleTrigger(props, ref) {
  return <CollapsiblePrimitive.Trigger ref={ref} data-slot="collapsible-trigger" {...props} />
})
CollapsibleTrigger.displayName = 'CollapsibleTrigger'

const CollapsibleContent = React.forwardRef<
  React.ElementRef<typeof CollapsiblePrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof CollapsiblePrimitive.Content>
>(function CollapsibleContent(props, ref) {
  return <CollapsiblePrimitive.Content ref={ref} data-slot="collapsible-content" {...props} />
})
CollapsibleContent.displayName = 'CollapsibleContent'

export { Collapsible, CollapsibleContent, CollapsibleTrigger }
