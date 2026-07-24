import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Toggle as TogglePrimitive } from 'radix-ui'

import { cn } from '@/lib/utils'

const toggleVariants = cva(
  'inline-flex cursor-pointer items-center justify-center rounded-[var(--radius-md)] border border-transparent text-xs font-semibold outline-none transition-[background-color,border-color,color,box-shadow] hover:bg-[var(--color-surface-hover)] focus-visible:border-[var(--color-border-focus)] focus-visible:shadow-[var(--shadow-focus-ring)] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 data-[state=on]:border-transparent data-[state=on]:bg-[image:var(--gradient-btn-primary)] data-[state=on]:text-[var(--color-btn-primary-fg)] data-[state=on]:shadow-[var(--shadow-button-primary)] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4',
  {
    variants: {
      variant: {
        default: 'border-[var(--color-border)] text-[var(--color-text-secondary)]',
        ghost: 'text-[var(--color-text-secondary)]',
      },
      size: {
        sm: 'h-8 gap-1 px-2',
        default: 'h-9 gap-1.5 px-3',
        lg: 'h-10 gap-2 px-4 text-sm',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Toggle({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> &
VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
