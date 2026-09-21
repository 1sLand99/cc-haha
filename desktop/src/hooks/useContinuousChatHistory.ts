import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react'

type Direction = 'older' | 'newer'
type Anchor = { key: string; top: number; offset: number; identities?: string[]; child?: string }
type Snapshot = { sessionId?: string; anchors: Anchor[]; scrollTop: number }
type Options = {
  sessionId?: string
  revision: number
  // Identity of the authoritative initial page; reloads may keep ready/revision unchanged.
  snapshotKey?: object
  ready: boolean
  loading: boolean
  error?: string | null
  olderCursor?: string | null
  newerCursor?: string | null
  container: RefObject<HTMLDivElement>
  keys: string[]
  offsets: number[]
  identities?: Map<string, string[]>
  isFollowing?: () => boolean
  load: (direction: Direction) => Promise<void>
  prefetch: (direction: Direction) => Promise<void>
  syncViewport: (container: HTMLElement) => void
  preserveReading: () => void
}

/** Paging and measured layout changes share one reading anchor, independent of page revisions. */
export function useContinuousChatHistory(options: Options) {
  const current = useRef(options)
  current.current = options
  const reading = useRef<Snapshot | null>(null)
  const fillAtBottom = useRef(false)
  const intentUntil = useRef(0)
  const lastScrollTop = useRef(0)
  const direction = useRef<Direction | null>(null)
  const requestInFlight = useRef(false)
  const generation = useRef(0)
  const intentGeneration = useRef(0)
  const attempted = useRef(new Set<string>())
  const lastPrefetch = useRef('')
  const failedDirection = useRef<Direction>('older')
  const failed = useRef(false)
  const cancelled = useRef(false)
  const automaticFillAllowed = useRef(true)
  const previousSnapshotKey = useRef(options.snapshotKey)
  const previousSession = useRef(options.sessionId)
  const previousReady = useRef(options.ready)
  const correctionFrame = useRef<number | null>(null)
  const fillFrame = useRef<number | null>(null)
  const correcting = useRef(false)
  const checkRef = useRef<() => void>(() => {})

  const capture = useCallback((): Snapshot | null => {
    const state = current.current
    const container = state.container.current
    if (!container) return null
    const top = container.getBoundingClientRect().top
    const height = container.clientHeight || 800
    const anchors: Anchor[] = []
    for (const node of container.querySelectorAll<HTMLElement>('[data-chat-render-item-key]')) {
      const rect = node.getBoundingClientRect()
      if (rect.bottom <= top || rect.top >= top + height) continue
      const key = node.dataset.chatRenderItemKey!
      const index = state.keys.indexOf(key)
      if (index < 0) continue
      const child = Array.from(node.querySelectorAll<HTMLElement>('[data-chat-anchor-id]')).find((candidate) => {
        const bounds = candidate.getBoundingClientRect()
        return bounds.bottom > top && bounds.top < top + height
      })
      anchors.push({ key, top: (child ?? node).getBoundingClientRect().top - top, offset: state.offsets[index] ?? 0, identities: state.identities?.get(key), child: child?.dataset.chatAnchorId })
    }
    return { sessionId: state.sessionId, anchors, scrollTop: container.scrollTop }
  }, [])

  const scheduleCheck = useCallback(() => {
    const state = current.current
    if (!state.ready || (!state.olderCursor && !state.newerCursor) || state.error || failed.current) return
    if (fillFrame.current !== null) return
    const epoch = generation.current
    fillFrame.current = requestAnimationFrame(() => {
      fillFrame.current = null
      if (generation.current === epoch) checkRef.current()
    })
  }, [])

  const request = useCallback(async (nextDirection: Direction, retry = false, automatic = false) => {
    const state = current.current
    if (!state.sessionId || !state.ready || state.loading || requestInFlight.current) return
    const cursor = nextDirection === 'older' ? state.olderCursor : state.newerCursor
    if (!cursor) return
    const key = `${nextDirection}:${cursor}`
    if (!retry && (attempted.current.has(key) || state.error || failed.current)) return
    for (const previous of attempted.current) {
      if (!previous.startsWith(`${nextDirection}:`)) attempted.current.delete(previous)
    }
    attempted.current.add(key)
    failed.current = false
    cancelled.current = false
    if (!automatic) direction.current = nextDirection
    fillAtBottom.current = automatic && state.isFollowing?.() === true
    reading.current = fillAtBottom.current ? null : capture()
    requestInFlight.current = true
    const epoch = generation.current
    failedDirection.current = nextDirection
    if (!fillAtBottom.current) state.preserveReading()
    try {
      await state.load(nextDirection)
    } catch {
      if (generation.current === epoch) failed.current = true
      // The store owns the visible retry state.
    } finally {
      if (generation.current === epoch) {
        requestInFlight.current = false
        scheduleCheck()
      }
    }
  }, [capture, scheduleCheck])

  const checkBoundary = useCallback((nextDirection: Direction) => {
    const state = current.current
    const container = state.container.current
    if (!container || !state.ready || state.loading || state.error || failed.current || requestInFlight.current || correcting.current) return
    const distance = nextDirection === 'older' ? container.scrollTop : container.scrollHeight - container.clientHeight - container.scrollTop
    const height = container.clientHeight
    if (height <= 0) return
    const cursor = nextDirection === 'older' ? state.olderCursor : state.newerCursor
    if (!cursor) return
    if (distance <= height) {
      void request(nextDirection)
    } else if (distance <= height * 1.5) {
      const key = `${state.sessionId}:${nextDirection}:${cursor}`
      if (lastPrefetch.current !== key) {
        lastPrefetch.current = key
        void state.prefetch(nextDirection).catch(() => {})
      }
    }
  }, [request])

  checkRef.current = () => {
    const state = current.current
    const container = state.container.current
    if (!container || cancelled.current) return
    const short = container.clientHeight > 0 && container.scrollHeight <= container.clientHeight + 1
    if (direction.current) checkBoundary(direction.current)
    else if (short && automaticFillAllowed.current) void request(state.olderCursor ? 'older' : 'newer', false, true)
  }

  const stopCorrection = useCallback(() => {
    intentGeneration.current++
    correcting.current = false
    if (correctionFrame.current !== null) cancelAnimationFrame(correctionFrame.current)
    correctionFrame.current = null
  }, [])

  const onUserIntent = useCallback((nextDirection?: Direction) => {
    stopCorrection()
    fillAtBottom.current = false
    cancelled.current = false
    automaticFillAllowed.current = true
    intentUntil.current = performance.now() + 1500
    const container = current.current.container.current
    if (container) lastScrollTop.current = container.scrollTop
    reading.current = capture()
    if (nextDirection) {
      direction.current = nextDirection
      checkBoundary(nextDirection)
    }
  }, [capture, checkBoundary, stopCorrection])

  const onScroll = useCallback(() => {
    const container = current.current.container.current
    if (!container) return
    const delta = container.scrollTop - lastScrollTop.current
    lastScrollTop.current = container.scrollTop
    if (delta === 0 || correcting.current || performance.now() > intentUntil.current) return
    reading.current = capture()
    direction.current = delta < 0 ? 'older' : 'newer'
    checkBoundary(direction.current)
  }, [capture, checkBoundary])

  const restore = useCallback(() => {
    const state = current.current
    const container = state.container.current
    if (container && fillAtBottom.current && state.isFollowing?.() && !cancelled.current) {
      const bottom = Math.max(0, container.scrollHeight - container.clientHeight)
      if (Math.abs(container.scrollTop - bottom) > 0.5) {
        container.scrollTop = bottom
        lastScrollTop.current = bottom
        state.syncViewport(container)
      }
      return
    }
    const snapshot = reading.current
    if (!snapshot || snapshot.sessionId !== state.sessionId || !container || cancelled.current) return
    if (state.isFollowing?.()) {
      reading.current = null
      return
    }
    const nodes = Array.from(container.querySelectorAll<HTMLElement>('[data-chat-render-item-key]'))
    const anchor = snapshot.anchors.map((item) => {
      if (state.keys.includes(item.key)) return item
      const key = state.keys.find((candidate) => state.identities?.get(candidate)?.some((id) => item.identities?.includes(id)))
      return key ? { ...item, key } : undefined
    }).find((item) => item !== undefined)
    if (!anchor) return
    const row = nodes.find((node) => node.dataset.chatRenderItemKey === anchor.key)
    const child = anchor.child ? Array.from(row?.querySelectorAll<HTMLElement>('[data-chat-anchor-id]') ?? [])
      .find((node) => node.dataset.chatAnchorId === anchor.child) : undefined
    // If a group was collapsed, its former inner row has no meaningful pixel offset.
    const target = child ?? row
    const top = anchor.child && !child ? 0 : anchor.top
    const next = target
      ? container.scrollTop + target.getBoundingClientRect().top - container.getBoundingClientRect().top - top
      : snapshot.scrollTop + (state.offsets[state.keys.indexOf(anchor.key)] ?? 0) - anchor.offset
    if (Math.abs(next - container.scrollTop) > 0.5) {
      state.preserveReading()
      container.scrollTop = Math.max(0, next)
      lastScrollTop.current = container.scrollTop
      state.syncViewport(container)
    }
    if (target) reading.current = capture()
  }, [capture])

  // Keep the logical reader through every layout commit, including measured-height updates.
  useLayoutEffect(() => {
    if (previousSession.current !== options.sessionId || (previousReady.current && !options.ready)) {
      previousSession.current = options.sessionId
      reading.current = null
      fillAtBottom.current = false
      direction.current = null
      requestInFlight.current = false
      generation.current++
      attempted.current.clear()
      lastPrefetch.current = ''
      failed.current = false
      cancelled.current = false
      automaticFillAllowed.current = true
      intentUntil.current = 0
      stopCorrection()
      if (fillFrame.current !== null) cancelAnimationFrame(fillFrame.current)
      fillFrame.current = null
    }
    if (previousSnapshotKey.current !== options.snapshotKey) {
      previousSnapshotKey.current = options.snapshotKey
      generation.current++
      requestInFlight.current = false
      attempted.current.clear()
      failed.current = false
      lastPrefetch.current = ''
      if (fillFrame.current !== null) cancelAnimationFrame(fillFrame.current)
      fillFrame.current = null
    }
    previousReady.current = options.ready
    restore()
    if (!reading.current?.anchors.length && !cancelled.current && options.isFollowing?.() === false) reading.current = capture()
    if (reading.current && correctionFrame.current === null) {
      const epoch = intentGeneration.current
      correcting.current = true
      correctionFrame.current = requestAnimationFrame(() => {
        correctionFrame.current = null
        if (epoch !== intentGeneration.current) return
        restore()
        correcting.current = false
        checkRef.current()
      })
    }
    scheduleCheck()
  })

  useLayoutEffect(() => {
    const container = options.container.current
    if (!container || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      restore()
      scheduleCheck()
    })
    observer.observe(container)
    if (container.firstElementChild) observer.observe(container.firstElementChild)
    return () => observer.disconnect()
  }, [options.container, options.sessionId, restore, scheduleCheck])

  const cancelAnchor = useCallback(() => {
    reading.current = null
    fillAtBottom.current = false
    direction.current = null
    cancelled.current = true
    automaticFillAllowed.current = false
    intentUntil.current = 0
    generation.current++
    requestInFlight.current = false
    stopCorrection()
    if (fillFrame.current !== null) cancelAnimationFrame(fillFrame.current)
    fillFrame.current = null
  }, [stopCorrection])

  const resumeReading = useCallback(() => {
    cancelled.current = false
    direction.current = null
    intentUntil.current = 0
    reading.current = capture()
    const container = current.current.container.current
    if (container) lastScrollTop.current = container.scrollTop
  }, [capture])

  useLayoutEffect(() => () => {
    generation.current++
    stopCorrection()
    if (fillFrame.current !== null) cancelAnimationFrame(fillFrame.current)
  }, [stopCorrection])

  return { onUserIntent, onScroll, cancelAnchor, resumeReading, retry: () => { void request(failedDirection.current, true) } }
}
