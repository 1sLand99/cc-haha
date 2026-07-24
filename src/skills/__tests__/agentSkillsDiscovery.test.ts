/**
 * End-to-end discovery behavior for the cross-client `.agents/skills`
 * convention, exercised through the same entry point the model sees.
 *
 * The regression half of this file matters as much as the new-behavior half:
 * adding a second root must not disturb how `.claude/skills` already resolves.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { getCwdState, setCwdState } from '../../bootstrap/state.js'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'
import { clearSkillCaches, getSkillDirCommands } from '../loadSkillsDir.js'

let tmpHome: string
let originalHome: string | undefined
let originalUserProfile: string | undefined
let originalClaudeConfigDir: string | undefined
let originalDisableEnv: string | undefined
let originalCwdState: string

async function writeSkill(
  root: string,
  name: string,
  description: string,
): Promise<string> {
  const skillDir = path.join(root, name)
  await fs.mkdir(skillDir, { recursive: true })
  const file = path.join(skillDir, 'SKILL.md')
  await fs.writeFile(
    file,
    ['---', `description: ${description}`, '---', '', `# ${name}`].join('\n'),
    'utf-8',
  )
  return skillDir
}

async function loadSkillNames(cwd: string): Promise<string[]> {
  clearSkillCaches()
  const commands = await getSkillDirCommands(cwd)
  return commands.map(c => c.name)
}

function claudeSkillsDir(): string {
  return path.join(tmpHome, '.claude', 'skills')
}

function agentsSkillsDir(): string {
  return path.join(tmpHome, '.agents', 'skills')
}

async function makeRepo(name = 'repo'): Promise<string> {
  const repo = path.join(tmpHome, name)
  await fs.mkdir(path.join(repo, '.git'), { recursive: true })
  return repo
}

/**
 * A cwd that contributes no project roots of its own, so a test sees only the
 * user-level roots. The `.git` marker stops the upward walk immediately.
 */
async function userScopeCwd(): Promise<string> {
  return makeRepo('workspace-without-skills')
}

