import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const alertVariants = cva(
  'relative grid w-full gap-1 rounded-[var(--radius-md)] border px-3 py-2.5 text-left text-sm',
  {
    variants: {
      variant: {
        default:
          'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)]',
        destructive:
          'border-[var(--color-error)]/35 bg-[var(--color-error-container)] text-[var(--color-error)]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

const Alert = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<'div'> & VariantProps<typeof alertVariants>
>(function Alert({ className, variant, ...props }, ref) {
  return (
    <div
      ref={ref}
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
})

function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="alert-title" className={cn('font-medium', className)} {...props} />
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn('text-xs leading-5 text-[var(--color-text-tertiary)]', className)}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription }
