import { create } from 'zustand'
import { workflowsApi } from '../api/workflows'
import type {
  ReconstructedWorkflowRun,
  WorkflowAgentEvent,
  WorkflowDefinition,
  WorkflowPhaseGroup,
  WorkflowProgressEvent,
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowRunSummary,
} from '../types/workflow'

/** Cap kept in sync with the CLI's own progress-row budget. */
const MAX_PROGRESS_ROWS = 500

type WorkflowStore = {
  /** Live and just-finished runs, keyed by CLI task id. */
  runs: Record<string, WorkflowRun>
  definitions: WorkflowDefinition[]
  definitionsLoading: boolean
  definitionsError: string | null
  history: WorkflowRunSummary[]
  historyLoading: boolean
  /** Task id of the run the workflow panel is showing, if any. */
  openRunId: string | null

  handleTaskEvent(
    sessionId: string,
    subtype: 'task_started' | 'task_progress' | 'task_notification',
    data: unknown,
  ): void
  clearSession(sessionId: string): void
  hydrateSession(sessionId: string): Promise<void>
  openRun(taskId: string | null): void
  loadDefinitions(cwd?: string): Promise<void>
  loadHistory(sessionId?: string): Promise<void>
}

export const useWorkflowStore = create<WorkflowStore>(set => ({
  runs: {},
  definitions: [],
  definitionsLoading: false,
  definitionsError: null,
  history: [],
  historyLoading: false,
  openRunId: null,

  handleTaskEvent(sessionId, subtype, data) {
    // A run we already track is identified by its task id alone. The terminal
    // `task_notification` the CLI emits carries no task_type, workflow_name or
    // workflow_progress (print.ts builds it from the notification XML), so
    // re-deriving "is this a workflow" from the payload would drop it and the
    // run would sit at "running" forever.
    const known = Boolean(
      typeof data === 'object' &&
        data !== null &&
        typeof (data as { task_id?: unknown }).task_id === 'string' &&
        useWorkflowStore.getState().runs[(data as { task_id: string }).task_id],
    )
    const event = parseWorkflowTaskEvent(sessionId, subtype, data, known)
    if (!event) return
    set(state => {
      const existing = state.runs[event.taskId]
      const merged = mergeRun(existing, event)
      if (merged === existing) return state
      return { runs: { ...state.runs, [event.taskId]: merged } }
    })
  },

  /**
   * Load a session's finished runs from disk.
   *
   * Live progress only exists while a run is happening, so a session reopened
   * later showed no workflow at all. This fills that in from the per-agent
   * sidecars the CLI persisted. A run already being tracked live is left
   * alone — the live stream is strictly better than the reconstruction.
   */
  async hydrateSession(sessionId) {
    try {
      const { runs } = await workflowsApi.sessionRuns(sessionId)
      if (runs.length === 0) return
      set(state => {
        const liveRunIds = new Set(
          Object.values(state.runs)
            .filter(run => run.sessionId === sessionId)
            .map(run => run.runId)
            .filter((runId): runId is string => Boolean(runId)),
        )
        const next = { ...state.runs }
        let added = false
        for (const run of runs) {
          if (liveRunIds.has(run.runId) || next[run.runId]) continue
          added = true
          next[run.runId] = reconstructedToRun(sessionId, run)
        }
        return added ? { runs: next } : state
      })
    } catch {
      // History is an enhancement; a session that cannot load it still works.
    }
  },

  clearSession(sessionId) {
    set(state => {
      const kept: Record<string, WorkflowRun> = {}
      let removed = false
      for (const [taskId, run] of Object.entries(state.runs)) {
        if (run.sessionId === sessionId) {
          removed = true
          continue
        }
        kept[taskId] = run
      }
      if (!removed) return state
      const openRunId =
        state.openRunId && kept[state.openRunId] ? state.openRunId : null
      return { runs: kept, openRunId }
    })
  },

  openRun(taskId) {
    set({ openRunId: taskId })
  },

  async loadDefinitions(cwd) {
    set({ definitionsLoading: true, definitionsError: null })
    try {
      const { workflows } = await workflowsApi.list(cwd)
      set({ definitions: workflows, definitionsLoading: false })
    } catch (error) {
      set({
        definitionsLoading: false,
        definitionsError:
          error instanceof Error ? error.message : 'Failed to load workflows',
      })
    }
  },

  async loadHistory(sessionId) {
    set({ historyLoading: true })
    try {
      const { runs } = await workflowsApi.listRuns({ sessionId, limit: 50 })
      set({ history: runs, historyLoading: false })
    } catch {
      set({ historyLoading: false })
    }
  },
}))


