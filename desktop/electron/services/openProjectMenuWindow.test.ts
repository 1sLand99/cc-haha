import { describe, expect, it, vi } from 'vitest'

import {
  OPEN_PROJECT_MENU_PANEL_WIDTH,
  OpenProjectMenuWindowController,
  openProjectMenuWindowBounds,
  openProjectMenuWindowOptions,
} from './openProjectMenuWindow'

const input = {
  anchor: { x: 700, y: 10, width: 50, height: 32 },
  targets: [
    { id: 'vscode', kind: 'ide' as const, label: 'VS Code', icon: 'vscode', platform: 'darwin' },
    { id: 'finder', kind: 'file_manager' as const, label: 'Finder', icon: 'finder', platform: 'darwin' },
  ],
  zoom: 1,
}

describe('open project menu native window', () => {
  it('creates a transparent child window above the parent', () => {
    const parent = { id: 'parent' }

    expect(openProjectMenuWindowOptions({
      parent: parent as never,
      preload: '/app/open-project-menu-preload.cjs',
      platform: 'darwin',
    })).toMatchObject({
      parent,
      width: 1,
      height: 1,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      hasShadow: false,
      show: false,
      type: 'panel',
      webPreferences: {
        preload: '/app/open-project-menu-preload.cjs',
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
  })

  it('aligns the reused React panel to the trigger while leaving room for its shadow', () => {
    expect(openProjectMenuWindowBounds({
      anchor: { x: 1200, y: 10, width: 50, height: 32 },
      contentBounds: { x: 100, y: 50, width: 1400, height: 900 },
      itemCount: 7,
      workArea: { x: 0, y: 0, width: 1600, height: 1000 },
      zoom: 1,
    })).toEqual({
      x: 1114,
      y: 82,
      width: OPEN_PROJECT_MENU_PANEL_WIDTH + 32,
      height: 378,
    })
  })

  it('flips above the trigger when the native window would leave the work area', () => {
    const bounds = openProjectMenuWindowBounds({
      anchor: { x: 700, y: 710, width: 50, height: 32 },
      contentBounds: { x: 0, y: 0, width: 1000, height: 800 },
      itemCount: 7,
      workArea: { x: 0, y: 0, width: 1000, height: 800 },
      zoom: 1,
    })

    expect(bounds.x).toBe(514)
    expect(bounds.y).toBe(342)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(800)
  })

  it('scales the window and anchor geometry with the app zoom', () => {
    const bounds = openProjectMenuWindowBounds({
      anchor: { x: 400, y: 10, width: 25, height: 16 },
      contentBounds: { x: 100, y: 50, width: 1400, height: 900 },
      itemCount: 2,
      workArea: { x: 0, y: 0, width: 1600, height: 1000 },
      zoom: 2,
    })

    expect(bounds).toEqual({
      x: 478,
      y: 82,
      width: 504,
      height: 276,
    })
  })

  it('shows only after the shared renderer reports ready and resolves the selected target', async () => {
    const popup = new FakePopupWindow()
    const controller = createController(popup)
    const parent = { getContentBounds: () => ({ x: 0, y: 0, width: 1000, height: 800 }) }

    const selection = controller.show(parent as never, input)
    await vi.waitFor(() => expect(popup.webContents.send).toHaveBeenCalled())
    const state = controller.getState(popup as never)
    expect(state?.targets).toEqual(input.targets)
    expect(popup.show).not.toHaveBeenCalled()

    controller.markReady(popup as never, state!.requestId)
    await vi.waitFor(() => expect(popup.show).toHaveBeenCalledTimes(1))
    controller.select(popup as never, 'finder')

    await expect(selection).resolves.toBe('finder')
    expect(popup.hide).toHaveBeenCalled()
  })

  it('dismisses the pending menu when the native popup loses focus', async () => {
    const popup = new FakePopupWindow()
    const controller = createController(popup)
    const parent = { getContentBounds: () => ({ x: 0, y: 0, width: 1000, height: 800 }) }

    const selection = controller.show(parent as never, input)
    await vi.waitFor(() => expect(popup.webContents.send).toHaveBeenCalled())
    const state = controller.getState(popup as never)
    controller.markReady(popup as never, state!.requestId)
    await vi.waitFor(() => expect(popup.show).toHaveBeenCalled())
    popup.emit('blur')

    await expect(selection).resolves.toBeNull()
  })
})

function createController(popup: FakePopupWindow) {
  return new OpenProjectMenuWindowController({
    createWindow: () => popup as never,
    getWorkArea: () => ({ x: 0, y: 0, width: 1000, height: 800 }),
    load: async () => {},
    platform: 'darwin',
    preloadPath: '/app/open-project-menu-preload.cjs',
  })
}

class FakePopupWindow {
  readonly listeners = new Map<string, Array<() => void>>()
  readonly webContents = {
    id: 42,
    send: vi.fn(),
  }
  readonly focus = vi.fn()
  readonly hide = vi.fn()
  readonly setBounds = vi.fn()
  readonly show = vi.fn()
  isDestroyed() { return false }
  on(event: string, listener: () => void) {
    const listeners = this.listeners.get(event) ?? []
    listeners.push(listener)
    this.listeners.set(event, listeners)
  }
  emit(event: string) {
    for (const listener of this.listeners.get(event) ?? []) listener()
  }
}
