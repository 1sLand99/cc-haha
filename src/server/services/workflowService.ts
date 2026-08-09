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
  status: 'completed' | 'failed' | 'unknown'
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

/** A finished run rebuilt from disk, in the shape the desktop's panel needs. */
export type ReconstructedRun = {
  runId: string
  workflowName: string
  startedAt: number
  agents: Array<{
    agentId: string
    label: string
    phaseIndex: number
    phaseTitle?: string
    agentIndex: number
  }>
}

export type WorkflowSaveScope = 'user' | 'project'

const RUN_SCRIPT_PATTERN = /^(.+)\.(wf_[a-z0-9-]{6,})\.js$/

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
    const runs = await this.listRuns({ sessionId })
    if (runs.length === 0) return []

    const byRunId = new Map<string, ReconstructedRun>()
    for (const run of runs) {
      byRunId.set(run.runId, {
        runId: run.runId,
        workflowName: run.workflowName,
        startedAt: run.startedAt,
        agents: [],
      })
    }

    for (const { dir } of await this.findRunDirs(sessionId)) {
      // `dir` is the session's `workflows/` script directory; the agent
      // sidecars are its sibling `subagents/`.
      const subagentsDir = path.join(path.dirname(dir), 'subagents')
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
      run.agents.sort((a, b) => a.agentIndex - b.agentIndex)
    }
    // Only runs we could actually rebuild agents for are worth returning; an
    // empty shell would render as a phantom section.
    return [...byRunId.values()]
      .filter(run => run.agents.length > 0)
      .sort((a, b) => b.startedAt - a.startedAt)
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
    for (const { sessionId, dir } of await this.findRunDirs(options?.sessionId)) {
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
    const projectsDir = this.projectsDir()
    let projects: string[]
    try {
      projects = await fs.readdir(projectsDir)
    } catch {
      return []
    }

    const found: Array<{ sessionId: string; dir: string }> = []
    for (const project of projects) {
      const projectPath = path.join(projectsDir, project)
      let sessions: string[]
      try {
        sessions = await fs.readdir(projectPath)
      } catch {
        continue
      }
      for (const entry of sessions) {
        if (sessionId && entry !== sessionId) continue
        const dir = path.join(projectPath, entry, 'workflows')
        try {
          if (!(await fs.stat(dir)).isDirectory()) continue
        } catch {
          continue
        }
        found.push({ sessionId: entry, dir })
      }
    }
    return found
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
