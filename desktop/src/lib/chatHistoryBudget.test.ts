import { describe, expect, it } from 'vitest'
import { boundActivityText, boundChatHistory, CHAT_HISTORY_MAX_ROWS } from './chatHistoryBudget'
import type { UIMessage } from '../types/chat'

function text(id: number, content = 'message'): UIMessage {
  return { id: String(id), type: 'assistant_text', timestamp: id, content }
}

describe('chat history retention', () => {
  it('keeps complete page payloads because a cursor cannot recover a clipped body', () => {
    const messages = [text(0, 'x'.repeat(300_000))]
    expect(boundChatHistory(messages, 256 * 1024).messages).toBe(messages)
  })

  it('preserves image sources, later attachments and structured tool fields', () => {
    const messages: UIMessage[] = [{
      id: 'user', type: 'user_text', timestamp: 1, content: 'prompt'.repeat(8000),
      modelContent: 'full model prompt'.repeat(4000),
      attachments: [
        { type: 'image', name: 'image.png', data: 'data:image/png;base64,' + 'A'.repeat(40_000), path: '/tmp/image.png' },
        { type: 'file', name: 'notes.md', path: '/tmp/notes.md' },
      ],
    }, {
      id: 'edit', type: 'tool_use', toolName: 'Edit', toolUseId: 'edit-1', timestamp: 2,
      input: { file_path: '/tmp/file.ts', old_string: 'old line\n'.repeat(5000), new_string: 'fixed' },
    }]
    expect(boundChatHistory(messages).messages).toBe(messages)
  })

  it('bounds many small rows and keeps the recent window', () => {
    const result = boundChatHistory(Array.from({ length: 2000 }, (_, index) => text(index)))
    expect(result.messages).toHaveLength(CHAT_HISTORY_MAX_ROWS)
    expect(result.messages[0]?.id).toBe('1500')
    expect(result.dropped).toBe(1500)
  })

  it('retains one oversized newest message intact and evicts whole older rows', () => {
    const message: UIMessage = { id: 'tool', type: 'tool_use', toolName: 'Bash', toolUseId: 'id', timestamp: 123, input: { command: 'x'.repeat(2_000_000) } }
    const result = boundChatHistory([text(0), message])
    expect(result.messages).toEqual([message])
    expect(result.messages[0]).toBe(message)
    expect(result.dropped).toBe(1)
    expect(result.bytes).toBeGreaterThan(4_000_000)
    expect(boundChatHistory(result.messages).messages).toBe(result.messages)
  })

  it('enforces the byte budget for large rows and preserves unchanged references', () => {
    const small = [text(0)]
    expect(boundChatHistory(small).messages).toBe(small)
    const result = boundChatHistory(Array.from({ length: 100 }, (_, index) => text(index, 'x'.repeat(30_000))), 128 * 1024)
    expect(result.bytes).toBeLessThanOrEqual(128 * 1024)
    expect(result.messages.at(-1)?.id).toBe('99')
  })
  it('retains recent terminal records and every active lifecycle, including active-to-terminal transitions', () => {
    const records = Object.fromEntries(Array.from({ length: 700 }, (_, index) => [String(index), {
      taskId: String(index), status: 'completed', updatedAt: index,
    }]))
    records.active = { taskId: 'active', status: 'running', updatedAt: 0 }
    const bounded = boundActivityText(records, 1024 * 1024)!
    expect(Object.keys(bounded)).toHaveLength(501)
    expect(bounded['199']).toBeUndefined()
    expect(bounded['200']).toBe(records['200'])
    expect(bounded.active).toBe(records.active)
    const completed = boundActivityText({ ...bounded, active: { ...bounded.active!, status: 'completed', updatedAt: 999 } }, 1024 * 1024)!
    expect(Object.keys(completed)).toHaveLength(500)
    expect(completed.active).toMatchObject({ taskId: 'active', status: 'completed', updatedAt: 999 })
    expect(completed['200']).toBeUndefined()
    const allRunning = Object.fromEntries(Array.from({ length: 1000 }, (_, index) => [String(index), { taskId: String(index), status: 'running' }]))
    expect(boundActivityText(allRunning, 1024, 2)).toBe(allRunning)
  })

  it('memoizes unchanged activity records by identity and budgets instead of scanning on each delta', () => {
    let enumerations = 0
    const records = new Proxy({ task: { status: 'completed', result: 'result' } }, {
      ownKeys(target) { enumerations++; return Reflect.ownKeys(target) },
    })
    const first = boundActivityText(records, 1024, 500)
    for (let index = 0; index < 100; index++) expect(boundActivityText(records, 1024, 500)).toBe(first)
    expect(enumerations).toBe(1)
    boundActivityText(records, 512, 500)
    expect(enumerations).toBe(2)
    boundActivityText(records, 512, 100)
    expect(enumerations).toBe(3)
  })

})
