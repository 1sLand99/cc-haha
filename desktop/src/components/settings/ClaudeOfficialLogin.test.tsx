import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

const { logoutMock, startMock, statusMock } = vi.hoisted(() => ({
  logoutMock: vi.fn(),
  startMock: vi.fn(),
  statusMock: vi.fn(),
}))

vi.mock('../../api/hahaOAuth', () => ({
  hahaOAuthApi: {
    start: startMock,
    status: statusMock,
    logout: logoutMock,
  },
}))

import { ClaudeOfficialLogin } from './ClaudeOfficialLogin'
import { useHahaOAuthStore } from '../../stores/hahaOAuthStore'
import { useSettingsStore } from '../../stores/settingsStore'

const initialOAuthState = useHahaOAuthStore.getState()

describe('ClaudeOfficialLogin', () => {
  beforeEach(() => {
    statusMock.mockReset()
    startMock.mockReset()
    logoutMock.mockReset()
    useSettingsStore.setState({ locale: 'en' })
    useHahaOAuthStore.setState({
      ...initialOAuthState,
      status: null,
      isPolling: false,
      isLoading: false,
      error: null,
    })
  })

  afterEach(() => {
    act(() => {
      useHahaOAuthStore.getState().stopPolling()
      useHahaOAuthStore.setState(initialOAuthState)
    })
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders the shared login button when signed out', async () => {
    statusMock.mockResolvedValue({ loggedIn: false })

    render(<ClaudeOfficialLogin />)

    const login = await screen.findByRole('button', { name: 'Sign in to Claude' })
    expect(login).toHaveAttribute('data-slot', 'button')
    expect(login).toHaveAttribute('data-variant', 'default')
  })

  it('renders shared signed-in status and logout controls', async () => {
    statusMock.mockResolvedValue({
      loggedIn: true,
      expiresAt: Date.now() + 60_000,
      scopes: [],
      subscriptionType: 'pro',
    })

    render(<ClaudeOfficialLogin />)

    expect(await screen.findByText(/Signed in \(Claude PRO\)/)).toHaveAttribute('data-slot', 'badge')
    expect(screen.getByRole('button', { name: 'Sign out' })).toHaveAttribute('data-slot', 'button')
  })

  it('renders fetch failures through the shared alert', async () => {
    statusMock.mockRejectedValue(new Error('status unavailable'))

    render(<ClaudeOfficialLogin />)

    expect(await screen.findByRole('alert')).toHaveAttribute('data-slot', 'alert')
    expect(screen.getByText(/status unavailable/)).toBeInTheDocument()
  })
})
