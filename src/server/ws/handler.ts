/**
 * WebSocket connection handler
 *
 * 管理 WebSocket 连接生命周期，处理消息路由。
 * 用户消息通过 CLI 子进程（stream-json 模式）处理，
 * CLI stdout 消息被转换为 ServerMessage 并转发到 WebSocket。
 */

import type { ServerWebSocket } from 'bun'
import type { ClientMessage, ServerMessage, WebSocketSession } from './events.js'
import { conversationService } from '../services/conversationService.js'

export type WebSocketData = {
  sessionId: string
  connectedAt: number
}

// Active WebSocket sessions
const activeSessions = new Map<string, ServerWebSocket<WebSocketData>>()

export const handleWebSocket = {
  open(ws: ServerWebSocket<WebSocketData>) {
    const { sessionId } = ws.data
    console.log(`[WS] Client connected for session: ${sessionId}`)

    activeSessions.set(sessionId, ws)

    const msg: ServerMessage = { type: 'connected', sessionId }
    ws.send(JSON.stringify(msg))
  },

  message(ws: ServerWebSocket<WebSocketData>, rawMessage: string | Buffer) {
    try {
      const message = JSON.parse(
        typeof rawMessage === 'string' ? rawMessage : rawMessage.toString()
      ) as ClientMessage

      switch (message.type) {
        case 'user_message':
          handleUserMessage(ws, message).catch((err) => {
            console.error(`[WS] Unhandled error in handleUserMessage:`, err)
          })
          break

        case 'permission_response':
          handlePermissionResponse(ws, message)
          break

        case 'stop_generation':
          handleStopGeneration(ws)
          break

        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' } satisfies ServerMessage))
          break

        default:
          sendError(ws, `Unknown message type: ${(message as any).type}`, 'UNKNOWN_TYPE')
      }
    } catch (error) {
      sendError(ws, `Invalid message format: ${error}`, 'PARSE_ERROR')
    }
  },

  close(ws: ServerWebSocket<WebSocketData>, code: number, reason: string) {
    const { sessionId } = ws.data
    console.log(`[WS] Client disconnected from session: ${sessionId} (${code}: ${reason})`)
    activeSessions.delete(sessionId)

    // 断开连接时停止对应的 CLI 子进程
    if (conversationService.hasSession(sessionId)) {
      conversationService.stopSession(sessionId)
    }
  },

  drain(ws: ServerWebSocket<WebSocketData>) {
    // Backpressure handling - called when the socket is ready to receive more data
  },
}

// ============================================================================
// Message handlers
// ============================================================================

async function handleUserMessage(
  ws: ServerWebSocket<WebSocketData>,
  message: Extract<ClientMessage, { type: 'user_message' }>
) {
  const { sessionId } = ws.data

  // Send thinking status
  sendMessage(ws, { type: 'status', state: 'thinking', verb: 'Thinking' })

  // 启动 CLI 子进程（如果还没有）
  if (!conversationService.hasSession(sessionId)) {
    try {
      const workDir = process.cwd()
      await conversationService.startSession(sessionId, workDir)

      // 注册 CLI stdout → WebSocket 转发
      conversationService.onOutput(sessionId, (cliMsg) => {
        const serverMsgs = translateCliMessage(cliMsg)
        for (const msg of serverMsgs) {
          sendMessage(ws, msg)
        }
      })
    } catch (err) {
      console.error(`[WS] CLI start failed for ${sessionId}, falling back to echo`)
      // CLI 启动失败时回退到 echo 模式，保证基本可用性
      sendFallbackEcho(ws, sessionId, message.content)
      return
    }
  }

  // 将用户消息写入 CLI stdin
  const sent = conversationService.sendMessage(sessionId, message.content)
  if (!sent) {
    // 消息发送失败（进程可能已退出），回退到 echo 模式
    sendFallbackEcho(ws, sessionId, message.content)
  }
}

function handlePermissionResponse(
  ws: ServerWebSocket<WebSocketData>,
  message: Extract<ClientMessage, { type: 'permission_response' }>
) {
  const { sessionId } = ws.data
  conversationService.respondToPermission(sessionId, message.requestId, message.allowed)
  console.log(`[WS] Permission response for ${message.requestId}: ${message.allowed}`)
}

function handleStopGeneration(ws: ServerWebSocket<WebSocketData>) {
  const { sessionId } = ws.data
  console.log(`[WS] Stop generation requested for session: ${sessionId}`)

  // 向 CLI 子进程发送中断信号
  if (conversationService.hasSession(sessionId)) {
    conversationService.sendInterrupt(sessionId)
  }

  sendMessage(ws, { type: 'status', state: 'idle' })
}

