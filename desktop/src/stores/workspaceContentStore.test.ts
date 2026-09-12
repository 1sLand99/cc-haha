import { beforeEach, describe, expect, it, vi } from 'vitest'

type HoistedVi = typeof vi & { hoisted?: <T>(factory: () => T) => T }
if (typeof (vi as HoistedVi).hoisted !== 'function') {
  ;(vi as HoistedVi).hoisted = <T>(factory: () => T) => factory()
}

const mocks = vi.hoisted(() => ({
  getWorkspaceFile: vi.fn(),
  getWorkspaceTree: vi.fn(),
  getWorkspaceStatus: vi.fn(),
}))

vi.mock('../api/sessions', () => ({
  sessionsApi: {
    getWorkspaceFile: mocks.getWorkspaceFile,
    getWorkspaceTree: mocks.getWorkspaceTree,
    getWorkspaceStatus: mocks.getWorkspaceStatus,
  },
}))

import { useWorkspaceContentStore } from './workspaceContentStore'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

const SESSION = 'session-a'

function store() {
  return useWorkspaceContentStore.getState()
}

beforeEach(() => {
  // `clearSession` also drops the module-level probe/request bookkeeping, which
  // `setState` alone cannot reach.
  for (const sessionId of [SESSION, 'session-b']) {
    useWorkspaceContentStore.getState().clearSession(sessionId)
  }
  useWorkspaceContentStore.setState({
    filesByKey: {},
    treeByKey: {},
    treeLoadingByKey: {},
    expandedBySession: {},
    statusBySession: {},
  })
  mocks.getWorkspaceFile.mockReset()
  mocks.getWorkspaceTree.mockReset()
  mocks.getWorkspaceStatus.mockReset()
})

describe('file content', () => {
  it('reads a file once and serves the cache afterwards', async () => {
    mocks.getWorkspaceFile.mockResolvedValue({ state: 'ok', path: 'a.ts', content: 'x', language: 'ts', size: 1 })

    await store().loadFile(SESSION, 'a.ts')
    await store().loadFile(SESSION, 'a.ts')

    expect(mocks.getWorkspaceFile).toHaveBeenCalledTimes(1)
    expect(store().getFile(SESSION, 'a.ts')).toMatchObject({ state: 'ok', content: 'x' })
  })

  it('re-reads when the caller forces it', async () => {
    mocks.getWorkspaceFile.mockResolvedValue({ state: 'ok', path: 'a.ts', content: 'x', language: 'ts', size: 1 })

    await store().loadFile(SESSION, 'a.ts')
    await store().loadFile(SESSION, 'a.ts', { force: true })

    expect(mocks.getWorkspaceFile).toHaveBeenCalledTimes(2)
  })

  it('keeps the last good content when a refresh fails', async () => {
    mocks.getWorkspaceFile.mockResolvedValueOnce({ state: 'ok', path: 'a.ts', content: 'good', language: 'ts', size: 4 })
    await store().loadFile(SESSION, 'a.ts')

    mocks.getWorkspaceFile.mockResolvedValueOnce({ state: 'missing', path: 'a.ts', language: 'ts', size: 0, error: 'gone' })
    await store().loadFile(SESSION, 'a.ts', { force: true })

    // Blanking a file the user is reading because a refresh raced a save is
    // worse than showing slightly stale content next to the failure.
    expect(store().getFile(SESSION, 'a.ts')).toMatchObject({
      state: 'ok',
      content: 'good',
      refreshError: 'gone',
    })
  })

  it('surfaces a first-read failure as an error state', async () => {
    mocks.getWorkspaceFile.mockRejectedValue(new Error('boom'))
    await store().loadFile(SESSION, 'a.ts')
    expect(store().getFile(SESSION, 'a.ts')).toMatchObject({ state: 'error', error: 'boom' })
  })

  it('ignores a stale response that lost a race', async () => {
    const slow = deferred<unknown>()
    const fast = deferred<unknown>()
    mocks.getWorkspaceFile.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise)

    const first = store().loadFile(SESSION, 'a.ts')
    const second = store().loadFile(SESSION, 'a.ts', { force: true })

    fast.resolve({ state: 'ok', path: 'a.ts', content: 'newest', language: 'ts', size: 6 })
    await second
    slow.resolve({ state: 'ok', path: 'a.ts', content: 'stale', language: 'ts', size: 5 })
    await first

    expect(store().getFile(SESSION, 'a.ts')).toMatchObject({ content: 'newest' })
  })
})

