import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

import { MessageActionBar } from './MessageActionBar'

describe('MessageActionBar', () => {
  it('invokes a branch action only once on repeated clicks', () => {
    const onBranch = vi.fn()
    render(
      <MessageActionBar
        copyLabel="Copy reply"
        branchAction={{ label: 'Fork a new conversation', onBranch }}
      />,
    )

    const branch = screen.getByRole('button', { name: 'Fork a new conversation' })
    fireEvent.click(branch)
    fireEvent.click(branch)

    expect(onBranch).toHaveBeenCalledTimes(1)
    expect(branch).toHaveAttribute('data-variant', 'ghost')
  })

  it('announces and disables an in-flight branch action', () => {
    render(
      <MessageActionBar
        copyLabel="Copy reply"
        branchAction={{ label: 'Fork a new conversation', loading: true, onBranch: vi.fn() }}
      />,
    )

    const branch = screen.getByRole('button', { name: 'Fork a new conversation' })
    expect(branch).toBeDisabled()
    expect(branch).toHaveAttribute('aria-busy', 'true')
  })
})
