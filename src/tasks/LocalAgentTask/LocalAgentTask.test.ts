import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  resetStateForTests,
  setIsInteractive,
  switchSession,
} from '../../bootstrap/state.js'
import type { AppState } from '../../state/AppState.js'
import { IDLE_SPECULATION_STATE } from '../../state/AppStateStore.js'
import { createTaskStateBase } from '../../Task.js'
import type { SessionId } from '../../types/ids.js'
import {
  getCommandQueue,
  resetCommandQueue,
} from '../../utils/messageQueueManager.js'
import { drainSdkEvents } from '../../utils/sdkEventQueue.js'
import {
  enqueueAgentNotification,
  type LocalAgentTaskState,
} from './LocalAgentTask.js'

function makeHarness(ownerAgentId?: string) {
  const taskId = ownerAgentId ? 'nested-agent' : 'root-agent'
  const task: LocalAgentTaskState = {
    ...createTaskStateBase(taskId, 'local_agent', 'Inspect ownership', 'toolu_agent'),
    type: 'local_agent',
    status: 'running',
    ownerAgentId,
    agentId: taskId,
    prompt: 'Inspect ownership',
    agentType: 'general-purpose',
    retrieved: false,
    lastReportedToolCount: 0,
    lastReportedTokenCount: 0,
    isBackgrounded: true,
    pendingMessages: [],
    retain: false,
    diskLoaded: false,
  }
  let state = {
    tasks: { [taskId]: task },
    speculation: IDLE_SPECULATION_STATE,
  } as unknown as AppState
  return {
    taskId,
    setAppState(updater: (prev: AppState) => AppState) {
      state = updater(state)
    },
  }
}

beforeEach(() => {
  resetStateForTests()
  resetCommandQueue()
  setIsInteractive(false)
  switchSession('local-agent-owner-test' as SessionId)
  drainSdkEvents()
})

afterEach(() => {
  drainSdkEvents()
  resetCommandQueue()
  resetStateForTests()
})

describe('enqueueAgentNotification ownership', () => {
  test('keeps a root agent terminal notification on the main-thread path', () => {
    const harness = makeHarness()

    enqueueAgentNotification({
      taskId: harness.taskId,
      description: 'Inspect ownership',
      status: 'completed',
      setAppState: harness.setAppState,
      toolUseId: 'toolu_agent',
    })

    expect(getCommandQueue()).toHaveLength(1)
    expect(getCommandQueue()[0]?.agentId).toBeUndefined()
    expect(drainSdkEvents()).toEqual([])
  })

  test('routes a nested terminal notification to its parent and emits owned SDK metadata', () => {
    const harness = makeHarness('parent-agent')

    enqueueAgentNotification({
      taskId: harness.taskId,
      description: 'Inspect ownership',
      status: 'completed',
      setAppState: harness.setAppState,
      toolUseId: 'toolu_agent',
      finalMessage: 'Ownership verified',
    })

    expect(getCommandQueue()).toHaveLength(1)
    expect(getCommandQueue()[0]?.agentId).toBe('parent-agent')
    expect(String(getCommandQueue()[0]?.value)).toContain(
      '<result>Ownership verified</result>',
    )
    expect(drainSdkEvents()).toEqual([
      expect.objectContaining({
        subtype: 'task_notification',
        task_id: 'nested-agent',
        tool_use_id: 'toolu_agent',
        status: 'completed',
        owner_agent_id: 'parent-agent',
      }),
    ])
  })
})
