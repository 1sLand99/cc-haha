import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Radio, X } from 'lucide-react'
import { Badge, StatusDot, type Tone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { Progress } from '@/components/ui/Progress'
import dataAnalystAvatar from '../../assets/agent-teams/data-analyst.png'
import docsCoordinatorAvatar from '../../assets/agent-teams/docs-coordinator.png'
import qaEngineerAvatar from '../../assets/agent-teams/qa-engineer.png'
import releaseEngineerAvatar from '../../assets/agent-teams/release-engineer.png'
import securityReviewerAvatar from '../../assets/agent-teams/security-reviewer.png'
import serverEngineerAvatar from '../../assets/agent-teams/server-engineer.png'
import teamLeadAvatar from '../../assets/agent-teams/team-lead.png'
import uiDesignerAvatar from '../../assets/agent-teams/ui-designer.png'
import { useTranslation, type TranslationKey } from '../../i18n'
import { useTeamStore } from '../../stores/teamStore'
import type {
  TeamMember,
  TeamWorkbenchMessage,
  TeamWorkbenchSnapshot,
} from '../../types/team'
import {
  getWorkbenchPhase,
  getWorkbenchProgress,
  getMemberAvatarKey,
  layoutWorkbenchTasks,
  runningTaskForMember,
  taskOwnedByMember,
  WORKBENCH_TASK_HEIGHT,
  WORKBENCH_TASK_WIDTH,
  type PositionedWorkbenchTask,
  type MemberAvatarKey,
  type WorkbenchPhase,
  type WorkbenchTaskState,
} from './agentTeamsModel'

const MEMBER_AVATARS: Record<MemberAvatarKey, string> = {
  'team-lead': teamLeadAvatar,
  'server-engineer': serverEngineerAvatar,
  'ui-designer': uiDesignerAvatar,
  'qa-engineer': qaEngineerAvatar,
  'security-reviewer': securityReviewerAvatar,
  'data-analyst': dataAnalystAvatar,
  'release-engineer': releaseEngineerAvatar,
  'docs-coordinator': docsCoordinatorAvatar,
}

const MEMBER_ACCENTS = [
  'var(--color-brand)',
  'var(--color-warning)',
  'var(--color-success)',
  'var(--color-info)',
  'var(--color-text-secondary)',
  'var(--color-error)',
] as const

type MemberWorkState = 'working' | 'idle' | 'stopped' | 'exited' | 'error'

type BotPosition = {
  x: number
  y: number
  opacity: number
  state: MemberWorkState
}

type TranslationFn = ReturnType<typeof useTranslation>

function phaseTone(phase: WorkbenchPhase): Tone {
  if (phase === 'forming') return 'warning'
  if (phase === 'running') return 'brand'
  if (phase === 'finishing') return 'info'
  return 'success'
}

function phaseLabel(phase: WorkbenchPhase, t: TranslationFn): string {
  return t(`agentTeams.phase.${phase}` as TranslationKey)
}

function taskStateLabel(state: WorkbenchTaskState, t: TranslationFn): string {
  return t(`agentTeams.task.${state}` as TranslationKey)
}

function taskTone(state: WorkbenchTaskState): Tone {
  if (state === 'running') return 'brand'
  if (state === 'completed') return 'success'
  if (state === 'open') return 'warning'
  return 'neutral'
}

function taskBorder(state: WorkbenchTaskState): string {
  if (state === 'running') return 'var(--color-brand)'
  if (state === 'completed') return 'var(--color-success)'
  if (state === 'open') return 'var(--color-warning)'
  return 'var(--color-border)'
}

function memberState(
  member: TeamMember,
  snapshot: TeamWorkbenchSnapshot,
  isLead: boolean,
): MemberWorkState {
  if (snapshot.deletedAt || member.status === 'completed') return 'exited'
  if (member.status === 'error') return 'error'
  if (runningTaskForMember(snapshot.tasks, member) || isLead) return 'working'
  if (member.status === 'idle') return 'idle'
  return 'idle'
}

function memberStateLabel(state: MemberWorkState, t: TranslationFn): string {
  return t(`agentTeams.member.${state}` as TranslationKey)
}

function memberAccent(member: TeamMember, index: number): string {
  const colorIndex = member.color
    ? ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan'].indexOf(member.color)
    : -1
  return MEMBER_ACCENTS[(colorIndex >= 0 ? colorIndex : index) % MEMBER_ACCENTS.length]!
}

function memberName(member: TeamMember): string {
  return member.name || member.role || member.agentId.split('@')[0] || member.agentId
}

function memberMatchesIdentity(member: TeamMember, identity: string): boolean {
  return [member.agentId, member.agentId.split('@')[0], member.name, member.role]
    .filter(Boolean)
    .includes(identity)
}

function messageText(message: TeamWorkbenchMessage, t: TranslationFn): string {
  if (message.protocolType === 'task_assignment') {
    return t('agentTeams.communication.taskAssignment', {
      task: message.taskId ? `#${message.taskId}` : '',
      subject: message.text,
    })
  }
  if (message.protocolType === 'shutdown_request') {
    return t('agentTeams.communication.shutdownRequest', { reason: message.text })
  }
  if (message.protocolType === 'shutdown_response') {
    return t('agentTeams.communication.shutdownResponse')
  }
  if (message.protocolType === 'idle_notification') {
    return t('agentTeams.communication.idle')
  }
  return message.text
}

function messageKindLabel(message: TeamWorkbenchMessage, t: TranslationFn): string {
  if (message.kind === 'direct') return t('agentTeams.communication.direct')
  if (message.kind === 'broadcast') return t('agentTeams.communication.broadcast')
  return t('agentTeams.communication.system')
}

function messageTone(message: TeamWorkbenchMessage): string {
  if (message.kind === 'direct') return 'var(--color-brand)'
  if (message.kind === 'broadcast') return 'var(--color-warning)'
  return 'var(--color-text-tertiary)'
}

function formatSnapshotTime(snapshot: TeamWorkbenchSnapshot): string {
  const time = new Date(snapshot.generatedAt)
  return Number.isNaN(time.getTime())
    ? snapshot.generatedAt
    : time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function AgentTeamsWorkbench({ sessionId }: { sessionId: string }) {
  const t = useTranslation()
  const timeline = useTeamStore((state) => state.workbenchesBySession[sessionId])
  const historyIndex = useTeamStore((state) => state.workbenchHistoryIndexBySession[sessionId] ?? null)
  const setHistoryIndex = useTeamStore((state) => state.setWorkbenchHistoryIndex)
  const setWorkbenchOpen = useTeamStore((state) => state.setWorkbenchOpen)
  const openMemberSession = useTeamStore((state) => state.openMemberSession)
  const officeViewportRef = useRef<HTMLDivElement>(null)
  const [officeWidth, setOfficeWidth] = useState(604)
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null)
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null)

  const snapshots = timeline?.snapshots ?? []
  const latestIndex = snapshots.length - 1
  const selectedIndex = historyIndex === null ? latestIndex : Math.min(historyIndex, latestIndex)
  const snapshot = selectedIndex >= 0 ? snapshots[selectedIndex] : undefined
  const previousSnapshot = selectedIndex > 0 ? snapshots[selectedIndex - 1] : undefined

  useEffect(() => {
    const element = officeViewportRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 604
      setOfficeWidth(Math.max(360, Math.min(760, width - 32)))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!selectedMemberId || !snapshot) return
    if (!snapshot.team.members.some((member) => member.agentId === selectedMemberId)) {
      setSelectedMemberId(null)
    }
  }, [selectedMemberId, snapshot])

  const layout = useMemo(
    () => layoutWorkbenchTasks(snapshot?.tasks ?? [], officeWidth),
    [officeWidth, snapshot?.tasks],
  )

  if (!snapshot) {
    return (
      <section
        aria-label={t('agentTeams.title')}
        className="flex h-full min-h-0 items-center justify-center bg-[var(--color-surface)] p-8 text-sm text-[var(--color-text-tertiary)]"
      >
        {timeline?.error || t('agentTeams.loading')}
      </section>
    )
  }

  const phase = getWorkbenchPhase(snapshot)
  const progress = getWorkbenchProgress(snapshot)
  const leadId = snapshot.team.leadAgentId
  const members = snapshot.team.members
  const leadMember = members.find((member) => member.agentId === leadId) ?? members[0]
  const workerMembers = members.filter((member) => member.agentId !== leadId)
  const primaryTaskByMemberId = new Map<string, string>()
  for (const member of workerMembers) {
    const firstOwnedTask = snapshot.tasks.find((task) => taskOwnedByMember(task, member))
    if (firstOwnedTask) primaryTaskByMemberId.set(member.agentId, firstOwnedTask.id)
  }
  const unassignedMembers = workerMembers.filter((member) => !primaryTaskByMemberId.has(member.agentId))
  const rootTasks = layout.tasks.filter(({ task }) =>
    task.blockedBy.every((dependencyId) => !layout.byId.has(dependencyId)),
  )
  const memberPositions = new Map<string, BotPosition>()

  members.forEach((member) => {
    const isLead = member.agentId === leadId
    const state = memberState(member, snapshot, isLead)
    const taskPosition = isLead
      ? undefined
      : layout.byId.get(primaryTaskByMemberId.get(member.agentId) ?? '')
    if (isLead) {
      memberPositions.set(member.agentId, { x: layout.width / 2, y: 66, opacity: 1, state })
    } else if (taskPosition) {
      memberPositions.set(member.agentId, {
        x: taskPosition.x + 22,
        y: taskPosition.y + WORKBENCH_TASK_HEIGHT / 2,
        opacity: 1,
        state,
      })
    } else {
      const unassignedIndex = unassignedMembers.findIndex((worker) => worker.agentId === member.agentId)
      const pitch = Math.min(62, (layout.width - 48) / Math.max(unassignedMembers.length, 1))
      const rowWidth = Math.max(0, (unassignedMembers.length - 1) * pitch)
      memberPositions.set(member.agentId, {
        x: layout.width / 2 - rowWidth / 2 + Math.max(0, unassignedIndex) * pitch,
        y: 147,
        opacity: 1,
        state,
      })
    }
  })

  const latestMessage = snapshot.messages.at(-1)
  const hasNewMessage = Boolean(
    previousSnapshot && latestMessage && previousSnapshot.messages.at(-1)?.id !== latestMessage.id,
  )
  const selectedMember = selectedMemberId
    ? members.find((member) => member.agentId === selectedMemberId) ?? null
    : null

  return (
    <section
      aria-label={t('agentTeams.title')}
      className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-[var(--color-surface)] text-[var(--color-text-primary)]"
    >
      <header className="flex h-[42px] shrink-0 items-center gap-2.5 border-b border-[var(--color-border)] px-4">
        <span className="min-w-0 truncate font-mono text-[12px] font-extrabold" title={snapshot.team.name}>
          {snapshot.team.name}
        </span>
        <Badge tone={phaseTone(phase)} size="xs" bordered>{phaseLabel(phase, t)}</Badge>
        <Progress
          value={progress.percent}
          tone="auto"
          size="xs"
          label={t('agentTeams.progressLabel')}
          className="w-[84px] shrink-0"
        />
        <span className="shrink-0 text-[11px] tabular-nums text-[var(--color-text-secondary)]">
          {progress.completed}/{progress.total}
        </span>
        <span className="hidden text-[9.5px] text-[var(--color-text-tertiary)] 2xl:inline">
          {t('agentTeams.dependencyLegend')}
        </span>
        <div className="ml-auto flex min-w-0 items-center gap-1">
          {historyIndex === null ? (
            <>
              <span className="hidden items-center gap-1.5 text-[10.5px] font-medium text-[var(--color-success)] xl:flex">
                <StatusDot tone="success" pulse={phase !== 'completed'} />
                {t('agentTeams.followingLive')}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={snapshots.length < 2}
                onClick={() => setHistoryIndex(sessionId, Math.max(0, latestIndex - 1))}
              >
                {t('agentTeams.reviewHistory')}
              </Button>
            </>
          ) : (
            <>
              <IconButton
                icon={<ChevronLeft aria-hidden="true" />}
                label={t('agentTeams.older')}
                size="sm"
                tone="muted"
                disabled={selectedIndex <= 0}
                onClick={() => setHistoryIndex(sessionId, selectedIndex - 1)}
              />
              <IconButton
                icon={<ChevronRight aria-hidden="true" />}
                label={t('agentTeams.newer')}
                size="sm"
                tone="muted"
                disabled={selectedIndex >= latestIndex}
                onClick={() => setHistoryIndex(sessionId, selectedIndex + 1)}
              />
              <Button
                variant="accent"
                size="sm"
                icon={<Radio size={13} aria-hidden="true" />}
                onClick={() => setHistoryIndex(sessionId, null)}
              >
                {t('agentTeams.backToLive')}
              </Button>
            </>
          )}
          <span className="hidden w-[64px] text-right font-mono text-[10px] tabular-nums text-[var(--color-text-tertiary)] 2xl:block">
            {historyIndex === null ? t('agentTeams.live') : `T+${selectedIndex}`} · {formatSnapshotTime(snapshot)}
          </span>
          <IconButton
            icon={<X aria-hidden="true" />}
            label={t('agentTeams.closeWorkbench')}
            size="sm"
            tone="muted"
            onClick={() => setWorkbenchOpen(sessionId, false)}
          />
        </div>
      </header>

      <div ref={officeViewportRef} className="min-h-0 flex-1 overflow-auto">
        <div
          data-testid="agent-teams-office"
          className="agent-teams-org-canvas relative mx-auto"
          style={{ width: layout.width, height: layout.height }}
        >
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            width={layout.width}
            height={layout.height}
          >
            {rootTasks.map((positioned) => (
              <LeaderEdge
                key={`leader-${positioned.task.id}`}
                canvasWidth={layout.width}
                to={positioned}
                active={positioned.state === 'running'}
              />
            ))}
            {layout.tasks.flatMap((positioned) => positioned.task.blockedBy.map((dependencyId, dependencyIndex) => {
              const dependency = layout.byId.get(dependencyId)
              if (!dependency) return null
              const isFocused = focusedTaskId === positioned.task.id || focusedTaskId === dependencyId
              return (
                <DependencyEdge
                  key={`${dependencyId}-${positioned.task.id}`}
                  from={dependency}
                  to={positioned}
                  secondary={dependencyIndex > 0}
                  focused={isFocused}
                  dimmed={Boolean(focusedTaskId) && !isFocused}
                />
              )
            }))}
            {hasNewMessage && latestMessage ? (
              <MessageFlight
                message={latestMessage}
                positions={memberPositions}
                members={members}
                width={layout.width}
              />
            ) : null}
          </svg>

          {leadMember ? (
            <LeaderNode
              member={leadMember}
              state={memberPositions.get(leadMember.agentId)?.state ?? 'idle'}
              canvasWidth={layout.width}
              accent={memberAccent(leadMember, members.indexOf(leadMember))}
              isMessageSender={Boolean(hasNewMessage && latestMessage && memberMatchesIdentity(leadMember, latestMessage.from))}
              onSelect={() => setSelectedMemberId((current) => current === leadMember.agentId ? null : leadMember.agentId)}
              t={t}
            />
          ) : null}

          {unassignedMembers.map((member) => {
            const position = memberPositions.get(member.agentId)
            if (!position) return null
            return (
              <UnassignedMemberNode
                key={member.agentId}
                member={member}
                state={position.state}
                position={position}
                accent={memberAccent(member, members.indexOf(member))}
                isMessageSender={Boolean(hasNewMessage && latestMessage && memberMatchesIdentity(member, latestMessage.from))}
                onSelect={() => setSelectedMemberId((current) => current === member.agentId ? null : member.agentId)}
                t={t}
              />
            )
          })}

          {layout.tasks.length === 0 ? (
            <div className="absolute inset-x-4 top-[196px] text-center text-[12px] leading-7 text-[var(--color-text-tertiary)]">
              {t('agentTeams.emptyTasks')}
            </div>
          ) : null}

          {layout.tasks.map((positioned) => (
            <TaskCard
              key={positioned.task.id}
              positioned={positioned}
              members={members}
              snapshot={snapshot}
              primaryTaskByMemberId={primaryTaskByMemberId}
              latestMessage={hasNewMessage ? latestMessage : undefined}
              onSelectMember={(member) => setSelectedMemberId((current) => current === member.agentId ? null : member.agentId)}
              onFocusTask={setFocusedTaskId}
              t={t}
            />
          ))}
        </div>
      </div>

      <CommunicationFeed snapshot={snapshot} selectedIndex={selectedIndex} t={t} />

      {selectedMember ? (
        <MemberDrawer
          member={selectedMember}
          snapshot={snapshot}
          avatarKey={getMemberAvatarKey(selectedMember, selectedMember.agentId === leadId)}
          accent={memberAccent(selectedMember, members.indexOf(selectedMember))}
          onClose={() => setSelectedMemberId(null)}
          onOpenConversation={() => openMemberSession(selectedMember, snapshot.team)}
          t={t}
        />
      ) : null}
    </section>
  )
}

