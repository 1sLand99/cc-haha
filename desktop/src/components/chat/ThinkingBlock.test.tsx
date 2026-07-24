import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

import { ThinkingBlock } from './ThinkingBlock'
import { useSettingsStore } from '../../stores/settingsStore'

describe('ThinkingBlock', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'zh' })
  })

  afterEach(() => {
    cleanup()
    useSettingsStore.setState({ locale: 'zh' })
  })

  it('shows the in-progress label while thinking is active', () => {
    render(<ThinkingBlock content="reasoning..." isActive />)
    const trigger = screen.getByRole('button')
    expect(trigger).toHaveAttribute('data-slot', 'collapsible-trigger')
    expect(trigger).toHaveAttribute('data-variant', 'ghost')
    expect(trigger).toHaveAttribute('data-state', 'closed')
    expect(trigger).toHaveTextContent('思考中')
    expect(trigger).not.toHaveTextContent('已思考')

    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('data-state', 'open')
    expect(screen.getByText('reasoning...')).toBeInTheDocument()
  })

  it('shows the done label once thinking has completed', () => {
    render(<ThinkingBlock content="reasoning..." isActive={false} />)
    expect(screen.getByRole('button')).toHaveTextContent('已思考')
    expect(screen.getByRole('button')).not.toHaveTextContent('思考中')
  })

  it('defaults to the done label when isActive is omitted', () => {
    render(<ThinkingBlock content="reasoning..." />)
    expect(screen.getByRole('button')).toHaveTextContent('已思考')
  })

  it('localizes both labels in English', () => {
    useSettingsStore.setState({ locale: 'en' })
    const { rerender } = render(<ThinkingBlock content="reasoning..." isActive />)
    expect(screen.getByRole('button')).toHaveTextContent('Thinking')
    rerender(<ThinkingBlock content="reasoning..." isActive={false} />)
    expect(screen.getByRole('button')).toHaveTextContent('Thought')
  })
})
