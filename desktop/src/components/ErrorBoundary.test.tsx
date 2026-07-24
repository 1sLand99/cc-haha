import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

import { useSettingsStore } from '../stores/settingsStore'
import { ErrorBoundary } from './ErrorBoundary'
import { reportReactError } from '../lib/diagnosticsCapture'

const doctorMockState = vi.hoisted(() => ({ shouldCrash: false }))

vi.mock('../lib/diagnosticsCapture', () => ({
  reportReactError: vi.fn(),
}))

vi.mock('./doctor/DoctorPanel', () => ({
  DoctorPanel: ({ compact }: { compact?: boolean }) => {
    if (doctorMockState.shouldCrash) {
      throw new Error('doctor unavailable')
    }
    return <div data-testid="doctor-panel">{compact ? 'compact doctor' : 'doctor'}</div>
  },
}))

function CrashingChild(): never {
  throw new Error('boom')
}

describe('ErrorBoundary', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    doctorMockState.shouldCrash = false
    vi.clearAllMocks()
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it('shows retry and compact Doctor fallback when a child crashes', () => {
    render(
      <ErrorBoundary>
        <CrashingChild />
      </ErrorBoundary>,
    )

    expect(screen.getByText('Something went wrong.')).toBeInTheDocument()
    expect(screen.getByText('The error was recorded in Diagnostics.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.getByTestId('doctor-panel')).toHaveTextContent('compact doctor')
    expect(screen.getByRole('button', { name: 'Retry' })).toHaveAttribute('data-slot', 'button')
    expect(screen.getByRole('button', { name: 'Retry' })).toHaveFocus()
    expect(document.querySelector('[data-custom-slot="startup-surface"]')).toBeInTheDocument()
    expect(reportReactError).toHaveBeenCalled()
  })

  it('keeps the retry fallback usable when the diagnostics panel also crashes', () => {
    doctorMockState.shouldCrash = true

    render(
      <ErrorBoundary>
        <CrashingChild />
      </ErrorBoundary>,
    )

    expect(screen.getByText('Something went wrong.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.queryByTestId('doctor-panel')).not.toBeInTheDocument()
    expect(reportReactError).toHaveBeenCalledTimes(2)
  })
})
