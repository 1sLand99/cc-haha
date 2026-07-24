import { useState } from 'react'
import { Wrench } from 'lucide-react'
import { useTranslation } from '../../../i18n'
import type { NormalizedBlock, NormalizedMessage } from '../../../lib/trace/types'
import { MarkdownRenderer } from '../../markdown/MarkdownRenderer'
import { CopyButton } from '../../shared/CopyButton'
import { CodeViewer } from '../../chat/CodeViewer'
import { Alert } from '../../ui/alert'
import { Badge } from '../../ui/badge'
import { Button } from '../../ui/button'
import { Card } from '../../ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../ui/collapsible'

const LONG_TEXT_CHARS = 2000

const ROLE_STYLES: Record<NormalizedMessage['role'], { badge: string; container: string }> = {
  user: {
    badge: 'text-[var(--color-info)]',
    container: 'border-l-[var(--color-info)] bg-[var(--color-info)]/8',
  },
  assistant: {
    badge: 'text-[var(--color-brand)]',
    container: 'border-l-[var(--color-brand)] bg-[var(--color-brand)]/8',
  },
  system: {
    badge: 'text-[var(--color-warning)]',
    container: 'border-l-[var(--color-warning)] bg-[var(--color-warning)]/8',
  },
  tool: {
    badge: 'text-[var(--color-text-tertiary)]',
    container: 'border-l-[var(--color-outline)] bg-[var(--color-surface-container)]/60',
  },
}

export function MessageBlocks({ message }: { message: NormalizedMessage }) {
  const t = useTranslation()
  const styles = ROLE_STYLES[message.role]
  return (
    <Card
      className={`trace-message-cv rounded-[var(--radius-md)] border-l-2 px-3 py-2 ${styles.container}`}
      data-testid={`trace-message-${message.role}`}
    >
      <Badge variant="outline" className={`min-h-4 rounded-[var(--radius-sm)] border-transparent bg-transparent px-0 py-0 text-[10px] font-semibold uppercase tracking-[0.12em] ${styles.badge}`}>
        {messageRoleLabel(message.role, t)}
      </Badge>
      <div className="mt-1.5 flex flex-col gap-2">
        {message.content.map((block, index) => (
          <BlockView key={index} block={block} />
        ))}
      </div>
    </Card>
  )
}

function BlockView({ block }: { block: NormalizedBlock }) {
  switch (block.type) {
    case 'text':
      return <TextBlock text={block.text} />
    case 'thinking':
      return <ThinkingBlock thinking={block.thinking} />
    case 'tool_use':
      return <ToolUseBlock id={block.id} name={block.name} input={block.input} />
    case 'tool_result':
      return <ToolResultBlock toolUseId={block.toolUseId} content={block.content} isError={block.isError} />
    case 'image':
      return <ImageChip mediaType={block.mediaType} />
    default:
      return null
  }
}

function TextBlock({ text }: { text: string }) {
  const t = useTranslation()
  if (!text.trim()) return null
  if (text.length < LONG_TEXT_CHARS) {
    return <MarkdownRenderer content={text} variant="compact" />
  }
  return (
    <div className="relative">
      <pre className="max-h-[400px] overflow-y-auto whitespace-pre-wrap break-words rounded-[var(--radius-sm)] bg-[var(--color-surface)]/60 px-2 py-1.5 font-mono text-[11px] leading-5 text-[var(--color-text-secondary)]">
        {text}
      </pre>
      <CopyButton
        text={text}
        copiedLabel={t('common.copied')}
        className="absolute right-1.5 top-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-primary)]"
      />
    </div>
  )
}

function ThinkingBlock({ thinking }: { thinking: string }) {
  const t = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="outline" size="sm" className="h-6 rounded-[var(--radius-sm)] px-1.5 font-mono text-[10px] text-[var(--color-text-tertiary)]">
          {t('trace.detail.thinking')} · {t('trace.detail.chars', { count: thinking.length })}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="mt-1.5 max-h-[300px] overflow-y-auto whitespace-pre-wrap break-words text-[11px] italic leading-5 text-[var(--color-text-tertiary)]">
          {thinking}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  )
}

function ToolUseBlock({ id, name, input }: { id?: string; name: string; input: unknown }) {
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-[var(--color-text-secondary)]">
        <Wrench size={13} strokeWidth={2} className="shrink-0 text-[var(--color-warning)]" />
        <span className="truncate">{name}</span>
        {id ? <span className="truncate font-mono text-[10px] font-normal text-[var(--color-text-tertiary)]">{id}</span> : null}
      </div>
      <div className="mt-1">
        <CodeViewer code={safeJson(input)} language="json" maxLines={24} showLineNumbers />
      </div>
    </div>
  )
}

function ToolResultBlock({ toolUseId, content, isError }: { toolUseId?: string; content: unknown; isError?: boolean }) {
  const t = useTranslation()
  const text = extractPlainText(content)
  const contentView = (
    <>
      <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-[var(--color-text-secondary)]">
        <span className={isError ? 'text-[var(--color-error)]' : ''}>
          {isError ? t('trace.toolError') : t('trace.toolResult')}
        </span>
        {toolUseId ? (
          <span className="truncate font-mono text-[10px] font-normal text-[var(--color-text-tertiary)]">{toolUseId}</span>
        ) : null}
      </div>
      <div className="mt-1">
        {text !== null
          ? <TextResult text={text} />
          : <CodeViewer code={safeJson(content)} language="json" maxLines={24} showLineNumbers />}
      </div>
    </>
  )
  return isError
    ? <Alert variant="destructive" className="min-w-0 p-2">{contentView}</Alert>
    : <div className="min-w-0">{contentView}</div>
}

function TextResult({ text }: { text: string }) {
  if (!text.trim()) return null
  return (
    <pre className="max-h-[400px] overflow-y-auto whitespace-pre-wrap break-words rounded-[var(--radius-sm)] bg-[var(--color-surface)]/60 px-2 py-1.5 font-mono text-[11px] leading-5 text-[var(--color-text-secondary)]">
      {text}
    </pre>
  )
}

function ImageChip({ mediaType }: { mediaType?: string }) {
  return (
    <Badge variant="outline" className="w-fit rounded-[var(--radius-sm)] px-1.5 py-0 font-mono text-[10px] text-[var(--color-text-tertiary)]">
      [image]
      {mediaType ? <span>{mediaType}</span> : null}
    </Badge>
  )
}

function extractPlainText(content: unknown): string | null {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const parts: string[] = []
    for (const item of content) {
      if (typeof item === 'string') {
        parts.push(item)
        continue
      }
      if (item && typeof item === 'object' && typeof (item as { text?: unknown }).text === 'string') {
        parts.push((item as { text: string }).text)
        continue
      }
      return null
    }
    return parts.join('\n')
  }
  return null
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? 'null'
  } catch {
    return String(value)
  }
}

function messageRoleLabel(
  role: NormalizedMessage['role'],
  t: ReturnType<typeof useTranslation>,
): string {
  switch (role) {
    case 'assistant': return t('trace.message.assistant')
    case 'system': return t('trace.message.system')
    case 'tool': return t('trace.message.toolResult')
    default: return t('trace.message.user')
  }
}
