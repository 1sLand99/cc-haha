import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
}))

vi.mock('./client', () => ({ api: apiMock }))

import { computerUseApi } from './computerUse'

describe('computerUseApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMock.get.mockResolvedValue({})
    apiMock.post.mockResolvedValue({})
    apiMock.put.mockResolvedValue({})
  })

  it('routes every Computer Use settings request through the expected API contract', async () => {
    const patch = {
      enabled: true,
      grantFlags: { systemKeyCombos: false },
    }

    await computerUseApi.getStatus()
    await computerUseApi.runSetup()
    await computerUseApi.getInstalledApps()
    await computerUseApi.getAuthorizedApps()
    await computerUseApi.setAuthorizedApps(patch)
    await computerUseApi.openSettings('Privacy_Accessibility')
    await computerUseApi.openPermissionCard()

    expect(apiMock.get).toHaveBeenNthCalledWith(1, '/api/computer-use/status')
    expect(apiMock.get).toHaveBeenNthCalledWith(2, '/api/computer-use/apps')
    expect(apiMock.get).toHaveBeenNthCalledWith(3, '/api/computer-use/authorized-apps')
    expect(apiMock.post).toHaveBeenNthCalledWith(
      1,
      '/api/computer-use/setup',
      undefined,
      { timeout: 300_000 },
    )
    expect(apiMock.put).toHaveBeenCalledWith(
      '/api/computer-use/authorized-apps',
      patch,
    )
    expect(apiMock.post).toHaveBeenNthCalledWith(
      2,
      '/api/computer-use/open-settings',
      { pane: 'Privacy_Accessibility' },
    )
    expect(apiMock.post).toHaveBeenNthCalledWith(
      3,
      '/api/computer-use/open-permission-card',
      undefined,
      { timeout: 600_000 },
    )
  })
})
