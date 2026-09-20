import { join } from 'node:path'
import { homedir } from 'node:os'
import { sessionService } from './sessionService.js'
import { SearchService } from './searchService.js'
import { conversationService } from './conversationService.js'
import { getRepositoryContext } from './repositoryLaunchService.js'
import { SessionCollaborationService } from './sessionCollaborationService.js'
import { registerSessionTurnAdmissionGuard, observeSessionTurns, type SessionTurnEvent } from './sessionTurnEvents.js'
import { getRuntimeSettings, getSessionTurnState, isSessionTurnStopped, stopSessionTurn, submitSessionTurn, sendToSession } from '../ws/handler.js'
import { ApiError } from '../middleware/errorHandler.js'

const searchService = new SearchService()

/** Scan only the existing metadata projection; transcript content has its own bounded index search. */
export async function findSessionMetadataMatches(
  query: string,
  list: (options: { limit: number; offset: number }) => Promise<{ sessions: Array<{ id: string; title?: string; workDir?: string | null; projectPath?: string }>; total?: number }>,
): Promise<Array<Record<string, unknown>>> {
  const needle = query.toLocaleLowerCase()
  const matches = new Map<string, Record<string, unknown>>()
  const seen = new Set<string>()
  for (let offset = 0; ; offset += 100) {
    const page = await list({ limit: 100, offset })
    let newSessions = 0
    for (const session of page.sessions) {
      if (seen.has(session.id)) continue
      seen.add(session.id)
      newSessions++
      if (`${session.title ?? ''} ${session.id} ${session.workDir ?? session.projectPath ?? ''}`.toLocaleLowerCase().includes(needle)) matches.set(session.id, session)
    }
    if (page.sessions.length < 100 || newSessions === 0 || (page.total !== undefined && offset + page.sessions.length >= page.total)) break
  }
  return [...matches.values()]
}

let endpoint = { serverHost: '127.0.0.1', serverPort: 0 }
let current: { path: string; service: SessionCollaborationService; ready: Promise<void> } | undefined
let unsubscribe: (() => void) | undefined

export function configureSessionCollaborationHost(serverHost: string, serverPort: number): () => void {
  endpoint = { serverHost, serverPort }
  unsubscribe?.()
  let eventTail: Promise<void> = Promise.resolve()
  const removeGuard = registerSessionTurnAdmissionGuard(async (sessionId, canAdmit) => {
    // Previously emitted lifecycle events belong before this new reservation.
    await eventTail
    return (await getSessionCollaborationService()).admitUserTurn(sessionId, canAdmit)
  })
  let disposed = false
  unsubscribe = observeSessionTurns(event => {
    eventTail = eventTail.then(async () => {
      if (disposed) return
      await handleSessionCollaborationEvent(await getSessionCollaborationService(), event)
    }).catch(error => console.error('[SessionCollaboration] Event failed', error))
  })
  return () => { disposed = true; removeGuard(); unsubscribe?.(); unsubscribe = undefined; current = undefined }
}

