import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceBrowserEvent } from '../../src/lib/desktopHost/types'
import {
  ElectronWorkspaceBrowserService,
  WORKSPACE_BROWSER_PARTITION,
  workspaceBrowserPdfFilename,
  type WorkspaceBrowserDownloadItemLike,
  type WorkspaceBrowserSessionLike,
  type WorkspaceBrowserViewLike,
  type WorkspaceBrowserWebContentsLike,
} from './workspaceBrowser'

type AnyHandler = (...args: never[]) => void

class FakeSession implements WorkspaceBrowserSessionLike {
  downloadHandlers: Array<
    (event: unknown, item: WorkspaceBrowserDownloadItemLike, webContents: unknown) => void
  > = []

  on(
    _event: 'will-download',
    handler: (event: unknown, item: WorkspaceBrowserDownloadItemLike, webContents: unknown) => void,
  ) {
    this.downloadHandlers.push(handler)
    return this
  }

  startDownload(item: WorkspaceBrowserDownloadItemLike, webContents: unknown) {
    for (const handler of this.downloadHandlers) handler({}, item, webContents)
  }
}

class FakeDownloadItem implements WorkspaceBrowserDownloadItemLike {
  received = 0
  state = 'progressing'
  private handlers = new Map<string, Array<(event: unknown, state: string) => void>>()

  constructor(private readonly filename: string, private readonly total: number) {}

  getFilename() {
    return this.filename
  }

  getSavePath() {
    return `/tmp/${this.filename}`
  }

  getReceivedBytes() {
    return this.received
  }

  getTotalBytes() {
    return this.total
  }

  getState() {
    return this.state
  }

  on(event: 'updated' | 'done', handler: (event: unknown, state: string) => void) {
    const existing = this.handlers.get(event) ?? []
    existing.push(handler)
    this.handlers.set(event, existing)
    return this
  }

  advance(received: number, state: string) {
    this.received = received
    this.state = state
    for (const handler of this.handlers.get(state === 'progressing' ? 'updated' : 'done') ?? []) {
      handler({}, state)
    }
  }
}

class FakeWebContents implements WorkspaceBrowserWebContentsLike {
  loadedUrls: string[] = []
  scripts: string[] = []
  zoomFactors: number[] = []
  finds: Array<{ text: string, options?: unknown }> = []
  stopFinds: string[] = []
  reloads: string[] = []
  stops = 0
  destroyed = false
  closed = 0
  title = 'Page'
  url = ''
  loading = false
  history = {
    canGoBack: vi.fn(() => this.backEntries > 0),
    canGoForward: vi.fn(() => this.forwardEntries > 0),
    goBack: vi.fn(() => {
      this.backEntries -= 1
      this.forwardEntries += 1
    }),
    goForward: vi.fn(() => {
      this.forwardEntries -= 1
      this.backEntries += 1
    }),
  }
  backEntries = 0
  forwardEntries = 0
  session = new FakeSession()
  windowOpenHandler: ((details: { url: string }) => { action: 'deny' }) | null = null
  capturePage = vi.fn(async () => ({ toDataURL: () => 'data:image/png;base64,VIEWPORT' }))
  debugger: {
    isAttached(): boolean
    attach(protocolVersion?: string): void
    detach(): void
    sendCommand(method: string, commandParams?: Record<string, unknown>): Promise<unknown>
  } | undefined = undefined
  printToPDF = vi.fn(async () => new Uint8Array([1, 2, 3, 4]))
  private handlers = new Map<string, AnyHandler[]>()

  get navigationHistory() {
    return this.history
  }

  async loadURL(url: string) {
    this.loadedUrls.push(url)
    this.url = url
    return undefined
  }

  getURL() {
    return this.url
  }

  getTitle() {
    return this.title
  }

  isLoading() {
    return this.loading
  }

  reload() {
    this.reloads.push('reload')
  }

