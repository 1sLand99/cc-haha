import '@testing-library/jest-dom'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

beforeAll(() => {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: class { observe() {} unobserve() {} disconnect() {} },
  })
})

const { host, isAvailable, releaseTab, openExternal, openPath } = vi.hoisted(() => {
  const resolved = () => vi.fn().mockResolvedValue({ ok: true })
  return {
    host: {
      create: resolved(),
      navigate: resolved(),
      goBack: resolved(),
      goForward: resolved(),
      reload: resolved(),
      stop: resolved(),
      setBounds: resolved(),
      setVisible: resolved(),
      setZoom: resolved(),
      find: resolved(),
      stopFind: resolved(),
      capture: resolved(),
      message: resolved(),
      close: resolved(),
      printToPdf: resolved(),
    },
    isAvailable: vi.fn(() => true),
    releaseTab: vi.fn(),
    openExternal: vi.fn().mockResolvedValue(undefined),
    openPath: vi.fn().mockResolvedValue(undefined),
  }
})

vi.mock('../../lib/workspace/browserHost', () => ({
  workspaceBrowserHost: host,
  isWorkspaceBrowserAvailable: isAvailable,
  releaseWorkspaceBrowserTab: releaseTab,
  subscribeWorkspaceBrowserEvents: vi.fn(async () => () => {}),
}))

vi.mock('../../lib/desktopHost', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/desktopHost')>()
  return {
    ...actual,
    getDesktopHost: () => {
      const real = actual.getDesktopHost()
      return { ...real, shell: { ...real.shell, open: openExternal, openPath } }
    },
  }
})

import { WorkspaceBrowserTab } from './WorkspaceBrowserTab'
import { useOverlayStore } from '../../stores/overlayStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useWorkspaceBrowserStore } from '../../stores/workspaceBrowserStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import type { WorkspaceBrowserDownload, WorkspaceBrowserEvent } from '../../lib/desktopHost/types'
import type { WorkspaceBrowserTab as WorkspaceBrowserTabModel } from '../../lib/workspace/types'

const SESSION = 'session-a'

/**
 * Tabs come from the real controller rather than a literal, so the identities
 * the component hands to the host (`browserTabId`, `storageId`) are the ones
 * the controller actually mints, and writes back through `updateBrowserTab`
 * land where the controller would read them.
 */
function openBrowserTab(url: string | null = 'https://example.test/') {
  const tabId = useWorkspaceStore
    .getState()
    .openTarget(SESSION, { kind: 'browser', ...(url ? { url } : {}) })!
  return currentTab(tabId)
}

function currentTab(tabId: string) {
  return useWorkspaceStore.getState().getTab(SESSION, tabId) as WorkspaceBrowserTabModel
}

function emit(event: WorkspaceBrowserEvent) {
  act(() => { useWorkspaceBrowserStore.getState().applyEvent(event) })
}

function pageState(tabId: string, overrides: Partial<{
  url: string
  title: string
  canGoBack: boolean
  canGoForward: boolean
  loading: boolean
}> = {}): WorkspaceBrowserEvent {
  return {
    type: 'state',
    tabId,
    url: overrides.url ?? 'https://example.test/',
    title: overrides.title ?? 'Example',
    canGoBack: overrides.canGoBack ?? false,
    canGoForward: overrides.canGoForward ?? false,
    loading: overrides.loading ?? false,
  }
}

function download(overrides: Partial<WorkspaceBrowserDownload> = {}): WorkspaceBrowserDownload {
  return {
    id: 'dl-1',
    filename: 'report.pdf',
    savePath: '/tmp/report.pdf',
    receivedBytes: 1024,
    totalBytes: 1024,
    state: 'completed',
    ...overrides,
  }
}

function openMenuItem(name: string) {
  fireEvent.click(screen.getByTestId('workspace-browser-menu-trigger'))
  fireEvent.click(screen.getByRole('menuitem', { name }))
}

