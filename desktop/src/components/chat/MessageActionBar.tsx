import { useEffect, useRef } from 'react'
import { Check, Copy, GitFork, LoaderCircle } from 'lucide-react'
import { useSettingsStore } from '../../stores/settingsStore'
import { formatExactMessageTimestamp, formatMessageHoverTime } from '../../lib/formatMessageTimestamp'
import { CopyButton } from '../shared/CopyButton'
import { IconButton } from '../ui/custom/icon-button'

export type MessageBranchAction = {
  label: string
  loading?: boolean
  onBranch: () => void
}

type Props = {
  copyText?: string
  copyLabel: string
  branchAction?: MessageBranchAction
  align?: 'start' | 'end'
  timestamp?: number
}

export function MessageActionBar({
  copyText,
  copyLabel,
  branchAction,
  align = 'start',
  timestamp,
}: Props) {
  const locale = useSettingsStore((state) => state.locale)
  const branchClickRef = useRef(false)
  const hasCopy = Boolean(copyText?.trim())
  const hoverTimeLabel = typeof timestamp === 'number'
    ? formatMessageHoverTime(timestamp, locale)
    : ''
  const exactTimeLabel = typeof timestamp === 'number'
    ? formatExactMessageTimestamp(timestamp, locale)
    : ''

  useEffect(() => {
    if (!branchAction?.loading) {
      branchClickRef.current = false
    }
  }, [branchAction?.loading])

  const handleBranch = () => {
    if (!branchAction || branchAction.loading || branchClickRef.current) return
    branchClickRef.current = true
    branchAction.onBranch()
  }

  if (!hasCopy && !branchAction) return null

  return (
    <div
      data-message-actions
      data-align={align}
      className={`pointer-events-none mt-2 flex h-7 w-full opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 ${
        align === 'end' ? 'justify-end' : 'justify-start'
      }`}
    >
      <div className="flex min-h-7 items-center gap-1.5">
        {hasCopy ? (
          <CopyButton
            text={copyText!}
            label={copyLabel}
            displayLabel={<Copy size={13} strokeWidth={2.2} aria-hidden="true" />}
            displayCopiedLabel={<Check size={13} strokeWidth={2.4} aria-hidden="true" />}
            onPointerUp={(event) => event.currentTarget.blur()}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-transparent bg-transparent text-[var(--color-text-tertiary)] transition-colors hover:border-[var(--color-brand)]/30 hover:bg-[var(--color-surface-container-low)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/35"
          />
        ) : null}
        {branchAction ? (
          <IconButton
            label={branchAction.label}
            tooltip={branchAction.label}
            variant="ghost"
            size="icon-sm"
            onClick={handleBranch}
            disabled={branchAction.loading}
            aria-busy={branchAction.loading}
            title={branchAction.label}
            onPointerUp={(event) => event.currentTarget.blur()}
            className="size-7 rounded-full border-transparent bg-transparent text-[var(--color-text-tertiary)] hover:border-[var(--color-brand)]/30 hover:bg-[var(--color-surface-container-low)] hover:text-[var(--color-text-primary)] disabled:cursor-wait disabled:opacity-60"
          >
            {branchAction.loading
              ? <LoaderCircle className="size-[13px] animate-spin" strokeWidth={2.2} aria-hidden />
              : <GitFork className="size-[13px]" strokeWidth={2.2} aria-hidden />}
          </IconButton>
        ) : null}
        {hoverTimeLabel ? (
          <span
            className="ml-1 inline-flex items-center text-[11px] font-medium tabular-nums text-[var(--color-text-tertiary)]"
            title={exactTimeLabel || hoverTimeLabel}
          >
            {hoverTimeLabel}
          </span>
        ) : null}
      </div>
    </div>
  )
}