function MemberFigure({
  member,
  state,
  accent,
  isLead = false,
  isMessageSender = false,
  showName = false,
  testId,
  className,
  onSelect,
  t,
}: {
  member: TeamMember
  state: MemberWorkState
  accent: string
  isLead?: boolean
  isMessageSender?: boolean
  showName?: boolean
  testId?: string
  className: string
  onSelect: () => void
  t: TranslationFn
}) {
  const name = memberName(member)
  const avatarKey = getMemberAvatarKey(member, isLead)
  const motionClass = state === 'working'
    ? 'agent-teams-character-working'
    : state === 'idle'
      ? 'agent-teams-character-idle'
      : ''
  return (
    <button
      type="button"
      data-testid={testId}
      data-avatar-key={avatarKey}
      data-member-state={state}
      aria-label={t('agentTeams.openMember', { name })}
      title={`${name} · ${memberStateLabel(state, t)}`}
      onClick={onSelect}
      className={`agent-teams-person relative z-[var(--z-raised)] cursor-pointer rounded-[var(--radius-lg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] ${className}`}
    >
      <span className={`agent-teams-character relative block h-full w-full ${motionClass} ${state === 'exited' ? 'agent-teams-character-archived' : ''} ${isMessageSender ? 'agent-teams-character-message' : ''}`}>
        <img
          src={MEMBER_AVATARS[avatarKey]}
          alt=""
          draggable={false}
          className="h-full w-full select-none object-contain drop-shadow-[0_4px_3px_rgba(0,0,0,0.16)]"
        />
        <span
          aria-hidden="true"
          className="absolute bottom-0 left-1/2 h-1.5 w-6 -translate-x-1/2 rounded-full border border-[var(--color-surface-container-lowest)] shadow-sm"
          style={{ background: accent }}
        />
      </span>
      {state === 'idle' ? (
        <span className="agent-teams-zz absolute -top-1 right-0 text-[8.5px] font-bold text-[var(--color-text-tertiary)]">zZ</span>
      ) : null}
      {showName ? (
        <span className="pointer-events-none absolute left-1/2 top-[calc(100%-2px)] max-w-[112px] -translate-x-1/2 truncate rounded-[var(--radius-sm)] bg-[var(--color-surface-container-lowest)] px-1.5 font-mono text-[9px] font-extrabold leading-5 text-[var(--color-text-secondary)] shadow-[var(--shadow-card)]">
          {name}
        </span>
      ) : null}
    </button>
  )
}

