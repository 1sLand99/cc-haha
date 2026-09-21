import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useContinuousChatHistory } from './useContinuousChatHistory'

function fixture() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  Object.defineProperties(container, { clientHeight: { value: 300 }, scrollHeight: { configurable: true, value: 2000 } })
  container.getBoundingClientRect = () => ({ top: 0, bottom: 300, height: 300 } as DOMRect)
  function rows(keys: string[]) {
    container.replaceChildren(...keys.map((key, index) => {
      const node = document.createElement('div')
      node.dataset.chatRenderItemKey = key
      node.getBoundingClientRect = () => ({ top: index * 200 - container.scrollTop, bottom: (index + 1) * 200 - container.scrollTop, height: 200 } as DOMRect)
      return node
    }))
  }
  const options = {
    sessionId: 'session', revision: 0, ready: true, loading: false,
    olderCursor: 'older', newerCursor: 'newer', container: { current: container },
    keys: ['a', 'b', 'c', 'd'], offsets: [0, 200, 400, 600, 800],
    load: vi.fn(async (_direction: 'older' | 'newer') => {}),
    prefetch: vi.fn(async (_direction: 'older' | 'newer') => {}),
    syncViewport: vi.fn(), preserveReading: vi.fn(),
  }
  rows(options.keys)
  return { container, options, rows }
}

afterEach(() => { cleanup(); document.body.replaceChildren(); vi.restoreAllMocks() })

