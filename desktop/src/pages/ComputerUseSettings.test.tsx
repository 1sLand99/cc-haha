import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom'

import { ComputerUseSettings } from './ComputerUseSettings'
import { useSettingsStore } from '../stores/settingsStore'
import { browserHost } from '../lib/desktopHost/browserHost'
import type { ComputerUseStatus } from '../api/computerUse'

const computerUseApiMock = vi.hoisted(() => ({
  getStatus: vi.fn(),
  getInstalledApps: vi.fn(),
  getAuthorizedApps: vi.fn(),
  setAuthorizedApps: vi.fn(),
  runSetup: vi.fn(),
  openSettings: vi.fn(),
  openPermissionCard: vi.fn(),
  loadAppIcon: vi.fn(),
}))

vi.mock('../api/computerUse', () => ({
  computerUseApi: computerUseApiMock,
}))

const readyStatus: ComputerUseStatus = {
  platform: 'win32',
  supported: true,
  engine: 'windows-compat' as const,
  systemVersion: null,
  arch: 'x64',
  cuHelper: {
    available: false,
    supported: false,
    minimumMacosVersion: '14.4',
    reason: 'unsupported_platform' as const,
  },
  python: {
    installed: true,
    version: '3.12.0',
    path: '/usr/bin/python3',
    source: 'system',
    error: null,
  },
  venv: {
    created: false,
    path: '/tmp/venv',
  },
  dependencies: {
    installed: false,
    requirementsFound: true,
  },
  permissions: {
    accessibility: null,
    screenRecording: null,
  },
}

const enabledConfig = {
  enabled: true,
  authorizedApps: [],
  grantFlags: {
    clipboardRead: true,
    clipboardWrite: true,
    systemKeyCombos: true,
  },
  pythonPath: null,
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => {
    resolve = res
  })
  return { promise, resolve }
}

