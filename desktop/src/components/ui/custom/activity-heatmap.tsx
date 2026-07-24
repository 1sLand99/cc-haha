import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'

import { cn } from '@/lib/utils'

export type ActivityHeatmapMode = 'daily' | 'weekly' | 'cumulative'

export type ActivityHeatmapDay = {
  date: string
  sessionCount: number
  messageCount: number
  toolCallCount: number
  tokens: number
  level: number
  mode: ActivityHeatmapMode
  rangeStart?: string
  rangeEnd?: string
}

type ActivityMonthLabel = {
  week: number
  label: string
}

type ActivityHeatmapProps = {
  days: ActivityHeatmapDay[]
  monthLabels: ActivityMonthLabel[]
  ariaLabel: string
  weekdayLabels: [string, string, string]
  lessLabel: string
  moreLabel: string
  getCellTitle: (day: ActivityHeatmapDay) => string
  getCellDetail: (day: ActivityHeatmapDay) => string
}

const WEEK_COUNT = 52
const HEAT_CELL_GAP = 3
const HEAT_LABEL_WIDTH = 38
const HEAT_CELL_MIN = 10
const HEAT_CELL_MAX = 22
const TOOLTIP_WIDTH = 172
const HEAT_COLORS = [
  'var(--color-activity-heat-0)',
  'var(--color-activity-heat-1)',
  'var(--color-activity-heat-2)',
  'var(--color-activity-heat-3)',
  'var(--color-activity-heat-4)',
]

function calculateHeatCellSize(width: number) {
  const available = width - HEAT_LABEL_WIDTH - (WEEK_COUNT - 1) * HEAT_CELL_GAP
  return Math.max(HEAT_CELL_MIN, Math.min(HEAT_CELL_MAX, Math.floor(available / WEEK_COUNT)))
}

