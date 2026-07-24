import type * as React from 'react'
import { Circle } from 'lucide-react'
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui'

import { cn } from '@/lib/utils'

type SettingRadioCardProps = Omit<
  React.ComponentProps<typeof RadioGroupPrimitive.Item>,
  'children'
> & {
  label: string
  description: string
}

function SettingRadioCard({
  className,
  label,
  description,
  ...props
}: SettingRadioCardProps) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="setting-radio-card"
      className={cn(
        'relative min-h-16 w-full cursor-pointer rounded-lg border border-[var(--color-border)] px-3 py-2 pr-9 text-left text-[var(--color-text-secondary)] outline-none transition-[background-color,border-color,box-shadow] hover:bg-[var(--color-surface-hover)] focus-visible:border-[var(--color-border-focus)] focus-visible:shadow-[var(--shadow-focus-ring)] disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-[var(--color-brand)] data-[state=checked]:bg-[var(--color-surface-selected)] data-[state=checked]:text-[var(--color-text-primary)]',
        className,
      )}
      {...props}
    >
      <div className="text-xs font-semibold">{label}</div>
      <div className="mt-1 text-[11px] leading-4 text-[var(--color-text-tertiary)]">
        {description}
      </div>
      <span className="pointer-events-none absolute right-3 top-3 flex size-4 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-brand)] data-[state=checked]:border-[var(--color-brand)]">
        <RadioGroupPrimitive.Indicator>
          <Circle className="size-2 fill-current" aria-hidden="true" />
        </RadioGroupPrimitive.Indicator>
      </span>
    </RadioGroupPrimitive.Item>
  )
}

export { SettingRadioCard }
