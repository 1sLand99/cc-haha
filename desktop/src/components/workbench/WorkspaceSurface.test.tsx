import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  subscribeWorkspaceBrowserEvents: vi.fn(),
  releaseWorkspaceBrowserTab: vi.fn(),
  isWorkspaceBrowserAvailable: vi.fn(() => false),
  workspaceBrowserHost: {
    create: vi.fn(async () => ({ ok: true })),
    setVisible: vi.fn(async () => ({ ok: true })),
    setBounds: vi.fn(async () => ({ ok: true })),
    close: vi.fn(async () => ({ ok: true })),
  },
}))

vi.mock('../../lib/workspace/browserHost', () => ({
  subscribeWorkspaceBrowserEvents: mocks.subscribeWorkspaceBrowserEvents,
  releaseWorkspaceBrowserTab: mocks.releaseWorkspaceBrowserTab,
  isWorkspaceBrowserAvailable: mocks.isWorkspaceBrowserAvailable,
  workspaceBrowserHost: mocks.workspaceBrowserHost,
}))

vi.mock('../../pages/TerminalSettings', () => ({
  TerminalSettings: ({ testId }: { testId: string }) => <div data-testid={testId} />,
}))

vi.mock('../../api/sessions', () => ({
  sessionsApi: {
    getWorkspaceTree: vi.fn(async () => ({ state: 'ok', path: '', entries: [] })),
    getWorkspaceFile: vi.fn(async () => ({ state: 'ok', path: '', content: '', language: 'text', size: 0 })),
    getWorkspaceStatus: vi.fn(),
  },
}))

vi.mock('../../api/review', () => ({
  reviewApi: {
    getStatus: vi.fn(async () => ({
      state: 'ok',
      source: { kind: 'unstaged' },
      snapshot: 's1',
      files: [],
      untracked: [],
      totals: { additions: 0, deletions: 0, files: 0 },
    })),
    getDiff: vi.fn(),
    stage: vi.fn(),
    unstage: vi.fn(),
    stageHunk: vi.fn(),
    unstageHunk: vi.fn(),
    revert: vi.fn(),
  },
}))

import { useTabStore } from '../../stores/tabStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { WorkspaceSurface, useWorkspaceBrowserEventBridge } from './WorkspaceSurface'
import type { WorkspaceBrowserTab } from '../../lib/workspace/types'

const SESSION = 'session-a'

function renderSurface(props: Partial<Parameters<typeof WorkspaceSurface>[0]> = {}) {
  return render(
    <WorkspaceSurface sessionId={SESSION} dock="side" cwd="/repo" {...props} />,
  )
}

beforeEach(() => {
  useWorkspaceStore.setState({ bySession: {} })
  useTabStore.setState({ tabs: [], activeTabId: SESSION })
  mocks.subscribeWorkspaceBrowserEvents.mockReset()
  mocks.subscribeWorkspaceBrowserEvents.mockResolvedValue(() => {})
})

afterEach(() => {
  cleanup()
})

