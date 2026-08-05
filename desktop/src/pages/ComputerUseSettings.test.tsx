import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

import { ComputerUseSettings } from './ComputerUseSettings'
import { useSettingsStore } from '../stores/settingsStore'
import { browserHost } from '../lib/desktopHost/browserHost'

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

const readyStatus = {
  platform: 'darwin',
  supported: true,
  cuHelper: { available: false },
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
    const nativeStatus = {
      ...readyStatus,
      cuHelper: { available: true },
      permissions: {
        accessibility: false,
        screenRecording: true,
      },
    }

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

    it('pops the native permission card when enabling Any App with missing permissions', async () => {
      computerUseApiMock.getStatus.mockResolvedValue(nativeStatus)
      computerUseApiMock.getAuthorizedApps.mockResolvedValue({
        ...enabledConfig,
        enabled: false,
      })

      render(<ComputerUseSettings />)

      const toggle = await screen.findByLabelText('Any App')
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

      const toggle = await screen.findByLabelText('Any App')
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
