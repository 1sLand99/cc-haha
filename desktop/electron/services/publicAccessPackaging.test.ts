import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const manifest = require('../../package.json')
describe('ngrok native packaging', () => {
  it('ships and unpacks SDK native dependencies instead of bundling the loader', () => {
    expect(manifest.dependencies['@ngrok/ngrok']).toBeTruthy()
    expect(manifest.build.asarUnpack).toContain('node_modules/@ngrok/**')
    expect(manifest.build.files).toContain('node_modules/@ngrok/**')
    expect(manifest.scripts['build:electron']).toContain('--external @ngrok/ngrok')
    const sdkManifest = require('@ngrok/ngrok/package.json')
    for (const target of ['darwin-arm64', 'darwin-x64', 'win32-x64-msvc']) {
      expect(sdkManifest.optionalDependencies[`@ngrok/ngrok-${target}`]).toBeTruthy()
    }
  })
  it('loads the current host native addon without opening an ngrok session', () => {
    const sdk = require('@ngrok/ngrok')
    expect(typeof sdk.forward).toBe('function')
    expect(typeof sdk.disconnect).toBe('function')
  })
})
