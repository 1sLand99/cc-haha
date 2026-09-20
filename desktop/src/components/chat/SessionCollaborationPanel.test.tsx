import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'
import { sessionCollaborationApi, type SessionCollaborationStatus } from '@/api/sessionCollaboration'
import { SessionCollaborationPanel } from './SessionCollaborationPanel'
const openTab = vi.fn()
vi.mock('@/stores/tabStore', () => ({ useTabStore: { getState: () => ({ openTab }) } }))
vi.mock('@/api/sessionCollaboration', () => ({ sessionCollaborationApi: { status: vi.fn(), stop: vi.fn() } }))
const snapshot: SessionCollaborationStatus = { revision: 2, members: [
  { sessionId: 'main', rootSessionId: 'main', parentSessionId: null, state: 'idle', stopped: false },
  { sessionId: 'child', rootSessionId: 'main', parentSessionId: 'main', state: 'running', stopped: false },
], messages: [{ id: 'm', sourceSessionId: 'child', targetSessionId: 'main', content: 'Review is ready', kind: 'message', status: 'accepted', createdAt: '2026-09-20T00:00:00Z' }] }
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(sessionCollaborationApi.status).mockResolvedValue(snapshot)
  vi.mocked(sessionCollaborationApi.stop).mockResolvedValue({})
})
it('shows collaboration state, source navigation and stops the entire group', async () => {
  render(<SessionCollaborationPanel sessionId="main" />)
  const summary = await screen.findByText('Session collaboration (2)')
  fireEvent.click(summary)
  expect(screen.getByText('Review is ready')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'child · Running' }))
  expect(openTab).toHaveBeenCalledWith('child', 'child')
  fireEvent.click(screen.getByRole('button', { name: 'Stop group' }))
  await waitFor(() => expect(sessionCollaborationApi.stop).toHaveBeenCalledWith('main'))
})
it('never displays the previous group while switching sessions', async () => {
  const view = render(<SessionCollaborationPanel sessionId="main" />)
  await screen.findByText('Session collaboration (2)')
  vi.mocked(sessionCollaborationApi.status).mockReturnValue(new Promise(() => {}))
  view.rerender(<SessionCollaborationPanel sessionId="other" />)
  expect(screen.queryByText('Session collaboration (2)')).not.toBeInTheDocument()
})

it('distinguishes cancelled queued work after stopping a group', async () => {
  vi.mocked(sessionCollaborationApi.status).mockResolvedValue({ ...snapshot, messages: [{ ...snapshot.messages[0]!, status: 'cancelled' }] })
  render(<SessionCollaborationPanel sessionId="main" />)
  fireEvent.click(await screen.findByText('Session collaboration (2)'))
  expect(screen.getByText('Cancelled')).toBeInTheDocument()
  expect(screen.queryByText('Delivered')).not.toBeInTheDocument()
})

it('does not let an older in-flight poll revert the stopped group', async () => {
  vi.useFakeTimers()
  try {
    let resolveOld: (value: SessionCollaborationStatus) => void = () => {}
    vi.mocked(sessionCollaborationApi.status)
      .mockResolvedValueOnce(snapshot)
      .mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve }))
      .mockResolvedValueOnce({ ...snapshot, revision: 3, members: snapshot.members.map(member => ({ ...member, stopped: true, state: 'stopped' })) })
    render(<SessionCollaborationPanel sessionId="main" />)
    await act(async () => { await Promise.resolve() })
    fireEvent.click(screen.getByText('Session collaboration (2)'))
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    fireEvent.click(screen.getByRole('button', { name: 'Stop group' }))
    await act(async () => { await Promise.resolve() })
    expect(screen.getByRole('button', { name: 'child · Stopped' })).toBeInTheDocument()
    await act(async () => { resolveOld(snapshot) })
    expect(screen.getByRole('button', { name: 'child · Stopped' })).toBeInTheDocument()
  } finally { vi.useRealTimers() }
})
