import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ToolCallBlock } from './ToolCallBlock'
import { ToolResultBlock } from './ToolResultBlock'

describe('tool transcript controls', () => {
  it('uses the shared button for expandable tool calls', () => {
    render(
      <ToolCallBlock
        toolName="Read"
        input={{ file_path: '/tmp/example.ts' }}
        result={{ content: 'const ready = true', isError: false }}
      />,
    )

    const trigger = screen.getAllByRole('button')[0]!
    expect(trigger).toHaveAttribute('data-slot', 'button')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('const ready = true')).toBeInTheDocument()
  })

  it('uses shared buttons and badges for standalone tool results', () => {
    render(
      <ToolResultBlock
        toolName="Bash"
        content={'result '.repeat(50)}
        isError={false}
      />,
    )

    const [header, showMore] = screen.getAllByRole('button')
    expect(header).toHaveAttribute('data-slot', 'button')
    expect(header).toHaveAttribute('aria-expanded', 'false')
    expect(showMore).toHaveAttribute('data-slot', 'button')
    expect(document.querySelector('[data-slot="badge"]')).not.toBeNull()

    fireEvent.click(header!)
    expect(header).toHaveAttribute('aria-expanded', 'true')
  })
})
