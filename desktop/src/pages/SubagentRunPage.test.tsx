import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SubagentRunResponse } from '../api/subagents'
import { useSettingsStore } from '../stores/settingsStore'

vi.mock('../api/subagents', () => ({
  subagentsApi: {
    getRunByTool: vi.fn(),
  },
}))

import { subagentsApi } from '../api/subagents'
import { useChatStore } from '../stores/chatStore'
import { SubagentRunPage } from './SubagentRunPage'

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
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.mocked(subagentsApi.getRunByTool).mockReset()
  })

  it('renders SubAgent run details', async () => {
    vi.mocked(subagentsApi.getRunByTool).mockResolvedValue(subagentRun({
      outputFile: '/tmp/result.md',
    }))

    render(<SubagentRunPage sourceSessionId="session-1" toolUseId="tool-1" taskId="agent-1" title="Kuhn" />)

    expect(await screen.findByText('Kuhn')).toBeInTheDocument()
    expect(subagentsApi.getRunByTool).toHaveBeenCalledWith('session-1', 'tool-1', 'agent-1')
    const summary = screen.getByTestId('subagent-run-summary')
    expect(summary).toHaveAttribute('data-slot', 'card')
    expect(within(summary).getByText('Agent')).toBeInTheDocument()
    expect(within(summary).getByText('abc123')).toBeInTheDocument()
    expect(screen.getAllByText('Explore repo').length).toBeGreaterThan(0)
    expect(within(summary).getByText('Output')).toBeInTheDocument()
    expect(within(summary).getByText('/tmp/result.md')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Completed')
    expect(screen.getByRole('status')).toHaveAttribute('data-slot', 'badge')
    expect(screen.getByRole('status')).toHaveAttribute('aria-atomic', 'true')
    expect(screen.getByRole('button', { name: 'Refresh SubAgent run' })).toHaveAttribute('data-variant', 'ghost')
    expect(screen.getByRole('heading', { name: 'Transcript' }).closest('[data-slot="card"]')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Stop$/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Parent Agent Tool Call')).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('"prompt": "Read files"')
    expect(screen.queryByText(/Dispatched an agent|派遣了一个代理/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Open run/ })).not.toBeInTheDocument()

    const transcript = screen.getByTestId('subagent-conversation')
    expect(transcript).toHaveTextContent('Read files')
    expect(transcript).toHaveTextContent('Finding')
    expect(transcript).not.toHaveTextContent('assistant_text')
  })

  it('renders a loading state while the run is loading', () => {
    vi.mocked(subagentsApi.getRunByTool).mockReturnValue(deferred<SubagentRunResponse>().promise)

    render(<SubagentRunPage sourceSessionId="session-1" toolUseId="tool-1" title="Kuhn" />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading SubAgent run...')
    const refresh = screen.getByRole('button', { name: 'Refresh SubAgent run' })
    expect(refresh).toBeDisabled()
    expect(refresh.querySelector('svg')).toHaveClass('motion-safe:animate-spin', 'motion-reduce:animate-none')
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

  it('uses the shared empty state when no transcript or fallback result exists', async () => {
    vi.mocked(subagentsApi.getRunByTool).mockResolvedValue(subagentRun({
      messages: [],
      prompt: undefined,
      summary: undefined,
      result: undefined,
    }))

    render(<SubagentRunPage sourceSessionId="session-1" toolUseId="tool-1" title="SubAgent" />)

    const emptyState = await screen.findByText('No local transcript messages captured for this SubAgent.')
    expect(emptyState.closest('[data-slot="card"]')).toHaveClass('border-dashed')
  })

  it('shows transcript truncation as a shadcn badge', async () => {
    vi.mocked(subagentsApi.getRunByTool).mockResolvedValue(subagentRun({ truncated: true }))

    render(<SubagentRunPage sourceSessionId="session-1" toolUseId="tool-1" title="SubAgent" />)

    const truncation = await screen.findByText('Showing first 50 and latest 950 entries')
    expect(truncation).toHaveAttribute('data-slot', 'badge')
  })

  it('keeps a terminal result visible after partial transcript activity', async () => {
    vi.mocked(subagentsApi.getRunByTool).mockResolvedValue(subagentRun({
      result: 'Final audit result',
      messages: [{
        id: 'progress',
        type: 'assistant',
        content: [{ type: 'text', text: 'Progress update' }],
        timestamp: TRANSCRIPT_TIMESTAMP,
      }],
    }))

    render(<SubagentRunPage sourceSessionId="session-1" toolUseId="tool-1" title="SubAgent" />)

    const transcript = await screen.findByTestId('subagent-conversation')
    expect(transcript).toHaveTextContent('Progress update')
    expect(transcript).toHaveTextContent('Final audit result')
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
    expect(screen.getByRole('alert')).toHaveAttribute('data-slot', 'alert')
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

    await waitFor(() => expect(screen.getByText('refresh failed').closest('[role="status"]')).toBeInTheDocument())
    expect(screen.getAllByText('Initial result').length).toBeGreaterThan(0)
  })
})
