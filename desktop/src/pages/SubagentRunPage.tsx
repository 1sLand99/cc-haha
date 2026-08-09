import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import {
  subagentsApi,
  type SubagentRunResponse,
  type SubagentRunStatus,
} from '../api/subagents'
import { MessageList } from '../components/chat/MessageList'
import { ChatInput } from '../components/chat/ChatInput'
import { Badge, type Tone as BadgeTone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { useTranslation } from '../i18n'
import {
  createDefaultSessionState,
  mapHistoryMessagesToUiMessages,
  useChatStore,
} from '../stores/chatStore'
import { SUBAGENT_TAB_PREFIX, useTabStore } from '../stores/tabStore'
import { memberSessionId, useTeamStore } from '../stores/teamStore'
import type { UIMessage } from '../types/chat'

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
  const tabId = useTabStore((state) => {
    const activeTab = state.tabs.find((tab) => tab.sessionId === state.activeTabId)
    return activeTab?.type === 'subagent' && activeTab.subagentToolUseId === toolUseId
      ? activeTab.sessionId
      : `${SUBAGENT_TAB_PREFIX}${sourceSessionId}__${toolUseId}`
  })
  const discoveredTaskId = useChatStore((state) => {
    const session = state.sessions[sourceSessionId]
    const liveTask = Object.values(session?.backgroundAgentTasks ?? {})
      .find((candidate) => candidate.toolUseId === toolUseId)
    return liveTask?.taskId ?? session?.agentTaskNotifications?.[toolUseId]?.taskId
  })
  const resolvedTaskId = taskId ?? discoveredTaskId

  const handleReturn = () => {
    const store = useTabStore.getState()
    const activeTab = store.tabs.find((tab) => tab.sessionId === store.activeTabId)
    const tabId = activeTab?.type === 'subagent' && activeTab.subagentToolUseId === toolUseId
      ? activeTab.sessionId
      : `${SUBAGENT_TAB_PREFIX}${sourceSessionId}__${toolUseId}`
    store.returnFromSubagent(tabId)
  }

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
    if (loading) return
    const timer = window.setTimeout(() => void load(), LIVE_RUN_REFRESH_MS)
    return () => window.clearTimeout(timer)
  }, [data?.updatedAt, load, loading])

  useEffect(() => {
    if (!data) return
    const transcriptMessages = buildSubagentConversationMessages(data)
    useChatStore.setState((state) => {
      const existing = state.sessions[tabId] ?? createDefaultSessionState()
      const localMessages = existing.messages.filter((message) => {
        if (message.type === 'error' && message.code === 'SUBAGENT_MESSAGE_FAILED') {
          return true
        }
        return message.type === 'user_text' && !transcriptMessages.some((candidate) => (
          candidate.type === 'user_text' && candidate.content === message.content
        ))
      })
      const hasPendingMessage = localMessages.some((message) => (
        message.type === 'user_text' && message.pending === true
      ))
      return {
        sessions: {
          ...state.sessions,
          [tabId]: {
            ...existing,
            messages: [...transcriptMessages, ...localMessages],
            connectionState: 'connected',
            chatState: data.status === 'running' || hasPendingMessage
              ? 'thinking'
              : 'idle',
          },
        },
      }
    })
  }, [data, tabId])

  return (
    <AgentRunDesktop
      kind="subagent"
      sessionId={tabId}
      title={title}
      status={data?.status}
      identity={`${sourceSessionId} / ${toolUseId}`}
      details={data ? (
        <>
          <span>{t('subagentRun.agent')}: {data.agentId ?? t('subagentRun.unknown')}</span>
          {data.description ? <span>{data.description}</span> : null}
          {data.outputFile ? <span>{t('subagentRun.output')}: {data.outputFile}</span> : null}
        </>
      ) : null}
      backLabel={t('subagentRun.backToParent')}
      onBack={handleReturn}
      refreshLabel={t('subagentRun.refresh')}
      onRefresh={() => void load()}
      loading={loading}
      loadingLabel={t('subagentRun.loading')}
      error={error}
      ready={Boolean(data)}
      canSendMessage={data?.canSendMessage === true}
      readOnlyLabel={t('subagentRun.readOnly')}
      conversationTestId="subagent-conversation"
      readOnlyTestId="subagent-readonly-note"
    />
  )
}

