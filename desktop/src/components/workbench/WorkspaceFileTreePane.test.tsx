import { act, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getWorkspaceTree: vi.fn(),
}))

vi.mock('../../api/sessions', () => ({
  sessionsApi: {
    getWorkspaceTree: mocks.getWorkspaceTree,
    getWorkspaceFile: vi.fn(),
    getWorkspaceStatus: vi.fn(),
  },
}))

import { useWorkspaceContentStore } from '../../stores/workspaceContentStore'
import { WorkspaceFileTreePane } from './WorkspaceFileTreePane'

const SESSION = 'session-a'

const ROOT = {
  state: 'ok' as const,
  path: '',
  entries: [
    { name: 'src', path: 'src', isDirectory: true },
    { name: 'README.md', path: 'README.md', isDirectory: false },
  ],
}

const SRC = {
  state: 'ok' as const,
  path: 'src',
  entries: [
    { name: 'adapters.ts', path: 'src/adapters.ts', isDirectory: false },
    { name: 'client.ts', path: 'src/client.ts', isDirectory: false },
  ],
}

async function renderPane(onOpen = vi.fn()) {
  const view = render(
    <WorkspaceFileTreePane sessionId={SESSION} selectedPath={null} onOpen={onOpen} />,
  )
  await act(async () => { await Promise.resolve() })
  return { ...view, onOpen }
}

beforeEach(() => {
  vi.useRealTimers()
  useWorkspaceContentStore.setState({
    filesByKey: {},
    treeByKey: {},
    treeLoadingByKey: {},
    expandedBySession: {},
    statusBySession: {},
  })
  mocks.getWorkspaceTree.mockReset()
  mocks.getWorkspaceTree.mockImplementation(async (_session: string, path: string) =>
    path === 'src' ? SRC : ROOT)
})

describe('WorkspaceFileTreePane', () => {
  it('lists the workspace root on mount', async () => {
    await renderPane()
    expect(screen.getByTestId('workspace-tree-row-src')).toBeInTheDocument()
    expect(screen.getByTestId('workspace-tree-row-README.md')).toBeInTheDocument()
  })

  it('expands a directory in place rather than replacing the view', async () => {
    await renderPane()

    await act(async () => {
      fireEvent.click(screen.getByTestId('workspace-tree-row-src'))
      await Promise.resolve()
    })

    expect(screen.getByTestId('workspace-tree-row-src')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('workspace-tree-row-src/adapters.ts')).toBeInTheDocument()
    // The root stays listed: the tree is a sibling of the content, not a mode.
    expect(screen.getByTestId('workspace-tree-row-README.md')).toBeInTheDocument()
  })

  it('previews on a single click and pins on a double click', async () => {
    vi.useFakeTimers()
    const onOpen = vi.fn()
    render(<WorkspaceFileTreePane sessionId={SESSION} selectedPath={null} onOpen={onOpen} />)
    await act(async () => { await Promise.resolve() })

    fireEvent.click(screen.getByTestId('workspace-tree-row-README.md'))
    act(() => { vi.advanceTimersByTime(300) })
    expect(onOpen).toHaveBeenCalledWith('README.md', { preview: true })

    onOpen.mockClear()
    // A double click must pin *instead of* previewing first — otherwise the file
    // is read twice and the tab flickers from italic to upright.
    fireEvent.click(screen.getByTestId('workspace-tree-row-README.md'))
    fireEvent.click(screen.getByTestId('workspace-tree-row-README.md'))
    act(() => { vi.advanceTimersByTime(300) })

    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledWith('README.md', { preview: false })
    vi.useRealTimers()
  })

  it('marks the row the content area is showing', async () => {
    render(
      <WorkspaceFileTreePane sessionId={SESSION} selectedPath="README.md" onOpen={vi.fn()} />,
    )
    await act(async () => { await Promise.resolve() })
    expect(screen.getByTestId('workspace-tree-row-README.md')).toHaveAttribute('aria-selected', 'true')
  })

  it('keeps a directory whose children match the filter', async () => {
    await renderPane()

    await act(async () => {
      fireEvent.click(screen.getByTestId('workspace-tree-row-src'))
      await Promise.resolve()
    })
    await act(async () => {
      fireEvent.change(screen.getByTestId('workspace-file-tree-filter'), {
        target: { value: 'adapters' },
      })
      await Promise.resolve()
    })

    // Dropping the parent would make the match unreachable.
    expect(screen.getByTestId('workspace-tree-row-src')).toBeInTheDocument()
    expect(screen.getByTestId('workspace-tree-row-src/adapters.ts')).toBeInTheDocument()
    expect(screen.queryByTestId('workspace-tree-row-README.md')).toBeNull()
  })

  it('says so when the workspace has no files', async () => {
    mocks.getWorkspaceTree.mockResolvedValue({ state: 'ok', path: '', entries: [] })
    await renderPane()
    expect(screen.getByText('No files')).toBeInTheDocument()
  })
})

