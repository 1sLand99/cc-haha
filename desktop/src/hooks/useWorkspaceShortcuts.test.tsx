import { fireEvent, render, renderHook } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/terminalRuntime', () => ({ destroyTerminalRuntime: vi.fn() }))
vi.mock('../lib/workspace/browserHost', () => ({ releaseWorkspaceBrowserTab: vi.fn() }))

import { useTabStore } from '../stores/tabStore'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { useWorkspaceShortcuts } from './useWorkspaceShortcuts'

const SESSION = 'session-a'

function mount(enabled = true) {
  return renderHook(() => useWorkspaceShortcuts({ sessionId: SESSION, cwd: '/repo', enabled }))
}

function press(key: string, modifiers: Partial<KeyboardEventInit> = {}) {
  fireEvent.keyDown(document, { key, ...modifiers })
}

beforeEach(() => {
  useWorkspaceStore.setState({ bySession: {} })
  useTabStore.setState({ tabs: [], activeTabId: SESSION })
  // The matcher reads the platform from the environment; jsdom reports a
  // non-mac userAgent, so Ctrl is the primary modifier in these tests.
})

describe('useWorkspaceShortcuts', () => {
  it('opens a browser tab', () => {
    mount()
    press('t', { ctrlKey: true })
    expect(useWorkspaceStore.getState().getTabs(SESSION, 'side').map((tab) => tab.kind))
      .toEqual(['browser'])
  })

  it('opens review', () => {
    mount()
    press('G', { ctrlKey: true, shiftKey: true })
    expect(useWorkspaceStore.getState().getTabs(SESSION, 'side').map((tab) => tab.kind))
      .toEqual(['review'])
  })

  it('opens the bottom terminal and hides it again', () => {
    mount()
    press('`', { ctrlKey: true })
    expect(useWorkspaceStore.getState().getTabs(SESSION, 'bottom')).toHaveLength(1)
    expect(useWorkspaceStore.getState().getSession(SESSION).bottomOpen).toBe(true)

    press('`', { ctrlKey: true })
    expect(useWorkspaceStore.getState().getSession(SESSION).bottomOpen).toBe(false)
    // Hiding keeps the shell; only closing the tab ends it.
    expect(useWorkspaceStore.getState().getTabs(SESSION, 'bottom')).toHaveLength(1)
  })

  it('always creates another shell for the explicit new-terminal key', () => {
    mount()
    press('`', { ctrlKey: true })
    press('`', { ctrlKey: true, shiftKey: true })
    expect(useWorkspaceStore.getState().getTabs(SESSION, 'bottom')).toHaveLength(2)
  })

  it('toggles the workspace and the maximised layout', () => {
    mount()
    useWorkspaceStore.getState().openTarget(SESSION, { kind: 'file', path: 'a.ts' })

    press('b', { ctrlKey: true, shiftKey: true })
    expect(useWorkspaceStore.getState().getSession(SESSION).layout).toBe('hidden')

    press('b', { ctrlKey: true, shiftKey: true })
    press('f', { ctrlKey: true, shiftKey: true })
    expect(useWorkspaceStore.getState().getSession(SESSION).layout).toBe('full')
  })

  it('closes the active tab and reopens it', () => {
    mount()
    useWorkspaceStore.getState().openTarget(SESSION, { kind: 'file', path: 'a.ts' })

    press('w', { ctrlKey: true })
    expect(useWorkspaceStore.getState().getTabs(SESSION, 'side')).toHaveLength(0)

    press('t', { ctrlKey: true, shiftKey: true })
    expect(useWorkspaceStore.getState().getTabs(SESSION, 'side')).toHaveLength(1)
  })

  it('cycles tabs', () => {
    mount()
    const first = useWorkspaceStore.getState().openTarget(SESSION, { kind: 'file', path: 'a.ts' })!
    const second = useWorkspaceStore.getState().openTarget(SESSION, { kind: 'file', path: 'b.ts' })!

    press('Tab', { ctrlKey: true })
    expect(useWorkspaceStore.getState().getSession(SESSION).activeSideTabId).toBe(first)

    press('Tab', { ctrlKey: true, shiftKey: true })
    expect(useWorkspaceStore.getState().getSession(SESSION).activeSideTabId).toBe(second)
  })

  it('leaves reserved keys to a focused terminal', () => {
    render(
      <div data-testid="workspace-terminal-host-1">
        <button type="button" data-testid="terminal-focus-target" />
      </div>,
    )
    mount()
    useWorkspaceStore.getState().openTarget(SESSION, { kind: 'file', path: 'a.ts' })
    ;(document.querySelector('[data-testid="terminal-focus-target"]') as HTMLElement).focus()

    press('w', { ctrlKey: true })

    // Ctrl+W is word-erase at a shell. Stealing it would make the terminal
    // unusable for anyone who relies on readline.
    expect(useWorkspaceStore.getState().getTabs(SESSION, 'side')).toHaveLength(1)
  })

  it('does nothing at all while the workspace is unavailable', () => {
    mount(false)
    press('t', { ctrlKey: true })
    expect(useWorkspaceStore.getState().getTabs(SESSION, 'side')).toHaveLength(0)
  })

  it('stops listening once unmounted', () => {
    const { unmount } = mount()
    unmount()
    press('t', { ctrlKey: true })
    expect(useWorkspaceStore.getState().getTabs(SESSION, 'side')).toHaveLength(0)
  })
})
