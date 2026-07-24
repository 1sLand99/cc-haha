import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { saveAndVerifyH5Connection } from '../../lib/desktopRuntime'
import { H5ConnectionView } from './H5ConnectionView'

vi.mock('../../lib/desktopRuntime', () => ({
  saveAndVerifyH5Connection: vi.fn(),
}))

describe('H5ConnectionView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the shared startup form primitives and focuses the missing token', () => {
    render(
      <H5ConnectionView
        initialServerUrl="https://chat.example.com"
        error="Enter your H5 token to continue."
        onConnected={vi.fn()}
      />,
    )

    expect(document.querySelector('[data-custom-slot="startup-surface"]')).toBeInTheDocument()
    expect(screen.getByLabelText('Server URL')).toHaveAttribute('data-slot', 'input')
    expect(screen.getByLabelText('H5 Token')).toHaveAttribute('data-slot', 'input')
    expect(screen.getByLabelText('H5 Token')).toHaveFocus()
    expect(screen.getByRole('alert')).toHaveAttribute('data-slot', 'alert')
    expect(screen.getByRole('button', { name: 'Connect' })).toHaveAttribute(
      'data-slot',
      'button',
    )
  })

  it('focuses the connection error after a failed submission', async () => {
    vi.mocked(saveAndVerifyH5Connection).mockRejectedValueOnce(
      new Error('The H5 token is invalid or expired.'),
    )

    render(
      <H5ConnectionView
        initialServerUrl="https://chat.example.com"
        onConnected={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByLabelText('H5 Token'), {
      target: { value: 'h5_expired' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The H5 token is invalid or expired.')
    await waitFor(() => expect(alert).toHaveFocus())
  })

  it('connects with the entered credentials and hands control back to bootstrap', async () => {
    const onConnected = vi.fn()
    vi.mocked(saveAndVerifyH5Connection).mockResolvedValueOnce('https://chat.example.com')

    render(<H5ConnectionView onConnected={onConnected} />)

    fireEvent.change(screen.getByLabelText('Server URL'), {
      target: { value: 'https://chat.example.com' },
    })
    fireEvent.change(screen.getByLabelText('H5 Token'), {
      target: { value: 'h5_valid' },
    })
    fireEvent.submit(screen.getByRole('button', { name: 'Connect' }).closest('form')!)

    await waitFor(() => {
      expect(saveAndVerifyH5Connection).toHaveBeenCalledWith(
        'https://chat.example.com',
        'h5_valid',
      )
      expect(onConnected).toHaveBeenCalledTimes(1)
    })
  })
})
