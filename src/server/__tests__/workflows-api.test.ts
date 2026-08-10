import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'
import { handleWorkflowsApi } from '../api/workflows.js'

let tmpHome: string
let projectDir: string
let originalConfigDir: string | undefined

function request(
  urlStr: string,
  init?: { method?: string; body?: unknown },
): { req: Request; url: URL; segments: string[] } {
  const url = new URL(urlStr, 'http://localhost:3456')
  const req = new Request(url.toString(), {
    method: init?.method ?? 'GET',
    ...(init?.body !== undefined
      ? {
          body: JSON.stringify(init.body),
          headers: { 'content-type': 'application/json' },
        }
      : {}),
  })
  return { req, url, segments: url.pathname.split('/').filter(Boolean) }
}

function call(
  urlStr: string,
  init?: { method?: string; body?: unknown },
): Promise<Response> {
  const { req, url, segments } = request(urlStr, init)
  return handleWorkflowsApi(req, url, segments)
}

const VALID_SCRIPT = [
  "export const meta = { name: 'my-audit', description: 'Audit the routes', phases: [{ title: 'Scan' }] }",
  "const out = await agent('scan')",
  'return out',
].join('\n')

describe('Workflows API', () => {
  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'wf-api-'))
    projectDir = path.join(tmpHome, 'project')
    await fs.mkdir(path.join(projectDir, '.git'), { recursive: true })
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = path.join(tmpHome, 'claude')
    resetSettingsCache()
  })

  afterEach(async () => {
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    resetSettingsCache()
    await fs.rm(tmpHome, { recursive: true, force: true })
  })

  it('lists the bundled workflow', async () => {
    const response = await call(`/api/workflows?cwd=${encodeURIComponent(projectDir)}`)
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      workflows: Array<{ name: string; source: string; phases?: unknown[] }>
    }
    const deepResearch = body.workflows.find(w => w.name === 'deep-research')
    expect(deepResearch?.source).toBe('built-in')
    expect(deepResearch?.phases?.length).toBeGreaterThan(0)
    // The list stays small: no script bodies.
    expect(body.workflows.every(w => !('script' in w) || w.script === undefined)).toBe(true)
  })

  it('returns the script on the detail endpoint', async () => {
    const response = await call(
      `/api/workflows/deep-research?cwd=${encodeURIComponent(projectDir)}`,
    )
    const body = (await response.json()) as { script?: string }
    expect(body.script).toContain('export const meta')
  })

  it('validates a script without running it', async () => {
    const ok = await (
      await call('/api/workflows/validate', {
        method: 'POST',
        body: { script: VALID_SCRIPT },
      })
    ).json()
    expect(ok).toMatchObject({ ok: true, name: 'my-audit' })

    const nondeterministic = await (
      await call('/api/workflows/validate', {
        method: 'POST',
        body: {
          script:
            "export const meta = { name: 'x', description: 'y' }\nconst t = Date.now()\nreturn t\n",
        },
      })
    ).json()
    expect(nondeterministic).toMatchObject({ ok: true })
    expect((nondeterministic as { warnings: string[] }).warnings[0]).toContain(
      'Date.now()',
    )

    const bad = await (
      await call('/api/workflows/validate', {
        method: 'POST',
        body: { script: 'const x = 1\n' },
      })
    ).json()
    expect(bad).toMatchObject({ ok: false })
    expect((bad as { error: string }).error).toContain('FIRST statement')
  })

  it('saves a workflow and then lists and deletes it', async () => {
    const saved = await (
      await call('/api/workflows/save', {
        method: 'POST',
        body: { script: VALID_SCRIPT, scope: 'project', cwd: projectDir },
      })
    ).json()
    expect(saved).toMatchObject({ ok: true, name: 'my-audit' })
    expect((saved as { filePath: string }).filePath).toBe(
      path.join(projectDir, '.claude', 'workflows', 'my-audit.js'),
    )

    const listed = (await (
      await call(`/api/workflows?cwd=${encodeURIComponent(projectDir)}`)
    ).json()) as { workflows: Array<{ name: string; source: string }> }
    expect(
      listed.workflows.find(w => w.name === 'my-audit')?.source,
    ).toBe('projectSettings')

    const deleted = await call(
      `/api/workflows/my-audit?scope=project&cwd=${encodeURIComponent(projectDir)}`,
      { method: 'DELETE' },
    )
    expect(deleted.status).toBe(200)
    const after = (await (
      await call(`/api/workflows?cwd=${encodeURIComponent(projectDir)}`)
    ).json()) as { workflows: Array<{ name: string }> }
    expect(after.workflows.find(w => w.name === 'my-audit')).toBeUndefined()
  })

  it('rejects saving a script that does not compile', async () => {
    const response = await call('/api/workflows/save', {
      method: 'POST',
      body: {
        script:
          "export const meta = { name: 'broken', description: 'x' }\nconst a: string = 1\n",
        scope: 'user',
      },
    })
    expect(response.status).toBe(400)
  })

  it('reconstructs a past run from its script and journal', async () => {
    const sessionId = '11111111-2222-3333-4444-555555555555'
    const sessionDir = path.join(
      tmpHome,
      'claude',
      'projects',
      '-tmp-project',
      sessionId,
    )
    await fs.mkdir(path.join(sessionDir, 'workflows'), { recursive: true })
    await fs.writeFile(
      path.join(sessionDir, 'workflows', 'my-audit.wf_abc12345-def.js'),
      VALID_SCRIPT,
      'utf8',
    )
    const journalDir = path.join(
      sessionDir,
      'subagents',
      'workflows',
      'wf_abc12345-def',
    )
    await fs.mkdir(journalDir, { recursive: true })
    await fs.writeFile(
      path.join(journalDir, 'journal.jsonl'),
      [
        JSON.stringify({ type: 'started', key: '|scan|null', agentId: 'a1' }),
        JSON.stringify({
          type: 'result',
          key: '|scan|null',
          agentId: 'a1',
          result: 'found nothing',
        }),
        'not json at all',
      ].join('\n'),
      'utf8',
    )

    const runs = (await (await call('/api/workflows/runs')).json()) as {
      runs: Array<{ runId: string; workflowName: string; completedAgents: number }>
    }
    expect(runs.runs).toHaveLength(1)
    expect(runs.runs[0]).toMatchObject({
      runId: 'wf_abc12345-def',
      workflowName: 'my-audit',
      completedAgents: 1,
    })

    const detail = (await (
      await call(`/api/workflows/runs/${sessionId}/wf_abc12345-def`)
    ).json()) as {
      script: string
      description?: string
      agents: Array<{ agentId: string; result: unknown; key: string }>
    }
    expect(detail.script).toBe(VALID_SCRIPT)
    expect(detail.description).toBe('Audit the routes')
    expect(detail.agents).toHaveLength(1)
    expect(detail.agents[0]?.result).toBe('found nothing')
    // The raw journal key chains every prior prompt — the API must not leak it.
    expect(detail.agents[0]?.key).not.toContain('scan')
  })

  it('restores root and agent-owned run status from persisted lifecycle transitions', async () => {
    const sessionId = '77777777-2222-3333-4444-555555555555'
    const configProjectDir = path.join(tmpHome, 'claude', 'projects', '-tmp-project')
    const sessionDir = path.join(configProjectDir, sessionId)
    const workflowsDir = path.join(sessionDir, 'workflows')
    const subagentsDir = path.join(sessionDir, 'subagents')
    await fs.mkdir(workflowsDir, { recursive: true })
    await fs.mkdir(subagentsDir, { recursive: true })

    const definitions = [
      { runId: 'wf_complete-123', taskId: 'task-complete', name: 'complete-run', agentId: 'worker-complete', ownerAgentId: undefined },
      { runId: 'wf_failed-123', taskId: 'task-failed', name: 'failed-run', agentId: 'worker-failed', ownerAgentId: 'owner-fragment-a' },
      { runId: 'wf_stopped-123', taskId: 'task-stopped', name: 'stopped-run', agentId: 'worker-stopped', ownerAgentId: 'owner-fragment-a' },
      { runId: 'wf_running-123', taskId: 'task-running', name: 'running-run', agentId: 'worker-running', ownerAgentId: undefined },
      { runId: 'wf_owner-running-123', taskId: 'task-failed', name: 'owner-running-run', agentId: 'worker-owner-running', ownerAgentId: 'owner-fragment-b' },
    ]
    for (const [index, definition] of definitions.entries()) {
      await fs.writeFile(
        path.join(workflowsDir, `${definition.name}.${definition.runId}.js`),
        VALID_SCRIPT,
        'utf8',
      )
      await fs.writeFile(
        path.join(subagentsDir, `agent-${definition.agentId}.meta.json`),
        JSON.stringify({
          agentType: 'general-purpose',
          workflow: {
            runId: definition.runId,
            name: definition.name,
            phaseIndex: 1,
            phaseTitle: 'Review',
            agentIndex: index + 1,
          },
        }),
        'utf8',
      )
      const journalDir = path.join(subagentsDir, 'workflows', definition.runId)
      await fs.mkdir(journalDir, { recursive: true })
      await fs.writeFile(
        path.join(journalDir, 'journal.jsonl'),
        `${JSON.stringify({ type: 'started', key: `key-${index}`, agentId: definition.agentId })}\n${
          definition.runId === 'wf_complete-123'
            ? `${JSON.stringify({ type: 'result', key: `key-${index}`, agentId: definition.agentId, result: 'ok' })}\n`
            : ''
        }`,
        'utf8',
      )
    }
    await fs.writeFile(
      path.join(subagentsDir, 'agent-worker-caught.meta.json'),
      JSON.stringify({
        agentType: 'general-purpose',
        workflow: {
          runId: definitions[0]!.runId,
          name: definitions[0]!.name,
          phaseIndex: 1,
          phaseTitle: 'Review',
          agentIndex: definitions.length + 1,
        },
      }),
      'utf8',
    )
    await fs.appendFile(
      path.join(subagentsDir, 'workflows', definitions[0]!.runId, 'journal.jsonl'),
      `${JSON.stringify({ type: 'started', key: 'key-caught', agentId: 'worker-caught' })}\n`,
      'utf8',
    )

    const launchEntry = (
      definition: typeof definitions[number],
      timestamp: string,
    ) => ({
      type: 'user',
      uuid: `launch-${definition.taskId}`,
      timestamp,
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: `tool-${definition.taskId}`,
          content: JSON.stringify({
            status: 'async_launched',
            taskId: definition.taskId,
            taskType: 'local_workflow',
            workflowName: definition.name,
            runId: definition.runId,
          }),
        }],
      },
    })
    const terminalEntry = (
      definition: typeof definitions[number],
      status: 'completed' | 'failed' | 'stopped',
      timestamp: string,
    ) => ({
      type: 'cc-haha-task-notification',
      isMeta: true,
      timestamp,
      taskNotification: {
        taskId: definition.taskId,
        toolUseId: `tool-${definition.taskId}`,
        ...(definition.ownerAgentId ? { ownerAgentId: definition.ownerAgentId } : {}),
        status,
        summary: `${definition.name} ${status}`,
        timestamp,
      },
    })

    await fs.writeFile(
      path.join(configProjectDir, `${sessionId}.jsonl`),
      [
        launchEntry(definitions[0]!, '2026-01-01T00:00:01.000Z'),
        terminalEntry(definitions[0]!, 'completed', '2026-01-01T00:00:02.000Z'),
        launchEntry(definitions[3]!, '2026-01-01T00:00:07.000Z'),
        terminalEntry(definitions[1]!, 'failed', '2026-01-01T00:00:04.000Z'),
        terminalEntry(definitions[2]!, 'stopped', '2026-01-01T00:00:06.000Z'),
      ].map(entry => JSON.stringify(entry)).join('\n') + '\n',
      'utf8',
    )
    await fs.writeFile(
      path.join(subagentsDir, 'agent-owner-fragment-a.jsonl'),
      [
        launchEntry(definitions[1]!, '2026-01-01T00:00:03.000Z'),
        launchEntry(definitions[2]!, '2026-01-01T00:00:05.000Z'),
      ].map(entry => JSON.stringify(entry)).join('\n') + '\n',
      'utf8',
    )
    await fs.writeFile(
      path.join(subagentsDir, 'agent-owner-fragment-b.jsonl'),
      `${JSON.stringify(launchEntry(definitions[4]!, '2026-01-01T00:00:08.000Z'))}\n`,
      'utf8',
    )

    const response = await call(`/api/workflows/session-runs/${sessionId}`)
    expect(response.status).toBe(200)
    const body = await response.json() as {
      runs: Array<{
        runId: string
        taskId: string
        ownerAgentId?: string
        status: string
        agents: Array<{ agentId: string; state: string; skipped?: boolean }>
      }>
    }
    const byRunId = new Map(body.runs.map(run => [run.runId, run]))
    expect(byRunId.get('wf_complete-123')).toMatchObject({
      taskId: 'task-complete',
      status: 'completed',
    })
    expect(byRunId.get('wf_complete-123')?.agents).toContainEqual(expect.objectContaining({
      agentId: 'worker-complete',
      state: 'done',
    }))
    expect(byRunId.get('wf_complete-123')?.agents).toContainEqual(expect.objectContaining({
      agentId: 'worker-caught',
      state: 'done',
      skipped: true,
    }))
    expect(byRunId.get('wf_failed-123')).toMatchObject({
      taskId: 'task-failed',
      ownerAgentId: 'owner-fragment-a',
      status: 'failed',
      agents: [{ state: 'error' }],
    })
    expect(byRunId.get('wf_stopped-123')).toMatchObject({
      taskId: 'task-stopped',
      ownerAgentId: 'owner-fragment-a',
      status: 'stopped',
      agents: [{ state: 'error', skipped: true }],
    })
    expect(byRunId.get('wf_running-123')).toMatchObject({
      taskId: 'task-running',
      status: 'running',
      agents: [{ state: 'progress' }],
    })
    expect(byRunId.get('wf_owner-running-123')).toMatchObject({
      taskId: 'task-failed',
      ownerAgentId: 'owner-fragment-b',
      status: 'running',
      agents: [{ state: 'progress' }],
    })
  })

  it('404s an unknown run', async () => {
    const response = await call('/api/workflows/runs/nope/wf_000000-aaa')
    expect(response.status).toBe(404)
  })

  it('refuses to write through a symlinked target', async () => {
    const workflowsDir = path.join(tmpHome, 'claude', 'workflows')
    await fs.mkdir(workflowsDir, { recursive: true })
    const outside = path.join(tmpHome, 'outside.js')
    await fs.writeFile(outside, '// pre-existing\n', 'utf8')
    await fs.symlink(outside, path.join(workflowsDir, 'my-audit.js'))

    const response = await call('/api/workflows/save', {
      method: 'POST',
      body: { script: VALID_SCRIPT, scope: 'user' },
    })
    expect(response.status).toBe(400)
    expect(await fs.readFile(outside, 'utf8')).toBe('// pre-existing\n')
  })

  it('403s every route when workflows are disabled', async () => {
    await fs.mkdir(path.join(tmpHome, 'claude'), { recursive: true })
    await fs.writeFile(
      path.join(tmpHome, 'claude', 'settings.json'),
      JSON.stringify({ disableWorkflows: true }),
      'utf8',
    )
    resetSettingsCache()

    expect((await call('/api/workflows')).status).toBe(403)
    expect((await call('/api/workflows/runs')).status).toBe(403)
  })
})
