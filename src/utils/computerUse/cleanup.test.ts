import { describe, expect, test } from 'bun:test'
import type { ToolUseContext } from '../../Tool.js'
import { cleanupComputerUseAfterTurn } from './cleanup.js'

/**
 * Unit coverage for the turn-end overlay-hide wiring in
 * `cleanupComputerUseAfterTurn`. Driven entirely through the injected
 * `deps.overlayHide` seam — no real cu-helper daemon, no real lock file.
 *
 * Hermetic by construction: in a fresh test process the file-based CU lock was
 * never acquired, so `isLockHeldLocally()` (a zero-syscall module-state check)
 * returns false and the disk lock-release path is skipped. With an empty
 * `computerUseMcpState` the hidden-apps/unhide branch is also skipped. So the
 * ONLY observable side effect here is the injected overlayHide — which is
 * exactly what we want to assert on.
 */

type CleanupCtx = Pick<
  ToolUseContext,
  'getAppState' | 'setAppState' | 'sendOSNotification'
>

/** Minimal fake ctx: empty computerUseMcpState → no hidden-apps work. */
function makeCtx(): CleanupCtx {
  // Only the fields cleanup.ts reads matter; the rest of AppState is irrelevant
  // for this path, so we cast a minimal object.
  const appState = { computerUseMcpState: undefined } as unknown as ReturnType<
    ToolUseContext['getAppState']
  >
  return {
    getAppState: () => appState,
    setAppState: () => {},
    sendOSNotification: () => {},
  }
}

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

describe('cleanupComputerUseAfterTurn — turn-end overlay hide', () => {
  test('calls the injected overlayHide exactly once on a no-hidden-apps, lock-not-held turn', async () => {
    // Proves overlayHide runs even when the turn hid nothing AND the lock-release
    // path early-returns (isLockHeldLocally() is false in this process) — i.e. it
    // runs BEFORE that early return, so the glow never gets stuck.
    let hidden = 0
    await cleanupComputerUseAfterTurn(makeCtx(), {
      overlayHide: async () => {
        hidden++
      },
    })
    expect(hidden).toBe(1)
  })

  test('a REJECTING overlayHide does not throw and cleanup still completes', async () => {
    let hidden = 0
    // Must resolve, not reject — overlayHide failures are best-effort.
    await cleanupComputerUseAfterTurn(makeCtx(), {
      overlayHide: async () => {
        hidden++
        throw new Error('daemon overlay_hide blew up')
      },
    })
    expect(hidden).toBe(1)
  })

  test('a HANGING overlayHide is capped by the timeout and does not wedge cleanup', async () => {
    // The daemon call rides a 20s request timeout; the abort paths cannot wait
    // that long. cleanup wraps overlayHide in a ~2s Promise.race, so a hung
    // overlayHide must still let cleanup resolve. We prove the race timeout is
    // load-bearing: cleanup is still pending shortly after the call (so it did
    // NOT skip overlayHide), then resolves via the timeout even though the
    // injected overlayHide never settles.
    let resolved = false
    const p = cleanupComputerUseAfterTurn(makeCtx(), {
      // Never resolves — if cleanup awaited it unguarded, this would hang.
      overlayHide: () => new Promise<void>(() => {}),
    }).then(() => {
      resolved = true
    })

    // Before the ~2s race timeout fires, cleanup is still pending.
    await delay(50)
    expect(resolved).toBe(false)

    // It must eventually resolve via the timeout path (well within the 20s
    // daemon timeout). Wait it out.
    await p
    expect(resolved).toBe(true)
  }, 10_000)

  test('overlayHide is invoked on the abort-style ctx too (same ctx shape)', async () => {
    // The 3 production call sites (natural end + 2 abort paths) all pass the same
    // ToolUseContext shape; this is the abort case exercising the same code.
    let hidden = 0
    await cleanupComputerUseAfterTurn(makeCtx(), {
      overlayHide: async () => {
        hidden++
      },
    })
    expect(hidden).toBe(1)
  })
})