function LeaderNode({
  member,
  state,
  canvasWidth,
  accent,
  isMessageSender,
  onSelect,
  t,
}: {
  member: TeamMember
  state: MemberWorkState
  canvasWidth: number
  accent: string
  isMessageSender: boolean
  onSelect: () => void
  t: TranslationFn
}) {
  const name = memberName(member)
  return (
    <div
      data-layout-role="leader-root"
      data-center-x={canvasWidth / 2}
      className="absolute top-3 z-[var(--z-raised)] flex w-[184px] flex-col items-center"
      style={{ left: canvasWidth / 2 - 92 }}
    >
      <div className="absolute top-[70px] h-[58px] w-px bg-[var(--color-border-strong)]" aria-hidden="true" />
      <MemberFigure
        member={member}
        state={state}
        accent={accent}
        isLead
        isMessageSender={isMessageSender}
        testId={`agent-teams-member-${member.agentId}`}
        className="h-[88px] w-[88px]"
        onSelect={onSelect}
        t={t}
      />
      <button
        type="button"
        onClick={onSelect}
        className="relative -mt-1 flex min-w-[150px] max-w-[184px] cursor-pointer items-center justify-center gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border-strong)] bg-[var(--color-surface-container-lowest)] px-3 py-2 shadow-[var(--shadow-card)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
      >
        <span className="min-w-0 truncate font-mono text-[11px] font-extrabold">{name}</span>
        <Badge tone="brand" size="xs" bordered>{t('agentTeams.leader')}</Badge>
      </button>
    </div>
  )
}

