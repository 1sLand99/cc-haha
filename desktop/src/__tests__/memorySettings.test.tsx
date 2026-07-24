import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

import { MemorySettings } from '../pages/MemorySettings'
import { useMemoryStore } from '../stores/memoryStore'
import { useSessionStore } from '../stores/sessionStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useUIStore } from '../stores/uiStore'

const { memoryApiMock } = vi.hoisted(() => ({
  memoryApiMock: {
    listProjects: vi.fn(),
    listFiles: vi.fn(),
    readFile: vi.fn(),
    saveFile: vi.fn(),
  },
}))

vi.mock('../api/memory', () => ({
  memoryApi: memoryApiMock,
}))

vi.mock('../components/markdown/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content, onLinkClick }: { content: string; onLinkClick?: (href: string) => boolean | void }) => {
    const match = content.match(/\[([^\]]+)\]\(([^)]+)\)/)
    const linkText = match?.[1]
    const linkHref = match?.[2]
    return (
      <div data-testid="markdown-preview">
        {content}
        {linkText && linkHref ? (
          <a
            href={linkHref}
            onClick={(event) => {
              if (onLinkClick?.(linkHref)) {
                event.preventDefault()
              }
            }}
          >
            {linkText}
          </a>
        ) : null}
      </div>
    )
  },
}))

