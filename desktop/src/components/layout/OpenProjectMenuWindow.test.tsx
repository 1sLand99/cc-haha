import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { browserHost } from '@/lib/desktopHost/browserHost'
import type { DesktopHost, DesktopOpenProjectMenuState } from '@/lib/desktopHost/types'
import { OpenProjectMenuWindow } from './OpenProjectMenuWindow'

const state: DesktopOpenProjectMenuState = {
  requestId: 7,
  targets: [
    { id: 'vscode', kind: 'ide', label: 'VS Code', icon: 'vscode', platform: 'darwin' },
    { id: 'finder', kind: 'file_manager', label: 'Finder', icon: 'finder', platform: 'darwin' },
  ],
}

describe('OpenProjectMenuWindow', () => {
  afterEach(() => {
    delete window.desktopHost
    vi.restoreAllMocks()
  })

  it('reuses the exact project-menu panel and reports readiness to the native host', async () => {
    const ready = vi.fn().mockResolvedValue(undefined)
    const select = vi.fn().mockResolvedValue(undefined)
    window.desktopHost = createHost({ ready, select })

    render(<OpenProjectMenuWindow />)

    const menu = await screen.findByRole('menu')
    expect(menu).toHaveClass('glass-panel', 'min-w-[220px]', 'rounded-[var(--radius-lg)]', 'py-1')
    expect(screen.getByRole('menuitem', { name: 'VS Code' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Finder' })).toBeInTheDocument()
    await waitFor(() => expect(ready).toHaveBeenCalledWith(7))

    fireEvent.click(screen.getByRole('menuitem', { name: 'Finder' }))
    expect(select).toHaveBeenCalledWith('finder')
  })

  it('dismisses the native window on Escape', async () => {
    const dismiss = vi.fn().mockResolvedValue(undefined)
    window.desktopHost = createHost({ dismiss })

    render(<OpenProjectMenuWindow />)
    await screen.findByRole('menu')
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(dismiss).toHaveBeenCalled()
  })
})

function createHost(overrides: Partial<DesktopHost['openProjectMenu']>): DesktopHost {
  return {
    ...browserHost,
    kind: 'electron',
    isDesktop: true,
    openProjectMenu: {
      ...browserHost.openProjectMenu,
      getState: vi.fn().mockResolvedValue(state),
      onState: vi.fn().mockResolvedValue(() => {}),
      ready: vi.fn().mockResolvedValue(undefined),
      select: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    },
  }
}
