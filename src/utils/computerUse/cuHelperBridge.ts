import { existsSync } from 'node:fs'
import path from 'node:path'
import { execFileNoThrow } from '../execFileNoThrow.js'
import { ensureInstalledHelper, isNestedInHostApp } from './cuHelperInstall.js'
import { getRuntimePaths } from './pythonBridge.js'

/**
 * Native macOS Computer Use helper (`cu-helper`) bridge.
 *
 * `cu-helper` is the Swift engine that replaces the Python helper on macOS:
 * it injects mouse/keyboard via `CGEventPostToPid` (so the user's real cursor
 * is never stolen) and captures via ScreenCaptureKit. Its CLI mode speaks the
 * EXACT same wire contract as the Python helper —
 *     cu-helper <command> --payload '<json>'  ->  stdout {ok, result?, error?}
 * — so it is a drop-in swap behind `callHelper` (see helperBridge.ts).
 *
 * This module only knows how to LOCATE and CALL the binary; the platform
 * routing (macOS → here, Windows → Python) lives in helperBridge.ts.
 */

/** Env override for the binary path (custom installs / tests). */
const ENV_OVERRIDE = 'CC_HAHA_CU_HELPER_PATH'

let cachedBinary: string | null | undefined

/**
 * Resolve the `cu-helper` binary path, or `null` if it isn't built/shipped.
 * Order: explicit env override → dev SwiftPM build output → bundled sidecar.
 * The result is cached; call `__resetCuHelperCache()` in tests to clear it.
 */
export function resolveCuHelperBinary(
  exists: (p: string) => boolean = existsSync,
): string | null {
  if (cachedBinary !== undefined) return cachedBinary
  cachedBinary = resolveUncached(exists)
  return cachedBinary
}

function resolveUncached(exists: (p: string) => boolean): string | null {
  const appRoot = process.env.CLAUDE_APP_ROOT
  const isPackaged = appRoot?.includes('.asar') === true

  // This override is a development/test seam, never a packaged-app input.
  // The desktop host also strips it before spawning the signed sidecar, but
  // enforcing the boundary here prevents alternate packaged launch paths from
  // turning an inherited environment variable into arbitrary code execution.
  if (!isPackaged) {
    const override = process.env[ENV_OVERRIDE]
    if (override && exists(override)) return override
  }

  const { projectRoot } = getRuntimePaths()
  const candidates: string[] = []
  if (!isPackaged) {
    // dev: `native/cu-helper/build.sh` release output. cu-helper ships as a
    // real .app bundle because Screen Recording requires that stable subject.
    candidates.push(path.join(
      projectRoot, 'native', 'cu-helper', '.build', 'release',
      'cc-haha-computer-use.app', 'Contents', 'MacOS', 'cc-haha-computer-use',
    ))
  }

  // bundled: in a packaged Electron app this resolver runs inside the spawned
  // `claude-sidecar` bun binary, which receives `--app-root <appRoot>` and
  // exports it as CLAUDE_APP_ROOT (see desktop/sidecars/claude-sidecar.ts).
  // On packaged macOS that path is `.../Contents/Resources/app.asar`, while the
  // unpacked native binaries live under `.../app.asar.unpacked/src-tauri/binaries`
  // (build-sidecars.ts drops `cu-helper` there and electron-builder asarUnpacks
  // `src-tauri/binaries/**`). Mirror src/server/staticH5.ts's `.asar` → `.asar.unpacked`
  // transform exactly to reach it.
  if (appRoot) {
    const unpacked = appRoot.includes('.asar')
      ? appRoot.replace(/\.asar(?=$|[/\\])/, '.asar.unpacked')
      : appRoot
    candidates.push(path.join(
      unpacked, 'src-tauri', 'binaries',
      'cc-haha-computer-use.app', 'Contents', 'MacOS', 'cc-haha-computer-use',
    ))
  }

  for (const candidate of candidates) {
    if (exists(candidate)) return candidate
  }
  return null
}