beforeEach(() => {
  useSettingsStore.setState({ locale: 'en', uiZoom: 1 })
  useWorkspaceStore.setState({ bySession: {}, sideWidth: 860, bottomHeight: 420 })
  useWorkspaceBrowserStore.setState({ pageByTabId: {}, historyByTabId: {}, downloads: [] })
  useOverlayStore.setState({ count: 0 })
  isAvailable.mockReturnValue(true)
  for (const mock of Object.values(host)) mock.mockClear()
  releaseTab.mockClear()
  openExternal.mockClear()
  openPath.mockClear()
})

afterEach(() => {
  cleanup()
})

describe('page lifetime', () => {
  it('hides the page when the component unmounts', () => {
    const tab = openBrowserTab()
    const { unmount } = render(<WorkspaceBrowserTab sessionId={SESSION} tab={tab} active />)
    host.setVisible.mockClear()

    unmount()

    // The surface renders only the active tab, so unmount is how a browser tab
    // normally goes off screen. Leaving it attached floats a live page over the
    // file viewer, the launcher, or the conversation.
    expect(host.setVisible).toHaveBeenCalledWith(expect.any(String), false)
  })

  it('hides the page while its own dropdown menu is open', () => {
    const tab = openBrowserTab()
    render(<WorkspaceBrowserTab sessionId={SESSION} tab={tab} active />)
    host.setVisible.mockClear()

    fireEvent.click(screen.getByTestId('workspace-browser-menu-trigger'))

    // The menu is a DOM sibling drawn inside the page's rectangle; a native view
    // paints above the DOM, so no z-index can rescue it.
    expect(host.setVisible).toHaveBeenLastCalledWith(expect.any(String), false)
  })

  it('does not close the page when the component unmounts', () => {
    // The single most important guarantee in this file. Hiding the panel,
    // switching tabs and switching tasks all unmount this component; the page
    // belongs to the tab and only `closeTab` may end it. The previous
    // implementation tore the page down in its cleanup, so coming back showed a
    // blank frame and lost every bit of page state.
    const tab = openBrowserTab()
    const { unmount } = render(<WorkspaceBrowserTab sessionId={SESSION} tab={tab} active />)

    unmount()

    expect(host.close).not.toHaveBeenCalled()
    expect(releaseTab).not.toHaveBeenCalled()
  })

  it('leaves closing the page to the controller', () => {
    const tab = openBrowserTab()
    const { unmount } = render(<WorkspaceBrowserTab sessionId={SESSION} tab={tab} active />)
    unmount()

    useWorkspaceStore.getState().closeTab(SESSION, tab.id)

    expect(releaseTab).toHaveBeenCalledWith(tab.browserTabId)
  })

  it('creates the page once, carrying the storage identity a restart reopens', () => {
    const tab = openBrowserTab()
    render(<WorkspaceBrowserTab sessionId={SESSION} tab={tab} active />)

    expect(host.create).toHaveBeenCalledTimes(1)
    expect(host.create).toHaveBeenCalledWith(
      tab.browserTabId,
      expect.objectContaining({ storageId: tab.storageId, url: 'https://example.test/' }),
    )
  })

  it('does not re-issue create when the tab re-renders', () => {
    // `create` is keyed on the page identity, not on the props object: a title
    // arriving from the host re-renders this component, and a second `create`
    // for a live page would reset it back to its start URL.
    const tab = openBrowserTab()
    const { rerender } = render(<WorkspaceBrowserTab sessionId={SESSION} tab={tab} active />)

    emit(pageState(tab.browserTabId, { title: 'Example Domain' }))
    act(() => {
      useWorkspaceStore
        .getState()
        .updateBrowserTab(SESSION, tab.browserTabId, { title: 'Example Domain' })
    })
    rerender(<WorkspaceBrowserTab sessionId={SESSION} tab={currentTab(tab.id)} active />)
    rerender(<WorkspaceBrowserTab sessionId={SESSION} tab={currentTab(tab.id)} active={false} />)

    expect(host.create).toHaveBeenCalledTimes(1)
  })

  it('opens a blank tab without a start URL instead of navigating somewhere', () => {
    const tab = openBrowserTab(null)
    render(<WorkspaceBrowserTab sessionId={SESSION} tab={tab} active />)

    expect(host.create).toHaveBeenCalledWith(
      tab.browserTabId,
      expect.not.objectContaining({ url: expect.anything() }),
    )
  })
})

