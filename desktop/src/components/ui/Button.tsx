import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

import { cx } from '@/lib/cx'
import { Spinner } from './Spinner'

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'tonal'
  | 'ghost'
  | 'danger'
  | 'danger-outline'
  | 'link'
  /**
   * Inverted fill — dark on light themes, light on dark. For a neutral but
   * emphatic confirm that should not read as the brand action. The pattern
   * appears three times in the app, hand-rolled each time.
   */
  | 'inverse'

/**
 * `base` sits between `sm` and `md` at h-8, which is out of alphabetical order
 * but is the height most existing buttons actually use. It was added after a
 * sweep through `pages/` found almost nothing could adopt this component: the
 * h-8 cluster had no matching size, and `md`/`lg` could not be renumbered
 * without silently shrinking the ~100 buttons already using them.
 */
export type ButtonSize = 'xs' | 'sm' | 'base' | 'md' | 'lg'

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Swaps `icon` for a spinner and disables the button. Also sets `aria-busy`. */
  loading?: boolean
  icon?: ReactNode
  iconPosition?: 'start' | 'end'
  /** Stretches to the container width. Replaces ad-hoc `className="w-full"`. */
  block?: boolean
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-[image:var(--gradient-btn-primary)] text-[var(--color-btn-primary-fg)] shadow-[var(--shadow-button-primary)] hover:bg-[image:var(--gradient-btn-primary-hover)] hover:brightness-105 active:translate-y-[1px]',
  secondary:
    'bg-[var(--color-surface)] text-[var(--color-text-primary)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]',
  tonal:
    'bg-[var(--color-brand-soft)] text-[var(--color-brand)] hover:bg-[var(--color-brand-soft-hover)]',
  ghost:
    'bg-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]',
  danger:
    // Foreground from a token, not `white`: dark's --color-error is a light red
    // that white text is unreadable on.
    'bg-[var(--color-error)] text-[var(--color-on-error)] hover:opacity-90',
  inverse:
    'bg-[var(--color-inverse-surface)] text-[var(--color-inverse-on-surface)] hover:opacity-90',
  'danger-outline':
    'bg-transparent text-[var(--color-error)] border border-[var(--color-error)] hover:bg-[var(--color-error-soft)]',
  link:
    'bg-transparent text-[var(--color-brand)] underline-offset-2 hover:underline px-0',
}

/**
 * Each size pins an explicit height. Before this, the three sizes set only
 * padding, which is the direct cause of the 18 distinct button heights across
 * the app: any caller who needed a specific height had to bypass the component.
 *
 * The values reproduce what `px-2 py-1 text-xs` / `px-4 py-2 text-sm` /
 * `px-5 py-2.5 text-sm` already rendered, so adopting this component does not
 * move any existing button. `xs` is new.
 */
const SIZE_CLASSES: Record<ButtonSize, string> = {
  xs: 'h-5 px-1.5 text-[11px] gap-1',
  sm: 'h-6 px-2 text-xs gap-1.5',
  base: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-9 px-4 text-sm gap-1.5',
  lg: 'h-10 px-5 text-sm gap-2',
}

const SPINNER_SIZE: Record<ButtonSize, number> = { xs: 11, sm: 12, base: 14, md: 16, lg: 16 }

const BASE_CLASSES = [
  'inline-flex items-center justify-center rounded-[var(--radius-md)]',
  'font-medium transition-colors duration-150 cursor-pointer',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]',
  'disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none',
].join(' ')

/**
 * The button for anything with a visible label. For icon-only controls use
 * `IconButton`, which forces an accessible name.
 *
 * `type` defaults to `"button"`. The native default is `"submit"`, which makes
 * any button dropped inside a form submit it on click — a bug that only shows
 * up once someone wraps the surrounding markup in a `<form>`.
 *
 * Wrapped in `forwardRef` because overlays anchor to their trigger: `Tooltip`
 * and `Dropdown` both attach a ref to whatever they are given. A component
 * that swallows the ref leaves the tooltip unpositionable and stops the
 * dropdown returning focus on close — silently, with only a console warning.
 * (React 19 would pass `ref` as a plain prop, but the installed runtime is
 * 18.3.1 despite what package.json declares.)
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  iconPosition = 'start',
  block = false,
  type = 'button',
  disabled,
  children,
  className,
  ...props
}, ref) {
  const leading = loading ? <Spinner size={SPINNER_SIZE[size]} /> : iconPosition === 'start' ? icon : null
  const trailing = !loading && iconPosition === 'end' ? icon : null

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(BASE_CLASSES, VARIANT_CLASSES[variant], SIZE_CLASSES[size], block && 'w-full', className)}
      {...props}
    >
      {leading}
      {children}
      {trailing}
    </button>
  )
})