/**
 * Resolve the cu-helper `.app` BUNDLE directory (e.g. `…/cc-haha-computer-use.app`),
 * derived from the resolved inner executable. This is the SOURCE bundle (dev build
 * or the one packaged inside the host app).
 *
 * IMPORTANT (corrected Screen Recording model — proven by tccd logs): macOS keys
 * the SR TCC *subject* to the OUTERMOST `.app` on the running binary's path. When
 * packaged, this source bundle is NESTED inside the host Electron app
 * (…/app.asar.unpacked/…), so its SR subject is the HOST — granting the helper
 * does nothing. `ensureInstalledHelper()` (cuHelperInstall.ts) therefore relocates
 * this source OUT to a standalone path and the daemon/CLI/card launch from THERE,
 * where the helper is its own SR subject. (Launching via `open -n` makes the
 * process its own TCC *responsible* process, but SR looks at the *subject*, not
 * the responsible process — that distinction is what earlier fixes got wrong.)
 *
 * Returns `null` when the resolved binary is not inside a `cc-haha-computer-use.app`
 * (e.g. a bare-path test override) — callers then fall back to the CLI path.
 */
export function resolveCuHelperAppBundle(
  exists: (p: string) => boolean = existsSync,
): string | null {
  const inner = resolveCuHelperBinary(exists)
  if (!inner) return null
  const appName = 'cc-haha-computer-use.app'
  const marker = `${path.sep}${appName}${path.sep}`
  const idx = inner.indexOf(marker)
  if (idx < 0) return null
  return inner.slice(0, idx + path.sep.length + appName.length)
}

/** True only on macOS AND when the native binary is actually present. */
export function isCuHelperAvailable(): boolean {
  return process.platform === 'darwin' && resolveCuHelperBinary() !== null
}

/**
 * Invoke one `cu-helper` CLI command. Mirrors `callPythonHelper`'s parsing of
 * the `{ ok, result?, error? }` envelope exactly, so callers can't tell which
 * engine ran the command.
 */
export async function callCuHelper<T>(
  command: string,
  payload: Record<string, unknown> = {},
  exec: typeof execFileNoThrow = execFileNoThrow,
): Promise<T> {
  // Prefer the STANDALONE-INSTALLED helper (same path the daemon + card use) so a
  // CLI-fallback screenshot's Screen Recording subject is the helper, not the
  // host. A nested packaged source must never be the fallback: installation may
  // have failed because its bytes/signer did not match, and launching it would
  // also re-attribute Screen Recording to the outer Electron app. Bare dev/test
  // overrides remain valid because they have no nested `.app` source bundle.
  const installed = ensureInstalledHelper()
  let bin = installed?.binary ?? null
  if (!bin) {
    const sourceApp = resolveCuHelperAppBundle()
    if (sourceApp && isNestedInHostApp(sourceApp)) {
      throw new Error(
        'cu-helper standalone installation failed; refusing packaged nested source',
      )
    }
    bin = resolveCuHelperBinary()
  }
  if (!bin) {
    throw new Error(
      'cu-helper binary not found. Build it: native/cu-helper/build.sh',
    )
  }

  const { code, stdout, stderr } = await exec(
    bin,
    [command, '--payload', JSON.stringify(payload)],
    { useCwd: false },
  )

  if (code !== 0 && !stdout.trim()) {
    throw new Error(stderr || `cu-helper ${command} failed with code ${code}`)
  }

  let parsed: { ok: boolean; result?: T; error?: { message?: string } }
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw new Error(stderr || stdout || `cu-helper ${command} returned invalid JSON`)
  }

  if (!parsed.ok) {
    throw new Error(parsed.error?.message || `cu-helper ${command} failed`)
  }

  return parsed.result as T
}

/** Test hook: clear the cached binary-path resolution. */
export function __resetCuHelperCache(): void {
  cachedBinary = undefined
}
