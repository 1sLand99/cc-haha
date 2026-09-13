import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Globe,
  MessageSquarePlus,
  Minus,
  MoreVertical,
  Plus,
  RotateCw,
  Search,
  X,
} from 'lucide-react'
import { IconButton } from '@/components/ui/IconButton'
import { Spinner } from '@/components/ui/Spinner'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { WorkspaceBrowserAddressBar } from '@/components/workbench/WorkspaceBrowserAddressBar'
import { WorkspaceBrowserSelectionBar } from '@/components/workbench/WorkspaceBrowserSelectionBar'
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
import { useUIStore } from '@/stores/uiStore'
import { useWorkspaceBrowserStore } from '../../stores/workspaceBrowserStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { usePreviewSelectionStore } from '../../stores/previewSelectionStore'
import { normalizeBrowserAddress } from '../../lib/workspace/browserAddress'
import { discardBrowserSelections } from '../../lib/workspace/browserSelections'
import { buildPreviewPickerMessage } from '../../lib/previewSelectionPicker'
import { MIN_APP_ZOOM, MAX_APP_ZOOM } from '../../lib/appZoom'
import type { WorkspaceBrowserTab as WorkspaceBrowserTabModel } from '../../lib/workspace/types'

const MIN_ZOOM = MIN_APP_ZOOM
const MAX_ZOOM = MAX_APP_ZOOM
const ZOOM_STEP = 0.1
const PRESENTATION_SNAPSHOT_TIMEOUT_MS = 800

type BrowserPanel = 'downloads' | 'history' | null

export type WorkspaceBrowserTabProps = {
  sessionId: string
  tab: WorkspaceBrowserTabModel
  active: boolean
}

