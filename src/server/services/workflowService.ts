/**
 * Dynamic workflow service for the local API.
 *
 * Two things live here: the *definitions* a user can run (bundled, personal,
 * project) and the *runs* the CLI has already executed. Runs are reconstructed
 * from the artifacts the runtime writes under the session directory — the
 * script, the resume journal, and the task output file — so the desktop can
 * show a run's history without the CLI process still being alive. Live
 * progress arrives separately over the WebSocket as `task_progress` events.
 */

import { createHash } from 'crypto'
import * as fs from 'fs/promises'
import * as path from 'path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { loadWorkflows } from '../../utils/workflows/discovery.js'
import { areWorkflowsEnabled } from '../../utils/workflows/enabled.js'
import {
  parseWorkflowScript,
  usesBannedNondeterminism,
} from '../../utils/workflows/meta.js'
import { compileWorkflowScript } from '../../utils/workflows/compile.js'
import type {
  WorkflowDefinition,
  WorkflowPhaseMeta,
  WorkflowProgressEvent,
} from '../../utils/workflows/types.js'
import { ApiError } from '../middleware/errorHandler.js'

export type WorkflowDefinitionSummary = {
  name: string
  description: string
  whenToUse?: string
  source: WorkflowDefinition['source']
  phases?: WorkflowPhaseMeta[]
  filePath?: string
  /** Present only on the detail endpoint — the list stays small. */
  script?: string
}

export type WorkflowRunSummary = {
  runId: string
  sessionId: string
  workflowName: string
  scriptPath: string
  startedAt: number
  /** Number of agents with a recorded result in the journal. */
  completedAgents: number
  status: ReconstructedWorkflowRunStatus | 'unknown'
}

export type WorkflowRunDetail = WorkflowRunSummary & {
  script: string
  description?: string
  phases?: WorkflowPhaseMeta[]
  agents: Array<{ key: string; agentId: string; result: unknown }>
  progress?: WorkflowProgressEvent[]
  logs?: string[]
  result?: unknown
  error?: string
  totalTokens?: number
  totalToolCalls?: number
}

export type ReconstructedWorkflowRunStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'stopped'

export type ReconstructedWorkflowAgentState =
  | 'start'
  | 'progress'
  | 'done'
  | 'error'

/** A run rebuilt from durable transcripts, sidecars, and its resume journal. */
export type ReconstructedRun = {
  runId: string
  taskId: string
  ownerAgentId?: string
  workflowName: string
  status: ReconstructedWorkflowRunStatus
  startedAt: number
  updatedAt: number
  endedAt?: number
  result?: string
  error?: string
  agents: Array<{
    agentId: string
    label: string
    phaseIndex: number
    phaseTitle?: string
    agentIndex: number
    state: ReconstructedWorkflowAgentState
    error?: string
    skipped?: boolean
  }>
}

export type WorkflowSaveScope = 'user' | 'project'

const RUN_SCRIPT_PATTERN = /^(.+)\.(wf_[a-z0-9-]{6,})\.js$/

type PersistedWorkflowLaunch = {
  runId: string
  taskId: string
  toolUseId?: string
  workflowName: string
  ownerAgentId?: string
  timestamp?: string
}

type PersistedWorkflowTerminal = {
  taskId: string
  toolUseId?: string
  ownerAgentId?: string
  status: Exclude<ReconstructedWorkflowRunStatus, 'running'>
  summary?: string
  result?: string
  outputFile?: string
  timestamp?: string
}

type PersistedWorkflowLifecycle = {
  launchesByRunId: Map<string, PersistedWorkflowLaunch>
  terminals: PersistedWorkflowTerminal[]
}

