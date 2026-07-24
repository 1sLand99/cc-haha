import type * as React from 'react'

import { cn } from '@/lib/utils'

function KeyboardShortcut({
  className,
  ...props
}: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      data-slot="keyboard-shortcut"
      className={cn(
        'inline-flex min-w-5 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-1 py-0.5 font-mono text-[10px] leading-none text-[var(--color-text-tertiary)]',
        className,
      )}
      {...props}
    />
  )
}

export { KeyboardShortcut }
