import { api } from './client'

export type NonEssentialTrafficSettings = {
  /** true = 禁用非必要外部流量（默认开启） */
  disabled: boolean
}

export const privacyApi = {
  getNonEssentialTrafficSettings() {
    return api.get<NonEssentialTrafficSettings>('/api/privacy/non-essential-traffic')
  },

  updateNonEssentialTrafficSettings(disabled: boolean) {
    return api.put<NonEssentialTrafficSettings>('/api/privacy/non-essential-traffic', {
      disabled,
    })
  },
}