type WorkflowJournalState = {
  resultAgentIds: Set<string>
  startedAgentIds: Set<string>
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function parseTimestamp(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function stringifyResult(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (value === undefined) return undefined
  try {
    return JSON.stringify(value)
  } catch {
    return undefined
  }
}

function normalizePersistedStatus(
  value: unknown,
): PersistedWorkflowTerminal['status'] | undefined {
  if (value === 'completed' || value === 'failed') return value
  if (value === 'killed' || value === 'stopped') return 'stopped'
  return undefined
}

function workflowLaunchFromValue(
  value: unknown,
  context: { ownerAgentId?: string; timestamp?: string; toolUseId?: string },
  seen = new Set<unknown>(),
): PersistedWorkflowLaunch | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed.startsWith('{')) return null
    try {
      return workflowLaunchFromValue(JSON.parse(trimmed), context, seen)
    } catch {
      return null
    }
  }
  if (!isObjectRecord(value) || seen.has(value)) return null
  seen.add(value)

  const runId = nonEmptyString(value.runId) ?? nonEmptyString(value.workflowRunId)
  const taskId = nonEmptyString(value.taskId) ?? nonEmptyString(value.task_id)
  const taskType = nonEmptyString(value.taskType) ?? nonEmptyString(value.task_type)
  const status = nonEmptyString(value.status)
  if (
    runId?.startsWith('wf_') &&
    taskId &&
    (taskType === 'local_workflow' || status === 'async_launched')
  ) {
    return {
      runId,
      taskId,
      ...(context.toolUseId ? { toolUseId: context.toolUseId } : {}),
      workflowName: nonEmptyString(value.workflowName) ?? 'workflow',
      ...(context.ownerAgentId ? { ownerAgentId: context.ownerAgentId } : {}),
      ...(context.timestamp ? { timestamp: context.timestamp } : {}),
    }
  }

  for (const nested of Object.values(value)) {
    const launch = workflowLaunchFromValue(nested, context, seen)
    if (launch) return launch
  }
  return null
}

function xmlValue(text: string, tag: string): string | undefined {
  const match = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return match?.[1]?.trim() || undefined
}

function decodeXml(value: string | undefined): string | undefined {
  return value
    ?.replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
}

function stringsInValue(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(stringsInValue)
  if (!isObjectRecord(value)) return []
  return Object.values(value).flatMap(stringsInValue)
}

class WorkflowService {
  private configDir(): string {
    return path.resolve(getClaudeConfigHomeDir())
  }

  private projectsDir(): string {
    return path.join(this.configDir(), 'projects')
  }

  async listDefinitions(cwd?: string): Promise<WorkflowDefinitionSummary[]> {
    this.assertEnabled()
    const workflows = await loadWorkflows(cwd)
    return workflows.map(workflow => ({
      name: workflow.name,
      description: workflow.description,
      whenToUse: workflow.whenToUse,
      source: workflow.source,
      phases: workflow.phases,
      filePath: workflow.filePath,
    }))
  }

  async getDefinition(
    name: string,
    cwd?: string,
  ): Promise<WorkflowDefinitionSummary> {
    this.assertEnabled()
    const workflows = await loadWorkflows(cwd)
    const workflow = workflows.find(entry => entry.name === name)
    if (!workflow) throw ApiError.notFound(`Unknown workflow: ${name}`)
    return {
      name: workflow.name,
      description: workflow.description,
      whenToUse: workflow.whenToUse,
      source: workflow.source,
      phases: workflow.phases,
      filePath: workflow.filePath,
      script: workflow.script,
    }
  }

  /**
   * Parse and compile a script without running it.
   *
   * The desktop calls this before sending a run so a malformed script is
   * reported in the editor instead of coming back as a failed turn.
   */
  validate(script: string): {
    ok: boolean
    error?: string
    warnings?: string[]
    name?: string
    description?: string
    phases?: WorkflowPhaseMeta[]
  } {
    this.assertEnabled()
    const parsed = parseWorkflowScript(script)
    if ('error' in parsed) return { ok: false, error: parsed.error }
    const compiled = compileWorkflowScript(parsed.scriptBody)
    if (!compiled.ok) return { ok: false, error: compiled.error }
    // A script can compile and still be guaranteed to throw on its first
    // Date.now()/Math.random(). Saying so here is the difference between a
    // squiggle in the editor and a failed run.
    const warnings = usesBannedNondeterminism(parsed.scriptBody)
      ? [
          'Date.now(), new Date() and Math.random() throw at run time — they would make a resume replay diverge.',
        ]
      : undefined
    return {
      ok: true,
      ...(warnings ? { warnings } : {}),
      name: parsed.meta.name,
      description: parsed.meta.description,
      phases: parsed.meta.phases,
    }
  }