/**
 * Agent Teams members use the exact same run desktop as SubAgents. Only the
 * transcript adapter, return target and inbox capability differ.
 */
export function TeamMemberRunPage({
  tabId,
  leadSessionId,
  agentId,
  title,
}: {
  tabId: string
  leadSessionId: string
  agentId: string
  title: string
}) {
  const t = useTranslation()
  const member = useTeamStore((state) => state.getMemberBySessionId(tabId))
  const snapshot = useTeamStore((state) => state.workbenchesBySession[leadSessionId]?.snapshots.at(-1))
  const refreshMemberSession = useTeamStore((state) => state.refreshMemberSession)
  const ensureMemberSession = useTeamStore((state) => state.ensureMemberSession)
  const startMemberPolling = useTeamStore((state) => state.startMemberPolling)
  const stopMemberPolling = useTeamStore((state) => state.stopMemberPolling)
  const runSessionId = memberSessionId(agentId)
  const hasConversationSnapshot = useChatStore((state) => Boolean(state.sessions[runSessionId]))
  const [loading, setLoading] = useState(!hasConversationSnapshot)

  const refresh = useCallback(async (initial = false) => {
    setLoading(true)
    if (initial) await ensureMemberSession(tabId)
    else await refreshMemberSession(tabId)
    setLoading(false)
  }, [ensureMemberSession, refreshMemberSession, tabId])

  useEffect(() => {
    void refresh(true)
    if (member?.status === 'running' || member?.status === 'idle') {
      startMemberPolling(tabId)
    }
    return () => stopMemberPolling()
  }, [member?.agentId, member?.status, refresh, startMemberPolling, stopMemberPolling, tabId])

  const status: SubagentRunStatus = snapshot?.deletedAt || member?.status === 'completed'
    ? 'completed'
    : member?.status === 'error'
      ? 'failed'
      : member?.status === 'running'
        ? 'running'
        : 'unknown'
  const teamName = snapshot?.team.name ?? useTeamStore.getState().activeTeam?.name
  const canSendMessage = Boolean(member && !snapshot?.deletedAt && member.status !== 'completed')

  return (
    <AgentRunDesktop
      kind="team-member"
      sessionId={runSessionId}
      title={member?.name || member?.role || title}
      status={status}
      identity={`${teamName ?? leadSessionId} / ${agentId}`}
      details={member ? (
        <>
          <span>{t('subagentRun.agent')}: {member.agentId}</span>
          <span>{member.role}</span>
          {member.currentTask ? <span>{member.currentTask}</span> : null}
        </>
      ) : null}
      backLabel={t('agentTeams.backToOverview')}
      onBack={() => useTabStore.getState().returnFromTeamMember(tabId)}
      refreshLabel={t('subagentRun.refresh')}
      onRefresh={() => void refresh()}
      loading={loading}
      loadingLabel={t('agentTeams.memberTranscriptLoading')}
      error={member ? null : t('agentTeams.loading')}
      ready={Boolean(member) && (hasConversationSnapshot || !loading)}
      canSendMessage={canSendMessage}
      readOnlyLabel={t('teams.archivedMemberReadOnly')}
      conversationTestId="team-member-conversation"
      readOnlyTestId="team-member-readonly-note"
    />
  )
}

