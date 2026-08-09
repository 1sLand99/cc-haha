import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SubagentRunResponse } from '../api/subagents'
import { useSettingsStore } from '../stores/settingsStore'
import { setComposerText } from '../components/chat/composerTestUtils'

const { getMemberTranscriptMock, sendMemberMessageMock } = vi.hoisted(() => ({
  getMemberTranscriptMock: vi.fn(),
  sendMemberMessageMock: vi.fn(),
}))

vi.mock('../api/subagents', async (importOriginal) => ({
  // Keep the real ref helpers: they decide whether the page fetches by tool
  // call or by agent id, so stubbing them would test a fiction.
  ...(await importOriginal<typeof import('../api/subagents')>()),
  subagentsApi: {
    getRunByTool: vi.fn(),
    getRunByAgent: vi.fn(),
    sendMessage: vi.fn(),
  },
}))

vi.mock('../api/teams', () => ({
  teamsApi: {
    getMemberTranscript: getMemberTranscriptMock,
    sendMemberMessage: sendMemberMessageMock,
    getWorkbenchForSession: vi.fn(),
    getWorkbench: vi.fn(),
    get: vi.fn(),
    list: vi.fn(),
    delete: vi.fn(),
  },
}))

import { subagentsApi } from '../api/subagents'
import { useChatStore } from '../stores/chatStore'
import { useTabStore } from '../stores/tabStore'
import { useTeamStore } from '../stores/teamStore'
import { SubagentRunPage, TeamMemberRunPage } from './SubagentRunPage'

const TRANSCRIPT_TIMESTAMP = '2026-07-03T10:20:11.000Z'

function subagentRun(overrides: Partial<SubagentRunResponse> = {}): SubagentRunResponse {
  return {
    sessionId: 'session-1',
    toolUseId: 'tool-1',
    agentId: 'abc123',
    status: 'completed',
    description: 'Explore repo',
    prompt: 'Read files',
    summary: 'Found layout seam',
    messages: [
      {
        id: 'msg-user',
        type: 'user',
        content: 'Read files',
        timestamp: TRANSCRIPT_TIMESTAMP,
      },
      {
        id: 'msg-assistant',
        type: 'assistant',
        content: [{ type: 'text', text: 'Finding' }],
        timestamp: TRANSCRIPT_TIMESTAMP,
      },
    ],
    truncated: false,
    source: 'subagent-jsonl',
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, reject, resolve }
}

