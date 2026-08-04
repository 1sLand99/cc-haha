import { api } from './client'

export type ComputerUseStatus = {
  platform: string
  supported: boolean
  /**
   * Native cu-helper engine availability. `available` is true only on macOS AND
   * when the Swift `cu-helper` binary resolves on the server. The settings page
   * branches on this to render the Codex-style native UI (no Python) instead of
   * the Python setup flow. Populated by the backend `checkStatus` (server
   * `EnvStatus.cuHelper`).
   */
  cuHelper: {
    available: boolean
  }
  python: {
    installed: boolean
    version: string | null
    path: string | null
    source: 'custom' | 'system' | 'venv' | null
    error: string | null
  }
  venv: {
    created: boolean
    path: string
  }
  dependencies: {
    installed: boolean
    requirementsFound: boolean
  }
  permissions: {
    accessibility: boolean | null
    screenRecording: boolean | null
  }
}

export type SetupStep = {
  name: string
  ok: boolean
  message: string
}

export type SetupResult = {
  success: boolean
  steps: SetupStep[]
}

export type InstalledApp = {
  bundleId: string
  displayName: string
  path: string
}

export type AuthorizedApp = {
  bundleId: string
  displayName: string
  authorizedAt: string
}

/**
 * Result of POST /api/computer-use/open-permission-card. `ok` is false (with a
 * `reason`) off macOS or when the cu-helper binary is missing. When the card
 * was shown, `accessibility`/`screenRecording` carry its final snapshot (may be
 * null if it could not be parsed); the page re-reads status afterward anyway.
 */
export type OpenPermissionCardResult = {
  ok: boolean
  reason?: string
  accessibility?: boolean | null
  screenRecording?: boolean | null
}

export type ComputerUseConfig = {
  enabled: boolean
  authorizedApps: AuthorizedApp[]
  grantFlags: {
    clipboardRead: boolean
    clipboardWrite: boolean
    systemKeyCombos: boolean
  }
  pythonPath: string | null
}

export const computerUseApi = {
  getStatus() {
    return api.get<ComputerUseStatus>('/api/computer-use/status')
  },
  runSetup() {
    return api.post<SetupResult>('/api/computer-use/setup', undefined, { timeout: 300_000 })
  },
  getInstalledApps() {
    return api.get<{ apps: InstalledApp[] }>('/api/computer-use/apps')
  },
  getAuthorizedApps() {
    return api.get<ComputerUseConfig>('/api/computer-use/authorized-apps')
  },
  /**
   * Patch the stored config. `grantFlags` is merged field-by-field on the
   * server, so a caller flipping one switch sends only that switch — a plain
   * `Partial<ComputerUseConfig>` would force it to restate the other flags,
   * and restating a stale value is how a grant gets silently reverted.
   */
  setAuthorizedApps(
    config: Partial<Omit<ComputerUseConfig, 'grantFlags'>> & {
      grantFlags?: Partial<ComputerUseConfig['grantFlags']>
    },
  ) {
    return api.put<{ ok: true }>('/api/computer-use/authorized-apps', config)
  },
  openSettings(pane: 'Privacy_ScreenCapture' | 'Privacy_Accessibility') {
    return api.post<{ ok: true }>('/api/computer-use/open-settings', { pane })
  },
  /**
   * macOS-only. Spawns the native `cu-helper request-access` permission card and
   * resolves ONLY when the user closes it (hence the long timeout, mirroring
   * runSetup's pattern), returning the card's final permission snapshot. Off
   * darwin or when the helper binary is missing the backend returns
   * `{ ok: false, reason }`. Callers should follow this with `getStatus()` to
   * re-read the authoritative permission state regardless of the snapshot.
   */
  openPermissionCard() {
    return api.post<OpenPermissionCardResult>(
      '/api/computer-use/open-permission-card',
      undefined,
      { timeout: 600_000 },
    )
  },
}