function UnassignedMemberNode({
  member,
  state,
  position,
  accent,
  isMessageSender,
  onSelect,
  t,
}: {
  member: TeamMember
  state: MemberWorkState
  position: BotPosition
  accent: string
  isMessageSender: boolean
  onSelect: () => void
  t: TranslationFn
}) {
  return (
    <div className="absolute" style={{ left: position.x - 28, top: position.y - 28 }}>
      <MemberFigure
        member={member}
        state={state}
        accent={accent}
        isMessageSender={isMessageSender}
        showName
        testId={`agent-teams-member-${member.agentId}`}
        className="h-14 w-14"
        onSelect={onSelect}
        t={t}
      />
    </div>
  )
}

function LeaderEdge({
  canvasWidth,
  to,
  active,
}: {
  canvasWidth: number
  to: PositionedWorkbenchTask
  active: boolean
}) {
  const x1 = canvasWidth / 2
  const y1 = 132
  const x2 = to.x + WORKBENCH_TASK_WIDTH / 2
  const y2 = to.y
  return (
    <path
      data-edge-kind="leader-root"
      d={`M ${x1} ${y1} C ${x1} ${y1 + 34}, ${x2} ${y2 - 34}, ${x2} ${y2}`}
      fill="none"
      stroke="var(--color-brand)"
      strokeWidth={active ? 2.4 : 1.8}
      strokeDasharray={active ? '6 5' : undefined}
      strokeLinecap="round"
      className={active ? 'agent-teams-flow' : undefined}
    />
  )
}

