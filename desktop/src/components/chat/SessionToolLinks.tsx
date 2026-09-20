import { Button } from '@/components/ui/Button'
import { useTranslation } from '@/i18n'
import { openSessionSource, sessionSourceTitle } from '@/lib/sessionNavigation'

export const SESSION_TOOL_NAMES = new Set(['ListSessions', 'ReadSession', 'CreateSession', 'SendSessionMessage', 'WaitSessions'])

/** Inspect only protocol fields, never arbitrary text for apparent session identifiers. */
export function sessionToolTargets(input: unknown, result: unknown): string[] {
  const ids = new Set<string>()
  const visit = (value: unknown, depth: number) => {
    if (depth > 4 || ids.size >= 20) return
    if (typeof value === 'string') {
      try { visit(JSON.parse(value), depth + 1) } catch { /* Ordinary tool output stays text. */ }
      return
    }
    if (Array.isArray(value)) { for (const item of value.slice(0, 20)) visit(item, depth + 1); return }
    if (!value || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    for (const key of ['sessionId', 'targetSessionId']) {
      const id = record[key]
      if (typeof id === 'string' && id.length > 0 && id.length <= 200) ids.add(id)
    }
    if (Array.isArray(record.sessionIds)) for (const id of record.sessionIds.slice(0, 20)) {
      if (typeof id === 'string' && id.length > 0 && id.length <= 200) ids.add(id)
    }
    if (Array.isArray(record.sessions)) for (const session of record.sessions.slice(0, 20)) {
      if (session && typeof session === 'object' && typeof session.id === 'string' && session.id.length > 0 && session.id.length <= 200) ids.add(session.id)
    }
    for (const key of ['text', 'data', 'sessions', 'members']) if (record[key]) visit(record[key], depth + 1)
  }
  visit(input, 0)
  visit(result, 0)
  return [...ids].slice(0, 20)
}

export function SessionToolLinks({ input, result }: { input: unknown, result: unknown }) {
  const t = useTranslation()
  const targets = sessionToolTargets(input, result)
  if (!targets.length) return null
  return <div className="flex flex-wrap gap-1 px-3 py-1" aria-label={t('chat.referenceSessions')}>
    {targets.map(id => <Button key={id} size="sm" variant="ghost" onClick={() => openSessionSource(id)}>{t('chat.openReferencedSession', { id: sessionSourceTitle(id) })}</Button>)}
  </div>
}