describe('tree', () => {
  it('expands a directory and loads it once', async () => {
    mocks.getWorkspaceTree.mockResolvedValue({ state: 'ok', path: 'src', entries: [] })

    await store().toggleDirectory(SESSION, 'src')
    expect(store().isExpanded(SESSION, 'src')).toBe(true)
    expect(mocks.getWorkspaceTree).toHaveBeenCalledTimes(1)

    await store().toggleDirectory(SESSION, 'src')
    await store().toggleDirectory(SESSION, 'src')
    // Re-expanding a directory reuses the listing it already has.
    expect(mocks.getWorkspaceTree).toHaveBeenCalledTimes(1)
  })

  it('records a listing failure without losing the expansion', async () => {
    mocks.getWorkspaceTree.mockRejectedValue(new Error('nope'))
    await store().toggleDirectory(SESSION, 'src')

    expect(store().isExpanded(SESSION, 'src')).toBe(true)
    expect(store().getTree(SESSION, 'src')).toMatchObject({ state: 'error', error: 'nope' })
  })
})

describe('invalidation', () => {
  it('drops a changed file and its directory listing but keeps the tree open', async () => {
    mocks.getWorkspaceFile.mockResolvedValue({ state: 'ok', path: 'src/a.ts', content: 'x', language: 'ts', size: 1 })
    mocks.getWorkspaceTree.mockResolvedValue({ state: 'ok', path: 'src', entries: [] })

    await store().loadFile(SESSION, 'src/a.ts')
    await store().toggleDirectory(SESSION, 'src')

    store().invalidatePaths(SESSION, ['src/a.ts'])

    expect(store().getFile(SESSION, 'src/a.ts')).toBeUndefined()
    expect(store().getTree(SESSION, 'src')).toBeUndefined()
    // Re-reading a directory must not collapse the tree the user is looking at.
    expect(store().isExpanded(SESSION, 'src')).toBe(true)
  })

  it('does not apply a read that was in flight when the path was invalidated', async () => {
    const pending = deferred<unknown>()
    mocks.getWorkspaceFile.mockReturnValue(pending.promise)

    const read = store().loadFile(SESSION, 'a.ts')
    store().invalidatePaths(SESSION, ['a.ts'])
    pending.resolve({ state: 'ok', path: 'a.ts', content: 'late', language: 'ts', size: 4 })
    await read

    expect(store().getFile(SESSION, 'a.ts')).toBeUndefined()
  })
})

describe('session lifetime', () => {
  it('drops only the closed session', async () => {
    mocks.getWorkspaceFile.mockResolvedValue({ state: 'ok', path: 'a.ts', content: 'x', language: 'ts', size: 1 })
    await store().loadFile(SESSION, 'a.ts')
    await store().loadFile('session-b', 'a.ts')

    store().clearSession(SESSION)

    expect(store().getFile(SESSION, 'a.ts')).toBeUndefined()
    expect(store().getFile('session-b', 'a.ts')).toMatchObject({ state: 'ok' })
  })

  it('probes the Git status once so the launcher can explain itself', async () => {
    mocks.getWorkspaceStatus.mockResolvedValue({
      state: 'ok', workDir: '/repo', repoName: null, branch: null, isGitRepo: false, changedFiles: [],
    })

    await store().loadStatus(SESSION)
    await store().loadStatus(SESSION)

    expect(mocks.getWorkspaceStatus).toHaveBeenCalledTimes(1)
    expect(useWorkspaceContentStore.getState().statusBySession[SESSION]).toMatchObject({ isGitRepo: false })
  })

  it('leaves the launcher alone when the status probe fails', async () => {
    mocks.getWorkspaceStatus.mockRejectedValue(new Error('offline'))
    await store().loadStatus(SESSION)
    expect(useWorkspaceContentStore.getState().statusBySession[SESSION]).toBeUndefined()
  })
})

describe('status probe', () => {
  it('does not re-request after a failure on every remount', async () => {
    mocks.getWorkspaceStatus.mockRejectedValue(new Error('offline'))

    await store().loadStatus(SESSION)
    await store().loadStatus(SESSION)
    await store().loadStatus(SESSION)

    // A failed probe caches nothing, so guarding only the *result* would fire a
    // fresh request every time the file tab mounted.
    expect(mocks.getWorkspaceStatus).toHaveBeenCalledTimes(1)
  })

  it('retries when the caller explicitly forces it', async () => {
    mocks.getWorkspaceStatus.mockRejectedValue(new Error('offline'))
    await store().loadStatus(SESSION)
    await store().loadStatus(SESSION, { force: true })
    expect(mocks.getWorkspaceStatus).toHaveBeenCalledTimes(2)
  })

  it('probes again for a session that was closed and reopened', async () => {
    mocks.getWorkspaceStatus.mockRejectedValue(new Error('offline'))
    await store().loadStatus(SESSION)
    store().clearSession(SESSION)
    await store().loadStatus(SESSION)
    expect(mocks.getWorkspaceStatus).toHaveBeenCalledTimes(2)
  })
})