  reloadIgnoringCache() {
    this.reloads.push('reload-ignoring-cache')
  }

  stop() {
    this.stops += 1
  }

  findInPage(text: string, options?: unknown) {
    this.finds.push({ text, options })
    return this.finds.length
  }

  stopFindInPage(action: 'clearSelection') {
    this.stopFinds.push(action)
  }

  async executeJavaScript(script: string) {
    this.scripts.push(script)
    return 'ok'
  }

  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }) {
    this.windowOpenHandler = handler
  }

  on(event: string, handler: AnyHandler) {
    const existing = this.handlers.get(event) ?? []
    existing.push(handler)
    this.handlers.set(event, existing)
    return this
  }

  setZoomFactor(factor: number) {
    this.zoomFactors.push(factor)
  }

  close() {
    this.closed += 1
    this.destroyed = true
  }

  isDestroyed() {
    return this.destroyed
  }

  emit(event: string, ...args: unknown[]) {
    for (const handler of this.handlers.get(event) ?? []) {
      (handler as (...input: unknown[]) => void)(...args)
    }
  }
}

class FakeView implements WorkspaceBrowserViewLike {
  webContents = new FakeWebContents()
  bounds: Array<{ x: number, y: number, width: number, height: number }> = []
  visible: boolean[] = []

  setBounds(bounds: { x: number, y: number, width: number, height: number }) {
    this.bounds.push(bounds)
  }

  setVisible(visible: boolean) {
    this.visible.push(visible)
  }
}

function fakeParent() {
  return {
    contentView: {
      addChildView: vi.fn(),
      removeChildView: vi.fn(),
    },
    getBounds: () => ({ x: 0, y: 0, width: 1440, height: 900 }),
  }
}

const tempDirs: string[] = []

function previewScript() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-haha-workspace-browser-'))
  tempDirs.push(dir)
  const file = path.join(dir, 'preview-agent.js')
  fs.writeFileSync(file, 'window.__previewInjected = true')
  return file
}

type Harness = {
  service: ElectronWorkspaceBrowserService
  parent: ReturnType<typeof fakeParent>
  views: FakeView[]
  events: WorkspaceBrowserEvent[]
  sharedSession: FakeSession
  partitions: string[]
  pdfWrites: Array<{ data: Uint8Array, filename: string }>
}

function createHarness(options?: { scaleFactor?: number }): Harness {
  const views: FakeView[] = []
  const events: WorkspaceBrowserEvent[] = []
  const partitions: string[] = []
  const pdfWrites: Array<{ data: Uint8Array, filename: string }> = []
  // One shared session object stands in for `session.fromPartition(...)`, which
  // hands back the same session for the same partition string.
  const sharedSession = new FakeSession()
  const service = new ElectronWorkspaceBrowserService({
    previewScriptPath: previewScript(),
    emit: event => events.push(event),
    resolveScaleFactor: () => options?.scaleFactor ?? 1,
    writePdf: async input => {
      pdfWrites.push(input)
      return `/downloads/${input.filename}`
    },
    createView: () => {
      partitions.push(WORKSPACE_BROWSER_PARTITION)
      const view = new FakeView()
      view.webContents.session = sharedSession
      views.push(view)
      return view
    },
  })
  return { service, parent: fakeParent(), views, events, sharedSession, partitions, pdfWrites }
}

