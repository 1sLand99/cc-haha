import { useId, type ReactNode } from 'react'

import { cn } from '@/lib/utils'
import { Switch } from '@/components/ui/switch'

type SettingSwitchRowProps = {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label: string
  description: ReactNode
  disabled?: boolean
  className?: string
  contentClassName?: string
  children?: ReactNode
}

function SettingSwitchRow({
  checked,
  onCheckedChange,
  label,
  description,
  disabled = false,
  className,
  contentClassName,
  children,
}: SettingSwitchRowProps) {
  const id = useId()

  return (
    <div
      data-slot="setting-switch-row"
      className={cn(
        'rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-4 py-3 transition-colors hover:border-[var(--color-border-focus)]',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <Switch
          id={id}
          checked={checked}
          disabled={disabled}
          aria-label={label}
          onCheckedChange={onCheckedChange}
          className="mt-0.5"
        />
        <div className={cn('min-w-0 flex-1', contentClassName)}>
          <label
            htmlFor={id}
            className={cn(
              'cursor-pointer text-sm font-medium text-[var(--color-text-primary)]',
              disabled && 'cursor-not-allowed',
            )}
          >
            {label}
          </label>
          <div className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">
            {description}
          </div>
          {children}
        </div>
      </div>
    </div>
  )
}

export { SettingSwitchRow }
