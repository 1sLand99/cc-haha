import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

const { sendMock, openSettingsMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  openSettingsMock: vi.fn(async () => ({ ok: true })),
}))

vi.mock('../../api/websocket', () => ({
  wsManager: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    onConnectionState: vi.fn((_sessionId: string, handler: (state: string) => void) => {
      handler('connecting')
      return () => {}
    }),
    onMessage: vi.fn(() => () => {}),
    clearHandlers: vi.fn(),
    send: sendMock,
  },
}))

vi.mock('../../api/sessions', () => ({
  sessionsApi: {
    getMessages: vi.fn(async () => ({ messages: [] })),
    getSlashCommands: vi.fn(async () => ({ commands: [] })),
  },
}))

vi.mock('../../stores/teamStore', () => ({
  useTeamStore: {
    getState: () => ({
      getMemberBySessionId: vi.fn(() => null),
      sendMessageToMember: vi.fn(async () => {}),
      handleTeamCreated: vi.fn(),
      handleTeamUpdate: vi.fn(),
      handleTeamDeleted: vi.fn(),
    }),
  },
}))

vi.mock('../../stores/tabStore', () => ({
  useTabStore: {
    getState: () => ({
      updateTabStatus: vi.fn(),
      updateTabTitle: vi.fn(),
    }),
  },
}))

vi.mock('../../stores/sessionStore', () => ({
  useSessionStore: {
    getState: () => ({
      updateSessionTitle: vi.fn(),
    }),
  },
}))

vi.mock('../../stores/cliTaskStore', () => ({
  useCLITaskStore: {
    getState: () => ({
      fetchSessionTasks: vi.fn(),
      tasks: [],
      clearTasks: vi.fn(),
      setTasksFromTodos: vi.fn(),
      markCompletedAndDismissed: vi.fn(),
      resetCompletedTasks: vi.fn(async () => {}),
      refreshTasks: vi.fn(),
    }),
  },
}))

vi.mock('../../api/computerUse', () => ({
  computerUseApi: {
    openSettings: openSettingsMock,
  },
}))

import { useChatStore } from '../../stores/chatStore'
import { useOverlayStore } from '../../stores/overlayStore'
import { useSettingsStore } from '../../stores/settingsStore'
import type { ComputerUsePermissionRequest } from '../../types/chat'
import { ComputerUsePermissionModal } from './ComputerUsePermissionModal'

function appRequest(
  requestId = 'cu-1',
  reason = 'Open Finder and inspect a file',
): ComputerUsePermissionRequest {
  return {
    requestId,
    reason,
    apps: [
      {
        requestedName: 'Finder',
        resolved: {
          bundleId: 'com.apple.finder',
          displayName: 'Finder',
        },
        isSentinel: false,
        alreadyGranted: false,
        proposedTier: 'full',
      },
      {
        requestedName: 'Missing App',
        isSentinel: false,
        alreadyGranted: false,
        proposedTier: 'full',
      },
    ],
    requestedFlags: {
      clipboardRead: true,
      systemKeyCombos: true,
    },
    screenshotFiltering: 'native',
    willHide: [{ bundleId: 'com.apple.TextEdit', displayName: 'TextEdit' }],
    autoUnhideEnabled: true,
  }
}