function requireView(harness: Harness, index: number): FakeView {
  const view = harness.views[index]
  if (!view) throw new Error(`no fake view at index ${index}`)
  return view
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

const desktopRoot = fs.existsSync(path.resolve(process.cwd(), 'electron', 'main.ts'))
  ? process.cwd()
  : path.resolve(process.cwd(), 'desktop')
const workspaceBrowserHostSource = (() => {
  const mainSource = fs.readFileSync(path.join(desktopRoot, 'electron', 'main.ts'), 'utf8')
  return mainSource
    .slice(
      mainSource.indexOf('function getWorkspaceBrowserService()'),
      mainSource.indexOf('async function listCustomPets()'),
    )
    // Comments explain what is deliberately absent, so they must not count as
    // the code being present.
    .replace(/^\s*\/\/.*$/gm, '')
})()

describe('Electron workspace browser host wiring', () => {
  it('shares one persistent partition and denies OS permissions on it', () => {
    expect(workspaceBrowserHostSource).toContain('partition: WORKSPACE_BROWSER_PARTITION')
    expect(workspaceBrowserHostSource).toContain('configurePreviewSessionPermissions')
    expect(workspaceBrowserHostSource).toContain('contextIsolation: true')
    expect(workspaceBrowserHostSource).toContain('nodeIntegration: false')
    expect(workspaceBrowserHostSource).toContain('sandbox: true')
  })

  it('never authenticates loopback requests made by a visited page', () => {
    // These pages render arbitrary remote sites. Attaching the desktop's local
    // access token to their loopback requests would give any visited site the
    // local API, which is exactly why the singleton preview refuses it too.
    expect(workspaceBrowserHostSource).not.toContain('configureLocalServerRequestAuth')
    expect(workspaceBrowserHostSource).not.toContain('resolveMainRendererServerAccess')
  })
})

describe('Electron workspace browser service', () => {
  it('keeps two pages alive at once and navigates only the addressed one', async () => {
    const harness = createHarness()

    await harness.service.create(harness.parent, 'tab-a', {
      storageId: 'store-a',
      url: 'https://a.example',
    })
    await harness.service.create(harness.parent, 'tab-b', {
      storageId: 'store-b',
      url: 'https://b.example',
    })
    await harness.service.navigate('tab-a', 'https://a.example/second')

    expect(harness.views).toHaveLength(2)
    expect(requireView(harness, 0).webContents.loadedUrls).toEqual([
      'https://a.example',
      'https://a.example/second',
    ])
    expect(requireView(harness, 1).webContents.loadedUrls).toEqual(['https://b.example'])
    expect(requireView(harness, 1).webContents.destroyed).toBe(false)
  })

  it('gives every page the one shared persistent partition', async () => {
    const harness = createHarness()

    await harness.service.create(harness.parent, 'tab-a', { storageId: 'store-a' })
    await harness.service.create(harness.parent, 'tab-b', { storageId: 'store-b' })

    expect(WORKSPACE_BROWSER_PARTITION).toBe('persist:cc-haha-browser-app')
    expect(harness.partitions).toEqual([
      WORKSPACE_BROWSER_PARTITION,
      WORKSPACE_BROWSER_PARTITION,
    ])
    // A per-tab partition would be the bug: `storageId` restores a page, it
    // never forks the cookie jar.
    expect(harness.partitions.some(partition => partition.includes('store-a'))).toBe(false)
  })

  it('hides a page by detaching it and never destroys it', async () => {
    const harness = createHarness()

    await harness.service.create(harness.parent, 'tab-a', { storageId: 'store-a' })
    harness.service.setVisible('tab-a', false)

    expect(harness.parent.contentView.removeChildView).toHaveBeenCalledTimes(1)
    expect(requireView(harness, 0).visible.at(-1)).toBe(false)
    expect(requireView(harness, 0).webContents.closed).toBe(0)
    expect(requireView(harness, 0).webContents.destroyed).toBe(false)

    harness.service.setVisible('tab-a', true)
    expect(harness.parent.contentView.addChildView).toHaveBeenCalledTimes(2)
    expect(requireView(harness, 0).webContents.destroyed).toBe(false)
  })

  it('attaches only one page at a time so a shown page cannot sit under another', async () => {
    const harness = createHarness()

    await harness.service.create(harness.parent, 'tab-a', { storageId: 'store-a' })
    await harness.service.create(harness.parent, 'tab-b', { storageId: 'store-b' })

    expect(harness.parent.contentView.removeChildView).toHaveBeenCalledWith(requireView(harness, 0))
    expect(requireView(harness, 0).visible.at(-1)).toBe(false)
    expect(requireView(harness, 1).visible.at(-1)).toBe(true)
    expect(requireView(harness, 0).webContents.destroyed).toBe(false)
  })

  it('destroys only the closed page and leaves its neighbour intact', async () => {
    const harness = createHarness()

    await harness.service.create(harness.parent, 'tab-a', { storageId: 'store-a' })
    await harness.service.create(harness.parent, 'tab-b', { storageId: 'store-b' })
    harness.service.close('tab-a')

    expect(requireView(harness, 0).webContents.closed).toBe(1)
    expect(requireView(harness, 1).webContents.closed).toBe(0)
    expect(requireView(harness, 1).webContents.destroyed).toBe(false)
    await expect(harness.service.navigate('tab-b', 'https://b.example/next')).resolves.toBeUndefined()
    expect(() => harness.service.stop('tab-a')).toThrow('workspace browser tab not open')
  })

  it('drops native events that arrive after the tab was closed', async () => {
    const harness = createHarness()

    await harness.service.create(harness.parent, 'tab-a', { storageId: 'store-a' })
    await harness.service.create(harness.parent, 'tab-b', { storageId: 'store-b' })
    const closedContents = requireView(harness, 0).webContents
    harness.service.close('tab-a')
    harness.events.length = 0

    closedContents.emit('did-stop-loading')
    closedContents.emit('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', 'https://a.example', true)
    closedContents.emit('render-process-gone', {}, { reason: 'crashed' })
    closedContents.windowOpenHandler?.({ url: 'https://popup.example' })

    expect(harness.events).toEqual([])

    requireView(harness, 1).webContents.emit('did-stop-loading')
    expect(harness.events.map(event => event.tabId)).toEqual(['tab-b'])
  })

  it('denies native popups and reports them as new-window events instead', async () => {
    const harness = createHarness()

    await harness.service.create(harness.parent, 'tab-a', { storageId: 'store-a' })
    const result = requireView(harness, 0).webContents.windowOpenHandler?.({
      url: 'https://popup.example/page',
    })

    expect(result).toEqual({ action: 'deny' })
    expect(harness.events).toContainEqual({
      type: 'new-window',
      tabId: 'tab-a',
      url: 'https://popup.example/page',
    })
  })

  it('blocks non-http navigation and rejects non-http loads outright', async () => {
    const harness = createHarness()

    await harness.service.create(harness.parent, 'tab-a', { storageId: 'store-a' })
    const preventDefault = vi.fn()
    requireView(harness, 0).webContents.emit('will-navigate', { preventDefault }, 'file:///etc/passwd')
    requireView(harness, 0).webContents.emit('will-navigate', { preventDefault }, 'https://ok.example')

    expect(preventDefault).toHaveBeenCalledTimes(1)
    await expect(harness.service.navigate('tab-a', 'javascript:alert(1)')).rejects.toThrow(
      'unsupported url scheme',
    )
    expect(requireView(harness, 0).webContents.windowOpenHandler?.({ url: 'file:///etc/passwd' }))
      .toEqual({ action: 'deny' })
    expect(harness.events.some(event => event.type === 'new-window')).toBe(false)
  })

  it('snaps bounds to physical pixels at fractional scale factors', async () => {
    const harness = createHarness({ scaleFactor: 2.25 })

    await harness.service.create(harness.parent, 'tab-a', { storageId: 'store-a' })
    harness.service.setBounds('tab-a', { x: 1.1, y: 2.2, width: 10.3, height: 4.4 })

    expect(requireView(harness, 0).bounds.at(-1)).toEqual({
      x: 0.888889,
      y: 2.222222,
      width: 10.666667,
      height: 4.444444,
    })
  })

  it('reads back and forward from the native navigation history', async () => {
    const harness = createHarness()

    await harness.service.create(harness.parent, 'tab-a', {
      storageId: 'store-a',
      url: 'https://a.example',
    })
    const webContents = requireView(harness, 0).webContents
    webContents.backEntries = 1
    harness.events.length = 0
    webContents.emit('did-navigate', {}, 'https://a.example/second')

    expect(harness.events).toContainEqual(expect.objectContaining({
      type: 'state',
      tabId: 'tab-a',
      canGoBack: true,
      canGoForward: false,
    }))

    harness.service.goBack('tab-a')
    harness.service.goForward('tab-a')
    expect(webContents.history.goBack).toHaveBeenCalledTimes(1)
    expect(webContents.history.goForward).toHaveBeenCalledTimes(1)
  })

  it('reports main-frame load failures and crashes on the owning tab', async () => {
    const harness = createHarness()

    await harness.service.create(harness.parent, 'tab-a', { storageId: 'store-a' })
    const webContents = requireView(harness, 0).webContents
    harness.events.length = 0

    webContents.emit('did-fail-load', {}, -6, 'FILE_NOT_FOUND', 'https://a.example/missing', false)
    expect(harness.events).toEqual([])

    webContents.emit('did-fail-load', {}, -6, 'FILE_NOT_FOUND', 'https://a.example/missing', true)
    webContents.emit('render-process-gone', {}, { reason: 'crashed' })

    expect(harness.events).toEqual([
      {
        type: 'failed',
        tabId: 'tab-a',
        url: 'https://a.example/missing',
        errorCode: -6,
        errorDescription: 'FILE_NOT_FOUND',
      },
      { type: 'destroyed', tabId: 'tab-a', reason: 'crashed' },
    ])
  })

  it('maps find and stop-find onto the native page search', async () => {
    const harness = createHarness()

    await harness.service.create(harness.parent, 'tab-a', { storageId: 'store-a' })
    harness.service.find('tab-a', ' invoice ', { matchCase: true, findNext: true })
    harness.service.stopFind('tab-a')
    harness.events.length = 0
    requireView(harness, 0).webContents.emit('found-in-page', {}, {
      activeMatchOrdinal: 2,
      matches: 7,
    })

    expect(requireView(harness, 0).webContents.finds).toEqual([
      { text: 'invoice', options: { matchCase: true, findNext: true } },
    ])
    expect(requireView(harness, 0).webContents.stopFinds).toEqual(['clearSelection'])
    expect(harness.events).toEqual([
      { type: 'found', tabId: 'tab-a', activeMatchOrdinal: 2, matches: 7 },
    ])
  })

  it('captures the viewport natively and the full page over CDP', async () => {
    const harness = createHarness()

    await harness.service.create(harness.parent, 'tab-a', { storageId: 'store-a' })
    const webContents = requireView(harness, 0).webContents
    webContents.debugger = {
      isAttached: vi.fn(() => false),
      attach: vi.fn(),
      detach: vi.fn(),
      sendCommand: vi.fn(async (method: string) => {
        if (method === 'Page.getLayoutMetrics') {
          return { cssContentSize: { x: 0, y: 0, width: 1280, height: 3200 } }
        }
        return { data: 'FULL' }
      }),
    }
    harness.events.length = 0

    await harness.service.capture('tab-a', 'viewport')
    await harness.service.capture('tab-a', 'full')

    expect(harness.events).toEqual([
      {
        type: 'screenshot',
        tabId: 'tab-a',
        dataUrl: 'data:image/png;base64,VIEWPORT',
        kind: 'viewport',
      },
      {
        type: 'screenshot',
        tabId: 'tab-a',
        dataUrl: 'data:image/png;base64,FULL',
        kind: 'full',
      },
    ])
  })

  it('reports shared-session downloads on the tab that started them', async () => {
    const harness = createHarness()

    await harness.service.create(harness.parent, 'tab-a', { storageId: 'store-a' })
    await harness.service.create(harness.parent, 'tab-b', { storageId: 'store-b' })
    harness.events.length = 0

    const item = new FakeDownloadItem('report.pdf', 2_048)
    harness.sharedSession.startDownload(item, requireView(harness, 1).webContents)
    item.advance(2_048, 'completed')

    expect(harness.events).toEqual([
      {
        type: 'download',
        tabId: 'tab-b',
        download: {
          id: 'wbd-1',
          filename: 'report.pdf',
          savePath: '/tmp/report.pdf',
          receivedBytes: 0,
          totalBytes: 2_048,
          state: 'progressing',
        },
      },
      {
        type: 'download',
        tabId: 'tab-b',
        download: {
          id: 'wbd-1',
          filename: 'report.pdf',
          savePath: '/tmp/report.pdf',
          receivedBytes: 2_048,
          totalBytes: 2_048,
          state: 'completed',
        },
      },
    ])
  })

  it('exports a PDF through the host and reports it as a finished download', async () => {
    const harness = createHarness()

    await harness.service.create(harness.parent, 'tab-a', {
      storageId: 'store-a',
      url: 'https://a.example/report',
    })
    requireView(harness, 0).webContents.title = 'Quarterly Report'
    harness.events.length = 0

    await harness.service.printToPdf('tab-a')

    expect(harness.pdfWrites.map(write => write.filename)).toEqual(['Quarterly-Report.pdf'])
    expect(harness.events).toEqual([
      {
        type: 'download',
        tabId: 'tab-a',
        download: {
          id: 'wbd-1',
          filename: 'Quarterly-Report.pdf',
          savePath: '/downloads/Quarterly-Report.pdf',
          receivedBytes: 4,
          totalBytes: 4,
          state: 'completed',
        },
      },
    ])
    expect(workspaceBrowserPdfFilename('https://a.example/x', '  ')).toBe('a.example.pdf')
  })

  it('routes agent messages to the page that sent them and injects the agent after load', async () => {
    const harness = createHarness()

    await harness.service.create(harness.parent, 'tab-a', { storageId: 'store-a' })
    await harness.service.create(harness.parent, 'tab-b', { storageId: 'store-b' })
    requireView(harness, 1).webContents.emit('did-finish-load')
    await Promise.resolve()
    harness.events.length = 0

    const owned = harness.service.handleMessageFromView(
      requireView(harness, 1).webContents,
      JSON.stringify({ v: 1, type: 'ready' }),
    )
    const foreign = harness.service.handleMessageFromView({}, JSON.stringify({ v: 1, type: 'ready' }))
    await Promise.resolve()

    expect(owned).toBe(true)
    expect(foreign).toBe(false)
    expect(harness.events).toEqual([
      { type: 'agent', tabId: 'tab-b', message: { v: 1, type: 'ready' } },
    ])
    expect(requireView(harness, 1).webContents.scripts.some(script =>
      script.includes('window.__previewInjected = true'))).toBe(true)
  })

  it('forwards host messages only to the addressed page', async () => {
    const harness = createHarness()

    await harness.service.create(harness.parent, 'tab-a', { storageId: 'store-a' })
    await harness.service.create(harness.parent, 'tab-b', { storageId: 'store-b' })

    await harness.service.message('tab-a', { v: 1, type: 'enter-picker' })

    expect(requireView(harness, 0).webContents.scripts.some(script =>
      script.includes('enter-picker'))).toBe(true)
    expect(requireView(harness, 1).webContents.scripts).toEqual([])
  })

  it('records a visit log without standing in for the native back stack', async () => {
    const harness = createHarness()

    await harness.service.create(harness.parent, 'tab-a', { storageId: 'store-a' })
    const webContents = requireView(harness, 0).webContents
    harness.events.length = 0
    webContents.emit('did-navigate', {}, 'https://a.example/one')
    webContents.emit('did-navigate', {}, 'https://a.example/one')
    webContents.emit('did-navigate', {}, 'https://a.example/two')

    const historyEvents = harness.events.filter(event => event.type === 'history')
    expect(historyEvents).toHaveLength(2)
    const last = historyEvents.at(-1)
    expect(last?.type === 'history' && last.entries.map(entry => entry.url)).toEqual([
      'https://a.example/one',
      'https://a.example/two',
    ])
    // Back/forward never consults that list.
    expect(webContents.history.canGoBack).toHaveBeenCalled()
  })

  it('releases every page when the host tears the workspace down', async () => {
    const harness = createHarness()

    await harness.service.create(harness.parent, 'tab-a', { storageId: 'store-a' })
    await harness.service.create(harness.parent, 'tab-b', { storageId: 'store-b' })
    harness.service.closeAll()

    expect(requireView(harness, 0).webContents.closed).toBe(1)
    expect(requireView(harness, 1).webContents.closed).toBe(1)
    expect(() => harness.service.stop('tab-b')).toThrow('workspace browser tab not open')
  })

  it('never re-navigates a live page when its tab is re-created', async () => {
    const harness = createHarness()

    await harness.service.create(harness.parent, 'tab-a', {
      storageId: 'store-a',
      url: 'https://a.example',
    })
    await harness.service.navigate('tab-a', 'https://a.example/checkout')

    // The renderer re-mounts its surface every time the tab is re-activated and
    // re-issues `create` with the tab's last known URL. Honouring that would be
    // a hard navigation: the half-filled form, the scroll position and the real
    // back stack would all be lost — which is the one thing keeping the page
    // alive is supposed to prevent.
    await harness.service.create(harness.parent, 'tab-a', {
      storageId: 'store-a',
      url: 'https://a.example/checkout',
    })

    expect(harness.views).toHaveLength(1)
    expect(requireView(harness, 0).webContents.loadedUrls).toEqual([
      'https://a.example',
      'https://a.example/checkout',
    ])
  })

  it('re-attaches a re-created page without loading anything', async () => {
    const harness = createHarness()

    await harness.service.create(harness.parent, 'tab-a', {
      storageId: 'store-a',
      url: 'https://a.example',
    })
    await harness.service.setVisible('tab-a', false)
    await harness.service.create(harness.parent, 'tab-a', { storageId: 'store-a' })

    expect(requireView(harness, 0).visible).toEqual([true, false, true])
    expect(requireView(harness, 0).webContents.loadedUrls).toEqual(['https://a.example'])
  })

  it('registers nothing when create is given arguments it cannot use', async () => {
    const harness = createHarness()

    await expect(harness.service.create(harness.parent, 'tab-bad', {
      storageId: 'store-bad',
      url: 'file:///etc/passwd',
    })).rejects.toThrow()

    // A view constructed before validation would be a `webContents` with no
    // owner and no way to address it for closing.
    expect(harness.views).toHaveLength(0)
    expect(() => harness.service.stop('tab-bad')).toThrow('workspace browser tab not open')
  })

  it('applies zoom and reload modes to the addressed page only', async () => {
    const harness = createHarness()

    await harness.service.create(harness.parent, 'tab-a', { storageId: 'store-a' })
    await harness.service.create(harness.parent, 'tab-b', { storageId: 'store-b' })
    harness.service.setZoom('tab-a', 1.25)
    harness.service.reload('tab-a', { ignoreCache: true })
    harness.service.reload('tab-b')
    harness.service.stop('tab-b')

    expect(requireView(harness, 0).webContents.zoomFactors).toEqual([1.25])
    expect(requireView(harness, 1).webContents.zoomFactors).toEqual([])
    expect(requireView(harness, 0).webContents.reloads).toEqual(['reload-ignoring-cache'])
    expect(requireView(harness, 1).webContents.reloads).toEqual(['reload'])
    expect(requireView(harness, 1).webContents.stops).toBe(1)
  })
})