describe('visibility', () => {
  it('attaches the page only while its tab is the active one', () => {
    const tab = openBrowserTab()
    const { rerender } = render(<WorkspaceBrowserTab sessionId={SESSION} tab={tab} active />)
    expect(host.setVisible).toHaveBeenLastCalledWith(tab.browserTabId, true)

    rerender(<WorkspaceBrowserTab sessionId={SESSION} tab={tab} active={false} />)
    expect(host.setVisible).toHaveBeenLastCalledWith(tab.browserTabId, false)

    rerender(<WorkspaceBrowserTab sessionId={SESSION} tab={tab} active />)
    expect(host.setVisible).toHaveBeenLastCalledWith(tab.browserTabId, true)
  })

  it('hides the page while a fullscreen DOM overlay is up', () => {
    // A native view always paints above the DOM, so an image modal opened over
    // the workspace would otherwise be covered by the page.
    const tab = openBrowserTab()
    render(<WorkspaceBrowserTab sessionId={SESSION} tab={tab} active />)

    act(() => { useOverlayStore.getState().push() })
    expect(host.setVisible).toHaveBeenLastCalledWith(tab.browserTabId, false)

    act(() => { useOverlayStore.getState().pop() })
    expect(host.setVisible).toHaveBeenLastCalledWith(tab.browserTabId, true)
  })

  it('hides the page while its own downloads overlay is open', () => {
    // Same reason, for the overlays this component draws itself: the downloads
    // and history sheets are DOM, and the page would paint straight over them.
    const tab = openBrowserTab()
    render(<WorkspaceBrowserTab sessionId={SESSION} tab={tab} active />)

    openMenuItem('Downloads')
    expect(screen.getByTestId('workspace-browser-panel-downloads')).toBeInTheDocument()
    expect(host.setVisible).toHaveBeenLastCalledWith(tab.browserTabId, false)

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(host.setVisible).toHaveBeenLastCalledWith(tab.browserTabId, true)
  })
})

describe('navigation controls', () => {
  it('keeps back and forward disabled until the host reports real history', () => {
    // Native history is the source of truth. The previous implementation kept
    // its own array in the renderer, which disagreed with the page after any
    // redirect or in-page navigation.
    const tab = openBrowserTab()
    render(<WorkspaceBrowserTab sessionId={SESSION} tab={tab} active />)

    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Forward' })).toBeDisabled()

    emit(pageState(tab.browserTabId, { canGoBack: true }))

    expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Forward' })).toBeDisabled()
  })

  it('asks the host to go back and forward rather than navigating a remembered URL', () => {
    const tab = openBrowserTab()
    render(<WorkspaceBrowserTab sessionId={SESSION} tab={tab} active />)
    emit(pageState(tab.browserTabId, { canGoBack: true, canGoForward: true }))

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    fireEvent.click(screen.getByRole('button', { name: 'Forward' }))

    expect(host.goBack).toHaveBeenCalledWith(tab.browserTabId)
    expect(host.goForward).toHaveBeenCalledWith(tab.browserTabId)
    expect(host.navigate).not.toHaveBeenCalled()
  })

  it('turns reload into stop while the page is loading', () => {
    const tab = openBrowserTab()
    render(<WorkspaceBrowserTab sessionId={SESSION} tab={tab} active />)

    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(host.reload).toHaveBeenCalledTimes(1)

    emit(pageState(tab.browserTabId, { loading: true }))

    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Stop loading' }))
    expect(host.stop).toHaveBeenCalledWith(tab.browserTabId)
    expect(host.reload).toHaveBeenCalledTimes(1)
  })

  it('navigates to the address the user typed', () => {
    const tab = openBrowserTab()
    render(<WorkspaceBrowserTab sessionId={SESSION} tab={tab} active />)

    const address = screen.getByTestId('workspace-browser-address')
    fireEvent.change(address, { target: { value: 'https://other.test/docs' } })
    fireEvent.submit(address.closest('form')!)

    expect(host.navigate).toHaveBeenCalledWith(tab.browserTabId, 'https://other.test/docs')
  })

  it('ignores an empty address instead of navigating to nothing', () => {
    const tab = openBrowserTab()
    render(<WorkspaceBrowserTab sessionId={SESSION} tab={tab} active />)

    const address = screen.getByTestId('workspace-browser-address')
    fireEvent.change(address, { target: { value: '   ' } })
    fireEvent.submit(address.closest('form')!)

    expect(host.navigate).not.toHaveBeenCalled()
  })
})

