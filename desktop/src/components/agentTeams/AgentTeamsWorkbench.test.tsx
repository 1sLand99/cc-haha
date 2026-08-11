import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '../../stores/chatStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTeamStore } from '../../stores/teamStore'
import { useTabStore } from '../../stores/tabStore'
import type { TeamWorkbenchSnapshot, TeamWorkbenchTask } from '../../types/team'
import { AgentTeamsWorkbench } from './AgentTeamsWorkbench'

const { getWorkbenchForSessionMock, getWorkbenchMock } = vi.hoisted(() => ({
  getWorkbenchForSessionMock: vi.fn(),
  getWorkbenchMock: vi.fn(),
}))

vi.mock('../../api/teams', () => ({
  teamsApi: {
    list: vi.fn(),
    get: vi.fn(),
    getWorkbenchForSession: getWorkbenchForSessionMock,
    getWorkbench: getWorkbenchMock,
    getMemberTranscript: vi.fn(),
    sendMemberMessage: vi.fn(),
    delete: vi.fn(),
  },
}))

function task(
  id: string,
  status: TeamWorkbenchTask['status'],
  blockedBy: string[] = [],
  owner?: string,
): TeamWorkbenchTask {
  return {
    id,
    subject: `Task ${id}`,
    description: `Task ${id} detail`,
    activeForm: status === 'in_progress' ? `Working on task ${id}` : undefined,
    owner,
    status,
    blocks: [],
    blockedBy,
    taskListId: 'visual-team',
  }
}

function firePointer(target: Node | Window, type: string, clientX: number, button = 0) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    clientX: { value: clientX },
    button: { value: button },
  })
  fireEvent(target, event)
}

function workbench(
  version: string,
  statuses: [TeamWorkbenchTask['status'], TeamWorkbenchTask['status'], TeamWorkbenchTask['status']],
): TeamWorkbenchSnapshot {
  return {
    version,
    generatedAt: `2026-08-08T00:00:0${version.slice(-1)}.000Z`,
    team: {
      name: 'visual-team',
      leadAgentId: 'team-lead@visual-team',
      leadSessionId: 'lead-session',
      members: [
        { agentId: 'team-lead@visual-team', name: 'team-lead', role: 'lead', status: 'running' },
        { agentId: 'builder@visual-team', name: 'builder', role: 'frontend', status: 'running' },
        { agentId: 'reviewer@visual-team', name: 'reviewer', role: 'reviewer', status: 'idle' },
      ],
    },
    tasks: [
      task('1', statuses[0], [], 'builder'),
      task('2', statuses[1], ['1'], 'reviewer'),
      task('3', statuses[2], ['1', '2']),
    ],
    messages: [{
      id: `message-${version}`,
      from: 'builder',
      to: 'reviewer',
      recipients: ['reviewer'],
      kind: 'direct',
      text: `Snapshot ${version} ready`,
      timestamp: `2026-08-08T00:00:0${version.slice(-1)}.000Z`,
    }],
  }
}

function unownedWorkbench(
  version: string,
  builderStatus: 'running' | 'idle',
): TeamWorkbenchSnapshot {
  const snapshot = workbench(version, ['pending', 'pending', 'pending'])
  snapshot.tasks = snapshot.tasks.map((entry) => ({ ...entry, owner: undefined }))
  snapshot.team.members = snapshot.team.members.map((member) => (
    member.name === 'builder'
      ? { ...member, status: builderStatus }
      : member
  ))
  return snapshot
}

