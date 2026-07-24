import { useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react'
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  ChevronRight,
  Network,
  Sparkles,
  Zap,
} from 'lucide-react'
import { usePluginStore } from '../../stores/pluginStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTranslation } from '../../i18n'
import { useUIStore } from '../../stores/uiStore'
import type { PluginCapabilityKey } from '../../types/plugin'
import { SETTINGS_TAB_ID, useTabStore } from '../../stores/tabStore'
import { useSkillStore } from '../../stores/skillStore'
import { useAgentStore } from '../../stores/agentStore'
import { useMcpStore } from '../../stores/mcpStore'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog'
import { Alert, AlertDescription, AlertTitle } from '../ui/alert'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { LoadingButton } from '../ui/custom/loading-button'
import { Skeleton } from '../ui/skeleton'

const CAPABILITY_ORDER: PluginCapabilityKey[] = [
  'lspServers',
]

export function PluginDetail() {
  const {
    selectedPlugin,
    isDetailLoading,
    isApplying,
    clearSelection,
    enablePlugin,
    disablePlugin,
    updatePlugin,
    uninstallPlugin,
    reloadPlugins,
  } = usePluginStore()
  const sessions = useSessionStore((s) => s.sessions)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const addToast = useUIStore((s) => s.addToast)
  const fetchSkillDetail = useSkillStore((s) => s.fetchSkillDetail)
  const fetchAgents = useAgentStore((s) => s.fetchAgents)
  const selectAgent = useAgentStore((s) => s.selectAgent)
  const fetchServers = useMcpStore((s) => s.fetchServers)
  const selectServer = useMcpStore((s) => s.selectServer)
  const t = useTranslation()
  const [actionKey, setActionKey] = useState<string | null>(null)
  const [showUninstallDialog, setShowUninstallDialog] = useState(false)
  const [uninstallError, setUninstallError] = useState<string | null>(null)
  const uninstallTriggerRef = useRef<HTMLButtonElement>(null)

  const activeSession = sessions.find((session) => session.id === activeSessionId)
  const currentWorkDir = activeSession?.workDir || undefined

  const addRuntimeAwareToast = (
    successMessage: string,
    successType: 'success' | 'warning' = 'success',
  ) => {
    const { lastSessionReload: sessionReload, refreshWarning } =
      usePluginStore.getState()
    if (refreshWarning) {
      addToast({
        type: 'warning',
        message: t('settings.plugins.refreshAfterMutationFailed', {
          error: refreshWarning,
        }),
      })
      return
    }
    if (activeSessionId && sessionReload && !sessionReload.applied) {
      addToast({
        type: 'warning',
        message: t(
          sessionReload.reason === 'not_running'
            ? 'settings.plugins.runtimeNotRunning'
            : 'settings.plugins.runtimeApplyFailed',
        ),
      })
      return
    }
    addToast({ type: successType, message: successMessage })
  }

  const otherCapabilityItems = useMemo(
    () =>
      CAPABILITY_ORDER.map((key) => ({
        key,
        items: selectedPlugin?.capabilities[key] ?? [],
      })),
    [selectedPlugin],
  )

  if (isDetailLoading) {
    return (
      <Card data-testid="plugin-detail-skeleton" aria-busy="true">
        <CardContent className="grid gap-4 p-6">
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-10 w-80 max-w-full" />
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    )
  }

  if (!selectedPlugin) return null

  const canMutate = selectedPlugin.scope !== 'managed' && selectedPlugin.scope !== 'builtin'
  const canNavigateSharedCapabilities = selectedPlugin.enabled

  const runAction = async (key: string, fn: () => Promise<string>) => {
    setActionKey(key)
    try {
      const message = await fn()
      addRuntimeAwareToast(message)
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setActionKey(null)
    }
  }

  const handleReload = async () => {
    setActionKey('reload')
    try {
      const summary = await reloadPlugins(currentWorkDir, activeSessionId || undefined)
      addRuntimeAwareToast(
        t('settings.plugins.reloadToast', {
          enabled: String(summary.enabled),
          skills: String(summary.skills),
          errors: String(summary.errors),
        }),
        summary.errors > 0 ? 'warning' : 'success',
      )
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setActionKey(null)
    }
  }

  const openSettingsTab = (tab: 'agents' | 'mcp') => {
    useUIStore.getState().setPendingSettingsTab(tab)
    useTabStore.getState().openTab(SETTINGS_TAB_ID, 'Settings', 'settings')
  }

  const handleOpenSkill = async (skillName: string) => {
    if (!canNavigateSharedCapabilities) {
      addToast({
        type: 'warning',
        message: t('settings.plugins.sharedNavigationDisabled'),
      })
      return
    }
    useUIStore.getState().setPendingSettingsTab('skills')
    useTabStore.getState().openTab(SETTINGS_TAB_ID, 'Settings', 'settings')
    await fetchSkillDetail('plugin', skillName, currentWorkDir, 'plugins')

    const { selectedSkill, error } = useSkillStore.getState()
    if (!selectedSkill && error) {
      addToast({ type: 'error', message: error })
    }
  }

  const handleOpenAgent = async (agentType: string) => {
    if (!canNavigateSharedCapabilities) {
      addToast({
        type: 'warning',
        message: t('settings.plugins.sharedNavigationDisabled'),
      })
      return
    }
    openSettingsTab('agents')
    await fetchAgents(currentWorkDir)

    const state = useAgentStore.getState()
    const agent = state.allAgents.find((entry) => entry.agentType === agentType)
    if (!agent) {
      addToast({
        type: 'error',
        message: `Unable to locate agent: ${agentType}`,
      })
      return
    }

    selectAgent(agent, 'plugins')
  }

  const handleOpenMcpServer = async (serverName: string) => {
    if (!canNavigateSharedCapabilities) {
      addToast({
        type: 'warning',
        message: t('settings.plugins.sharedNavigationDisabled'),
      })
      return
    }
    openSettingsTab('mcp')
    await fetchServers(undefined, currentWorkDir)

    const state = useMcpStore.getState()
    const server = state.servers.find((entry) => entry.name === serverName)
    if (!server) {
      addToast({
        type: 'error',
        message: `Unable to locate MCP server: ${serverName}`,
      })
      return
    }

    selectServer(server)
  }

  return (
    <div className="flex flex-col gap-4 min-w-0">
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={clearSelection}
        >
          <ArrowLeft aria-hidden="true" />
          {t('settings.plugins.back')}
        </Button>
      </div>

      <Card className="overflow-hidden">
        <CardContent className="grid gap-4 px-5 py-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.9fr)] lg:items-start">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--color-text-tertiary)] mb-2">
              {t('settings.plugins.entryEyebrow')}
            </div>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <h3 className="text-[22px] font-semibold leading-tight text-[var(--color-text-primary)] break-all">
                {selectedPlugin.name}
              </h3>
              <StatusPill enabled={selectedPlugin.enabled} hasErrors={selectedPlugin.hasErrors} />
              <MetaPill>{t(`settings.plugins.scope.${selectedPlugin.scope}`)}</MetaPill>
              <MetaPill>{selectedPlugin.marketplace}</MetaPill>
              {selectedPlugin.version && <MetaPill>v{selectedPlugin.version}</MetaPill>}
            </div>
            <p className="max-w-4xl text-sm leading-6 text-[var(--color-text-secondary)]">
              {selectedPlugin.description || t('settings.plugins.noDescription')}
            </p>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-[var(--color-text-tertiary)]">
              {selectedPlugin.authorName && (
                <span>{t('settings.plugins.author', { value: selectedPlugin.authorName })}</span>
              )}
              {selectedPlugin.projectPath && (
                <span>{t('settings.plugins.projectPath', { value: selectedPlugin.projectPath })}</span>
              )}
              {selectedPlugin.installPath && (
                <span>{t('settings.plugins.installPath', { value: selectedPlugin.installPath })}</span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-2">
            <DetailStat
              label={t('settings.plugins.summary.skills')}
              value={String(selectedPlugin.componentCounts.skills)}
              icon={Sparkles}
            />
            <DetailStat
              label={t('settings.plugins.summary.agents')}
              value={String(selectedPlugin.componentCounts.agents)}
              icon={Bot}
            />
            <DetailStat
              label={t('settings.plugins.summary.mcp')}
              value={String(selectedPlugin.componentCounts.mcpServers)}
              icon={Network}
            />
            <DetailStat
              label={t('settings.plugins.summary.hooks')}
              value={String(selectedPlugin.componentCounts.hooks)}
              icon={Zap}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="bg-[var(--color-surface)]">
        <CardContent className="px-5 py-4">
        <div className="flex flex-wrap gap-2">
          {canMutate && (
            selectedPlugin.enabled ? (
              <LoadingButton
                variant="secondary"
                size="sm"
                loading={isApplying && actionKey === 'disable'}
                disabled={isApplying && actionKey !== 'disable'}
                onClick={() => void runAction('disable', () => disablePlugin(selectedPlugin.id, selectedPlugin.scope, currentWorkDir, activeSessionId || undefined))}
              >
                {t('settings.plugins.disable')}
              </LoadingButton>
            ) : (
              <LoadingButton
                size="sm"
                loading={isApplying && actionKey === 'enable'}
                disabled={isApplying && actionKey !== 'enable'}
                onClick={() => void runAction('enable', () => enablePlugin(selectedPlugin.id, selectedPlugin.scope, currentWorkDir, activeSessionId || undefined))}
              >
                {t('settings.plugins.enable')}
              </LoadingButton>
            )
          )}

          {canMutate && (
            <LoadingButton
              variant="secondary"
              size="sm"
              loading={isApplying && actionKey === 'update'}
              disabled={isApplying && actionKey !== 'update'}
              onClick={() => void runAction('update', () => updatePlugin(selectedPlugin.id, selectedPlugin.scope, currentWorkDir, activeSessionId || undefined))}
            >
              {t('settings.plugins.update')}
            </LoadingButton>
          )}

          <LoadingButton
            variant="secondary"
            size="sm"
            loading={isApplying && actionKey === 'reload'}
            disabled={isApplying && actionKey !== 'reload'}
            onClick={() => void handleReload()}
          >
            {t('settings.plugins.apply')}
          </LoadingButton>

          {canMutate && (
            <Button
              ref={uninstallTriggerRef}
              variant="destructive"
              size="sm"
              disabled={isApplying}
              onClick={() => {
                setUninstallError(null)
                setShowUninstallDialog(true)
              }}
            >
              {t('settings.plugins.uninstall')}
            </Button>
          )}
        </div>

        {!canMutate && (
          <p className="mt-3 text-xs text-[var(--color-text-tertiary)]">
            {selectedPlugin.scope === 'managed'
              ? t('settings.plugins.managedHint')
              : t('settings.plugins.builtinHint')}
          </p>
        )}

        <p className="mt-3 text-xs text-[var(--color-text-tertiary)]">
          {t('settings.plugins.applyHint')}
        </p>
        </CardContent>
      </Card>

      {selectedPlugin.errors.length > 0 && (
        <Alert variant="destructive" className="px-5 py-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle className="size-[18px]" aria-hidden="true" />
            <AlertTitle>
              {t('settings.plugins.errorsTitle')}
            </AlertTitle>
          </div>
          <AlertDescription className="flex flex-col gap-2">
            {selectedPlugin.errors.map((error) => (
              <div
                key={error}
                className="rounded-xl border border-[var(--color-error)]/15 bg-[var(--color-surface)] px-3 py-3 text-sm text-[var(--color-text-secondary)]"
              >
                {error}
              </div>
            ))}
          </AlertDescription>
        </Alert>
      )}

      <Card className="overflow-hidden bg-[var(--color-surface)]">
        <CardHeader className="gap-1 border-b border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-5 py-4">
          <CardTitle className="text-sm">
            {t('settings.plugins.capabilitiesTitle')}
          </CardTitle>
          <CardDescription className="text-xs">
            {t('settings.plugins.capabilitiesHint')}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 p-4">
          <CapabilityPreviewSection
            title={t('settings.plugins.capabilityLabel.skills')}
            count={selectedPlugin.skillEntries.length}
            emptyLabel={t('settings.plugins.capabilityEmpty')}
            hint={!canNavigateSharedCapabilities ? t('settings.plugins.sharedNavigationDisabled') : undefined}
          >
            {selectedPlugin.skillEntries.length > 0 ? (
              <div className="grid gap-3 xl:grid-cols-2">
                {selectedPlugin.skillEntries.map((skill) => (
                  <SkillPreviewCard
                    key={skill.name}
                    name={skill.displayName || skill.name}
                    rawName={skill.displayName ? skill.name : undefined}
                    description={skill.description}
                    version={skill.version}
                    onClick={() => void handleOpenSkill(skill.name)}
                    disabled={!canNavigateSharedCapabilities}
                  />
                ))}
              </div>
            ) : null}
          </CapabilityPreviewSection>

          <CapabilityPreviewSection
            title={t('settings.plugins.capabilityLabel.mcpServers')}
            count={selectedPlugin.mcpServerEntries.length}
            emptyLabel={t('settings.plugins.capabilityEmpty')}
            hint={!canNavigateSharedCapabilities ? t('settings.plugins.sharedNavigationDisabled') : undefined}
          >
            {selectedPlugin.mcpServerEntries.length > 0 ? (
              <div className="grid gap-3 xl:grid-cols-2">
                {selectedPlugin.mcpServerEntries.map((server) => (
                  <McpPreviewCard
                    key={server.name}
                    name={server.displayName || server.name}
                    transport={server.transport}
                    summary={server.summary}
                    onClick={() => void handleOpenMcpServer(server.name)}
                    disabled={!canNavigateSharedCapabilities}
                  />
                ))}
              </div>
            ) : null}
          </CapabilityPreviewSection>

          <CapabilityPreviewSection
            title={t('settings.plugins.capabilityLabel.commands')}
            count={selectedPlugin.commandEntries.length}
            emptyLabel={t('settings.plugins.capabilityEmpty')}
          >
            {selectedPlugin.commandEntries.length > 0 ? (
              <div className="grid gap-3 xl:grid-cols-2">
                {selectedPlugin.commandEntries.map((command) => (
                  <CommandPreviewCard
                    key={command.name}
                    name={command.name}
                    description={command.description}
                  />
                ))}
              </div>
            ) : null}
          </CapabilityPreviewSection>

          <CapabilityPreviewSection
            title={t('settings.plugins.capabilityLabel.agents')}
            count={selectedPlugin.agentEntries.length}
            emptyLabel={t('settings.plugins.capabilityEmpty')}
            hint={!canNavigateSharedCapabilities ? t('settings.plugins.sharedNavigationDisabled') : undefined}
          >
            {selectedPlugin.agentEntries.length > 0 ? (
              <div className="grid gap-3 xl:grid-cols-2">
                {selectedPlugin.agentEntries.map((agent) => (
                  <AgentPreviewCard
                    key={agent.name}
                    name={agent.displayName || agent.name}
                    description={agent.description}
                    onClick={() => void handleOpenAgent(agent.name)}
                    disabled={!canNavigateSharedCapabilities}
                  />
                ))}
              </div>
            ) : null}
          </CapabilityPreviewSection>

          <CapabilityPreviewSection
            title={t('settings.plugins.capabilityLabel.hooks')}
            count={selectedPlugin.hookEntries.length}
            emptyLabel={t('settings.plugins.capabilityEmpty')}
          >
            {selectedPlugin.hookEntries.length > 0 ? (
              <div className="grid gap-3 xl:grid-cols-2">
                {selectedPlugin.hookEntries.map((hook, index) => (
                  <HookPreviewCard
                    key={`${hook.event}:${hook.matcher || 'all'}:${index}`}
                    event={hook.event}
                    matcher={hook.matcher}
                    actions={hook.actions}
                  />
                ))}
              </div>
            ) : null}
          </CapabilityPreviewSection>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {otherCapabilityItems.map(({ key, items }) => (
              <Card
                key={key}
                className="bg-[var(--color-surface-container-low)]"
              >
                <CardContent className="px-4 py-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="text-sm font-semibold text-[var(--color-text-primary)]">
                    {t(`settings.plugins.capabilityLabel.${key}`)}
                  </div>
                  <Badge variant="secondary">
                    {items.length}
                  </Badge>
                </div>
                {items.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {items.map((item) => (
                      <Badge
                        key={item}
                        variant="outline"
                        className="break-all bg-[var(--color-surface)] text-[11px]"
                      >
                        {item}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-[var(--color-text-tertiary)]">
                    {t('settings.plugins.capabilityEmpty')}
                  </div>
                )}
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>

      <AlertDialog
        open={showUninstallDialog}
        onOpenChange={(open) => {
          if (!open && !(isApplying && actionKey === 'uninstall')) {
            setShowUninstallDialog(false)
            setUninstallError(null)
          }
        }}
      >
        <AlertDialogContent
          onEscapeKeyDown={(event) => {
            if (isApplying && actionKey === 'uninstall') event.preventDefault()
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            uninstallTriggerRef.current?.focus()
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.plugins.uninstall')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('settings.plugins.confirmUninstall', { name: selectedPlugin.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {uninstallError && (
            <Alert variant="destructive">
              <AlertDescription className="break-words">{uninstallError}</AlertDescription>
            </Alert>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isApplying && actionKey === 'uninstall'}>
              {t('common.cancel')}
            </AlertDialogCancel>
            <LoadingButton
              variant="destructive"
              loading={isApplying && actionKey === 'uninstall'}
              onClick={async () => {
                if (isApplying) return
                setActionKey('uninstall')
                setUninstallError(null)
                try {
                  const message = await uninstallPlugin(
                    selectedPlugin.id,
                    selectedPlugin.scope,
                    false,
                    currentWorkDir,
                    activeSessionId || undefined,
                  )
                  addRuntimeAwareToast(message)
                  setShowUninstallDialog(false)
                } catch (err) {
                  const message = err instanceof Error ? err.message : String(err)
                  setUninstallError(message)
                  addToast({ type: 'error', message })
                } finally {
                  setActionKey(null)
                }
              }}
            >
              {t('settings.plugins.uninstall')}
            </LoadingButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function CapabilityPreviewSection({
  title,
  count,
  children,
  emptyLabel,
  hint,
}: {
  title: string
  count: number
  children: ReactNode
  emptyLabel: string
  hint?: string
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
        <CardTitle className="text-sm">{title}</CardTitle>
        <Badge variant="secondary">{count}</Badge>
      </CardHeader>
      <CardContent className="p-4">
        {hint && count > 0 && (
          <div className="mb-3 text-xs text-[var(--color-text-tertiary)]">{hint}</div>
        )}
        {count > 0 ? children : (
          <div className="text-xs text-[var(--color-text-tertiary)]">{emptyLabel}</div>
        )}
      </CardContent>
    </Card>
  )
}

function SkillPreviewCard({
  name,
  rawName,
  description,
  version,
  onClick,
  disabled,
}: {
  name: string
  rawName?: string
  description: string
  version?: string
  onClick: () => void
  disabled?: boolean
}) {
  const t = useTranslation()
  const slashName = rawName || name

  return (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      disabled={disabled}
      className="group h-auto w-full items-stretch justify-start whitespace-normal rounded-xl bg-[var(--color-surface)] px-4 py-3 text-left disabled:cursor-default disabled:opacity-70"
    >
      <div className="w-full">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className="text-sm font-semibold text-[var(--color-text-primary)] break-all">{name}</span>
          {version && (
            <Badge variant="secondary" className="min-h-4 px-2 py-0 text-[10px]">
              v{version}
            </Badge>
          )}
          <Badge variant="outline" className="min-h-4 px-2 py-0 text-[10px]">
            {t('settings.skills.slashCommand')}
          </Badge>
        </div>
        <ChevronRight className="size-[18px] text-[var(--color-text-tertiary)] transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </div>
      <div className="mt-1 text-[11px] text-[var(--color-text-tertiary)] break-all">/{slashName}</div>
      <div className="mt-2 text-xs leading-5 text-[var(--color-text-secondary)] break-words">{description}</div>
      </div>
    </Button>
  )
}

function CommandPreviewCard({
  name,
  description,
}: {
  name: string
  description: string
}) {
  return (
    <Card className="bg-[var(--color-surface)]">
      <CardContent className="px-4 py-3">
        <div className="break-all text-sm font-semibold text-[var(--color-text-primary)]">/{name}</div>
        <div className="mt-2 break-words text-xs leading-5 text-[var(--color-text-secondary)]">{description}</div>
      </CardContent>
    </Card>
  )
}

function AgentPreviewCard({
  name,
  description,
  onClick,
  disabled,
}: {
  name: string
  description: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      disabled={disabled}
      className="group h-auto w-full items-stretch justify-start whitespace-normal rounded-xl bg-[var(--color-surface)] px-4 py-3 text-left disabled:cursor-default disabled:opacity-70"
    >
      <div className="flex w-full items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[var(--color-text-primary)] break-all">{name}</div>
          <div className="mt-2 text-xs leading-5 text-[var(--color-text-secondary)] break-words">{description}</div>
        </div>
        <ChevronRight className="size-[18px] text-[var(--color-text-tertiary)] transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </div>
    </Button>
  )
}

function McpPreviewCard({
  name,
  transport,
  summary,
  onClick,
  disabled,
}: {
  name: string
  transport: string
  summary: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      disabled={disabled}
      className="group h-auto w-full items-stretch justify-start whitespace-normal rounded-xl bg-[var(--color-surface)] px-4 py-3 text-left disabled:cursor-default disabled:opacity-70"
    >
      <div className="flex w-full items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-[var(--color-text-primary)] break-all">{name}</span>
            <Badge variant="secondary" className="min-h-4 px-2 py-0 text-[10px] uppercase tracking-[0.12em]">
              {transport}
            </Badge>
          </div>
          <div className="mt-2 text-xs leading-5 text-[var(--color-text-secondary)] break-all">{summary}</div>
        </div>
        <ChevronRight className="size-[18px] text-[var(--color-text-tertiary)] transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </div>
    </Button>
  )
}

function HookPreviewCard({
  event,
  matcher,
  actions,
}: {
  event: string
  matcher?: string
  actions: string[]
}) {
  return (
    <Card className="bg-[var(--color-surface)]">
      <CardContent className="px-4 py-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-semibold text-[var(--color-text-primary)] break-all">{event}</span>
        {matcher && (
          <Badge variant="secondary" className="min-h-4 break-all px-2 py-0 text-[10px]">
            {matcher}
          </Badge>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {actions.map((action) => (
          <Badge
            key={action}
            variant="outline"
            className="break-all bg-[var(--color-surface-container-low)] text-[11px]"
          >
            {action}
          </Badge>
        ))}
      </div>
      </CardContent>
    </Card>
  )
}

function MetaPill({ children }: { children: ReactNode }) {
  return (
    <Badge variant="outline" className="bg-[var(--color-surface)] text-[10px] uppercase tracking-[0.12em]">
      {children}
    </Badge>
  )
}

function DetailStat({
  label,
  value,
  icon,
}: {
  label: string
  value: string
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>
}) {
  const Icon = icon
  return (
    <Card className="bg-[var(--color-surface)]">
      <CardContent className="px-3 py-3">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-[var(--color-text-tertiary)]">
        <Icon className="size-3.5" aria-hidden="true" />
        <span>{label}</span>
      </div>
      <div className="mt-2 text-base font-semibold text-[var(--color-text-primary)] break-all">
        {value}
      </div>
      </CardContent>
    </Card>
  )
}

function StatusPill({
  enabled,
  hasErrors,
}: {
  enabled: boolean
  hasErrors: boolean
}) {
  const t = useTranslation()
  const classes = hasErrors
    ? 'bg-[var(--color-error)]/12 text-[var(--color-error)]'
    : enabled
      ? 'bg-[var(--color-success-container)] text-[var(--color-success)]'
      : 'bg-[var(--color-surface-container-high)] text-[var(--color-text-tertiary)]'

  const label = hasErrors
    ? t('settings.plugins.status.attention')
    : enabled
      ? t('settings.plugins.status.enabled')
      : t('settings.plugins.status.disabled')

  return (
    <Badge className={`min-h-4 border-transparent px-2 py-0 text-[10px] ${classes}`}>
      {label}
    </Badge>
  )
}
