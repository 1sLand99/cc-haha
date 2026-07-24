import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'

const viewportMocks = vi.hoisted(() => ({
  isMobile: false,
  isTauri: false,
}))

const apiMocks = vi.hoisted(() => ({
  getRepositoryContext: vi.fn(),
}))

vi.mock('../../hooks/useMobileViewport', () => ({
  useMobileViewport: () => viewportMocks.isMobile,
}))

vi.mock('../../lib/desktopRuntime', () => ({
  isTauriRuntime: () => viewportMocks.isTauri,
  isDesktopRuntime: () => viewportMocks.isTauri,
}))

vi.mock('../../api/sessions', () => ({
  sessionsApi: {
    getRepositoryContext: apiMocks.getRepositoryContext,
  },
}))

vi.mock('./DirectoryPicker', () => ({
  DirectoryPicker: ({ value }: { value: string }) => (
    <button type="button">Project {value}</button>
  ),
}))

vi.mock('../../i18n', () => ({
  useTranslation: () => (key: string) => ({
    'common.loading': 'Loading',
    'repoLaunch.checkedOut': 'Checked out',
    'repoLaunch.checkedOutWarning': 'Branch is checked out elsewhere',
    'repoLaunch.currentBranch': 'Current branch',
    'repoLaunch.dirtyWarning': 'Dirty worktree',
    'repoLaunch.localBranch': 'Local branch',
    'repoLaunch.missingWorkdir': 'Missing working directory',
    'repoLaunch.noBranch': 'No branch',
    'repoLaunch.noBranchMatch': 'No matching branches',
    'repoLaunch.remoteBranch': 'Remote branch',
    'repoLaunch.searchBranch': 'Search branches',
    'repoLaunch.selectBranch': 'Select branch',
    'repoLaunch.selectWorktree': 'Select worktree mode',
    'repoLaunch.worktreeCurrent': 'Current worktree',
    'repoLaunch.worktreeIsolated': 'Isolated worktree',
    'tabs.close': 'Close',
  }[key] ?? key),
}))

import { RepositoryLaunchControls } from './RepositoryLaunchControls'

const okRepositoryContext = {
  state: 'ok' as const,
  root: '/repo',
  currentBranch: 'main',
  defaultBranch: 'main',
  dirty: false,
  branches: [
    {
      name: 'main',
      current: true,
      local: true,
      remote: false,
      checkedOut: false,
      remoteRef: null,
      worktreePath: null,
    },
    {
      name: 'feature/h5',
      current: false,
      local: true,
      remote: false,
      checkedOut: false,
      remoteRef: null,
      worktreePath: null,
    },
  ],
}

function renderControls(props: Partial<ComponentProps<typeof RepositoryLaunchControls>> = {}) {
  const defaultProps: ComponentProps<typeof RepositoryLaunchControls> = {
    workDir: '/repo',
    onWorkDirChange: vi.fn(),
    branch: 'main',
    onBranchChange: vi.fn(),
    useWorktree: false,
    onUseWorktreeChange: vi.fn(),
  }

  return render(<RepositoryLaunchControls {...defaultProps} {...props} />)
}

async function openBranchMenu() {
  const trigger = await screen.findByRole('button', { name: 'Select branch: main' })
  trigger.focus()
  fireEvent.click(trigger)
  return trigger
}

describe('RepositoryLaunchControls', () => {
  beforeEach(() => {
    viewportMocks.isMobile = false
    viewportMocks.isTauri = false
    apiMocks.getRepositoryContext.mockReset()
    apiMocks.getRepositoryContext.mockResolvedValue(okRepositoryContext)
    Element.prototype.scrollIntoView = vi.fn()
  })

  it('keeps the desktop branch dropdown when not in mobile browser mode', async () => {
    renderControls()

    const trigger = await openBranchMenu()

    const listbox = await screen.findByRole('listbox', { name: 'Select branch' })
    expect(listbox).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Select branch' })).not.toBeInTheDocument()
    expect(listbox.parentElement?.className).toContain('w-[390px]')
    expect(listbox.parentElement).toHaveAttribute('data-slot', 'popover-content')
    expect(screen.getByRole('textbox', { name: 'Search branches' })).toHaveFocus()

    fireEvent.keyDown(listbox.parentElement!, { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByRole('listbox', { name: 'Select branch' })).not.toBeInTheDocument()
      expect(trigger).toHaveFocus()
    })
  })

  it('uses the flatter desktop bar when embedded in a composer', async () => {
    renderControls({ placement: 'composer' })

    const trigger = await screen.findByRole('button', { name: 'Select branch: main' })
    const bar = trigger.parentElement
    expect(bar).toHaveClass('min-h-[44px]', 'bg-transparent')
    expect(bar).not.toHaveClass('rounded-b-xl')
    expect(bar).not.toHaveClass('bg-[var(--color-surface-container-low)]')
  })

  it('uses the full-width mobile bottom sheet in H5 mobile browser mode', async () => {
    viewportMocks.isMobile = true
    viewportMocks.isTauri = false

    renderControls()

    const trigger = await openBranchMenu()

    const dialog = await screen.findByRole('dialog', { name: 'Select branch' })
    expect(dialog).toHaveClass('inset-x-0')
    expect(dialog).toHaveAttribute('data-slot', 'sheet-content')
    expect(document.querySelector('[data-slot="sheet-overlay"]')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    expect(screen.getByRole('listbox', { name: 'Select branch' })).toBeInTheDocument()

    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Select branch' })).not.toBeInTheDocument()
      expect(trigger).toHaveFocus()
    })
  })

  it('does not use the H5 mobile sheet inside Tauri even on a narrow viewport', async () => {
    viewportMocks.isMobile = true
    viewportMocks.isTauri = true

    renderControls()

    await openBranchMenu()

    const listbox = await screen.findByRole('listbox', { name: 'Select branch' })
    expect(listbox).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Select branch' })).not.toBeInTheDocument()
  })

  it('keeps keyboard branch selection working from the search field', async () => {
    const onBranchChange = vi.fn()
    renderControls({ onBranchChange })

    await openBranchMenu()

    const input = await screen.findByPlaceholderText('Search branches')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(onBranchChange).toHaveBeenCalledWith('feature/h5')
    })
  })

  it('uses the shadcn worktree popover and restores focus after selection', async () => {
    const onUseWorktreeChange = vi.fn()
    renderControls({ onUseWorktreeChange })

    const trigger = await screen.findByRole('button', { name: 'Select worktree mode: Current worktree' })
    fireEvent.click(trigger)

    const listbox = await screen.findByRole('listbox', { name: 'Select worktree mode' })
    expect(listbox.parentElement).toHaveAttribute('data-slot', 'popover-content')
    expect(screen.getByRole('option', { name: 'Current worktree' })).toHaveFocus()

    fireEvent.click(screen.getByRole('option', { name: 'Isolated worktree' }))
    await waitFor(() => {
      expect(onUseWorktreeChange).toHaveBeenCalledWith(true)
      expect(screen.queryByRole('listbox', { name: 'Select worktree mode' })).not.toBeInTheDocument()
      expect(trigger).toHaveFocus()
    })
  })
})