describe('continuous bounded history scrolling', () => {
  it('does not load a filled viewport on mount or programmatic scroll and prefetches once ahead of an intentional boundary', () => {
    const { container, options } = fixture()
    const view = renderHook(() => useContinuousChatHistory(options))
    container.scrollTop = 400
    act(() => view.result.current.onScroll())
    expect(options.load).not.toHaveBeenCalled()
    expect(options.prefetch).not.toHaveBeenCalled()
    act(() => view.result.current.onUserIntent('older'))
    act(() => view.result.current.onUserIntent('older'))
    expect(options.prefetch).toHaveBeenCalledTimes(1)
    expect(options.prefetch).toHaveBeenCalledWith('older')
    expect(options.load).not.toHaveBeenCalled()
  })

  it('loads both boundaries only once while a request is outstanding', async () => {
    const { container, options } = fixture()
    let resolve!: () => void
    options.load.mockImplementationOnce(() => new Promise<void>((done) => { resolve = done }))
    const view = renderHook(() => useContinuousChatHistory(options))
    container.scrollTop = 100
    act(() => view.result.current.onUserIntent('older'))
    act(() => view.result.current.onUserIntent('older'))
    expect(options.load).toHaveBeenCalledTimes(1)
    await act(async () => { resolve() })
    container.scrollTop = 1600
    act(() => view.result.current.onUserIntent('newer'))
    expect(options.load).toHaveBeenLastCalledWith('newer')
  })

  it('preserves the visible row pixel offset after prepending', () => {
    const { container, options, rows } = fixture()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
    options.load.mockImplementation(() => new Promise(() => {}))
    container.scrollTop = 220
    const view = renderHook((props) => useContinuousChatHistory(props), { initialProps: options })
    act(() => view.result.current.onUserIntent('older'))
    const keys = ['older', ...options.keys]
    rows(keys)
    view.rerender({ ...options, revision: 1, keys, offsets: [0, 200, 400, 600, 800, 1000] })
    expect(container.scrollTop).toBe(420)
    expect(container.querySelector<HTMLElement>('[data-chat-render-item-key="b"]')!.getBoundingClientRect().top).toBe(-20)
    expect(options.syncViewport).toHaveBeenCalled()
    expect(options.load).toHaveBeenCalledTimes(1)
  })

  it('preserves the row offset when scrolling forward evicts rows above it', () => {
    const { container, options, rows } = fixture()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
    Object.defineProperty(container, 'scrollHeight', { value: 1000 })
    const keys = ['old', ...options.keys]
    rows(keys)
    container.scrollTop = 620
    const props = { ...options, keys, offsets: [0, 200, 400, 600, 800, 1000] }
    const view = renderHook((next) => useContinuousChatHistory(next), { initialProps: props })
    act(() => view.result.current.onUserIntent('newer'))
    const nextKeys = [...options.keys, 'new']
    rows(nextKeys)
    view.rerender({ ...props, revision: 1, keys: nextKeys })
    expect(container.scrollTop).toBe(420)
    expect(container.querySelector<HTMLElement>('[data-chat-render-item-key="c"]')!.getBoundingClientRect().top).toBe(-20)
  })

  it('anchors a merged tool group by its surviving tool identity', () => {
    const { container, options, rows } = fixture()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
    rows(['group-tool-a'])
    container.scrollTop = 20
    const props = { ...options, keys: ['group-tool-a'], offsets: [0, 200], identities: new Map([['group-tool-a', ['tool-a']]]) }
    const view = renderHook((next) => useContinuousChatHistory(next), { initialProps: props })
    act(() => view.result.current.onUserIntent('older'))
    rows(['older-message', 'group-tool-before-a'])
    view.rerender({ ...props, revision: 1, keys: ['older-message', 'group-tool-before-a'], offsets: [0, 200, 400], identities: new Map([['group-tool-before-a', ['tool-before', 'tool-a']]]) })
    expect(container.scrollTop).toBe(220)
  })

  it('captures the latest reading position when the user reverses direction during a slow request', () => {
    const { container, options, rows } = fixture()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
    options.load.mockImplementation(() => new Promise(() => {}))
    container.scrollTop = 220
    const view = renderHook((next) => useContinuousChatHistory(next), { initialProps: options })
    act(() => view.result.current.onUserIntent('older'))
    act(() => view.result.current.onUserIntent('newer'))
    container.scrollTop = 420
    act(() => view.result.current.onScroll())
    const keys = ['older', ...options.keys]
    rows(keys)
    view.rerender({ ...options, revision: 1, keys, offsets: [0, 200, 400, 600, 800, 1000] })
    expect(container.scrollTop).toBe(620)
    expect(container.querySelector<HTMLElement>('[data-chat-render-item-key="c"]')!.getBoundingClientRect().top).toBe(-20)
    expect(options.load).toHaveBeenCalledTimes(1)
  })

  it('releases a historical anchor when the reader explicitly jumps to live messages', () => {
    const { container, options, rows } = fixture()
    options.load.mockImplementation(() => new Promise(() => {}))
    container.scrollTop = 220
    const view = renderHook((next) => useContinuousChatHistory(next), { initialProps: options })
    act(() => view.result.current.onUserIntent('older'))
    act(() => view.result.current.cancelAnchor())
    rows(['older', ...options.keys])
    view.rerender({ ...options, revision: 1, keys: ['older', ...options.keys], offsets: [0, 200, 400, 600, 800, 1000] })
    expect(container.scrollTop).toBe(220)
    expect(options.syncViewport).not.toHaveBeenCalled()
  })

  it('keeps late responses for a prior session from releasing a new session request', async () => {
    const { container, options } = fixture()
    let resolveOld!: () => void
    options.load.mockImplementationOnce(() => new Promise<void>((done) => { resolveOld = done }))
      .mockImplementation(() => new Promise(() => {}))
    const view = renderHook((props) => useContinuousChatHistory(props), { initialProps: options })
    container.scrollTop = 100
    act(() => view.result.current.onUserIntent('older'))
    view.rerender({ ...options, sessionId: 'other' })
    act(() => view.result.current.onUserIntent('older'))
    await act(async () => { resolveOld() })
    act(() => view.result.current.onUserIntent('older'))
    expect(options.load).toHaveBeenCalledTimes(2)
  })

  it('pauses automatic retry after a failed page and allows explicit retry', () => {
    const { options } = fixture()
    const view = renderHook(() => useContinuousChatHistory({ ...options, error: 'failed' }))
    act(() => view.result.current.onUserIntent('older'))
    expect(options.load).not.toHaveBeenCalled()
    act(() => view.result.current.retry())
    expect(options.load).toHaveBeenCalledWith('older')
  })
  it('fills a short transcript across collapsed pages without another gesture and stops on a repeated cursor', async () => {
    const { container, options } = fixture()
    Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 120 })
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { frames.push(callback); return frames.length })
    const view = renderHook((props) => useContinuousChatHistory(props), { initialProps: options })
    await act(async () => { frames.splice(0).forEach((frame) => frame(0)) })
    expect(options.load).toHaveBeenCalledTimes(1)
    view.rerender({ ...options, revision: 1, olderCursor: 'older-2' })
    await act(async () => { frames.splice(0).forEach((frame) => frame(16)) })
    expect(options.load).toHaveBeenCalledTimes(2)
    await act(async () => { frames.splice(0).forEach((frame) => frame(32)) })
    expect(options.load).toHaveBeenCalledTimes(2)
  })

  it('keeps reading position when measured heights change without a history revision', () => {
    const { container, options } = fixture()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
    container.scrollTop = 220
    const view = renderHook((props) => useContinuousChatHistory(props), { initialProps: options })
    act(() => view.result.current.onUserIntent())
    const row = container.querySelector<HTMLElement>('[data-chat-render-item-key="b"]')!
    row.getBoundingClientRect = () => ({ top: 350 - container.scrollTop, bottom: 550 - container.scrollTop, height: 200 } as DOMRect)
    view.rerender({ ...options, offsets: [0, 350, 550, 750, 950] })
    expect(container.scrollTop).toBe(370)
    expect(row.getBoundingClientRect().top).toBe(-20)
  })

  it('does not overwrite a new user position with the previous animation frame correction', () => {
    const { container, options, rows } = fixture()
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { frames.push(callback); return frames.length })
    options.load.mockImplementation(() => new Promise(() => {}))
    container.scrollTop = 220
    const view = renderHook((props) => useContinuousChatHistory(props), { initialProps: options })
    act(() => view.result.current.onUserIntent('older'))
    rows(['older', ...options.keys])
    view.rerender({ ...options, revision: 1, keys: ['older', ...options.keys], offsets: [0, 200, 400, 600, 800, 1000] })
    act(() => view.result.current.onUserIntent('newer'))
    container.scrollTop = 620
    act(() => view.result.current.onScroll())
    act(() => frames.splice(0).forEach((frame) => frame(16)))
    expect(container.scrollTop).toBe(620)
  })

  it('keeps the visible tool step fixed when a page extends its group above that step', () => {
    const { container, options, rows } = fixture()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
    rows(['group-a'])
    let childOffset = 200
    const child = document.createElement('div')
    child.dataset.chatAnchorId = 'tool-a'
    child.getBoundingClientRect = () => ({ top: childOffset - container.scrollTop, bottom: childOffset + 300 - container.scrollTop, height: 300 } as DOMRect)
    const group = container.firstElementChild as HTMLElement
    group.getBoundingClientRect = () => ({ top: -container.scrollTop, bottom: 1000 - container.scrollTop, height: 1000 } as DOMRect)
    group.append(child)
    container.scrollTop = 220
    const props = { ...options, keys: ['group-a'], offsets: [0, 1000], identities: new Map([['group-a', ['tool-a']]]) }
    const view = renderHook((next) => useContinuousChatHistory(next), { initialProps: props })
    act(() => view.result.current.onUserIntent())
    childOffset = 450
    group.dataset.chatRenderItemKey = 'group-before-a'
    view.rerender({ ...props, keys: ['group-before-a'], offsets: [0, 1250], identities: new Map([['group-before-a', ['tool-before', 'tool-a']]]) })
    expect(container.scrollTop).toBe(470)
    expect(child.getBoundingClientRect().top).toBe(-20)
  })

  it('stops background filling on a rejected request and ignores a zero-height viewport', async () => {
    const { container, options } = fixture()
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { frames.push(callback); return frames.length })
    Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 120 })
    options.load.mockRejectedValue(new Error('offline'))
    renderHook(() => useContinuousChatHistory(options))
    await act(async () => { frames.splice(0).forEach((frame) => frame(0)) })
    await act(async () => { frames.splice(0).forEach((frame) => frame(16)) })
    expect(options.load).toHaveBeenCalledTimes(1)
    cleanup()
    const hidden = document.createElement('div')
    renderHook(() => useContinuousChatHistory({ ...options, container: { current: hidden } }))
    await act(async () => { frames.splice(0).forEach((frame) => frame(32)) })
    expect(options.load).toHaveBeenCalledTimes(1)
  })

  it('compensates loading notice insertion and removal without changing the page revision', () => {
    const { container, options } = fixture()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
    container.scrollTop = 220
    const view = renderHook((props) => useContinuousChatHistory(props), { initialProps: options })
    act(() => view.result.current.onUserIntent())
    const row = container.querySelector<HTMLElement>('[data-chat-render-item-key="b"]')!
    let noticeHeight = 32
    row.getBoundingClientRect = () => ({ top: 200 + noticeHeight - container.scrollTop, bottom: 400 + noticeHeight - container.scrollTop, height: 200 } as DOMRect)
    view.rerender({ ...options, loading: true })
    expect(container.scrollTop).toBe(252)
    noticeHeight = 0
    view.rerender({ ...options, loading: false })
    expect(container.scrollTop).toBe(220)
  })

  it('stops initial filling once scrollable and retains the latest content at the bottom', async () => {
    const { container, options } = fixture()
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { frames.push(callback); return frames.length })
    Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 100 })
    const props = { ...options, isFollowing: () => true }
    const view = renderHook((next) => useContinuousChatHistory(next), { initialProps: props })
    await act(async () => { frames.splice(0).forEach((frame) => frame(0)) })
    expect(options.load).toHaveBeenCalledTimes(1)
    Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 500 })
    view.rerender({ ...props, revision: 1, olderCursor: 'older-2' })
    await act(async () => { frames.splice(0).forEach((frame) => frame(16)) })
    expect(options.load).toHaveBeenCalledTimes(1)
    expect(container.scrollTop).toBe(200)
    expect(options.preserveReading).not.toHaveBeenCalled()
  })

  it('does not accept a layout-only scroll event as a new reading position', () => {
    const { container, options } = fixture()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
    container.scrollTop = 220
    const view = renderHook((props) => useContinuousChatHistory(props), { initialProps: options })
    act(() => view.result.current.onUserIntent())
    const row = container.querySelector<HTMLElement>('[data-chat-render-item-key="b"]')!
    row.getBoundingClientRect = () => ({ top: 350 - container.scrollTop, bottom: 550 - container.scrollTop, height: 200 } as DOMRect)
    act(() => view.result.current.onScroll())
    view.rerender({ ...options, offsets: [0, 350, 550, 750, 950] })
    expect(container.scrollTop).toBe(370)
  })

  it('captures rows after a fast scroll mounts a previously absent virtual window', () => {
    const { container, options, rows } = fixture()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
    const props = { ...options, isFollowing: () => false }
    const view = renderHook((next) => useContinuousChatHistory(next), { initialProps: props })
    container.replaceChildren()
    container.scrollTop = 220
    act(() => view.result.current.onUserIntent())
    rows(options.keys)
    view.rerender({ ...props })
    const row = container.querySelector<HTMLElement>('[data-chat-render-item-key="b"]')!
    row.getBoundingClientRect = () => ({ top: 350 - container.scrollTop, bottom: 550 - container.scrollTop, height: 200 } as DOMRect)
    view.rerender({ ...props, offsets: [0, 350, 550, 750, 950] })
    expect(container.scrollTop).toBe(370)
  })

  it('allows the same cursor again after rehydrating the current session', async () => {
    const { container, options } = fixture()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
    container.scrollTop = 100
    const view = renderHook((props) => useContinuousChatHistory(props), { initialProps: options })
    await act(async () => view.result.current.onUserIntent('older'))
    expect(options.load).toHaveBeenCalledTimes(1)
    view.rerender({ ...options, ready: false })
    view.rerender({ ...options, ready: true })
    await act(async () => view.result.current.onUserIntent('older'))
    expect(options.load).toHaveBeenCalledTimes(2)
  })

  it('allows a reused cursor after an authoritative reload without toggling ready or revision', async () => {
    const { container, options } = fixture()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
    const props = { ...options, snapshotKey: {} }
    container.scrollTop = 100
    const view = renderHook((next) => useContinuousChatHistory(next), { initialProps: props })
    await act(async () => view.result.current.onUserIntent('older'))
    view.rerender({ ...props, snapshotKey: {} })
    await act(async () => view.result.current.onUserIntent('older'))
    expect(options.load).toHaveBeenCalledTimes(2)
  })

})
