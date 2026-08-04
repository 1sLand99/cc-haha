import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { promises as fs } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { handleApiRequest } from '../router.js'
import {
  applyNonEssentialTrafficSetting,
  NON_ESSENTIAL_TRAFFIC_ENV,
  readNonEssentialTrafficDisabled,
  readNonEssentialTrafficDisabledSync,
  syncNonEssentialTrafficEnv,
  updateNonEssentialTrafficDisabled,
} from '../../services/api/nonEssentialTraffic.js'
import { getGlobalConfig } from '../../utils/config.js'

let tmpDir: string
let originalConfigDir: string | undefined

function settingsPath(): string {
  return path.join(tmpDir, 'cc-haha', 'settings.json')
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'non-essential-traffic-'))
  originalConfigDir = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = tmpDir
  delete process.env[NON_ESSENTIAL_TRAFFIC_ENV]
})

afterEach(async () => {
  if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
  delete process.env[NON_ESSENTIAL_TRAFFIC_ENV]
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('non-essential traffic setting', () => {
  test('defaults to disabled (true) when no settings file exists', () => {
    expect(readNonEssentialTrafficDisabledSync()).toBe(true)
  })

  test('reads the disabled flag from cc-haha/settings.json', async () => {
    await fs.mkdir(path.dirname(settingsPath()), { recursive: true })
    await fs.writeFile(settingsPath(), JSON.stringify({ nonEssentialTraffic: { disabled: false } }))
    expect(readNonEssentialTrafficDisabledSync()).toBe(false)
    expect(await readNonEssentialTrafficDisabled()).toBe(false)
  })

  test('missing field falls back to the default (disabled)', async () => {
    await fs.mkdir(path.dirname(settingsPath()), { recursive: true })
    await fs.writeFile(settingsPath(), JSON.stringify({ traceCapture: { enabled: true } }))
    expect(readNonEssentialTrafficDisabledSync()).toBe(true)
  })

  test('applyNonEssentialTrafficSetting maps a disabled setting into the process env', () => {
    applyNonEssentialTrafficSetting()
    expect(process.env[NON_ESSENTIAL_TRAFFIC_ENV]).toBe('1')
  })

  test('applyNonEssentialTrafficSetting does not override an explicitly truthy env var', async () => {
    process.env[NON_ESSENTIAL_TRAFFIC_ENV] = '1'
    await fs.mkdir(path.dirname(settingsPath()), { recursive: true })
    await fs.writeFile(settingsPath(), JSON.stringify({ nonEssentialTraffic: { disabled: false } }))
    applyNonEssentialTrafficSetting()
    expect(process.env[NON_ESSENTIAL_TRAFFIC_ENV]).toBe('1')
  })

  test('applyNonEssentialTrafficSetting treats a falsy env value ("0") as unset and follows the setting', async () => {
    process.env[NON_ESSENTIAL_TRAFFIC_ENV] = '0'
    await fs.mkdir(path.dirname(settingsPath()), { recursive: true })
    await fs.writeFile(settingsPath(), JSON.stringify({ nonEssentialTraffic: { disabled: false } }))
    applyNonEssentialTrafficSetting()
    expect(process.env[NON_ESSENTIAL_TRAFFIC_ENV]).toBeUndefined()

    process.env[NON_ESSENTIAL_TRAFFIC_ENV] = '0'
    await fs.writeFile(settingsPath(), JSON.stringify({ nonEssentialTraffic: { disabled: true } }))
    applyNonEssentialTrafficSetting()
    expect(process.env[NON_ESSENTIAL_TRAFFIC_ENV]).toBe('1')
  })

  test('applyNonEssentialTrafficSetting leaves the env unset when the flag is off', async () => {
    await fs.mkdir(path.dirname(settingsPath()), { recursive: true })
    await fs.writeFile(settingsPath(), JSON.stringify({ nonEssentialTraffic: { disabled: false } }))
    applyNonEssentialTrafficSetting()
    expect(process.env[NON_ESSENTIAL_TRAFFIC_ENV]).toBeUndefined()
  })

  test('updateNonEssentialTrafficDisabled persists the setting and syncs the env', async () => {
    await updateNonEssentialTrafficDisabled(true)
    expect(process.env[NON_ESSENTIAL_TRAFFIC_ENV]).toBe('1')
    const persisted = JSON.parse(await fs.readFile(settingsPath(), 'utf-8'))
    expect(persisted.nonEssentialTraffic).toEqual({ disabled: true })

    await updateNonEssentialTrafficDisabled(false)
    expect(process.env[NON_ESSENTIAL_TRAFFIC_ENV]).toBeUndefined()
    const persistedAfter = JSON.parse(await fs.readFile(settingsPath(), 'utf-8'))
    expect(persistedAfter.nonEssentialTraffic).toEqual({ disabled: false })
  })

  test('syncNonEssentialTrafficEnv sets and clears the env var', () => {
    syncNonEssentialTrafficEnv(true)
    expect(process.env[NON_ESSENTIAL_TRAFFIC_ENV]).toBe('1')
    syncNonEssentialTrafficEnv(false)
    expect(process.env[NON_ESSENTIAL_TRAFFIC_ENV]).toBeUndefined()
  })

  test('re-enabling traffic clears the official marketplace auto-install policy_blocked state', async () => {
    const config = getGlobalConfig()
    const previous = {
      attempted: config.officialMarketplaceAutoInstallAttempted,
      installed: config.officialMarketplaceAutoInstalled,
      failReason: config.officialMarketplaceAutoInstallFailReason,
      retryCount: config.officialMarketplaceAutoInstallRetryCount,
      lastAttempt: config.officialMarketplaceAutoInstallLastAttemptTime,
      nextRetry: config.officialMarketplaceAutoInstallNextRetryTime,
    }
    config.officialMarketplaceAutoInstallAttempted = true
    config.officialMarketplaceAutoInstalled = false
    config.officialMarketplaceAutoInstallFailReason = 'policy_blocked'
    config.officialMarketplaceAutoInstallRetryCount = 2
    config.officialMarketplaceAutoInstallLastAttemptTime = 1
    config.officialMarketplaceAutoInstallNextRetryTime = 2

    try {
      await updateNonEssentialTrafficDisabled(false)

      const after = getGlobalConfig()
      expect(after.officialMarketplaceAutoInstallAttempted).toBe(false)
      expect(after.officialMarketplaceAutoInstalled).toBe(false)
      expect(after.officialMarketplaceAutoInstallFailReason).toBeUndefined()
      expect(after.officialMarketplaceAutoInstallRetryCount).toBeUndefined()
      expect(after.officialMarketplaceAutoInstallNextRetryTime).toBeUndefined()
    } finally {
      const restored = getGlobalConfig()
      restored.officialMarketplaceAutoInstallAttempted = previous.attempted
      restored.officialMarketplaceAutoInstalled = previous.installed
      restored.officialMarketplaceAutoInstallFailReason = previous.failReason
      restored.officialMarketplaceAutoInstallRetryCount = previous.retryCount
      restored.officialMarketplaceAutoInstallLastAttemptTime = previous.lastAttempt
      restored.officialMarketplaceAutoInstallNextRetryTime = previous.nextRetry
    }
  })
})

describe('GET/PUT /api/privacy/non-essential-traffic', () => {
  test('GET returns the default disabled=true', async () => {
    const res = await handleApiRequest(
      new Request('http://localhost/api/privacy/non-essential-traffic'),
      new URL('http://localhost/api/privacy/non-essential-traffic'),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ disabled: true })
  })

  test('PUT persists the flag and applies it to the process env', async () => {
    const res = await handleApiRequest(
      new Request('http://localhost/api/privacy/non-essential-traffic', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disabled: false }),
      }),
      new URL('http://localhost/api/privacy/non-essential-traffic'),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ disabled: false })
    expect(process.env[NON_ESSENTIAL_TRAFFIC_ENV]).toBeUndefined()
    expect(await readNonEssentialTrafficDisabled()).toBe(false)
  })

  test('PUT rejects a non-boolean disabled value', async () => {
    const res = await handleApiRequest(
      new Request('http://localhost/api/privacy/non-essential-traffic', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disabled: 'yes' }),
      }),
      new URL('http://localhost/api/privacy/non-essential-traffic'),
    )
    expect(res.status).toBe(400)
  })
})
