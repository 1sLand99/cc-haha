import * as React from 'react'
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { IconButton } from '@/components/ui/custom/icon-button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

type FindInPageBarProps = {
  query: string
  resultLabel: string
  count: number
  onQueryChange: React.ChangeEventHandler<HTMLInputElement>
  onInputKeyDown: React.KeyboardEventHandler<HTMLInputElement>
  onPrevious: () => void
  onNext: () => void
  onClose: () => void
  className?: string
}

const FindInPageBar = React.forwardRef<HTMLInputElement, FindInPageBarProps>(
  function FindInPageBar({
    query,
    resultLabel,
    count,
    onQueryChange,
    onInputKeyDown,
    onPrevious,
    onNext,
    onClose,
    className,
  }, ref) {
    return (
      <Card
        data-find-bar
        role="dialog"
        aria-label="Find in page"
        className={cn(
          'flex items-center gap-1 rounded-[var(--radius-lg)] bg-[var(--color-surface-container-lowest)] p-1.5 shadow-[var(--shadow-dropdown)]',
          className,
        )}
      >
        <Search className="ml-1.5 size-4 shrink-0 text-[var(--color-text-tertiary)]" aria-hidden="true" />
        <Input
          ref={ref}
          type="text"
          value={query}
          onChange={onQueryChange}
          onKeyDown={onInputKeyDown}
          placeholder="Find"
          aria-label="Find"
          className="h-7 w-52 border-0 bg-transparent px-1.5 shadow-none focus-visible:border-transparent focus-visible:shadow-none"
        />
        <span
          className="min-w-12 shrink-0 px-1 text-center text-[11px] tabular-nums text-[var(--color-text-tertiary)]"
          aria-live="polite"
        >
          {resultLabel}
        </span>
        <Separator orientation="vertical" className="mx-0.5 h-5" />
        <IconButton
          label="Previous match"
          variant="ghost"
          onClick={onPrevious}
          disabled={count === 0}
        >
          <ChevronUp aria-hidden="true" />
        </IconButton>
        <IconButton
          label="Next match"
          variant="ghost"
          onClick={onNext}
          disabled={count === 0}
        >
          <ChevronDown aria-hidden="true" />
        </IconButton>
        <IconButton label="Close find bar" variant="ghost" onClick={onClose}>
          <X aria-hidden="true" />
        </IconButton>
      </Card>
    )
  },
)

export { FindInPageBar }
