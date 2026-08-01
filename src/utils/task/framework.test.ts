import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  resetStateForTests,
  setIsInteractive,
  switchSession,
} from '../../bootstrap/state.js'
import type { AppState } from '../../state/AppState.js'
import type { RemoteAgentTaskState } from '../../tasks/RemoteAgentTask/RemoteAgentTask.js'
import type { SessionId } from '../../types/ids.js'
import { drainSdkEvents } from '../sdkEventQueue.js'
import { registerTask } from './framework.js'

beforeEach(() => {
  resetStateForTests()
  setIsInteractive(false)
  switchSession('remote-agent-task-started' as SessionId)
  drainSdkEvents()
})

afterEach(() => {
  drainSdkEvents()
  resetStateForTests()
})

test('includes the remote session id in remote Agent start events', () => {
  let state = { tasks: {} } as AppState
  const task = {
    id: 'remote-task-1',
    type: 'remote_agent',
    status: 'running',
    description: 'Review provider failures',
    sessionId: 'remote-session-1',
    toolUseId: 'remote-tool-1',
  } as RemoteAgentTaskState

  registerTask(task, (updater) => {
    state = updater(state)
  })

  expect(drainSdkEvents()).toContainEqual(expect.objectContaining({
    type: 'system',
    subtype: 'task_started',
    task_id: 'remote-task-1',
    task_type: 'remote_agent',
    remote_session_id: 'remote-session-1',
  }))
})
