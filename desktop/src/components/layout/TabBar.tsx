import { useMemo, useRef, useState, useEffect, useCallback } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  SCHEDULED_TAB_ID,
  SETTINGS_TAB_ID,
  MARKET_TAB_ID,
  SUBAGENT_TAB_PREFIX,
  TERMINAL_TAB_PREFIX,
  TRACE_LIST_TAB_ID,
  TRACE_TAB_PREFIX,
  WORKBENCH_TAB_PREFIX,
  useTabStore,
  type Tab,
} from '../../stores/tabStore'
import { useChatStore } from '../../stores/chatStore'
import { useSessionStore } from '../../stores/sessionStore'
import { isPlaceholderSessionTitle } from '../../lib/sessionTitle'
import { useWorkspacePanelStore } from '../../stores/workspacePanelStore'
import { useTerminalPanelStore } from '../../stores/terminalPanelStore'
import { useBrowserPanelStore } from '../../stores/browserPanelStore'
import { useCLITaskStore } from '../../stores/cliTaskStore'
import { useTeamStore } from '../../stores/teamStore'
import { useTranslation } from '../../i18n'
import { getDesktopHost } from '../../lib/desktopHost'
import { hasRunningBackgroundTasks } from '../../lib/backgroundTasks'
import { WindowControls, showWindowControls } from './WindowControls'
import { OpenProjectMenu } from './OpenProjectMenu'
import { ChevronLeft, ChevronRight, Folder, FolderOpen, SquareTerminal } from 'lucide-react'
import { ActionDialog } from '../shared/ActionDialog'
import { buildSessionActivityModel, hasVisibleSessionActivity } from '../activity/sessionActivityModel'
import { SessionActivityButton } from '../activity/SessionActivityButton'
import { useActivityPanelStore } from '../../stores/activityPanelStore'
import { getSessionBrowsablePath } from '../../lib/sessionWorkspace'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '../ui/context-menu'
import { IconButton } from '../ui/custom/icon-button'
import { DesktopTab, TAB_WIDTH } from '../ui/custom/desktop-tab'

const DRAG_START_THRESHOLD = 4
const desktopHost = getDesktopHost()
const isDesktopRuntime = desktopHost.isDesktop
const EMPTY_DISMISSED_BACKGROUND_TASK_KEYS: readonly string[] = []

type PendingCloseRequest = {
  tabs: Tab[]
  runningSessionIds: string[]
}

function isSessionTab(tab: Tab | null) {
  if (!tab) return false
  const tabType = (tab as Partial<Tab>).type
  if (tabType === 'session') return true
  if (tabType) return false
  return isSessionTabId(tab.sessionId)
}

function isSessionTabId(tabId: string | null) {
  if (!tabId) return false
  return tabId !== SETTINGS_TAB_ID &&
    tabId !== SCHEDULED_TAB_ID &&
    tabId !== MARKET_TAB_ID &&
    tabId !== TRACE_LIST_TAB_ID &&
    !tabId.startsWith(TERMINAL_TAB_PREFIX) &&
    !tabId.startsWith(TRACE_TAB_PREFIX) &&
    !tabId.startsWith(WORKBENCH_TAB_PREFIX) &&
    !tabId.startsWith(SUBAGENT_TAB_PREFIX)
}

