import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Download,
  ExternalLink,
  History,
  MoreVertical,
  MousePointer2,
  Printer,
  RotateCw,
  Search,
  X,
} from 'lucide-react'
import { IconButton } from '@/components/ui/IconButton'
import { Spinner } from '@/components/ui/Spinner'
import { useDismissable } from '@/hooks/useDismissable'
import { useTranslation } from '../../i18n'
import { computeWebviewBounds } from '../browser/computeWebviewBounds'
import { getDesktopHost } from '../../lib/desktopHost'
import { getServerBaseUrl } from '../../lib/desktopRuntime'
import { formatBytes } from '../../lib/formatBytes'
import { classifyPreviewLink } from '../../lib/previewLinkRouter'
import { isAbsoluteLocalPath, localFileUrl, previewFsUrl } from '../../lib/handlePreviewLink'
import {
  isWorkspaceBrowserAvailable,
  workspaceBrowserHost,
} from '../../lib/workspace/browserHost'
import { useOverlayStore } from '../../stores/overlayStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useWorkspaceBrowserStore } from '../../stores/workspaceBrowserStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import type { WorkspaceBrowserTab as WorkspaceBrowserTabModel } from '../../lib/workspace/types'

const MIN_ZOOM = 0.5
const MAX_ZOOM = 1.5
const ZOOM_STEP = 0.1

type BrowserPanel = 'downloads' | 'history' | null

export type WorkspaceBrowserTabProps = {
  sessionId: string
  tab: WorkspaceBrowserTabModel
  active: boolean
}

function resolveNavigationUrl(input: string, sessionId: string): string {
  const value = input.trim()
  if (!value) return ''
  const classified = classifyPreviewLink(value)
  if (classified.kind === 'browser-file' && classified.path) {
    const base = getServerBaseUrl()
    return isAbsoluteLocalPath(classified.path)
      ? localFileUrl(base, classified.path)
      : previewFsUrl(base, sessionId, classified.path)
  }
  return value
}

/**
 * One page, addressed by its own `browserTabId`.
 *
 * React here only decides *where the page is drawn*. Creating it, navigating it
 * and destroying it are the controller's and the host's business — which is why
 * unmounting this component (hiding the panel, switching tab, switching task)
 * hides the view and nothing more.
 */
