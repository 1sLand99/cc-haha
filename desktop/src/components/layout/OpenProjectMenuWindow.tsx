import { useEffect, useLayoutEffect, useState } from 'react'

import { getDesktopHost } from '@/lib/desktopHost'
import type { DesktopOpenProjectMenuState } from '@/lib/desktopHost/types'
import { OpenProjectMenuPanel } from './OpenProjectMenuPanel'

export function OpenProjectMenuWindow() {
  const [state, setState] = useState<DesktopOpenProjectMenuState | null>(null)

  useEffect(() => {
    const host = getDesktopHost().openProjectMenu
    let cancelled = false
    let unlisten: (() => void) | undefined

    void host.onState((next) => setState(next)).then((stop) => {
      if (cancelled) stop()
      else unlisten = stop
    })
    void host.getState().then((initial) => {
      if (!cancelled && initial) setState(initial)
    })

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])

  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void getDesktopHost().openProjectMenu.dismiss()
    }
    document.addEventListener('keydown', dismiss)
    return () => document.removeEventListener('keydown', dismiss)
  }, [])

  useLayoutEffect(() => {
    if (!state) return
    void getDesktopHost().openProjectMenu.ready(state.requestId)
  }, [state])

  if (!state) return null

  return (
    <main className="h-full w-full bg-transparent p-4" data-testid="open-project-menu-window">
      <OpenProjectMenuPanel
        key={state.requestId}
        targets={state.targets}
        autoFocusFirst
        onSelect={(targetId) => void getDesktopHost().openProjectMenu.select(targetId)}
      />
    </main>
  )
}
