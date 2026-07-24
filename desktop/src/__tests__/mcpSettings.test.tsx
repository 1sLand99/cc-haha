import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

import { McpSettings } from '../pages/McpSettings'
import { sessionsApi } from '../api/sessions'
import { mcpApi } from '../api/mcp'
import { useMcpStore } from '../stores/mcpStore'
import { useSessionStore } from '../stores/sessionStore'
import { useSettingsStore } from '../stores/settingsStore'
import type { McpServerRecord } from '../types/mcp'

vi.mock('../api/sessions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/sessions')>()
  return {
    ...actual,
    sessionsApi: {
      ...actual.sessionsApi,
      getRecentProjects: vi.fn(),
    },
  }
})

vi.mock('../api/mcp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/mcp')>()
  return {
    ...actual,
    mcpApi: {
      ...actual.mcpApi,
      projectPaths: vi.fn(),
    },
  }
})

async function renderLoadedMcpSettings() {
  const result = render(<McpSettings />)
  await waitFor(() => {
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
  return result
}

describe('McpSettings', () => {
  beforeEach(() => {
    vi.mocked(sessionsApi.getRecentProjects).mockResolvedValue({
      projects: [{
        projectPath: '/workspace/selected-project',
        realPath: '/workspace/selected-project',
        projectName: 'selected-project',
        repoName: 'org/selected-project',
        branch: 'main',
        isGit: true,
        modifiedAt: '2026-05-25T00:00:00.000Z',
        sessionCount: 1,
      }],
    })
    vi.mocked(mcpApi.projectPaths).mockResolvedValue({
      projectPaths: ['/workspace/config-project'],
    })
    useSettingsStore.setState({ locale: 'en' })
    useSessionStore.setState({
      sessions: [
        {
          id: 'session-1',
          title: 'Test Session',
          createdAt: '',
          modifiedAt: '',
          messageCount: 0,
          projectPath: '/workspace/project',
          workDir: '/workspace/project',
          workDirExists: true,
        },
      ],
      activeSessionId: 'session-1',
      isLoading: false,
      error: null,
      fetchSessions: vi.fn(),
      createSession: vi.fn(),
      deleteSession: vi.fn(),
      renameSession: vi.fn(),
      updateSessionTitle: vi.fn(),
      setActiveSession: vi.fn(),
    })
    useMcpStore.setState({
      servers: [],
      selectedServer: null,
      isLoading: false,
      error: null,
      fetchServers: vi.fn().mockResolvedValue(undefined),
      createServer: vi.fn(),
      updateServer: vi.fn(),
      deleteServer: vi.fn(),
      toggleServer: vi.fn(),
      reconnectServer: vi.fn(),
      refreshServerStatus: vi.fn(),
      selectServer: vi.fn(),
    })
  })

  it('loads MCP servers for the active and recent projects on mount', async () => {
    const fetchServers = vi.fn().mockResolvedValue(undefined)
    useMcpStore.setState({ fetchServers })

    render(<McpSettings />)

    await waitFor(() => {
      expect(fetchServers).toHaveBeenCalledWith(
        ['/workspace/project', '/workspace/selected-project', '/workspace/config-project'],
        '/workspace/project',
      )
    })
  })

  it('shows a loading state before project MCP paths and servers finish loading', async () => {
    let resolveRecentProjects!: (value: Awaited<ReturnType<typeof sessionsApi.getRecentProjects>>) => void
    const fetchServers = vi.fn().mockResolvedValue(undefined)
    vi.mocked(sessionsApi.getRecentProjects).mockImplementation(() => new Promise((resolve) => {
      resolveRecentProjects = resolve
    }))
    useMcpStore.setState({ fetchServers })

    render(<McpSettings />)

    const loadingState = screen.getByRole('status')
    expect(loadingState).toHaveTextContent('Loading...')
    expect(loadingState).toHaveAttribute('data-slot', 'card')
    expect(loadingState.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(4)
    expect(screen.queryByText('No MCP servers configured yet')).not.toBeInTheDocument()
    expect(screen.queryByText('Total servers')).not.toBeInTheDocument()

    await act(async () => {
      resolveRecentProjects({ projects: [] })
    })

    await waitFor(() => {
      expect(fetchServers).toHaveBeenCalledWith(['/workspace/project', '/workspace/config-project'], '/workspace/project')
    })
    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })
  })

  it('keeps cached MCP servers visible while a remount refresh is pending', async () => {
    vi.mocked(sessionsApi.getRecentProjects).mockImplementation(() => new Promise(() => {}))
    useMcpStore.setState({
      servers: [{
        name: 'cached-user',
        scope: 'user',
        transport: 'http',
        enabled: true,
        status: 'connected',
        statusLabel: 'Connected',
        configLocation: '/tmp/config',
        summary: 'https://example.com/mcp',
        canEdit: true,
        canRemove: true,
        canReconnect: true,
        canToggle: true,
        config: { type: 'http', url: 'https://example.com/mcp', headers: {} },
      }],
    })

    render(<McpSettings />)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByText('cached-user')).toBeInTheDocument()
  })

  it('renders the empty state and add button', async () => {
    await renderLoadedMcpSettings()

    expect(screen.getByText('MCP servers')).toBeInTheDocument()
    expect(screen.getByText('No MCP servers configured yet').closest('[data-slot="card"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: /add server/i })).toHaveAttribute('data-slot', 'button')
  })

  it('renders MCP load errors with shadcn alert and retries the same project set', async () => {
    const fetchServers = vi.fn().mockResolvedValue(undefined)
    useMcpStore.setState({
      error: 'Unable to load MCP servers',
      fetchServers,
    })

    await renderLoadedMcpSettings()

    const alert = screen.getByRole('alert')
    expect(alert).toHaveAttribute('data-slot', 'alert')
    expect(alert).toHaveTextContent('Unable to load MCP servers')
    const retryButton = screen.getByRole('button', { name: 'Retry' })
    expect(retryButton).toHaveAttribute('data-slot', 'button')

    await act(async () => {
      fireEvent.click(retryButton)
    })

    expect(fetchServers).toHaveBeenLastCalledWith(
      ['/workspace/project', '/workspace/selected-project', '/workspace/config-project'],
      '/workspace/project',
    )
  })

  it('shows plugin and user MCP servers in grouped sections', async () => {
    useMcpStore.setState({
      servers: [
        {
          name: 'plugin:telegram:telegram',
          scope: 'dynamic',
          transport: 'stdio',
          enabled: true,
          status: 'connected',
          statusLabel: 'Connected',
          configLocation: '/tmp/config',
          summary: 'npx @telegram/mcp',
          canEdit: false,
          canRemove: false,
          canReconnect: true,
          canToggle: true,
          config: { type: 'stdio', command: 'npx', args: ['@telegram/mcp'], env: {} },
        },
        {
          name: 'global-user',
          scope: 'user',
          transport: 'http',
          enabled: true,
          status: 'connected',
          statusLabel: 'Connected',
          configLocation: '/tmp/config',
          summary: 'https://example.com/mcp',
          canEdit: true,
          canRemove: true,
          canReconnect: true,
          canToggle: true,
          config: { type: 'http', url: 'https://example.com/mcp', headers: {} },
        },
      ],
    })

    await renderLoadedMcpSettings()

    expect(screen.getAllByText('Plugin').length).toBeGreaterThan(0)
    expect(screen.getAllByText('User').length).toBeGreaterThan(0)
    expect(screen.getByText('plugin:telegram:telegram')).toBeInTheDocument()
    const userServerName = screen.getByText('global-user')
    expect(userServerName.closest('[data-slot="card"]')).not.toBeNull()
    for (const statusLabel of screen.getAllByText('Connected')) {
      expect(statusLabel.closest('[data-slot="badge"]')).not.toBeNull()
    }
    expect(screen.getAllByRole('switch')).toHaveLength(2)
    expect(screen.getByRole('switch', { name: 'global-user' })).toHaveAttribute('data-slot', 'switch')
    const openButton = screen.getByRole('button', { name: 'Open global-user' })
    expect(openButton).toHaveAttribute('data-slot', 'tooltip-trigger')
    expect(openButton).toHaveAttribute('data-size', 'icon')
  })

  it('redacts sensitive MCP command details from the list and details views', async () => {
    const server = {
      name: 'context7',
      scope: 'local',
      transport: 'stdio',
      enabled: true,
      status: 'connected',
      statusLabel: 'Connected',
      statusDetail: 'Authorization: Bearer status-secret --api-key status-api-secret',
      configLocation: '/workspace/project/.mcp.json',
      summary: 'npx context7 --api-key sk-summary-secret',
      canEdit: false,
      canRemove: false,
      canReconnect: true,
      canToggle: true,
      projectPath: '/workspace/project',
      config: {
        type: 'stdio',
        command: 'npx',
        args: ['context7', '--api-key', 'sk-argument-secret'],
        env: { CONTEXT7_API_KEY: 'sk-env-secret' },
      },
    } as const

    useMcpStore.setState({ servers: [server] })

    await renderLoadedMcpSettings()

    expect(document.body.textContent).not.toContain('sk-summary-secret')
    expect(document.body.textContent).not.toContain('sk-argument-secret')
    expect(document.body.textContent).not.toContain('sk-env-secret')
    expect(document.body.textContent).not.toContain('status-secret')
    expect(document.body.textContent).not.toContain('status-api-secret')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open context7' }))
    })

    expect(screen.getByText('Raw config').closest('[data-slot="card"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: /back to servers/i })).toHaveAttribute('data-slot', 'button')
    expect(screen.queryByRole('button', { name: /uninstall/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('sk-summary-secret')
    expect(document.body.textContent).not.toContain('sk-argument-secret')
    expect(document.body.textContent).not.toContain('sk-env-secret')
    expect(document.body.textContent).not.toContain('status-secret')
    expect(document.body.textContent).not.toContain('status-api-secret')
  })

  it('redacts editable MCP secrets without replacing unchanged values on save', async () => {
    const server = {
      name: 'context7',
      scope: 'local',
      transport: 'stdio',
      enabled: true,
      status: 'connected',
      statusLabel: 'Connected',
      configLocation: '/workspace/project/.mcp.json',
      summary: 'npx context7 --api-key sk-summary-edit-secret',
      canEdit: true,
      canRemove: true,
      canReconnect: true,
      canToggle: true,
      projectPath: '/workspace/project',
      config: {
        type: 'stdio',
        command: 'npx',
        args: ['context7', '--api-key', 'sk-argument-edit-secret'],
        env: {
          CONTEXT7_API_KEY: 'sk-env-edit-secret',
          LOG_LEVEL: 'debug',
        },
      },
    } as const
    const updateServer = vi.fn().mockResolvedValue(server)

    useMcpStore.setState({ servers: [server], updateServer })

    await renderLoadedMcpSettings()

    expect(document.body.textContent).not.toContain('sk-summary-edit-secret')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open context7' }))
    })

    expect(document.body.textContent).not.toContain('sk-summary-edit-secret')
    expect(document.body.textContent).not.toContain('sk-argument-edit-secret')
    expect(document.body.textContent).not.toContain('sk-env-edit-secret')
    expect(screen.queryByDisplayValue('sk-argument-edit-secret')).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('sk-env-edit-secret')).not.toBeInTheDocument()
    expect(screen.getByDisplayValue('debug')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })

    expect(updateServer).toHaveBeenCalledWith(
      server,
      {
        scope: 'local',
        config: {
          type: 'stdio',
          command: 'npx',
          args: ['context7', '--api-key', 'sk-argument-edit-secret'],
          env: {
            CONTEXT7_API_KEY: 'sk-env-edit-secret',
            LOG_LEVEL: 'debug',
          },
        },
      },
      '/workspace/project',
    )
  })

  it('keeps original MCP secrets masked when their key or preceding flag changes', async () => {
    const server = {
      name: 'context7',
      scope: 'local',
      transport: 'stdio',
      enabled: true,
      status: 'connected',
      statusLabel: 'Connected',
      configLocation: '/workspace/project/.mcp.json',
      summary: 'npx context7',
      canEdit: true,
      canRemove: true,
      canReconnect: true,
      canToggle: true,
      projectPath: '/workspace/project',
      config: {
        type: 'stdio',
        command: 'npx',
        args: ['context7', '--api-key', 'sk-argument-provenance-secret'],
        env: { CONTEXT7_API_KEY: 'sk-env-provenance-secret' },
      },
    } as const
    const updateServer = vi.fn().mockResolvedValue(server)
    useMcpStore.setState({ servers: [server], updateServer })

    await renderLoadedMcpSettings()
    fireEvent.click(screen.getByRole('button', { name: 'Open context7' }))

    fireEvent.change(screen.getByDisplayValue('--api-key'), {
      target: { value: '--public-label' },
    })
    fireEvent.change(screen.getByDisplayValue('CONTEXT7_API_KEY'), {
      target: { value: 'PUBLIC_LABEL' },
    })

    expect(document.body.textContent).not.toContain('sk-argument-provenance-secret')
    expect(document.body.textContent).not.toContain('sk-env-provenance-secret')
    expect(screen.getAllByDisplayValue('[redacted]').length).toBeGreaterThanOrEqual(2)

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(updateServer).toHaveBeenCalledWith(
        server,
        {
          scope: 'local',
          config: {
            type: 'stdio',
            command: 'npx',
            args: ['context7', '--public-label', 'sk-argument-provenance-secret'],
            env: { PUBLIC_LABEL: 'sk-env-provenance-secret' },
          },
        },
        '/workspace/project',
      )
    })
  })

  it('does not overwrite an unsaved MCP draft on same-server status updates', async () => {
    const server = {
      name: 'filesystem',
      scope: 'user',
      transport: 'stdio',
      enabled: true,
      status: 'connected',
      statusLabel: 'Connected',
      configLocation: '/tmp/config',
      summary: 'npx filesystem',
      canEdit: true,
      canRemove: true,
      canReconnect: true,
      canToggle: true,
      config: {
        type: 'stdio',
        command: 'npx',
        args: ['filesystem'],
        env: {},
      },
    } as const
    const selectServer = vi.fn((selected: McpServerRecord | null) => {
      useMcpStore.setState({ selectedServer: selected })
    })
    useMcpStore.setState({ servers: [server], selectServer })

    await renderLoadedMcpSettings()
    fireEvent.click(screen.getByRole('button', { name: 'Open filesystem' }))

    const commandInput = screen.getByLabelText(/Command to launch/)
    fireEvent.change(commandInput, { target: { value: 'custom-unsaved-command' } })

    act(() => {
      useMcpStore.setState({
        selectedServer: {
          ...server,
          status: 'checking',
          statusLabel: 'Checking',
        },
      })
    })

    expect(screen.getByLabelText(/Command to launch/)).toHaveValue('custom-unsaved-command')
    expect(screen.getByText('Checking')).toBeInTheDocument()
  })

  it('uses the server MCP name rules before enabling Save', async () => {
    await renderLoadedMcpSettings()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /add server/i }))
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: /^User/i }))
    })

    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: 'bad name' } })
    fireEvent.change(screen.getByLabelText(/Command to launch/), { target: { value: 'echo' } })

    expect(screen.getByLabelText(/Name/)).toBeRequired()
    expect(screen.getByLabelText(/Name/)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: 'bad/name' } })
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: 'bad.name' } })
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: '某某服务器' } })
    expect(screen.getByLabelText(/Name/)).toHaveAttribute('aria-invalid', 'false')
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('composes the MCP editor from shadcn form primitives', async () => {
    await renderLoadedMcpSettings()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /add server/i }))
    })

    expect(screen.getByLabelText(/Name/)).toHaveFocus()
    expect(screen.getByLabelText(/Name/)).toHaveAttribute('data-slot', 'input')
    expect(screen.getByRole('radiogroup', { name: 'Config scope' })).toHaveAttribute('data-slot', 'radio-group')
    expect(screen.getByRole('radio', { name: /^Local/i })).toHaveAttribute('data-slot', 'setting-radio-card')
    expect(screen.getByRole('radiogroup', { name: 'Transport' })).toHaveAttribute('data-slot', 'toggle-group')
    expect(screen.getByRole('radio', { name: 'STDIO' })).toHaveAttribute('data-slot', 'toggle-group-item')
    const addArgumentButton = screen.getByRole('button', { name: 'Add argument' })
    expect(addArgumentButton).toHaveAttribute('data-slot', 'button')
    expect(screen.getByRole('button', { name: 'Delete Arguments 1' })).toHaveAttribute('data-slot', 'tooltip-trigger')
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('data-slot', 'button')

    fireEvent.click(addArgumentButton)

    await waitFor(() => {
      expect(screen.getByLabelText('Arguments chrome-devtools-mcp@latest 2')).toHaveFocus()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Delete Arguments 2' }))

    await waitFor(() => {
      expect(screen.getByLabelText('Arguments chrome-devtools-mcp@latest 1')).toHaveFocus()
    })

    const httpTransport = screen.getByRole('radio', { name: 'Streamable HTTP' })
    fireEvent.pointerDown(httpTransport, { button: 0 })
    fireEvent.click(httpTransport)

    await waitFor(() => {
      expect(httpTransport).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByLabelText(/URL/)).toHaveAttribute('data-slot', 'input')
      expect(screen.getByLabelText('OAuth client ID')).toHaveAttribute('data-slot', 'input')
    })

    fireEvent.click(screen.getByRole('button', { name: /back to servers/i }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /add server/i })).toHaveFocus()
    })
  })

  it('keeps same-name project MCP servers distinct by project path', async () => {
    useMcpStore.setState({
      servers: [
        {
          name: 'context7',
          scope: 'local',
          transport: 'stdio',
          enabled: true,
          status: 'connected',
          statusLabel: 'Connected',
          configLocation: '/workspace/project-a/.claude.json',
          summary: 'npx @upstash/context7-mcp',
          canEdit: true,
          canRemove: true,
          canReconnect: true,
          canToggle: true,
          projectPath: '/workspace/project-a',
          config: { type: 'stdio', command: 'npx', args: ['@upstash/context7-mcp'], env: {} },
        },
        {
          name: 'context7',
          scope: 'local',
          transport: 'stdio',
          enabled: true,
          status: 'connected',
          statusLabel: 'Connected',
          configLocation: '/workspace/project-b/.claude.json',
          summary: 'npx @upstash/context7-mcp',
          canEdit: true,
          canRemove: true,
          canReconnect: true,
          canToggle: true,
          projectPath: '/workspace/project-b',
          config: { type: 'stdio', command: 'npx', args: ['@upstash/context7-mcp'], env: {} },
        },
      ],
    })

    await renderLoadedMcpSettings()

    expect(screen.getAllByText('context7')).toHaveLength(2)
    expect(screen.getByText('/workspace/project-a')).toBeInTheDocument()
    expect(screen.getByText('/workspace/project-b')).toBeInTheDocument()
  })

  it('starts background status refresh after the fast list render', async () => {
    const server = {
      name: 'deepwiki',
      scope: 'user',
      transport: 'http',
      enabled: true,
      status: 'checking' as const,
      statusLabel: 'Checking',
      configLocation: '/tmp/config',
      summary: 'https://example.com/mcp',
      canEdit: true,
      canRemove: true,
      canReconnect: true,
      canToggle: true,
      config: { type: 'http' as const, url: 'https://example.com/mcp', headers: {} },
    }
    const refreshServerStatus = vi.fn().mockResolvedValue({
      ...server,
      status: 'connected' as const,
      statusLabel: 'Connected',
    })

    useMcpStore.setState({
      servers: [server],
      refreshServerStatus,
    })

    await renderLoadedMcpSettings()

    expect(screen.getByText('Checking')).toBeInTheDocument()

    await waitFor(() => {
      expect(refreshServerStatus).toHaveBeenCalledWith(server, '/workspace/project')
    })
  })

  it('opens the delete confirmation modal from the edit view and deletes with the active cwd', async () => {
    const deleteServer = vi.fn().mockResolvedValue(undefined)
    const server = {
      name: 'global-user',
      scope: 'user',
      transport: 'http',
      enabled: true,
      status: 'connected',
      statusLabel: 'Connected',
      configLocation: '/tmp/config',
      summary: 'https://example.com/mcp',
      canEdit: true,
      canRemove: true,
      canReconnect: true,
      canToggle: true,
      config: { type: 'http', url: 'https://example.com/mcp', headers: {} },
    } as const

    useMcpStore.setState({
      servers: [server],
      deleteServer,
    })

    await renderLoadedMcpSettings()

    const openButton = screen.getByRole('button', { name: 'Open global-user' })
    openButton.focus()
    await act(async () => {
      fireEvent.click(openButton)
    })

    expect(screen.getByRole('heading', { name: 'Configure global-user MCP' })).toHaveFocus()
    const uninstallButton = screen.getByRole('button', { name: /uninstall/i })
    uninstallButton.focus()
    await act(async () => {
      fireEvent.click(uninstallButton)
    })

    expect(screen.getByRole('alertdialog')).toHaveAttribute('data-slot', 'alert-dialog-content')
    expect(screen.getByText('Delete MCP server')).toBeInTheDocument()
    expect(screen.getByText('Delete MCP server "global-user"? This action cannot be undone.')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    })

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      expect(uninstallButton).toHaveFocus()
    })

    await act(async () => {
      fireEvent.click(uninstallButton)
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    })

    expect(deleteServer).toHaveBeenCalledWith(server, '/workspace/project')
  })

  it('uses a neutral title when configuring an editable MCP server', async () => {
    const server = {
      name: 'filesystem',
      scope: 'user',
      transport: 'stdio',
      enabled: true,
      status: 'connected',
      statusLabel: 'Connected',
      configLocation: '/tmp/config',
      summary: 'npx @modelcontextprotocol/server-filesystem',
      canEdit: true,
      canRemove: true,
      canReconnect: true,
      canToggle: true,
      config: {
        type: 'stdio',
        command: 'npx',
        args: ['@modelcontextprotocol/server-filesystem'],
        env: {},
      },
    } as const

    useMcpStore.setState({ servers: [server] })

    await renderLoadedMcpSettings()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open filesystem' }))
    })

    expect(screen.getByRole('heading', { name: 'Configure filesystem MCP' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Update filesystem MCP' })).not.toBeInTheDocument()
  })

  it('uses the active cwd when toggling a server', async () => {
    const toggleServer = vi.fn().mockResolvedValue(undefined)
    const server = {
      name: 'global-user',
      scope: 'user',
      transport: 'http',
      enabled: true,
      status: 'connected',
      statusLabel: 'Connected',
      configLocation: '/tmp/config',
      summary: 'https://example.com/mcp',
      canEdit: true,
      canRemove: true,
      canReconnect: true,
      canToggle: true,
      config: { type: 'http', url: 'https://example.com/mcp', headers: {} },
    } as const

    useMcpStore.setState({
      servers: [server],
      toggleServer,
    })

    await renderLoadedMcpSettings()

    await act(async () => {
      fireEvent.click(screen.getByRole('switch'))
    })

    expect(toggleServer).toHaveBeenCalledWith(server, '/workspace/project', 'session-1')
  })

  it('locks a shadcn MCP switch while its toggle request is pending', async () => {
    let resolveToggle!: (value: McpServerRecord) => void
    const server = {
      name: 'global-user',
      scope: 'user',
      transport: 'http',
      enabled: true,
      status: 'connected',
      statusLabel: 'Connected',
      configLocation: '/tmp/config',
      summary: 'https://example.com/mcp',
      canEdit: true,
      canRemove: true,
      canReconnect: true,
      canToggle: true,
      config: { type: 'http', url: 'https://example.com/mcp', headers: {} },
    } as const
    const toggleServer = vi.fn(() => new Promise<McpServerRecord>((resolve) => {
      resolveToggle = resolve
    }))
    useMcpStore.setState({
      servers: [server],
      toggleServer,
    })

    await renderLoadedMcpSettings()

    const toggle = screen.getByRole('switch', { name: 'global-user' })
    fireEvent.click(toggle)

    expect(toggleServer).toHaveBeenCalledTimes(1)
    expect(toggle).toBeDisabled()
    expect(toggle).toHaveAttribute('aria-busy', 'true')

    await act(async () => {
      resolveToggle({ ...server, enabled: false })
    })

    await waitFor(() => {
      expect(toggle).not.toBeDisabled()
      expect(toggle).not.toHaveAttribute('aria-busy')
    })
  })

  it('clears the selected MCP server when returning to the list', async () => {
    const selectServer = vi.fn()
    const server = {
      name: 'global-user',
      scope: 'user',
      transport: 'http',
      enabled: true,
      status: 'connected',
      statusLabel: 'Connected',
      configLocation: '/tmp/config',
      summary: 'https://example.com/mcp',
      canEdit: true,
      canRemove: true,
      canReconnect: true,
      canToggle: true,
      config: { type: 'http', url: 'https://example.com/mcp', headers: {} },
    } as const

    useMcpStore.setState({
      servers: [server],
      selectServer,
    })

    await renderLoadedMcpSettings()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open global-user' }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /back/i }))
    })

    expect(selectServer).toHaveBeenLastCalledWith(null)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Open global-user' })).toHaveFocus()
    })
  })

  it('requires an explicitly selected project before creating local MCP servers', async () => {
    const createdServer = {
      name: 'context7',
      scope: 'local',
      transport: 'stdio',
      enabled: true,
      status: 'checking' as const,
      statusLabel: 'Checking',
      configLocation: '/workspace/project/.claude.json',
      summary: 'npx @upstash/context7-mcp',
      canEdit: true,
      canRemove: true,
      canReconnect: true,
      canToggle: true,
      projectPath: '/workspace/project',
      config: { type: 'stdio' as const, command: 'npx', args: ['@upstash/context7-mcp'], env: {} },
    }
    const createServer = vi.fn().mockResolvedValue(createdServer)

    useMcpStore.setState({ createServer })

    await renderLoadedMcpSettings()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /add server/i }))
    })

    expect(screen.getByText('Select a project...')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: 'context7' } })
    fireEvent.change(screen.getByLabelText(/Command to launch/), { target: { value: 'npx' } })
    fireEvent.change(screen.getByPlaceholderText('chrome-devtools-mcp@latest'), {
      target: { value: '@upstash/context7-mcp' },
    })

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Select a project/i }))
    })

    await act(async () => {
      fireEvent.click(await screen.findByText('org/selected-project'))
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })

    expect(createServer).toHaveBeenCalledWith(
      'context7',
      {
        scope: 'local',
        config: {
          type: 'stdio',
          command: 'npx',
          args: ['@upstash/context7-mcp'],
          env: {},
        },
      },
      '/workspace/selected-project',
    )
  })

  it('updates project MCP servers using the explicitly selected target project', async () => {
    vi.mocked(sessionsApi.getRecentProjects).mockResolvedValue({
      projects: [{
        projectPath: '/workspace/moved-project',
        realPath: '/workspace/moved-project',
        projectName: 'moved-project',
        repoName: 'org/moved-project',
        branch: 'main',
        isGit: true,
        modifiedAt: '2026-05-25T00:00:00.000Z',
        sessionCount: 1,
      }],
    })
    const updateServer = vi.fn().mockResolvedValue({
      name: 'shared-tools',
      scope: 'project',
      transport: 'stdio',
      enabled: true,
      status: 'checking' as const,
      statusLabel: 'Checking',
      configLocation: '/workspace/moved-project/.mcp.json',
      summary: 'npx shared-tools',
      canEdit: true,
      canRemove: true,
      canReconnect: true,
      canToggle: true,
      projectPath: '/workspace/moved-project',
      config: { type: 'stdio' as const, command: 'npx', args: ['shared-tools'], env: {} },
    })
    const server = {
      name: 'shared-tools',
      scope: 'project',
      transport: 'stdio',
      enabled: true,
      status: 'connected',
      statusLabel: 'Connected',
      configLocation: '/workspace/project/.mcp.json',
      summary: 'npx shared-tools',
      canEdit: true,
      canRemove: true,
      canReconnect: true,
      canToggle: true,
      projectPath: '/workspace/project',
      config: { type: 'stdio' as const, command: 'npx', args: ['shared-tools'], env: {} },
    } as const

    useMcpStore.setState({
      servers: [server],
      updateServer,
    })

    await renderLoadedMcpSettings()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open shared-tools' }))
    })

    expect(screen.getByText('project')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByTitle('/workspace/project'))
    })

    await act(async () => {
      fireEvent.click(await screen.findByText('org/moved-project'))
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })

    expect(updateServer).toHaveBeenCalledWith(
      server,
      {
        scope: 'project',
        config: {
          type: 'stdio',
          command: 'npx',
          args: ['shared-tools'],
          env: {},
        },
      },
      '/workspace/moved-project',
    )
  })

  it('shows reconnecting status immediately in the detail view', async () => {
    let resolveReconnect: ((value: typeof server) => void) | null = null
    const server = {
      name: 'plugin:telegram:telegram',
      scope: 'dynamic',
      transport: 'stdio',
      enabled: true,
      status: 'failed' as 'connected' | 'needs-auth' | 'failed' | 'disabled' | 'checking',
      statusLabel: 'Unavailable',
      statusDetail: 'Timed out' as string | undefined,
      configLocation: '/tmp/config',
      summary: 'bun run start',
      canEdit: false,
      canRemove: false,
      canReconnect: true,
      canToggle: true,
      config: { type: 'stdio' as const, command: 'bun', args: ['run', 'start'], env: {} },
    }
    const reconnectServer = vi.fn().mockImplementation(() => new Promise<typeof server>((resolve) => {
      resolveReconnect = resolve
    }))

    useMcpStore.setState({
      servers: [server],
      reconnectServer,
    })

    await renderLoadedMcpSettings()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open plugin:telegram:telegram' }))
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /reconnect/i }))
    })

    expect(screen.getAllByText('Reconnecting...').length).toBeGreaterThan(0)
    expect(reconnectServer).toHaveBeenCalledWith(server, '/workspace/project')

    await act(async () => {
      resolveReconnect?.({
        ...server,
        status: 'connected',
        statusLabel: 'Connected',
        statusDetail: undefined,
      })
    })
  })

  it('locks MCP editor mutations while reconnect is pending', async () => {
    let resolveReconnect!: (value: McpServerRecord) => void
    const server = {
      name: 'filesystem',
      scope: 'user',
      transport: 'stdio',
      enabled: true,
      status: 'failed',
      statusLabel: 'Unavailable',
      statusDetail: 'Timed out',
      configLocation: '/tmp/config',
      summary: 'npx filesystem',
      canEdit: true,
      canRemove: true,
      canReconnect: true,
      canToggle: true,
      config: {
        type: 'stdio',
        command: 'npx',
        args: ['filesystem'],
        env: {},
      },
    } as const
    const reconnectServer = vi.fn(() => new Promise<McpServerRecord>((resolve) => {
      resolveReconnect = resolve
    }))
    useMcpStore.setState({ servers: [server], reconnectServer })

    await renderLoadedMcpSettings()
    fireEvent.click(screen.getByRole('button', { name: 'Open filesystem' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }))

    expect(screen.getByRole('button', { name: /back to servers/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /uninstall/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.getByLabelText(/Command to launch/)).toBeDisabled()

    await act(async () => {
      resolveReconnect({
        ...server,
        status: 'connected',
        statusLabel: 'Connected',
        statusDetail: undefined,
      })
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /back to servers/i })).not.toBeDisabled()
      expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled()
      expect(screen.getByLabelText(/Command to launch/)).not.toBeDisabled()
    })
  })
})
