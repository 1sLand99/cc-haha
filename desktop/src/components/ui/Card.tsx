import type { ReactNode } from 'react'

import { cx } from '@/lib/cx'

export type CardProps = {
  radius?: 'sm' | 'md' | 'lg' | 'xl'
  /** Which surface layer this card sits on. */
  surface?: 'base' | 'low' | 'lowest' | 'high' | 'none'
  border?: 'solid' | 'dashed' | 'none'
  padding?: 'none' | 'sm' | 'md' | 'lg'
  /** Adds hover and focus affordances for cards that are themselves clickable. */
  interactive?: boolean
  as?: 'div' | 'section' | 'article' | 'li'
  className?: string
  children: ReactNode
}

const RADIUS = {
  sm: 'rounded-[var(--radius-sm)]',
  md: 'rounded-[var(--radius-md)]',
  lg: 'rounded-[var(--radius-lg)]',
  xl: 'rounded-[var(--radius-xl)]',
} as const

const SURFACE = {
  base: 'bg-[var(--color-surface)]',
  low: 'bg-[var(--color-surface-container-low)]',
  lowest: 'bg-[var(--color-surface-container-lowest)]',
  high: 'bg-[var(--color-surface-container-high)]',
  none: '',
} as const

const BORDER = {
  solid: 'border border-[var(--color-border)]',
  dashed: 'border border-dashed border-[var(--color-border)]',
  none: '',
} as const

const PADDING = { none: '', sm: 'p-2.5', md: 'p-4', lg: 'p-5' } as const

/**
 * A bordered surface.
 *
 * The point of this is not saving markup — the seven most common container
 * recipes account for 115 sites, but each is only a handful of classes. The
 * point is giving corner radii somewhere to converge: hardcoded Tailwind radii
 * outnumber the design tokens 433 to 184, and `rounded-lg` (8px) and
 * `rounded-[var(--radius-lg)]` (12px) are different values wearing the same
 * name. A call site that becomes `<Card radius="lg">` stops being part of that
 * problem, one file at a time.
 *
 * Use it in new code and when a file is being touched anyway. A sweeping
 * find-and-replace across 115 sites is not worth the regression risk.
 */
export function Card({
  radius = 'lg',
  surface = 'base',
  border = 'solid',
  padding = 'md',
  interactive = false,
  as: Element = 'div',
  className,
  children,
}: CardProps) {
  return (
    <Element
      className={cx(
        RADIUS[radius],
        SURFACE[surface],
        BORDER[border],
        PADDING[padding],
        interactive && [
          'cursor-pointer transition-colors duration-150',
          'hover:border-[var(--color-brand)] hover:bg-[var(--color-surface-hover)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]',
        ].join(' '),
        className,
      )}
    >
      {children}
    </Element>
  )
}
