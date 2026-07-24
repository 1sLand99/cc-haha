import { CodeViewer } from './CodeViewer'
import { memo, useState } from 'react'
import { useTranslation } from '../../i18n'
import { InlineImageGallery } from './InlineImageGallery'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'

type Props = {
  content: unknown
  isError: boolean
  toolName?: string
  standalone?: boolean
}

/**
 * Standalone tool result block — only shown when not already rendered
 * inline within ToolCallBlock (i.e., when the tool_use and tool_result
 * are NOT grouped together by MessageList).
 */
export const ToolResultBlock = memo(function ToolResultBlock({ content, isError, toolName, standalone = true }: Props) {
  const [expanded, setExpanded] = useState(false)
  const t = useTranslation()

  // Don't render standalone if this result is already rendered inline
  if (!standalone) return null

  const text = extractText(content)
  const preview = text.slice(0, 200)
  const hasMore = text.length > 200

  return (
    <div className={`mb-2 overflow-hidden rounded-xl border ${
      isError
        ? 'border-[var(--color-error)]/20'
        : 'border-[var(--color-outline-variant)]/20'
    }`}>
      {/* Status header */}
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className={`h-auto w-full justify-between rounded-none px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider active:translate-y-0 ${
        isError
          ? 'bg-[var(--color-error-container)] text-[var(--color-error)]'
          : 'bg-[var(--color-surface-container-high)] text-[var(--color-outline)]'
      }`}
      >
        <span className="flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[12px]">
            {isError ? 'error' : 'check_circle'}
          </span>
          {toolName ? t('tool.result', { toolName }) : t('tool.resultGeneric')}
        </span>
        <Badge variant={isError ? 'destructive' : 'outline'} className={`min-h-0 rounded-full px-2 py-0.5 text-[9px] ${
          isError
            ? 'bg-[var(--color-error)]/10'
            : 'bg-[var(--color-diff-added-bg)] text-[var(--color-diff-added-text)]'
        }`}>
          {isError ? t('tool.error') : t('tool.success')}
        </Badge>
      </Button>

      {/* Inline image gallery from detected paths */}
      <InlineImageGallery text={text} />

      {/* Content */}
      {expanded ? (
        isError ? (
          <div className="bg-[var(--color-error-container)]/50 px-3 py-2.5 font-[var(--font-mono)] text-[11px] leading-[1.5] whitespace-pre-wrap break-words text-[var(--color-error)]">
            {text}
          </div>
        ) : (
          <CodeViewer
            code={text}
            language="plaintext"
            maxLines={12}
          />
        )
      ) : (
        <div className="bg-[var(--color-surface-container-lowest)] px-3 py-2 font-[var(--font-mono)] text-[10px] leading-[1.35] text-[var(--color-text-tertiary)]">
          {preview}
          {hasMore ? '…' : ''}
        </div>
      )}

      {hasMore && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="h-auto w-full rounded-none border-t border-[var(--color-outline-variant)]/10 bg-[var(--color-surface-container-low)] py-1 text-[10px] text-[var(--color-text-accent)] hover:underline active:translate-y-0"
        >
          {expanded ? t('tool.showLess') : t('tool.showMore', { count: text.length - 200 })}
        </Button>
      )}
    </div>
  )
})

function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c: any) => (typeof c === 'string' ? c : c?.text || ''))
      .filter(Boolean)
      .join('\n')
  }
  if (content && typeof content === 'object') {
    return JSON.stringify(content, null, 2)
  }
  return String(content ?? '')
}
