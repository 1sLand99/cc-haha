import { useEffect, useRef } from 'react'
import {
  detectPlatform,
  matchWorkspaceShortcut,
  type WorkspaceFocusContext,
} from '../lib/workspace/shortcuts'
import { workspaceOpen } from '../lib/workspace/openTarget'
import { useWorkspaceStore } from '../stores/workspaceStore'

/**
 * Decide what the keystroke belongs to from where it happened.
 *
 * A terminal is the case that matters: it is a DOM element the app owns, so the
 * app *does* receive its keys and has to hand the reserved ones back. A native
 * browser page needs no such care — while it has focus the renderer sees no
 * keydown at all, which is the behaviour the reference relies on too.
 */
function focusContext(): WorkspaceFocusContext {
  const active = document.activeElement
  if (!active) return 'other'
  if (active.closest('[data-testid^="workspace-terminal-host"]')) return 'terminal'
  if (active.closest('[data-testid="workspace-review-toolbar"]')) return 'review'
  if (active.closest('[data-testid="workspace-browser-stage"]')) return 'browser'
  if (active.closest('[data-testid="workspace-file-header"]')) return 'file'
  return 'chat'
}

export type WorkspaceShortcutContext = {
  sessionId: string | null
  cwd: string
  enabled: boolean
}

export function useWorkspaceShortcuts({ sessionId, cwd, enabled }: WorkspaceShortcutContext) {
  // The handler is registered once and reads the latest context through a ref,
  // so switching tasks does not detach and re-attach a document listener.
  const contextRef = useRef({ sessionId, cwd, enabled })
  contextRef.current = { sessionId, cwd, enabled }

  useEffect(() => {
    const platform = detectPlatform()

    const handler = (event: KeyboardEvent) => {
      const { sessionId: session, cwd: workDir, enabled: active } = contextRef.current
      if (!active || !session) return

      const action = matchWorkspaceShortcut(event, { platform, context: focusContext() })
      if (!action) return

      const store = useWorkspaceStore.getState()
      switch (action) {
        case 'quick-open-file':
          workspaceOpen.file(session, '', { preview: true })
          break
        case 'new-browser-tab':
          workspaceOpen.browser(session)
          break
        case 'open-review':
          workspaceOpen.review(session)
          break
        case 'toggle-bottom-panel':
          store.toggleBottomPanel(session, workDir)
          break
        case 'new-terminal':
          workspaceOpen.terminal(session, workDir, { dock: 'bottom' })
          break
        case 'toggle-workspace':
          store.toggleWorkspace(session)
          break
        case 'toggle-fullscreen':
          store.toggleFullscreen(session)
          break
        case 'reopen-closed-tab':
          store.reopenClosedTab(session)
          break
        case 'close-tab': {
          const activeSideTabId = store.getSession(session).activeSideTabId
          // Nothing open means the keystroke is not ours after all — let the
          // window keep whatever meaning it already had.
          if (!activeSideTabId) return
          store.closeTab(session, activeSideTabId)
          break
        }
        case 'next-tab':
        case 'previous-tab': {
          const tabs = store.getTabs(session, 'side')
          if (tabs.length < 2) return
          const current = tabs.findIndex((tab) => tab.id === store.getSession(session).activeSideTabId)
          const step = action === 'next-tab' ? 1 : -1
          const next = tabs[(current + step + tabs.length) % tabs.length]
          if (next) store.activateTab(session, next.id)
          break
        }
      }

      event.preventDefault()
    }

    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])
}