function DependencyEdge({
  from,
  to,
  secondary,
  focused,
  dimmed,
}: {
  from: PositionedWorkbenchTask
  to: PositionedWorkbenchTask
  secondary: boolean
  focused: boolean
  dimmed: boolean
}) {
  const x1 = from.x + WORKBENCH_TASK_WIDTH / 2
  const y1 = from.y + WORKBENCH_TASK_HEIGHT
  const x2 = to.x + WORKBENCH_TASK_WIDTH / 2
  const y2 = to.y
  const isSatisfied = from.task.status === 'completed'
  const isFlowing = isSatisfied && to.state === 'running'
  const stroke = focused || isFlowing
    ? 'var(--color-brand)'
    : secondary
      ? 'var(--color-border-separator)'
      : 'var(--color-outline)'
  const opacity = dimmed
    ? 0.06
    : focused
      ? 0.92
      : secondary
        ? 0.16
        : 0.5
  return (
    <path
      data-edge-kind={secondary ? 'dependency-secondary' : 'dependency-primary'}
      data-edge-active={focused ? 'true' : undefined}
      d={`M ${x1} ${y1} C ${x1} ${y1 + 20}, ${x2} ${y2 - 20}, ${x2} ${y2}`}
      fill="none"
      stroke={stroke}
      strokeWidth={focused ? 2 : secondary ? 1 : 1.35}
      strokeDasharray={secondary ? '3 6' : isFlowing ? '6 5' : isSatisfied ? undefined : '4 5'}
      strokeLinecap="round"
      className={`transition-opacity duration-150 ${isFlowing && !secondary ? 'agent-teams-flow' : ''}`}
      style={{ opacity }}
    />
  )
}

