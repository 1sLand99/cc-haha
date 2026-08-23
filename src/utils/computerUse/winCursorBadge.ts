import { spawn, type ChildProcess } from 'node:child_process'
import { logForDebugging } from '../debug.js'
import { getCursorBadgeCommand } from './pythonBridge.js'

/**
 * The Windows agent-activity badge: a click-through marker that rides the real
 * cursor while the agent is driving.
 *
 * WHY WINDOWS NEEDS THIS AND macOS DOES NOT
 * -----------------------------------------
 * On macOS the helper delivers input with `CGEvent.postToPid`, so the real
 * pointer never moves and the drawn cursor is the only one there is — a
 * *replacement*, and unambiguous by construction.
 *
 * Windows has no per-process delivery. Input goes through `SendInput`, which
 * warps the one real cursor the user's hand is also on. Drawing a second fake
 * pointer would make that worse, not better: two pointers, one of which is
 * lying about where the click will land.
 *
 * So this badge annotates rather than replaces. It answers the one question
 * the user cannot otherwise answer — "is the mouse moving because of me, or
 * because of the agent?" — which on Windows has real stakes, since grabbing
 * the mouse mid-action is what causes the two input streams to interleave.
 *
 * Lifecycle mirrors the macOS overlay: shown while a turn is driving, hidden
 * at turn end. It is advisory, so every failure here is logged and swallowed —
 * a badge that cannot start must never be the reason an action fails.
 */

let badgeProcess: ChildProcess | undefined

function isRunning(): boolean {
  return badgeProcess !== undefined && badgeProcess.exitCode === null && !badgeProcess.killed
}

/** Start the badge if it isn't already up. Idempotent, never throws. */
export function showCursorBadge(label = 'Claude'): void {
  if (process.platform !== 'win32') return
  if (isRunning()) return

  try {
    const { python, script } = getCursorBadgeCommand()
    const child = spawn(python, [script, '--label', label], {
      // 'ignore' for stderr would discard the reason it died; 'pipe' on stdin
      // is load-bearing — the badge exits when stdin closes, which is what
      // ties its lifetime to ours even if we are killed rather than exiting.
      stdio: ['pipe', 'ignore', 'pipe'],
      windowsHide: true,
      detached: false,
    })

    child.on('error', err => {
      logForDebugging(`cursor badge failed to start: ${String(err)}`, { level: 'debug' })
      if (badgeProcess === child) badgeProcess = undefined
    })
    child.on('exit', () => {
      if (badgeProcess === child) badgeProcess = undefined
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      logForDebugging(`cursor badge: ${chunk.toString().trim()}`, { level: 'debug' })
    })

    badgeProcess = child
  } catch (err) {
    logForDebugging(`cursor badge spawn threw: ${String(err)}`, { level: 'debug' })
    badgeProcess = undefined
  }
}

/** Take the badge down. Idempotent, never throws. */
export function hideCursorBadge(): void {
  const child = badgeProcess
  badgeProcess = undefined
  if (!child) return

  try {
    // Closing stdin is the graceful path — the badge's reader hits EOF and
    // unwinds its own message loop. kill() is the backstop for a process that
    // is wedged before it ever got to that read.
    child.stdin?.end()
    child.kill()
  } catch (err) {
    logForDebugging(`cursor badge shutdown failed: ${String(err)}`, { level: 'debug' })
  }
}

/** Test hook: forget any tracked process without signalling it. */
export function __resetCursorBadgeState(): void {
  badgeProcess = undefined
}

/** Test hook: whether a badge process is currently tracked as running. */
export function __cursorBadgeIsRunning(): boolean {
  return isRunning()
}
