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
