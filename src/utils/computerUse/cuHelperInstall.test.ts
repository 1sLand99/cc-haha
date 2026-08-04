import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import path from 'node:path'
import {
  __resetInstalledHelperCache,
  ensureInstalledHelper,
  installedHelperAppBundle,
  installedHelperRoot,
  isNestedInHostApp,
} from './cuHelperInstall.js'

afterEach(() => __resetInstalledHelperCache())

const INNER = path.join('Contents', 'MacOS', 'cc-haha-computer-use')

describe('isNestedInHostApp', () => {
  test('true when the helper .app sits inside an OUTER .app (packaged in the host)', () => {
    const nested =
      '/Applications/Claude Code Haha.app/Contents/Resources/app.asar.unpacked/src-tauri/binaries/cc-haha-computer-use.app'
    expect(isNestedInHostApp(nested)).toBe(true)
  })

  test('false for a standalone path (dev build or the installed copy)', () => {
    expect(
      isNestedInHostApp('/Users/x/proj/native/cu-helper/.build/release/cc-haha-computer-use.app'),
    ).toBe(false)
    expect(isNestedInHostApp('/Users/x/.claude/cu-helper/cc-haha-computer-use.app')).toBe(false)
  })
})

describe('installedHelperAppBundle / installedHelperRoot', () => {
  test('derive <configHome>/cu-helper[/cc-haha-computer-use.app]', () => {
    expect(installedHelperRoot('/home/.claude')).toBe('/home/.claude/cu-helper')
    expect(installedHelperAppBundle('/home/.claude')).toBe(
      '/home/.claude/cu-helper/cc-haha-computer-use.app',
    )
  })
})

describe('standalone helper copy command', () => {
  test('uses the trusted system cp binary instead of PATH lookup', async () => {
    const { __copyAppCommandForTests } = await import('./cuHelperInstall.js')
    expect(__copyAppCommandForTests('/source/helper.app', '/dest/helper.app')).toEqual({
      command: '/bin/cp',
      args: ['-R', '/source/helper.app', '/dest/helper.app'],
    })
  })
})

