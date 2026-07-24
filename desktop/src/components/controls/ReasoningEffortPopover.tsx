import type { ReactElement } from 'react'

import type { ReasoningEffortLevel } from '../../types/settings'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../ui/popover'
import { Slider } from '../ui/slider'

type Props = {
  open: boolean
  trigger: ReactElement
  options: ReasoningEffortLevel[]
  value: ReasoningEffortLevel
  labels: Record<ReasoningEffortLevel, string>
  onChange: (value: ReasoningEffortLevel) => void
  onClose: () => void
  ariaLabel?: string
}

export function ReasoningEffortPopover({
  open,
  trigger,
  options,
  value,
  labels,
  onChange,
  onClose,
  ariaLabel = '推理强度',
}: Props) {
  if (options.length === 0) return trigger

  const selectedIndex = Math.max(0, options.indexOf(value))
  const maxIndex = Math.max(0, options.length - 1)

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose()
        }
      }}
    >
      <PopoverTrigger asChild>
        {trigger}
      </PopoverTrigger>
      <PopoverContent
        data-testid="reasoning-effort-popover"
        side="top"
        align="end"
        sideOffset={10}
        className="w-60 rounded-2xl px-3.5 pb-3.5 pt-3"
      >
        <div
          data-testid="reasoning-effort-header"
          className="mb-2.5 flex items-baseline justify-between gap-3"
        >
          <div
            data-testid="reasoning-effort-label"
            className="text-sm font-semibold text-[var(--color-text-secondary)]"
          >
            {labels[value]}
          </div>
          <div
            data-testid="reasoning-effort-context-label"
            className="text-[10px] font-medium tracking-wide text-[var(--color-text-tertiary)]"
          >
            {ariaLabel}
          </div>
        </div>

        <Slider
          data-testid="reasoning-effort-slider"
          value={[selectedIndex]}
          min={0}
          max={maxIndex}
          step={1}
          aria-label={ariaLabel}
          aria-valuetext={labels[value]}
          className="h-9"
          onValueChange={([nextIndex]) => {
            const nextValue = options[nextIndex ?? selectedIndex]
            if (nextValue && nextValue !== value) onChange(nextValue)
          }}
        />

        <div className="mt-1.5 flex items-center justify-between px-0.5" aria-hidden="true">
          {options.map((option, index) => (
            <span
              key={option}
              data-testid="reasoning-effort-stop"
              className={`size-1.5 rounded-full ${
                index <= selectedIndex
                  ? 'bg-[var(--color-brand)]'
                  : 'bg-[var(--color-outline)]/55'
              }`}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
