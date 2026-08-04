import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { checkDomainBlocklist, shouldSkipWebFetchPreflight } from './utils.js'

const NON_ESSENTIAL_TRAFFIC_ENV = 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC'

describe('shouldSkipWebFetchPreflight', () => {
  const originalDesktopServerUrl = process.env.CC_HAHA_DESKTOP_SERVER_URL

  beforeEach(() => {
    delete process.env.CC_HAHA_DESKTOP_SERVER_URL
  })

  afterEach(() => {
    if (originalDesktopServerUrl === undefined) {
      delete process.env.CC_HAHA_DESKTOP_SERVER_URL
    } else {
      process.env.CC_HAHA_DESKTOP_SERVER_URL = originalDesktopServerUrl
    }
  })

  test('respects explicit true from settings', () => {
    expect(
      shouldSkipWebFetchPreflight({ skipWebFetchPreflight: true }),
    ).toBe(true)
  })

  test('respects explicit false from settings even on desktop', () => {
    process.env.CC_HAHA_DESKTOP_SERVER_URL = 'http://127.0.0.1:3456'

    expect(
      shouldSkipWebFetchPreflight({ skipWebFetchPreflight: false }),
    ).toBe(false)
  })

  test('defaults to enabled for desktop sessions', () => {
    process.env.CC_HAHA_DESKTOP_SERVER_URL = 'http://127.0.0.1:3456'

    expect(shouldSkipWebFetchPreflight({})).toBe(true)
  })

  test('defaults to disabled outside desktop sessions', () => {
    expect(shouldSkipWebFetchPreflight({})).toBe(false)
  })
})

describe('checkDomainBlocklist under essential-traffic', () => {
  let originalNonEssentialTrafficEnv: string | undefined

  beforeEach(() => {
    originalNonEssentialTrafficEnv = process.env[NON_ESSENTIAL_TRAFFIC_ENV]
    process.env[NON_ESSENTIAL_TRAFFIC_ENV] = '1'
  })

  afterEach(() => {
    if (originalNonEssentialTrafficEnv === undefined) {
      delete process.env[NON_ESSENTIAL_TRAFFIC_ENV]
    } else {
      process.env[NON_ESSENTIAL_TRAFFIC_ENV] = originalNonEssentialTrafficEnv
    }
  })

  test('allows the domain without querying Anthropic when non-essential traffic is disabled', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (() => {
      throw new Error('must not be reached')
    }) as typeof fetch
    try {
      expect(await checkDomainBlocklist('example.com')).toEqual({ status: 'allowed' })
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