describe('.agents/skills discovery', () => {
  beforeEach(async () => {
    tmpHome = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'agent-skills-test-')),
    )
    originalHome = process.env.HOME
    originalUserProfile = process.env.USERPROFILE
    originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR
    originalDisableEnv = process.env.CLAUDE_CODE_DISABLE_AGENT_SKILLS_DIR
    originalCwdState = getCwdState()

    process.env.HOME = tmpHome
    process.env.USERPROFILE = tmpHome
    process.env.CLAUDE_CONFIG_DIR = path.join(tmpHome, '.claude')
    delete process.env.CLAUDE_CODE_DISABLE_AGENT_SKILLS_DIR
    setCwdState(tmpHome)
    resetSettingsCache()
    clearSkillCaches()
  })

  afterEach(async () => {
    for (const [key, value] of [
      ['HOME', originalHome],
      ['USERPROFILE', originalUserProfile],
      ['CLAUDE_CONFIG_DIR', originalClaudeConfigDir],
      ['CLAUDE_CODE_DISABLE_AGENT_SKILLS_DIR', originalDisableEnv],
    ] as const) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    setCwdState(originalCwdState)
    resetSettingsCache()
    clearSkillCaches()
    await fs.rm(tmpHome, { recursive: true, force: true })
  })

  describe('new discovery', () => {
    it('finds a user skill installed by another tool in ~/.agents/skills', async () => {
      await writeSkill(agentsSkillsDir(), 'codex-installed', 'From Codex')

      expect(await loadSkillNames(await userScopeCwd())).toContain('codex-installed')
    })

    it('finds a project skill in .agents/skills', async () => {
      const repo = await makeRepo()
      await writeSkill(path.join(repo, '.agents', 'skills'), 'repo-shared', 'Team skill')

      expect(await loadSkillNames(repo)).toContain('repo-shared')
    })

    it('finds .agents skills in parent directories up to the repo root', async () => {
      const repo = await makeRepo()
      const pkg = path.join(repo, 'packages', 'app')
      await fs.mkdir(pkg, { recursive: true })
      await writeSkill(path.join(repo, '.agents', 'skills'), 'root-level', 'Root')
      await writeSkill(path.join(pkg, '.agents', 'skills'), 'pkg-level', 'Package')

      const names = await loadSkillNames(pkg)

      expect(names).toContain('root-level')
      expect(names).toContain('pkg-level')
    })

    it('loads both conventions side by side when names differ', async () => {
      await writeSkill(claudeSkillsDir(), 'native-skill', 'Native')
      await writeSkill(agentsSkillsDir(), 'shared-skill', 'Shared')

      const names = await loadSkillNames(await userScopeCwd())

      expect(names).toContain('native-skill')
      expect(names).toContain('shared-skill')
    })
  })

  describe('same-name collisions', () => {
    it('keeps the .claude copy when both directories hold a distinct file', async () => {
      // The copy-based sync case: two real files, so realpath dedup can't help.
      await writeSkill(claudeSkillsDir(), 'dup', 'The claude one')
      await writeSkill(agentsSkillsDir(), 'dup', 'The agents one')

      clearSkillCaches()
      const commands = await getSkillDirCommands(await userScopeCwd())
      const matches = commands.filter(c => c.name === 'dup')

      expect(matches).toHaveLength(1)
      expect(matches[0]!.description).toBe('The claude one')
    })

    it('reports a symlinked skill once', async () => {
      // The symlink-based sync case, caught by the pre-existing realpath dedup.
      const target = await writeSkill(agentsSkillsDir(), 'linked', 'Linked skill')
      await fs.mkdir(claudeSkillsDir(), { recursive: true })
      await fs.symlink(
        target,
        path.join(claudeSkillsDir(), 'linked'),
        process.platform === 'win32' ? 'junction' : 'dir',
      )

      clearSkillCaches()
      const commands = await getSkillDirCommands(await userScopeCwd())

      expect(commands.filter(c => c.name === 'linked')).toHaveLength(1)
    })

    it('collides within one project level but not across levels', async () => {
      const repo = await makeRepo()
      const pkg = path.join(repo, 'packages', 'app')
      await fs.mkdir(pkg, { recursive: true })
      await writeSkill(path.join(pkg, '.claude', 'skills'), 'build', 'Package claude')
      await writeSkill(path.join(pkg, '.agents', 'skills'), 'build', 'Package agents')
      await writeSkill(path.join(repo, '.claude', 'skills'), 'build', 'Repo claude')

      clearSkillCaches()
      const commands = await getSkillDirCommands(pkg)
      const descriptions = commands.filter(c => c.name === 'build').map(c => c.description)

      // The two spellings inside `pkg` collapse to the .claude one; the
      // repo-root entry is a separate scope and survives, as it always has.
      expect(descriptions).toEqual(['Package claude', 'Repo claude'])
    })
  })

  describe('opt-out', () => {
    it('ignores .agents entirely when disabled', async () => {
      process.env.CLAUDE_CODE_DISABLE_AGENT_SKILLS_DIR = '1'
      await writeSkill(claudeSkillsDir(), 'native-skill', 'Native')
      await writeSkill(agentsSkillsDir(), 'shared-skill', 'Shared')

      const names = await loadSkillNames(await userScopeCwd())

      expect(names).toContain('native-skill')
      expect(names).not.toContain('shared-skill')
    })

    it('restores the .agents copy of a colliding name only when .claude lacks it', async () => {
      process.env.CLAUDE_CODE_DISABLE_AGENT_SKILLS_DIR = '1'
      await writeSkill(agentsSkillsDir(), 'only-in-agents', 'Shared')
      const cwd = await userScopeCwd()

      expect(await loadSkillNames(cwd)).not.toContain('only-in-agents')

      delete process.env.CLAUDE_CODE_DISABLE_AGENT_SKILLS_DIR
      expect(await loadSkillNames(cwd)).toContain('only-in-agents')
    })
  })

  describe('regressions', () => {
    it('still loads user and project .claude skills', async () => {
      const repo = await makeRepo()
      await writeSkill(claudeSkillsDir(), 'user-skill', 'User')
      await writeSkill(path.join(repo, '.claude', 'skills'), 'project-skill', 'Project')

      const names = await loadSkillNames(repo)

      expect(names).toContain('user-skill')
      expect(names).toContain('project-skill')
    })

    it('keeps a user and a project skill that share a name', async () => {
      // Different scopes — this has always produced two entries and must keep
      // doing so now that same-scope dedup exists.
      const repo = await makeRepo()
      await writeSkill(claudeSkillsDir(), 'shared-name', 'User version')
      await writeSkill(path.join(repo, '.claude', 'skills'), 'shared-name', 'Project version')

      clearSkillCaches()
      const commands = await getSkillDirCommands(repo)

      expect(commands.filter(c => c.name === 'shared-name')).toHaveLength(2)
    })

    it('produces the same result as before when no .agents directory exists', async () => {
      const repo = await makeRepo()
      await writeSkill(claudeSkillsDir(), 'user-skill', 'User')
      await writeSkill(path.join(repo, '.claude', 'skills'), 'project-skill', 'Project')

      const withFeature = await loadSkillNames(repo)

      process.env.CLAUDE_CODE_DISABLE_AGENT_SKILLS_DIR = '1'
      const withoutFeature = await loadSkillNames(repo)

      expect(withFeature).toEqual(withoutFeature)
    })
  })
})