export function TabBar() {
  const tabs = useTabStore((s) => s.tabs)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const setActiveTab = useTabStore((s) => s.setActiveTab)
  const closeTab = useTabStore((s) => s.closeTab)
  const sessionTabIds = useMemo(
    () => tabs.filter((tab) => isSessionTab(tab)).map((tab) => tab.sessionId),
    [tabs],
  )
  const activeChatSessionIds = useChatStore(useShallow((s) =>
    sessionTabIds.filter((sessionId) => {
      const sessionState = s.sessions[sessionId]
      return !!sessionState &&
        (sessionState.chatState !== 'idle' || hasRunningBackgroundTasks(sessionState.backgroundAgentTasks))
    })
  ))
  const disconnectSession = useChatStore((s) => s.disconnectSession)
  const activeTab = tabs.find((tab) => tab.sessionId === activeTabId) ?? null
  const isActiveSessionTab = isSessionTab(activeTab) || isSessionTabId(activeTabId)
  const activeSession = useSessionStore((state) =>
    activeTabId ? state.sessions.find((session) => session.id === activeTabId) : undefined,
  )
  const openProjectPath = isActiveSessionTab
    ? getSessionBrowsablePath(activeSession) ?? null
    : null
  // The right-side panel is now a single unified "workbench" with a per-session
  // mode (file ↔ browser). The folder/browser toolbar buttons reflect whether
  // the panel is open in their respective mode.
  const isWorkbenchOpen = useWorkspacePanelStore((state) =>
    activeTabId && isActiveSessionTab ? state.isPanelOpen(activeTabId) : false,
  )
  const workbenchMode = useWorkspacePanelStore((state) =>
    activeTabId && isActiveSessionTab ? state.getMode(activeTabId) : 'workspace',
  )
  const isWorkspacePanelOpen = isWorkbenchOpen && workbenchMode === 'workspace'
  const isTerminalPanelOpen = useTerminalPanelStore((state) =>
    activeTabId && isActiveSessionTab ? state.isPanelOpen(activeTabId) : false,
  )
  const cliTasks = useCLITaskStore((state) => state.tasks)
  const cliTasksSessionId = useCLITaskStore((state) => state.sessionId)
  const cliTasksCompletedAndDismissed = useCLITaskStore((state) => state.completedAndDismissed)
  const dismissedBackgroundTaskKeyList = useActivityPanelStore((state) =>
    activeTabId
      ? state.dismissedBackgroundTaskKeysBySession[activeTabId] ?? EMPTY_DISMISSED_BACKGROUND_TASK_KEYS
      : EMPTY_DISMISSED_BACKGROUND_TASK_KEYS,
  )
  const dismissedBackgroundTaskKeys = useMemo(
    () => new Set(dismissedBackgroundTaskKeyList),
    [dismissedBackgroundTaskKeyList],
  )
  const activityTeamMembers = useTeamStore(useShallow((state) => {
    const activeTeam = state.activeTeam
    if (!activeTabId || !activeTeam || activeTeam.leadSessionId !== activeTabId) {
      return []
    }
    return activeTeam.members.filter((member) =>
      !activeTeam.leadAgentId || member.agentId !== activeTeam.leadAgentId
    )
  }))
  const activityState = useChatStore(useShallow((state) => {
    if (!activeTabId || !isActiveSessionTab) {
      return { hasVisibleActivity: false }
    }
    const sessionState = state.sessions[activeTabId]
    const includeCliTasks = cliTasksSessionId === activeTabId

    const model = buildSessionActivityModel({
      sessionId: activeTabId,
      messages: sessionState?.messages ?? [],
      tasks: includeCliTasks ? cliTasks : [],
      completedAndDismissed: includeCliTasks ? cliTasksCompletedAndDismissed : false,
      backgroundTasks: Object.values(sessionState?.backgroundAgentTasks ?? {}),
      dismissedBackgroundTaskKeys,
      agentNotifications: Object.values(sessionState?.agentTaskNotifications ?? {}),
      teamMembers: activityTeamMembers,
    })
    return {
      hasVisibleActivity: hasVisibleSessionActivity(model),
    }
  }))
  const showActivityButton = activeTabId && activityState.hasVisibleActivity && !isWorkbenchOpen

  const moveTab = useTabStore((s) => s.moveTab)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const [pendingCloseRequest, setPendingCloseRequest] = useState<PendingCloseRequest | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [draggingSessionId, setDraggingSessionId] = useState<string | null>(null)
  const [dragOffsetX, setDragOffsetX] = useState(0)
  const dragIndexRef = useRef<number | null>(null)
  const pendingDragRef = useRef<{ index: number; startX: number; startY: number } | null>(null)
  const suppressClickRef = useRef(false)
  const tabRefs = useRef(new Map<string, HTMLDivElement | null>())
  const t = useTranslation()
  const runningSessionIds = useMemo(() => {
    const ids = new Set<string>()
    for (const tab of tabs) {
      if (isSessionTab(tab) && tab.status === 'running') ids.add(tab.sessionId)
    }
    for (const sessionId of activeChatSessionIds) {
      ids.add(sessionId)
    }
    return ids
  }, [activeChatSessionIds, tabs])

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 0)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
  }, [])

  useEffect(() => {
    updateScrollState()
    const el = scrollRef.current
    if (!el) return
    el.addEventListener('scroll', updateScrollState)
    const ro = new ResizeObserver(updateScrollState)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', updateScrollState)
      ro.disconnect()
    }
  }, [updateScrollState, tabs.length])

  useEffect(() => {
    if (!activeTabId) return
    const activeTabEl = tabRefs.current.get(activeTabId)
    if (!activeTabEl) return

    activeTabEl.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'smooth',
    })

    const frame = window.requestAnimationFrame(updateScrollState)
    return () => window.cancelAnimationFrame(frame)
  }, [activeTabId, tabs.length, updateScrollState])

  const scroll = (direction: 'left' | 'right') => {
    const el = scrollRef.current
    if (!el) return
    el.scrollBy({ left: direction === 'left' ? -TAB_WIDTH : TAB_WIDTH, behavior: 'smooth' })
  }

  const closeTabWithCleanup = useCallback((tab: Tab) => {
    if (isSessionTab(tab)) {
      useWorkspacePanelStore.getState().clearSession(tab.sessionId)
      useBrowserPanelStore.getState().clearSession(tab.sessionId)
      useTerminalPanelStore.getState().clearSession(tab.sessionId)
      useActivityPanelStore.getState().close(tab.sessionId)
    }
    closeTab(tab.sessionId)
  }, [closeTab])

  const getRunningSessionIds = useCallback((targetTabs: Tab[]) => {
    const chatSessions = useChatStore.getState().sessions
    return targetTabs
      .filter((tab) => isSessionTab(tab))
      .filter((tab) => {
        const sessionState = chatSessions[tab.sessionId]
        return !!sessionState &&
          (sessionState.chatState !== 'idle' || hasRunningBackgroundTasks(sessionState.backgroundAgentTasks))
      })
      .map((tab) => tab.sessionId)
  }, [])

  const closeTabsWithPolicy = useCallback((targetTabs: Tab[], runningSessionIds: string[], stopRunning: boolean) => {
    const runningSessionSet = new Set(runningSessionIds)

    for (const tab of targetTabs) {
      if (isSessionTab(tab)) {
        const isRunning = runningSessionSet.has(tab.sessionId)
        if (isRunning && stopRunning) {
          useChatStore.getState().stopGeneration(tab.sessionId)
        }
        if (!isRunning || stopRunning) {
          // Auto-delete empty sessions (placeholder title, no messages sent)
          const sessionEntry = useSessionStore.getState().sessions.find((s) => s.id === tab.sessionId)
          const chatEntry = useChatStore.getState().sessions[tab.sessionId]
          if (isPlaceholderSessionTitle(sessionEntry?.title) && (!chatEntry || chatEntry.messages.length === 0)) {
            void useSessionStore.getState().deleteSession(tab.sessionId)
          }
          disconnectSession(tab.sessionId)
        }
      }
      closeTabWithCleanup(tab)
    }
  }, [closeTabWithCleanup, disconnectSession])

  const requestCloseTabs = useCallback((targetTabs: Tab[]) => {
    if (targetTabs.length === 0) return
    const runningSessionIds = getRunningSessionIds(targetTabs)

    if (runningSessionIds.length > 0) {
      setPendingCloseRequest({ tabs: targetTabs, runningSessionIds })
      return
    }

    closeTabsWithPolicy(targetTabs, [], false)
  }, [closeTabsWithPolicy, getRunningSessionIds])

  const handleClose = (sessionId: string) => {
    const tab = tabs.find((t) => t.sessionId === sessionId)
    if (!tab) return
    requestCloseTabs([tab])
  }

  const handleCloseOthers = (sessionId: string) => {
    const otherTabs = tabs.filter((t) => t.sessionId !== sessionId)
    requestCloseTabs(otherTabs)
  }

  const handleCloseLeft = (sessionId: string) => {
    const idx = tabs.findIndex((t) => t.sessionId === sessionId)
    const leftTabs = tabs.slice(0, idx)
    requestCloseTabs(leftTabs)
  }

  const handleCloseRight = (sessionId: string) => {
    const idx = tabs.findIndex((t) => t.sessionId === sessionId)
    const rightTabs = tabs.slice(idx + 1)
    requestCloseTabs(rightTabs)
  }

  const handleCloseAll = () => {
    requestCloseTabs(tabs)
  }

  const getTargetIndexFromClientX = useCallback((clientX: number) => {
    for (let index = 0; index < tabs.length; index++) {
      const tab = tabs[index]
      if (!tab) continue
      const el = tabRefs.current.get(tab.sessionId)
      if (!el) continue
      const rect = el.getBoundingClientRect()
      if (clientX < rect.left + rect.width / 2) return index
    }

    return tabs.length > 0 ? tabs.length - 1 : null
  }, [tabs])

  const finalizeDrag = useCallback((targetIndex: number | null) => {
    if (dragIndexRef.current !== null && targetIndex !== null && dragIndexRef.current !== targetIndex) {
      moveTab(dragIndexRef.current, targetIndex)
    }
    dragIndexRef.current = null
    pendingDragRef.current = null
    setDraggingSessionId(null)
    setDragOffsetX(0)
    setDragOverIndex(null)
  }, [moveTab])

  const handlePointerMove = useCallback((event: MouseEvent) => {
    const pending = pendingDragRef.current
    if (!pending) return

    const deltaX = Math.abs(event.clientX - pending.startX)
    const deltaY = Math.abs(event.clientY - pending.startY)

    if (dragIndexRef.current === null) {
      if (Math.max(deltaX, deltaY) < DRAG_START_THRESHOLD) return
      dragIndexRef.current = pending.index
      suppressClickRef.current = true
      setDraggingSessionId(tabs[pending.index]?.sessionId ?? null)
    }

    setDragOffsetX(event.clientX - pending.startX)

    const targetIndex = getTargetIndexFromClientX(event.clientX)
    if (targetIndex === null || targetIndex === dragIndexRef.current) {
      setDragOverIndex(null)
      return
    }

    setDragOverIndex(targetIndex)
  }, [getTargetIndexFromClientX])

  const handlePointerUp = useCallback(() => {
    finalizeDrag(dragOverIndex)
  }, [dragOverIndex, finalizeDrag])

  useEffect(() => {
    window.addEventListener('mousemove', handlePointerMove)
    window.addEventListener('mouseup', handlePointerUp)
    return () => {
      window.removeEventListener('mousemove', handlePointerMove)
      window.removeEventListener('mouseup', handlePointerUp)
    }
  }, [handlePointerMove, handlePointerUp])

  useEffect(() => {
    if (!draggingSessionId) return
    const previousCursor = document.body.style.cursor
    document.body.style.cursor = 'grabbing'
    return () => {
      document.body.style.cursor = previousCursor
    }
  }, [draggingSessionId])

  const handleTabMouseDown = (event: React.MouseEvent, index: number) => {
    if (event.button !== 0) return
    pendingDragRef.current = { index, startX: event.clientX, startY: event.clientY }
  }

  const handleTabClick = (sessionId: string) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    setActiveTab(sessionId)
  }

  return (
    <div
      data-testid="tab-bar"
      data-desktop-drag-region={isDesktopRuntime ? true : undefined}
      className="flex min-h-11 items-stretch bg-[var(--color-surface-container)] select-none border-b border-[var(--color-border)]"
    >

      {canScrollLeft && (
        <IconButton
          label={t('tabs.scrollLeft')}
          variant="ghost"
          size="icon-sm"
          onClick={() => scroll('left')}
          className="h-11 w-7 rounded-none"
        >
          <ChevronLeft aria-hidden="true" />
        </IconButton>
      )}

      <div
        ref={scrollRef}
        role="tablist"
        aria-label={t('tabs.openTabs')}
        data-testid="tab-bar-scroll-region"
        data-desktop-drag-region={isDesktopRuntime ? true : undefined}
        className="flex-1 flex items-stretch overflow-x-hidden"
        onDragOver={(e) => e.preventDefault()}
      >
        {tabs.map((tab, index) => (
          <ContextMenu key={tab.sessionId}>
            <ContextMenuTrigger asChild>
              <DesktopTab
                ref={(node) => { tabRefs.current.set(tab.sessionId, node) }}
                tab={tab}
                displayTitle={tab.type === 'settings' ? t('settings.title') : tab.title}
                isRunning={runningSessionIds.has(tab.sessionId)}
                isActive={tab.sessionId === activeTabId}
                isDragOver={dragOverIndex === index}
                isDragging={tab.sessionId === draggingSessionId}
                dragOffsetX={tab.sessionId === draggingSessionId ? dragOffsetX : 0}
                runningLabel={t('tabs.sessionRunning')}
                onClick={() => handleTabClick(tab.sessionId)}
                onClose={() => handleClose(tab.sessionId)}
                onMouseDown={(event) => handleTabMouseDown(event, index)}
              />
            </ContextMenuTrigger>
            <ContextMenuContent className="min-w-40">
              <ContextMenuItem onSelect={() => handleClose(tab.sessionId)}>
                {t('tabs.close')}
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => handleCloseOthers(tab.sessionId)}>
                {t('tabs.closeOthers')}
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => handleCloseLeft(tab.sessionId)}>
                {t('tabs.closeLeft')}
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => handleCloseRight(tab.sessionId)}>
                {t('tabs.closeRight')}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={handleCloseAll}>
                {t('tabs.closeAll')}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ))}
      </div>

      <div className="flex shrink-0 items-center gap-1 border-l border-[var(--color-border)]/70 px-2">
        {showActivityButton && activeTabId && (
          <SessionActivityButton sessionId={activeTabId} />
        )}
        {isDesktopRuntime && isActiveSessionTab && (
          <OpenProjectMenu path={openProjectPath} />
        )}
        <IconButton
          variant="ghost"
          size="icon-sm"
          label={t('tabs.openTerminal')}
          onClick={() => {
            if (activeTabId && isActiveSessionTab) {
              useTerminalPanelStore.getState().togglePanel(activeTabId)
              return
            }
            useTabStore.getState().openTerminalTab()
          }}
          data-active={isTerminalPanelOpen ? 'true' : 'false'}
          className={isTerminalPanelOpen ? 'bg-[var(--color-surface-hover)] text-[var(--color-text-primary)]' : undefined}
        >
          <SquareTerminal aria-hidden="true" />
        </IconButton>
        {isActiveSessionTab && activeTabId && (
          <IconButton
            variant="ghost"
            size="icon-sm"
            label={t(isWorkspacePanelOpen ? 'tabs.hideWorkspace' : 'tabs.showWorkspace')}
            onClick={() => {
              const workbench = useWorkspacePanelStore.getState()
              if (workbench.isPanelOpen(activeTabId) && workbench.getMode(activeTabId) === 'workspace') {
                workbench.closePanel(activeTabId)
              } else {
                workbench.setMode(activeTabId, 'workspace')
                workbench.openPanel(activeTabId)
              }
            }}
            data-active={isWorkspacePanelOpen ? 'true' : 'false'}
            className={isWorkspacePanelOpen ? 'bg-[var(--color-surface-hover)] text-[var(--color-text-primary)]' : undefined}
          >
            {isWorkspacePanelOpen
              ? <FolderOpen aria-hidden="true" />
              : <Folder aria-hidden="true" />}
          </IconButton>
        )}
      </div>

      {isDesktopRuntime && (
        <div
          data-testid="tab-bar-drag-gutter"
          data-desktop-drag-region
          aria-hidden="true"
          className={`min-h-11 flex-shrink-0 ${showWindowControls ? 'w-3' : 'w-4'}`}
        />
      )}

      {canScrollRight && (
        <IconButton
          label={t('tabs.scrollRight')}
          variant="ghost"
          size="icon-sm"
          onClick={() => scroll('right')}
          className="h-11 w-7 rounded-none"
        >
          <ChevronRight aria-hidden="true" />
        </IconButton>
      )}

      <WindowControls />

      <ActionDialog
        open={pendingCloseRequest !== null}
        onClose={() => setPendingCloseRequest(null)}
        title={pendingCloseRequest && pendingCloseRequest.runningSessionIds.length > 1
          ? t('tabs.closeAllConfirmTitle')
          : t('tabs.closeConfirmTitle')}
        body={pendingCloseRequest && pendingCloseRequest.runningSessionIds.length > 1
          ? t('tabs.closeAllConfirmMessage', { count: pendingCloseRequest.runningSessionIds.length })
          : t('tabs.closeConfirmMessage')}
        actions={[
          {
            label: t('common.cancel'),
            onClick: () => setPendingCloseRequest(null),
            variant: 'secondary',
          },
          {
            label: t('tabs.closeConfirmKeep'),
            onClick: () => {
              if (!pendingCloseRequest) return
              closeTabsWithPolicy(pendingCloseRequest.tabs, pendingCloseRequest.runningSessionIds, false)
              setPendingCloseRequest(null)
            },
            variant: 'secondary',
          },
          {
            label: pendingCloseRequest && pendingCloseRequest.runningSessionIds.length > 1
              ? t('tabs.closeAllConfirmStop')
              : t('tabs.closeConfirmStop'),
            onClick: () => {
              if (!pendingCloseRequest) return
              closeTabsWithPolicy(pendingCloseRequest.tabs, pendingCloseRequest.runningSessionIds, true)
              setPendingCloseRequest(null)
            },
            variant: 'danger',
          },
        ]}
      />
    </div>
  )
}