function AgentRunDesktop({
  kind,
  sessionId,
  title,
  status,
  identity,
  details,
  backLabel,
  onBack,
  refreshLabel,
  onRefresh,
  loading,
  loadingLabel,
  error,
  ready,
  canSendMessage,
  readOnlyLabel,
  conversationTestId,
  readOnlyTestId,
}: {
  kind: 'subagent' | 'team-member'
  sessionId: string
  title: string
  status?: SubagentRunStatus
  identity: string
  details?: ReactNode
  backLabel: string
  onBack: () => void
  refreshLabel: string
  onRefresh: () => void
  loading: boolean
  loadingLabel: string
  error: string | null
  ready: boolean
  canSendMessage: boolean
  readOnlyLabel: string
  conversationTestId: string
  readOnlyTestId: string
}) {
  const t = useTranslation()
  return (
    <div
      data-testid="agent-run-desktop"
      data-agent-run-kind={kind}
      className="flex min-h-0 flex-1 flex-col bg-[var(--color-surface)] text-[var(--color-text-primary)]"
    >
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--color-border)] px-5 py-3">
        <div className="flex min-w-0 items-start gap-2">
          <Button
            variant="ghost"
            size="base"
            onClick={onBack}
            icon={<ArrowLeft size={15} strokeWidth={2} aria-hidden="true" />}
            className="mt-0.5 shrink-0"
          >
            {backLabel}
          </Button>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1
                className="min-w-0 truncate text-[16.5px] font-semibold leading-tight text-[var(--color-text-primary)]"
                style={{ fontFamily: 'var(--font-headline)' }}
              >
                {title}
              </h1>
              {status ? <StatusBadge status={status} t={t} /> : null}
            </div>
            <p className="mt-1 truncate font-mono text-[11px] text-[var(--color-text-tertiary)]">
              {identity}
            </p>
            {details ? (
              <p className="mt-1 flex min-w-0 flex-wrap gap-x-2 text-[11px] text-[var(--color-text-tertiary)]">
                {details}
              </p>
            ) : null}
          </div>
        </div>
        {/* The icon spins in place while loading rather than swapping to the
            generic spinner, so SubAgents and teammates share identical chrome. */}
        <IconButton
          icon={<RefreshCw size={15} strokeWidth={2.2} aria-hidden="true" className={loading ? 'animate-spin' : undefined} />}
          label={refreshLabel}
          showTooltip={false}
          size="md"
          tone="muted"
          onClick={onRefresh}
          disabled={loading}
        />
      </header>

      <main className="flex min-h-0 flex-1 flex-col">
        {loading && !ready ? (
          <div role="status" className="flex flex-1 items-center justify-center text-sm text-[var(--color-text-tertiary)]">{loadingLabel}</div>
        ) : null}
        {error ? (
          <div role="alert" className="mx-5 mt-4 rounded-[var(--radius-md)] border border-[var(--color-error)] bg-[var(--color-error-container)] px-3 py-2 text-sm text-[var(--color-on-error-container)]">
            {error}
          </div>
        ) : null}
        {ready ? (
          <div data-testid={conversationTestId} className="flex min-h-0 flex-1 flex-col">
            <MessageList sessionId={sessionId} />
          </div>
        ) : null}
      </main>
      {ready && canSendMessage ? <ChatInput /> : null}
      {ready && !canSendMessage ? (
        <p
          data-testid={readOnlyTestId}
          className="shrink-0 border-t border-[var(--color-border)] px-5 py-3 text-center text-[11.5px] text-[var(--color-text-tertiary)]"
        >
          {readOnlyLabel}
        </p>
      ) : null}
    </div>
  )
}

function StatusBadge({ status, t }: { status: SubagentRunStatus; t: TranslationFn }) {
  return (
    <Badge tone={statusTone(status)} size="xs" bordered>
      {getSubagentStatusLabel(status, t)}
    </Badge>
  )
}

function statusTone(status: SubagentRunStatus): BadgeTone {
  if (status === 'completed') return 'success'
  if (status === 'failed' || status === 'stopped') return 'danger'
  if (status === 'running') return 'brand'
  return 'neutral'
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
  if (transcriptMessages.length === 0 && resultText) {
    messages.push({
      id: `subagent-result-message-${data.toolUseId}`,
      type: 'assistant_text',
      content: resultText,
      timestamp: baseTimestamp,
    })
  }

  return messages
}
