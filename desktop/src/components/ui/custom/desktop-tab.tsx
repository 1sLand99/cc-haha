import {
  forwardRef,
  type ComponentProps,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { Clock3, PanelRight, Settings, SquareTerminal, X } from 'lucide-react'

import type { Tab } from '@/stores/tabStore'
import { Button } from '@/components/ui/button'

const TAB_WIDTH = 180

type DesktopTabProps = Omit<ComponentProps<'div'>, 'onClick' | 'onMouseDown'> & {
  tab: Tab
  displayTitle: string
  isRunning: boolean
  isActive: boolean
  isDragOver: boolean
  isDragging: boolean
  dragOffsetX: number
  runningLabel: string
  onClick: () => void
  onClose: () => void
  onMouseDown: (event: ReactMouseEvent) => void
}

const DesktopTab = forwardRef<HTMLDivElement, DesktopTabProps>(function DesktopTab({
  tab,
  displayTitle,
  isRunning,
  isActive,
  isDragOver,
  isDragging,
  dragOffsetX,
  runningLabel,
  onClick,
  onClose,
  onMouseDown,
  ...props
}, ref) {
  const title = displayTitle || 'Untitled'

  return (
    <div
      ref={ref}
      {...props}
      role="tab"
      aria-label={title}
      tabIndex={isActive ? 0 : -1}
      aria-selected={isActive}
      data-dragging={isDragging ? 'true' : 'false'}
      onClick={onClick}
      onKeyDown={(event) => {
        props.onKeyDown?.(event)
        if (event.defaultPrevented) return
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onClick()
      }}
      onMouseDown={onMouseDown}
      className={`
        tab-bar-interactive group relative flex min-h-11 flex-shrink-0 items-center gap-1.5 px-3 outline-none
        ${isDragging ? 'z-20 cursor-grabbing' : 'cursor-grab'}
        transition-[background-color,box-shadow,opacity,transform] duration-150 ease-out
        focus-visible:shadow-[inset_0_-2px_0_var(--color-brand),var(--shadow-focus-ring)]
        ${isActive
          ? 'bg-[var(--color-surface)] shadow-[inset_0_-2px_0_var(--color-brand)]'
          : 'bg-transparent hover:bg-[var(--color-surface-hover)]'
        }
        ${isDragging ? 'opacity-95 shadow-[0_10px_24px_rgba(0,0,0,0.18)] ring-1 ring-[var(--color-border)]' : ''}
        ${isDragOver ? 'before:absolute before:left-0 before:top-[4px] before:bottom-[4px] before:w-[3px] before:bg-[var(--color-brand)] before:rounded-full before:shadow-[0_0_0_1px_rgba(255,255,255,0.25)]' : ''}
      `}
      style={{
        width: TAB_WIDTH,
        maxWidth: TAB_WIDTH,
        transform: isDragging ? `translateX(${dragOffsetX}px) scale(1.02)` : undefined,
      }}
    >
      {tab.type === 'session' && isRunning && (
        <span
          className="size-1.5 flex-shrink-0 animate-pulse rounded-full bg-[var(--color-success)]"
          aria-label={runningLabel}
          title={runningLabel}
        />
      )}
      {tab.type === 'session' && tab.status === 'error' && (
        <span className="size-1.5 flex-shrink-0 rounded-full bg-[var(--color-error)]" />
      )}
      {tab.type === 'settings' && (
        <Settings className="size-3.5 flex-shrink-0 text-[var(--color-text-tertiary)]" aria-hidden="true" />
      )}
      {tab.type === 'scheduled' && (
        <Clock3 className="size-3.5 flex-shrink-0 text-[var(--color-text-tertiary)]" aria-hidden="true" />
      )}
      {tab.type === 'terminal' && (
        <SquareTerminal className="size-3.5 flex-shrink-0 text-[var(--color-text-tertiary)]" aria-hidden="true" />
      )}
      {tab.type === 'workbench' && (
        <PanelRight className="size-3.5 flex-shrink-0 text-[var(--color-text-tertiary)]" aria-hidden="true" />
      )}

      <span className={`flex-1 truncate text-xs ${isActive ? 'font-medium text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'}`}>
        {title}
      </span>

      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Close ${title}`}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          onClose()
        }}
        className="-mr-1 size-6 flex-shrink-0 rounded-md p-0 opacity-0 text-[var(--color-text-tertiary)] transition-[background-color,opacity,color] group-hover:opacity-100 hover:text-[var(--color-text-secondary)] focus-visible:opacity-100"
      >
        <X className="size-3.5" aria-hidden="true" />
      </Button>
    </div>
  )
})

DesktopTab.displayName = 'DesktopTab'

export { DesktopTab, TAB_WIDTH }
