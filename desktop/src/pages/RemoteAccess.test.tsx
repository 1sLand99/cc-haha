import { StrictMode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { RemoteAccessGate } from './RemoteAccess'
import { remoteAccessApi } from '@/api/publicAccess'
import { useSettingsStore } from '@/stores/settingsStore'
vi.mock('@/api/publicAccess', () => ({ remoteAccessApi: { session: vi.fn(), pair: vi.fn(), claim: vi.fn() } }))
beforeEach(() => { useSettingsStore.setState({ locale: 'en' }); history.replaceState(null, '', '/remote#pair=once-only') })
afterEach(() => { cleanup(); vi.resetAllMocks() })
it('scrubs the fragment and mounts the app only after desktop approval', async () => {
  vi.mocked(remoteAccessApi.session).mockResolvedValue({ authenticated: false })
  vi.mocked(remoteAccessApi.pair).mockResolvedValue({ id: 'phone', claimSecret: 'claim' })
  vi.mocked(remoteAccessApi.claim).mockResolvedValue({ status: 'approved' })
  render(<RemoteAccessGate><div>Private conversations</div></RemoteAccessGate>)
  expect(location.hash).toBe('')
  expect(screen.queryByText('Private conversations')).not.toBeInTheDocument()
  fireEvent.change(await screen.findByLabelText('Device name'), { target: { value: 'My phone' } })
  fireEvent.click(screen.getByRole('button', { name: 'Request pairing' }))
  await screen.findByText('Private conversations')
  expect(remoteAccessApi.pair).toHaveBeenCalledWith('once-only', 'My phone')
  expect(remoteAccessApi.claim).toHaveBeenCalledWith('phone', 'claim')
  expect(localStorage.getItem('claimSecret')).toBeNull()
})
it('unmounts private content when focus detects revoked authentication', async () => {
  vi.mocked(remoteAccessApi.session).mockResolvedValueOnce({ authenticated: true }).mockResolvedValue({ authenticated: false })
  render(<RemoteAccessGate><div>Private conversations</div></RemoteAccessGate>)
  await screen.findByText('Private conversations')
  fireEvent.focus(window)
  await waitFor(() => expect(screen.queryByText('Private conversations')).not.toBeInTheDocument())
  expect(screen.getByText(/Open a new pairing QR/)).toBeInTheDocument()
})
it('handles a rejected pairing without mounting private content', async () => {
  vi.mocked(remoteAccessApi.session).mockResolvedValue({ authenticated: false })
  vi.mocked(remoteAccessApi.pair).mockResolvedValue({ id: 'phone', claimSecret: 'claim' })
  vi.mocked(remoteAccessApi.claim).mockResolvedValue({ status: 'rejected' })
  render(<RemoteAccessGate><div>Private conversations</div></RemoteAccessGate>)
  fireEvent.change(await screen.findByLabelText('Device name'), { target: { value: 'Phone' } })
  fireEvent.click(screen.getByRole('button', { name: 'Request pairing' }))
  await screen.findByText(/Open a new pairing QR/)
  expect(screen.queryByText('Private conversations')).not.toBeInTheDocument()
})

it('recovers a lost claim response by checking the cookie before replaying the claim', async () => {
  vi.mocked(remoteAccessApi.session).mockResolvedValueOnce({ authenticated: false }).mockResolvedValue({ authenticated: true })
  vi.mocked(remoteAccessApi.pair).mockResolvedValue({ id: 'phone', claimSecret: 'claim' })
  vi.mocked(remoteAccessApi.claim).mockRejectedValue(new Error('Response lost after cookie arrived'))
  render(<RemoteAccessGate><div>Private conversations</div></RemoteAccessGate>)
  fireEvent.change(await screen.findByLabelText('Device name'), { target: { value: 'Phone' } })
  fireEvent.click(screen.getByRole('button', { name: 'Request pairing' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
  await screen.findByText('Private conversations')
  expect(remoteAccessApi.claim).toHaveBeenCalledTimes(1)
  expect(remoteAccessApi.session).toHaveBeenCalledTimes(2)
})
it('retains the scrubbed one-use secret through StrictMode initial replay', async () => {
  vi.mocked(remoteAccessApi.session).mockResolvedValue({ authenticated: false })
  vi.mocked(remoteAccessApi.pair).mockResolvedValue({ id: 'phone', claimSecret: 'claim' })
  vi.mocked(remoteAccessApi.claim).mockResolvedValue({ status: 'approved' })
  render(<StrictMode><RemoteAccessGate><div>Private conversations</div></RemoteAccessGate></StrictMode>)
  expect(location.hash).toBe('')
  fireEvent.change(await screen.findByLabelText('Device name'), { target: { value: 'Phone' } })
  fireEvent.click(screen.getByRole('button', { name: 'Request pairing' }))
  await screen.findByText('Private conversations')
  expect(remoteAccessApi.pair).toHaveBeenCalledTimes(1)
  expect(remoteAccessApi.pair).toHaveBeenCalledWith('once-only', 'Phone')
})
