import { contextBridge, ipcRenderer } from 'electron'

import {
  isElectronIpcChannelAllowedForOpenProjectMenuWindow,
  validateElectronIpcPayload,
} from './ipc/capabilities'
import {
  ELECTRON_EVENT_CHANNELS,
  ELECTRON_IPC_CHANNELS,
  type ElectronIpcChannel,
} from './ipc/channels'
import type {
  DesktopHost,
  DesktopOpenProjectMenuInput,
  DesktopOpenProjectMenuState,
} from '../src/lib/desktopHost/types'
import type { Locale } from '../src/i18n/locale'

function invoke<T>(channel: ElectronIpcChannel, payload?: unknown): Promise<T> {
  if (!isElectronIpcChannelAllowedForOpenProjectMenuWindow(channel)) {
    return Promise.reject(new Error(`Electron IPC channel ${channel} is not available to the open-project menu`))
  }
  if (!validateElectronIpcPayload(channel, payload)) {
    return Promise.reject(new Error(`Invalid Electron IPC payload for ${channel}`))
  }
  return ipcRenderer.invoke(channel, payload) as Promise<T>
}

const openProjectMenuHost = {
  kind: 'electron',
  isDesktop: true,
  capabilities: {
    appMode: false,
    clipboard: false,
    dialogs: false,
    notifications: false,
    previewWebview: false,
    shell: false,
    terminal: false,
    updates: false,
    windowControls: false,
    zoom: true,
  },
  app: {
    getLocalePreference: () => invoke<Locale | null>(ELECTRON_IPC_CHANNELS.appGetLocalePreference),
    getPreferredSystemLanguages: () => invoke<string[]>(ELECTRON_IPC_CHANNELS.appGetPreferredSystemLanguages),
    onLocaleChanged: (handler: (locale: Locale) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, locale: Locale) => handler(locale)
      ipcRenderer.on(ELECTRON_EVENT_CHANNELS.appLocaleChanged, listener)
      return Promise.resolve(() => ipcRenderer.removeListener(ELECTRON_EVENT_CHANNELS.appLocaleChanged, listener))
    },
  },
  openProjectMenu: {
    show: (_input: DesktopOpenProjectMenuInput) => Promise.reject(new Error('Nested open-project menus are unavailable')),
    getState: () => invoke<DesktopOpenProjectMenuState | null>(ELECTRON_IPC_CHANNELS.openProjectMenuGetState),
    select: (targetId: string) => invoke<void>(ELECTRON_IPC_CHANNELS.openProjectMenuSelect, targetId),
    dismiss: () => invoke<void>(ELECTRON_IPC_CHANNELS.openProjectMenuDismiss),
    ready: (requestId: number) => invoke<void>(ELECTRON_IPC_CHANNELS.openProjectMenuReady, requestId),
    onState: (handler: (state: DesktopOpenProjectMenuState) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: DesktopOpenProjectMenuState) => handler(state)
      ipcRenderer.on(ELECTRON_EVENT_CHANNELS.openProjectMenuState, listener)
      return Promise.resolve(() => ipcRenderer.removeListener(ELECTRON_EVENT_CHANNELS.openProjectMenuState, listener))
    },
  },
  zoom: {
    set: (level: number) => invoke<void>(ELECTRON_IPC_CHANNELS.zoomSet, level),
  },
  appearance: {
    setApplied: () => Promise.resolve(),
  },
} as unknown as DesktopHost

contextBridge.exposeInMainWorld('desktopHost', openProjectMenuHost)
