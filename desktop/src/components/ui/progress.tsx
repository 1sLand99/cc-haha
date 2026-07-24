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

  return (
    <ProgressPrimitive.Root
      ref={ref}
      data-slot="progress"
      className={cn(
        'relative h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-container-low)]',
        className,
      )}
      value={normalizedValue}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        data-indeterminate={normalizedValue === null ? 'true' : undefined}
        className="h-full w-full rounded-full bg-[var(--color-text-accent)] transition-transform duration-300 data-[indeterminate=true]:w-1/3 data-[indeterminate=true]:opacity-75 data-[indeterminate=true]:motion-safe:animate-pulse data-[indeterminate=true]:motion-reduce:animate-none"
        style={
          normalizedValue === null
            ? undefined
            : { transform: `translateX(-${100 - normalizedValue}%)` }
        }
      />
    </ProgressPrimitive.Root>
  )
})

export { Progress }