describe('load failures', () => {
  it('offers a retry that clears the error and reloads the page', () => {
    const tab = openBrowserTab()
    act(() => {
      useWorkspaceStore
        .getState()
        .updateBrowserTab(SESSION, tab.browserTabId, { loadError: 'ERR_CONNECTION_REFUSED' })
    })
    render(<WorkspaceBrowserTab sessionId={SESSION} tab={currentTab(tab.id)} active />)

    const error = screen.getByTestId('workspace-browser-error')
    expect(error).toHaveTextContent('ERR_CONNECTION_REFUSED')
    expect(error).toHaveTextContent('https://example.test/')

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    // The error is the tab's, so clearing it has to go through the controller —
    // a local `useState` would leave the tab strip showing a failed tab.
    expect(currentTab(tab.id).loadError).toBeNull()
    expect(host.reload).toHaveBeenCalledWith(tab.browserTabId, { ignoreCache: true })
  })

  it('shows the start-browsing hint only while the tab has neither URL nor error', () => {
    const tab = openBrowserTab(null)
    const { rerender } = render(<WorkspaceBrowserTab sessionId={SESSION} tab={tab} active />)
    expect(screen.getByText('Start browsing')).toBeInTheDocument()

    act(() => {
      useWorkspaceStore
        .getState()
        .updateBrowserTab(SESSION, tab.browserTabId, { loadError: 'ERR_FAILED' })
    })
    rerender(<WorkspaceBrowserTab sessionId={SESSION} tab={currentTab(tab.id)} active />)

    expect(screen.queryByText('Start browsing')).toBeNull()
    expect(screen.getByTestId('workspace-browser-error')).toBeInTheDocument()
  })
})

