import { afterEach, beforeEach, expect, test, spyOn, mock } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionCollaborationService, type CollaborationMessage } from './sessionCollaborationService.js'
import { handleSessionCollaborationEvent, configureSessionCollaborationHost, getSessionCollaborationService, findSessionMetadataMatches } from './sessionCollaborationHost.js'
import { sessionService } from './sessionService.js'
import { admitSessionUserTurn, emitSessionTurnEvent } from './sessionTurnEvents.js'
import { SearchService } from './searchService.js'
import { ApiError } from '../middleware/errorHandler.js'

let directory: string
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'collaboration-host-fixture-')) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

test('user input reopens the inbox only after the shared admission commits to a ready CLI', async () => {
  let ready = false
  const delivered: CollaborationMessage[] = []
  const service = new SessionCollaborationService({
    statePath: join(directory, 'state.json'),
    sessions: { exists: async () => true, list: async () => [], read: async () => [], create: async () => ({ sessionId: 'unused' }) },
    runtime: {
      getState: () => 'running', start: async () => { throw new Error('Should inject into the user turn') }, stop: async () => {},
      enqueue: async (_, message) => { if (!ready) throw new Error('CLI session is not running'); delivered.push(message) },
    },
  })
  await service.onStopped('target')
  await service.send('sender', 'target', 'Previously queued message', 'pending')
  await handleSessionCollaborationEvent(service, { type: 'user-input', sessionId: 'target' })
  expect(delivered).toHaveLength(0)
  expect((await service.status()).messages[0]?.error).toBeUndefined()
  ready = true
  await handleSessionCollaborationEvent(service, { type: 'input-committed', sessionId: 'target' })
  expect(delivered.map(message => message.id)).toEqual(['pending'])
})

test('terminal failure does not claim an accepted message was consumed', async () => {
  const service = new SessionCollaborationService({
    statePath: join(directory, 'state.json'),
    sessions: { exists: async () => true, list: async () => [], read: async () => [], create: async () => ({ sessionId: 'unused' }) },
    runtime: { start: async () => {}, enqueue: async () => {}, stop: async () => {} },
  })
  await service.send('sender', 'target', 'Not yet consumed', 'pending')
  await handleSessionCollaborationEvent(service, { type: 'output', sessionId: 'target', message: { type: 'result', is_error: true, errors: ['process failed before query'] } })
  expect((await service.status()).messages[0]?.status).toBe('accepted')
  await handleSessionCollaborationEvent(service, { type: 'output', sessionId: 'target', message: { type: 'system', subtype: 'session_message_receipt', message_id: 'pending', status: 'consumed' } })
  expect((await service.status()).messages[0]?.status).toBe('consumed')
})

test('host rejects unavailable source workspace explicitly instead of silently choosing another directory', async () => {
  const previous = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = directory
  const dispose = configureSessionCollaborationHost('127.0.0.1', 1234)
  spyOn(sessionService, 'getSessionSummary').mockResolvedValue({ id: 'source' } as any)
  spyOn(sessionService, 'getSessionWorkDir').mockResolvedValue(null)
  const create = spyOn(sessionService, 'createSession')
  try {
    const service = await getSessionCollaborationService()
    const error = await service.create('source', { prompt: 'a', requestId: 'missing-workspace' }).catch(value => value)
    expect(error).toBeInstanceOf(ApiError)
    expect(error.code).toBe('SESSION_WORKSPACE_UNAVAILABLE')
    expect(error.message).toContain('working directory is unavailable')
    expect(create).not.toHaveBeenCalled()
  } finally {
    dispose()
    mock.restore()
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = previous
  }
})

test('metadata search finds old titles and ids beyond the first hundred sessions without conflating equal titles', async () => {
  const sessions = Array.from({ length: 235 }, (_, index) => ({
    id: `session-${index}`, title: index === 230 ? 'Unique archived design' : index === 1 || index === 201 ? 'Same title' : 'Ordinary',
    workDir: index === 234 ? '/fixture/old-project' : '/fixture/project',
  }))
  const requests: number[] = []
  const list = async ({ limit, offset }: { limit: number; offset: number }) => {
    requests.push(offset)
    return { sessions: sessions.slice(offset, offset + limit), total: sessions.length }
  }
  expect((await findSessionMetadataMatches('unique archived', list)).map(item => item.id)).toEqual(['session-230'])
  expect(requests).toEqual([0, 100, 200])
  expect((await findSessionMetadataMatches('session-229', list)).map(item => item.id)).toEqual(['session-229'])
  expect((await findSessionMetadataMatches('same title', list)).map(item => item.id)).toEqual(['session-1', 'session-201'])
  expect((await findSessionMetadataMatches('/old-project', list)).map(item => item.id)).toEqual(['session-234'])
})


test('manual admission waits for already emitted Stop events before reserving its slot', async () => {
  const previous = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = directory
  const dispose = configureSessionCollaborationHost('127.0.0.1', 1234)
  let unblock!: () => void
  const gate = new Promise<void>(resolve => { unblock = resolve })
  try {
    const service = await getSessionCollaborationService()
    const stopped = service.onStopped.bind(service)
    spyOn(service, 'onStopped').mockImplementation(async id => { await gate; await stopped(id) })
    emitSessionTurnEvent({ type: 'stopped', sessionId: 'worker' })
    let admitted = false
    const pending = admitSessionUserTurn('worker', () => true).then(lease => { admitted = true; return lease })
    for (let i = 0; i < 10; i++) await Promise.resolve()
    expect(admitted).toBe(false)
    unblock()
    const lease = await pending
    expect((await service.status()).members.find(member => member.sessionId === 'worker')).toMatchObject({ state: 'running', stopped: false })
    await lease.release()
    expect((await service.status()).members.find(member => member.sessionId === 'worker')).toMatchObject({ state: 'stopped', stopped: true })
  } finally {
    unblock()
    dispose()
    mock.restore()
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = previous
  }
})


test('old exact title and id matches rank before the server candidate limit', async () => {
  const previous = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = directory
  const dispose = configureSessionCollaborationHost('127.0.0.1', 1234)
  const sessions = [
    ...Array.from({ length: 45 }, (_, i) => ({ id: `recent-${i}`, title: `Recent needle discussion ${i}`, workDir: '/fixture' })),
    { id: 'old-title', title: 'needle', workDir: '/fixture' },
    { id: 'needle', title: 'Old conversation', workDir: '/fixture' },
  ]
  spyOn(sessionService, 'listSessions').mockImplementation(async ({ offset = 0, limit = 30 } = {}) => ({ sessions: sessions.slice(offset, offset + limit), total: sessions.length }) as any)
  spyOn(SearchService.prototype, 'searchSessions').mockResolvedValue({ results: [], truncated: false } as any)
  try {
    const service = await getSessionCollaborationService()
    const result = await service.candidates('needle')
    expect(result.sessions).toHaveLength(30)
    expect(result.sessions.slice(0, 2).map(session => session.sessionId)).toEqual(['old-title', 'needle'])
  } finally {
    dispose()
    mock.restore()
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = previous
  }
})
