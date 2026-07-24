import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

const { sendMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
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

import { useChatStore } from '../../stores/chatStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTabStore } from '../../stores/tabStore'
import { PermissionDialog } from './PermissionDialog'

const SESSION_ID = 'permission-session'

function seedPermission(requestId = 'perm-read') {
  useChatStore.setState({
    sessions: {
      [SESSION_ID]: {
        messages: [],
        chatState: 'permission_pending',
        connectionState: 'connected',
        streamingText: '',
        streamingToolInput: '',
        activeToolUseId: null,
        activeToolName: null,
        activeThinkingId: null,
        pendingPermission: {
          requestId,
          toolName: 'Read',
          toolUseId: 'tool-read',
          input: { file_path: '/private/tmp/read-me.ts' },
        },
        pendingComputerUsePermission: null,
        tokenUsage: { input_tokens: 0, output_tokens: 0 },
        streamingResponseChars: 0,
        elapsedSeconds: 0,
        statusVerb: '',
        slashCommands: [],
        agentTaskNotifications: {},
        backgroundAgentTasks: {},
        elapsedTimer: null,
        composerPrefill: null,
        composerInsertion: null,
        composerDraft: null,
      },
    },
  })
}

function renderPermission(requestId = 'perm-read') {
  return render(
    <PermissionDialog
      sessionId={SESSION_ID}
      requestId={requestId}
      toolName="Read"
      input={{ file_path: '/private/tmp/read-me.ts' }}
    />,
  )
}

describe('PermissionDialog', () => {
  beforeEach(() => {
    sendMock.mockReset()
    useSettingsStore.setState({ locale: 'en' })
    useTabStore.setState({
      activeTabId: SESSION_ID,
      tabs: [{ sessionId: SESSION_ID, title: 'Permission', type: 'session', status: 'idle' }],
    })
    seedPermission()
  })

  it('exposes full input through shadcn Collapsible semantics', () => {
    renderPermission()

    const details = screen.getByRole('button', { name: 'Show full input' })
    expect(details).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(details)

    expect(screen.getByRole('button', { name: 'Hide details' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/"file_path": "\/private\/tmp\/read-me\.ts"/)).toBeInTheDocument()
  })

  it('sends an allow response only once on repeated clicks', () => {
    renderPermission()

    const allow = screen.getByRole('button', { name: 'Allow: /private/tmp/read-me.ts' })
    fireEvent.click(allow)
    fireEvent.click(allow)

    expect(sendMock).toHaveBeenCalledTimes(1)
    expect(sendMock).toHaveBeenCalledWith(SESSION_ID, {
      type: 'permission_response',
      requestId: 'perm-read',
      allowed: true,
    })
  })

  it('preserves the allow-for-session rule payload', () => {
    renderPermission()

    fireEvent.click(screen.getByRole('button', { name: 'Allow for session: /private/tmp/read-me.ts' }))

    expect(sendMock).toHaveBeenCalledWith(SESSION_ID, {
      type: 'permission_response',
      requestId: 'perm-read',
      allowed: true,
      rule: 'always',
    })
  })

  it('preserves the deny payload', () => {
    renderPermission()

    fireEvent.click(screen.getByRole('button', { name: 'Deny: /private/tmp/read-me.ts' }))

    expect(sendMock).toHaveBeenCalledWith(SESSION_ID, {
      type: 'permission_response',
      requestId: 'perm-read',
      allowed: false,
    })
  })
})