describe('find in page', () => {
  it('searches as the user types and shows the host match counter', () => {
    const tab = openBrowserTab()
    render(<WorkspaceBrowserTab sessionId={SESSION} tab={tab} active />)

    openMenuItem('Find in page')
    const input = screen.getByRole('textbox', { name: 'Find in page' })
    fireEvent.change(input, { target: { value: 'needle' } })

    expect(host.find).toHaveBeenCalledWith(tab.browserTabId, 'needle', {
      findNext: false,
      forward: true,
    })

    emit({ type: 'found', tabId: tab.browserTabId, activeMatchOrdinal: 2, matches: 7 })
    expect(screen.getByTestId('workspace-browser-find')).toHaveTextContent('2/7')
  })

  it('steps to the next match on Enter', () => {
    const tab = openBrowserTab()
    render(<WorkspaceBrowserTab sessionId={SESSION} tab={tab} active />)

    openMenuItem('Find in page')
    const input = screen.getByRole('textbox', { name: 'Find in page' })
    fireEvent.change(input, { target: { value: 'needle' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(host.find).toHaveBeenLastCalledWith(tab.browserTabId, 'needle', {
      findNext: true,
      forward: true,
    })
  })

  it('stops the search when the query is emptied', () => {
    // An empty query is not a search for "": leaving the host's find session
    // open keeps the previous matches highlighted on the page.
    const tab = openBrowserTab()
    render(<WorkspaceBrowserTab sessionId={SESSION} tab={tab} active />)

    openMenuItem('Find in page')
    const input = screen.getByRole('textbox', { name: 'Find in page' })
    fireEvent.change(input, { target: { value: 'needle' } })
    fireEvent.change(input, { target: { value: '' } })

    expect(host.stopFind).toHaveBeenCalledWith(tab.browserTabId)
  })

  it('closes the bar and stops the search on Escape', () => {
    const tab = openBrowserTab()
    render(<WorkspaceBrowserTab sessionId={SESSION} tab={tab} active />)

    openMenuItem('Find in page')
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Find in page' }), { key: 'Escape' })

    expect(screen.queryByTestId('workspace-browser-find')).toBeNull()
    expect(host.stopFind).toHaveBeenCalledWith(tab.browserTabId)
  })
})

describe('overlays', () => {
  it('lists downloads with a route to the saved file', () => {
    const tab = openBrowserTab()
    render(<WorkspaceBrowserTab sessionId={SESSION} tab={tab} active />)
    emit({ type: 'download', tabId: tab.browserTabId, download: download() })

    openMenuItem('Downloads')
    expect(screen.getByText('report.pdf')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open downloaded file' }))
    expect(openPath).toHaveBeenCalledWith('/tmp/report.pdf')
  })

  it('replays a visit from the history overlay through the address pipeline', () => {
    const tab = openBrowserTab()
    render(<WorkspaceBrowserTab sessionId={SESSION} tab={tab} active />)
    emit(pageState(tab.browserTabId, { url: 'https://visited.test/', title: 'Visited' }))

    openMenuItem('History')
    fireEvent.click(screen.getByRole('button', { name: /Visited/ }))

    expect(host.navigate).toHaveBeenCalledWith(tab.browserTabId, 'https://visited.test/')
    expect(screen.queryByTestId('workspace-browser-panel-history')).toBeNull()
  })

  it('says so when there is nothing to show rather than rendering an empty sheet', () => {
    const tab = openBrowserTab()
    render(<WorkspaceBrowserTab sessionId={SESSION} tab={tab} active />)

    openMenuItem('History')
    expect(screen.getByText('No pages visited yet')).toBeInTheDocument()
  })
})

describe('hosts without a native browser view', () => {
  it('renders the degraded state instead of chrome around an empty frame', () => {
    // A plain browser or the H5 build has no `webContents`. Drawing the normal
    // toolbar and stage there would show a permanently blank frame that reads
    // as a page which failed to paint — the host calls themselves resolve to a
    // typed `unsupported` failure, so nothing behind this ever succeeds.
    isAvailable.mockReturnValue(false)
    const tab = openBrowserTab()
    render(<WorkspaceBrowserTab sessionId={SESSION} tab={tab} active />)

    expect(screen.getByTestId('workspace-browser-unavailable')).toBeInTheDocument()
    expect(screen.queryByTestId('workspace-browser-toolbar')).toBeNull()
    expect(screen.queryByTestId('workspace-browser-stage')).toBeNull()
    expect(screen.queryByTestId('workspace-browser-address')).toBeNull()
  })

  it('hands the URL to the system browser instead', () => {
    isAvailable.mockReturnValue(false)
    const tab = openBrowserTab()
    render(<WorkspaceBrowserTab sessionId={SESSION} tab={tab} active />)

    fireEvent.click(screen.getByRole('button', { name: 'Open in system browser' }))
    expect(openExternal).toHaveBeenCalledWith('https://example.test/')
  })

  it('offers no external route for a blank tab, which has nothing to open', () => {
    isAvailable.mockReturnValue(false)
    const tab = openBrowserTab(null)
    render(<WorkspaceBrowserTab sessionId={SESSION} tab={tab} active />)

    expect(screen.getByTestId('workspace-browser-unavailable')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open in system browser' })).toBeNull()
  })
})