function MessageFlight({
  message,
  positions,
  members,
  width,
}: {
  message: TeamWorkbenchMessage
  positions: Map<string, BotPosition>
  members: TeamMember[]
  width: number
}) {
  const findMember = (identity: string) => members.find((member) => memberMatchesIdentity(member, identity))
  const sender = findMember(message.from)
  const senderPosition = sender ? positions.get(sender.agentId) : undefined
  if (!senderPosition || message.kind === 'system') return null
  const color = message.kind === 'broadcast' ? 'var(--color-warning)' : 'var(--color-brand)'
  if (message.kind === 'broadcast') {
    return (
      <>
        <path
          d={`M ${senderPosition.x} ${senderPosition.y} L ${width - 14} ${senderPosition.y}`}
          fill="none"
          stroke={color}
          strokeWidth="1.8"
          strokeDasharray="5 4"
          className="agent-teams-flow"
        />
        <circle cx={width - 14} cy={senderPosition.y} r="3" fill={color} />
      </>
    )
  }
  const recipient = findMember(message.to)
  const recipientPosition = recipient ? positions.get(recipient.agentId) : undefined
  if (!recipientPosition) return null
  const x1 = senderPosition.x
  const y1 = senderPosition.y
  const x2 = recipientPosition.x
  const y2 = recipientPosition.y
  return (
    <>
      <path
        d={`M ${x1} ${y1} Q ${(x1 + x2) / 2} ${Math.min(y1, y2) - 34}, ${x2} ${y2}`}
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeDasharray="5 4"
        className="agent-teams-flow"
      />
      <circle cx={x2} cy={y2} r="3" fill={color} />
    </>
  )
}

