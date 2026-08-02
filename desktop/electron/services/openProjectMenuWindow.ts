import type { BrowserWindowConstructorOptions, Rectangle } from 'electron'

import { ELECTRON_EVENT_CHANNELS } from '../ipc/channels'
import type {
  DesktopOpenProjectMenuInput,
  DesktopOpenProjectMenuState,
} from '../../src/lib/desktopHost/types'

export const OPEN_PROJECT_MENU_PANEL_WIDTH = 220
export const OPEN_PROJECT_MENU_ROW_HEIGHT = 48
const PANEL_VERTICAL_CHROME = 10
const WINDOW_PADDING = 16
const ANCHOR_GAP = 6
const READY_TIMEOUT_MS = 3_000

type ParentWindow = {
  getContentBounds(): Rectangle
}

type PopupWebContents = {
  id: number
  isDestroyed?(): boolean
  send(channel: string, payload: unknown): void
}

type PopupWindow = {
  webContents: PopupWebContents
  focus(): void
  hide(): void
  isDestroyed(): boolean
  on(event: 'blur' | 'closed', listener: () => void): void
  setBounds(bounds: Rectangle): void
  show(): void
}

export type OpenProjectMenuWindowControllerOptions = {
  createWindow(options: BrowserWindowConstructorOptions): PopupWindow
  getWorkArea(parent: ParentWindow): Rectangle
  load(window: PopupWindow): Promise<void>
  onCreated?(window: PopupWindow): void
  platform?: NodeJS.Platform
  preloadPath: string
}

export function openProjectMenuWindowOptions({
  parent,
  preload,
  platform = process.platform,
}: {
  parent: BrowserWindowConstructorOptions['parent']
  preload: string
  platform?: NodeJS.Platform
}): BrowserWindowConstructorOptions {
  return {
    parent,
    width: 1,
    height: 1,
    autoHideMenuBar: true,
    backgroundColor: '#00000000',
    frame: false,
    fullscreenable: false,
    hasShadow: false,
    maximizable: false,
    minimizable: false,
    movable: false,
    resizable: false,
    show: false,
    skipTaskbar: true,
    transparent: true,
    type: platform === 'darwin' ? 'panel' : undefined,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  }
}

export function openProjectMenuWindowBounds({
  anchor,
  contentBounds,
  itemCount,
  workArea,
  zoom,
}: {
  anchor: DesktopOpenProjectMenuInput['anchor']
  contentBounds: Rectangle
  itemCount: number
  workArea: Rectangle
  zoom: number
}): Rectangle {
  const scale = Math.min(2, Math.max(0.5, zoom))
  const padding = WINDOW_PADDING * scale
  const panelWidth = OPEN_PROJECT_MENU_PANEL_WIDTH * scale
  const panelHeight = (itemCount * OPEN_PROJECT_MENU_ROW_HEIGHT + PANEL_VERTICAL_CHROME) * scale
  const width = panelWidth + padding * 2
  const height = panelHeight + padding * 2

  const anchorLeft = contentBounds.x + anchor.x * scale
  const anchorTop = contentBounds.y + anchor.y * scale
  const anchorRight = anchorLeft + anchor.width * scale
  const anchorBottom = anchorTop + anchor.height * scale

  const preferredX = anchorRight - panelWidth - padding
  const preferredBelow = anchorBottom + ANCHOR_GAP * scale - padding
  const preferredAbove = anchorTop - ANCHOR_GAP * scale - panelHeight - padding
  const maxX = workArea.x + workArea.width - width
  const maxY = workArea.y + workArea.height - height

  const x = clamp(preferredX, workArea.x, maxX)
  const y = preferredBelow + height <= workArea.y + workArea.height
    ? preferredBelow
    : preferredAbove >= workArea.y
      ? preferredAbove
      : clamp(preferredBelow, workArea.y, maxY)

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  }
}

export class OpenProjectMenuWindowController {
  private readonly options: OpenProjectMenuWindowControllerOptions
  private window: PopupWindow | null = null
  private loadPromise: Promise<void> | null = null
  private state: DesktopOpenProjectMenuState | null = null
  private nextRequestId = 0
  private result: {
    requestId: number
    resolve(value: string | null): void
    reject(reason: unknown): void
  } | null = null
  private ready: {
    requestId: number
    resolve(): void
    reject(reason: unknown): void
    timeout: ReturnType<typeof setTimeout>
  } | null = null
  private readyRequestId: number | null = null
  private visible = false

  constructor(options: OpenProjectMenuWindowControllerOptions) {
    this.options = options
  }

