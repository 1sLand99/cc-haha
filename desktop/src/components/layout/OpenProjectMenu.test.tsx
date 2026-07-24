import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'

vi.mock('../../i18n', () => ({
  useTranslation: () => (key: string, params?: Record<string, string | number>) => {
    const template = {
      'openProject.openIn': 'Open in {target}',
      'openProject.openProject': 'Open project',
      'openProject.openFailed': 'Could not open project',
    }[key] ?? key

    if (!params) return template
    return Object.entries(params).reduce(
      (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
      template,
    )
  },
}))

const storeMocks = vi.hoisted(() => ({
  ensureTargets: vi.fn(),
  openTarget: vi.fn(),
  state: {
    targets: [] as Array<{
      id: string
      kind: 'ide' | 'file_manager'
      label: string
      icon: string
      iconUrl?: string
      platform: string
    }>,
    primaryTargetId: null as string | null,
    loading: false,
    error: null as string | null,
  },
}))

vi.mock('../../stores/openTargetStore', () => ({
  useOpenTargetStore: (
    selector: (state: typeof storeMocks.state & {
      ensureTargets: typeof storeMocks.ensureTargets
      openTarget: typeof storeMocks.openTarget
    }) => unknown,
  ) => selector({
    ...storeMocks.state,
    ensureTargets: storeMocks.ensureTargets,
    openTarget: storeMocks.openTarget,
  }),
}))

import { OpenProjectMenu } from './OpenProjectMenu'

describe('OpenProjectMenu', () => {
  beforeEach(() => {
    storeMocks.ensureTargets.mockReset()
    storeMocks.openTarget.mockReset()
    storeMocks.state = {
      targets: [],
      primaryTargetId: null,
      loading: false,
      error: null,
    }
  })

  it('renders a single Finder action when only file manager is detected', async () => {
    storeMocks.state.targets = [{ id: 'finder', kind: 'file_manager', label: 'Finder', icon: 'finder', platform: 'darwin' }]
    storeMocks.state.primaryTargetId = 'finder'
    storeMocks.openTarget.mockResolvedValue(undefined)

    render(<OpenProjectMenu path="/repo" />)

    await waitFor(() => expect(storeMocks.ensureTargets).toHaveBeenCalled())
    const trigger = screen.getByRole('button', { name: 'Open in Finder' })
    expect(trigger).toHaveAttribute('data-variant', 'outline')
    expect(trigger).toHaveAttribute('data-slot', 'tooltip-trigger')

    await act(async () => {
      fireEvent.click(trigger)
    })

    expect(storeMocks.openTarget).toHaveBeenCalledWith('finder', '/repo')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('renders a dropdown with detected IDEs and Finder', async () => {
    storeMocks.state.targets = [
      { id: 'vscode', kind: 'ide', label: 'VS Code', icon: 'vscode', iconUrl: '/api/open-targets/icons/vscode', platform: 'darwin' },
      { id: 'finder', kind: 'file_manager', label: 'Finder', icon: 'finder', iconUrl: '/api/open-targets/icons/finder', platform: 'darwin' },
    ]
    storeMocks.state.primaryTargetId = 'vscode'
    storeMocks.openTarget.mockResolvedValue(undefined)

    const { container } = render(<OpenProjectMenu path="/repo" />)

    const trigger = screen.getByRole('button', { name: 'Open project' })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getByRole('menu')).toHaveAttribute('data-slot', 'dropdown-menu-content')
    expect(trigger).toHaveAttribute('data-slot', 'dropdown-menu-trigger')
    expect([
      ...Array.from(container.querySelectorAll('img')),
      ...Array.from(document.body.querySelectorAll('[role="menu"] img')),
    ].map((img) => img.getAttribute('src'))).toContain('/api/open-targets/icons/vscode')
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Finder' }))
    })

    expect(storeMocks.openTarget).toHaveBeenCalledWith('finder', '/repo')
  })

  it('closes the shadcn menu with Escape and restores trigger focus', async () => {
    storeMocks.state.targets = [
      { id: 'vscode', kind: 'ide', label: 'VS Code', icon: 'vscode', platform: 'darwin' },
      { id: 'finder', kind: 'file_manager', label: 'Finder', icon: 'finder', platform: 'darwin' },
    ]
    storeMocks.state.primaryTargetId = 'vscode'

    render(<OpenProjectMenu path="/repo" />)

    const trigger = screen.getByRole('button', { name: 'Open project' })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(screen.getByRole('menuitem', { name: 'VS Code' })).toHaveFocus()

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('does not render without a path', () => {
    const { container } = render(<OpenProjectMenu path={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})
