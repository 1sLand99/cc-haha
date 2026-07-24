import * as React from 'react'

import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

type IconButtonProps = React.ComponentProps<typeof Button> & {
  label: string
  tooltip?: string
}

const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton({
    label,
    tooltip = label,
    size = 'icon-sm',
    children,
    ...props
  }, ref) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button ref={ref} size={size} aria-label={label} {...props}>
              {children}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{tooltip}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  },
)

export { IconButton }
