import { useCallback, useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { X } from 'lucide-react'
import { IconButton } from '@/components/ui/IconButton'
import { t, useTranslation } from '../../i18n'
import { useChatStore } from '../../stores/chatStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { buildSelectionDirectMessage, type SelectionPayload } from '../../lib/selectionComposer'
import { useWorkspaceBrowserStore } from '../../stores/workspaceBrowserStore'
import { useWorkspaceContentStore } from '../../stores/workspaceContentStore'
import { openWorkspaceTarget, workspaceOpen } from '../../lib/workspace/openTarget'
import { subscribeWorkspaceBrowserEvents } from '../../lib/workspace/browserHost'
import type { WorkspaceDock, WorkspaceTabKind } from '../../lib/workspace/types'
import { WorkspaceTabStrip } from './WorkspaceTabStrip'
import { WorkspaceLauncher } from './WorkspaceLauncher'
import { WorkspaceLayoutControls } from './WorkspaceLayoutControls'
import { WorkspaceBrowserTab } from './WorkspaceBrowserTab'
import { WorkspaceTerminalTab } from './WorkspaceTerminalTab'
import { WorkspaceFileTab } from './WorkspaceFileTab'
import { WorkspaceReviewTab } from './WorkspaceReviewTab'

/** The bottom dock is a terminal dock; everything else lives on the side. */
const BOTTOM_DOCK_KINDS: readonly WorkspaceTabKind[] = ['terminal']

export type WorkspaceSurfaceProps = {
  sessionId: string
  dock: WorkspaceDock
  /** Where a new terminal starts, and the root the file tree reads. */
  cwd: string
  /** Reason the review entry is unavailable here, e.g. "not a Git repository". */
  reviewUnavailableReason?: string | null
  showLayoutControls?: boolean
  /**
   * Whether this dock is on screen. The bottom dock stays mounted while hidden
   * so xterm keeps its geometry, so "mounted" and "visible" are not the same
   * question and the content needs to be told which one it is.
   */
  visible?: boolean
  /** Hide-this-panel affordance for docks without the full layout trio. */
  onHidePanel?: () => void
}

/**
 * One dock of the workspace: a mixed tab strip over the active tab's content.
 *
 * The strip is always present, including for a single tab — the reference does
 * the same, and it is what makes "this panel holds resources, and here they
 * are" true at every moment instead of only once a second thing is open.
 */
export function WorkspaceSurface({
  sessionId,
  dock,
  cwd,
  reviewUnavailableReason = null,
  showLayoutControls = true,
  visible = true,
  onHidePanel,
}: WorkspaceSurfaceProps) {
  const t = useTranslation()
  const [pickerOpen, setPickerOpen] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  const tabs = useWorkspaceStore(
    useShallow((state) => (state.bySession[sessionId]?.tabs ?? []).filter((tab) => tab.dock === dock)),
  )
  const activeTabId = useWorkspaceStore((state) =>
    dock === 'side'
      ? state.bySession[sessionId]?.activeSideTabId ?? null
      : state.bySession[sessionId]?.activeBottomTabId ?? null,
  )
  const layout = useWorkspaceStore((state) => state.bySession[sessionId]?.layout ?? 'hidden')
  const bottomOpen = useWorkspaceStore((state) => state.bySession[sessionId]?.bottomOpen ?? false)
  const canReopenClosed = useWorkspaceStore(
    (state) => (state.bySession[sessionId]?.closed.length ?? 0) > 0,
  )
  const focus = useWorkspaceStore((state) => state.bySession[sessionId]?.focus ?? null)
  // Without this the branch comparison is unreachable: the picker only offers it
  // when it knows which branch to compare against.
  const defaultBranchRef = useWorkspaceContentStore(
    (state) => state.statusBySession[sessionId]?.branch ?? null,
  )

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null

  /*
    This surface can only ever honour a request to focus its *content*. The two
    toggle targets are handled by `useWorkspaceFocusReturn`, which lives in a
    component that outlives the panel — hiding the workspace unmounts everything
    here, so a `side-toggle` request raised by that very action could never be
    consumed from inside it, and would then fire stale on the next reopen and
    park focus on the button that hides the panel again.
  */
  useEffect(() => {
    if (!focus) return
    const wanted = dock === 'side' ? 'active-side-tab' : 'active-bottom-tab'
    if (focus.target !== wanted) return
    contentRef.current?.focus({ preventScroll: true })
    useWorkspaceStore.getState().consumeFocusRequest(sessionId)
  }, [dock, focus, sessionId])

  const handleLauncherSelect = useCallback((kind: WorkspaceTabKind) => {
    setPickerOpen(false)
    // The picker is the one entry point allowed to consume a blank new-tab
    // page — the user is choosing what this slot should hold. Every other
    // opener must leave it alone: a browser tab counts as blank until the host
    // reports a committed URL, so between pressing Enter in the address bar and
    // the page committing, an unrelated open would destroy a page mid-load.
    const replaceBlankPlaceholder = true
    switch (kind) {
      case 'review':
        openWorkspaceTarget({ sessionId, target: { kind: 'review' }, replaceBlankPlaceholder })
        break
      case 'terminal':
        openWorkspaceTarget({
          sessionId,
          target: { kind: 'terminal', cwd, dock },
          replaceBlankPlaceholder,
        })
        break
      case 'browser':
        openWorkspaceTarget({ sessionId, target: { kind: 'browser' } })
        break
      case 'file':
        // The tree comes with the file view, so opening "Files" with nothing
        // chosen yet is a tree with an empty content pane rather than a modal.
        openWorkspaceTarget({
          sessionId,
          target: { kind: 'file', path: '' },
          preview: true,
          replaceBlankPlaceholder,
        })
        break
    }
  }, [cwd, dock, sessionId])

  const layoutControls = !showLayoutControls ? (
    onHidePanel ? (
      <IconButton
        icon={<X size={15} strokeWidth={1.9} />}
        label={t('workspace.controls.bottomPanel')}
        size="sm"
        tone="muted"
        data-testid="workspace-hide-bottom"
        onClick={onHidePanel}
      />
    ) : null
  ) : (
    <WorkspaceLayoutControls
      layout={layout}
      bottomOpen={bottomOpen}
      onToggleFullscreen={() => useWorkspaceStore.getState().toggleFullscreen(sessionId)}
      onToggleBottom={() => useWorkspaceStore.getState().toggleBottomPanel(sessionId, cwd)}
      onToggleWorkspace={() => useWorkspaceStore.getState().toggleWorkspace(sessionId)}
    />
  )

  return (
    <div
      data-testid={`workspace-surface-${dock}`}
      aria-label={t('workspace.panelLabel')}
      className="flex h-full min-h-0 w-full flex-col bg-[var(--color-surface)]"
    >
      <WorkspaceTabStrip
        dock={dock}
        tabs={tabs}
        activeTabId={activeTabId}
        trailing={layoutControls}
        canReopenClosed={canReopenClosed}
        onActivate={(tabId) => {
          // Choosing an existing tab is also a way of cancelling the picker.
          setPickerOpen(false)
          useWorkspaceStore.getState().activateTab(sessionId, tabId)
        }}
        onPin={(tabId) => useWorkspaceStore.getState().pinTab(sessionId, tabId)}
        onClose={(tabId) => useWorkspaceStore.getState().closeTab(sessionId, tabId)}
        onCloseScope={(tabId, scope) => useWorkspaceStore.getState().closeTabs(sessionId, tabId, scope)}
        onReorder={(tabId, index) => useWorkspaceStore.getState().moveTab(sessionId, tabId, index)}
        onMoveDock={(tabId, nextDock) =>
          useWorkspaceStore.getState().moveTabToDock(sessionId, tabId, nextDock)}
        onReopenClosed={() => useWorkspaceStore.getState().reopenClosedTab(sessionId)}
        onAdd={() => setPickerOpen(true)}
      />

      <div
        ref={contentRef}
        tabIndex={-1}
        role="tabpanel"
        id={`workspace-tabpanel-${dock}`}
        // The strip emits this exact id on every `role="tab"`; without the
        // pairing the tablist announces a control that governs nothing.
        {...(activeTabId ? { 'aria-labelledby': `workspace-tab-${dock}-${activeTabId}` } : {})}
        className="flex min-h-0 flex-1 flex-col outline-none"
        onKeyDown={(event) => {
          // Without this the picker is a one-way door: it covers the active
          // tab's content and the only way back is to open a fifth thing.
          if (pickerOpen && event.key === 'Escape') {
            event.stopPropagation()
            setPickerOpen(false)
          }
        }}
      >
        {pickerOpen && tabs.length > 0 ? (
          <WorkspacePickerOverlay
            onCancel={() => setPickerOpen(false)}
            cancelLabel={t('workspace.pickerCancel')}
          >
            <WorkspaceLauncher
              onSelect={handleLauncherSelect}
              {...(dock === 'bottom' ? { kinds: BOTTOM_DOCK_KINDS } : {})}
              reviewUnavailableReason={dock === 'bottom' ? null : reviewUnavailableReason}
            />
          </WorkspacePickerOverlay>
        ) : tabs.length === 0 ? (
          <WorkspaceLauncher
            onSelect={handleLauncherSelect}
            {...(dock === 'bottom' ? { kinds: BOTTOM_DOCK_KINDS } : {})}
            reviewUnavailableReason={dock === 'bottom' ? null : reviewUnavailableReason}
          />
        ) : activeTab === null ? null : activeTab.kind === 'browser' ? (
          <WorkspaceBrowserTab sessionId={sessionId} tab={activeTab} active={visible} />
        ) : activeTab.kind === 'terminal' ? (
          <WorkspaceTerminalTab sessionId={sessionId} tab={activeTab} active={visible} />
        ) : activeTab.kind === 'file' ? (
          <WorkspaceFileTab sessionId={sessionId} tab={activeTab} />
        ) : (
          <WorkspaceReviewTab
            sessionId={sessionId}
            tab={activeTab}
            defaultBranchRef={defaultBranchRef}
          />
        )}
      </div>
    </div>
  )
}

/**
 * The `+` picker shown over an existing tab, with an explicit way out.
 *
 * It is a separate frame from the empty-workspace launcher on purpose: with no
 * tabs there is nothing to cancel back to, and offering a cancel that lands on
 * a blank pane would be worse than not offering one.
 */
function WorkspacePickerOverlay({
  children,
  onCancel,
  cancelLabel,
}: {
  children: React.ReactNode
  onCancel: () => void
  cancelLabel: string
}) {
  return (
    <div
      data-testid="workspace-picker"
      className="flex min-h-0 flex-1 flex-col bg-[var(--color-surface)]"
    >
      <div className="flex shrink-0 justify-end px-2 pt-2">
        <IconButton
          icon={<X size={14} strokeWidth={1.9} />}
          label={cancelLabel}
          size="xs"
          tone="muted"
          data-testid="workspace-picker-cancel"
          onClick={onCancel}
        />
      </div>
      {children}
    </div>
  )
}

/**
 * Bridge host page events into the stores, once per app.
 *
 * Two things have to be true at once, and the obvious implementation gets the
 * second one wrong:
 *
 * 1. The subscription must outlive any single tab's React surface — events keep
 *    arriving for pages whose surface is not mounted (a background tab finishing
 *    a load, a download completing).
 * 2. Each event belongs to the task that **owns the page**, which is not
 *    necessarily the task on screen. Routing by the foreground session drops
 *    every event for a backgrounded task's pages, and — far worse — makes a
 *    `window.open` from one task's page create a tab in whichever task the user
 *    happens to be reading.
 *
 * So the subscription is opened once and the owner is resolved from the page id.
 */
export function useWorkspaceBrowserEventBridge(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    let unsubscribe: (() => void) | undefined
    let cancelled = false

    void subscribeWorkspaceBrowserEvents((event) => {
      useWorkspaceBrowserStore.getState().applyEvent(event)

      const store = useWorkspaceStore.getState()
      const owner = store.findBrowserTabOwner(event.tabId)
      // A page that no longer belongs to any tab has been closed; its late
      // events must not be applied to whatever took its place.
      if (!owner) return

      switch (event.type) {
        case 'state':
          store.updateBrowserTab(owner.sessionId, event.tabId, {
            url: event.url || null,
            title: event.title || null,
          })
          break
        case 'failed':
          store.updateBrowserTab(owner.sessionId, event.tabId, {
            loadError: event.errorDescription || String(event.errorCode),
          })
          break
        case 'destroyed':
          store.updateBrowserTab(owner.sessionId, event.tabId, {
            // A reason code is not a message. It reaches the error overlay, so
            // it has to be a translated sentence in all five languages.
            loadError: t(event.reason === 'crashed'
              ? 'workspace.browser.pageCrashed'
              : 'workspace.browser.pageClosed'),
          })
          break
        case 'new-window':
          // A popup or `target=_blank` becomes a sibling tab in the task whose
          // page opened it, and never steals focus from a different task.
          workspaceOpen.browser(owner.sessionId, event.url, { background: true })
          break
        case 'screenshot':
          // The host does the capture and emits the result; without a consumer
          // the "capture screenshot" menu item did the work and threw it away.
          useChatStore.getState().queueComposerPrefill(owner.sessionId, {
            text: '',
            mode: 'append',
            attachments: [{
              type: 'image',
              name: `screenshot-${event.kind}.png`,
              mimeType: 'image/png',
              data: event.dataUrl,
            }],
          })
          break
        case 'agent':
          deliverBrowserAgentMessage(owner.sessionId, event.message)
          break
        default:
          break
      }
    }).then((dispose) => {
      if (cancelled) dispose()
      else unsubscribe = dispose
    })

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [enabled])
}

/**
 * Deliver an in-page selection to the conversation.
 *
 * Only the direct path is wired: the element picker hands back one selection
 * and it lands in the composer with its screenshot attached. The legacy
 * multi-select queue is not reproduced here, so a payload asking to be queued
 * is delivered directly rather than dropped — losing the user's pick silently
 * is worse than delivering it one at a time.
 */
function deliverBrowserAgentMessage(sessionId: string, message: unknown): void {
  if (typeof message !== 'object' || message === null) return
  const parsed = message as { type?: string; payload?: unknown }
  if (parsed.type !== 'selection') return

  const payload = parsed.payload as SelectionPayload | undefined
  if (!payload || typeof payload !== 'object' || !payload.element) return

  const selection = buildSelectionDirectMessage(payload)
  const attachments = payload.screenshot?.dataUrl
    ? [{
        type: 'image' as const,
        name: selection.displayName,
        mimeType: 'image/png',
        data: payload.screenshot.dataUrl,
        note: selection.note,
        quote: payload.element.selector,
      }]
    : []

  useChatStore.getState().queueComposerPrefill(sessionId, {
    text: selection.modelText,
    mode: 'append',
    attachments,
  })
}
