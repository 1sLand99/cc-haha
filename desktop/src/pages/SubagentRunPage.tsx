import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { FileText, RefreshCw } from 'lucide-react'
import {
  subagentsApi,
  type SubagentRunResponse,
  type SubagentRunStatus,
} from '../api/subagents'
import { buildRenderModel, MessageBlock } from '../components/chat/MessageList'
import { ToolCallGroup } from '../components/chat/ToolCallGroup'
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert'
import { Badge } from '../components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { IconButton } from '../components/ui/custom/icon-button'
import { ScrollArea } from '../components/ui/scroll-area'
import { Separator } from '../components/ui/separator'
import { Skeleton } from '../components/ui/skeleton'
import { useTranslation } from '../i18n'
import { mapHistoryMessagesToUiMessages, useChatStore } from '../stores/chatStore'
import type { AgentTaskNotification, UIMessage } from '../types/chat'

type TranslationFn = ReturnType<typeof useTranslation>
const LIVE_RUN_REFRESH_MS = 2000

export function SubagentRunPage({
  sourceSessionId,
  toolUseId,
  taskId,
  title,
}: {
  sourceSessionId: string
  toolUseId: string
  taskId?: string
  title: string
}) {
  const t = useTranslation()
  const [data, setData] = useState<SubagentRunResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)
  const discoveredTaskId = useChatStore((state) => {
    const session = state.sessions[sourceSessionId]
    const liveTask = Object.values(session?.backgroundAgentTasks ?? {})
      .find((candidate) => candidate.toolUseId === toolUseId)
    return liveTask?.taskId ?? session?.agentTaskNotifications?.[toolUseId]?.taskId
  })
  const resolvedTaskId = taskId ?? discoveredTaskId

  const load = useCallback(async (options?: { resetData?: boolean }) => {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setLoading(true)
    setError(null)
    if (options?.resetData) setData(null)
    try {
      const nextData = await subagentsApi.getRunByTool(sourceSessionId, toolUseId, resolvedTaskId)
      if (requestIdRef.current !== requestId) return
      setData(nextData)
    } catch (err) {
      if (requestIdRef.current !== requestId) return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (requestIdRef.current !== requestId) return
      setLoading(false)
    }
  }, [resolvedTaskId, sourceSessionId, toolUseId])

  useEffect(() => {
    void load({ resetData: true })
  }, [load])

  useEffect(() => {
    if (data?.status !== 'running' || loading) return

    const timer = window.setTimeout(() => {
      void load()
    }, LIVE_RUN_REFRESH_MS)

    return () => window.clearTimeout(timer)
  }, [data?.status, load, loading])

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--color-surface)] text-[var(--color-text-primary)]">
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--color-border)] px-5 py-3">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="min-w-0 truncate text-sm font-semibold text-[var(--color-text-primary)]">{title}</h1>
            {data ? <StatusBadge status={data.status} t={t} /> : null}
          </div>
          <p className="mt-1 truncate font-mono text-[11px] text-[var(--color-text-tertiary)]">
            {sourceSessionId} / {toolUseId}
          </p>
        </div>
        <IconButton
          label={t('subagentRun.refresh')}
          variant="ghost"
          onClick={() => void load()}
          disabled={loading}
          aria-busy={loading}
        >
          <RefreshCw
            size={15}
            strokeWidth={2.2}
            aria-hidden="true"
            className={loading ? 'motion-safe:animate-spin motion-reduce:animate-none' : undefined}
          />
        </IconButton>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <main className="px-5 py-4" aria-busy={loading}>
          {loading && !data ? (
            <SubagentRunSkeleton label={t('subagentRun.loading')} />
          ) : null}
          {error ? (
            <Alert
              variant="destructive"
              role={data ? 'status' : 'alert'}
              aria-live={data ? 'polite' : undefined}
              className="mx-auto mb-4 max-w-4xl"
            >
              <AlertTitle>{t('common.error')}</AlertTitle>
              <AlertDescription className="text-[var(--color-error)]">{error}</AlertDescription>
            </Alert>
          ) : null}
          {data ? (
            <SubagentRunDetails data={data} />
          ) : null}
        </main>
      </ScrollArea>
    </div>
  )
}

function SubagentRunSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="mx-auto flex max-w-4xl flex-col gap-5">
      <span className="sr-only">{label}</span>
      <Card>
        <CardContent className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="space-y-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-5 w-full" />
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <Skeleton className="h-4 w-24" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-28 w-full" />
        </CardContent>
      </Card>
    </div>
  )
}

function SubagentRunDetails({ data }: { data: SubagentRunResponse }) {
  const t = useTranslation()

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <Card data-testid="subagent-run-summary">
        <CardContent className="p-4">
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
            <RunMetadata label={t('subagentRun.source')}>
              <Badge variant="secondary">{sourceLabel(data.source, t)}</Badge>
            </RunMetadata>
            <RunMetadata label={t('subagentRun.agent')}>
              <span className="font-mono text-xs">{data.agentId ?? t('subagentRun.unknown')}</span>
            </RunMetadata>
            {data.taskId ? (
              <RunMetadata label={t('subagentRun.task')}>
                <span className="font-mono text-xs">{data.taskId}</span>
              </RunMetadata>
            ) : null}
            <RunMetadata label={t('subagentRun.updated')}>
              {formatTimestamp(data.updatedAt)}
            </RunMetadata>
            {data.usage?.totalTokens ? (
              <RunMetadata label={t('subagentRun.tokens')}>
                {formatNumber(data.usage.totalTokens)}
              </RunMetadata>
            ) : null}
            {data.description ? (
              <RunMetadata label={t('subagentRun.description')}>
                {data.description}
              </RunMetadata>
            ) : null}
            {data.outputFile ? (
              <RunMetadata label={t('subagentRun.output')} className="sm:col-span-2">
                <span className="block truncate font-mono text-xs" title={data.outputFile}>
                  {data.outputFile}
                </span>
              </RunMetadata>
            ) : null}
          </dl>
        </CardContent>
      </Card>

      <ConversationSection data={data} />
    </div>
  )
}

function RunMetadata({
  label,
  children,
  className,
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <dt className="mb-1 text-[11px] font-medium text-[var(--color-text-tertiary)]">{label}</dt>
      <dd className="min-w-0 text-sm text-[var(--color-text-secondary)]">{children}</dd>
    </div>
  )
}

const EMPTY_AGENT_TASK_NOTIFICATIONS: Record<string, AgentTaskNotification> = {}

function ConversationSection({ data }: { data: SubagentRunResponse }) {
  const t = useTranslation()
  const conversationMessages = useMemo(() => buildSubagentConversationMessages(data), [data])
  const renderModel = useMemo(() => buildRenderModel(conversationMessages), [conversationMessages])

  if (renderModel.renderItems.length === 0) {
    return (
      <section aria-labelledby="subagent-transcript-heading">
        <h2 id="subagent-transcript-heading" className="sr-only">{t('subagentRun.transcript')}</h2>
        <Card className="border-dashed">
          <CardContent className="flex items-center gap-3 p-4 text-[var(--color-text-tertiary)]">
            <FileText className="size-5 shrink-0" aria-hidden="true" />
            <p className="text-sm">{t('subagentRun.noTranscript')}</p>
          </CardContent>
        </Card>
      </section>
    )
  }

  return (
    <Card>
      <section aria-labelledby="subagent-transcript-heading">
        <CardHeader className="flex-row items-center justify-between gap-3">
          <CardTitle className="text-sm">
            <h2 id="subagent-transcript-heading">{t('subagentRun.transcript')}</h2>
          </CardTitle>
          {data.truncated ? (
            <Badge variant="outline">{t('subagentRun.truncated')}</Badge>
          ) : null}
        </CardHeader>
        <Separator />
        <CardContent className="p-4">
          <div data-testid="subagent-conversation" className="space-y-3">
            {renderModel.renderItems.map((item) => {
              if (item.kind === 'tool_group') {
                return (
                  <ToolCallGroup
                    key={item.id}
                    toolCalls={item.toolCalls}
                    resultMap={renderModel.toolResultMap}
                    childToolCallsByParent={renderModel.childToolCallsByParent}
                    agentTaskNotifications={EMPTY_AGENT_TASK_NOTIFICATIONS}
                    showOpenRun={false}
                    isStreaming={data.status === 'running'}
                  />
                )
              }

              const toolResult = item.message.type === 'tool_use'
                ? renderModel.toolResultMap.get(item.message.toolUseId)
                : null

              return (
                <MessageBlock
                  key={item.message.id}
                  message={item.message}
                  activeThinkingId={null}
                  agentTaskNotifications={EMPTY_AGENT_TASK_NOTIFICATIONS}
                  toolResult={toolResult}
                />
              )
            })}
          </div>
        </CardContent>
      </section>
    </Card>
  )
}

