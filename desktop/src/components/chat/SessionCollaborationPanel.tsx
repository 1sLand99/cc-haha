import { useEffect, useState } from 'react'
import { sessionCollaborationApi, type CollaborationState, type SessionCollaborationStatus } from '@/api/sessionCollaboration'
import { Button } from '@/components/ui/Button'
import { useTranslation, type TranslationKey } from '@/i18n'
import { openSessionSource, sessionSourceTitle } from '@/lib/sessionNavigation'

const stateLabels: Record<CollaborationState, TranslationKey> = {
  queued: 'chat.collaborationQueued', running: 'chat.collaborationRunning', idle: 'chat.collaborationIdle',
  blocked: 'chat.collaborationBlocked', completed: 'chat.collaborationCompleted', failed: 'chat.collaborationFailed', stopped: 'chat.collaborationStopped',
}

export function SessionCollaborationPanel({ sessionId }: { sessionId: string }) {
  const t = useTranslation()
  const [snapshot, setSnapshot] = useState<{ sessionId: string, value: SessionCollaborationStatus } | null>(null)
  const [error, setError] = useState(false)
  const [stopping, setStopping] = useState(false)
  const data = snapshot?.sessionId === sessionId ? snapshot.value : null
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const refresh = async () => {
      try {
        const value = await sessionCollaborationApi.status(sessionId)
        if (active) { setSnapshot(previous => previous?.sessionId === sessionId && previous.value.revision > value.revision ? previous : { sessionId, value }); setError(false) }
      } catch {
        if (active) setError(true)
      }
      if (active) timer = setTimeout(() => { void refresh() }, 5000)
    }
    void refresh()
    return () => { active = false; clearTimeout(timer) }
  }, [sessionId])
  if (!data || (data.members.length < 2 && !data.messages.length)) return null
  const open = (id: string) => openSessionSource(id)
  const stop = async () => {
    setStopping(true)
    try {
      await sessionCollaborationApi.stop(sessionId)
      const value = await sessionCollaborationApi.status(sessionId)
      setSnapshot(previous => previous?.sessionId === sessionId && previous.value.revision > value.revision ? previous : { sessionId, value })
      setError(false)
    } catch { setError(true) }
    finally { setStopping(false) }
  }
  return <details className="mx-4 mb-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-xs">
    <summary className="cursor-pointer px-3 py-2 text-[var(--color-text-secondary)] focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]">{t('chat.sessionCollaboration', { count: data.members.length })}</summary>
    <div className="space-y-2 px-3 pb-3">
      <div className="flex flex-wrap gap-1">
        {data.members.map(member => <Button key={member.sessionId} size="sm" variant="ghost" onClick={() => open(member.sessionId)}>{sessionSourceTitle(member.sessionId)} · {t(stateLabels[member.state])}</Button>)}
      </div>
      <div className="max-h-48 space-y-2 overflow-y-auto" aria-label={t('chat.collaborationMessages')}>
        {data.messages.slice(-20).reverse().map(message => <div key={message.id} className="rounded-[var(--radius-sm)] bg-[var(--color-surface-container)] p-2">
          <div className="flex flex-wrap items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => open(message.sourceSessionId)}>{sessionSourceTitle(message.sourceSessionId)}</Button>
            <span aria-hidden="true">→</span>
            <Button size="sm" variant="ghost" onClick={() => open(message.targetSessionId)}>{sessionSourceTitle(message.targetSessionId)}</Button>
          </div>
          <span className="text-[var(--color-text-tertiary)]">{t(message.status === 'cancelled' ? 'chat.collaborationCancelled' : message.status === 'consumed' ? 'chat.collaborationConsumed' : message.status === 'accepted' ? 'chat.collaborationAccepted' : 'chat.collaborationQueued')}</span>
          <p className="whitespace-pre-wrap break-words text-[var(--color-text-primary)]">{message.content}</p>
          {message.error ? <p role="alert" className="text-[var(--color-error)]">{message.error}</p> : null}
        </div>)}
      </div>
      {error ? <p role="alert" className="text-[var(--color-error)]">{t('chat.collaborationFailedRequest')}</p> : null}
      <Button size="sm" variant="secondary" disabled={stopping || data.members.every(member => member.stopped)} onClick={() => { void stop() }}>{t('chat.collaborationStopGroup')}</Button>
    </div>
  </details>
}
