import { useState, useEffect } from 'react'
import { getDesktopHost } from '../../lib/desktopHost'
import type { DesktopHost } from '../../lib/desktopHost'
import { WindowControlButton } from '../ui/custom/window-control-button'

const isWindows = typeof navigator !== 'undefined' && /Win/.test(navigator.platform)

/** Whether to render custom window controls (Windows + desktop host only) */
export const showWindowControls = isWindows && getDesktopHost().capabilities.windowControls

export function WindowControls() {
  const [maximized, setMaximized] = useState(false)
  const [win, setWin] = useState<DesktopHost['window'] | null>(null)

  useEffect(() => {
    if (!showWindowControls) return
    let unlisten: (() => void) | undefined
    let cancelled = false

    const w = getDesktopHost().window
    setWin(w)
    void w.isMaximized()
      .then((nextMaximized) => {
        if (!cancelled) setMaximized(nextMaximized)
      })
      .catch(() => {})
    void w.onResized(() => {
      void w.isMaximized()
        .then((nextMaximized) => {
          if (!cancelled) setMaximized(nextMaximized)
        })
        .catch(() => {})
    })
      .then((fn) => { unlisten = fn })
      .catch(() => {})

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])

  const runWindowAction = (action: () => Promise<void>) => {
    void action().catch((error) => {
      console.error('Window control action failed', error)
    })
  }

  if (!showWindowControls || !win) return null

  return (
    <div data-testid="window-controls" className="flex items-stretch flex-shrink-0 -my-px">
      {/* Minimize */}
      <WindowControlButton
        onClick={() => runWindowAction(() => win.minimize())}
        aria-label="Minimize window"
      >
        <svg width="10" height="1" viewBox="0 0 10 1">
          <rect width="10" height="1" fill="currentColor" />
        </svg>
      </WindowControlButton>

      {/* Maximize / Restore */}
      <WindowControlButton
        onClick={() => runWindowAction(() => win.toggleMaximize())}
        aria-label={maximized ? 'Restore window' : 'Maximize window'}
      >
        {maximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="0" y="3" width="7" height="7" />
            <polyline points="3,3 3,0 10,0 10,7 7,7" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="0.5" y="0.5" width="9" height="9" />
          </svg>
        )}
      </WindowControlButton>

      {/* Close */}
      <WindowControlButton
        tone="close"
        onClick={() => runWindowAction(() => win.close())}
        aria-label="Close window"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
          <line x1="0" y1="0" x2="10" y2="10" />
          <line x1="10" y1="0" x2="0" y2="10" />
        </svg>
      </WindowControlButton>
    </div>
  )
}