export function WorkspaceBrowserTab({ sessionId, tab, active }: WorkspaceBrowserTabProps) {
  const t = useTranslation()
  const stageRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState(tab.url ?? '')
  const [zoom, setZoom] = useState(1)
  const [menuOpen, setMenuOpen] = useState(false)
  const [panel, setPanel] = useState<BrowserPanel>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [findText, setFindText] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const appZoom = useSettingsStore((state) => state.uiZoom)
  const overlayCount = useOverlayStore((state) => state.count)
  const available = useMemo(() => isWorkspaceBrowserAvailable(), [])
  const browserTabId = tab.browserTabId
  const page = useWorkspaceBrowserStore((state) => state.pageByTabId[browserTabId])
  const history = useWorkspaceBrowserStore((state) => state.historyByTabId[browserTabId])
  const downloads = useWorkspaceBrowserStore((state) => state.downloads)
  const loading = page?.loading ?? false

  useEffect(() => { setDraft(page?.url || tab.url || '') }, [page?.url, tab.url])

  useDismissable({
    open: menuOpen,
    refs: [menuRef, menuTriggerRef],
    onDismiss: () => setMenuOpen(false),
  })
  useDismissable({ open: panel !== null, refs: [panelRef], onDismiss: () => setPanel(null) })

  const reportBounds = useCallback(() => {
    const element = stageRef.current
    if (!element) return
    void workspaceBrowserHost.setBounds(
      browserTabId,
      computeWebviewBounds(element.getBoundingClientRect(), appZoom),
    )
  }, [appZoom, browserTabId])

  // Create once per page identity. `storageId` travels with it so a restored
  // tab reopens the same page rather than a blank one.
  useEffect(() => {
    const element = stageRef.current
    void workspaceBrowserHost.create(browserTabId, {
      storageId: tab.storageId,
      ...(tab.url ? { url: tab.url } : {}),
      ...(element
        ? { bounds: computeWebviewBounds(element.getBoundingClientRect(), appZoom) }
        : {}),
    })
    // Deliberately NOT closing on unmount: the page belongs to the tab, and the
    // tab outlives this component. `closeTab` is the only thing that ends it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browserTabId])

  /*
    A `WebContentsView` always paints above the DOM, so "is this page on screen"
    has to account for everything the app might want to draw over it — and the
    teardown is load-bearing.

    Without the cleanup, unmounting leaves the page attached at its last bounds:
    switching to a file tab, opening the `+` picker, hiding the workspace or
    switching tasks would each leave a live page floating over whatever replaced
    it. The surface renders only the active tab, so unmount is the *normal* way
    a browser tab goes off screen, not an edge case.

    `menuOpen` and `loadError` are in the condition for the same reason `panel`
    is: the browser's own dropdown and its retry overlay are DOM siblings drawn
    inside the page's rectangle, and no z-index can lift them above it.
  */
  const pageVisible = active &&
    overlayCount === 0 &&
    panel === null &&
    !menuOpen &&
    !tab.loadError &&
    Boolean(tab.url)

  useEffect(() => {
    void workspaceBrowserHost.setVisible(browserTabId, pageVisible)
    return () => {
      void workspaceBrowserHost.setVisible(browserTabId, false)
    }
  }, [browserTabId, pageVisible])

  useEffect(() => {
    if (!active) return
    const element = stageRef.current
    if (!element) return
    const observer = new ResizeObserver(() => reportBounds())
    observer.observe(element)
    window.addEventListener('resize', reportBounds)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', reportBounds)
    }
  }, [active, reportBounds])

  useLayoutEffect(() => {
    if (active) reportBounds()
  }, [active, reportBounds])

  const navigate = (input: string) => {
    const url = resolveNavigationUrl(input, sessionId)
    if (!url) return
    useWorkspaceStore.getState().updateBrowserTab(sessionId, browserTabId, { loadError: null })
    void workspaceBrowserHost.navigate(browserTabId, url)
  }

  const applyZoom = (next: number) => {
    const clamped = Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next)) * 10) / 10
    setZoom(clamped)
    void workspaceBrowserHost.setZoom(browserTabId, clamped)
  }

  const runFind = (text: string, findNext: boolean) => {
    if (!text) {
      void workspaceBrowserHost.stopFind(browserTabId)
      return
    }
    void workspaceBrowserHost.find(browserTabId, text, { findNext, forward: true })
  }

  if (!available) {
    return (
      <div
        data-testid="workspace-browser-unavailable"
        className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-8 text-center"
      >
        <p className="text-[13px] font-medium text-[var(--color-text-primary)]">
          {t('workspace.browser.unavailableTitle')}
        </p>
        <p className="max-w-[360px] text-[12px] leading-relaxed text-[var(--color-text-secondary)]">
          {t('workspace.browser.unavailableBody')}
        </p>
        {tab.url ? (
          <button
            type="button"
            onClick={() => { void getDesktopHost().shell.open(tab.url!) }}
            className="mt-1 inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
          >
            <ExternalLink size={13} aria-hidden="true" />
            {t('workspace.browser.openExternal')}
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        data-testid="workspace-browser-toolbar"
        className="flex h-11 shrink-0 items-center gap-1 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-2"
      >
        <IconButton
          icon={<ArrowLeft size={15} strokeWidth={1.9} />}
          label={t('workspace.browser.back')}
          size="xs"
          tone="muted"
          disabled={!page?.canGoBack}
          onClick={() => { void workspaceBrowserHost.goBack(browserTabId) }}
        />
        <IconButton
          icon={<ArrowRight size={15} strokeWidth={1.9} />}
          label={t('workspace.browser.forward')}
          size="xs"
          tone="muted"
          disabled={!page?.canGoForward}
          onClick={() => { void workspaceBrowserHost.goForward(browserTabId) }}
        />
        <IconButton
          icon={loading ? <Spinner size={15} /> : <RotateCw size={15} strokeWidth={1.9} />}
          label={t(loading ? 'workspace.browser.stop' : 'workspace.browser.reload')}
          size="xs"
          tone="muted"
          aria-busy={loading}
          onClick={() => {
            if (loading) void workspaceBrowserHost.stop(browserTabId)
            else void workspaceBrowserHost.reload(browserTabId)
          }}
        />
        <form
          className="min-w-0 flex-1"
          onSubmit={(event) => {
            event.preventDefault()
            navigate(draft)
          }}
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            spellCheck={false}
            aria-label={t('workspace.browser.address')}
            placeholder={t('workspace.browser.addressPlaceholder')}
            data-testid="workspace-browser-address"
            className="h-7 w-full rounded-[var(--radius-md)] bg-[var(--color-surface-container)] px-3 text-center text-[12px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
          />
        </form>
        <IconButton
          ref={menuTriggerRef}
          icon={<MoreVertical size={15} strokeWidth={1.9} />}
          label={t('workspace.browser.menu')}
          size="xs"
          tone="muted"
          pressed={menuOpen}
          data-testid="workspace-browser-menu-trigger"
          onClick={() => setMenuOpen((open) => !open)}
        />
      </div>

      {findOpen ? (
        <div
          data-testid="workspace-browser-find"
          className="flex h-9 shrink-0 items-center gap-1.5 border-b border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-2"
        >
          <Search size={13} aria-hidden="true" className="shrink-0 text-[var(--color-text-tertiary)]" />
          <input
            autoFocus
            value={findText}
            aria-label={t('workspace.browser.findInPage')}
            placeholder={t('workspace.browser.findPlaceholder')}
            onChange={(event) => {
              setFindText(event.target.value)
              runFind(event.target.value, false)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                runFind(findText, true)
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                setFindOpen(false)
                void workspaceBrowserHost.stopFind(browserTabId)
              }
            }}
            className="h-6 min-w-0 flex-1 bg-transparent text-[12px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
          />
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-[var(--color-text-tertiary)]">
            {page?.find
              ? t('workspace.browser.findMatches', {
                  index: page.find.active,
                  total: page.find.total,
                })
              : ''}
          </span>
          <IconButton
            icon={<X size={13} />}
            label={t('workspace.browser.findClose')}
            size="2xs"
            tone="muted"
            onClick={() => {
              setFindOpen(false)
              void workspaceBrowserHost.stopFind(browserTabId)
            }}
          />
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1 overflow-hidden" data-testid="workspace-browser-stage">
        <div ref={stageRef} className="absolute inset-0" />
        {!tab.url && !tab.loadError ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-center">
            <p className="text-[13px] font-medium text-[var(--color-text-primary)]">
              {t('workspace.browser.emptyTitle')}
            </p>
            <p className="text-[12px] text-[var(--color-text-secondary)]">
              {t('workspace.browser.emptyBody')}
            </p>
          </div>
        ) : null}
        {tab.loadError ? (
          <div
            role="alert"
            data-testid="workspace-browser-error"
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[var(--color-surface)] px-8 text-center"
          >
            <p className="text-[13px] font-medium text-[var(--color-text-primary)]">
              {t('workspace.browser.loadFailed', { url: tab.url ?? '' })}
            </p>
            <p className="max-w-[420px] text-[12px] text-[var(--color-text-secondary)]">
              {tab.loadError}
            </p>
            <button
              type="button"
              onClick={() => {
                useWorkspaceStore.getState().updateBrowserTab(sessionId, browserTabId, { loadError: null })
                void workspaceBrowserHost.reload(browserTabId, { ignoreCache: true })
              }}
              className="mt-1 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
            >
              {t('workspace.browser.retry')}
            </button>
          </div>
        ) : null}
      </div>

      {panel !== null ? (
        <div
          ref={panelRef}
          data-testid={`workspace-browser-panel-${panel}`}
          className="absolute inset-x-0 bottom-0 top-11 z-[var(--z-raised)] flex flex-col border-t border-[var(--color-border)] bg-[var(--color-surface)]"
        >
          <div className="flex h-9 shrink-0 items-center justify-between border-b border-[var(--color-border)] px-3">
            <span className="text-[12px] font-medium text-[var(--color-text-primary)]">
              {t(panel === 'downloads' ? 'workspace.browser.downloads' : 'workspace.browser.history')}
            </span>
            <IconButton
              icon={<X size={13} />}
              label={t('workspace.browser.closeOverlay')}
              size="2xs"
              tone="muted"
              onClick={() => setPanel(null)}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
            {panel === 'downloads' ? (
              downloads.length === 0 ? (
                <p className="px-2 py-3 text-[12px] text-[var(--color-text-tertiary)]">
                  {t('workspace.browser.downloadsEmpty')}
                </p>
              ) : (
                <ul className="space-y-0.5">
                  {downloads.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5"
                    >
                      <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--color-text-primary)]">
                        {item.filename}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] tabular-nums text-[var(--color-text-tertiary)]">
                        {item.state === 'progressing' && item.totalBytes > 0
                          ? `${Math.round((item.receivedBytes / item.totalBytes) * 100)}%`
                          : formatBytes(item.receivedBytes)}
                      </span>
                      {item.state === 'completed' && item.savePath ? (
                        <IconButton
                          icon={<ExternalLink size={13} />}
                          label={t('workspace.browser.revealDownload')}
                          size="2xs"
                          tone="muted"
                          onClick={() => { void getDesktopHost().shell.openPath(item.savePath!) }}
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
              )
            ) : (history ?? []).length === 0 ? (
              <p className="px-2 py-3 text-[12px] text-[var(--color-text-tertiary)]">
                {t('workspace.browser.historyEmpty')}
              </p>
            ) : (
              <ul className="space-y-0.5">
                {[...(history ?? [])].reverse().map((visit) => (
                  <li key={`${visit.url}-${visit.visitedAt}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setPanel(null)
                        navigate(visit.url)
                      }}
                      className="flex w-full flex-col items-start gap-0.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-left transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
                    >
                      <span className="w-full truncate text-[12px] text-[var(--color-text-primary)]">
                        {visit.title || visit.url}
                      </span>
                      <span className="w-full truncate font-mono text-[11px] text-[var(--color-text-tertiary)]">
                        {visit.url}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      {menuOpen ? (
        <div
          ref={menuRef}
          role="menu"
          data-testid="workspace-browser-menu"
          className="absolute right-2 top-11 z-[var(--z-dropdown)] w-[248px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] py-1.5 shadow-[var(--shadow-dropdown)]"
        >
          <BrowserMenuItem
            icon={<Search size={14} />}
            label={t('workspace.browser.findInPage')}
            onSelect={() => { setFindOpen(true); setMenuOpen(false) }}
          />
          <BrowserMenuItem
            icon={<Printer size={14} />}
            label={t('workspace.browser.print')}
            onSelect={() => { void workspaceBrowserHost.printToPdf(browserTabId); setMenuOpen(false) }}
          />
          <div className="flex items-center justify-between gap-2 px-3.5 py-1.5">
            <span className="text-[12px] text-[var(--color-text-primary)]">
              {t('workspace.browser.zoom')}
            </span>
            <span className="flex items-center gap-1">
              <IconButton
                icon="remove"
                label={t('workspace.browser.zoomOut')}
                size="2xs"
                tone="muted"
                disabled={zoom <= MIN_ZOOM}
                onClick={() => applyZoom(zoom - ZOOM_STEP)}
              />
              <span className="min-w-[38px] text-center font-mono text-[11px] tabular-nums text-[var(--color-text-secondary)]">
                {Math.round(zoom * 100)}%
              </span>
              <IconButton
                icon="add"
                label={t('workspace.browser.zoomIn')}
                size="2xs"
                tone="muted"
                disabled={zoom >= MAX_ZOOM}
                onClick={() => applyZoom(zoom + ZOOM_STEP)}
              />
              <IconButton
                icon="refresh"
                label={t('workspace.browser.zoomReset')}
                size="2xs"
                tone="muted"
                disabled={zoom === 1}
                onClick={() => applyZoom(1)}
              />
            </span>
          </div>
          <div className="my-1 border-t border-[var(--color-border)]" />
          <BrowserMenuItem
            icon={<Camera size={14} />}
            label={t('workspace.browser.capture')}
            onSelect={() => { void workspaceBrowserHost.capture(browserTabId, 'full'); setMenuOpen(false) }}
          />
          <BrowserMenuItem
            icon={<MousePointer2 size={14} />}
            label={t('workspace.browser.pickElement')}
            onSelect={() => {
              void workspaceBrowserHost.message(browserTabId, { v: 1, type: 'enter-picker' })
              setMenuOpen(false)
            }}
          />
          <div className="my-1 border-t border-[var(--color-border)]" />
          <BrowserMenuItem
            icon={<Download size={14} />}
            label={t('workspace.browser.downloads')}
            onSelect={() => { setPanel('downloads'); setMenuOpen(false) }}
          />
          <BrowserMenuItem
            icon={<History size={14} />}
            label={t('workspace.browser.history')}
            onSelect={() => { setPanel('history'); setMenuOpen(false) }}
          />
          <BrowserMenuItem
            icon={<ExternalLink size={14} />}
            label={t('workspace.browser.openExternal')}
            disabled={!page?.url && !tab.url}
            onSelect={() => {
              const url = page?.url || tab.url
              if (url) void getDesktopHost().shell.open(url)
              setMenuOpen(false)
            }}
          />
        </div>
      ) : null}
    </div>
  )
}

function BrowserMenuItem({
  icon,
  label,
  onSelect,
  disabled = false,
}: {
  icon: React.ReactNode
  label: string
  onSelect: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onSelect}
      className="flex w-full items-center gap-2.5 px-3.5 py-1.5 text-left text-[12px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:text-[var(--color-text-tertiary)] disabled:hover:bg-transparent"
    >
      <span aria-hidden="true" className="shrink-0 text-[var(--color-text-tertiary)]">{icon}</span>
      {label}
    </button>
  )
}
