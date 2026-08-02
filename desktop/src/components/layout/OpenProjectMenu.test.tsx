import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
import { useOverlayStore } from '../../stores/overlayStore'

describe('OpenProjectMenu', () => {
  beforeEach(() => {
    useOverlayStore.setState(useOverlayStore.getInitialState(), true)
    storeMocks.ensureTargets.mockReset()
    storeMocks.openTarget.mockReset()
    storeMocks.state = {
      targets: [],
      primaryTargetId: null,
      loading: false,
      error: null,
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders a single Finder action when only file manager is detected', async () => {
    storeMocks.state.targets = [{ id: 'finder', kind: 'file_manager', label: 'Finder', icon: 'finder', platform: 'darwin' }]
    storeMocks.state.primaryTargetId = 'finder'
    storeMocks.openTarget.mockResolvedValue(undefined)

    render(<OpenProjectMenu path="/repo" />)

    await waitFor(() => expect(storeMocks.ensureTargets).toHaveBeenCalled())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open in Finder' }))
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

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open project' }))
    })
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect([
      ...Array.from(container.querySelectorAll('img')),
      ...Array.from(document.body.querySelectorAll('[role="menu"] img')),
    ].map((img) => img.getAttribute('src'))).toContain('/api/open-targets/icons/vscode')
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Finder' }))
    })

    expect(storeMocks.openTarget).toHaveBeenCalledWith('finder', '/repo')
  })

  it('keeps the native browser preview visible and positions the menu outside it', async () => {
    storeMocks.state.targets = [
      { id: 'vscode', kind: 'ide', label: 'VS Code', icon: 'vscode', platform: 'darwin' },
      { id: 'finder', kind: 'file_manager', label: 'Finder', icon: 'finder', platform: 'darwin' },
    ]
    storeMocks.state.primaryTargetId = 'vscode'

    window.innerWidth = 1000
    window.innerHeight = 800
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute('data-browser-preview-host')) {
        return domRect({ top: 150, right: 1000, bottom: 800, left: 600, width: 400, height: 650 })
      }
      if (this.getAttribute('aria-label') === 'Open project') {
        return domRect({ top: 20, right: 850, bottom: 52, left: 800, width: 50, height: 32 })
      }
      if (this.getAttribute('role') === 'menu') {
        return domRect({ width: 220, height: 400 })
      }
      return domRect({})
    })

    const { unmount } = render(
      <>
        <div data-browser-preview-host data-testid="preview-host" />
        <OpenProjectMenu path="/repo" />
      </>,
    )

    expect(useOverlayStore.getState().count).toBe(0)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open project' }))
    })

    const menu = screen.getByRole('menu')
    await waitFor(() => expect(menu).toHaveStyle({ visibility: 'visible' }))
    expect(useOverlayStore.getState().count).toBe(0)
    expect(menu).toHaveStyle({ left: '372px' })
    expect(Number.parseFloat(menu.style.left) + 220).toBeLessThanOrEqual(592)

    unmount()
    expect(useOverlayStore.getState().count).toBe(0)
  })

  it('does not render without a path', () => {
    const { container } = render(<OpenProjectMenu path={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})

function domRect(rect: Partial<DOMRect>): DOMRect {
  return {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
    ...rect,
  } as DOMRect
}