export async function getSessionCollaborationService(): Promise<SessionCollaborationService> {
  const path = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'cc-haha', 'session-collaboration', 'state.json')
  if (!current || current.path !== path) {
    const service = new SessionCollaborationService({
      statePath: path,
      sessions: {
        async list({ query, limit, offset }) {
          if (!query?.trim()) return sessionService.listSessions({ limit, offset })
          // Search transcript content as well as titles, using the existing
          // indexed/bounded fallback instead of materializing all histories.
          const [matches, metadata] = await Promise.all([
            searchService.searchSessions(query, { limit: Math.min(100, offset + limit), matchesPerSession: 1 }),
            findSessionMetadataMatches(query, options => sessionService.listSessions(options)),
          ])
          const selected = new Map<string, Record<string, unknown>>()
          for (const session of metadata) selected.set(String(session.id), session)
          for (const match of matches.results) if (!selected.has(match.sessionId)) selected.set(match.sessionId, { ...match, id: match.sessionId })
          const needle = query.trim().toLocaleLowerCase()
          const rank = (session: Record<string, unknown>): number => {
            const names = [session.id ?? session.sessionId, session.title].filter(value => typeof value === 'string').map(value => String(value).toLocaleLowerCase())
            if (names.some(value => value === needle)) return 3
            if (names.some(value => value.startsWith(needle))) return 2
            if (names.some(value => value.includes(needle))) return 1
            return 0
          }
          const ranked = [...selected.values()].sort((a, b) => rank(b) - rank(a))
          return { sessions: ranked.slice(offset, offset + limit), total: selected.size, truncated: matches.truncated }
        },
        read: (sessionId, options) => sessionService.getSessionHistoryPage(sessionId, options),
        exists: async sessionId => Boolean(await sessionService.getSessionSummary(sessionId)),
        async create(callerSessionId, input) {
          const workDir = input.workDir ?? await sessionService.getSessionWorkDir(callerSessionId)
          if (!workDir) throw new ApiError(409, 'The source session working directory is unavailable', 'SESSION_WORKSPACE_UNAVAILABLE')
          const [repository, runtime] = await Promise.all([getRepositoryContext(workDir), getRuntimeSettings(callerSessionId)])
          if (repository.state !== 'ok' && repository.state !== 'not_git_repo') throw new ApiError(400, `Cannot resolve the target repository (${repository.state}); no session was created`, 'SESSION_REPOSITORY_UNAVAILABLE')
          const created = await sessionService.createSession(workDir, repository.state === 'ok' ? { worktree: true } : undefined, runtime.permissionMode)
          await sessionService.appendSessionMetadata(created.sessionId, {
            workDir: created.workDir, customTitle: input.title ?? input.prompt.slice(0, 80),
            permissionMode: runtime.permissionMode, runtimeProviderId: input.providerId !== undefined ? input.providerId : runtime.providerId,
            runtimeModelId: input.model ?? runtime.model, effortLevel: runtime.effort,
          })
          return created
        },
      },
      runtime: {
        getState: getSessionTurnState,
        async start(sessionId, message) {
          if (!endpoint.serverPort) throw new Error('Desktop session host is not running')
          const ack = await submitSessionTurn(sessionId, message.content, { ...endpoint, messageId: message.id, sourceSessionId: message.sourceSessionId, canSend: () => service.canDeliver(message.id) })
          if (ack.status === 'consumed') {
            await service.onMessageConsumed(message.id, sessionId)
            await service.onSessionState(sessionId, 'idle')
          }
        },
        async enqueue(sessionId, message) {
          const result = await conversationService.requestControl(sessionId, {
            subtype: 'enqueue_session_message', message_id: message.id,
            sender_session_id: message.sourceSessionId, text: message.content,
          }, 10_000, undefined, () => !isSessionTurnStopped(sessionId) && service.canDeliver(message.id))
          if (result.status !== 'queued' && result.status !== 'consumed') throw new Error('CLI did not acknowledge the session message')
          if (result.status === 'consumed') await service.onMessageConsumed(message.id, sessionId)
          else if (getSessionTurnState(sessionId) === 'idle' && service.canDeliver(message.id)) {
            const ack = await submitSessionTurn(sessionId, message.content, { ...endpoint, messageId: message.id, sourceSessionId: message.sourceSessionId, canSend: () => service.canDeliver(message.id) })
            if (ack.status === 'consumed') {
              await service.onMessageConsumed(message.id, sessionId)
              await service.onSessionState(sessionId, 'idle')
            }
          }
        },
        async stop(sessionId) { stopSessionTurn(sessionId) },
      },
    })
    current = { path, service, ready: service.recover() }
  }
  await current.ready
  return current.service
}

export async function handleSessionCollaborationEvent(service: SessionCollaborationService, event: SessionTurnEvent): Promise<void> {
  // A renderer input arrives before the CLI is started. Only reopen its fence
  // here; the shared admission's committed event proves the SDK can accept the
  // pending collaboration inbox without racing process startup.
  if (event.type === 'user-input') { await service.onUserInput(event.sessionId, { dispatch: false }); return }
  if (event.type === 'input-committed') { await service.onSessionState(event.sessionId, 'running'); return }
  if (event.type === 'stopped') { await service.onStopped(event.sessionId); return }
  const message = event.message
  if (message.type === 'system' && message.subtype === 'session_message_receipt' && message.status === 'consumed') {
    await service.onMessageConsumed(message.message_id, event.sessionId)
  } else if (message.type === 'result') {
    await service.onSessionState(event.sessionId, message.is_error ? 'failed' : 'completed',
      String(message.result ?? message.errors?.join('\n') ?? '').slice(0, 8000), message.uuid)
  } else if (message.type === 'control_request' && message.request?.subtype === 'can_use_tool') {
    await service.onSessionState(event.sessionId, 'blocked', `Waiting for permission: ${message.request.tool_name ?? 'tool'}`, message.request_id)
  } else if (message.type === 'control_response' || message.type === 'control_cancel_request') {
    if (getSessionTurnState(event.sessionId) === 'running') await service.onSessionState(event.sessionId, 'running')
  }
  sendToSession(event.sessionId, { type: 'system_notification', subtype: 'session_collaboration_updated', data: { sessionId: event.sessionId } })
}