  owns(window: PopupWindow | null | undefined): boolean {
    return !!window && window === this.window
  }

  ownsWebContentsId(id: number | undefined): boolean {
    return typeof id === 'number' && id === this.window?.webContents.id
  }

  getState(window: PopupWindow): DesktopOpenProjectMenuState | null {
    this.assertOwner(window)
    return this.state
  }

  async show(
    parent: ParentWindow & BrowserWindowConstructorOptions['parent'],
    input: DesktopOpenProjectMenuInput,
  ): Promise<string | null> {
    this.finish(null)
    const requestId = ++this.nextRequestId
    this.readyRequestId = null
    this.state = { requestId, targets: input.targets }
    const popup = this.ensureWindow(parent)
    const resultPromise = new Promise<string | null>((resolve, reject) => {
      this.result = { requestId, resolve, reject }
    })

    try {
      await this.loadPromise
      if (this.result?.requestId !== requestId) return await resultPromise

      popup.setBounds(openProjectMenuWindowBounds({
        anchor: input.anchor,
        contentBounds: parent.getContentBounds(),
        itemCount: input.targets.length,
        workArea: this.options.getWorkArea(parent),
        zoom: input.zoom,
      }))
      popup.webContents.send(ELECTRON_EVENT_CHANNELS.openProjectMenuState, this.state)
      await this.waitUntilReady(requestId)
      if (this.result?.requestId !== requestId) return await resultPromise

      this.visible = true
      popup.show()
      popup.focus()
      return await resultPromise
    } catch (error) {
      if (this.result?.requestId !== requestId) return await resultPromise
      if (this.result?.requestId === requestId) {
        this.result = null
        this.state = null
        this.visible = false
        popup.hide()
      }
      throw error
    }
  }

  markReady(window: PopupWindow, requestId: number): void {
    this.assertOwner(window)
    if (this.state?.requestId === requestId) this.readyRequestId = requestId
    if (this.ready?.requestId !== requestId) return
    clearTimeout(this.ready.timeout)
    const { resolve } = this.ready
    this.ready = null
    resolve()
  }

  select(window: PopupWindow, targetId: string): void {
    this.assertOwner(window)
    if (!this.state?.targets.some((target) => target.id === targetId)) {
      throw new Error('Unknown open-project target')
    }
    this.finish(targetId)
  }

  dismiss(window?: PopupWindow | null): void {
    if (window && !this.owns(window)) throw new Error('Open-project menu window does not own this request')
    this.finish(null)
  }

  private ensureWindow(parent: ParentWindow & BrowserWindowConstructorOptions['parent']): PopupWindow {
    if (this.window && !this.window.isDestroyed()) return this.window

    const popup = this.options.createWindow(openProjectMenuWindowOptions({
      parent,
      preload: this.options.preloadPath,
      platform: this.options.platform,
    }))
    this.window = popup
    popup.on('blur', () => {
      if (this.visible) this.finish(null)
    })
    popup.on('closed', () => {
      if (this.window !== popup) return
      this.rejectPending(new Error('Open-project menu window closed'))
      this.window = null
      this.loadPromise = null
    })
    this.options.onCreated?.(popup)
    this.loadPromise = this.options.load(popup)
    return popup
  }

  private waitUntilReady(requestId: number): Promise<void> {
    if (this.readyRequestId === requestId) return Promise.resolve()
    this.ready?.reject(new Error('Open-project menu state was replaced'))
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.ready?.requestId !== requestId) return
        this.ready = null
        reject(new Error('Open-project menu renderer did not become ready'))
      }, READY_TIMEOUT_MS)
      this.ready = { requestId, resolve, reject, timeout }
    })
  }

  private finish(value: string | null): void {
    const pending = this.result
    this.result = null
    this.state = null
    this.visible = false
    if (this.ready) {
      clearTimeout(this.ready.timeout)
      this.ready.reject(new Error('Open-project menu dismissed before it became ready'))
      this.ready = null
    }
    if (this.window && !this.window.isDestroyed()) this.window.hide()
    pending?.resolve(value)
  }

  private rejectPending(error: Error): void {
    const pending = this.result
    this.result = null
    this.state = null
    this.visible = false
    if (this.ready) {
      clearTimeout(this.ready.timeout)
      this.ready.reject(error)
      this.ready = null
    }
    pending?.reject(error)
  }

  private assertOwner(window: PopupWindow): void {
    if (!this.owns(window)) throw new Error('IPC sender is not the open-project menu window')
  }
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(max, Math.max(min, value))
}