function resolveNavigationUrl(input: string, sessionId: string): string {
  const value = normalizeBrowserAddress(input)
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
  const browserRootRef = useRef<HTMLDivElement>(null)
  const addressRef = useRef<HTMLInputElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [panel, setPanel] = useState<BrowserPanel>(null)
  const [pendingNavigation, setPendingNavigation] = useState<{ run: () => void } | null>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [findText, setFindText] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const appZoom = useSettingsStore((state) => state.uiZoom)
  const theme = useUIStore((state) => state.theme)
  const overlayCount = useOverlayStore((state) => state.count)
  const snapshotOverlayCount = useOverlayStore((state) => state.snapshotCount)
  const nativePresentedRef = useRef(false)
  const [presentationSnapshot, setPresentationSnapshot] = useState<string | null>(null)
  const available = useMemo(() => isWorkspaceBrowserAvailable(), [])
  const browserTabId = tab.browserTabId
  const [registeredId, setRegisteredId] = useState<string | null>(null)
  const [createAttempt, setCreateAttempt] = useState(0)
  const lifetimeRef = useRef<{ id: string; ready: boolean; cancelled: boolean } | null>(null)
  const navigationRequestRef = useRef(0)
  const appZoomRef = useRef(appZoom)
  appZoomRef.current = appZoom
  const page = useWorkspaceBrowserStore((state) => state.pageByTabId[browserTabId])
  const ready = page?.registered === true || registeredId === browserTabId
  const initialAddressFocusRef = useRef({ browserTabId, pending: !tab.url && !ready, activated: false })
  if (initialAddressFocusRef.current.browserTabId !== browserTabId) {
    initialAddressFocusRef.current = { browserTabId, pending: !tab.url && !ready, activated: false }
  }
  const selectionCount = usePreviewSelectionStore((state) => state.bySession[browserTabId]?.items.length ?? 0)
  const zoom = page?.zoomFactor ?? 1
  const historyByTabId = useWorkspaceBrowserStore((state) => state.historyByTabId)
  const history = historyByTabId[browserTabId]
  const visits = useMemo(() => Object.values(historyByTabId).flatMap((entries) => entries ?? []), [historyByTabId])
  const downloads = useWorkspaceBrowserStore((state) => state.downloads)
  const loading = page?.loading ?? false

  const currentAddress = page?.url || tab.url || ''
  const annotationActive = page?.annotationActive ?? false

  useLayoutEffect(() => {
    const request = initialAddressFocusRef.current
    if (!request.pending || !available) return
    if (tab.url || (!active && request.activated)) { request.pending = false; return }
    if (!active) return
    request.activated = true
    if (ready) {
      request.pending = false
      addressRef.current?.focus({ preventScroll: true })
      return
    }
    // A disabled address bar cannot receive the workspace's initial focus
    // request. Retry on readiness only if the user has not moved elsewhere.
    const onFocus = (event: FocusEvent) => {
      const target = event.target
      if (!(target instanceof Node) || target === document.body || target === document.documentElement) return
      const panel = browserRootRef.current?.closest('[role="tabpanel"]') ?? browserRootRef.current
      if (!panel?.contains(target)) request.pending = false
    }
    document.addEventListener('focusin', onFocus)
    return () => document.removeEventListener('focusin', onFocus)
  }, [active, available, browserTabId, ready, tab.url])

  useDismissable({
    open: menuOpen,
    refs: [menuRef, menuTriggerRef],
    onDismiss: () => setMenuOpen(false),
  })
  useDismissable({ open: panel !== null, refs: [panelRef], onDismiss: () => setPanel(null) })

  const stillOwned = useCallback(() => useWorkspaceStore.getState().findBrowserTabOwner(browserTabId)?.sessionId === sessionId, [browserTabId, sessionId])
  const canCommand = useCallback(() => {
    const lifetime = lifetimeRef.current
    return lifetime?.id === browserTabId && !lifetime.cancelled && stillOwned() &&
      (lifetime.ready || useWorkspaceBrowserStore.getState().pageByTabId[browserTabId]?.registered === true)
  }, [browserTabId, stillOwned])
  const reportHostError = useCallback((error: unknown) => {
    const lifetime = lifetimeRef.current
    if (lifetime?.id !== browserTabId || lifetime.cancelled || !stillOwned()) return
    useWorkspaceStore.getState().updateBrowserTab(sessionId, browserTabId, {
      loadError: error instanceof Error ? error.message : String(error),
    })
  }, [browserTabId, sessionId, stillOwned])
  const runCommand = (command: () => Promise<unknown>) => {
    if (canCommand()) void command().catch(reportHostError)
  }
  const runNavigationCommand = (command: () => Promise<unknown>) => {
    if (!canCommand()) return
    const request = ++navigationRequestRef.current
    const before = useWorkspaceBrowserStore.getState().pageByTabId[browserTabId]?.navigationId ?? 0
    void command().catch((error: unknown) => {
      if (request !== navigationRequestRef.current) return
      const current = useWorkspaceBrowserStore.getState().pageByTabId[browserTabId]
      if (current && (current.navigationId > before + 1 || (current.navigationId > before && current.navigationOutcome === 'succeeded'))) return
      reportHostError(error)
    })
  }
  const reportBounds = useCallback(() => {
    if (!canCommand()) return
    const element = stageRef.current
    if (!element) return
    void workspaceBrowserHost.setBounds(
      browserTabId,
      computeWebviewBounds(element.getBoundingClientRect(), appZoomRef.current),
    ).catch(reportHostError)
  }, [browserTabId, canCommand, reportHostError])

  // Create once per page identity. `storageId` travels with it so a restored
  // tab reopens the same page rather than a blank one.
  useEffect(() => {
    if (!available || !stillOwned()) return
    const lifetime = { id: browserTabId, ready: false, cancelled: false }
    lifetimeRef.current = lifetime
    const request = ++navigationRequestRef.current
    const navigationId = useWorkspaceBrowserStore.getState().pageByTabId[browserTabId]?.navigationId ?? 0
    const element = stageRef.current
    void workspaceBrowserHost.create(browserTabId, {
      storageId: tab.storageId,
      // A delayed completion must never attach an abandoned tab over its replacement.
      visible: false,
      ...(tab.url ? { url: tab.url } : {}),
      ...(element
        ? { bounds: computeWebviewBounds(element.getBoundingClientRect(), appZoom) }
        : {}),
    }).then((result) => {
      if (lifetime.cancelled || !stillOwned() || !result.ok) return
      lifetime.ready = true
      setRegisteredId(browserTabId)
      reportBounds()
    }).catch((error: unknown) => {
      if (lifetime.cancelled || !stillOwned() || request !== navigationRequestRef.current) return
      const current = useWorkspaceBrowserStore.getState().pageByTabId[browserTabId]
      // The initial load may reject after the user has already navigated again.
      if (current && (current.navigationId > navigationId + 1 || current.navigationOutcome === 'succeeded')) return
      reportHostError(error)
    })
    // Deliberately NOT closing on unmount: the page belongs to the tab, and the
    // tab outlives this component. `closeTab` is the only thing that ends it.
    return () => {
      const registered = lifetime.ready || useWorkspaceBrowserStore.getState().pageByTabId[browserTabId]?.registered === true
      lifetime.cancelled = true
      if (registered && stillOwned()) {
        void workspaceBrowserHost.setVisible(browserTabId, false).catch((error: unknown) => {
          // Missing pages are an idempotent hide in the host. Other teardown
          // failures remain diagnostic errors rather than unhandled promises.
          console.error('Failed to hide workspace browser page', error)
        })
      }
    }
    // The URL/bounds are initial inputs, not a reason to recreate a live page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browserTabId, createAttempt])

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
  const pageCanBePresented = active &&
    panel === null &&
    !menuOpen &&
    !pendingNavigation &&
    !tab.loadError &&
    Boolean(tab.url)
  const pageVisible = pageCanBePresented && overlayCount === 0
  const snapshotRequested = pageCanBePresented && overlayCount > 0 && overlayCount === snapshotOverlayCount
  const navigationId = page?.navigationId ?? 0

  useLayoutEffect(() => {
    if (!canCommand()) return
    let cancelled = false
    let settled = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    const present = (visible: boolean) => {
      nativePresentedRef.current = visible
      void workspaceBrowserHost.setVisible(browserTabId, visible).catch(reportHostError)
    }
    if (snapshotRequested && nativePresentedRef.current) {
      // Capture while the native page is still attached. Its WebContentsView
      // would otherwise cover a DOM menu, but detaching first can capture an
      // empty frame. This image is presentation-only and never becomes a chat
      // attachment. Ordinary modal overlays still hide immediately below.
      const finish = (dataUrl: string | null) => {
        if (cancelled || settled) return
        settled = true
        clearTimeout(timeout)
        // Commit the already-decoded image before the IPC detaches the view.
        flushSync(() => setPresentationSnapshot(dataUrl))
        present(false)
      }
      timeout = setTimeout(() => finish(null), PRESENTATION_SNAPSHOT_TIMEOUT_MS)
      void workspaceBrowserHost.snapshot(browserTabId).then(async (dataUrl) => {
        if (cancelled || settled) return
        if (!dataUrl?.startsWith('data:image/png;base64,')) { finish(null); return }
        const image = new Image()
        image.src = dataUrl
        if (image.decode) await image.decode()
        finish(dataUrl)
      }).catch(() => finish(null))
    } else {
      setPresentationSnapshot(null)
      present(pageVisible)
    }
    return () => {
      cancelled = true
      clearTimeout(timeout)
    }
    // Navigation invalidates an image even when the page identity is reused.
  }, [browserTabId, canCommand, navigationId, pageVisible, ready, reportHostError, snapshotRequested])

  useEffect(() => {
    if (!active || !ready) return
    const element = stageRef.current
    if (!element) return
    let cancelled = false
    const update = () => { if (!cancelled) reportBounds() }
    const observer = new ResizeObserver(update)
    observer.observe(element)
    window.addEventListener('resize', update)
    return () => {
      cancelled = true
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [active, ready, reportBounds])

  useLayoutEffect(() => {
    if (active) reportBounds()
  }, [active, appZoom, ready, reportBounds])

  // The capsule must be drawn inside the native page, not behind it in React.
  // The host retains this configuration and replays it after each navigation.
  useEffect(() => {
    if (!ready || !available || !active || !canCommand()) return
    const styles = getComputedStyle(document.documentElement)
    const token = (name: string) => styles.getPropertyValue(name).trim()
    void workspaceBrowserHost.message(browserTabId, {
      v: 1, type: 'browser-controls', zoomFactor: zoom, appZoom,
      copy: {
        zoom: t('workspace.browser.zoom'), zoomOut: t('workspace.browser.zoomOut'),
        zoomIn: t('workspace.browser.zoomIn'), zoomReset: t('workspace.browser.zoomReset'),
      },
      colors: {
        background: token('--color-surface-container-lowest'), foreground: token('--color-text-primary'),
        muted: token('--color-text-secondary'), border: token('--color-border'),
        hover: token('--color-surface-hover'), focus: token('--color-border-focus'), shadow: token('--shadow-dropdown'),
      },
    }).catch(reportHostError)
  }, [active, appZoom, available, browserTabId, canCommand, ready, reportHostError, t, theme, zoom])

  const requestNavigation = (run: () => void) => {
    if (!canCommand()) return
    if (usePreviewSelectionStore.getState().bySession[browserTabId]?.items.length) setPendingNavigation({ run })
    else run()
  }

  const navigate = (input: string, onAccepted?: () => void) => {
    const url = resolveNavigationUrl(input, sessionId)
    if (!url) return
    requestNavigation(() => {
      useWorkspaceStore.getState().updateBrowserTab(sessionId, browserTabId, { loadError: null })
      addressRef.current?.blur()
      onAccepted?.()
      let samePage = false
      try { samePage = new URL(currentAddress).href === new URL(url).href } catch { /* A blank page has no URL yet. */ }
      runNavigationCommand(() => samePage
        ? workspaceBrowserHost.reload(browserTabId)
        : workspaceBrowserHost.navigate(browserTabId, url))
    })
  }

  const applyZoom = (next: number) => {
    if (!canCommand()) return
    const clamped = Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next)) * 10) / 10
    useWorkspaceBrowserStore.getState().setZoom(browserTabId, clamped)
    runCommand(() => workspaceBrowserHost.setZoom(browserTabId, clamped))
  }

  const pickElement = () => {
    if (annotationActive) {
      runCommand(() => workspaceBrowserHost.message(browserTabId, { v: 1, type: 'exit-picker' }))
      return
    }
    const selectionDraft = usePreviewSelectionStore.getState().bySession[browserTabId]
    const message = buildPreviewPickerMessage(selectionDraft?.items.length ? 'batch' : 'single', selectionDraft?.nextNumber ?? 1)
    if (message.type === 'enter-picker') {
      runCommand(() => workspaceBrowserHost.message(browserTabId, { ...message, persistent: true }))
    }
  }

  const runFind = (text: string, findNext: boolean) => {
    if (!text) {
      runCommand(() => workspaceBrowserHost.stopFind(browserTabId))
      return
    }
    runCommand(() => workspaceBrowserHost.find(browserTabId, text, { findNext, forward: true }))
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
    <div ref={browserRootRef} className="relative flex min-h-0 flex-1 flex-col">
      <div
        data-testid="workspace-browser-toolbar"
        className="flex h-[52px] shrink-0 items-center gap-1 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-2.5"
      >
        <IconButton
          icon={<ArrowLeft size={15} strokeWidth={1.9} />}
          label={t('workspace.browser.back')}
          size="md"
          tone="muted"
          disabled={!ready || !page?.canGoBack}
          onClick={() => requestNavigation(() => runNavigationCommand(() => workspaceBrowserHost.goBack(browserTabId)))}
        />
        <IconButton
          icon={<ArrowRight size={15} strokeWidth={1.9} />}
          label={t('workspace.browser.forward')}
          size="md"
          tone="muted"
          disabled={!ready || !page?.canGoForward}
          onClick={() => requestNavigation(() => runNavigationCommand(() => workspaceBrowserHost.goForward(browserTabId)))}
        />
        <IconButton
          icon={loading ? <Spinner size={15} /> : <RotateCw size={15} strokeWidth={1.9} />}
          label={t(loading ? 'workspace.browser.stop' : 'workspace.browser.reload')}
          size="md"
          tone="muted"
          aria-busy={loading}
          disabled={!ready}
          onClick={() => {
            if (loading) {
              navigationRequestRef.current += 1
              runCommand(() => workspaceBrowserHost.stop(browserTabId))
            } else requestNavigation(() => runNavigationCommand(() => workspaceBrowserHost.reload(browserTabId)))
          }}
        />
        <WorkspaceBrowserAddressBar
          key={browserTabId}
          ref={addressRef}
          currentAddress={currentAddress}
          active={active}
          disabled={!ready}
          blank={!tab.url}
          visits={visits}
          resolveAddress={(input) => resolveNavigationUrl(input, sessionId)}
          onNavigate={navigate}
          onOpenExternal={(url) => { void getDesktopHost().shell.open(url) }}
        />
        <IconButton
          icon={<MessageSquarePlus size={16} strokeWidth={1.75} />}
          label={t(annotationActive ? 'workspace.browser.annotationActive' : 'workspace.browser.pickElement')}
          pressed={annotationActive}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && annotationActive) {
              event.preventDefault()
              event.stopPropagation()
              runCommand(() => workspaceBrowserHost.message(browserTabId, { v: 1, type: 'exit-picker' }))
            }
          }}
          size="md"
          tone="muted"
          disabled={!ready || !tab.url || !!tab.loadError}
          data-testid="workspace-browser-annotate"
          onClick={pickElement}
        />
        <IconButton
          ref={menuTriggerRef}
          icon={<MoreVertical size={15} strokeWidth={1.9} />}
          label={t('workspace.browser.menu')}
          size="md"
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
                runCommand(() => workspaceBrowserHost.stopFind(browserTabId))
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
              runCommand(() => workspaceBrowserHost.stopFind(browserTabId))
            }}
          />
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1 overflow-hidden" data-testid="workspace-browser-stage">
        <div ref={stageRef} className="absolute inset-0" />
        {presentationSnapshot ? (
          <img
            data-testid="workspace-browser-backdrop"
            src={presentationSnapshot}
            alt=""
            aria-hidden="true"
            draggable={false}
            className="pointer-events-none absolute inset-0 h-full w-full object-fill"
          />
        ) : null}
        {!tab.url && !tab.loadError ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
            <Globe size={32} strokeWidth={1.75} aria-hidden="true" className="mb-2 text-[var(--color-text-tertiary)]" />
            <p className="text-[16px] font-medium text-[var(--color-text-primary)]">
              {t('workspace.browser.emptyTitle')}
            </p>
            <p className="text-[14px] text-[var(--color-text-secondary)]">
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
                if (ready) runNavigationCommand(() => workspaceBrowserHost.reload(browserTabId, { ignoreCache: true }))
                else setCreateAttempt((attempt) => attempt + 1)
              }}
              className="mt-1 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
            >
              {t('workspace.browser.retry')}
            </button>
          </div>
        ) : null}
      </div>

      <WorkspaceBrowserSelectionBar sessionId={sessionId} browserTabId={browserTabId} />
      <ConfirmDialog
        open={pendingNavigation !== null}
        onClose={() => setPendingNavigation(null)}
        onConfirm={async () => {
          const pending = pendingNavigation
          if (!pending) return
          await discardBrowserSelections(browserTabId)
          setPendingNavigation(null)
          pending.run()
        }}
        title={t('browser.selection.navigationTitle')}
        body={t('browser.selection.navigationBody', { count: selectionCount })}
        confirmLabel={t('browser.selection.navigationContinue')}
        cancelLabel={t('browser.selection.cancel')}
      />
      {panel !== null ? (
        <div
          ref={panelRef}
          data-testid={`workspace-browser-panel-${panel}`}
          className="absolute inset-x-0 bottom-0 top-[52px] z-[var(--z-raised)] flex flex-col border-t border-[var(--color-border)] bg-[var(--color-surface)]"
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
          className="absolute right-2 top-[52px] z-[var(--z-dropdown)] w-[288px] max-w-[calc(100%_-_16px)] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] py-1.5 shadow-[var(--shadow-dropdown)]"
        >
          <BrowserMenuItem
            label={t('workspace.browser.findInPage')}
            disabled={!ready || !tab.url}
            onSelect={() => { setFindOpen(true); setMenuOpen(false) }}
          />
          <BrowserMenuItem
            label={t('workspace.browser.print')}
            disabled={!ready || !tab.url}
            onSelect={() => { runCommand(() => workspaceBrowserHost.printToPdf(browserTabId)); setMenuOpen(false) }}
          />
          <div className="mx-3.5 my-1 border-t border-[var(--color-border)]" />
          <div className="flex h-11 items-center justify-between gap-2 px-3.5">
            <span className="text-[13px] text-[var(--color-text-primary)]">
              {t('workspace.browser.zoom')}
            </span>
            <span className="flex items-center gap-1">
              <span className="flex items-center overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-hover)]">
                <IconButton
                  icon={<Minus size={14} />}
                  label={t('workspace.browser.zoomOut')}
                  size="sm"
                  tone="muted"
                  disabled={!ready || zoom <= MIN_ZOOM}
                  onClick={() => applyZoom(zoom - ZOOM_STEP)}
                />
                <span className="min-w-[46px] border-x border-[var(--color-border)] text-center text-[13px] tabular-nums text-[var(--color-text-primary)]">
                  {Math.round(zoom * 100)}%
                </span>
                <IconButton
                  icon={<Plus size={14} />}
                  label={t('workspace.browser.zoomIn')}
                  size="sm"
                  tone="muted"
                  disabled={!ready || zoom >= MAX_ZOOM}
                  onClick={() => applyZoom(zoom + ZOOM_STEP)}
                />
              </span>
              <IconButton
                icon={<RotateCw size={15} />}
                label={t('workspace.browser.zoomReset')}
                size="sm"
                tone="muted"
                disabled={!ready || zoom === 1}
                onClick={() => applyZoom(1)}
              />
            </span>
          </div>
          <div className="my-1 border-t border-[var(--color-border)]" />
          <BrowserMenuItem
            label={t('workspace.browser.capture')}
            disabled={!ready || !tab.url}
            onSelect={() => { runCommand(() => workspaceBrowserHost.capture(browserTabId, 'full')); setMenuOpen(false) }}
          />
          <div className="my-1 border-t border-[var(--color-border)]" />
          <BrowserMenuItem
            label={t('workspace.browser.downloads')}
            onSelect={() => { setPanel('downloads'); setMenuOpen(false) }}
          />
          <BrowserMenuItem
            label={t('workspace.browser.history')}
            onSelect={() => { setPanel('history'); setMenuOpen(false) }}
          />
        </div>
      ) : null}
    </div>
  )
}

function BrowserMenuItem({
  label,
  onSelect,
  disabled = false,
}: {
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
      className="flex h-9 w-full items-center px-3.5 text-left text-[13px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-border-focus)] disabled:cursor-not-allowed disabled:text-[var(--color-text-tertiary)] disabled:hover:bg-transparent"
    >
      {label}
    </button>
  )
}