/**
 * Every row shipped with `tabIndex={-1}` and nothing ever set `0`, so the tree
 * was outside the tab order entirely: no key reached a row, and no key moved
 * between them. These cases drive real key events and assert on
 * `document.activeElement`, because a roving tabindex that never moves focus
 * looks correct in the markup and is unusable in the hand.
 */
/** `.focus()` runs the row's own onFocus, which is a state update. */
function focusRow(node: HTMLElement) {
  act(() => { node.focus() })
}

describe('keyboard', () => {
  it('keeps exactly one row in the tab order and moves it with Up/Down', async () => {
    await renderPane()
    const src = screen.getByTestId('workspace-tree-row-src')
    const readme = screen.getByTestId('workspace-tree-row-README.md')

    expect(src).toHaveAttribute('tabindex', '0')
    expect(readme).toHaveAttribute('tabindex', '-1')

    focusRow(src)
    fireEvent.keyDown(src, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(readme)
    expect(readme).toHaveAttribute('tabindex', '0')
    expect(src).toHaveAttribute('tabindex', '-1')

    fireEvent.keyDown(readme, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(src)
  })

  it('expands, descends, ascends and collapses with the left and right arrows', async () => {
    await renderPane()
    const src = screen.getByTestId('workspace-tree-row-src')
    focusRow(src)

    await act(async () => {
      fireEvent.keyDown(src, { key: 'ArrowRight' })
      await Promise.resolve()
    })
    expect(src).toHaveAttribute('aria-expanded', 'true')

    // Right on an already-open directory descends to its first child.
    fireEvent.keyDown(src, { key: 'ArrowRight' })
    const child = screen.getByTestId('workspace-tree-row-src/adapters.ts')
    expect(document.activeElement).toBe(child)

    // Left from a leaf goes up to the parent rather than nowhere.
    fireEvent.keyDown(child, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(src)

    await act(async () => {
      fireEvent.keyDown(src, { key: 'ArrowLeft' })
      await Promise.resolve()
    })
    expect(src).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('workspace-tree-row-src/adapters.ts')).toBeNull()
  })

  it('jumps to the first and last row with Home and End', async () => {
    await renderPane()
    const src = screen.getByTestId('workspace-tree-row-src')
    const readme = screen.getByTestId('workspace-tree-row-README.md')

    focusRow(src)
    fireEvent.keyDown(src, { key: 'End' })
    expect(document.activeElement).toBe(readme)

    fireEvent.keyDown(readme, { key: 'Home' })
    expect(document.activeElement).toBe(src)
  })

  it('opens the focused file with Enter and with Space', async () => {
    vi.useFakeTimers()
    const onOpen = vi.fn()
    render(<WorkspaceFileTreePane sessionId={SESSION} selectedPath={null} onOpen={onOpen} />)
    await act(async () => { await Promise.resolve() })

    const readme = screen.getByTestId('workspace-tree-row-README.md')
    focusRow(readme)
    fireEvent.keyDown(readme, { key: 'Enter' })
    act(() => { vi.advanceTimersByTime(300) })
    expect(onOpen).toHaveBeenCalledWith('README.md', { preview: true })

    onOpen.mockClear()
    fireEvent.keyDown(readme, { key: ' ' })
    act(() => { vi.advanceTimersByTime(300) })
    expect(onOpen).toHaveBeenCalledWith('README.md', { preview: true })
    vi.useRealTimers()
  })

  it('gives the tab stop to the row the content area is showing', async () => {
    render(
      <WorkspaceFileTreePane sessionId={SESSION} selectedPath="README.md" onOpen={vi.fn()} />,
    )
    await act(async () => { await Promise.resolve() })

    // Landing on the first row would drop a keyboard user somewhere unrelated
    // to what is on screen.
    expect(screen.getByTestId('workspace-tree-row-README.md')).toHaveAttribute('tabindex', '0')
    expect(screen.getByTestId('workspace-tree-row-src')).toHaveAttribute('tabindex', '-1')
  })

  it('states each row depth, which padding alone never reaches', async () => {
    await renderPane()
    const src = screen.getByTestId('workspace-tree-row-src')
    expect(src).toHaveAttribute('aria-level', '1')

    await act(async () => {
      fireEvent.click(src)
      await Promise.resolve()
    })
    expect(screen.getByTestId('workspace-tree-row-src/adapters.ts')).toHaveAttribute('aria-level', '2')
  })
})

describe('filter field', () => {
  it('offers the clear button the hand-rolled input never had', async () => {
    await renderPane()

    await act(async () => {
      fireEvent.change(screen.getByTestId('workspace-file-tree-filter'), {
        target: { value: 'adapters' },
      })
      await Promise.resolve()
    })
    expect(screen.getByTestId('workspace-file-tree-filter')).toHaveValue('adapters')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Clear file filter' }))
      await Promise.resolve()
    })
    expect(screen.getByTestId('workspace-file-tree-filter')).toHaveValue('')
  })
})
