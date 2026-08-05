import { logForDebugging } from '../debug.js'
import { callPythonHelper } from './pythonBridge.js'
import { isCuHelperAvailable } from './cuHelperBridge.js'
import {
  callDaemon,
  DaemonUnavailableError,
  isOverlayShown,
  overlayShow,
  shutdownDaemon,
} from './cuHelperDaemon.js'

// Latches true after we restart the daemon once in response to an Accessibility
// `not_trusted` error, so we don't thrash-restart while the helper is genuinely
// ungranted. Reset to false on the next successful daemon command (the grant
// landed) so a LATER ungranted streak can trigger one more restart.
let restartedDaemonForGrant = false

function isDaemonUnavailable(err: unknown): boolean {
  return err instanceof DaemonUnavailableError
}

/** The daemon ran the command and rejected it with an Accessibility-not-trusted
 *  error (cross-app injection requires the helper's own Accessibility grant). */
function isAccessibilityNotTrusted(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /not_trusted|Accessibility permission/i.test(message)
}

/**
 * A long-lived daemon reads `AXIsProcessTrusted()` and can cache it false from
 * before the user granted Accessibility — so injection keeps failing silently
 * even after the grant. On the FIRST `not_trusted` we restart the daemon once so
 * the next attempt (after the user grants via the card) respawns fresh and reads
 * the live grant. Guarded by `restartedDaemonForGrant` to avoid thrashing.
 */
function maybeRestartDaemonForGrant(err: unknown, restart: () => void): void {
  if (restartedDaemonForGrant) return
  if (!isAccessibilityNotTrusted(err)) return
  restartedDaemonForGrant = true
  restart()
}

// Canonical selector last requested for the cursor. The explicit action target,
// never the frontmost app, is the source of truth. overlayHide() makes
// isOverlayShown() false at turn end, so the next turn re-shows even when this
// key is unchanged.
let lastOverlayTargetKey: string | undefined

/**
 * Commands that visibly drive the screen. The daemon's animated cursor
 * overlay should be on-screen while these run, so we (idempotently) show the
 * overlay before dispatching one. Read-only commands (screenshot, displays,
 * apps, clipboard, permissions) don't trigger the overlay.
 */
const INJECTION_COMMANDS = new Set([
  // Legacy low-level verbs.
  'click', 'type', 'key', 'hold_key', 'scroll', 'drag',
  'move_mouse', 'mouse_down', 'mouse_up',
  // Codex contract verbs: get_app_state is each turn's opener (best place to
  // re-aim the cursor at the target app), and the index-action verbs so a
  // pure-fill turn (no coordinate click) still lights the overlay.
  'get_app_state', 'set_value', 'select_text', 'perform_secondary_action',
  'type_text', 'press_key',
])

function daemonRequiredError(command: string, cause?: unknown): Error {
  const detail = cause instanceof Error ? `: ${cause.message}` : ''
  return new Error(
    `native_daemon_required: ${command} requires the persistent macOS helper daemon${detail}`,
  )
}

type HelperFn = <R>(command: string, payload: Record<string, unknown>) => Promise<R>

function overlayTargetPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  if (Number.isSafeInteger(payload.pid) && (payload.pid as number) > 0) {
    return { pid: payload.pid }
  }
  if (typeof payload.bundleId === 'string' && payload.bundleId.trim()) {
    return { bundleId: payload.bundleId }
  }
  if (typeof payload.app === 'string' && payload.app.trim()) {
    return { app: payload.app }
  }
  return {}
}

/**
 * Platform-routed Computer Use helper call.
 *
 *   - macOS  → authenticated native `cu-helper` DAEMON only (animated virtual
 *              cursor overlay; no cursor steal). There is no
 *              stateless CLI fallback: the helper rejects direct one-shot
 *              screenshot, mutation, clipboard and app commands.
 *   - Windows → the Python helper (`win_helper.py`); the native engine is
 *              macOS-only.
 *
 * `deps` is injectable for unit tests only.
 */
export async function callHelper<T>(
  command: string,
  payload: Record<string, unknown> = {},
  deps: {
    platform?: NodeJS.Platform
    cuHelperAvailable?: () => boolean
    callDaemon?: HelperFn
    callPy?: HelperFn
    overlayShow?: (payload: Record<string, unknown>) => void
    isOverlayShown?: () => boolean
    callFrontmost?: () => Promise<{ bundleId?: string } | null>
    shutdownDaemon?: () => void
  } = {},
): Promise<T> {
  const platform = deps.platform ?? process.platform
  const available = deps.cuHelperAvailable ?? isCuHelperAvailable
  const viaDaemon = deps.callDaemon ?? (callDaemon as HelperFn)
  const viaPython = deps.callPy ?? (callPythonHelper as HelperFn)
  const showOverlay = deps.overlayShow ?? overlayShow
  const overlayIsShown = deps.isOverlayShown ?? isOverlayShown
  const restartDaemon = deps.shutdownDaemon ?? (() => void shutdownDaemon())

  if (platform === 'darwin') {
    if (!available()) {
      throw new Error(
        'native_helper_unavailable: cu-helper is required for Computer Use on macOS',
      )
    }

    if (INJECTION_COMMANDS.has(command)) {
      // The action's explicit selector is the only valid cursor target. This is
      // fire-and-forget so visual feedback stays off the mutation hot path;
      // cuHelperDaemon serializes show/hide and deduplicates the wire call.
      const overlayTarget = overlayTargetPayload(payload)
      const targetKey = JSON.stringify(overlayTarget)
      if (!overlayIsShown() || targetKey !== lastOverlayTargetKey) {
        lastOverlayTargetKey = targetKey
        void showOverlay(overlayTarget)
      }
    }
    try {
      const result = await viaDaemon<T>(command, payload)
      restartedDaemonForGrant = false
      return result
    } catch (err) {
      if (isDaemonUnavailable(err)) {
        logForDebugging(
          `cu-helper daemon unavailable; refusing one-shot fallback for ${command}: ${String(err)}`,
          { level: 'warn' },
        )
        throw daemonRequiredError(command, err)
      }
      maybeRestartDaemonForGrant(err, restartDaemon)
      throw err
    }
  }

  return viaPython<T>(command, payload)
}

/** Test hook: reset daemon routing, grant-restart, and overlay target state. */
export function __resetHelperBridgeState(): void {
  restartedDaemonForGrant = false
  lastOverlayTargetKey = undefined
}
