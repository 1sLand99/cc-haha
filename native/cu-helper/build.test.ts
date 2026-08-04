import { describe, expect, test } from 'bun:test'
import path from 'node:path'

const buildScript = path.resolve(import.meta.dirname, 'build.sh')

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