function TaskCard({
  positioned,
  members,
  snapshot,
  primaryTaskByMemberId,
  latestMessage,
  onSelectMember,
  onFocusTask,
  t,
}: {
  positioned: PositionedWorkbenchTask
  members: TeamMember[]
  snapshot: TeamWorkbenchSnapshot
  primaryTaskByMemberId: Map<string, string>
  latestMessage?: TeamWorkbenchMessage
  onSelectMember: (member: TeamMember) => void
  onFocusTask: (taskId: string | null) => void
  t: TranslationFn
}) {
  const { task, state, x, y } = positioned
  const owner = task.owner
    ? members.find((member) => taskOwnedByMember(task, member))
    : undefined
  const dependencyLabel = task.blockedBy.map((dependency) => `#${dependency}`).join(' ')
  const ownerState = owner
    ? memberState(owner, snapshot, owner.agentId === snapshot.team.leadAgentId)
    : undefined
  const isPrimaryOwnerFigure = Boolean(
    owner
    && owner.agentId !== snapshot.team.leadAgentId
    && primaryTaskByMemberId.get(owner.agentId) === task.id,
  )
  return (
    <article
      data-testid={`agent-teams-task-${task.id}`}
      data-state={state}
      data-owner-agent-id={owner?.agentId}
      tabIndex={0}
      onMouseEnter={() => onFocusTask(task.id)}
      onMouseLeave={() => onFocusTask(null)}
      onFocus={() => onFocusTask(task.id)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onFocusTask(null)
      }}
      className={`agent-teams-task absolute h-[94px] w-[216px] rounded-[var(--radius-xl)] border bg-[var(--color-surface-container-lowest)] py-[10px] pr-3 shadow-[var(--shadow-card)] outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] ${owner ? 'pl-[58px]' : 'pl-3'}`}
      style={{
        left: x,
        top: y,
        borderColor: taskBorder(state),
      }}
    >
      {owner && ownerState ? (
        <div className="absolute -left-[18px] top-[13px]">
          <MemberFigure
            member={owner}
            state={ownerState}
            accent={memberAccent(owner, members.indexOf(owner))}
            isLead={owner.agentId === snapshot.team.leadAgentId}
            isMessageSender={Boolean(latestMessage && memberMatchesIdentity(owner, latestMessage.from))}
            testId={isPrimaryOwnerFigure ? `agent-teams-member-${owner.agentId}` : `agent-teams-task-owner-${task.id}`}
            className="h-[66px] w-[66px]"
            onSelect={() => onSelectMember(owner)}
            t={t}
          />
        </div>
      ) : null}
      <div className="flex items-center gap-1">
        <span className={`font-mono text-[10px] font-extrabold ${state === 'running' ? 'text-[var(--color-brand)]' : 'text-[var(--color-text-tertiary)]'}`}>
          #{task.id}
        </span>
        <span className="flex-1" />
        <span className="inline-flex items-center gap-1 text-[9px] font-extrabold" style={{ color: taskBorder(state) }}>
          <StatusDot tone={taskTone(state)} pulse={state === 'running'} />
          {taskStateLabel(state, t)}
        </span>
      </div>
      <div className="mt-1 line-clamp-2 min-h-[32px] text-[11.5px] font-bold leading-[1.4]" title={task.subject}>
        {task.subject}
      </div>
      <div className="mt-1 flex min-h-4 items-center gap-1.5">
        {owner ? (
          <span className="truncate font-mono text-[10px] font-semibold text-[var(--color-text-secondary)]">
            {memberName(owner)}
          </span>
        ) : (
          <span className="truncate text-[9.5px] text-[var(--color-text-tertiary)]">
            {state === 'blocked'
              ? t('agentTeams.task.dependencies', { dependencies: dependencyLabel })
              : t('agentTeams.task.unclaimed')}
          </span>
        )}
      </div>
    </article>
  )
}

