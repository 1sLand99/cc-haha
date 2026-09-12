import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { WorkspaceLayoutControls } from './WorkspaceLayoutControls'

function renderControls(overrides: Partial<Parameters<typeof WorkspaceLayoutControls>[0]> = {}) {
  const props = {
    layout: 'split' as const,
    bottomOpen: false,
    onToggleFullscreen: vi.fn(),
    onToggleBottom: vi.fn(),
    onToggleWorkspace: vi.fn(),
    ...overrides,
  }
  render(<WorkspaceLayoutControls {...props} />)
  return props
}

describe('WorkspaceLayoutControls', () => {
  it('reflects only its own panel in each pressed state', () => {
    renderControls({ layout: 'split', bottomOpen: false })

    // The old toolbar tied the workspace button to the panel's *content mode*,
    // so with a browser open it still offered "show workspace" and pressing it
    // switched content instead of hiding anything.
    expect(screen.getByTestId('workspace-toggle-side')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('workspace-toggle-bottom')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('workspace-toggle-fullscreen')).toHaveAttribute('aria-pressed', 'false')
  })

  it('marks the side toggle unpressed only when the panel is hidden', () => {
    renderControls({ layout: 'hidden' })
    expect(screen.getByTestId('workspace-toggle-side')).toHaveAttribute('aria-pressed', 'false')
  })

  it('stays pressed while maximised, because the panel is still showing', () => {
    renderControls({ layout: 'full' })
    expect(screen.getByTestId('workspace-toggle-side')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('workspace-toggle-fullscreen')).toHaveAttribute('aria-pressed', 'true')
  })

  it('swaps the maximise label for a restore label once maximised', () => {
    renderControls({ layout: 'split' })
    expect(screen.getByTestId('workspace-toggle-fullscreen')).toHaveAccessibleName('Maximize workspace')
  })

  it('names the restore action when maximised', () => {
    renderControls({ layout: 'full' })
    expect(screen.getByTestId('workspace-toggle-fullscreen')).toHaveAccessibleName('Restore split view')
  })

  it('routes each button to its own handler', () => {
    const props = renderControls()

    fireEvent.click(screen.getByTestId('workspace-toggle-fullscreen'))
    fireEvent.click(screen.getByTestId('workspace-toggle-bottom'))
    fireEvent.click(screen.getByTestId('workspace-toggle-side'))

    expect(props.onToggleFullscreen).toHaveBeenCalledTimes(1)
    expect(props.onToggleBottom).toHaveBeenCalledTimes(1)
    expect(props.onToggleWorkspace).toHaveBeenCalledTimes(1)
  })
})