export function ActivityHeatmap({
  days,
  monthLabels,
  ariaLabel,
  weekdayLabels,
  lessLabel,
  moreLabel,
  getCellTitle,
  getCellDetail,
}: ActivityHeatmapProps) {
  const measureRef = useRef<HTMLDivElement | null>(null)
  const cellRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)
  const [rovingIndex, setRovingIndex] = useState(-1)
  const [heatCellSize, setHeatCellSize] = useState(HEAT_CELL_MIN)

  const focusableIndices = useMemo(() => {
    if (days[0]?.mode === 'daily') {
      return days.map((_, index) => index)
    }
    return days.flatMap((_, index) => index % 7 === 0 ? [index] : [])
  }, [days])

  useEffect(() => {
    const fallbackIndex = focusableIndices.at(-1) ?? 0
    setRovingIndex((current) => focusableIndices.includes(current) ? current : fallbackIndex)
  }, [focusableIndices])

  useEffect(() => {
    const element = measureRef.current
    if (!element) return

    const updateCellSize = () => {
      const nextSize = calculateHeatCellSize(element.clientWidth)
      setHeatCellSize((current) => current === nextSize ? current : nextSize)
    }

    updateCellSize()

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(updateCellSize)
      observer.observe(element)
      return () => observer.disconnect()
    }

    window.addEventListener('resize', updateCellSize)
    return () => window.removeEventListener('resize', updateCellSize)
  }, [])

  const activeIndex = focusedIndex ?? hoveredIndex
  const tooltipDay = activeIndex === null ? null : days[activeIndex] ?? null
  const heatGridWidth = WEEK_COUNT * heatCellSize + (WEEK_COUNT - 1) * HEAT_CELL_GAP
  const heatGridHeight = 7 * heatCellSize + 6 * HEAT_CELL_GAP
  const heatmapWidth = HEAT_LABEL_WIDTH + heatGridWidth
  const tooltipStyle = activeIndex === null
    ? undefined
    : {
        left: Math.max(
          HEAT_LABEL_WIDTH,
          Math.min(
            heatmapWidth - TOOLTIP_WIDTH,
            HEAT_LABEL_WIDTH + Math.floor(activeIndex / 7) * (heatCellSize + HEAT_CELL_GAP) - 52,
          ),
        ),
        top: Math.max(28, 30 + (activeIndex % 7) * (heatCellSize + HEAT_CELL_GAP) - 50),
      }

  const moveFocus = (target: number) => {
    const next = Math.max(0, Math.min(days.length - 1, target))
    if (!focusableIndices.includes(next)) return
    setRovingIndex(next)
    cellRefs.current[next]?.focus()
  }

  const handleCellKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const isDaily = days[index]?.mode === 'daily'
    const focusPosition = focusableIndices.indexOf(index)
    let target: number | null = null

    if (event.key === 'Home') {
      target = event.ctrlKey
        ? focusableIndices[0] ?? null
        : isDaily
          ? index % 7
          : focusableIndices[0] ?? null
    } else if (event.key === 'End') {
      if (event.ctrlKey || !isDaily) {
        target = focusableIndices.at(-1) ?? null
      } else {
        const row = index % 7
        const lastWeekStart = Math.floor((days.length - 1) / 7) * 7
        target = Math.min(days.length - 1, lastWeekStart + row)
        while (target >= 0 && target % 7 !== row) target -= 1
      }
    } else if (event.key === 'ArrowLeft') {
      target = isDaily ? index - 7 : focusableIndices[focusPosition - 1] ?? null
    } else if (event.key === 'ArrowRight') {
      target = isDaily ? index + 7 : focusableIndices[focusPosition + 1] ?? null
    } else if (event.key === 'ArrowUp' && isDaily) {
      target = index % 7 === 0 ? null : index - 1
    } else if (event.key === 'ArrowDown' && isDaily) {
      target = index % 7 === 6 ? null : index + 1
    }

    if (target === null || !focusableIndices.includes(target)) return
    event.preventDefault()
    moveFocus(target)
  }

  return (
    <div data-slot="activity-heatmap">
      <div
        ref={measureRef}
        data-slot="activity-heatmap-scroll"
        className="min-w-0 overflow-x-auto pb-2"
      >
        <div className="relative" style={{ width: heatmapWidth }}>
          <div
            className="mb-3 grid h-5 text-[11px] leading-none text-[var(--color-text-tertiary)]"
            style={{
              marginLeft: HEAT_LABEL_WIDTH,
              gridTemplateColumns: `repeat(${WEEK_COUNT}, ${heatCellSize}px)`,
              columnGap: HEAT_CELL_GAP,
            }}
          >
            {monthLabels.map((month) => (
              <div key={`${month.week}-${month.label}`} style={{ gridColumn: `${month.week + 1} / span 4` }}>
                {month.label}
              </div>
            ))}
          </div>

          <div className="flex items-start" style={{ gap: HEAT_CELL_GAP }}>
            <div
              className="grid shrink-0 grid-rows-7 text-[11px] leading-none text-[var(--color-text-tertiary)]"
              style={{ width: HEAT_LABEL_WIDTH, height: heatGridHeight, rowGap: HEAT_CELL_GAP }}
            >
              <div className="row-start-2 flex items-center">{weekdayLabels[0]}</div>
              <div className="row-start-4 flex items-center">{weekdayLabels[1]}</div>
              <div className="row-start-6 flex items-center">{weekdayLabels[2]}</div>
            </div>

            <div
              role="grid"
              aria-label={ariaLabel}
              className="grid grid-flow-col"
              style={{
                gridTemplateRows: `repeat(7, ${heatCellSize}px)`,
                gridAutoColumns: `${heatCellSize}px`,
                columnGap: HEAT_CELL_GAP,
                rowGap: HEAT_CELL_GAP,
              }}
              onMouseLeave={() => setHoveredIndex(null)}
            >
              {days.map((day, index) => {
                const isActive = activeIndex === index
                const isFocusable = focusableIndices.includes(index)
                const tooltipId = `activity-day-tooltip-${day.date}`
                const cellTitle = getCellTitle(day)
                const cellDetail = getCellDetail(day)
                const cellClassName = cn(
                  'activity-heat-cell rounded-[3px] border',
                  isActive
                    ? 'is-active border-[var(--color-activity-cell-border-active)]'
                    : 'border-[var(--color-activity-cell-border)] hover:border-[var(--color-activity-cell-border-hover)]',
                )
                const cellStyle = {
                  width: heatCellSize,
                  height: heatCellSize,
                  backgroundColor: HEAT_COLORS[day.level],
                }

                if (!isFocusable) {
                  return (
                    <span
                      key={day.date}
                      aria-hidden="true"
                      data-slot="activity-heatmap-segment"
                      className={cellClassName}
                      style={cellStyle}
                      onMouseEnter={() => setHoveredIndex(index)}
                    />
                  )
                }

                return (
                  <button
                    key={day.date}
                    ref={(element) => {
                      cellRefs.current[index] = element
                    }}
                    type="button"
                    role="gridcell"
                    tabIndex={rovingIndex === index ? 0 : -1}
                    aria-label={`${cellTitle}: ${cellDetail}`}
                    aria-describedby={isActive ? tooltipId : undefined}
                    aria-current={index === focusableIndices.at(-1) ? 'date' : undefined}
                    data-slot="activity-heatmap-cell"
                    className={cn(
                      cellClassName,
                      'focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)] focus:ring-offset-2 focus:ring-offset-[var(--color-surface)]',
                    )}
                    style={cellStyle}
                    onFocus={() => {
                      setRovingIndex(index)
                      setFocusedIndex(index)
                    }}
                    onBlur={() => setFocusedIndex(null)}
                    onMouseEnter={() => setHoveredIndex(index)}
                    onKeyDown={(event) => handleCellKeyDown(event, index)}
                  />
                )
              })}
            </div>
          </div>

          {tooltipDay && activeIndex !== null && (
            <div
              id={`activity-day-tooltip-${tooltipDay.date}`}
              role="tooltip"
              className="pointer-events-none absolute z-20 min-w-[172px] rounded-md border border-[var(--color-activity-tooltip-border)] bg-[var(--color-activity-tooltip-surface)] px-3 py-2 text-xs shadow-xl"
              style={tooltipStyle}
            >
              <div className="font-medium text-[var(--color-activity-tooltip-text)]">
                {getCellTitle(tooltipDay)}
              </div>
              <div className="mt-1 text-[var(--color-activity-tooltip-muted)]">
                {getCellDetail(tooltipDay)}
              </div>
            </div>
          )}
        </div>
      </div>

      <div
        aria-label={`${lessLabel} – ${moreLabel}`}
        className="mt-3 flex items-center justify-end gap-2 text-xs text-[var(--color-text-tertiary)] xl:mt-4"
      >
        <span>{lessLabel}</span>
        {HEAT_COLORS.map((color) => (
          <span
            key={color}
            aria-hidden="true"
            className="rounded-[3px] border border-[var(--color-activity-cell-border)]"
            style={{ width: heatCellSize, height: heatCellSize, backgroundColor: color }}
          />
        ))}
        <span>{moreLabel}</span>
      </div>
    </div>
  )
}