describe('AgentTeamsWorkbench', () => {
  beforeEach(() => {
    getWorkbenchMock.mockReset()
    getWorkbenchForSessionMock.mockReset()
    useTeamStore.getState().clearTeam()
    useTabStore.setState({ tabs: [], activeTabId: null })
    useSettingsStore.setState({ locale: 'en' })
  })

  it('renders a multi-dependency team and keeps history fixed while live updates continue', async () => {
    getWorkbenchMock
      .mockResolvedValueOnce(workbench('v1', ['completed', 'in_progress', 'pending']))
      .mockResolvedValueOnce(workbench('v2', ['completed', 'completed', 'in_progress']))
      .mockResolvedValueOnce(workbench('v3', ['completed', 'completed', 'completed']))

    await act(async () => {
      await useTeamStore.getState().fetchWorkbench('visual-team')
      await useTeamStore.getState().fetchWorkbench('visual-team')
    })
    const { container } = render(<AgentTeamsWorkbench sessionId="lead-session" />)

    expect(screen.getByTestId('agent-teams-task-2').getAttribute('data-state')).toBe('completed')
    expect(screen.getByTestId('agent-teams-task-3').getAttribute('data-state')).toBe('running')
    expect(screen.getByText('Snapshot v2 ready')).toBeTruthy()
    expect(screen.getByTestId('agent-teams-member-team-lead@visual-team').getAttribute('data-avatar-key')).toBe('team-lead')
    expect(screen.getByTestId('agent-teams-member-builder@visual-team').getAttribute('data-avatar-key')).toBe('ui-designer')
    expect(screen.getByTestId('agent-teams-member-builder@visual-team').querySelector('img')).toBeTruthy()
    expect(container.querySelector('[data-layout-role="leader-root"]')?.getAttribute('data-center-x')).toBe('302')
    expect(container.querySelectorAll('[data-edge-kind="leader-root"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-edge-kind="dependency-primary"]')).toHaveLength(2)
    expect(container.querySelectorAll('[data-edge-kind="dependency-secondary"]')).toHaveLength(1)
    // reviewer's task is finished, so its card carries an owner chip rather
    // than the character -- the character stands on whatever its member is on.
    expect(screen.getByTestId('agent-teams-task-2').querySelector('img')).toBeNull()
    expect(screen.getByTestId('agent-teams-task-owner-2').textContent).toContain('reviewer')
    expect(screen.getByTestId('agent-teams-member-builder@visual-team').className).toContain('cursor-pointer')

    fireEvent.mouseEnter(screen.getByTestId('agent-teams-task-3'))
    expect(container.querySelectorAll('[data-edge-active="true"]')).toHaveLength(2)
    fireEvent.mouseLeave(screen.getByTestId('agent-teams-task-3'))
    expect(container.querySelectorAll('[data-edge-active="true"]')).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Review history' }))
    expect(screen.getByTestId('agent-teams-task-2').getAttribute('data-state')).toBe('running')
    expect(screen.getByTestId('agent-teams-task-3').getAttribute('data-state')).toBe('blocked')

    await act(async () => {
      await useTeamStore.getState().fetchWorkbench('visual-team')
    })
    expect(screen.getByTestId('agent-teams-task-2').getAttribute('data-state')).toBe('running')
    expect(screen.getByText('Snapshot v1 ready')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Back to live' }))
    await waitFor(() => {
      expect(screen.getByTestId('agent-teams-task-3').getAttribute('data-state')).toBe('completed')
    })
    expect(screen.getByText('Snapshot v3 ready')).toBeTruthy()
  })

  it('follows server-driven idle to running to idle member lifecycle without an owned task', async () => {
    getWorkbenchMock
      .mockResolvedValueOnce(unownedWorkbench('lifecycle-1', 'idle'))
      .mockResolvedValueOnce(unownedWorkbench('lifecycle-2', 'running'))
      .mockResolvedValueOnce(unownedWorkbench('lifecycle-3', 'idle'))

    await act(async () => {
      await useTeamStore.getState().fetchWorkbench('visual-team')
    })
    render(<AgentTeamsWorkbench sessionId="lead-session" />)

    const builder = () => screen.getByTestId('agent-teams-member-builder@visual-team')
    expect(builder().getAttribute('data-member-state')).toBe('idle')

    act(() => {
      useChatStore.getState().handleServerMessage('lead-session', {
        type: 'team_workbench_updated',
        teamName: 'visual-team',
      })
    })
    await waitFor(() => {
      expect(builder().getAttribute('data-member-state')).toBe('working')
    })

    act(() => {
      useChatStore.getState().handleServerMessage('lead-session', {
        type: 'team_workbench_updated',
        teamName: 'visual-team',
      })
    })
    await waitFor(() => {
      expect(builder().getAttribute('data-member-state')).toBe('idle')
    })
  })

  it('keeps a member idle while it still owns an in-progress task', async () => {
    // A teammate marks a task started and can then end its turn, and an
    // umbrella task stays open across every turn underneath it. Reading member
    // activity off the task list is what made every member look permanently
    // busy, so the card and the figure have to disagree here.
    const snapshot = workbench('v1', ['in_progress', 'pending', 'pending'])
    snapshot.team.members = snapshot.team.members.map((member) => (
      member.name === 'builder'
        ? { ...member, status: 'running' as const, activity: 'idle' as const }
        : member
    ))
    getWorkbenchMock.mockResolvedValueOnce(snapshot)

    await act(async () => {
      await useTeamStore.getState().fetchWorkbench('visual-team')
    })
    render(<AgentTeamsWorkbench sessionId="lead-session" />)

    expect(
      screen.getByTestId('agent-teams-member-builder@visual-team').getAttribute('data-member-state'),
    ).toBe('idle')
    expect(screen.getByTestId('agent-teams-task-1').getAttribute('data-state')).toBe('running')
  })

  it('shows a member working while it owns no task at all', async () => {
    const snapshot = unownedWorkbench('v1', 'idle')
    snapshot.team.members = snapshot.team.members.map((member) => (
      member.name === 'builder'
        ? { ...member, activity: 'active' as const }
        : member
    ))
    getWorkbenchMock.mockResolvedValueOnce(snapshot)

    await act(async () => {
      await useTeamStore.getState().fetchWorkbench('visual-team')
    })
    render(<AgentTeamsWorkbench sessionId="lead-session" />)

    expect(
      screen.getByTestId('agent-teams-member-builder@visual-team').getAttribute('data-member-state'),
    ).toBe('working')
  })

  it('labels a task card by dependency depth rather than by the id it was created with', async () => {
    // Reviews are planned first and so own the lowest ids while depending on
    // the work above them. Showing that id where a step number belongs read as
    // "step 1" for the very last thing the team does.
    const snapshot = workbench('v1', ['pending', 'pending', 'pending'])
    getWorkbenchMock.mockResolvedValueOnce(snapshot)

    await act(async () => {
      await useTeamStore.getState().fetchWorkbench('visual-team')
    })
    render(<AgentTeamsWorkbench sessionId="lead-session" />)

    // task 1 is a root, task 2 depends on it, task 3 depends on both.
    expect(screen.getByTestId('agent-teams-task-1').textContent).toContain('Layer 1')
    expect(screen.getByTestId('agent-teams-task-2').textContent).toContain('Layer 2')
    expect(screen.getByTestId('agent-teams-task-3').textContent).toContain('Layer 3')
    expect(screen.getByTestId('agent-teams-task-3').textContent).not.toContain('#3')
    expect(
      screen.getByTestId('agent-teams-task-3').querySelector('[data-task-id="3"]'),
    ).toBeTruthy()
  })

  it('opens a teammate in the shared agent run desktop instead of replacing the map', async () => {
    getWorkbenchMock.mockResolvedValueOnce(workbench('v1', ['completed', 'in_progress', 'pending']))
    await act(async () => {
      await useTeamStore.getState().fetchWorkbench('visual-team')
    })
    render(<AgentTeamsWorkbench sessionId="lead-session" />)

    await act(async () => {
      fireEvent.click(screen.getByTestId('agent-teams-member-reviewer@visual-team'))
    })

    expect(useTabStore.getState().activeTabId).toBe('team-member:reviewer@visual-team')
    expect(useTabStore.getState().tabs.find((tab) => tab.sessionId === 'team-member:reviewer@visual-team')).toMatchObject({
      type: 'team-member',
      teamLeadSessionId: 'lead-session',
    })
    expect(screen.getByTestId('agent-teams-office')).toBeTruthy()
    expect(screen.queryByTestId('agent-teams-member-view')).toBeNull()
  })

  it('describes the task when its card is opened, and reaches the owner only on request', async () => {
    // A card carries a task's status, so opening one used to land the user in
    // the owner's conversation -- which is how a card reading "completed" led
    // to a teammate that was still streaming its next task.
    getWorkbenchMock.mockResolvedValueOnce(workbench('v1', ['completed', 'in_progress', 'pending']))
    await act(async () => {
      await useTeamStore.getState().fetchWorkbench('visual-team')
    })
    render(<AgentTeamsWorkbench sessionId="lead-session" />)

    fireEvent.click(screen.getByTestId('agent-teams-task-1'))
    expect(useTabStore.getState().activeTabId).toBeNull()
    expect(screen.getByTestId('agent-teams-task-detail').getAttribute('data-task-id')).toBe('1')
    expect(screen.getByTestId('agent-teams-task-detail').textContent).toContain('Task 1 detail')

    fireEvent.keyDown(screen.getByTestId('agent-teams-task-2'), { key: 'Enter' })
    expect(useTabStore.getState().activeTabId).toBeNull()
    expect(screen.getByTestId('agent-teams-task-detail').getAttribute('data-task-id')).toBe('2')

    fireEvent.click(screen.getByTestId('agent-teams-task-owner-2'))
    expect(useTabStore.getState().activeTabId).toBe('team-member:reviewer@visual-team')
  })

  it('draws a member once even while it owns several open tasks', async () => {
    const snapshot = workbench('v1', ['in_progress', 'in_progress', 'pending'])
    snapshot.tasks = snapshot.tasks.map((entry) => ({ ...entry, owner: 'builder' }))
    getWorkbenchMock.mockResolvedValueOnce(snapshot)
    await act(async () => {
      await useTeamStore.getState().fetchWorkbench('visual-team')
    })
    const { container } = render(<AgentTeamsWorkbench sessionId="lead-session" />)

    // One teammate owning six cards used to be drawn as six characters.
    expect(
      container.querySelectorAll('[data-testid="agent-teams-member-builder@visual-team"]'),
    ).toHaveLength(1)
    // The other cards still say who has them.
    expect(screen.getByTestId('agent-teams-task-owner-2').textContent).toContain('builder')
  })

  it('opens an archived teammate in the same shared agent run desktop', async () => {
    const archived = workbench('v1', ['completed', 'completed', 'completed'])
    archived.deletedAt = '2026-08-08T00:10:00.000Z'
    archived.team.members = archived.team.members.map((member) => ({
      ...member,
      status: 'completed',
    }))
    getWorkbenchMock.mockResolvedValueOnce(archived)
    await act(async () => {
      await useTeamStore.getState().fetchWorkbench('visual-team')
    })
    render(<AgentTeamsWorkbench sessionId="lead-session" />)

    fireEvent.click(screen.getByTestId('agent-teams-member-reviewer@visual-team'))

    expect(useTabStore.getState().activeTabId).toBe('team-member:reviewer@visual-team')
  })

  it('replays a shrinking archived roster without orphaning owners or hanging exited observers under the lead', async () => {
    const beforeRemoval = workbench('roster-1', ['in_progress', 'in_progress', 'pending'])
    beforeRemoval.team.members.push({
      agentId: 'observer@visual-team',
      name: 'observer',
      role: 'researcher',
      status: 'idle',
    })
    const afterRemoval: TeamWorkbenchSnapshot = {
      ...workbench('roster-2', ['completed', 'completed', 'completed']),
      deletedAt: '2026-08-08T00:10:00.000Z',
      team: {
        ...beforeRemoval.team,
        members: beforeRemoval.team.members
          .filter((member) => member.name !== 'builder')
          .map((member) => ({ ...member, status: 'completed' as const })),
      },
      tasks: workbench('roster-2', ['completed', 'completed', 'completed']).tasks.map((entry) => (
        entry.id === '3' ? { ...entry, owner: 'legacy-owner' } : entry
      )),
    }
    getWorkbenchForSessionMock.mockResolvedValueOnce({
      sessionId: 'lead-session',
      teamName: 'visual-team',
      source: 'archive',
      snapshots: [beforeRemoval, afterRemoval],
    })

    await act(async () => {
      await useTeamStore.getState().fetchTeamForSession('lead-session', { force: true })
    })
    render(<AgentTeamsWorkbench sessionId="lead-session" />)

    const restoredOwnerTask = screen.getByTestId('agent-teams-task-1')
    expect(restoredOwnerTask.getAttribute('data-owner-agent-id')).toBe('builder@visual-team')
    expect(within(restoredOwnerTask).getByText('builder')).toBeTruthy()
    fireEvent.click(screen.getByTestId('agent-teams-task-owner-1'))
    expect(useTabStore.getState().activeTabId).toBe('team-member:builder@visual-team')

    const rawOwnerTask = screen.getByTestId('agent-teams-task-3')
    expect(within(rawOwnerTask).getByText('legacy-owner')).toBeTruthy()
    expect(within(rawOwnerTask).queryByText('Waiting for a teammate')).toBeNull()

    const archivedRoster = screen.getByTestId('agent-teams-archived-members')
    const observer = screen.getByTestId('agent-teams-member-observer@visual-team')
    expect(archivedRoster.contains(observer)).toBe(true)
    expect(observer.getAttribute('data-member-state')).toBe('exited')
    fireEvent.click(observer)
    expect(useTabStore.getState().activeTabId).toBe('team-member:observer@visual-team')
  })

  it('carries no docked-panel chrome of its own', async () => {
    getWorkbenchMock.mockResolvedValueOnce(workbench('v1', ['completed', 'in_progress', 'pending']))
    await act(async () => {
      await useTeamStore.getState().fetchWorkbench('visual-team')
    })
    render(<AgentTeamsWorkbench sessionId="lead-session" />)

    expect(screen.queryByRole('button', { name: /Open the workbench full screen/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Close Agent Teams workbench/i })).toBeNull()
    // The feed always owns a column here; the 210px docked strip is gone.
    const feed = screen.getByTestId('agent-teams-communication')
    expect(feed.className).toContain('h-full')
    expect(feed.className).not.toContain('h-[210px]')
  })

  it('never describes an ownerless completed task as waiting to be claimed', async () => {
    const snapshot = workbench('v1', ['completed', 'pending', 'completed'])
    snapshot.tasks = snapshot.tasks.map((entry) => (
      entry.id === '1' || entry.id === '2'
        ? { ...entry, owner: undefined }
        : entry
    ))
    getWorkbenchMock.mockResolvedValueOnce(snapshot)
    await act(async () => {
      await useTeamStore.getState().fetchWorkbench('visual-team')
    })

    render(<AgentTeamsWorkbench sessionId="lead-session" />)

    const completed = screen.getByTestId('agent-teams-task-1')
    expect(within(completed).getByText('Completed · owner not recorded')).toBeTruthy()
    expect(within(completed).queryByText('Waiting for a teammate')).toBeNull()

    const available = screen.getByTestId('agent-teams-task-2')
    expect(within(available).getByText('Waiting for a teammate')).toBeTruthy()
    expect(within(available).queryByText('Completed · owner not recorded')).toBeNull()
  })

  it('resizes the communication column by pointer and keyboard without collapsing the DAG', async () => {
    getWorkbenchMock.mockResolvedValueOnce(workbench('v1', ['completed', 'in_progress', 'pending']))
    await act(async () => {
      await useTeamStore.getState().fetchWorkbench('visual-team')
    })
    render(<AgentTeamsWorkbench sessionId="lead-session" />)

    const divider = screen.getByTestId('agent-teams-split-divider')
    const pane = screen.getByTestId('agent-teams-communication-pane')
    expect(pane.style.width).toBe('440px')

    firePointer(divider, 'pointerdown', 800)
    firePointer(window, 'pointermove', 700)
    firePointer(window, 'pointerup', 700)
    expect(pane.style.width).toBe('540px')

    fireEvent.keyDown(divider, { key: 'ArrowRight' })
    expect(pane.style.width).toBe('508px')
    expect(screen.getByTestId('agent-teams-office')).toBeTruthy()
  })

  it('keeps every archived teammate character visible inside the organization tree', async () => {
    const archived = workbench('v1', ['completed', 'completed', 'completed'])
    archived.deletedAt = '2026-08-08T00:10:00.000Z'
    archived.team.members = archived.team.members.map((member) => ({
      ...member,
      status: 'completed',
    }))
    getWorkbenchMock.mockResolvedValueOnce(archived)
    await act(async () => {
      await useTeamStore.getState().fetchWorkbench('visual-team')
    })

    render(<AgentTeamsWorkbench sessionId="lead-session" />)

    for (const member of archived.team.members) {
      const figure = screen.getByTestId(`agent-teams-member-${member.agentId}`)
      expect(figure.getAttribute('data-member-state')).toBe('exited')
      expect(figure.querySelector('img')).toBeTruthy()
      expect(figure.getAttribute('style') ?? '').not.toContain('opacity: 0')
    }

    fireEvent.click(screen.getByTestId('agent-teams-member-reviewer@visual-team'))
    expect(useTabStore.getState().activeTabId).toBe('team-member:reviewer@visual-team')
  })

  it('keeps a crowded archived roster in a scrollable narrow lane with touch-sized targets', async () => {
    const archived = workbench('v1', ['completed', 'completed', 'completed'])
    archived.deletedAt = '2026-08-08T00:10:00.000Z'
    archived.team.members = [
      ...archived.team.members.map((member) => ({
        ...member,
        status: 'completed' as const,
      })),
      ...Array.from({ length: 12 }, (_, index) => ({
        agentId: `observer-${index}@visual-team`,
        name: `observer-${index}`,
        role: 'observer',
        status: 'completed' as const,
      })),
    ]
    getWorkbenchMock.mockResolvedValueOnce(archived)
    await act(async () => {
      await useTeamStore.getState().fetchWorkbench('visual-team')
    })

    render(<AgentTeamsWorkbench sessionId="lead-session" />)

    const archivedRoster = screen.getByTestId('agent-teams-archived-members')
    expect(archivedRoster.className).toContain('left-3')
    expect(archivedRoster.className).toContain('right-3')
    expect(archivedRoster.className).toContain('h-16')
    expect(archivedRoster.className).toContain('overflow-x-auto')
    expect(archivedRoster.className).toContain('overflow-y-hidden')

    const observers = screen.getAllByTestId(/^agent-teams-member-observer-/)
    expect(observers).toHaveLength(12)
    for (const observer of observers) {
      expect(observer.className).toContain('h-11')
      expect(observer.className).toContain('w-11')
      expect(observer.className).toContain('shrink-0')
    }

    fireEvent.click(observers.at(-1)!)
    expect(useTabStore.getState().activeTabId).toBe('team-member:observer-11@visual-team')
  })
})
