import { api } from '@/api/client'

export type SessionCandidate = {
  sessionId: string
  title: string
  cwd: string
  status: string
  updatedAt: string
}
export type CollaborationState = 'queued' | 'running' | 'idle' | 'blocked' | 'completed' | 'failed' | 'stopped'
export type SessionCollaborationStatus = {
  revision: number
  members: Array<{ sessionId: string, rootSessionId: string, parentSessionId: string | null, state: CollaborationState, stopped: boolean, result?: string }>
  messages: Array<{ id: string, sourceSessionId: string, targetSessionId: string, content: string, kind: string, status: 'queued' | 'accepted' | 'consumed' | 'cancelled', createdAt: string, error?: string }>
}
const base = '/api/session-collaboration'
export const sessionCollaborationApi = {
  list(query = '') { return api.get<{ sessions: SessionCandidate[] }>(`${base}?query=${encodeURIComponent(query)}`) },
  status(sessionId: string) { return api.get<SessionCollaborationStatus>(`${base}/${encodeURIComponent(sessionId)}/status`) },
  stop(sessionId: string) { return api.post(`${base}/${encodeURIComponent(sessionId)}/stop`, {}) },
}
