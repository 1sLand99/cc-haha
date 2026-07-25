import * as React from 'react'
import { Progress as ProgressPrimitive } from 'radix-ui'

import { cn } from '@/lib/utils'

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>
>(function Progress({ className, value, ...props }, ref) {
  const normalizedValue =
    typeof value === 'number'
      ? Math.min(Math.max(value, 0), 100)
      : null

  const isIndeterminate = normalizedValue === null

  return (
    <ProgressPrimitive.Root
      ref={ref}
      data-slot="progress"
      className={cn(
        'relative h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-container-low)]',
        isIndeterminate && 'progress-indeterminate-track',
        className,
      )}
      value={normalizedValue}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        data-indeterminate={isIndeterminate ? 'true' : undefined}
        className="h-full w-full rounded-full bg-[var(--color-text-accent)] transition-transform duration-300 data-[indeterminate=true]:hidden"
        style={
          isIndeterminate
            ? undefined
            : { transform: `translateX(-${100 - normalizedValue}%)` }
        }
      />
    </ProgressPrimitive.Root>
  )
})
Progress.displayName = 'Progress'

export { Progress }
