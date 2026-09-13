import { afterEach, expect, it, vi } from 'vitest'
import { remoteAccessApi, publicAccessApi } from './publicAccess'
import { api } from './client'
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('pairs at the current origin with cookies and no bearer or URL secret', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'phone', claimSecret: 'claim' }) })
  vi.stubGlobal('fetch', fetch)
  await remoteAccessApi.pair('secret', 'Phone')
  expect(fetch).toHaveBeenCalledWith('/api/public-access/pair', expect.objectContaining({
    credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: 'secret', name: 'Phone' }),
  }))
})
it('does not expose an upstream response body in errors', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, text: async () => 'sensitive upstream body' }))
  await expect(remoteAccessApi.session()).rejects.toThrow('Remote access request failed')
})
it('routes local device approval through authenticated local API', async () => {
  const post = vi.spyOn(api, 'post').mockResolvedValue({})
  await publicAccessApi.approve('phone')
  expect(post).toHaveBeenCalledWith('/api/public-access/approve', { id: 'phone' })
})