/**
 * Turn a disk-reconstructed run into the shape the panel renders.
 *
 * Every agent listed produced a transcript, so `done` is a fact rather than an
 * assumption. Per-agent token counts and the run's own outcome are not
 * persisted, so they are left empty instead of being invented — the panel
 * shows neither for a historical run.
 */
function reconstructedToRun(
  sessionId: string,
  run: ReconstructedWorkflowRun,
): WorkflowRun {
  const phases = new Map<number, string | undefined>()
  const progress: WorkflowProgressEvent[] = []

  for (const agent of run.agents) {
    if (!phases.has(agent.phaseIndex)) {
      phases.set(agent.phaseIndex, agent.phaseTitle)
    }
  }
  for (const [index, title] of [...phases.entries()].sort(([a], [b]) => a - b)) {
    progress.push({
      type: 'workflow_phase',
      index,
      // Left empty rather than invented when the run never recorded a phase
      // title, so the renderer can fall back to something meaningful. Filling
      // in "Phase 0" here hid that the title was simply unknown.
      title: title ?? '',
    })
  }
  for (const agent of run.agents) {
    progress.push({
      type: 'workflow_agent',
      index: agent.agentIndex,
      label: agent.label,
      state: 'done',
      phaseIndex: agent.phaseIndex,
      ...(agent.phaseTitle ? { phaseTitle: agent.phaseTitle } : {}),
      agentId: agent.agentId,
    })
  }

  return {
    // Keyed by run id: a reconstructed run has no CLI task id, and the run id
    // is what keeps it from colliding with a live run for the same workflow.
    taskId: run.runId,
    sessionId,
    runId: run.runId,
    workflowName: run.workflowName,
    status: 'completed',
    startedAt: run.startedAt,
    updatedAt: run.startedAt,
    endedAt: run.startedAt,
    agentCount: run.agents.length,
    totalTokens: 0,
    toolCalls: 0,
    progress,
  }
}

// ── Selectors ────────────────────────────────────────────────────────────────

export function runsForSession(
  state: Pick<WorkflowStore, 'runs'>,
  sessionId: string,
): WorkflowRun[] {
  return Object.values(state.runs)
    .filter(run => run.sessionId === sessionId)
    .sort((a, b) => b.startedAt - a.startedAt)
}

export function activeRunForSession(
  state: Pick<WorkflowStore, 'runs'>,
  sessionId: string,
): WorkflowRun | null {
  return (
    runsForSession(state, sessionId).find(run => run.status === 'running') ?? null
  )
}

/**
 * Fold a run's flat progress rows into phases.
 *
 * Agents emitted before any `phase()` call carry no `phaseIndex`; they are
 * grouped under a synthetic phase rather than dropped, so a script that never
 * calls `phase()` still shows all of its agents.
 */
