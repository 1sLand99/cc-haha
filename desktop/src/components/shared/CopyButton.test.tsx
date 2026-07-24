import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

const { copyMock } = vi.hoisted(() => ({
  copyMock: vi.fn(),
}))

vi.mock('../chat/clipboard', () => ({
  copyTextToClipboard: copyMock,
}))

import { CopyButton } from './CopyButton'

afterEach(() => {
  vi.useRealTimers()
  copyMock.mockReset()
})

describe('CopyButton', () => {
  it('uses the shadcn Button and resets the success label after 1.5 seconds', async () => {
    vi.useFakeTimers()
    copyMock.mockResolvedValue(true)
    render(<CopyButton text="copy me" />)

    const button = screen.getByRole('button', { name: 'Copy' })
    expect(button).toHaveAttribute('data-slot', 'button')
    fireEvent.click(button)
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1500)
    })
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
  })

  it.each([
    ['false result', () => Promise.resolve(false)],
    ['rejection', () => Promise.reject(new Error('clipboard unavailable'))],
  ])('does not show a copied state after %s', async (_label, result) => {
    copyMock.mockImplementation(result)
    render(<CopyButton text="copy me" />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))

    await waitFor(() => expect(copyMock).toHaveBeenCalledWith('copy me'))
    expect(screen.queryByRole('button', { name: 'Copied' })).not.toBeInTheDocument()
  })
})