function CommunicationFeed({
  snapshot,
  selectedIndex,
  t,
}: {
  snapshot: TeamWorkbenchSnapshot
  selectedIndex: number
  t: TranslationFn
}) {
  const messages = [...snapshot.messages].reverse()
  return (
    <section className="flex h-[196px] shrink-0 flex-col border-t border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex shrink-0 items-baseline gap-2 px-4 pb-1 pt-2">
        <h3 className="text-[12px] font-extrabold">{t('agentTeams.communication.title')}</h3>
        <span className="text-[10px] text-[var(--color-text-tertiary)]">
          {t('agentTeams.communication.count', { count: messages.length })}
        </span>
        {snapshot.deletedAt ? (
          <span className="ml-auto text-[10px] font-semibold text-[var(--color-success)]">
            {t('agentTeams.disbanded')}
          </span>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
        {messages.length === 0 ? (
          <div className="px-1 py-6 text-center text-[11px] text-[var(--color-text-tertiary)]">
            {t('agentTeams.communication.empty')}
          </div>
        ) : messages.map((message, index) => (
          <div
            key={message.id}
            className={`mb-0.5 rounded-[var(--radius-md)] px-2 py-1.5 ${index === 0 ? 'bg-[var(--color-brand-soft)]' : ''}`}
          >
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="text-[9px] font-extrabold" style={{ color: messageTone(message) }}>
                {messageKindLabel(message, t)}
              </span>
              {message.kind !== 'system' ? (
                <span className="min-w-0 truncate font-mono text-[10px] font-bold text-[var(--color-text-secondary)]">
                  {message.from} → {message.kind === 'broadcast' ? t('agentTeams.communication.everyone') : message.to}
                </span>
              ) : null}
              {message.taskId ? (
                <span className="shrink-0 font-mono text-[9px] text-[var(--color-text-tertiary)]">#{message.taskId}</span>
              ) : null}
              <span className="ml-auto shrink-0 font-mono text-[9px] tabular-nums text-[var(--color-text-tertiary)]">
                T+{selectedIndex}
              </span>
            </div>
            <div className="mt-0.5 line-clamp-2 text-[11px] leading-[1.55] text-[var(--color-text-secondary)]">
              {messageText(message, t)}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function MemberDrawer({
  member,
  snapshot,
  avatarKey,
  accent,
  onClose,
  onOpenConversation,
  t,
}: {
  member: TeamMember
  snapshot: TeamWorkbenchSnapshot
  avatarKey: MemberAvatarKey
  accent: string
  onClose: () => void
  onOpenConversation: () => void
  t: TranslationFn
}) {
  const isLead = member.agentId === snapshot.team.leadAgentId
  const state = memberState(member, snapshot, isLead)
  const tasks = snapshot.tasks.filter((task) => taskOwnedByMember(task, member))
  const messages = snapshot.messages
    .filter((message) => message.from === memberName(member) || message.to === memberName(member) || message.recipients.includes(memberName(member)))
    .slice(-5)
    .reverse()
  const currentTask = runningTaskForMember(snapshot.tasks, member)
  const name = memberName(member)
  return (
    <aside
      role="dialog"
      aria-label={t('agentTeams.memberDetails', { name })}
      className="agent-teams-drawer absolute inset-y-0 right-0 z-[var(--z-drawer)] flex w-[min(360px,100%)] flex-col bg-[var(--color-surface-container-lowest)] shadow-[var(--shadow-overlay)]"
    >
      <header className="shrink-0 border-b border-[var(--color-border)] px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="relative inline-flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-[var(--radius-xl)] bg-[var(--color-surface-container)]">
            <img
              src={MEMBER_AVATARS[avatarKey]}
              alt=""
              draggable={false}
              className="h-[68px] w-[68px] select-none object-contain drop-shadow-[0_5px_4px_rgba(0,0,0,0.16)]"
            />
            <span
              aria-hidden="true"
              className="absolute bottom-1 left-1/2 h-1.5 w-7 -translate-x-1/2 rounded-full border border-[var(--color-surface-container-lowest)]"
              style={{ background: accent }}
            />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-[14px] font-extrabold">{name}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[var(--color-text-secondary)]">
              <StatusDot tone={state === 'error' ? 'danger' : state === 'working' ? 'brand' : state === 'exited' ? 'success' : 'neutral'} pulse={state === 'working'} />
              {member.role} · {memberStateLabel(state, t)}
            </div>
          </div>
          <IconButton icon={<X aria-hidden="true" />} label={t('workbench.close')} size="sm" tone="muted" onClick={onClose} />
        </div>
        <div className="mt-3 rounded-[var(--radius-md)] bg-[var(--color-surface-container)] px-3 py-2 font-mono text-[10.5px] leading-5 text-[var(--color-text-secondary)]">
          {currentTask?.activeForm || currentTask?.subject || member.currentTask || memberStateLabel(state, t)}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <DrawerSection title={t('agentTeams.memberTasks')}>
          {tasks.length === 0 ? (
            <p className="py-2 text-[11px] text-[var(--color-text-tertiary)]">{t('agentTeams.noMemberTasks')}</p>
          ) : tasks.map((task) => (
            <div key={task.id} className="flex items-center gap-2 border-b border-[var(--color-border-separator)] py-2 text-[11px]">
              <span className="font-mono font-bold text-[var(--color-brand)]">#{task.id}</span>
              <span className="min-w-0 flex-1 truncate font-medium">{task.subject}</span>
              <Badge tone={taskTone(task.status === 'completed' ? 'completed' : task.status === 'in_progress' ? 'running' : 'open')} size="xs">
                {taskStateLabel(task.status === 'completed' ? 'completed' : task.status === 'in_progress' ? 'running' : 'open', t)}
              </Badge>
            </div>
          ))}
        </DrawerSection>
        <DrawerSection title={t('agentTeams.memberMessages')}>
          {messages.length === 0 ? (
            <p className="py-2 text-[11px] text-[var(--color-text-tertiary)]">{t('agentTeams.noMemberMessages')}</p>
          ) : messages.map((message) => (
            <div key={message.id} className="border-b border-[var(--color-border-separator)] py-2">
              <div className="text-[9px] font-extrabold" style={{ color: messageTone(message) }}>
                {messageKindLabel(message, t)} · {message.from} → {message.to}
              </div>
              <div className="mt-1 line-clamp-3 text-[11px] leading-5 text-[var(--color-text-secondary)]">
                {messageText(message, t)}
              </div>
            </div>
          ))}
        </DrawerSection>
        <p className="mt-5 text-[10px] text-[var(--color-text-tertiary)]">
          {t(snapshot.deletedAt ? 'agentTeams.archivedConversationHint' : 'agentTeams.fullConversationHint')}
        </p>
      </div>
      <div className="shrink-0 border-t border-[var(--color-border)] p-4">
        <Button variant="accent" size="md" block onClick={onOpenConversation} disabled={isLead}>
          {t(snapshot.deletedAt ? 'agentTeams.openExecution' : 'agentTeams.openConversation', { name })}
        </Button>
      </div>
    </aside>
  )
}

function DrawerSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5">
      <h3 className="mb-1 text-[10.5px] font-extrabold tracking-[0.08em] text-[var(--color-text-tertiary)]">{title}</h3>
      {children}
    </section>
  )
}