export function groupRunPhases(run: WorkflowRun): {
  phases: WorkflowPhaseGroup[]
  ungrouped: WorkflowAgentEvent[]
} {
  const byIndex = new Map<number, WorkflowPhaseGroup>()
  const ungrouped: WorkflowAgentEvent[] = []

  for (const event of run.progress) {
    if (event.type === 'workflow_phase') {
      if (!byIndex.has(event.index)) {
        byIndex.set(event.index, {
          index: event.index,
          title: event.title,
          agents: [],
        })
      }
      continue
    }
    if (event.phaseIndex === undefined) {
      ungrouped.push(event)
      continue
    }
    const group = byIndex.get(event.phaseIndex) ?? {
      index: event.phaseIndex,
      title: event.phaseTitle ?? `Phase ${event.phaseIndex}`,
      agents: [],
    }
    group.agents.push(event)
    byIndex.set(event.phaseIndex, group)
  }

  return {
    phases: [...byIndex.values()].sort((a, b) => a.index - b.index),
    ungrouped,
  }
}

/** Fraction of a run's agents that have settled, for the progress bar. */
export function runCompletion(run: WorkflowRun): number {
  const agents = run.progress.filter(
    (event): event is WorkflowAgentEvent => event.type === 'workflow_agent',
  )
  if (agents.length === 0) return run.status === 'running' ? 0 : 1
  const settled = agents.filter(
    agent => agent.state === 'done' || agent.state === 'error',
  ).length
  return settled / agents.length
}

// ── Event parsing ────────────────────────────────────────────────────────────

type ParsedEvent = {
  taskId: string
  sessionId: string
  runId?: string
  workflowName?: string
  description?: string
  status?: WorkflowRunStatus
  progress: WorkflowProgressEvent[]
  totalTokens?: number
  toolCalls?: number
  result?: string
  error?: string
}

/**
 * Read a CLI task event, keeping only the ones that belong to a workflow.
 *
 * `task_progress` does not carry `task_type`, and the terminal
 * `task_notification` carries neither that nor `workflow_progress`. A run is
 * therefore recognised either by its workflow markers or — once `task_started`
 * has registered it — by its task id alone.
 */
export function parseWorkflowTaskEvent(
  sessionId: string,
  subtype: 'task_started' | 'task_progress' | 'task_notification',
  data: unknown,
  /** True when a run with this task id is already tracked. */
  known = false,
): ParsedEvent | null {
  if (typeof data !== 'object' || data === null) return null
  const payload = data as Record<string, unknown>
  const taskId = readString(payload.task_id)
  if (!taskId) return null

  const taskType = readString(payload.task_type)
  const workflowName = readString(payload.workflow_name)
  const progress = readProgress(payload.workflow_progress)
  const isWorkflow =
    known ||
    taskType === 'local_workflow' ||
    Boolean(workflowName) ||
    progress.length > 0
  if (!isWorkflow) return null

  const usage =
    typeof payload.usage === 'object' && payload.usage !== null
      ? (payload.usage as Record<string, unknown>)
      : undefined

  const terminal = subtype === 'task_notification'
  const status = terminal
    ? normalizeStatus(readString(payload.status))
    : 'running'
  const summary = readString(payload.summary)

  return {
    taskId,
    sessionId,
    runId: readString(payload.workflow_run_id),
    workflowName,
    // A terminal notification's `summary` describes the outcome, not the run.
    // Letting it through as the description replaced "Survey Express
    // request/response helpers…" with `Dynamic workflow "…" failed: …` in a
    // single truncated line.
    description: terminal ? undefined : (summary ?? readString(payload.description)),
    status,
    progress,
    totalTokens: readNumber(usage?.total_tokens),
    toolCalls: readNumber(usage?.tool_uses),
    result: readString(payload.result),
    // The CLI's terminal event carries no `error` field — the reason a run
    // failed only ever arrives inside `summary`. Without this a failed run
    // showed a red badge and no explanation anywhere.
    error:
      readString(payload.error) ??
      (status === 'failed' || status === 'stopped' ? summary : undefined),
  }
}