// ============================================================================
// CLI message translation
// ============================================================================

/**
 * Track the type of the currently active content block by stream index.
 * Used to determine whether a content_block_stop corresponds to a tool_use or text block.
 */
const activeBlockTypes = new Map<number, 'text' | 'tool_use'>()

/**
 * 将 CLI stdout 的 stream-json 消息转换为 WebSocket ServerMessage 数组。
 *
 * CLI 输出格式参考 src/bridge/sessionRunner.ts 中的 stream-json 协议。
 * 返回数组以支持单条 CLI 消息产生多条 ServerMessage（例如多个内容块）。
 */
function translateCliMessage(cliMsg: any): ServerMessage[] {
  switch (cliMsg.type) {
    case 'assistant': {
      // 检查是否有认证错误
      if (cliMsg.error) {
        return [{
          type: 'error',
          message: cliMsg.message?.content?.[0]?.text || cliMsg.error,
          code: cliMsg.error,
        }]
      }

      // 助手消息 - 提取所有内容块，每个块产生独立的 ServerMessage
      if (cliMsg.message?.content && Array.isArray(cliMsg.message.content)) {
        const messages: ServerMessage[] = []

        for (const block of cliMsg.message.content) {
          if (block.type === 'thinking' && block.thinking) {
            // Bug #5: 处理 thinking 块
            messages.push({ type: 'thinking', text: block.thinking })
          } else if (block.type === 'text' && block.text) {
            messages.push({ type: 'content_start', blockType: 'text' })
            messages.push({ type: 'content_delta', text: block.text })
          } else if (block.type === 'tool_use') {
            // Bug #2: 不再 return，而是 push 到数组中
            // Bug #3: 发送 tool input
            // Bug #4: 发送 tool_use_complete
            messages.push({
              type: 'content_start',
              blockType: 'tool_use',
              toolName: block.name,
              toolUseId: block.id,
            })
            if (block.input !== undefined) {
              messages.push({
                type: 'content_delta',
                toolInput: JSON.stringify(block.input),
              })
            }
            messages.push({
              type: 'tool_use_complete',
              toolName: block.name,
              toolUseId: block.id,
              input: block.input,
            })
          }
        }

        return messages
      }
      return []
    }

    case 'user': {
      // Bug #1: 处理 tool_result 消息
      // CLI 发送 type:'user' 消息，其中 content 包含 tool_result 块
      const messages: ServerMessage[] = []

      if (cliMsg.message?.content && Array.isArray(cliMsg.message.content)) {
        for (const block of cliMsg.message.content) {
          if (block.type === 'tool_result') {
            messages.push({
              type: 'tool_result',
              toolUseId: block.tool_use_id,
              content: block.content,
              isError: !!block.is_error,
            })
          }
        }
      }

      return messages
    }

    case 'stream_event': {
      // Bug #6: 处理增量流式事件
      const event = cliMsg.event
      if (!event) return []

      switch (event.type) {
        case 'message_start': {
          return [{ type: 'status', state: 'streaming' }]
        }

        case 'content_block_start': {
          const contentBlock = event.content_block
          if (!contentBlock) return []

          // Track the block type by index for content_block_stop
          const index = event.index ?? 0
          activeBlockTypes.set(index, contentBlock.type === 'tool_use' ? 'tool_use' : 'text')

          if (contentBlock.type === 'tool_use') {
            return [{
              type: 'content_start',
              blockType: 'tool_use',
              toolName: contentBlock.name,
              toolUseId: contentBlock.id,
            }]
          }
          return [{ type: 'content_start', blockType: 'text' }]
        }

        case 'content_block_delta': {
          const delta = event.delta
          if (!delta) return []

          if (delta.type === 'text_delta' && delta.text) {
            return [{ type: 'content_delta', text: delta.text }]
          }
          if (delta.type === 'input_json_delta' && delta.partial_json) {
            return [{ type: 'content_delta', toolInput: delta.partial_json }]
          }
          if (delta.type === 'thinking_delta' && delta.thinking) {
            return [{ type: 'thinking', text: delta.thinking }]
          }
          return []
        }

        case 'content_block_stop': {
          const index = event.index ?? 0
          const blockType = activeBlockTypes.get(index)
          activeBlockTypes.delete(index)

          // For tool_use blocks, emit tool_use_complete
          // Note: toolName and toolUseId may not be available at stop time
          // from stream events alone; the UI should track them from content_block_start
          if (blockType === 'tool_use') {
            return [{
              type: 'tool_use_complete',
              toolName: '',
              toolUseId: '',
              input: null,
            }]
          }
          return []
        }

        case 'message_stop': {
          // message_stop is handled by the 'result' message
          return []
        }

        case 'message_delta': {
          // message_delta may contain stop_reason or usage updates
          return []
        }

        default:
          return []
      }
    }

    case 'control_request': {
      // 权限请求 — CLI 需要用户授权才能执行工具
      if (cliMsg.request?.subtype === 'can_use_tool') {
        return [{
          type: 'permission_request',
          requestId: cliMsg.request_id,
          toolName: cliMsg.request.tool_name || 'Unknown',
          input: cliMsg.request.input || {},
          description: cliMsg.request.description,
        }]
      }
      return []
    }

    case 'result': {
      // 对话结果（成功或错误）
      const usage = {
        input_tokens: cliMsg.usage?.input_tokens || 0,
        output_tokens: cliMsg.usage?.output_tokens || 0,
      }

      if (cliMsg.is_error) {
        // 错误和完成消息都发送
        return [
          {
            type: 'error',
            message: cliMsg.result || 'Unknown error',
            code: 'CLI_ERROR',
          },
          { type: 'message_complete', usage },
        ]
      }

      return [{ type: 'message_complete', usage }]
    }

    case 'system': {
      // 区分不同的 system 子类型
      const subtype = cliMsg.subtype
      if (subtype === 'init') {
        // CLI 初始化完成 — 发送模型信息
        return [{ type: 'status', state: 'idle', verb: `Model: ${cliMsg.model || 'unknown'}` }]
      }
      if (subtype === 'hook_started' || subtype === 'hook_response') {
        // Hook 执行中 — 不转发给前端
        return []
      }
      // Bug #7: 处理 task/team system 消息
      if (subtype === 'task_notification') {
        return [{
          type: 'system_notification',
          subtype: 'task_notification',
          message: cliMsg.message || cliMsg.title,
          data: cliMsg,
        }]
      }
      if (subtype === 'task_started') {
        return [{
          type: 'status',
          state: 'tool_executing',
          verb: cliMsg.message || 'Task started',
        }]
      }
      if (subtype === 'task_progress') {
        return [{
          type: 'status',
          state: 'tool_executing',
          verb: cliMsg.message || 'Task in progress',
        }]
      }
      if (subtype === 'session_state_changed') {
        return [{
          type: 'system_notification',
          subtype: 'session_state_changed',
          message: cliMsg.message,
          data: cliMsg,
        }]
      }
      // 其他 system 消息
      return []
    }

    default:
      // 未知类型 — 调试输出但不转发
      console.log(`[WS] Unknown CLI message type: ${cliMsg.type}`, JSON.stringify(cliMsg).substring(0, 200))
      return []
  }
}

