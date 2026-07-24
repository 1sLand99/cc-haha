import * as React from 'react'

import { cn } from '@/lib/utils'

type ResizableSeparatorProps = Omit<
  React.ComponentPropsWithoutRef<'div'>,
  'role' | 'aria-label' | 'aria-orientation' | 'aria-valuemin' | 'aria-valuemax' | 'aria-valuenow'
> & {
  label: string
  orientation: 'horizontal' | 'vertical'
  value: number
  min: number
  max: number
}

const ResizableSeparator = React.forwardRef<HTMLDivElement, ResizableSeparatorProps>(
  function ResizableSeparator(
    { className, label, orientation, value, min, max, ...props },
    ref,
  ) {
    const isVertical = orientation === 'vertical'

    return (
      <div
        ref={ref}
        role="separator"
        aria-label={label}
        aria-orientation={orientation}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        tabIndex={0}
        data-slot="resizable-separator"
        className={cn(
          'group shrink-0 bg-[var(--color-surface)] outline-none focus-visible:bg-[var(--color-surface-container)] focus-visible:shadow-[var(--shadow-focus-ring)]',
          isVertical
            ? 'relative z-10 flex w-2 cursor-col-resize items-stretch justify-center'
            : 'flex h-2.5 cursor-row-resize items-center',
          className,
        )}
        {...props}
      >
        <div
          aria-hidden="true"
          className={cn(
            'rounded-full bg-[var(--color-border)] transition-colors group-hover:bg-[var(--color-border-focus)] group-focus-visible:bg-[var(--color-border-focus)]',
            isVertical ? 'my-3 w-px' : 'mx-3 h-px flex-1',
          )}
        />
      </div>
    )
  },
)

export { ResizableSeparator }
