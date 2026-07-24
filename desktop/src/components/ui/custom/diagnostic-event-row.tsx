import { ChevronDown, Copy } from 'lucide-react'
import { useState } from 'react'

import type { DiagnosticEvent } from '@/api/diagnostics'
import { copyTextToClipboard } from '@/components/chat/clipboard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

type DiagnosticEventRowProps = {
  event: DiagnosticEvent
  detailsLabel: string
  eventIdLabel: string
  copyEventIdLabel: string
  eventIdCopiedLabel: string
  eventIdCopyFailedLabel: string
  onCopyResult: (message: string, copied: boolean) => void
}

function DiagnosticEventRow({
  event,
  detailsLabel,
  eventIdLabel,
  copyEventIdLabel,
  eventIdCopiedLabel,
  eventIdCopyFailedLabel,
  onCopyResult,
}: DiagnosticEventRowProps) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const detailsText = formatDetails(event.details)

  return (
    <li className="grid grid-cols-1 items-start gap-3 px-4 py-3 md:grid-cols-[120px_92px_1fr]">
      <time
        dateTime={event.timestamp}
        className="font-mono text-xs text-[var(--color-text-tertiary)]"
      >
        {new Date(event.timestamp).toLocaleString()}
      </time>
      <Badge
        variant={event.severity === 'error' ? 'destructive' : 'secondary'}
        className={cn(
          'uppercase',
          event.severity === 'warn' && 'border-[var(--color-warning)]/35 bg-[var(--color-warning)]/10 text-[var(--color-warning)]',
        )}
      >
        {event.severity}
      </Badge>
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium text-[var(--color-text-primary)]">
            {event.type}
          </span>
          {event.sessionId ? (
            <Badge variant="outline" className="max-w-full truncate font-mono font-normal">
              {event.sessionId}
            </Badge>
          ) : null}
        </div>
        <div className="mt-1 break-words text-xs text-[var(--color-text-secondary)]">
          {event.summary}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="mt-1 h-auto max-w-full justify-start px-0 py-0.5 text-[11px] font-normal text-[var(--color-text-tertiary)]"
          aria-label={`${copyEventIdLabel}: ${event.id}`}
          onClick={async () => {
            const copied = await copyTextToClipboard(event.id)
            onCopyResult(copied ? eventIdCopiedLabel : eventIdCopyFailedLabel, copied)
          }}
        >
          <span>{eventIdLabel}:</span>
          <span className="truncate font-mono">{event.id}</span>
          <Copy className="size-3" aria-hidden="true" />
        </Button>
        {detailsText ? (
          <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen} className="mt-2">
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-1.5 text-xs text-[var(--color-text-tertiary)]"
              >
                <ChevronDown
                  className={cn('transition-transform', detailsOpen && 'rotate-180')}
                  aria-hidden="true"
                />
                {detailsLabel}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-2 text-[11px] leading-relaxed text-[var(--color-text-secondary)]">
                {detailsText}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        ) : null}
      </div>
    </li>
  )
}

function formatDetails(details: unknown): string {
  if (details === null || details === undefined) return ''
  if (typeof details === 'string') return details
  try {
    return JSON.stringify(details, null, 2)
  } catch {
    return String(details)
  }
}

export { DiagnosticEventRow, formatDetails }