// ============================================================================
// Fallback echo (for when CLI is not available)
// ============================================================================

/**
 * 当 CLI 子进程启动失败或不可用时，使用 echo 模式作为回退。
 * 保证 WebSocket 客户端始终能收到完整的消息流转。
 */
function sendFallbackEcho(
  ws: ServerWebSocket<WebSocketData>,
  sessionId: string,
  content: string
) {
  sendMessage(ws, { type: 'content_start', blockType: 'text' })
  sendMessage(ws, {
    type: 'content_delta',
    text: `[Server] Received message for session ${sessionId}: "${content}". Chat integration pending.`,
  })
  sendMessage(ws, {
    type: 'message_complete',
    usage: { input_tokens: 0, output_tokens: 0 },
  })
  sendMessage(ws, { type: 'status', state: 'idle' })
}

// ============================================================================
// Helpers
// ============================================================================

function sendMessage(ws: ServerWebSocket<WebSocketData>, message: ServerMessage) {
  ws.send(JSON.stringify(message))
}

function sendError(ws: ServerWebSocket<WebSocketData>, message: string, code: string) {
  sendMessage(ws, { type: 'error', message, code })
}

/**
 * Send a message to a specific session's WebSocket (for use by services)
 */
export function sendToSession(sessionId: string, message: ServerMessage): boolean {
  const ws = activeSessions.get(sessionId)
  if (!ws) return false
  ws.send(JSON.stringify(message))
  return true
}

export function getActiveSessionIds(): string[] {
  return Array.from(activeSessions.keys())
}
