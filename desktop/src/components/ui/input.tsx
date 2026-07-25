import * as React from 'react'

import { cn } from '@/lib/utils'

const Input = React.forwardRef<
  HTMLInputElement,
  React.ComponentProps<'input'>
>(function Input({ className, type, ...props }, ref) {
  return (
    <input
      ref={ref}
      type={type}
      data-slot="input"
      className={cn(
        'h-10 w-full min-w-0 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text-primary)] outline-none transition-[border-color,box-shadow] placeholder:text-[var(--color-text-tertiary)] focus-visible:border-[var(--color-border-focus)] focus-visible:shadow-[var(--shadow-focus-ring)] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-[var(--color-error)] aria-invalid:shadow-[var(--shadow-error-ring)]',
        className,
      )}
      {...props}
    />
  )
})
Input.displayName = 'Input'

export { Input }