describe('ComputerUsePermissionModal', () => {
  beforeEach(() => {
    sendMock.mockReset()
    openSettingsMock.mockReset()
    useSettingsStore.setState({ locale: 'en' })
    useChatStore.setState({ sessions: {} })
    useOverlayStore.setState(useOverlayStore.getInitialState(), true)
  })

  it('returns a full approval payload for resolved apps and requested flags', () => {
    render(
      <ComputerUsePermissionModal
        sessionId="session-1"
        request={appRequest()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Allow for session' }))

    expect(sendMock).toHaveBeenCalledTimes(1)
    expect(sendMock).toHaveBeenCalledWith('session-1', {
      type: 'computer_use_permission_response',
      requestId: 'cu-1',
      response: {
        granted: [
          expect.objectContaining({
            bundleId: 'com.apple.finder',
            displayName: 'Finder',
            tier: 'full',
          }),
        ],
        denied: [
          {
            bundleId: 'Missing App',
            reason: 'not_installed',
          },
        ],
        flags: {
          clipboardRead: true,
          clipboardWrite: false,
          systemKeyCombos: true,
        },
        userConsented: true,
      },
    })
  })

  it('uses the shadcn dialog surface and focuses the deny action first', async () => {
    render(
      <ComputerUsePermissionModal
        sessionId="session-1"
        request={appRequest()}
      />,
    )

    const dialog = screen.getByRole('dialog', {
      name: 'Computer Use wants to control these apps',
    })
    expect(dialog).toHaveAttribute('data-slot', 'dialog-content')
    expect(dialog.querySelectorAll('[data-slot="card"]')).toHaveLength(3)
    expect(screen.getAllByText('full')).toHaveLength(2)
    expect(
      screen.getAllByText('full').every((tier) =>
        tier.closest('[data-slot="badge"]') !== null),
    ).toBe(true)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Deny' })).toHaveFocus()
    })
  })

  it('denies exactly once when the dialog is dismissed repeatedly', () => {
    render(
      <ComputerUsePermissionModal
        sessionId="session-1"
        request={appRequest()}
      />,
    )

    fireEvent.click(screen.getByRole('button', {
      name: 'Deny — Computer Use wants to control these apps',
    }))
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(sendMock).toHaveBeenCalledTimes(1)
    expect(sendMock).toHaveBeenCalledWith('session-1', {
      type: 'computer_use_permission_response',
      requestId: 'cu-1',
      response: {
        granted: [],
        denied: [],
        flags: {
          clipboardRead: false,
          clipboardWrite: false,
          systemKeyCombos: false,
        },
        userConsented: false,
      },
    })
  })

  it('allows a queued request after the previous request responds', async () => {
    const view = render(
      <ComputerUsePermissionModal
        sessionId="session-1"
        request={appRequest('cu-1', 'First request')}
      />,
    )

    const firstDenyButton = screen.getByRole('button', { name: 'Deny' })
    fireEvent.click(firstDenyButton)
    fireEvent.click(firstDenyButton)

    view.rerender(
      <ComputerUsePermissionModal
        sessionId="session-1"
        request={appRequest('cu-2', 'Second request')}
      />,
    )
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Deny' })).toHaveFocus()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Allow for session' }))

    expect(sendMock).toHaveBeenCalledTimes(2)
    expect(sendMock.mock.calls.map(([, message]) => message.requestId)).toEqual([
      'cu-1',
      'cu-2',
    ])
  })

  it('can answer the same request id again after an authoritative replay', async () => {
    const view = render(
      <ComputerUsePermissionModal
        sessionId="session-1"
        request={appRequest()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }))

    view.rerender(
      <ComputerUsePermissionModal sessionId="session-1" request={null} />,
    )
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    view.rerender(
      <ComputerUsePermissionModal
        sessionId="session-1"
        request={appRequest('cu-1', 'Replayed request')}
      />,
    )
    const allow = await screen.findByRole('button', { name: 'Allow for session' })
    expect(allow).not.toBeDisabled()
    fireEvent.click(allow)

    expect(sendMock).toHaveBeenCalledTimes(2)
    expect(sendMock.mock.calls.map(([, message]) => message.requestId)).toEqual([
      'cu-1',
      'cu-1',
    ])
  })

  it('restores focus when the permission dialog is removed', async () => {
    const view = render(
      <>
        <button type="button">Composer</button>
        <ComputerUsePermissionModal sessionId="session-1" request={null} />
      </>,
    )
    const composer = screen.getByRole('button', { name: 'Composer' })
    composer.focus()

    view.rerender(
      <>
        <button type="button">Composer</button>
        <ComputerUsePermissionModal
          sessionId="session-1"
          request={appRequest()}
        />
      </>,
    )
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Deny' })).toHaveFocus()
    })

    view.rerender(
      <>
        <button type="button">Composer</button>
        <ComputerUsePermissionModal sessionId="session-1" request={null} />
      </>,
    )
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Composer' })).toHaveFocus()
    })
  })

  it('suppresses native browser overlays until the entire request queue closes', () => {
    const view = render(
      <ComputerUsePermissionModal
        sessionId="session-1"
        request={appRequest('cu-1', 'First request')}
      />,
    )
    expect(useOverlayStore.getState().count).toBe(1)

    view.rerender(
      <ComputerUsePermissionModal
        sessionId="session-1"
        request={appRequest('cu-2', 'Second request')}
      />,
    )
    expect(useOverlayStore.getState().count).toBe(1)

    view.rerender(
      <ComputerUsePermissionModal sessionId="session-1" request={null} />,
    )
    expect(useOverlayStore.getState().count).toBe(0)
  })

  it('opens System Settings from the macOS permission panel', async () => {
    render(
      <ComputerUsePermissionModal
        sessionId="session-1"
        request={{
          requestId: 'cu-1',
          reason: '',
          apps: [],
          requestedFlags: {},
          screenshotFiltering: 'native',
          tccState: {
            accessibility: false,
            screenRecording: true,
          },
        }}
      />,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open Accessibility' }))
    })

    expect(openSettingsMock).toHaveBeenCalledWith('Privacy_Accessibility')
    expect(screen.queryByRole('button', { name: 'Allow for session' })).not.toBeInTheDocument()
  })

  it('keeps both System Settings actions single-flight while a pane opens', async () => {
    let resolveOpenSettings: (() => void) | undefined
    openSettingsMock.mockImplementation(
      () => new Promise<{ ok: true }>((resolve) => {
        resolveOpenSettings = () => resolve({ ok: true })
      }),
    )

    render(
      <ComputerUsePermissionModal
        sessionId="session-1"
        request={{
          requestId: 'cu-1',
          reason: '',
          apps: [],
          requestedFlags: {},
          screenshotFiltering: 'native',
          tccState: {
            accessibility: false,
            screenRecording: false,
          },
        }}
      />,
    )

    const accessibility = screen.getByRole('button', { name: 'Open Accessibility' })
    const screenRecording = screen.getByRole('button', { name: 'Open Screen Recording' })
    fireEvent.click(accessibility)

    await waitFor(() => {
      expect(accessibility).toHaveAttribute('aria-busy', 'true')
      expect(accessibility).toBeDisabled()
      expect(screenRecording).toBeDisabled()
    })
    fireEvent.click(screenRecording)
    expect(openSettingsMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveOpenSettings?.()
    })
    await waitFor(() => {
      expect(accessibility).not.toBeDisabled()
      expect(screenRecording).not.toBeDisabled()
    })
  })

  it('shows an accessible error and restores actions when System Settings fails', async () => {
    openSettingsMock.mockRejectedValue(new Error('host rejected the request'))

    render(
      <ComputerUsePermissionModal
        sessionId="session-1"
        request={{
          requestId: 'cu-1',
          reason: '',
          apps: [],
          requestedFlags: {},
          screenshotFiltering: 'native',
          tccState: {
            accessibility: false,
            screenRecording: false,
          },
        }}
      />,
    )

    const accessibility = screen.getByRole('button', { name: 'Open Accessibility' })
    await act(async () => {
      fireEvent.click(accessibility)
    })

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not open the system privacy settings.',
    )
    expect(accessibility).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'Open Screen Recording' })).not.toBeDisabled()
  })
})