describe('SubagentRunPage', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    useChatStore.setState({ sessions: {} })
    useTabStore.setState({ tabs: [], activeTabId: null })
    useTeamStore.getState().clearTeam()
    getMemberTranscriptMock.mockReset()
    sendMemberMessageMock.mockReset()
    sendMemberMessageMock.mockResolvedValue({ ok: true })
    localStorage.clear()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.mocked(subagentsApi.getRunByTool).mockReset()
    vi.mocked(subagentsApi.getRunByAgent).mockReset()
    vi.mocked(subagentsApi.sendMessage).mockReset()
    useTeamStore.getState().clearTeam()
  })

  it('returns to the parent session and closes its own tab via the back button', async () => {
    vi.mocked(subagentsApi.getRunByTool).mockResolvedValue(subagentRun())
    useTabStore.getState().openTab('session-1', 'Parent session')
    useTabStore.getState().openSubagentTab('session-1', 'tool-1', 'Kuhn')

    render(<SubagentRunPage sourceSessionId="session-1" toolUseId="tool-1" taskId="agent-1" title="Kuhn" />)

    fireEvent.click(await screen.findByRole('button', { name: 'Back to parent session' }))

    expect(useTabStore.getState().activeTabId).toBe('session-1')
    expect(useTabStore.getState().tabs.map((tab) => tab.sessionId)).toEqual(['session-1'])
  })

  it('fetches a workflow agent by agent id, not by tool call', async () => {
    // Workflow agents are spawned by the workflow runtime, so no parent Agent
    // tool call exists to look them up by. Same page, same rendering — only
    // the lookup differs.
    vi.mocked(subagentsApi.getRunByAgent).mockResolvedValue(subagentRun())

    render(
      <SubagentRunPage
        sourceSessionId="session-1"
        toolUseId="agent:wfagent1"
        title="survey response.js"
      />,
    )

    expect(await screen.findByText('survey response.js')).toBeInTheDocument()
    expect(subagentsApi.getRunByAgent).toHaveBeenCalledWith('session-1', 'wfagent1')
    expect(subagentsApi.getRunByTool).not.toHaveBeenCalled()
  })

  it('renders SubAgent run details', async () => {
    vi.mocked(subagentsApi.getRunByTool).mockResolvedValue(subagentRun({
      outputFile: '/tmp/result.md',
    }))

    render(<SubagentRunPage sourceSessionId="session-1" toolUseId="tool-1" taskId="agent-1" title="Kuhn" />)

    expect(await screen.findByText('Kuhn')).toBeInTheDocument()
    expect(subagentsApi.getRunByTool).toHaveBeenCalledWith('session-1', 'tool-1', 'agent-1')
    expect(screen.getByText('Agent: abc123')).toBeInTheDocument()
    expect(screen.getAllByText('Explore repo').length).toBeGreaterThan(0)
    expect(screen.getByText('Output: /tmp/result.md')).toBeInTheDocument()
    expect(screen.queryByText('Parent Agent Tool Call')).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('"prompt": "Read files"')
    expect(screen.queryByText(/Dispatched an agent|派遣了一个代理/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Open run/ })).not.toBeInTheDocument()

    const transcript = screen.getByTestId('subagent-conversation')
    expect(transcript).toHaveTextContent('Read files')
    expect(transcript).toHaveTextContent('Finding')
    expect(transcript).not.toHaveTextContent('assistant_text')
    expect(screen.getByTestId('agent-run-desktop')).toHaveAttribute('data-agent-run-kind', 'subagent')
  })

  it('renders an Agent Teams member in the shared run desktop and returns to the workbench', async () => {
    const member = {
      agentId: 'reviewer@review-team',
      name: 'reviewer',
      role: 'security-reviewer',
      status: 'running' as const,
      currentTask: 'Review auth changes',
    }
    const snapshot = {
      version: 'v1',
      generatedAt: '2026-08-09T00:00:00.000Z',
      team: {
        name: 'review-team',
        leadAgentId: 'lead@review-team',
        leadSessionId: 'lead-session',
        members: [member],
      },
      tasks: [],
      messages: [],
    }
    getMemberTranscriptMock.mockResolvedValue({
      messages: [
        {
          id: 'lead-message',
          type: 'user',
          content: '<teammate-message teammate_id="team-lead">Prioritize the auth flow.</teammate-message>',
          timestamp: TRANSCRIPT_TIMESTAMP,
        },
        {
          id: 'member-message',
          type: 'assistant',
          content: [{ type: 'text', text: 'Auth review is in progress.' }],
          timestamp: TRANSCRIPT_TIMESTAMP,
        },
      ],
    })
    useTeamStore.setState({
      activeTeam: snapshot.team,
      workbenchesBySession: {
        'lead-session': {
          teamName: 'review-team',
          snapshots: [snapshot],
          loading: false,
          error: null,
        },
      },
    })
    useTabStore.getState().openTab('lead-session', 'Lead session')
    const workbenchTabId = useTabStore.getState().openTeamWorkbenchTab('lead-session', 'review-team')
    useTeamStore.getState().openMemberSession(member, snapshot.team)
    const tabId = 'team-member:reviewer@review-team'

    render(
      <TeamMemberRunPage
        tabId={tabId}
        leadSessionId="lead-session"
        agentId={member.agentId}
        title="reviewer"
      />,
    )

    expect(await screen.findByTestId('team-member-conversation')).toHaveTextContent('Auth review is in progress.')
    expect(screen.getByTestId('team-member-conversation')).toHaveTextContent('Prioritize the auth flow.')
    expect(screen.getByTestId('teammate-message-avatar')).toHaveAttribute('data-avatar-key', 'team-lead')
    expect(screen.getByTestId('agent-run-desktop')).toHaveAttribute('data-agent-run-kind', 'team-member')
    expect(screen.getByText('Review auth changes')).toBeInTheDocument()
    expect(screen.queryByTestId('team-member-readonly-note')).not.toBeInTheDocument()

    setComposerText('Please check the regression path.', 33)
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    await waitFor(() => {
      expect(sendMemberMessageMock).toHaveBeenCalledWith(
        'review-team',
        'reviewer@review-team',
        'Please check the regression path.',
      )
    })

    fireEvent.click(screen.getByRole('button', { name: 'Back to team overview' }))
    expect(useTabStore.getState().activeTabId).toBe(workbenchTabId)
    expect(useTabStore.getState().tabs.some((tab) => tab.sessionId === tabId)).toBe(false)
  })

  it('shows transcript loading immediately instead of an empty member conversation', async () => {
    const transcript = deferred<Awaited<ReturnType<typeof getMemberTranscriptMock>>>()
    const member = {
      agentId: 'slow-reviewer@review-team',
      name: 'slow-reviewer',
      role: 'security-reviewer',
      status: 'running' as const,
    }
    const team = {
      name: 'review-team',
      leadSessionId: 'lead-session',
      members: [member],
    }
    getMemberTranscriptMock.mockReturnValue(transcript.promise)
    useTeamStore.setState({ activeTeam: team })
    useTeamStore.getState().openMemberSession(member, team)

    render(
      <TeamMemberRunPage
        tabId="team-member:slow-reviewer@review-team"
        leadSessionId="lead-session"
        agentId={member.agentId}
        title="slow-reviewer"
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent('Loading member transcript...')
    expect(screen.queryByTestId('team-member-conversation')).not.toBeInTheDocument()

    transcript.resolve({ messages: [] })
    expect(await screen.findByTestId('team-member-conversation')).toBeInTheDocument()
    expect(getMemberTranscriptMock).toHaveBeenCalledTimes(1)
  })

  it('hides the composer for a one-shot SubAgent and explains why', async () => {
    vi.mocked(subagentsApi.getRunByTool).mockResolvedValue(subagentRun({ canSendMessage: false }))

    render(<SubagentRunPage sourceSessionId="session-1" toolUseId="tool-1" title="Kuhn" />)

    await screen.findByTestId('subagent-conversation')
    expect(screen.getByTestId('subagent-readonly-note')).toHaveTextContent(
      'This is the record of a one-shot subagent. It cannot be continued.',
    )
    expect(document.querySelector('[data-composer-editor]')).toBeNull()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('hides the composer when the server does not report an inbox at all', async () => {
    const { canSendMessage: _omitted, ...withoutFlag } = subagentRun()
    vi.mocked(subagentsApi.getRunByTool).mockResolvedValue(withoutFlag as SubagentRunResponse)

    render(<SubagentRunPage sourceSessionId="session-1" toolUseId="tool-1" title="Kuhn" />)

    await screen.findByTestId('subagent-conversation')
    expect(screen.getByTestId('subagent-readonly-note')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('continues a resumable agent from the shared conversation composer', async () => {
    vi.mocked(subagentsApi.getRunByTool).mockResolvedValue(subagentRun({ canSendMessage: true }))
    vi.mocked(subagentsApi.sendMessage).mockResolvedValue({
      ok: true,
      agent_id: 'abc123',
      delivery: 'resumed',
    })
    useTabStore.getState().openTab('session-1', 'Parent session')
    useTabStore.getState().openSubagentTab('session-1', 'tool-1', 'Kuhn', 'agent-1')

    render(
      <SubagentRunPage
        sourceSessionId="session-1"
        toolUseId="tool-1"
        taskId="agent-1"
        title="Kuhn"
      />,
    )

    await screen.findByTestId('subagent-conversation')
    expect(screen.queryByTestId('subagent-readonly-note')).not.toBeInTheDocument()
    setComposerText('Review the new regression test.', 31)
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })

    await waitFor(() => {
      expect(subagentsApi.sendMessage).toHaveBeenCalledWith(
        'session-1',
        'tool-1',
        'Review the new regression test.',
        'agent-1',
      )
    })
  })

  it('keeps a failed continuation visible after the transcript refreshes', async () => {
    vi.mocked(subagentsApi.getRunByTool).mockResolvedValue(subagentRun({ canSendMessage: true }))
    vi.mocked(subagentsApi.sendMessage).mockRejectedValue(new Error('Agent transcript is unavailable'))
    useTabStore.getState().openTab('session-1', 'Parent session')
    useTabStore.getState().openSubagentTab('session-1', 'tool-1', 'Kuhn', 'agent-1')

    render(
      <SubagentRunPage
        sourceSessionId="session-1"
        toolUseId="tool-1"
        taskId="agent-1"
        title="Kuhn"
      />,
    )

    await screen.findByTestId('subagent-conversation')
    setComposerText('Continue the review.', 20)
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    expect(await screen.findByText('Agent transcript is unavailable')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh SubAgent run' }))
    await waitFor(() => expect(subagentsApi.getRunByTool).toHaveBeenCalledTimes(2))
    expect(screen.getByText('Continue the review.')).toBeInTheDocument()
    expect(screen.getByText('Agent transcript is unavailable')).toBeInTheDocument()
    expect(screen.queryByText('Thinking...')).not.toBeInTheDocument()
  })

  it('renders a loading state while the run is loading', () => {
    vi.mocked(subagentsApi.getRunByTool).mockReturnValue(deferred<SubagentRunResponse>().promise)

    render(<SubagentRunPage sourceSessionId="session-1" toolUseId="tool-1" title="Kuhn" />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading SubAgent run...')
    expect(screen.getByRole('button', { name: 'Refresh SubAgent run' })).toBeDisabled()
  })

  it('renders a missing transcript fallback', async () => {
    vi.mocked(subagentsApi.getRunByTool).mockResolvedValue(subagentRun({
      agentId: null,
      status: 'unknown',
      summary: 'Only summary available',
      messages: [],
      source: 'none',
    }))

    render(<SubagentRunPage sourceSessionId="session-1" toolUseId="tool-1" title="SubAgent" />)

    const conversation = await screen.findByTestId('subagent-conversation')
    expect(conversation).toHaveTextContent('Only summary available')
    expect(screen.queryByText('No local transcript messages captured for this SubAgent.')).not.toBeInTheDocument()
  })

  it('refreshes running SubAgent runs while the detail tab is open', async () => {
    vi.mocked(subagentsApi.getRunByTool)
      .mockResolvedValueOnce(subagentRun({
        status: 'running',
        messages: [],
        prompt: 'Review streaming changes',
      }))
      .mockResolvedValueOnce(subagentRun({
        status: 'completed',
        messages: [],
        prompt: 'Review streaming changes',
        result: 'Streaming review complete',
      }))

    render(<SubagentRunPage sourceSessionId="session-1" toolUseId="tool-1" title="SubAgent" />)

    expect(await screen.findByText('Running')).toBeInTheDocument()
    expect(screen.getByTestId('subagent-conversation')).toHaveTextContent('Review streaming changes')

    await waitFor(() => expect(subagentsApi.getRunByTool).toHaveBeenCalledTimes(2), { timeout: 2500 })
    expect(await screen.findByText('Completed')).toBeInTheDocument()
    expect(screen.getByTestId('subagent-conversation')).toHaveTextContent('Streaming review complete')
  })

  it('shows newly persisted tool activity before a running SubAgent completes', async () => {
    vi.mocked(subagentsApi.getRunByTool)
      .mockResolvedValueOnce(subagentRun({
        status: 'running',
        messages: [],
        prompt: 'Inspect live tools',
      }))
      .mockResolvedValueOnce(subagentRun({
        status: 'running',
        prompt: 'Inspect live tools',
        messages: [
          {
            id: 'child-tool-use',
            type: 'tool_use',
            content: [{
              type: 'tool_use',
              id: 'child-read-1',
              name: 'Read',
              input: { file_path: '/tmp/example.ts' },
            }],
            timestamp: TRANSCRIPT_TIMESTAMP,
          },
          {
            id: 'child-tool-result',
            type: 'tool_result',
            content: [{
              type: 'tool_result',
              tool_use_id: 'child-read-1',
              content: 'export const ready = true',
            }],
            timestamp: TRANSCRIPT_TIMESTAMP,
          },
        ],
      }))

    render(
      <SubagentRunPage
        sourceSessionId="session-1"
        toolUseId="tool-1"
        taskId="agent-1"
        title="SubAgent"
      />,
    )

    expect(await screen.findByText('Running')).toBeInTheDocument()
    await waitFor(() => expect(subagentsApi.getRunByTool).toHaveBeenCalledTimes(2), { timeout: 2500 })

    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(screen.getByTestId('subagent-conversation')).toHaveTextContent('Read')
    expect(screen.getByTestId('subagent-conversation')).toHaveTextContent('example.ts')
    expect(screen.getByTestId('subagent-conversation')).toHaveTextContent('export const ready = true')
  })

  it('keeps an expanded tool call open after a live run refresh', async () => {
    const firstRefresh = deferred<SubagentRunResponse>()
    const liveRun = (updatedAt: string) => subagentRun({
      status: 'running',
      prompt: 'Inspect live tools',
      updatedAt,
      messages: [
        {
          id: 'child-tool-use',
          type: 'tool_use',
          content: [
            {
              type: 'tool_use',
              id: 'child-bash-1',
              name: 'Bash',
              input: { command: 'pwd' },
            },
            {
              type: 'tool_use',
              id: 'child-glob-1',
              name: 'Glob',
              input: { pattern: '*' },
            },
          ],
          timestamp: TRANSCRIPT_TIMESTAMP,
        },
        {
          id: 'child-tool-results',
          type: 'tool_result',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'child-bash-1',
              content: '/workspace',
            },
            {
              type: 'tool_result',
              tool_use_id: 'child-glob-1',
              content: 'src',
            },
          ],
          timestamp: TRANSCRIPT_TIMESTAMP,
        },
      ],
    })

    vi.mocked(subagentsApi.getRunByTool)
      .mockResolvedValueOnce(liveRun(TRANSCRIPT_TIMESTAMP))
      .mockReturnValueOnce(firstRefresh.promise)

    render(<SubagentRunPage sourceSessionId="session-1" toolUseId="tool-1" title="SubAgent" />)

    // A running run plays open, so its rows are already there — no need to
    // unfold the summary first, and clicking it here would fold them away.
    expect(await screen.findByTestId('activity-group')).toHaveAttribute('data-expanded', 'true')
    fireEvent.click(screen.getByRole('button', { name: /Bash.*pwd/i }))
    expect(document.querySelector('[data-shell-output]')).toHaveTextContent('/workspace')

    await waitFor(() => expect(subagentsApi.getRunByTool).toHaveBeenCalledTimes(2), { timeout: 2500 })
    await act(async () => {
      firstRefresh.resolve(liveRun('2026-07-03T10:20:13.000Z'))
      await firstRefresh.promise
    })

    expect(document.querySelector('[data-shell-output]')).toHaveTextContent('/workspace')
  })

  it('discovers a live task id that arrives after the detail tab opens', async () => {
    vi.mocked(subagentsApi.getRunByTool).mockResolvedValue(subagentRun({
      status: 'running',
      messages: [],
      prompt: 'Wait for task metadata',
    }))

    render(<SubagentRunPage sourceSessionId="session-1" toolUseId="tool-1" title="SubAgent" />)

    expect(await screen.findByText('Running')).toBeInTheDocument()
    expect(subagentsApi.getRunByTool).toHaveBeenCalledWith('session-1', 'tool-1', undefined)

    act(() => {
      useChatStore.setState({
        sessions: {
          'session-1': {
            backgroundAgentTasks: {
              'agent-1': {
                taskId: 'agent-1',
                toolUseId: 'tool-1',
                status: 'running',
                startedAt: 1,
                updatedAt: 1,
              },
            },
          } as never,
        },
      })
    })

    await waitFor(() => {
      expect(subagentsApi.getRunByTool).toHaveBeenCalledWith('session-1', 'tool-1', 'agent-1')
    })
  })

  it('keeps the tab open on API errors', async () => {
    vi.mocked(subagentsApi.getRunByTool).mockRejectedValue(new Error('boom'))

    render(<SubagentRunPage sourceSessionId="session-1" toolUseId="tool-1" title="SubAgent" />)

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('boom'))
    expect(screen.getByRole('button', { name: 'Refresh SubAgent run' })).toBeInTheDocument()
  })

  it('ignores stale responses when the selected SubAgent changes before the first request resolves', async () => {
    const first = deferred<SubagentRunResponse>()
    const second = deferred<SubagentRunResponse>()
    vi.mocked(subagentsApi.getRunByTool).mockImplementation((sessionId) =>
      sessionId === 'session-a' ? first.promise : second.promise
    )

    const { rerender } = render(<SubagentRunPage sourceSessionId="session-a" toolUseId="tool-a" title="First Agent" />)
    rerender(<SubagentRunPage sourceSessionId="session-b" toolUseId="tool-b" title="Second Agent" />)

    await act(async () => {
      second.resolve(subagentRun({
        sessionId: 'session-b',
        toolUseId: 'tool-b',
        summary: 'Second result',
        messages: [{
          id: 'second-finding',
          type: 'assistant',
          content: [{ type: 'text', text: 'Second finding' }],
          timestamp: TRANSCRIPT_TIMESTAMP,
        }],
      }))
      await second.promise
    })

    expect(screen.getByText(/Second finding/)).toBeInTheDocument()

    await act(async () => {
      first.resolve(subagentRun({
        sessionId: 'session-a',
        toolUseId: 'tool-a',
        summary: 'Stale first result',
        messages: [{
          id: 'stale-finding',
          type: 'assistant',
          content: [{ type: 'text', text: 'Stale finding' }],
          timestamp: TRANSCRIPT_TIMESTAMP,
        }],
      }))
      await first.promise
    })

    expect(screen.getByText(/Second finding/)).toBeInTheDocument()
    expect(screen.queryByText('Stale first result')).not.toBeInTheDocument()
    expect(screen.queryByText(/Stale finding/)).not.toBeInTheDocument()
  })

  it('keeps existing details visible when refresh fails', async () => {
    vi.mocked(subagentsApi.getRunByTool)
      .mockResolvedValueOnce(subagentRun({ messages: [], summary: 'Initial result' }))
      .mockRejectedValueOnce(new Error('refresh failed'))

    render(<SubagentRunPage sourceSessionId="session-1" toolUseId="tool-1" title="SubAgent" />)

    expect((await screen.findAllByText('Initial result')).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'Refresh SubAgent run' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('refresh failed'))
    expect(screen.getAllByText('Initial result').length).toBeGreaterThan(0)
  })
})