function StatusBadge({ status, t }: { status: SubagentRunStatus; t: TranslationFn }) {
  return (
    <Badge
      role="status"
      aria-live="polite"
      aria-atomic="true"
      variant={status === 'failed' || status === 'stopped' ? 'destructive' : 'outline'}
      className={statusToneClass(status)}
    >
      {getSubagentStatusLabel(status, t)}
    </Badge>
  )
}

function statusToneClass(status: SubagentRunStatus) {
  if (status === 'completed') {
    return 'border-[var(--color-success)]/25 bg-[var(--color-success)]/10 text-[var(--color-success)]'
  }
  if (status === 'failed' || status === 'stopped') {
    return 'border-[var(--color-error)]/30 bg-[var(--color-error)]/5 text-[var(--color-error)]'
  }
  if (status === 'running') {
    return 'border-[var(--color-brand)]/25 bg-[var(--color-brand)]/10 text-[var(--color-brand)]'
  }
  return 'border-[var(--color-border)] bg-[var(--color-surface-container-low)] text-[var(--color-text-tertiary)]'
}

function sourceLabel(source: SubagentRunResponse['source'], t: TranslationFn) {
  if (source === 'subagent-jsonl') return t('subagentRun.source.transcript')
  if (source === 'session-history') return t('subagentRun.source.sessionHistory')
  if (source === 'live-task') return t('subagentRun.source.liveTask')
  return t('subagentRun.source.none')
}

function getSubagentStatusLabel(status: SubagentRunStatus, t: TranslationFn) {
  switch (status) {
    case 'completed':
      return t('subagentRun.status.completed')
    case 'failed':
      return t('subagentRun.status.failed')
    case 'stopped':
      return t('subagentRun.status.stopped')
    case 'running':
      return t('subagentRun.status.running')
    case 'unknown':
      return t('subagentRun.status.unknown')
  }
}

function formatNumber(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : '-'
}

function formatTimestamp(value: string | undefined) {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function timestampMs(value: string | undefined) {
  if (!value) return Date.now()
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : Date.now()
}

function normalizedText(value: string | undefined) {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

function hasPromptMessage(messages: UIMessage[], prompt: string) {
  const normalizedPrompt = normalizedText(prompt)
  if (!normalizedPrompt) return false

  return messages.some((message) => (
    message.type === 'user_text' &&
    normalizedText(message.content) === normalizedPrompt
  ))
}

function hasAssistantTextMessage(messages: UIMessage[], text: string) {
  const normalizedResult = normalizedText(text)
  if (!normalizedResult) return false

  return messages.some((message) => (
    message.type === 'assistant_text' &&
    normalizedText(message.content) === normalizedResult
  ))
}

function buildSubagentConversationMessages(data: SubagentRunResponse): UIMessage[] {
  const transcriptMessages = mapHistoryMessagesToUiMessages(data.messages, { includeTeammateMessages: true })
  const messages = [...transcriptMessages]
  const prompt = data.prompt?.trim()
  const baseTimestamp = timestampMs(data.updatedAt)

  if (prompt && !hasPromptMessage(transcriptMessages, prompt)) {
    messages.unshift({
      id: `subagent-prompt-${data.toolUseId}`,
      type: 'user_text',
      content: prompt,
      timestamp: baseTimestamp - 1,
    })
  }

  const resultText = (data.result || data.summary)?.trim()
  const shouldAppendResult = resultText && (
    transcriptMessages.length === 0 ||
    data.status === 'completed' ||
    data.status === 'failed' ||
    data.status === 'stopped'
  )
  if (shouldAppendResult && !hasAssistantTextMessage(transcriptMessages, resultText)) {
    messages.push({
      id: `subagent-result-message-${data.toolUseId}`,
      type: 'assistant_text',
      content: resultText,
      timestamp: baseTimestamp,
    })
  }

  return messages
}
