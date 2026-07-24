import { ArrowLeft, FolderOpen, Globe, Maximize2, X } from 'lucide-react'
import { useTranslation } from '../../i18n'
import {
  useWorkspacePanelStore,
  type WorkbenchMode,
} from '../../stores/workspacePanelStore'
import { useBrowserPanelStore } from '../../stores/browserPanelStore'
import { WORKBENCH_TAB_PREFIX, useTabStore } from '../../stores/tabStore'
import { WorkspacePanel } from '../workspace/WorkspacePanel'
import { BrowserSurface } from '../browser/BrowserSurface'
import { Button } from '../ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
import { IconButton } from '../ui/custom/icon-button'

type WorkbenchPanelProps = {
  sessionId: string
  variant?: 'panel' | 'tab'
  onClose?: () => void
}

const MODE_ITEMS: ReadonlyArray<{
  mode: WorkbenchMode
  labelKey: 'workbench.modeWorkspace' | 'workbench.modeBrowser'
  Icon: typeof FolderOpen
}> = [
  { mode: 'workspace', labelKey: 'workbench.modeWorkspace', Icon: FolderOpen },
  { mode: 'browser', labelKey: 'workbench.modeBrowser', Icon: Globe },
]

/**
 * Unified right-side "Workbench" panel. Hosts the file workspace and the native
 * browser surface behind a single per-session mode switch (file ↔ browser),
 * sharing the panel's open state and width via {@link useWorkspacePanelStore}.
 */
export function WorkbenchPanel({ sessionId, variant = 'panel', onClose }: WorkbenchPanelProps) {
  const t = useTranslation()
  const mode = useWorkspacePanelStore((state) => state.getMode(sessionId))
  const setMode = useWorkspacePanelStore((state) => state.setMode)
  const closePanel = useWorkspacePanelStore((state) => state.closePanel)
  const ensureBlankBrowser = useBrowserPanelStore((state) => state.ensureBlank)
  const isTabVariant = variant === 'tab'

  const handleModeSelect = (nextMode: WorkbenchMode) => {
    if (nextMode === 'browser') {
      ensureBlankBrowser(sessionId)
    }
    setMode(sessionId, nextMode)
  }

  const handleExpand = () => {
    const origin = useWorkspacePanelStore.getState().getOrigin(sessionId)
    useTabStore.getState().openWorkbenchTab(sessionId, t('workbench.tabTitle'), {
      sourceSessionId: sessionId,
      ...(origin ?? {}),
    })
    closePanel(sessionId)
  }

  const handleClose = () => {
    if (onClose) {
      onClose()
      return
    }
    closePanel(sessionId)
  }

  const handleReturn = () => {
    const store = useTabStore.getState()
    const activeTab = store.tabs.find((tab) => tab.sessionId === store.activeTabId)
    const tabId = activeTab?.type === 'workbench' && activeTab.workbenchSessionId === sessionId
      ? activeTab.sessionId
      : `${WORKBENCH_TAB_PREFIX}${sessionId}`
    store.returnFromWorkbench(tabId)
  }

  return (
    <Tabs
      value={mode}
      onValueChange={(value) => handleModeSelect(value as WorkbenchMode)}
      className="flex h-full min-h-0 w-full flex-col gap-0 bg-[var(--color-surface)]"
    >
      <nav
        data-testid="workbench-navigation"
        aria-label={t('workbench.navigation')}
        className="flex h-12 shrink-0 items-center gap-2.5 border-b border-[var(--color-text-primary)]/10 bg-[var(--color-surface)] px-4"
      >
        {isTabVariant && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReturn}
            className="h-8 rounded-[7px] px-2 text-[12px]"
          >
            <ArrowLeft size={15} strokeWidth={2} aria-hidden="true" />
            <span>{t('workbench.backToConversation')}</span>
          </Button>
        )}
        <TabsList
          aria-label={t('workbench.modeSwitch')}
          className="inline-flex items-center gap-0.5 rounded-[8px] bg-[var(--color-surface-container)] p-0.5"
        >
          {MODE_ITEMS.map(({ mode: itemMode, labelKey, Icon }) => (
            <TabsTrigger
              key={itemMode}
              value={itemMode}
              className="h-7 gap-1.5 rounded-[6px] px-2.5 py-0 text-[12px] font-medium data-[state=active]:bg-[var(--color-surface)] data-[state=active]:shadow-[0_1px_2px_rgba(15,23,42,0.08)]"
            >
              <Icon size={15} strokeWidth={2} aria-hidden="true" className="shrink-0" />
              <span>{t(labelKey)}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {!isTabVariant && (
            <IconButton
              label={t('workbench.expand')}
              variant="ghost"
              size="icon-sm"
              onClick={handleExpand}
              className="rounded-[7px]"
            >
              <Maximize2 size={15} strokeWidth={2} aria-hidden="true" />
            </IconButton>
          )}
          <IconButton
            label={t('workbench.close')}
            variant="ghost"
            size="icon-sm"
            onClick={handleClose}
            className="rounded-[7px]"
          >
            <X size={16} strokeWidth={2} aria-hidden="true" />
          </IconButton>
        </div>
      </nav>

      <TabsContent value="workspace" className="m-0 flex min-h-0 flex-1 flex-col">
        <WorkspacePanel sessionId={sessionId} embedded forceVisible={isTabVariant} />
      </TabsContent>
      <TabsContent value="browser" className="m-0 flex min-h-0 flex-1 flex-col">
        <BrowserSurface sessionId={sessionId} />
      </TabsContent>
    </Tabs>
  )
}