/**
 * Apply one event to a run.
 *
 * Agent and phase rows are keyed by `type:index` and replaced in place, so a
 * run that emits thousands of token-count updates for twenty agents keeps
 * twenty rows. Returning the previous object unchanged when nothing moved is
 * what stops zustand subscribers from re-rendering on every heartbeat.
 */
function mergeRun(
  existing: WorkflowRun | undefined,
  event: ParsedEvent,
): WorkflowRun {
  const now = Date.now()
  const base: WorkflowRun = existing ?? {
    taskId: event.taskId,
    sessionId: event.sessionId,
    runId: event.runId,
    workflowName: event.workflowName ?? 'workflow',
    description: event.description,
    status: 'running',
    startedAt: now,
    updatedAt: now,
    agentCount: 0,
    totalTokens: 0,
    toolCalls: 0,
    progress: [],
  }

  // A terminal run must not be revived by a late progress event.
  if (base.status !== 'running' && event.status === 'running') return base

  let progress = base.progress
  if (event.progress.length > 0) {
    const next = [...base.progress]
    const indexByKey = new Map<string, number>()
    for (let i = 0; i < next.length; i++) {
      const row = next[i]!
      indexByKey.set(`${row.type}:${row.index}`, i)
    }
    for (const row of event.progress) {
      const key = `${row.type}:${row.index}`
      const at = indexByKey.get(key)
      if (at === undefined) {
        indexByKey.set(key, next.length)
        next.push(row)
      } else {
        next[at] = row
      }
    }
    progress = next.length > MAX_PROGRESS_ROWS
      ? next.slice(next.length - MAX_PROGRESS_ROWS)
      : next
  }

  const agentCount = progress.reduce(
    (max, row) => (row.type === 'workflow_agent' ? Math.max(max, row.index) : max),
    0,
  )
  const status = event.status ?? base.status
  const isTerminal = status !== 'running'

  const merged: WorkflowRun = {
    ...base,
    runId: event.runId ?? base.runId,
    workflowName: event.workflowName ?? base.workflowName,
    description: event.description ?? base.description,
    status,
    updatedAt: now,
    endedAt: isTerminal ? (base.endedAt ?? now) : undefined,
    agentCount: Math.max(base.agentCount, agentCount),
    totalTokens: event.totalTokens ?? base.totalTokens,
    toolCalls: event.toolCalls ?? base.toolCalls,
    progress,
    result: event.result ?? base.result,
    error: event.error ?? base.error,
  }

  return hasChanged(base, merged) ? merged : base
}

function hasChanged(before: WorkflowRun, after: WorkflowRun): boolean {
  return (
    before.progress !== after.progress ||
    before.status !== after.status ||
    before.totalTokens !== after.totalTokens ||
    before.toolCalls !== after.toolCalls ||
    before.agentCount !== after.agentCount ||
    before.result !== after.result ||
    before.error !== after.error ||
    before.workflowName !== after.workflowName ||
    before.description !== after.description ||
    before.runId !== after.runId
  )
}

function readProgress(value: unknown): WorkflowProgressEvent[] {
  if (!Array.isArray(value)) return []
  const rows: WorkflowProgressEvent[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue
    const row = entry as Record<string, unknown>
    const index = readNumber(row.index)
    if (index === undefined) continue
    if (row.type === 'workflow_phase' && typeof row.title === 'string') {
      rows.push({
        type: 'workflow_phase',
        index,
        title: row.title,
        kind: row.kind === 'meta' || row.kind === 'script' ? row.kind : undefined,
      })
      continue
    }
    if (row.type === 'workflow_agent' && typeof row.label === 'string') {
      rows.push({ ...(row as unknown as WorkflowAgentEvent), index })
    }
  }
  return rows
}

function normalizeStatus(value: string | undefined): WorkflowRunStatus {
  switch (value) {
    case 'completed':
      return 'completed'
    case 'failed':
      return 'failed'
    case 'killed':
    case 'stopped':
      return 'stopped'
    default:
      return 'running'
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
