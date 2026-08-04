import { afterEach, describe, expect, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import { lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  __prepareDaemonSocketDirectoryForTests,
  __resetDaemonClientForTests,
  __daemonStartCountForTests,
  __reapStaleDaemonsForTests,
  __setDaemonSocketForTests,
  callDaemon,
  DaemonCommandTimeoutError,
  DaemonCommandResultUnknownError,
  DaemonUnavailableError,
  isOverlayShown,
  overlayHide,
  overlayShow,
} from './cuHelperDaemon.js'
import { __resetCuHelperCache } from './cuHelperBridge.js'
import { __resetInstalledHelperCache } from './cuHelperInstall.js'

class FakeSocket extends EventEmitter {
  writes: string[] = []
  destroyed = false

  write(data: string): boolean {
    this.writes.push(data)
    return true
  }

  destroy(): this {
    this.destroyed = true
    return this
  }
}

async function waitForWrite(socket: FakeSocket): Promise<void> {
  for (let i = 0; i < 10 && socket.writes.length === 0; i++) {
    await Promise.resolve()
  }
  expect(socket.writes).toHaveLength(1)
}

async function waitForWriteCount(socket: FakeSocket, count: number): Promise<void> {
  for (let i = 0; i < 20 && socket.writes.length < count; i++) {
    await Promise.resolve()
  }
  expect(socket.writes).toHaveLength(count)
}

function reply(
  socket: FakeSocket,
  writeIndex: number,
  response: { ok: boolean; result?: unknown; error?: { message: string } },
): void {
  const id = JSON.parse(socket.writes[writeIndex]!).id
  socket.emit('data', Buffer.from(`${JSON.stringify({ id, ...response })}\n`))
}

afterEach(() => {
  __resetDaemonClientForTests()
  __resetCuHelperCache()
  __resetInstalledHelperCache()
  delete process.env.CC_HAHA_CU_HELPER_PATH
})

describe('cu-helper daemon system commands', () => {
  test('uses trusted absolute binaries for process probing and LaunchServices', async () => {
    const { __daemonProcessCommandsForTests } = await import('./cuHelperDaemon.js')
    expect(
      __daemonProcessCommandsForTests(
        [101, 202],
        '/Applications/cc-haha-computer-use.app',
        '/tmp/cu-helper.sock',
      ),
    ).toEqual({
      ps: {
        command: '/bin/ps',
        args: ['-o', 'pid=,comm=', '-p', '101,202'],
      },
      open: {
        command: '/usr/bin/open',
        args: [
          '-n',
          '/Applications/cc-haha-computer-use.app',
          '--args',
          'daemon',
          '--socket',
          '/tmp/cu-helper.sock',
        ],
      },
    })
  })

  test('creates a private runtime directory before the native daemon binds', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'cc-haha-cu-runtime-test-'))
    try {
      const runtimeDir = path.join(root, '.runtime')
      __prepareDaemonSocketDirectoryForTests(
        path.join(runtimeDir, 'cu-helper.sock'),
      )

      const stat = lstatSync(runtimeDir)
      expect(stat.isDirectory()).toBe(true)
      expect(stat.mode & 0o777).toBe(0o700)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('refuses a symlinked runtime directory for the owner-only socket', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'cc-haha-cu-runtime-test-'))
    try {
      const actual = path.join(root, 'actual')
      const runtimeDir = path.join(root, '.runtime')
      mkdirSync(actual)
      symlinkSync(actual, runtimeDir)

      expect(() => __prepareDaemonSocketDirectoryForTests(
        path.join(runtimeDir, 'cu-helper.sock'),
      )).toThrow(/symbolic link/i)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('cu-helper daemon failure classification', () => {
  test('helper installation/start resolution failure is daemon infrastructure failure', async () => {
    // A bare executable can satisfy the availability probe but cannot be
    // launched as the helper .app daemon. The bridge must be allowed to use the
    // native one-shot CLI for this pre-dispatch failure.
    process.env.CC_HAHA_CU_HELPER_PATH = '/bin/echo'
    __resetCuHelperCache()
    __resetInstalledHelperCache()

    const error = await callDaemon('list_displays', {}).catch(err => err)
    expect(error).toBeInstanceOf(DaemonUnavailableError)
    expect(error.message).toMatch(/app bundle not found/)
  })

  test('socket close after dispatch rejects pending requests as non-replayable result-unknown errors', async () => {
    const socket = new FakeSocket()
    __setDaemonSocketForTests(socket as never, 100)

    const request = callDaemon('list_displays', {}).catch(err => err)
    await waitForWrite(socket)
    socket.emit('close')

    const error = await request
    expect(error).toBeInstanceOf(DaemonCommandResultUnknownError)
    expect(error).not.toBeInstanceOf(DaemonUnavailableError)
    expect(error.message).toMatch(/socket closed/)
  })

  test('socket error after dispatch rejects pending requests as non-replayable result-unknown errors', async () => {
    const socket = new FakeSocket()
    __setDaemonSocketForTests(socket as never, 100)

    const request = callDaemon('list_displays', {}).catch(err => err)
    await waitForWrite(socket)
    socket.emit('error', new Error('broken pipe'))

    const error = await request
    expect(error).toBeInstanceOf(DaemonCommandResultUnknownError)
    expect(error).not.toBeInstanceOf(DaemonUnavailableError)
    expect(error.message).toMatch(/broken pipe/)
  })

  test('daemon command rejection remains a command error, not infrastructure failure', async () => {
    const socket = new FakeSocket()
    __setDaemonSocketForTests(socket as never, 100)

    const request = callDaemon('press_key', { keys: ['cmd+q'] }).catch(err => err)
    await waitForWrite(socket)
    const id = JSON.parse(socket.writes[0]!).id
    socket.emit('data', Buffer.from(
      `${JSON.stringify({ id, ok: false, error: { message: 'grant_flag_required' } })}\n`,
    ))

    const error = await request
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(DaemonUnavailableError)
    expect(error.message).toBe('grant_flag_required')
  })

  test('post-dispatch timeout is ambiguous and must not be classified as replayable infrastructure', async () => {
    const socket = new FakeSocket()
    __setDaemonSocketForTests(socket as never, 5)

    const error = await callDaemon('click', { x: 10, y: 20 }).catch(err => err)

    expect(socket.writes).toHaveLength(1)
    expect(error).toBeInstanceOf(DaemonCommandTimeoutError)
    expect(error).toBeInstanceOf(DaemonCommandResultUnknownError)
    expect(error).not.toBeInstanceOf(DaemonUnavailableError)
    expect(error.message).toMatch(/execution result is unknown/i)
    expect(socket.destroyed).toBe(true)
  })

  test('a socket already closed before dispatch is replayable infrastructure', async () => {
    const socket = new FakeSocket()
    socket.destroyed = true
    __setDaemonSocketForTests(socket as never, 5)

    const error = await callDaemon('type_text', { text: 'safe' }).catch(err => err)

    expect(socket.writes).toHaveLength(0)
    expect(error).toBeInstanceOf(DaemonUnavailableError)
    expect(error.message).toMatch(/closed before command dispatch/)
  })

  test('reset never SIGTERMs a daemon pid unless it still belongs to cu-helper', async () => {
    const unverifiedSocket = new FakeSocket()
    const killed: number[] = []
    __setDaemonSocketForTests(unverifiedSocket as never, 100, {
      daemonPid: 4242,
      verifyDaemonPid: () => false,
      killDaemonPid: pid => { killed.push(pid) },
    })
    unverifiedSocket.emit('close')
    for (let i = 0; i < 5; i++) await Promise.resolve()
    expect(killed).toEqual([])

    const verifiedSocket = new FakeSocket()
    __setDaemonSocketForTests(verifiedSocket as never, 100, {
      daemonPid: 4242,
      verifyDaemonPid: () => true,
      killDaemonPid: pid => { killed.push(pid) },
    })
    verifiedSocket.emit('close')
    for (let i = 0; i < 5; i++) await Promise.resolve()
    expect(killed).toEqual([4242])
  })

  test('a stale socket close cannot reset a replacement daemon', async () => {
    const oldSocket = new FakeSocket()
    const replacement = new FakeSocket()
    __setDaemonSocketForTests(oldSocket as never)
    __setDaemonSocketForTests(replacement as never)

    oldSocket.emit('close')
    const ping = callDaemon<string>('ping', {})
    await waitForWriteCount(replacement, 1)
    reply(replacement, 0, { ok: true, result: 'pong' })

    expect(await ping).toBe('pong')
    expect(replacement.destroyed).toBe(false)
  })
})

describe('cu-helper overlay reconciliation', () => {
  test('overlay_show forwards the canonical explicit target payload', async () => {
    const socket = new FakeSocket()
    __setDaemonSocketForTests(socket as never)

    const show = overlayShow({ pid: 4321 })
    await waitForWriteCount(socket, 1)
    expect(JSON.parse(socket.writes[0]!)).toMatchObject({
      cmd: 'overlay_show',
      payload: { pid: 4321 },
    })
    reply(socket, 0, { ok: true, result: true })
    await show

    expect(isOverlayShown()).toBe(true)
  })

  test('hide requested while show is pending always converges to hidden', async () => {
    const socket = new FakeSocket()
    __setDaemonSocketForTests(socket as never)

    const show = overlayShow({ bundleId: 'com.apple.TextEdit' })
    await waitForWriteCount(socket, 1)
    const hide = overlayHide()
    expect(isOverlayShown()).toBe(false)

    reply(socket, 0, { ok: true, result: true })
    await waitForWriteCount(socket, 2)
    expect(JSON.parse(socket.writes[1]!)).toMatchObject({
      cmd: 'overlay_hide',
      payload: {},
    })
    reply(socket, 1, { ok: true, result: true })

    await Promise.all([show, hide])
    expect(isOverlayShown()).toBe(false)
  })

  test('a target change while show is pending serially retargets to the latest app', async () => {
    const socket = new FakeSocket()
    __setDaemonSocketForTests(socket as never)

    const first = overlayShow({ pid: 100 })
    await waitForWriteCount(socket, 1)
    const second = overlayShow({ pid: 200 })

    reply(socket, 0, { ok: true, result: true })
    await waitForWriteCount(socket, 2)
    expect(JSON.parse(socket.writes[1]!)).toMatchObject({
      cmd: 'overlay_show',
      payload: { pid: 200 },
    })
    reply(socket, 1, { ok: true, result: true })

    await Promise.all([first, second])
    expect(isOverlayShown()).toBe(true)
  })

  test('a failed show does not claim the overlay is visible or trigger a hide', async () => {
    const socket = new FakeSocket()
    __setDaemonSocketForTests(socket as never)

    const show = overlayShow({ app: 'TextEdit' })
    await waitForWriteCount(socket, 1)
    reply(socket, 0, { ok: false, error: { message: 'target_not_running' } })
    await show

    expect(isOverlayShown()).toBe(false)
    await overlayHide()
    expect(socket.writes).toHaveLength(1)
  })

  test('cleanup with no daemon does not start one', async () => {
    expect(__daemonStartCountForTests()).toBe(0)
    await overlayHide()
    expect(__daemonStartCountForTests()).toBe(0)
  })
})

describe('cu-helper stale daemon reaping', () => {
  const current = '/runtime/cu-helper.daemon.100.sock'

  function harness(options: {
    entries?: string[]
    live?: number[]
    pidfiles?: Record<string, string>
    verified?: number[]
  } = {}) {
    const removed: string[] = []
    const killed: number[] = []
    const live = new Set(options.live ?? [])
    const verified = new Set(options.verified ?? [])
    return {
      removed,
      killed,
      run: () => __reapStaleDaemonsForTests(current, {
        readdir: () => options.entries ?? ['cu-helper.daemon.200.sock.pid'],
        readPidfile: pidfile => options.pidfiles?.[pidfile] ?? '900',
        remove: target => { removed.push(target) },
        isAlive: pid => live.has(pid),
        verifiedHelperPids: () => verified,
        kill: pid => { killed.push(pid) },
      }),
    }
  }

  test('never kills or unlinks a daemon whose owner process is alive', () => {
    const h = harness({
      entries: ['cu-helper.daemon.200.7.sock.pid'],
      live: [200, 900],
      verified: [900],
    })
    h.run()
    expect(h.killed).toEqual([])
    expect(h.removed).toEqual([])
  })

  test('reaps a verified helper only after its owner process is dead', () => {
    const h = harness({
      entries: ['cu-helper.daemon.200.7.sock.pid'],
      live: [900],
      verified: [900],
    })
    h.run()
    expect(h.killed).toEqual([900])
    expect(h.removed).toEqual([
      '/runtime/cu-helper.daemon.200.7.sock',
      '/runtime/cu-helper.daemon.200.7.sock.pid',
    ])
  })

  test('preserves a live but unverified process and its endpoint', () => {
    const h = harness({ live: [900], verified: [] })
    h.run()
    expect(h.killed).toEqual([])
    expect(h.removed).toEqual([])
  })

  test('cleans endpoint leftovers when both owner and daemon are dead', () => {
    const h = harness({ live: [] })
    h.run()
    expect(h.killed).toEqual([])
    expect(h.removed).toEqual([
      '/runtime/cu-helper.daemon.200.sock',
      '/runtime/cu-helper.daemon.200.sock.pid',
    ])
  })

  test('ignores malformed owner names and malformed pidfile contents', () => {
    const h = harness({
      entries: [
        'cu-helper.daemon.not-a-pid.sock.pid',
        'cu-helper.daemon.200.sock.pid',
      ],
      pidfiles: { '/runtime/cu-helper.daemon.200.sock.pid': '900junk' },
    })
    h.run()
    expect(h.killed).toEqual([])
    expect(h.removed).toEqual([
      '/runtime/cu-helper.daemon.200.sock',
      '/runtime/cu-helper.daemon.200.sock.pid',
    ])
  })
})