describe('ComputerUseSettings', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    computerUseApiMock.getStatus.mockReset()
    computerUseApiMock.getInstalledApps.mockReset()
    computerUseApiMock.getAuthorizedApps.mockReset()
    computerUseApiMock.setAuthorizedApps.mockReset()
    computerUseApiMock.runSetup.mockReset()
    computerUseApiMock.openSettings.mockReset()
    computerUseApiMock.openPermissionCard.mockReset()
    computerUseApiMock.loadAppIcon.mockReset()
    computerUseApiMock.loadAppIcon.mockResolvedValue(null)
    Reflect.deleteProperty(window, 'desktopHost')

    computerUseApiMock.getStatus.mockResolvedValue(readyStatus)
    computerUseApiMock.getAuthorizedApps.mockResolvedValue(enabledConfig)
    computerUseApiMock.setAuthorizedApps.mockResolvedValue({ ok: true })
    computerUseApiMock.openPermissionCard.mockResolvedValue({
      ok: true,
      accessibility: true,
      screenRecording: true,
    })
  })

  it('renders the stored disabled state with the MCP exposure hint', async () => {
    computerUseApiMock.getAuthorizedApps.mockResolvedValue({
      ...enabledConfig,
      enabled: false,
    })

    render(<ComputerUseSettings />)

    const toggle = await screen.findByLabelText('Enabled')
    await waitFor(() => expect(toggle).not.toBeChecked())
    expect(
      screen.getByText(/will not inject the computer-use MCP server/i),
    ).toBeInTheDocument()
  })

  it('saves the Computer Use enablement toggle independently', async () => {
    render(<ComputerUseSettings />)

    const toggle = await screen.findByLabelText('Enabled')
    await waitFor(() => expect(computerUseApiMock.getAuthorizedApps).toHaveBeenCalled())

    await act(async () => {
      fireEvent.click(toggle)
      await Promise.resolve()
    })

    expect(computerUseApiMock.setAuthorizedApps).toHaveBeenCalledWith({
      enabled: false,
    })
  })

  it('saves a custom Python interpreter path and rechecks status', async () => {
    render(<ComputerUseSettings />)

    const input = await screen.findByLabelText('Python Interpreter Path')

    await act(async () => {
      fireEvent.change(input, {
        target: { value: '  C:\\Users\\me\\miniconda3\\envs\\cu\\python.exe  ' },
      })
      fireEvent.click(screen.getByText('Apply'))
      await Promise.resolve()
    })

    expect(computerUseApiMock.setAuthorizedApps).toHaveBeenCalledWith({
      pythonPath: 'C:\\Users\\me\\miniconda3\\envs\\cu\\python.exe',
    })
    expect(computerUseApiMock.getStatus).toHaveBeenCalledTimes(2)
  })

  it('selects a custom Python interpreter through the injected desktop host', async () => {
    const open = vi.fn().mockResolvedValue('/opt/python/bin/python3')
    window.desktopHost = {
      ...browserHost,
      kind: 'electron',
      isDesktop: true,
      capabilities: {
        ...browserHost.capabilities,
        dialogs: true,
      },
      dialogs: {
        ...browserHost.dialogs,
        open,
      },
    }

    render(<ComputerUseSettings />)

    await screen.findByLabelText('Python Interpreter Path')
    await act(async () => {
      fireEvent.click(screen.getByText('Browse'))
      await Promise.resolve()
    })

    expect(open).toHaveBeenCalledWith({
      multiple: false,
      directory: false,
      title: 'Select Python Interpreter',
    })
    expect(computerUseApiMock.setAuthorizedApps).toHaveBeenCalledWith({
      pythonPath: '/opt/python/bin/python3',
    })
  })

  it('falls back to manual Python path entry when dialogs are unavailable', async () => {
    window.desktopHost = {
      ...browserHost,
      kind: 'browser',
      isDesktop: false,
      capabilities: {
        ...browserHost.capabilities,
        dialogs: false,
      },
    }

    render(<ComputerUseSettings />)

    await screen.findByLabelText('Python Interpreter Path')
    await act(async () => {
      fireEvent.click(screen.getByText('Browse'))
      await Promise.resolve()
    })

    expect(screen.getByText('Could not open the file picker. Paste the path manually.')).toBeInTheDocument()
    expect(computerUseApiMock.setAuthorizedApps).not.toHaveBeenCalled()
  })

  it('keeps the user-selected enablement when a stale refresh resolves later', async () => {
    const staleRefresh = deferred<typeof enabledConfig>()
    computerUseApiMock.getStatus.mockResolvedValue({
      ...readyStatus,
      venv: {
        ...readyStatus.venv,
        created: true,
      },
      dependencies: {
        ...readyStatus.dependencies,
        installed: true,
      },
    })
    computerUseApiMock.getInstalledApps.mockResolvedValue({ apps: [] })
    computerUseApiMock.getAuthorizedApps
      .mockResolvedValueOnce({
        ...enabledConfig,
        enabled: false,
      })
      .mockReturnValueOnce(staleRefresh.promise)

    render(<ComputerUseSettings />)

    const toggle = await screen.findByLabelText('Enabled')
    await waitFor(() => expect(toggle).not.toBeChecked())
    await waitFor(() => expect(computerUseApiMock.getInstalledApps).toHaveBeenCalled())

    await act(async () => {
      fireEvent.click(toggle)
      await Promise.resolve()
    })

    expect(toggle).toBeChecked()

    await act(async () => {
      staleRefresh.resolve({
        ...enabledConfig,
        enabled: false,
      })
      await staleRefresh.promise
    })

    expect(toggle).toBeChecked()
  })

  it('saves app and grant flag changes from the ready environment view', async () => {
    computerUseApiMock.getStatus.mockResolvedValue({
      ...readyStatus,
      venv: {
        ...readyStatus.venv,
        created: true,
      },
      dependencies: {
        ...readyStatus.dependencies,
        installed: true,
      },
    })
    computerUseApiMock.getInstalledApps.mockResolvedValue({
      apps: [
        {
          bundleId: 'com.example.Preview',
          displayName: 'Preview',
          path: '/Applications/Preview.app',
        },
      ],
    })

    render(<ComputerUseSettings />)

    await screen.findByText('Preview')

    await act(async () => {
      fireEvent.click(screen.getByText('Preview'))
      await Promise.resolve()
    })

    expect(computerUseApiMock.setAuthorizedApps).toHaveBeenCalledWith({
      authorizedApps: [
        expect.objectContaining({
          bundleId: 'com.example.Preview',
          displayName: 'Preview',
        }),
      ],
      grantFlags: {
        clipboardRead: true,
        clipboardWrite: true,
        systemKeyCombos: true,
      },
    })

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Clipboard Access'))
      await Promise.resolve()
    })

    expect(computerUseApiMock.setAuthorizedApps).toHaveBeenCalledWith({
      authorizedApps: [
        expect.objectContaining({
          bundleId: 'com.example.Preview',
          displayName: 'Preview',
        }),
      ],
      grantFlags: {
        clipboardRead: false,
        clipboardWrite: false,
        systemKeyCombos: true,
      },
    })
  })

  describe('native cu-helper branch', () => {
    const nativeStatus: ComputerUseStatus = {
      ...readyStatus,
      platform: 'darwin',
      engine: 'macos-native' as const,
      systemVersion: '15.6',
      arch: 'arm64',
      cuHelper: {
        available: true,
        supported: true,
        minimumMacosVersion: '14.4',
        reason: null,
      },
      permissions: {
        accessibility: false,
        screenRecording: true,
      },
    }

    it('does not flash the compatibility toggle before rendering the native header toggle', async () => {
      const statusRequest = deferred<typeof nativeStatus>()
      computerUseApiMock.getStatus.mockReturnValue(statusRequest.promise)

      render(<ComputerUseSettings />)

      expect(screen.getByRole('status')).toHaveTextContent('Loading...')
      expect(screen.queryByLabelText('Enabled')).not.toBeInTheDocument()

      await act(async () => {
        statusRequest.resolve(nativeStatus)
        await statusRequest.promise
      })

      const heading = await screen.findByRole('heading', { name: 'Computer Control' })
      expect(within(heading.parentElement!.parentElement!).getByRole('switch', { name: 'Enabled' })).toBeChecked()
      expect(screen.queryByRole('switch', { name: 'Any App' })).not.toBeInTheDocument()
    })

    it('does not render the compatibility page when the capability probe fails', async () => {
      computerUseApiMock.getStatus.mockRejectedValue(new Error('offline'))

      render(<ComputerUseSettings />)

      expect(await screen.findByText('Failed to check status.')).toBeInTheDocument()
      expect(screen.queryByLabelText('Enabled')).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Computer Control' })).not.toBeInTheDocument()
    })

    it('keeps the native page selected when the helper is temporarily missing', async () => {
      computerUseApiMock.getStatus.mockResolvedValue({
        ...nativeStatus,
        cuHelper: {
          ...nativeStatus.cuHelper,
          available: false,
          reason: 'helper_missing',
        },
      })

      render(<ComputerUseSettings />)

      expect(await screen.findByText('Computer Use runtime is unavailable')).toBeInTheDocument()
      expect(screen.getByRole('switch', { name: 'Enabled' })).toBeInTheDocument()
      expect(screen.queryByLabelText('Python Interpreter Path')).not.toBeInTheDocument()
      expect(screen.queryByText('Install Environment')).not.toBeInTheDocument()
    })

    it('shows the macOS floor instead of falling back to the compatibility page', async () => {
      computerUseApiMock.getStatus.mockResolvedValue({
        ...nativeStatus,
        supported: false,
        engine: 'unsupported',
        systemVersion: '14.3.1',
        cuHelper: {
          ...nativeStatus.cuHelper,
          available: false,
          supported: false,
          reason: 'os_too_old',
        },
      })

      render(<ComputerUseSettings />)

      expect(await screen.findByText('Computer Use requires macOS 14.4 or later')).toBeInTheDocument()
      expect(screen.queryByLabelText('Python Interpreter Path')).not.toBeInTheDocument()
    })

    it('offers a retry when the macOS version probe is temporarily unavailable', async () => {
      computerUseApiMock.getStatus.mockResolvedValue({
        ...nativeStatus,
        supported: false,
        engine: 'unsupported',
        systemVersion: null,
        cuHelper: {
          ...nativeStatus.cuHelper,
          available: false,
          supported: false,
          reason: 'system_version_unknown',
        },
      })

      render(<ComputerUseSettings />)

      expect(await screen.findByText('Unable to verify the macOS version')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Recheck Status/ })).toBeInTheDocument()
      expect(screen.queryByText('Computer Use requires macOS 14.4 or later')).not.toBeInTheDocument()
    })

    it('never falls through to the old Python page for a legacy macOS response', async () => {
      const legacyStatus = { ...nativeStatus } as Partial<ComputerUseStatus>
      delete legacyStatus.engine
      computerUseApiMock.getStatus.mockResolvedValue(legacyStatus)

      render(<ComputerUseSettings />)

      expect(await screen.findByText('Computer Use runtime is unavailable')).toBeInTheDocument()
      expect(screen.queryByLabelText('Python Interpreter Path')).not.toBeInTheDocument()
      expect(screen.queryByText('Install Environment')).not.toBeInTheDocument()
    })

    it('waits for persisted config before showing the native toggle state', async () => {
      const configRequest = deferred<typeof enabledConfig>()
      computerUseApiMock.getStatus.mockResolvedValue(nativeStatus)
      computerUseApiMock.getAuthorizedApps.mockReturnValue(configRequest.promise)

      render(<ComputerUseSettings />)

      await waitFor(() => expect(computerUseApiMock.getStatus).toHaveBeenCalled())
      expect(screen.getByRole('status')).toHaveTextContent('Loading...')
      expect(screen.queryByLabelText('Enabled')).not.toBeInTheDocument()

      await act(async () => {
        configRequest.resolve({ ...enabledConfig, enabled: false })
        await configRequest.promise
      })

      expect(await screen.findByRole('switch', { name: 'Enabled' })).not.toBeChecked()
    })

    it('does not invent an enabled state when the saved config cannot be loaded', async () => {
      computerUseApiMock.getStatus.mockResolvedValue(nativeStatus)
      computerUseApiMock.getAuthorizedApps.mockRejectedValue(new Error('corrupt config'))

      render(<ComputerUseSettings />)

      expect(
        await screen.findByText('Could not load the saved Computer Use setting.'),
      ).toBeInTheDocument()
      expect(screen.queryByRole('switch', { name: 'Enabled' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    })

    it('restores the prior toggle and does not open permissions when saving fails', async () => {
      computerUseApiMock.getStatus.mockResolvedValue(nativeStatus)
      computerUseApiMock.getAuthorizedApps.mockResolvedValue({
        ...enabledConfig,
        enabled: false,
      })
      computerUseApiMock.setAuthorizedApps.mockRejectedValueOnce(new Error('write failed'))

      render(<ComputerUseSettings />)
      const toggle = await screen.findByRole('switch', { name: 'Enabled' })
      expect(toggle).not.toBeChecked()

      fireEvent.click(toggle)

      expect(
        await screen.findByText(
          'Could not save the Computer Use setting. The previous value was restored.',
        ),
      ).toBeInTheDocument()
      expect(toggle).not.toBeChecked()
      expect(computerUseApiMock.openPermissionCard).not.toHaveBeenCalled()
    })

    it('keeps the native header and toggle when a later status refresh fails', async () => {
      computerUseApiMock.getStatus
        .mockResolvedValueOnce(nativeStatus)
        .mockRejectedValueOnce(new Error('probe failed'))

      render(<ComputerUseSettings />)
      await screen.findByRole('heading', { name: 'Computer Control' })

      fireEvent.click(screen.getByRole('button', { name: /Recheck Status/ }))

      expect(await screen.findByText('Failed to check status.')).toBeInTheDocument()
      expect(screen.getByRole('switch', { name: 'Enabled' })).toBeInTheDocument()
    })

    it('shows a permission probe failure instead of permanent checking labels', async () => {
      computerUseApiMock.getStatus.mockResolvedValue({
        ...nativeStatus,
        permissions: {
          accessibility: null,
          screenRecording: null,
          error: 'unauthorized_client',
        },
      })

      render(<ComputerUseSettings />)

      expect(await screen.findAllByText('Check failed')).toHaveLength(2)
      expect(screen.queryByText('Checking…')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Recheck Status/ })).toBeInTheDocument()
    })

    it('ignores an older status refresh that resolves after a newer one', async () => {
      const older = deferred<typeof nativeStatus>()
      const newer = deferred<typeof nativeStatus>()
      computerUseApiMock.getStatus
        .mockResolvedValueOnce(nativeStatus)
        .mockReturnValueOnce(older.promise)
        .mockReturnValueOnce(newer.promise)

      render(<ComputerUseSettings />)
      await screen.findByRole('heading', { name: 'Computer Control' })

      const recheck = screen.getByRole('button', { name: /Recheck Status/ })
      fireEvent.click(recheck)
      fireEvent.click(recheck)

      await act(async () => {
        newer.resolve(nativeStatus)
        await newer.promise
      })
      await act(async () => {
        older.resolve({
          ...nativeStatus,
          cuHelper: {
            ...nativeStatus.cuHelper,
            available: false,
            reason: 'helper_missing',
          },
        })
        await older.promise
      })

      expect(screen.queryByText('Computer Use runtime is unavailable')).not.toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Computer Control' })).toBeInTheDocument()
    })

    /**
     * Rows show the application's own icon, served per bundle id. The letter
     * tile is the fallback for bundles that ship no icon, so it must appear on
     * image error and NOT before — a page that renders letters while perfectly
     * good icons exist looks broken.
     */
    describe('app icons', () => {
      const authorizedConfig = {
        ...enabledConfig,
        authorizedApps: [
          {
            bundleId: 'com.example.Preview',
            displayName: 'Preview',
            authorizedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      }

      it('renders the icon it loaded for the row bundle id', async () => {
        computerUseApiMock.getStatus.mockResolvedValue(nativeStatus)
        computerUseApiMock.getAuthorizedApps.mockResolvedValue(authorizedConfig)
        computerUseApiMock.loadAppIcon.mockResolvedValue('blob:icon-preview')

        render(<ComputerUseSettings />)
        await screen.findByText('Preview')

        await waitFor(() => {
          expect(document.querySelector('img[src="blob:icon-preview"]')).not.toBeNull()
        })
        expect(computerUseApiMock.loadAppIcon).toHaveBeenCalledWith('com.example.Preview')
        // The letter tile is the fallback, so it must be gone once the icon
        // arrives — otherwise both would render.
        expect(screen.queryByText('P')).toBeNull()
      })

      it('keeps the letter tile when the bundle has no icon', async () => {
        computerUseApiMock.getStatus.mockResolvedValue(nativeStatus)
        computerUseApiMock.getAuthorizedApps.mockResolvedValue(authorizedConfig)
        // null is the ordinary "this bundle ships no icon" answer.
        computerUseApiMock.loadAppIcon.mockResolvedValue(null)

        render(<ComputerUseSettings />)
        await screen.findByText('Preview')

        await waitFor(() => expect(screen.getByText('P')).toBeInTheDocument())
        expect(document.querySelector('img')).toBeNull()
      })

      it('never points an img straight at the endpoint', async () => {
        // The packaged renderer is a file:// page, so a cross-origin <img> to
        // /api/... is refused by the server and silently shows nothing. Icons
        // must arrive as blob URLs through the authenticated channel.
        computerUseApiMock.getStatus.mockResolvedValue(nativeStatus)
        computerUseApiMock.getAuthorizedApps.mockResolvedValue(authorizedConfig)
        computerUseApiMock.loadAppIcon.mockResolvedValue('blob:icon-preview')

        render(<ComputerUseSettings />)
        await screen.findByText('Preview')
        await waitFor(() => {
          expect(document.querySelector('img[src="blob:icon-preview"]')).not.toBeNull()
        })

        expect(document.querySelector('img[src*="/api/"]')).toBeNull()
      })
    })

    it('pops the native permission card when enabling Computer Use with missing permissions', async () => {
      computerUseApiMock.getStatus.mockResolvedValue(nativeStatus)
      computerUseApiMock.getAuthorizedApps.mockResolvedValue({
        ...enabledConfig,
        enabled: false,
      })

      render(<ComputerUseSettings />)

      const toggle = await screen.findByLabelText('Enabled')
      await waitFor(() => expect(toggle).not.toBeChecked())

      await act(async () => {
        fireEvent.click(toggle)
        await Promise.resolve()
      })

      expect(computerUseApiMock.setAuthorizedApps).toHaveBeenCalledWith({ enabled: true })
      expect(computerUseApiMock.openPermissionCard).toHaveBeenCalledTimes(1)
    })

    it('does not pop the card when enabling with all permissions granted', async () => {
      computerUseApiMock.getStatus.mockResolvedValue({
        ...nativeStatus,
        permissions: { accessibility: true, screenRecording: true },
      })
      computerUseApiMock.getAuthorizedApps.mockResolvedValue({
        ...enabledConfig,
        enabled: false,
      })

      render(<ComputerUseSettings />)

      const toggle = await screen.findByLabelText('Enabled')
      await waitFor(() => expect(toggle).not.toBeChecked())

      await act(async () => {
        fireEvent.click(toggle)
        await Promise.resolve()
      })

      expect(computerUseApiMock.setAuthorizedApps).toHaveBeenCalledWith({ enabled: true })
      expect(computerUseApiMock.openPermissionCard).not.toHaveBeenCalled()
    })

    it('reopens the native card from the permission section button', async () => {
      computerUseApiMock.getStatus.mockResolvedValue(nativeStatus)

      render(<ComputerUseSettings />)

      const button = await screen.findByText('Reopen authorization card')

      await act(async () => {
        fireEvent.click(button)
        await Promise.resolve()
      })

      expect(computerUseApiMock.openPermissionCard).toHaveBeenCalledTimes(1)
    })

    it('surfaces a permission-card command failure returned by the server', async () => {
      computerUseApiMock.getStatus.mockResolvedValue(nativeStatus)
      computerUseApiMock.openPermissionCard.mockResolvedValue({
        ok: false,
        reason: 'helper launch failed',
      })

      render(<ComputerUseSettings />)
      fireEvent.click(await screen.findByText('Reopen authorization card'))

      expect(
        await screen.findByText('Could not open the authorization card. Please try again later.'),
      ).toBeInTheDocument()
    })

    it('removes an always-allowed app via the trash button', async () => {
      computerUseApiMock.getStatus.mockResolvedValue(nativeStatus)
      computerUseApiMock.getAuthorizedApps.mockResolvedValue({
        ...enabledConfig,
        authorizedApps: [
          {
            bundleId: 'com.example.Preview',
            displayName: 'Preview',
            authorizedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      })

      render(<ComputerUseSettings />)

      const remove = await screen.findByLabelText('Remove Preview')

      await act(async () => {
        fireEvent.click(remove)
        await Promise.resolve()
      })

      expect(computerUseApiMock.setAuthorizedApps).toHaveBeenCalledWith({
        authorizedApps: [],
        grantFlags: {
          clipboardRead: true,
          clipboardWrite: true,
          systemKeyCombos: true,
        },
      })
    })

    it('adds an app from the picker fed by getInstalledApps', async () => {
      computerUseApiMock.getStatus.mockResolvedValue(nativeStatus)
      computerUseApiMock.getInstalledApps.mockResolvedValue({
        apps: [
          {
            bundleId: 'com.example.Notes',
            displayName: 'Notes',
            path: '/Applications/Notes.app',
          },
        ],
      })

      render(<ComputerUseSettings />)

      const addButton = await screen.findByText('Add App')

      await act(async () => {
        fireEvent.click(addButton)
        await Promise.resolve()
      })

      await waitFor(() => expect(computerUseApiMock.getInstalledApps).toHaveBeenCalled())

      const notesEntry = await screen.findByText('Notes')

      await act(async () => {
        fireEvent.click(notesEntry)
        await Promise.resolve()
      })

      expect(computerUseApiMock.setAuthorizedApps).toHaveBeenCalledWith({
        authorizedApps: [
          expect.objectContaining({
            bundleId: 'com.example.Notes',
            displayName: 'Notes',
          }),
        ],
        grantFlags: {
          clipboardRead: true,
          clipboardWrite: true,
          systemKeyCombos: true,
        },
      })
    })
  })
})