  /**
   * Save a script as a reusable `/name` command.
   *
   * Refuses to write through a symlink: the target directory is user-owned
   * config, and following a link would place the file somewhere the caller
   * did not choose.
   */
  async saveDefinition(params: {
    script: string
    scope: WorkflowSaveScope
    cwd?: string
  }): Promise<{ name: string; filePath: string }> {
    this.assertEnabled()
    const parsed = parseWorkflowScript(params.script)
    if ('error' in parsed) throw ApiError.badRequest(parsed.error)
    const compiled = compileWorkflowScript(parsed.scriptBody)
    if (!compiled.ok) throw ApiError.badRequest(compiled.error)

    const dir =
      params.scope === 'project'
        ? path.join(params.cwd ?? process.cwd(), '.claude', 'workflows')
        : path.join(this.configDir(), 'workflows')
    const filePath = path.join(dir, `${parsed.meta.name}.js`)

    await this.assertNotSymlink(filePath)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(filePath, params.script, 'utf8')
    return { name: parsed.meta.name, filePath }
  }

  async deleteDefinition(
    name: string,
    scope: WorkflowSaveScope,
    cwd?: string,
  ): Promise<void> {
    this.assertEnabled()
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name)) {
      throw ApiError.badRequest(`Invalid workflow name: ${name}`)
    }
    const dir =
      scope === 'project'
        ? path.join(cwd ?? process.cwd(), '.claude', 'workflows')
        : path.join(this.configDir(), 'workflows')
    const filePath = path.join(dir, `${name}.js`)
    await this.assertNotSymlink(filePath)
    try {
      await fs.unlink(filePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw ApiError.notFound(`No saved workflow at ${filePath}`)
      }
      throw error
    }
  }

  /**
   * Rebuild a session's workflow runs from what the CLI left on disk.
   *
   * The live progress stream only exists while a run is happening, so
   * reopening a finished session had nothing to show. Each agent's sidecar
   * metadata records the run and phase it belonged to and is written before
   * the agent starts, which makes it the durable record of a run's shape.
   * Runs from before that field existed still list their agents, ungrouped.
   */
  async reconstructSessionRuns(sessionId: string): Promise<ReconstructedRun[]> {
    this.assertEnabled()
    const [runs, sessionDirs] = await Promise.all([
      this.listRuns({ sessionId }),
      this.findSessionDirs(sessionId),
    ])
    const lifecycle = await this.readSessionWorkflowLifecycle(sessionId, sessionDirs)

    const byRunId = new Map<string, ReconstructedRun>()
    for (const run of runs) {
      byRunId.set(run.runId, {
        runId: run.runId,
        taskId: run.runId,
        workflowName: run.workflowName,
        status: run.status === 'unknown' ? 'running' : run.status,
        startedAt: run.startedAt,
        updatedAt: run.startedAt,
        agents: [],
      })
    }
    for (const launch of lifecycle.launchesByRunId.values()) {
      if (byRunId.has(launch.runId)) continue
      const startedAt = parseTimestamp(launch.timestamp) ?? 0
      byRunId.set(launch.runId, {
        runId: launch.runId,
        taskId: launch.taskId,
        ...(launch.ownerAgentId ? { ownerAgentId: launch.ownerAgentId } : {}),
        workflowName: launch.workflowName,
        status: 'running',
        startedAt,
        updatedAt: startedAt,
        agents: [],
      })
    }
    if (byRunId.size === 0) return []

    for (const { dir } of sessionDirs) {
      const subagentsDir = path.join(dir, 'subagents')
      await this.collectRunAgents(subagentsDir, byRunId)

      // Runs from before agents recorded their phase wrote their sidecars
      // into `subagents/workflows/<runId>/` instead. The directory name is
      // the only provenance they have, so those agents are recovered without
      // grouping rather than being dropped entirely.
      const legacyRoot = path.join(subagentsDir, 'workflows')
      let legacyRunIds: string[]
      try {
        legacyRunIds = await fs.readdir(legacyRoot)
      } catch {
        continue
      }
      for (const legacyRunId of legacyRunIds) {
        if (!byRunId.has(legacyRunId)) continue
        await this.collectRunAgents(
          path.join(legacyRoot, legacyRunId),
          byRunId,
          legacyRunId,
        )
      }
    }

    for (const run of byRunId.values()) {
      const launch = lifecycle.launchesByRunId.get(run.runId)
      if (launch) {
        run.taskId = launch.taskId
        if (launch.ownerAgentId) run.ownerAgentId = launch.ownerAgentId
        const launchedAt = parseTimestamp(launch.timestamp)
        if (launchedAt !== undefined) {
          run.startedAt = launchedAt
          run.updatedAt = launchedAt
        }
      }
      const terminal = launch
        ? this.findWorkflowTerminal(
            lifecycle.terminals,
            launch,
            lifecycle.launchesByRunId.values(),
          )
        : undefined
      if (terminal) {
        run.status = terminal.status
        const endedAt = parseTimestamp(terminal.timestamp)
        if (endedAt !== undefined) {
          run.updatedAt = endedAt
          run.endedAt = endedAt
        }
        if (terminal.result) run.result = terminal.result
        if (terminal.status === 'failed' || terminal.status === 'stopped') {
          run.error = terminal.summary
        }
      }

      const journal = await this.readJournalState(sessionId, run.runId)
      for (const agent of run.agents) {
        if (journal.resultAgentIds.has(agent.agentId)) {
          agent.state = 'done'
          continue
        }
        if (run.status === 'running') {
          agent.state = journal.startedAgentIds.has(agent.agentId) ? 'progress' : 'start'
          continue
        }
        if (run.status === 'completed') {
          // A caught agent failure or explicit skip can leave `started`
          // without `result` while the workflow itself still completes. The
          // optional task output is the only exact per-agent record; without
          // it, do not fabricate an error that the terminal transition denies.
          agent.state = 'done'
          agent.skipped = true
          continue
        }
        agent.state = 'error'
        agent.error = run.error
        if (run.status === 'stopped') agent.skipped = true
      }
      run.agents.sort((a, b) => a.agentIndex - b.agentIndex)
    }
    // A workflow can fail before its first agent is spawned. Its persisted
    // launch and terminal transition are still a real run, not a phantom.
    return [...byRunId.values()]
      .sort((a, b) => b.startedAt - a.startedAt)
  }

  async getAgentRunState(
    sessionId: string,
    agentId: string,
  ): Promise<{
    run: ReconstructedRun
    agent: ReconstructedRun['agents'][number]
  } | null> {
    const runs = await this.reconstructSessionRuns(sessionId)
    for (const run of runs) {
      const agent = run.agents.find(candidate => candidate.agentId === agentId)
      if (agent) return { run, agent }
    }
    return null
  }

  /**
   * Add every workflow agent sidecar in `dir` to the run it belongs to.
   *
   * `fallbackRunId` covers legacy layouts where provenance came from the
   * directory rather than the metadata; those agents land in phase 0 because
   * their phase was never recorded anywhere.
   */
  private async collectRunAgents(
    dir: string,
    byRunId: Map<string, ReconstructedRun>,
    fallbackRunId?: string,
  ): Promise<void> {
    let entries: string[]
    try {
      entries = await fs.readdir(dir)
    } catch {
      return
    }
    let fallbackIndex = 0
    for (const entry of entries) {
      if (!entry.endsWith('.meta.json')) continue
      let meta: {
        agentType?: string
        description?: string
        ownerAgentId?: string
        workflow?: {
          runId: string
          name: string
          phaseIndex: number
          phaseTitle?: string
          agentIndex: number
        }
      }
      try {
        meta = JSON.parse(await fs.readFile(path.join(dir, entry), 'utf8'))
      } catch {
        continue
      }
      const runId = meta.workflow?.runId ?? fallbackRunId
      if (!runId) continue
      const run = byRunId.get(runId)
      if (!run) continue
      if (meta.ownerAgentId && !run.ownerAgentId) {
        run.ownerAgentId = meta.ownerAgentId
      }
      const agentId = entry.replace(/^agent-/, '').replace(/\.meta\.json$/, '')
      if (run.agents.some(agent => agent.agentId === agentId)) continue
      fallbackIndex += 1
      run.agents.push({
        agentId,
        label:
          meta.description ??
          `agent ${meta.workflow?.agentIndex ?? fallbackIndex}`,
        phaseIndex: meta.workflow?.phaseIndex ?? 0,
        ...(meta.workflow?.phaseTitle
          ? { phaseTitle: meta.workflow.phaseTitle }
          : {}),
        agentIndex: meta.workflow?.agentIndex ?? fallbackIndex,
        state: 'start',
      })
    }
  }

  /** Every run whose script the CLI persisted, newest first. */
  async listRuns(options?: {
    sessionId?: string
    limit?: number
  }): Promise<WorkflowRunSummary[]> {
    this.assertEnabled()
    const runs: WorkflowRunSummary[] = []
    const [runDirs, sessionDirs] = await Promise.all([
      this.findRunDirs(options?.sessionId),
      this.findSessionDirs(options?.sessionId),
    ])
    for (const { sessionId, dir } of runDirs) {
      let entries: string[]
      try {
        entries = await fs.readdir(dir)
      } catch {
        continue
      }
      for (const entry of entries) {
        const match = RUN_SCRIPT_PATTERN.exec(entry)
        if (!match) continue
        const [, workflowName, runId] = match
        const scriptPath = path.join(dir, entry)
        let startedAt = 0
        try {
          startedAt = (await fs.stat(scriptPath)).mtimeMs
        } catch {
          continue
        }
        const journal = await this.readJournal(sessionId, runId!)
        runs.push({
          runId: runId!,
          sessionId,
          workflowName: workflowName!,
          scriptPath,
          startedAt,
          completedAgents: journal.length,
          status: 'unknown',
        })
      }
    }

    for (const sessionId of new Set(runs.map(run => run.sessionId))) {
      const scopedSessionDirs = sessionDirs.filter(sessionDir => sessionDir.sessionId === sessionId)
      const lifecycle = await this.readSessionWorkflowLifecycle(sessionId, scopedSessionDirs)
      for (const run of runs.filter(candidate => candidate.sessionId === sessionId)) {
        const launch = lifecycle.launchesByRunId.get(run.runId)
        const terminal = launch
          ? this.findWorkflowTerminal(
              lifecycle.terminals,
              launch,
              lifecycle.launchesByRunId.values(),
            )
          : undefined
        run.status = terminal?.status ?? 'running'
      }
    }
    runs.sort((a, b) => b.startedAt - a.startedAt)
    return options?.limit ? runs.slice(0, options.limit) : runs
  }

  async getRun(sessionId: string, runId: string): Promise<WorkflowRunDetail> {
    this.assertEnabled()
    const runs = await this.listRuns({ sessionId })
    const summary = runs.find(run => run.runId === runId)
    if (!summary) throw ApiError.notFound(`Unknown workflow run: ${runId}`)

    const script = await fs.readFile(summary.scriptPath, 'utf8')
    const parsed = parseWorkflowScript(script)
    const agents = await this.readJournal(sessionId, runId)

    return {
      ...summary,
      script,
      description: 'error' in parsed ? undefined : parsed.meta.description,
      phases: 'error' in parsed ? undefined : parsed.meta.phases,
      agents,
    }
  }

  /** `<projects>/<project>/<sessionId>/workflows` directories to scan. */
  private async findRunDirs(
    sessionId?: string,
  ): Promise<Array<{ sessionId: string; dir: string }>> {
    const found: Array<{ sessionId: string; dir: string }> = []
    for (const session of await this.findSessionDirs(sessionId)) {
      const dir = path.join(session.dir, 'workflows')
      try {
        if (!(await fs.stat(dir)).isDirectory()) continue
      } catch {
        continue
      }
      found.push({ sessionId: session.sessionId, dir })
    }
    return found
  }

  /** Session artifact directories, including transcript-only workflow runs. */
  private async findSessionDirs(
    sessionId?: string,
  ): Promise<Array<{ sessionId: string; dir: string }>> {
    const projectsDir = this.projectsDir()
    let projects: string[]
    try {
      projects = await fs.readdir(projectsDir)
    } catch {
      return []
    }

    const found = new Map<string, { sessionId: string; dir: string }>()
    for (const project of projects) {
      const projectPath = path.join(projectsDir, project)
      let entries: string[]
      try {
        entries = await fs.readdir(projectPath)
      } catch {
        continue
      }

      const candidates = sessionId
        ? entries.some(entry => entry === sessionId || entry === `${sessionId}.jsonl`)
          ? [sessionId]
          : []
        : [...new Set(entries.flatMap((entry) => (
            entry.endsWith('.jsonl') ? [entry.slice(0, -'.jsonl'.length)] : [entry]
          )))]
      for (const candidate of candidates) {
        const dir = path.join(projectPath, candidate)
        const transcriptPath = path.join(projectPath, `${candidate}.jsonl`)
        const hasArtifacts = await fs.stat(dir).then(stat => stat.isDirectory()).catch(() => false)
        const hasTranscript = await fs.stat(transcriptPath).then(stat => stat.isFile()).catch(() => false)
        if (!hasArtifacts && !hasTranscript) continue
        found.set(`${project}\0${candidate}`, { sessionId: candidate, dir })
      }
    }
    return [...found.values()]
  }

  private async readSessionWorkflowLifecycle(
    sessionId: string,
    sessionDirs: Array<{ sessionId: string; dir: string }>,
  ): Promise<PersistedWorkflowLifecycle> {
    const lifecycle: PersistedWorkflowLifecycle = {
      launchesByRunId: new Map(),
      terminals: [],
    }
    const files: Array<{ filePath: string; ownerAgentId?: string; modifiedAt: number }> = []

    for (const session of sessionDirs) {
      const projectDir = path.dirname(session.dir)
      files.push({
        filePath: path.join(projectDir, `${sessionId}.jsonl`),
        modifiedAt: 0,
      })
      const subagentsDir = path.join(session.dir, 'subagents')
      let entries: string[]
      try {
        entries = await fs.readdir(subagentsDir)
      } catch {
        continue
      }
      for (const entry of entries.filter(name => /^agent-.+\.jsonl$/.test(name))) {
        const filePath = path.join(subagentsDir, entry)
        const modifiedAt = await fs.stat(filePath).then(stat => stat.mtimeMs).catch(() => 0)
        files.push({
          filePath,
          ownerAgentId: entry.replace(/^agent-/, '').replace(/\.jsonl$/, ''),
          modifiedAt,
        })
      }
    }

    const seenPaths = new Set<string>()
    for (const file of files.sort((left, right) => left.modifiedAt - right.modifiedAt)) {
      if (seenPaths.has(file.filePath)) continue
      seenPaths.add(file.filePath)
      let raw: string
      try {
        raw = await fs.readFile(file.filePath, 'utf8')
      } catch {
        continue
      }
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue
        let entry: Record<string, unknown>
        try {
          const parsed = JSON.parse(line)
          if (!isObjectRecord(parsed)) continue
          entry = parsed
        } catch {
          continue
        }
        this.collectWorkflowLifecycleEntry(entry, file.ownerAgentId, lifecycle)
      }
    }
    return lifecycle
  }

  private collectWorkflowLifecycleEntry(
    entry: Record<string, unknown>,
    transcriptOwnerAgentId: string | undefined,
    lifecycle: PersistedWorkflowLifecycle,
  ): void {
    const timestamp = nonEmptyString(entry.timestamp)
    const message = isObjectRecord(entry.message) ? entry.message : undefined
    const blocks = Array.isArray(message?.content) ? message.content : []
    const resultBlock = blocks.find(block => (
      isObjectRecord(block) && block.type === 'tool_result'
    ))
    const toolUseId = isObjectRecord(resultBlock)
      ? nonEmptyString(resultBlock.tool_use_id)
      : undefined
    const launchCandidates = [
      entry.toolUseResult,
      ...blocks.flatMap(block => (
        isObjectRecord(block) && block.type === 'tool_result' ? [block.content] : []
      )),
    ]
    for (const candidate of launchCandidates) {
      const launch = workflowLaunchFromValue(candidate, {
        ...(transcriptOwnerAgentId ? { ownerAgentId: transcriptOwnerAgentId } : {}),
        ...(timestamp ? { timestamp } : {}),
        ...(toolUseId ? { toolUseId } : {}),
      })
      if (!launch) continue
      const existing = lifecycle.launchesByRunId.get(launch.runId)
      const existingAt = parseTimestamp(existing?.timestamp) ?? Number.NEGATIVE_INFINITY
      const launchAt = parseTimestamp(launch.timestamp) ?? Number.NEGATIVE_INFINITY
      if (!existing || launchAt > existingAt) {
        lifecycle.launchesByRunId.set(launch.runId, launch)
      }
    }

    const persisted = entry.type === 'cc-haha-task-notification' &&
      isObjectRecord(entry.taskNotification)
      ? entry.taskNotification
      : undefined
    if (persisted) {
      const status = normalizePersistedStatus(persisted.status)
      const taskId = nonEmptyString(persisted.taskId)
      if (status && taskId) {
        lifecycle.terminals.push({
          taskId,
          ...(nonEmptyString(persisted.toolUseId)
            ? { toolUseId: nonEmptyString(persisted.toolUseId) }
            : {}),
          ...(nonEmptyString(persisted.ownerAgentId) ?? transcriptOwnerAgentId
            ? { ownerAgentId: nonEmptyString(persisted.ownerAgentId) ?? transcriptOwnerAgentId }
            : {}),
          status,
          ...(nonEmptyString(persisted.summary) ? { summary: nonEmptyString(persisted.summary) } : {}),
          ...(stringifyResult(persisted.result) ? { result: stringifyResult(persisted.result) } : {}),
          ...(nonEmptyString(persisted.outputFile)
            ? { outputFile: nonEmptyString(persisted.outputFile) }
            : {}),
          ...(nonEmptyString(persisted.timestamp) ?? timestamp
            ? { timestamp: nonEmptyString(persisted.timestamp) ?? timestamp }
            : {}),
        })
      }
    }

    for (const text of stringsInValue(message?.content)) {
      if (!text.includes('<task-notification>')) continue
      const status = normalizePersistedStatus(xmlValue(text, 'status'))
      const taskId = xmlValue(text, 'task-id')
      if (!status || !taskId) continue
      lifecycle.terminals.push({
        taskId,
        ...(xmlValue(text, 'tool-use-id') ? { toolUseId: xmlValue(text, 'tool-use-id') } : {}),
        ...(transcriptOwnerAgentId ? { ownerAgentId: transcriptOwnerAgentId } : {}),
        status,
        ...(decodeXml(xmlValue(text, 'summary')) ? { summary: decodeXml(xmlValue(text, 'summary')) } : {}),
        ...(decodeXml(xmlValue(text, 'result')) ? { result: decodeXml(xmlValue(text, 'result')) } : {}),
        ...(decodeXml(xmlValue(text, 'output-file'))
          ? { outputFile: decodeXml(xmlValue(text, 'output-file')) }
          : {}),
        ...(timestamp ? { timestamp } : {}),
      })
    }
  }

  private findWorkflowTerminal(
    terminals: PersistedWorkflowTerminal[],
    launch: PersistedWorkflowLaunch,
    launches: Iterable<PersistedWorkflowLaunch>,
  ): PersistedWorkflowTerminal | undefined {
    const launchAt = parseTimestamp(launch.timestamp)
    const nextLaunchAt = [...launches]
      .filter(candidate => (
        candidate.runId !== launch.runId &&
        candidate.taskId === launch.taskId &&
        candidate.ownerAgentId === launch.ownerAgentId &&
        (!launch.toolUseId || !candidate.toolUseId || candidate.toolUseId === launch.toolUseId)
      ))
      .map(candidate => parseTimestamp(candidate.timestamp))
      .filter((timestamp): timestamp is number => (
        timestamp !== undefined && (launchAt === undefined || timestamp > launchAt)
      ))
      .sort((left, right) => left - right)[0]
    const exact = terminals.filter((terminal) => {
      const terminalAt = parseTimestamp(terminal.timestamp)
      return terminal.taskId === launch.taskId &&
        terminal.ownerAgentId === launch.ownerAgentId &&
        (!launch.toolUseId || !terminal.toolUseId || terminal.toolUseId === launch.toolUseId) &&
        (launchAt === undefined || terminalAt === undefined || terminalAt >= launchAt) &&
        (nextLaunchAt === undefined || terminalAt === undefined || terminalAt < nextLaunchAt)
    })
    return exact
      .sort((left, right) => (
        (parseTimestamp(right.timestamp) ?? 0) - (parseTimestamp(left.timestamp) ?? 0)
      ))[0]
  }

  private async readJournalState(
    sessionId: string,
    runId: string,
  ): Promise<WorkflowJournalState> {
    const state: WorkflowJournalState = {
      resultAgentIds: new Set(),
      startedAgentIds: new Set(),
    }
    for (const session of await this.findSessionDirs(sessionId)) {
      const journalPath = path.join(
        session.dir,
        'subagents',
        'workflows',
        runId,
        'journal.jsonl',
      )
      let raw: string
      try {
        raw = await fs.readFile(journalPath, 'utf8')
      } catch {
        continue
      }
      for (const line of raw.split('\n')) {
        try {
          const entry = JSON.parse(line) as { type?: string; agentId?: string }
          if (!entry.agentId) continue
          if (entry.type === 'started') state.startedAgentIds.add(entry.agentId)
          if (entry.type === 'result') state.resultAgentIds.add(entry.agentId)
        } catch {
          // A partially written tail does not invalidate earlier transitions.
        }
      }
    }
    return state
  }

  private async readJournal(
    sessionId: string,
    runId: string,
  ): Promise<Array<{ key: string; agentId: string; result: unknown }>> {
    const dirs = await this.findRunDirs(sessionId)
    for (const { dir } of dirs) {
      const journalPath = path.join(
        path.dirname(dir),
        'subagents',
        'workflows',
        runId,
        'journal.jsonl',
      )
      let raw: string
      try {
        raw = await fs.readFile(journalPath, 'utf8')
      } catch {
        continue
      }
      const results: Array<{ key: string; agentId: string; result: unknown }> = []
      for (const line of raw.split('\n')) {
        if (line.trim() === '') continue
        try {
          const entry = JSON.parse(line) as {
            type: string
            key: string
            agentId: string
            result?: unknown
          }
          if (entry.type !== 'result') continue
          results.push({
            // The raw key chains every prior prompt; hash it so the API stays
            // small and does not leak the whole prompt history.
            key: createHash('sha256').update(entry.key).digest('hex').slice(0, 12),
            agentId: entry.agentId,
            result: entry.result,
          })
        } catch {
          continue
        }
      }
      return results
    }
    return []
  }

  private async assertNotSymlink(filePath: string): Promise<void> {
    try {
      const stats = await fs.lstat(filePath)
      if (stats.isSymbolicLink()) {
        throw ApiError.badRequest(
          `Refusing to write through a symlink: ${filePath}`,
        )
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
  }

  private assertEnabled(): void {
    if (!areWorkflowsEnabled()) {
      throw new ApiError(
        403,
        'Dynamic workflows are disabled (`disableWorkflows`).',
        'WORKFLOWS_DISABLED',
      )
    }
  }
}

export const workflowService = new WorkflowService()
