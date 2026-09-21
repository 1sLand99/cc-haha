import { expect, it, vi } from 'vitest'
import { api } from '@/api/client'
import { sessionCollaborationApi } from './sessionCollaboration'
vi.mock('@/api/client', () => ({ api: { get: vi.fn(), post: vi.fn() } }))
it('uses the authenticated API client and encodes session identifiers and search text', () => {
  const signal = new AbortController().signal
  sessionCollaborationApi.list('Auth / 中文', { signal })
  sessionCollaborationApi.status('session/a')
  sessionCollaborationApi.stop('session/a')
  expect(api.get).toHaveBeenCalledWith('/api/session-collaboration?query=Auth%20%2F%20%E4%B8%AD%E6%96%87', { signal })
  expect(api.get).toHaveBeenCalledWith('/api/session-collaboration/session%2Fa/status')
  expect(api.post).toHaveBeenCalledWith('/api/session-collaboration/session%2Fa/stop', {})
})