describe('MemorySettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSettingsStore.setState({ locale: 'en' })
    useSessionStore.setState({
      sessions: [
        {
          id: 'session-1',
          title: 'Active session',
          createdAt: '2026-05-01T00:00:00.000Z',
          modifiedAt: '2026-05-01T00:00:00.000Z',
          messageCount: 1,
          projectPath: '/workspace/demo',
          workDir: '/workspace/demo',
          workDirExists: true,
        },
      ],
      activeSessionId: 'session-1',
    })
    useMemoryStore.setState({
      projects: [],
      files: [],
      selectedProjectId: null,
      selectedFile: null,
      draftContent: '',
      isLoadingProjects: false,
      isLoadingFiles: false,
      isLoadingFile: false,
      isSaving: false,
      error: null,
      lastSavedAt: null,
    })
    useUIStore.setState({ activeSettingsTab: 'providers', pendingMemoryPath: null, pendingSettingsTab: null })

    memoryApiMock.listProjects.mockResolvedValue({
      projects: [
        {
          id: '-workspace-demo',
          label: '/workspace/demo',
          memoryDir: '/tmp/claude/projects/-workspace-demo/memory',
          exists: true,
          fileCount: 1,
          isCurrent: true,
        },
      ],
    })
    memoryApiMock.listFiles.mockResolvedValue({
      files: [
        {
          path: 'MEMORY.md',
          name: 'MEMORY.md',
          title: 'MEMORY.md',
          bytes: 18,
          updatedAt: '2026-05-01T00:00:00.000Z',
          type: 'project',
          description: 'Project conventions.',
          isIndex: true,
        },
      ],
    })
    memoryApiMock.readFile.mockResolvedValue({
      file: {
        path: 'MEMORY.md',
        content: '# Project Memory\n',
        updatedAt: '2026-05-01T00:00:00.000Z',
        bytes: 18,
      },
    })
    memoryApiMock.saveFile.mockResolvedValue({
      ok: true,
      file: {
        path: 'MEMORY.md',
        updatedAt: '2026-05-01T00:01:00.000Z',
        bytes: 28,
      },
    })
  })

  it('opens memory files in preview mode, edits on demand, and returns to preview after save', async () => {
    render(<MemorySettings />)

    expect(await screen.findByText('Project Memory')).toBeInTheDocument()
    expect(memoryApiMock.listProjects).toHaveBeenCalledWith('/workspace/demo')
    expect(await screen.findAllByText('workspace/demo')).not.toHaveLength(0)
    expect(await screen.findAllByText('MEMORY.md')).not.toHaveLength(0)
    expect(screen.queryByText('Project conventions.')).not.toBeInTheDocument()
    expect(screen.queryByText('Index')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('MEMORY.md or notes/project.md')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /create memory file/i })).not.toBeInTheDocument()

    expect(await screen.findByTestId('markdown-preview')).toHaveTextContent('Project Memory')
    expect(screen.queryByLabelText('Editor')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    const editor = await screen.findByLabelText('Editor')
    expect(editor).toHaveValue('# Project Memory\n')

    fireEvent.change(editor, {
      target: { value: '# Project Memory\n\n- Prefer small diffs.\n' },
    })
    expect(screen.getByText('Unsaved')).toBeInTheDocument()
    expect(screen.queryByTestId('markdown-preview')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(memoryApiMock.saveFile).toHaveBeenCalledWith({
        projectId: '-workspace-demo',
        path: 'MEMORY.md',
        content: '# Project Memory\n\n- Prefer small diffs.\n',
        expectedUpdatedAt: '2026-05-01T00:00:00.000Z',
        expectedBytes: 18,
      })
    })
    expect(screen.queryByLabelText('Editor')).not.toBeInTheDocument()
    expect(await screen.findByTestId('markdown-preview')).toHaveTextContent('Prefer small diffs')
  })

  it('does not select a missing current project with no memory files', async () => {
    memoryApiMock.listProjects.mockResolvedValue({
      projects: [
        {
          id: '-programs-claude-code',
          label: 'C:\\Programs\\claude-code',
          memoryDir: 'C:\\Users\\HUAWEI\\.claude\\projects\\-programs-claude-code\\memory',
          exists: false,
          fileCount: 0,
          isCurrent: true,
        },
      ],
    })

    render(<MemorySettings />)

    await waitFor(() => {
      expect(screen.getAllByText('Programs/claude-code')).toHaveLength(1)
    })
    expect(screen.getByText('Missing')).toBeInTheDocument()
    expect(screen.getAllByText('No file selected').length).toBeGreaterThan(0)
    expect(screen.getByText('Select a project.')).toBeInTheDocument()
    expect(screen.queryByText(/HUAWEI/)).not.toBeInTheDocument()
    expect(memoryApiMock.listFiles).not.toHaveBeenCalled()
    expect(useMemoryStore.getState().selectedProjectId).toBeNull()
  })

  it('lets the markdown editor fill the remaining detail pane height', async () => {
    render(<MemorySettings />)

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))

    const editor = await screen.findByLabelText('Editor')
    expect(editor).toHaveClass('min-h-0', 'flex-1', 'resize-none')
    expect(editor.parentElement).toHaveClass('flex', 'min-h-0', 'flex-1', 'flex-col')
  })

  it('cancels edit mode by discarding the unsaved draft', async () => {
    render(<MemorySettings />)

    expect(await screen.findByTestId('markdown-preview')).toHaveTextContent('Project Memory')
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    const editor = await screen.findByLabelText('Editor')
    fireEvent.change(editor, {
      target: { value: '# Changed Memory\n' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(memoryApiMock.saveFile).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Editor')).not.toBeInTheDocument()
    expect(await screen.findByTestId('markdown-preview')).toHaveTextContent('Project Memory')
    expect(screen.queryByText('Changed Memory')).not.toBeInTheDocument()
  })

  it('guards unsaved file navigation with an accessible dialog and restores focus on cancel', async () => {
    memoryApiMock.listFiles.mockResolvedValue({
      files: [
        {
          path: 'MEMORY.md',
          name: 'MEMORY.md',
          title: 'MEMORY.md',
          bytes: 18,
          updatedAt: '2026-05-01T00:00:00.000Z',
          type: 'project',
          description: 'Project conventions.',
          isIndex: true,
        },
        {
          path: 'notes/manual.md',
          name: 'manual.md',
          title: 'Manual',
          bytes: 42,
          updatedAt: '2026-05-01T00:02:00.000Z',
          type: 'guidance',
          description: 'Operator workflow.',
          isIndex: false,
        },
      ],
    })
    memoryApiMock.readFile.mockImplementation((_projectId: string, path: string) => Promise.resolve({
      file: {
        path,
        content: path === 'notes/manual.md' ? '# Manual\n' : '# Project Memory\n',
        updatedAt: '2026-05-01T00:00:00.000Z',
        bytes: 18,
      },
    }))

    render(<MemorySettings />)

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    const editor = await screen.findByLabelText('Editor')
    fireEvent.change(editor, {
      target: { value: '# Unsaved Memory\n' },
    })

    const manualButton = screen.getByRole('button', { name: 'Manual' })
    manualButton.focus()
    fireEvent.click(manualButton)

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    const cancelButton = screen.getByRole('button', { name: 'Cancel' })
    await waitFor(() => {
      expect(cancelButton).toHaveFocus()
    })
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' })

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      expect(manualButton).toHaveFocus()
    })
    expect(memoryApiMock.readFile).not.toHaveBeenCalledWith('-workspace-demo', 'notes/manual.md')
    expect(screen.getByLabelText('Editor')).toHaveValue('# Unsaved Memory\n')

    fireEvent.click(manualButton)
    fireEvent.click(await screen.findByRole('button', { name: 'Discard changes' }))

    await waitFor(() => {
      expect(memoryApiMock.readFile).toHaveBeenCalledWith('-workspace-demo', 'notes/manual.md')
    })
    expect(await screen.findByTestId('markdown-preview')).toHaveTextContent('Manual')
  })

  it('saves with the platform shortcut while editing and returns to preview mode', async () => {
    render(<MemorySettings />)

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    const editor = await screen.findByLabelText('Editor')
    fireEvent.change(editor, {
      target: { value: '# Project Memory\n\n- Shortcut save.\n' },
    })

    fireEvent.keyDown(document, { key: 's', metaKey: true })

    await waitFor(() => {
      expect(memoryApiMock.saveFile).toHaveBeenCalledWith({
        projectId: '-workspace-demo',
        path: 'MEMORY.md',
        content: '# Project Memory\n\n- Shortcut save.\n',
        expectedUpdatedAt: '2026-05-01T00:00:00.000Z',
        expectedBytes: 18,
      })
    })
    expect(screen.queryByLabelText('Editor')).not.toBeInTheDocument()
    expect(await screen.findByTestId('markdown-preview')).toHaveTextContent('Shortcut save')
  })

  it('filters the unified resource tree by project path', async () => {
    memoryApiMock.listProjects.mockResolvedValue({
      projects: [
        {
          id: '-workspace-alpha',
          label: '/workspace/alpha',
          memoryDir: '/tmp/claude/projects/-workspace-alpha/memory',
          exists: true,
          fileCount: 1,
          isCurrent: true,
        },
        {
          id: '-workspace-beta',
          label: '/workspace/beta',
          memoryDir: '/tmp/claude/projects/-workspace-beta/memory',
          exists: true,
          fileCount: 2,
          isCurrent: false,
        },
      ],
    })

    render(<MemorySettings />)

    expect(await screen.findAllByText('workspace/alpha')).not.toHaveLength(0)
    expect(await screen.findByText('workspace/beta')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Search projects or memory files...'), {
      target: { value: 'beta' },
    })

    expect(screen.queryByRole('button', { name: /workspace\/alpha/ })).not.toBeInTheDocument()
    expect(screen.getAllByText('workspace/beta').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'Toggle workspace/beta' }))
    await waitFor(() => {
      expect(useMemoryStore.getState().selectedProjectId).toBe('-workspace-beta')
    })
  })

  it('renders nested memory files as a collapsible resource tree', async () => {
    memoryApiMock.listFiles.mockResolvedValue({
      files: [
        {
          path: 'MEMORY.md',
          name: 'MEMORY.md',
          title: 'MEMORY.md',
          bytes: 18,
          updatedAt: '2026-05-01T00:00:00.000Z',
          type: 'project',
          description: 'Project conventions.',
          isIndex: true,
        },
        {
          path: 'notes/manual.md',
          name: 'manual.md',
          title: 'Manual',
          bytes: 42,
          updatedAt: '2026-05-01T00:02:00.000Z',
          type: 'guidance',
          description: 'Operator workflow.',
          isIndex: false,
        },
        {
          path: 'notes/archive/old.md',
          name: 'old.md',
          title: 'Old note',
          bytes: 24,
          updatedAt: '2026-05-01T00:03:00.000Z',
          isIndex: false,
        },
      ],
    })
    memoryApiMock.readFile.mockImplementation((_projectId: string, path: string) => Promise.resolve({
      file: {
        path,
        content: path === 'notes/manual.md' ? '# Manual\n' : '# Project Memory\n',
        updatedAt: '2026-05-01T00:00:00.000Z',
        bytes: 18,
      },
    }))

    render(<MemorySettings />)

    expect(await screen.findByRole('button', { name: 'Toggle notes' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Toggle archive' })).toBeInTheDocument()
    expect(screen.getByText('Manual')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Toggle notes' }))
    expect(screen.queryByText('Manual')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Search projects or memory files...'), {
      target: { value: 'manual' },
    })

    expect(screen.getByText('Manual')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Manual'))

    await waitFor(() => {
      expect(memoryApiMock.readFile).toHaveBeenCalledWith('-workspace-demo', 'notes/manual.md')
    })
    expect(await screen.findByTestId('markdown-preview')).toHaveTextContent('Manual')
    expect(screen.queryByLabelText('Editor')).not.toBeInTheDocument()
  })

  it('opens linked memory markdown files from the rendered preview', async () => {
    memoryApiMock.listFiles.mockResolvedValue({
      files: [
        {
          path: 'MEMORY.md',
          name: 'MEMORY.md',
          title: 'MEMORY.md',
          bytes: 48,
          updatedAt: '2026-05-01T00:00:00.000Z',
          type: 'project',
          description: 'Project conventions.',
          isIndex: true,
        },
        {
          path: 'notes/manual.md',
          name: 'manual.md',
          title: 'Manual',
          bytes: 24,
          updatedAt: '2026-05-01T00:02:00.000Z',
          type: 'guidance',
          isIndex: false,
        },
      ],
    })
    memoryApiMock.readFile.mockImplementation((_projectId: string, path: string) => Promise.resolve({
      file: {
        path,
        content: path === 'notes/manual.md'
          ? '# Manual\n'
          : '# Project Memory\n\n- [Manual](notes/manual.md)\n',
        updatedAt: '2026-05-01T00:00:00.000Z',
        bytes: 48,
      },
    }))

    render(<MemorySettings />)

    fireEvent.click(await screen.findByRole('link', { name: 'Manual' }))

    await waitFor(() => {
      expect(memoryApiMock.readFile).toHaveBeenCalledWith('-workspace-demo', 'notes/manual.md')
    })
    expect(await screen.findByTestId('markdown-preview')).toHaveTextContent('Manual')
    expect(screen.queryByLabelText('Editor')).not.toBeInTheDocument()
  })

  it('keeps frontmatter editable but removes it from the rendered preview', async () => {
    memoryApiMock.readFile.mockResolvedValue({
      file: {
        path: 'MEMORY.md',
        content: '---\ntype: project\n---\n\n# Project Memory\n',
        updatedAt: '2026-05-01T00:00:00.000Z',
        bytes: 39,
      },
    })

    render(<MemorySettings />)

    expect(await screen.findByTestId('markdown-preview')).toHaveTextContent('Project Memory')
    expect(screen.getByTestId('markdown-preview')).not.toHaveTextContent('type: project')

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    const editor = await screen.findByLabelText('Editor')
    expect(editor).toHaveValue('---\ntype: project\n---\n\n# Project Memory\n')
  })

  it('opens the exact memory file requested from chat', async () => {
    memoryApiMock.listProjects.mockResolvedValue({
      projects: [
        {
          id: '-workspace-demo',
          label: '/workspace/demo',
          memoryDir: '/tmp/claude/projects/-workspace-demo/memory',
          exists: true,
          fileCount: 0,
          isCurrent: true,
        },
        {
          id: '-workspace-other',
          label: '/workspace/other',
          memoryDir: '/tmp/claude/projects/-workspace-other/memory',
          exists: true,
          fileCount: 1,
          isCurrent: false,
        },
      ],
    })
    memoryApiMock.listFiles.mockImplementation((projectId: string) => Promise.resolve({
      files: projectId === '-workspace-other'
        ? [
            {
              path: 'preferences.md',
              name: 'preferences.md',
              title: 'preferences.md',
              bytes: 24,
              updatedAt: '2026-05-01T00:00:00.000Z',
              type: 'preference',
              isIndex: false,
            },
          ]
        : [],
    }))
    memoryApiMock.readFile.mockResolvedValue({
      file: {
        path: 'preferences.md',
        content: '# Preferences\n',
        updatedAt: '2026-05-01T00:00:00.000Z',
        bytes: 24,
      },
    })
    useUIStore.setState({
      pendingMemoryPath: '/tmp/claude/projects/-workspace-other/memory/preferences.md',
    })

    render(<MemorySettings />)

    expect(await screen.findByTestId('markdown-preview')).toHaveTextContent('Preferences')
    expect(screen.queryByLabelText('Editor')).not.toBeInTheDocument()
    expect(memoryApiMock.readFile).toHaveBeenCalledWith('-workspace-other', 'preferences.md')
    expect(useMemoryStore.getState().selectedProjectId).toBe('-workspace-other')
    expect(useUIStore.getState().pendingMemoryPath).toBeNull()
  })

  it('uses the shared shadcn surfaces for the memory feature', async () => {
    const { container } = render(<MemorySettings />)

    expect(await screen.findByTestId('markdown-preview')).toBeInTheDocument()
    expect(container.querySelector('[data-slot="card"]')).toBeInTheDocument()
    expect(container.querySelector('[data-slot="input"]')).toBeInTheDocument()
    expect(container.querySelector('[data-slot="button"]')).toBeInTheDocument()
    expect(container.querySelector('[data-slot="collapsible"]')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const editor = await screen.findByLabelText('Editor')
    expect(editor).toHaveAttribute('data-slot', 'textarea')
    fireEvent.change(editor, { target: { value: '# Changed\n' } })
    expect(screen.getByText('Unsaved')).toHaveAttribute('data-slot', 'badge')
  })

  it('returns focus to search after clearing the query', async () => {
    render(<MemorySettings />)
    await screen.findByTestId('markdown-preview')

    const search = screen.getByLabelText('Search projects or memory files...')
    fireEvent.change(search, { target: { value: 'demo' } })
    const clear = screen.getByRole('button', { name: 'Clear search' })
    fireEvent.click(clear)

    expect(search).toHaveValue('')
    expect(search).toHaveFocus()
  })

  it('keeps the editor and draft visible when save fails', async () => {
    memoryApiMock.saveFile.mockRejectedValue(new Error('Fixture save failed'))
    render(<MemorySettings />)

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    const editor = await screen.findByLabelText('Editor')
    fireEvent.change(editor, { target: { value: '# Unsaved after failure\n' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Fixture save failed')
    expect(screen.getByLabelText('Editor')).toHaveValue('# Unsaved after failure\n')
    expect(screen.getByText('Unsaved')).toBeInTheDocument()
  })

  it('locks editing and navigation while a save is in progress', async () => {
    let resolveSave!: (value: {
      ok: true
      file: { path: string; updatedAt: string; bytes: number }
    }) => void
    memoryApiMock.saveFile.mockReturnValue(new Promise((resolve) => {
      resolveSave = resolve
    }))
    render(<MemorySettings />)

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    const editor = await screen.findByLabelText('Editor')
    fireEvent.change(editor, { target: { value: '# Saving once\n' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(screen.getByLabelText('Editor')).toHaveAttribute('readonly')
      expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('aria-busy', 'true')
      expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled()
    })
    fireEvent.keyDown(document, { key: 's', metaKey: true })
    fireEvent.keyDown(document, { key: 's', ctrlKey: true })
    expect(memoryApiMock.saveFile).toHaveBeenCalledTimes(1)

    resolveSave({
      ok: true,
      file: {
        path: 'MEMORY.md',
        updatedAt: '2026-05-01T00:01:00.000Z',
        bytes: 14,
      },
    })
    expect(await screen.findByTestId('markdown-preview')).toHaveTextContent('Saving once')
  })

  it('routes refresh through the same unsaved-change dialog', async () => {
    render(<MemorySettings />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Editor'), {
      target: { value: '# Dirty before refresh\n' },
    })

    const refresh = screen.getByRole('button', { name: 'Refresh' })
    fireEvent.click(refresh)
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(memoryApiMock.listProjects).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('Editor')).toHaveValue('# Dirty before refresh\n')

    fireEvent.click(refresh)
    fireEvent.click(await screen.findByRole('button', { name: 'Discard changes' }))
    await waitFor(() => {
      expect(memoryApiMock.listProjects).toHaveBeenCalledTimes(2)
    })
    expect(screen.queryByLabelText('Editor')).not.toBeInTheDocument()
  })

  it('keeps a pending chat memory path when opening the target fails', async () => {
    const pendingPath = '/tmp/claude/projects/-workspace-demo/memory/MEMORY.md'
    useUIStore.setState({ pendingMemoryPath: pendingPath })
    memoryApiMock.readFile.mockRejectedValue(new Error('Fixture read failed'))

    render(<MemorySettings />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Fixture read failed')
    expect(useUIStore.getState().pendingMemoryPath).toBe(pendingPath)
  })

  it('shows loading skeletons before deciding whether the project list is empty', async () => {
    let resolveProjects!: (value: Awaited<ReturnType<typeof memoryApiMock.listProjects>>) => void
    memoryApiMock.listProjects.mockReturnValue(new Promise((resolve) => {
      resolveProjects = resolve
    }))

    const { container } = render(<MemorySettings />)

    expect(container.querySelector('[data-slot="skeleton"]')).toBeInTheDocument()
    expect(screen.queryByText('No projects match this search.')).not.toBeInTheDocument()
    expect(screen.queryByText('No memory projects found.')).not.toBeInTheDocument()

    resolveProjects({
      projects: [
        {
          id: '-workspace-demo',
          label: '/workspace/demo',
          memoryDir: '/tmp/claude/projects/-workspace-demo/memory',
          exists: true,
          fileCount: 1,
          isCurrent: true,
        },
      ],
    })
    expect(await screen.findByTestId('markdown-preview')).toBeInTheDocument()
  })
})
