import { useTranslation } from '../../i18n'
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group'

type Props = {
  selected: number[]
  onChange: (days: number[]) => void
}

// Display order: Mon(1) → Sun(0), matching Chinese convention
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

const DAY_KEYS = [
  'newTask.daySun',
  'newTask.dayMon',
  'newTask.dayTue',
  'newTask.dayWed',
  'newTask.dayThu',
  'newTask.dayFri',
  'newTask.daySat',
] as const

export function DayOfWeekPicker({ selected, onChange }: Props) {
  const t = useTranslation()

  return (
    <ToggleGroup
      type="multiple"
      value={selected.map(String)}
      onValueChange={(values) => {
        if (values.length === 0) return
        onChange(values.map(Number))
      }}
      variant="default"
      size="sm"
      role="group"
      aria-label={t('newTask.specificDays')}
      className="flex-wrap justify-start gap-1.5"
    >
      {DAY_ORDER.map((day) => {
        const label = t(DAY_KEYS[day]!)
        return (
          <ToggleGroupItem
            key={day}
            value={String(day)}
            aria-label={label}
            className="size-8 rounded-full px-0 text-xs data-[state=on]:border-[var(--color-border-focus)] data-[state=on]:bg-[var(--color-surface-selected)] data-[state=on]:text-[var(--color-text-primary)]"
          >
            {label}
          </ToggleGroupItem>
        )
      })}
    </ToggleGroup>
  )
}
