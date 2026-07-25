import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'group/button inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-[var(--radius-md)] border border-transparent font-medium outline-none transition-[background-color,border-color,color,box-shadow,transform] focus-visible:border-[var(--color-border-focus)] focus-visible:shadow-[var(--shadow-focus-ring)] active:translate-y-px disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4',
  {
    variants: {
      variant: {
        default:
          'bg-[image:var(--gradient-btn-primary)] text-[var(--color-btn-primary-fg)] shadow-[var(--shadow-button-primary)] hover:bg-[image:var(--gradient-btn-primary-hover)] hover:brightness-105',
        secondary:
          'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]',
        outline:
          'border-[var(--color-border)] bg-transparent text-[var(--color-text-primary)] hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface-hover)]',
        ghost:
          'bg-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]',
        destructive:
          'bg-[var(--color-error)] text-white hover:opacity-90 focus-visible:border-[var(--color-error)]',
        link:
          'bg-transparent p-0 text-[var(--color-brand)] underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-7 gap-1 px-2 text-xs',
        default: 'h-9 gap-1.5 px-3 text-sm',
        lg: 'h-10 gap-2 px-5 text-sm',
        icon: 'size-9',
        'icon-sm': 'size-7',
        'icon-lg': 'size-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

const Button = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }
>(function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  type,
  ...props
}, ref) {
  const Comp = asChild ? Slot.Root : 'button'

  return (
    <Comp
      ref={ref}
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      type={asChild ? undefined : (type ?? 'button')}
      {...props}
    />
  )
})
Button.displayName = 'Button'

export { Button, buttonVariants }
