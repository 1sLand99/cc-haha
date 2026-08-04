import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { getGlobalConfig } from '../config.js'
import { checkAndInstallOfficialMarketplace } from './officialMarketplaceStartupCheck.js'

const NON_ESSENTIAL_TRAFFIC_ENV = 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC'
let originalEnv: string | undefined

beforeEach(() => {
  originalEnv = process.env[NON_ESSENTIAL_TRAFFIC_ENV]
  process.env[NON_ESSENTIAL_TRAFFIC_ENV] = '1'
})

afterEach(() => {
  if (originalEnv === undefined) delete process.env[NON_ESSENTIAL_TRAFFIC_ENV]
  else process.env[NON_ESSENTIAL_TRAFFIC_ENV] = originalEnv
  // checkAndInstallOfficialMarketplace records its skip via saveGlobalConfig;
  // restore the shared test config so other suites are unaffected.
  const config = getGlobalConfig()
  config.officialMarketplaceAutoInstallAttempted = false
  config.officialMarketplaceAutoInstalled = false
  config.officialMarketplaceAutoInstallFailReason = undefined
})

describe('official marketplace auto-install under essential-traffic', () => {
  it('skips without touching GCS or git when non-essential traffic is disabled', async () => {
    const result = await checkAndInstallOfficialMarketplace()

    expect(result.skipped).toBe(true)
    expect(result.reason).toBe('policy_blocked')
    expect(getGlobalConfig().officialMarketplaceAutoInstallFailReason).toBe('policy_blocked')
  })
})
