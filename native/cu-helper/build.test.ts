import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const buildScript = path.resolve(import.meta.dirname, 'build.sh')
const productIcon = path.resolve(import.meta.dirname, '../../desktop/src-tauri/icons/icon.icns')
const fixtureDirectories: string[] = []

afterEach(() => {
  for (const directory of fixtureDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function wrapFixtureApp(missingIcon = false) {
  const directory = mkdtempSync(path.join(tmpdir(), 'cu-helper-app-icon-'))
  fixtureDirectories.push(directory)
  writeFileSync(path.join(directory, 'fixture-binary'), 'fixture executable')

  const result = Bun.spawnSync([
    'bash',
    '-c',
    `
source "$1"
TEST_BUNDLE_DIR="$2"
BUILD_DIR="$TEST_BUNDLE_DIR/build"
BIN_PATH="$TEST_BUNDLE_DIR/fixture-binary"
APP_PATH="$TEST_BUNDLE_DIR/cc-haha-computer-use.app"
BUNDLE_ID="dev.cchaha.cu-helper"
SIGN_IDENTITY="fixture-only"
RESOLVED_TIMESTAMP_MODE="none"
if [ "$3" = "missing" ]; then
  APP_ICON_PATH="$TEST_BUNDLE_DIR/missing.icns"
fi
codesign() {
  case "$1" in
    --force) cp -R "$APP_PATH/Contents" "$TEST_BUNDLE_DIR/contents-at-sign" ;;
    -dv) printf 'Identifier=%s\\n' "$BUNDLE_ID" ;;
  esac
}
wrap_app
`,
    'cu-helper-app-icon-test',
    buildScript,
    directory,
    missingIcon ? 'missing' : 'present',
  ], { cwd: directory })

  return {
    directory,
    contents: path.join(directory, 'cc-haha-computer-use.app', 'Contents'),
    exitCode: result.exitCode,
    stderr: result.stderr.toString(),
  }
}

function resolveTimestampArgument(identity: string, mode = 'auto') {
  const result = Bun.spawnSync([
    'bash',
    '-c',
    [
      'source "$1"',
      'SIGN_IDENTITY="$2"',
      'CU_HELPER_TIMESTAMP_MODE="$3"',
      'resolve_timestamp_mode',
      'printf "%s" "$CODESIGN_TIMESTAMP_ARG"',
    ].join('; '),
    'cu-helper-build-test',
    buildScript,
    identity,
    mode,
  ])

  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString() || `build.sh probe exited ${result.exitCode}`)
  }
  return result.stdout.toString()
}

function resolveIdentityWithOnlyDeveloperId() {
  const result = Bun.spawnSync([
    'bash',
    '-c',
    [
      'source "$1"',
      'first_apple_development_identity() { return 1; }',
      'first_developer_id_application_identity() { printf "%s" "Developer ID Application: Example Corp (TEAM123456)"; }',
      'resolve_identity',
      'printf "%s" "$SIGN_IDENTITY"',
    ].join('; '),
    'cu-helper-build-test',
    buildScript,
  ])

  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  }
}

describe('cu-helper build signing timestamp', () => {
  test('uses a secure timestamp for Developer ID distribution signatures', () => {
    expect(
      resolveTimestampArgument('Developer ID Application: Example Corp (TEAM123456)'),
    ).toBe('--timestamp')
  })

  test('keeps local Apple Development builds offline by default', () => {
    expect(
      resolveTimestampArgument('Apple Development: Developer (TEAM123456)'),
    ).toBe('--timestamp=none')
  })

  test('allows CI to require a secure timestamp explicitly', () => {
    expect(resolveTimestampArgument('0123456789ABCDEF', 'secure')).toBe('--timestamp')
  })
})

describe('cu-helper build signing identity', () => {
  test('falls through to Developer ID when no Apple Development identity exists', () => {
    const result = resolveIdentityWithOnlyDeveloperId()

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('Developer ID Application: Example Corp (TEAM123456)')
  })
})

describe.skipIf(process.platform !== 'darwin')('cu-helper permission-list app icon', () => {
  test('declares and bundles the product icon before signing the helper app', () => {
    const result = wrapFixtureApp()
    expect(result.exitCode).toBe(0)

    const plist = Bun.spawnSync([
      '/usr/bin/plutil', '-convert', 'json', '-o', '-',
      path.join(result.contents, 'Info.plist'),
    ])
    expect(plist.exitCode).toBe(0)
    const info = JSON.parse(plist.stdout.toString())
    expect(info.CFBundleIdentifier).toBe('dev.cchaha.cu-helper')
    expect(info.CFBundleExecutable).toBe('cc-haha-computer-use')
    expect(info.CFBundleIconFile).toBe('icon.icns')

    const expectedIcon = readFileSync(productIcon)
    expect(expectedIcon.subarray(0, 4).toString()).toBe('icns')
    expect(readFileSync(path.join(result.contents, 'Resources', info.CFBundleIconFile)))
      .toEqual(expectedIcon)
    expect(readFileSync(path.join(result.directory, 'contents-at-sign', 'Resources', info.CFBundleIconFile)))
      .toEqual(expectedIcon)
  })

  test('refuses to sign an app when the required product icon is missing', () => {
    const result = wrapFixtureApp(true)

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('App icon not found')
    expect(existsSync(path.join(result.directory, 'contents-at-sign'))).toBe(false)
  })
})
