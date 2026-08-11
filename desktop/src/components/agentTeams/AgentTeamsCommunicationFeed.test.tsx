import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useSettingsStore } from '../../stores/settingsStore'
import type { TeamMember, TeamWorkbenchMessage, TeamWorkbenchSnapshot } from '../../types/team'
import { AgentTeamsCommunicationFeed } from './AgentTeamsCommunicationFeed'

function message(overrides: Partial<TeamWorkbenchMessage> & { id: string }): TeamWorkbenchMessage {
  return {
    from: 'builder',
    to: 'reviewer',
    recipients: ['reviewer'],
    kind: 'direct',
    text: 'body',
    timestamp: '2026-08-08T07:42:16.666Z',
    ...overrides,
  }
}

function snapshot(messages: TeamWorkbenchMessage[], members: TeamMember[] = []): TeamWorkbenchSnapshot {
  return {
    version: 'v1',
    generatedAt: '2026-08-08T07:00:00.000Z',
    team: { name: 'team-a', leadAgentId: 'lead@team-a', leadSessionId: 'lead-session', members },
    tasks: [],
    messages,
  }
}

describe('AgentTeamsCommunicationFeed', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
  })

  it('narrates lifecycle signals behind a toggle instead of printing their JSON', () => {
    render(<AgentTeamsCommunicationFeed snapshot={snapshot([
      message({ id: 'm1', text: 'Race condition confirmed in queue.ts' }),
      message({
        id: 'm2',
        from: 'release-engineer',
        to: 'team-lead',
        text: '{"type":"idle_notification","from":"release-engineer","timestamp":"2026-08-08T07:42:16.666Z","idleReason":"available"}',
      }),
    ])} />)

    // Lifecycle noise is out of the way by default, and never as raw JSON.
    expect(screen.queryByText(/idle_notification/)).toBeNull()
    expect(screen.getByText('Race condition confirmed in queue.ts')).toBeTruthy()

    fireEvent.click(screen.getByTestId('agent-teams-lifecycle-toggle'))

    expect(screen.queryByText(/idle_notification/)).toBeNull()
    expect(screen.getByText(/Went idle, waiting for work · available/)).toBeTruthy()
    expect(screen.getByTestId('agent-teams-message-m2').getAttribute('data-message-body')).toBe('lifecycle')
  })

  it('counts task handovers as communication instead of hiding them as noise', () => {
    // The reported symptom: a team whose only traffic so far was handing out
    // work reported "0 messages" and tucked all of it behind a status toggle.
    const assignment = (id: string, taskId: string, from: string, to: string) => message({
      id,
      from,
      to,
      recipients: [to],
      kind: 'system',
      protocolType: 'task_assignment',
      taskId,
      text: `{"type":"task_assignment","taskId":"${taskId}","subject":"Task ${taskId}"}`,
    })
    render(<AgentTeamsCommunicationFeed snapshot={snapshot([
      assignment('a1', '2', 'team-lead', 'backend-dev'),
      assignment('a2', '7', 'backend-dev', 'backend-dev'),
      message({
        id: 'idle',
        from: 'backend-dev',
        to: 'team-lead',
        recipients: ['team-lead'],
        text: '{"type":"idle_notification","from":"backend-dev","timestamp":"2026-08-08T07:42:16.666Z"}',
      }),
    ])} />)

    expect(screen.getByText('2 messages')).toBeTruthy()
    expect(screen.getByTestId('agent-teams-message-a1').getAttribute('data-message-body')).toBe('assignment')
    // Being handed work and picking it up are different events.
    expect(screen.getByText(/Assigned #2 Task 2 to backend-dev/)).toBeTruthy()
    expect(screen.getByText(/backend-dev claimed #7 Task 7/)).toBeTruthy()
    // Only the genuine status chatter stays folded away.
    expect(screen.getByTestId('agent-teams-lifecycle-toggle').textContent).toContain('1')
  })

  it('filters to handovers without reclassifying them on the server', () => {
    const assignment = message({
      id: 'a1',
      from: 'team-lead',
      to: 'backend-dev',
      recipients: ['backend-dev'],
      kind: 'system',
      protocolType: 'task_assignment',
      taskId: '2',
      text: '{"type":"task_assignment","taskId":"2","subject":"Build it"}',
    })
    render(<AgentTeamsCommunicationFeed snapshot={snapshot([
      assignment,
      message({ id: 'm1', text: 'Race condition confirmed' }),
    ])} />)

    fireEvent.click(screen.getByTestId('agent-teams-filter-assignment'))

    expect(screen.getByTestId('agent-teams-message-a1')).toBeTruthy()
    expect(screen.queryByTestId('agent-teams-message-m1')).toBeNull()
  })

  it('folds a repeated status signal into one row with its count', () => {
    // A waiting teammate re-announces itself every few seconds; one real run
    // sent eight identical notices inside a minute.
    const idle = (id: string) => message({
      id,
      from: 'backend-dev',
      to: 'team-lead',
      recipients: ['team-lead'],
      text: '{"type":"idle_notification","from":"backend-dev","timestamp":"2026-08-08T07:42:16.666Z"}',
    })
    render(<AgentTeamsCommunicationFeed snapshot={snapshot([
      idle('i1'),
      idle('i2'),
      idle('i3'),
      message({ id: 'm1', text: 'Race condition confirmed' }),
    ])} />)

    fireEvent.click(screen.getByTestId('agent-teams-lifecycle-toggle'))

    expect(screen.getByText('2 messages')).toBeTruthy()
    expect(screen.getByTestId('agent-teams-message-i3-repeats').textContent).toBe('×3')
    expect(screen.queryByTestId('agent-teams-message-i1')).toBeNull()
  })

  it('stamps each row with its own send time rather than a shared snapshot index', () => {
    render(<AgentTeamsCommunicationFeed snapshot={snapshot([
      message({ id: 'm1', text: 'first', timestamp: '2026-08-08T07:42:00.000Z' }),
      message({ id: 'm2', text: 'second', timestamp: '2026-08-08T09:15:00.000Z' }),
    ])} />)

    const times = ['m1', 'm2'].map((id) => {
      const row = screen.getByTestId(`agent-teams-message-${id}`)
      return row.querySelector('.tabular-nums')?.textContent
    })

    expect(times[0]).toBeTruthy()
    expect(times[0]).not.toBe(times[1])
    expect(screen.queryByText(/^T\+\d+$/)).toBeNull()
  })

  it('keeps a long broadcast readable by collapsing it behind an expander', () => {
    const long = 'x'.repeat(400)
    render(<AgentTeamsCommunicationFeed snapshot={snapshot([
      message({ id: 'm1', kind: 'broadcast', to: '*', text: long }),
    ])} />)

    expect(screen.getByTestId('agent-teams-message-m1-body').getAttribute('data-collapsed')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
    expect(screen.getByTestId('agent-teams-message-m1-body').getAttribute('data-collapsed')).toBe('false')

    fireEvent.click(screen.getByRole('button', { name: 'Show less' }))
    expect(screen.getByTestId('agent-teams-message-m1-body').getAttribute('data-collapsed')).toBe('true')
  })

  it('shows sender and recipient as a route and renders message Markdown', () => {
    render(<AgentTeamsCommunicationFeed snapshot={snapshot([
      message({
        id: 'm1',
        text: '## Finding A\n\n**Key evidence**\n\n```ts\nconst fixed = true\n```',
      }),
    ], [
      { agentId: 'builder@team-a', name: 'builder', role: 'server engineer', status: 'running' },
      { agentId: 'reviewer@team-a', name: 'reviewer', role: 'qa engineer', status: 'idle' },
    ])} />)

    const row = screen.getByTestId('agent-teams-message-m1')
    expect(screen.getByTestId('agent-teams-message-m1-from').textContent).toBe('builder')
    expect(screen.getByTestId('agent-teams-message-m1-to').textContent).toBe('reviewer')
    expect(screen.getByTestId('agent-teams-message-m1-from-avatar').getAttribute('data-avatar-key')).toBe('server-engineer')
    expect(screen.getByTestId('agent-teams-message-m1-to-avatar').getAttribute('data-avatar-key')).toBe('security-reviewer')
    expect(row.querySelector('h2')?.textContent).toBe('Finding A')
    expect(row.querySelector('strong')?.textContent).toBe('Key evidence')
    expect(row.textContent).not.toContain('## Finding A')
    expect(screen.getByTestId('agent-teams-message-m1-body').className).toContain('pl-10')
  })

  it('keeps both direct-message figures visible when an archive lacks member metadata', () => {
    render(<AgentTeamsCommunicationFeed snapshot={snapshot([
      message({ id: 'm1', from: 'unknown-builder', to: 'unknown-reviewer' }),
    ])} />)

    expect(screen.getByTestId('agent-teams-message-m1-from-avatar').getAttribute('data-avatar-key')).toBeTruthy()
    expect(screen.getByTestId('agent-teams-message-m1-to-avatar').getAttribute('data-avatar-key')).toBeTruthy()
  })

  it('filters the feed by communication type without mixing unrelated routes', () => {
    render(<AgentTeamsCommunicationFeed snapshot={snapshot([
      message({ id: 'direct-message', text: 'private review' }),
      message({ id: 'broadcast-message', kind: 'broadcast', to: '*', text: 'team update' }),
    ])} />)

    fireEvent.click(screen.getByTestId('agent-teams-filter-broadcast'))

    expect(screen.queryByTestId('agent-teams-message-direct-message')).toBeNull()
    expect(screen.getByTestId('agent-teams-message-broadcast-message')).toBeTruthy()
    expect(screen.getByTestId('agent-teams-filter-broadcast').getAttribute('aria-pressed')).toBe('true')
  })

  it('filters communication by concrete phases of the task timeline', () => {
    render(<AgentTeamsCommunicationFeed snapshot={snapshot([
      message({ id: 'early', text: 'scope agreed', timestamp: '2026-08-08T07:00:00.000Z' }),
      message({ id: 'middle', text: 'implementation update', timestamp: '2026-08-08T07:30:00.000Z' }),
      message({ id: 'late', text: 'review complete', timestamp: '2026-08-08T08:00:00.000Z' }),
    ])} />)

    expect(screen.getByTestId('agent-teams-time-range').textContent).toContain('–')
    fireEvent.click(screen.getByTestId('agent-teams-time-late'))

    expect(screen.queryByTestId('agent-teams-message-early')).toBeNull()
    expect(screen.queryByTestId('agent-teams-message-middle')).toBeNull()
    expect(screen.getByTestId('agent-teams-message-late')).toBeTruthy()
    expect(screen.getByTestId('agent-teams-time-late').getAttribute('aria-pressed')).toBe('true')
  })
})
