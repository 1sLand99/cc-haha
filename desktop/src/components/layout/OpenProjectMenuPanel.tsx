import { forwardRef, type CSSProperties } from 'react'

import { TargetIcon } from '@/components/composite/TargetIcon'
import type { OpenTarget } from '@/stores/openTargetStore'

type Props = {
  targets: OpenTarget[]
  onSelect(targetId: string): void
  className?: string
  style?: CSSProperties
  autoFocusFirst?: boolean
}

/** Shared markup for the in-page fallback and the native popup window. */
export const OpenProjectMenuPanel = forwardRef<HTMLDivElement, Props>(function OpenProjectMenuPanel({
  targets,
  onSelect,
  className = '',
  style,
  autoFocusFirst = false,
}, ref) {
  return (
    <div
      ref={ref}
      role="menu"
      className={`glass-panel min-w-[220px] overflow-hidden rounded-[var(--radius-lg)] py-1 ${className}`}
      style={style}
    >
      {targets.map((target, index) => (
        <button
          key={target.id}
          type="button"
          role="menuitem"
          autoFocus={autoFocusFirst && index === 0}
          onClick={() => onSelect(target.id)}
          className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:bg-[var(--color-surface-hover)]"
        >
          <span className="flex h-7 w-7 items-center justify-center text-[var(--color-text-secondary)]">
            <TargetIcon target={target} size={24} />
          </span>
          <span className="min-w-0 truncate">{target.label}</span>
        </button>
      ))}
    </div>
  )
})
