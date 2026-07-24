import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

import { DayOfWeekPicker } from './DayOfWeekPicker'
import { useSettingsStore } from '../../stores/settingsStore'

afterEach(() => {
  cleanup()
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
})

describe('DayOfWeekPicker', () => {
  it('uses a labelled shadcn toggle group and reports pressed state', () => {
    useSettingsStore.setState({ locale: 'en' })
    const onChange = vi.fn()
    const { container } = render(
      <DayOfWeekPicker selected={[1, 3]} onChange={onChange} />,
    )

    expect(screen.getByRole('group', { name: 'Specific days of week' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mon' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Tue' })).toHaveAttribute('aria-pressed', 'false')
    expect(container.querySelector('[data-slot="toggle-group"]')).toBeInTheDocument()
  })

  it('does not allow clearing the final selected day', () => {
    useSettingsStore.setState({ locale: 'en' })
    const onChange = vi.fn()
    render(<DayOfWeekPicker selected={[1]} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Mon' }))
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Tue' }))
    expect(onChange).toHaveBeenCalledWith([1, 2])
  })
})