describe('WorkspaceSurface', () => {
  it('shows the four-entry launcher when the workspace is empty', () => {
    renderSurface()
    expect(screen.getByTestId('workspace-launcher')).toBeInTheDocument()
    // The strip is present even with nothing open, so the panel always says
    // what it holds.
    expect(screen.getByTestId('workspace-tab-strip-side')).toBeInTheDocument()
  })

  it('opens the chosen kind from the launcher', () => {
    renderSurface()
    act(() => {
      fireEvent.click(screen.getByTestId('workspace-launcher-terminal'))
    })

    const tabs = useWorkspaceStore.getState().getTabs(SESSION, 'side')
    expect(tabs).toHaveLength(1)
    expect(tabs[0]).toMatchObject({ kind: 'terminal', cwd: '/repo' })
  })

  it('re-opens the picker from the plus button and leaves no empty tab if nothing is chosen', () => {
    renderSurface()
    act(() => {
      fireEvent.click(screen.getByTestId('workspace-launcher-terminal'))
    })
    expect(screen.queryByTestId('workspace-launcher')).toBeNull()

    act(() => {
      fireEvent.click(screen.getByTestId('workspace-add-tab-side'))
    })
    expect(screen.getByTestId('workspace-launcher')).toBeInTheDocument()
    // Cancelling by choosing nothing must not leave a placeholder behind.
    expect(useWorkspaceStore.getState().getTabs(SESSION, 'side')).toHaveLength(1)
  })

  it('lets the picker be cancelled instead of trapping the panel', () => {
    renderSurface()
    act(() => { fireEvent.click(screen.getByTestId('workspace-launcher-terminal')) })
    act(() => { fireEvent.click(screen.getByTestId('workspace-add-tab-side')) })
    expect(screen.getByTestId('workspace-picker')).toBeInTheDocument()

    act(() => { fireEvent.click(screen.getByTestId('workspace-picker-cancel')) })

    // Without a way out, pressing `+` covered the active tab's content and the
    // only escape was to open a fifth thing.
    expect(screen.queryByTestId('workspace-picker')).toBeNull()
    expect(screen.getByTestId('workspace-terminal-host-1')).toBeInTheDocument()
    expect(useWorkspaceStore.getState().getTabs(SESSION, 'side')).toHaveLength(1)
  })

  it('cancels the picker when an existing tab is chosen instead', () => {
    renderSurface()
    act(() => { fireEvent.click(screen.getByTestId('workspace-launcher-terminal')) })
    const terminalTabId = useWorkspaceStore.getState().getTabs(SESSION, 'side')[0]!.id
    act(() => { fireEvent.click(screen.getByTestId('workspace-add-tab-side')) })

    act(() => { fireEvent.click(screen.getByTestId(`workspace-tab-${terminalTabId}`)) })

    expect(screen.queryByTestId('workspace-picker')).toBeNull()
  })

  it('offers only terminals in the bottom dock', () => {
    render(<WorkspaceSurface sessionId={SESSION} dock="bottom" cwd="/repo" showLayoutControls={false} />)

    // Offering a browser here would quietly open the page in the *side* panel.
    expect(screen.getByTestId('workspace-launcher-terminal')).toBeEnabled()
    expect(screen.queryByTestId('workspace-launcher-review')).toBeNull()
    expect(screen.queryByTestId('workspace-launcher-browser')).toBeNull()
    expect(screen.queryByTestId('workspace-launcher-file')).toBeNull()
  })

  it('offers the three layout entry points only where they belong', () => {
    const { unmount } = renderSurface()
    expect(screen.getByTestId('workspace-toggle-side')).toBeInTheDocument()
    unmount()

    render(
      <WorkspaceSurface
        sessionId={SESSION}
        dock="bottom"
        cwd="/repo"
        showLayoutControls={false}
        onHidePanel={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('workspace-toggle-side')).toBeNull()
    expect(screen.getByTestId('workspace-hide-bottom')).toBeInTheDocument()
  })

  it('hides the panel from its own layout control', () => {
    renderSurface()
    act(() => {
      fireEvent.click(screen.getByTestId('workspace-launcher-terminal'))
    })
    act(() => {
      fireEvent.click(screen.getByTestId('workspace-toggle-side'))
    })

    expect(useWorkspaceStore.getState().getSession(SESSION).layout).toBe('hidden')
    // Hiding keeps the tab and its PTY; only closing the tab ends them.
    expect(useWorkspaceStore.getState().getTabs(SESSION, 'side')).toHaveLength(1)
  })

  it('maximises and restores without creating or destroying anything', () => {
    renderSurface()
    act(() => {
      fireEvent.click(screen.getByTestId('workspace-launcher-terminal'))
    })
    const before = useWorkspaceStore.getState().getTabs(SESSION, 'side')

    act(() => { fireEvent.click(screen.getByTestId('workspace-toggle-fullscreen')) })
    expect(useWorkspaceStore.getState().getSession(SESSION).layout).toBe('full')

    act(() => { fireEvent.click(screen.getByTestId('workspace-toggle-fullscreen')) })
    expect(useWorkspaceStore.getState().getSession(SESSION).layout).toBe('split')
    expect(useWorkspaceStore.getState().getTabs(SESSION, 'side')).toEqual(before)
  })

  it('renders only the active tab and switches content on activation', () => {
    renderSurface()
    act(() => { fireEvent.click(screen.getByTestId('workspace-launcher-terminal')) })
    act(() => { fireEvent.click(screen.getByTestId('workspace-add-tab-side')) })
    act(() => { fireEvent.click(screen.getByTestId('workspace-launcher-review')) })

    expect(screen.getByTestId('workspace-review-toolbar')).toBeInTheDocument()
    expect(screen.queryByTestId('workspace-terminal-host-1')).toBeNull()

    const terminalTabId = useWorkspaceStore.getState().getTabs(SESSION, 'side')[0]!.id
    act(() => { fireEvent.click(screen.getByTestId(`workspace-tab-${terminalTabId}`)) })

    expect(screen.getByTestId('workspace-terminal-host-1')).toBeInTheDocument()
  })
})

describe('useWorkspaceBrowserEventBridge', () => {
  function emit(event: unknown) {
    const handler = mocks.subscribeWorkspaceBrowserEvents.mock.calls.at(-1)?.[0] as
      | ((value: unknown) => void)
      | undefined
    act(() => { handler?.(event) })
  }

  it('records a committed navigation on the tab that owns the page', async () => {
    const tabId = useWorkspaceStore.getState().openTarget(SESSION, { kind: 'browser' })!
    const browserTabId = (useWorkspaceStore.getState().getTab(SESSION, tabId) as WorkspaceBrowserTab).browserTabId

    renderHook(() => useWorkspaceBrowserEventBridge(true))
    await act(async () => { await Promise.resolve() })

    emit({
      type: 'state',
      tabId: browserTabId,
      url: 'http://localhost:3000/',
      title: 'Dev',
      canGoBack: false,
      canGoForward: false,
      loading: false,
    })

    expect(useWorkspaceStore.getState().getTab(SESSION, tabId))
      .toMatchObject({ url: 'http://localhost:3000/', title: 'Dev' })
  })

  it('turns a popup into a sibling tab rather than an OS window', async () => {
    const tabId = useWorkspaceStore.getState().openTarget(SESSION, { kind: 'browser' })!
    const browserTabId = (useWorkspaceStore.getState().getTab(SESSION, tabId) as WorkspaceBrowserTab).browserTabId

    renderHook(() => useWorkspaceBrowserEventBridge(true))
    await act(async () => { await Promise.resolve() })

    emit({ type: 'new-window', tabId: browserTabId, url: 'https://example.test/popup' })

    const tabs = useWorkspaceStore.getState().getTabs(SESSION, 'side')
    expect(tabs).toHaveLength(2)
    expect(tabs[1]).toMatchObject({ kind: 'browser', url: 'https://example.test/popup' })
  })

  it('keeps a failure on the page that failed', async () => {
    const first = useWorkspaceStore.getState().openTarget(SESSION, { kind: 'browser', url: 'http://a.test/' })!
    const second = useWorkspaceStore.getState().openTarget(SESSION, { kind: 'browser', url: 'http://b.test/' })!
    const firstBrowserTabId = (useWorkspaceStore.getState().getTab(SESSION, first) as WorkspaceBrowserTab).browserTabId

    renderHook(() => useWorkspaceBrowserEventBridge(true))
    await act(async () => { await Promise.resolve() })

    emit({
      type: 'failed',
      tabId: firstBrowserTabId,
      url: 'http://a.test/',
      errorCode: -105,
      errorDescription: 'NAME_NOT_RESOLVED',
    })

    expect(useWorkspaceStore.getState().getTab(SESSION, first))
      .toMatchObject({ loadError: 'NAME_NOT_RESOLVED' })
    expect(useWorkspaceStore.getState().getTab(SESSION, second)).toMatchObject({ loadError: null })
  })

  it('routes an event to the task that owns the page, not the task on screen', async () => {
    const OTHER = 'session-b'
    const backgroundTab = useWorkspaceStore.getState().openTarget(OTHER, { kind: 'browser' })!
    const backgroundBrowserTabId = (useWorkspaceStore.getState()
      .getTab(OTHER, backgroundTab) as WorkspaceBrowserTab).browserTabId
    // `session-a` is the foreground task throughout.
    useTabStore.setState({ tabs: [], activeTabId: SESSION })

    renderHook(() => useWorkspaceBrowserEventBridge(true))
    await act(async () => { await Promise.resolve() })

    emit({
      type: 'state',
      tabId: backgroundBrowserTabId,
      url: 'http://background.test/',
      title: 'Background',
      canGoBack: false,
      canGoForward: false,
      loading: false,
    })

    // Routing by the foreground task would silently drop this.
    expect(useWorkspaceStore.getState().getTab(OTHER, backgroundTab))
      .toMatchObject({ url: 'http://background.test/', title: 'Background' })
  })

  it('opens a popup in the task whose page asked for it', async () => {
    const OTHER = 'session-b'
    const backgroundTab = useWorkspaceStore.getState().openTarget(OTHER, { kind: 'browser' })!
    const backgroundBrowserTabId = (useWorkspaceStore.getState()
      .getTab(OTHER, backgroundTab) as WorkspaceBrowserTab).browserTabId
    useTabStore.setState({ tabs: [], activeTabId: SESSION })

    renderHook(() => useWorkspaceBrowserEventBridge(true))
    await act(async () => { await Promise.resolve() })

    emit({ type: 'new-window', tabId: backgroundBrowserTabId, url: 'https://popup.test/' })

    // A background page's popup must not appear in the task the user is reading.
    expect(useWorkspaceStore.getState().getTabs(SESSION, 'side')).toHaveLength(0)
    expect(useWorkspaceStore.getState().getTabs(OTHER, 'side')).toHaveLength(2)
  })

  it('drops an event for a page that has already been closed', async () => {
    const first = useWorkspaceStore.getState().openTarget(SESSION, { kind: 'browser', url: 'http://a.test/' })!
    const closedBrowserTabId = (useWorkspaceStore.getState().getTab(SESSION, first) as WorkspaceBrowserTab).browserTabId
    useWorkspaceStore.getState().closeTab(SESSION, first)
    const second = useWorkspaceStore.getState().openTarget(SESSION, { kind: 'browser', url: 'http://b.test/' })!

    renderHook(() => useWorkspaceBrowserEventBridge(true))
    await act(async () => { await Promise.resolve() })

    emit({
      type: 'state',
      tabId: closedBrowserTabId,
      url: 'http://a.test/late',
      title: 'Late',
      canGoBack: false,
      canGoForward: false,
      loading: false,
    })

    // The slot the closed page occupied now belongs to another page; a late
    // event must not repaint it.
    expect(useWorkspaceStore.getState().getTab(SESSION, second)).toMatchObject({ url: 'http://b.test/' })
  })
})