describe('ensureInstalledHelper', () => {
  const CONFIG = '/cfg'
  const DEST_APP = path.join(CONFIG, 'cu-helper', 'cc-haha-computer-use.app')
  const DEST_INNER = path.join(DEST_APP, INNER)
  const NESTED =
    '/Applications/Claude Code Haha.app/Contents/Resources/app.asar.unpacked/src-tauri/binaries/cc-haha-computer-use.app'
  const STANDALONE = '/dev/native/cu-helper/.build/release/cc-haha-computer-use.app'
  const BYTES = Buffer.from('helper-binary-v1')
  const HASH = createHash('sha256')
    .update(INNER).update('\0').update(BYTES).update('\0')
    .update(path.join('Contents', 'Info.plist')).update('\0').update(BYTES).update('\0')
    .update(path.join('Contents', '_CodeSignature', 'CodeResources')).update('\0').update(BYTES).update('\0')
    .digest('hex')

  /** Minimal in-memory FS over the injectable deps so the install logic runs
   *  without touching disk. `cp` flips dest into existence; `rm` clears it. */
  function fakeFs(initial: {
    destExists?: boolean
    marker?: string | null
    failCopy?: boolean
    destBytes?: Buffer
    copyCorrupt?: boolean
    signatureValid?: boolean
    copiedSignatureValid?: boolean
  } = {}) {
    const state = {
      destExists: initial.destExists ?? false,
      marker: (initial.marker ?? null) as string | null,
      destBytes: initial.destBytes ?? BYTES,
      signatureValid: initial.signatureValid ?? true,
      ops: [] as string[],
    }
    return {
      state,
      deps: {
        sourceApp: NESTED,
        configHome: CONFIG,
        exists: (p: string) => (p === DEST_INNER ? state.destExists : false),
        readFileBytes: (p: string) => p.startsWith(DEST_APP)
          ? state.destBytes
          : BYTES,
        readMarker: () => state.marker,
        copyApp: (_src: string, _dest: string) => {
          if (initial.failCopy) throw new Error('cp -R failed')
          state.ops.push('cp')
          state.destExists = true
          state.destBytes = initial.copyCorrupt ? Buffer.from('corrupt') : BYTES
          state.signatureValid = initial.copiedSignatureValid ?? true
        },
        verifyPackagedSignatures: () => {
          state.ops.push('verify-signature')
          return state.signatureValid
        },
        writeMarker: (_p: string, v: string) => {
          state.ops.push('marker')
          state.marker = v
        },
        rm: (p: string) => {
          state.ops.push('rm')
          if (p === DEST_APP) state.destExists = false
        },
        mkdir: () => state.ops.push('mkdir'),
      },
    }
  }

  test('returns null when no source .app resolves', () => {
    expect(ensureInstalledHelper({ sourceApp: null })).toBeNull()
  })

  test('standalone (dev) source is used IN PLACE — no copy', () => {
    let copied = false
    const r = ensureInstalledHelper({
      sourceApp: STANDALONE,
      configHome: CONFIG,
      copyApp: () => {
        copied = true
      },
    })
    expect(copied).toBe(false)
    expect(r).toEqual({ appBundle: STANDALONE, binary: path.join(STANDALONE, INNER) })
  })

  test('nested source + dest missing → copies, writes the hash marker, returns the installed path', () => {
    const { state, deps } = fakeFs({ destExists: false })
    const r = ensureInstalledHelper(deps)
    expect(state.ops).toContain('cp')
    expect(state.marker).toBe(HASH)
    expect(r).toEqual({ appBundle: DEST_APP, binary: DEST_INNER })
  })

  test('nested source + dest present + marker matches → NO copy (idempotent)', () => {
    const { state, deps } = fakeFs({ destExists: true, marker: HASH })
    const r = ensureInstalledHelper(deps)
    expect(state.ops).not.toContain('cp')
    expect(state.ops.filter(op => op === 'verify-signature')).toHaveLength(1)
    expect(r).toEqual({ appBundle: DEST_APP, binary: DEST_INNER })
  })

  test('matching marker does not hide destination bundle corruption', () => {
    const { state, deps } = fakeFs({
      destExists: true,
      marker: HASH,
      destBytes: Buffer.from('corrupt'),
    })
    const r = ensureInstalledHelper(deps)
    expect(state.ops).toContain('cp')
    expect(r).toEqual({ appBundle: DEST_APP, binary: DEST_INNER })
  })

  test('re-verifies and repairs a replaced destination on every launch', () => {
    const { state, deps } = fakeFs({ destExists: true, marker: HASH })
    expect(ensureInstalledHelper(deps)).toEqual({ appBundle: DEST_APP, binary: DEST_INNER })

    state.destBytes = Buffer.from('attacker-replacement')
    expect(ensureInstalledHelper(deps)).toEqual({ appBundle: DEST_APP, binary: DEST_INNER })
    expect(state.ops.filter(op => op === 'cp')).toHaveLength(1)
  })

  test('re-copies a byte-identical destination whose code signature no longer validates', () => {
    const { state, deps } = fakeFs({
      destExists: true,
      marker: HASH,
      signatureValid: false,
      copiedSignatureValid: true,
    })
    expect(ensureInstalledHelper(deps)).toEqual({ appBundle: DEST_APP, binary: DEST_INNER })
    expect(state.ops).toContain('cp')
    expect(state.ops.filter(op => op === 'verify-signature').length).toBeGreaterThanOrEqual(2)
  })

  test('nested source + dest present + marker STALE → re-copies (version refresh)', () => {
    const { state, deps } = fakeFs({ destExists: true, marker: 'an-old-hash' })
    const r = ensureInstalledHelper(deps)
    expect(state.ops).toContain('cp')
    expect(state.marker).toBe(HASH)
    expect(r).toEqual({ appBundle: DEST_APP, binary: DEST_INNER })
  })

  test('copy failure → fails closed instead of launching a nested TCC subject', () => {
    const { deps } = fakeFs({ destExists: false, failCopy: true })
    const r = ensureInstalledHelper(deps)
    expect(r).toBeNull()
  })

  test('a byte-mismatched copied bundle fails closed', () => {
    const { deps } = fakeFs({ destExists: false, copyCorrupt: true })
    expect(ensureInstalledHelper(deps)).toBeNull()
  })

  test('a copied bundle with a mismatched signer fails closed', () => {
    const { state, deps } = fakeFs({
      destExists: false,
      copiedSignatureValid: false,
    })
    expect(ensureInstalledHelper(deps)).toBeNull()
    expect(state.marker).toBeNull()
  })
})
