import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'

import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex min-h-5 w-fit shrink-0 items-center justify-center gap-1 rounded-[var(--radius-md)] border px-2 py-0.5 text-xs font-medium leading-4',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-[var(--color-brand)] text-[var(--color-on-primary)]',
        secondary:
          'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)]',
        outline:
          'border-[var(--color-border)] bg-transparent text-[var(--color-text-secondary)]',
        destructive:
          'border-[var(--color-error)]/30 bg-[var(--color-error-container)] text-[var(--color-error)]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

const Badge = React.forwardRef<
  HTMLSpanElement,
  React.ComponentProps<'span'> &
  VariantProps<typeof badgeVariants> & {
    asChild?: boolean
  }
>(function Badge({
  className,
  variant,
  asChild = false,
  ...props
}, ref) {
  const Comp = asChild ? Slot.Root : 'span'
  return (
    <Comp
      ref={ref}
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
})

export { Badge, badgeVariants }
