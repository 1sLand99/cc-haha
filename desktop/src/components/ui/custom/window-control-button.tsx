import * as React from 'react'

import { Button } from '../button'
import { cn } from '../../../lib/utils'

type WindowControlButtonProps = React.ComponentProps<typeof Button> & {
  tone?: 'default' | 'close'
}

const WindowControlButton = React.forwardRef<HTMLButtonElement, WindowControlButtonProps>(
  function WindowControlButton({
    className,
    tone = 'default',
    ...props
  }, ref) {
    return (
      <Button
        ref={ref}
        variant="ghost"
        size="icon"
        data-window-control={tone}
        className={cn(
          'h-full w-[46px] rounded-none text-[var(--color-text-secondary)] active:translate-y-0',
          tone === 'close'
            ? 'hover:bg-[var(--color-window-close-hover)] hover:text-white'
            : 'hover:bg-[var(--color-surface-hover)]',
          className,
        )}
        {...props}
      />
    )
  },
)

export { WindowControlButton }
