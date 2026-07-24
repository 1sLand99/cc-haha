import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ListChecks,
  PackageX,
  Puzzle,
  RefreshCw,
  RotateCw,
  Store,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react'
import { usePluginStore, type PluginActionTarget } from '../../stores/pluginStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTranslation } from '../../i18n'
import { useUIStore } from '../../stores/uiStore'
import type { PluginSummary } from '../../types/plugin'
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
import { Checkbox } from '../ui/checkbox'
import { LoadingButton } from '../ui/custom/loading-button'
import { Skeleton } from '../ui/skeleton'

type PluginBucket = 'attention' | 'enabled' | 'disabled'
type BatchAction = 'enable' | 'disable'

export function PluginList({
  onOpenPlugin,
}: {
  onOpenPlugin?: (pluginId: string) => void
}) {
  const {
    plugins,
    marketplaces,
    summary,
    lastReloadSummary,
    isLoading,
    isApplying,
    error,
    fetchPlugins,
    fetchPluginDetail,
    reloadPlugins,
    bulkEnablePlugins,
    bulkDisablePlugins,
  } = usePluginStore()
  const sessions = useSessionStore((s) => s.sessions)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const addToast = useUIStore((s) => s.addToast)
  const t = useTranslation()
  const [selectedPluginIds, setSelectedPluginIds] = useState<Set<string>>(() => new Set())
  const [confirmBatchAction, setConfirmBatchAction] = useState<BatchAction | null>(null)
  const [batchError, setBatchError] = useState<string | null>(null)
  const enableBatchTriggerRef = useRef<HTMLButtonElement>(null)
  const disableBatchTriggerRef = useRef<HTMLButtonElement>(null)
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

  useEffect(() => {
    void fetchPlugins(currentWorkDir)
  }, [fetchPlugins, currentWorkDir])

  const grouped = useMemo(() => {
    const buckets: Record<PluginBucket, PluginSummary[]> = {
      attention: [],
      enabled: [],
      disabled: [],
    }

    for (const plugin of plugins) {
      if (plugin.hasErrors) {
        buckets.attention.push(plugin)
      } else if (plugin.enabled) {
        buckets.enabled.push(plugin)
      } else {
        buckets.disabled.push(plugin)
      }
    }

    return buckets
  }, [plugins])

  useEffect(() => {
    setSelectedPluginIds((current) => {
      const selectableIds = new Set(plugins.filter(canMutatePlugin).map((plugin) => plugin.id))
      const next = new Set([...current].filter((id) => selectableIds.has(id)))
      return next.size === current.size ? current : next
    })
  }, [plugins])

  const selectedPlugins = useMemo(
    () => plugins.filter((plugin) => selectedPluginIds.has(plugin.id) && canMutatePlugin(plugin)),
    [plugins, selectedPluginIds],
  )
  const enableCandidates = useMemo(
    () => selectedPlugins.filter((plugin) => !plugin.enabled),
    [selectedPlugins],
  )
  const disableCandidates = useMemo(
    () => selectedPlugins.filter((plugin) => plugin.enabled),
    [selectedPlugins],
  )
  const confirmBatchPlugins = confirmBatchAction === 'enable' ? enableCandidates : disableCandidates
  const confirmBatchNames = useMemo(
    () => formatPluginNames(confirmBatchPlugins),
    [confirmBatchPlugins],
  )

  const handleReload = async () => {
    try {
      const reloadSummary = await reloadPlugins(currentWorkDir, activeSessionId || undefined)
      addRuntimeAwareToast(
        t('settings.plugins.reloadToast', {
          enabled: String(reloadSummary.enabled),
          skills: String(reloadSummary.skills),
          errors: String(reloadSummary.errors),
        }),
        reloadSummary.errors > 0 ? 'warning' : 'success',
      )
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const togglePluginSelection = (pluginId: string, selected: boolean) => {
    setSelectedPluginIds((current) => {
      const next = new Set(current)
      if (selected) {
        next.add(pluginId)
      } else {
        next.delete(pluginId)
      }
      return next
    })
  }

  const clearSelection = () => {
    setSelectedPluginIds(new Set())
  }

  const toActionTargets = (items: PluginSummary[]): PluginActionTarget[] =>
    items.map((plugin) => ({ id: plugin.id, scope: plugin.scope }))

  const handleBatchConfirm = async () => {
    if (!confirmBatchAction) return

    const action = confirmBatchAction
    const targets = action === 'enable' ? enableCandidates : disableCandidates
    if (targets.length === 0) {
      setConfirmBatchAction(null)
      return
    }

    try {
      setBatchError(null)
      const changed = action === 'enable'
        ? await bulkEnablePlugins(toActionTargets(targets), currentWorkDir, activeSessionId || undefined)
        : await bulkDisablePlugins(toActionTargets(targets), currentWorkDir, activeSessionId || undefined)

      setSelectedPluginIds((current) => {
        const next = new Set(current)
        for (const plugin of targets) {
          next.delete(plugin.id)
        }
        return next
      })
      setConfirmBatchAction(null)
      addRuntimeAwareToast(
        t(action === 'enable' ? 'settings.plugins.bulkEnableToast' : 'settings.plugins.bulkDisableToast', {
          count: String(changed),
        }),
      )
    } catch (err) {
      setBatchError(err instanceof Error ? err.message : String(err))
      addToast({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  if (isLoading) {
    return <PluginListSkeleton />
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>{t('settings.plugins.title')}</AlertTitle>
        <AlertDescription className="break-words">{error}</AlertDescription>
        <Button
          variant="outline"
          size="sm"
          className="mt-2 w-fit"
          onClick={() => void fetchPlugins(currentWorkDir)}
        >
          <RefreshCw aria-hidden="true" />
          {t('common.retry')}
        </Button>
      </Alert>
    )
  }

  if (plugins.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="px-6 py-12 text-center">
          <PackageX className="mx-auto mb-2 size-10 text-[var(--color-text-tertiary)]" aria-hidden="true" />
          <p className="text-sm text-[var(--color-text-tertiary)]">
            {t('settings.plugins.empty')}
          </p>
          <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
            {t('settings.plugins.emptyHint')}
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-6 min-w-0">
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-4 px-5 py-5 min-w-0">
          <div className="flex flex-col gap-4 min-w-0 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0 max-w-4xl">
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--color-text-tertiary)] mb-2">
                {t('settings.plugins.browserEyebrow')}
              </div>
              <div className="flex items-center gap-3 mb-2">
                <Puzzle className="size-[22px] text-[var(--color-brand)]" aria-hidden="true" />
                <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">
                  {t('settings.plugins.browserTitle')}
                </h3>
              </div>
              <p className="text-sm leading-6 text-[var(--color-text-secondary)]">
                {t('settings.plugins.browserDescription')}
              </p>
            </div>

            <div className="flex flex-wrap gap-2 xl:justify-end">
              <Button
                variant="secondary"
                className="min-h-9 flex-1 sm:flex-none"
                onClick={() => void fetchPlugins(currentWorkDir)}
              >
                <RefreshCw aria-hidden="true" />
                {t('settings.plugins.refresh')}
              </Button>
              <LoadingButton
                className="min-h-9 flex-1 sm:flex-none"
                onClick={handleReload}
                loading={isApplying}
              >
                <RotateCw aria-hidden="true" />
                {t('settings.plugins.apply')}
              </LoadingButton>
            </div>
          </div>

          <div className="grid min-w-0 grid-cols-2 gap-2 md:grid-cols-4">
            <SummaryCard
              label={t('settings.plugins.summary.total')}
              value={String(summary?.total ?? plugins.length)}
              icon={Puzzle}
            />
            <SummaryCard
              label={t('settings.plugins.summary.enabled')}
              value={String(summary?.enabled ?? plugins.filter((plugin) => plugin.enabled).length)}
              icon={CheckCircle2}
            />
            <SummaryCard
              label={t('settings.plugins.summary.attention')}
              value={String(grouped.attention.length)}
              icon={AlertTriangle}
            />
            <SummaryCard
              label={t('settings.plugins.summary.marketplaces')}
              value={String(summary?.marketplaceCount ?? marketplaces.length)}
              icon={Store}
            />
          </div>

          {lastReloadSummary && (
            <p className="text-xs text-[var(--color-text-tertiary)]">
              {t('settings.plugins.lastReload', {
                enabled: String(lastReloadSummary.enabled),
                skills: String(lastReloadSummary.skills),
                errors: String(lastReloadSummary.errors),
              })}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-3 border-t border-[var(--color-border)] px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-2 text-xs text-[var(--color-text-secondary)]">
            <ListChecks className="size-4 text-[var(--color-text-tertiary)]" aria-hidden="true" />
            <span className="font-medium text-[var(--color-text-primary)]">
              {t('settings.plugins.selectionCount', { count: String(selectedPlugins.length) })}
            </span>
            {selectedPlugins.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearSelection}
                className="h-7"
              >
                {t('settings.plugins.clearSelection')}
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <Button
              ref={enableBatchTriggerRef}
              size="sm"
              disabled={enableCandidates.length === 0 || isApplying}
              onClick={() => {
                setBatchError(null)
                setConfirmBatchAction('enable')
              }}
            >
              <ToggleRight aria-hidden="true" />
              {t('settings.plugins.enableSelected')}
            </Button>
            <Button
              ref={disableBatchTriggerRef}
              variant="secondary"
              size="sm"
              disabled={disableCandidates.length === 0 || isApplying}
              onClick={() => {
                setBatchError(null)
                setConfirmBatchAction('disable')
              }}
            >
              <ToggleLeft aria-hidden="true" />
              {t('settings.plugins.disableSelected')}
            </Button>
          </div>
        </div>
      </Card>

      {marketplaces.length > 0 && (
        <Card className="overflow-hidden bg-[var(--color-surface)]">
          <CardHeader className="gap-1 border-b border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-5 py-4">
            <CardTitle className="text-sm">
              {t('settings.plugins.marketplacesTitle')}
            </CardTitle>
            <CardDescription className="text-xs">
              {t('settings.plugins.marketplacesHint')}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
            {marketplaces.map((marketplace) => (
              <Card
                key={marketplace.name}
                className="bg-[var(--color-surface-container-low)]"
              >
                <CardContent className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                      {marketplace.name}
                    </span>
                    <Badge className={
                    marketplace.autoUpdate
                        ? 'border-transparent bg-[var(--color-success-container)] text-[var(--color-success)]'
                        : 'border-transparent bg-[var(--color-surface-container-high)] text-[var(--color-text-tertiary)]'
                    }>
                      {marketplace.autoUpdate
                        ? t('settings.plugins.marketplaceAutoUpdateOn')
                        : t('settings.plugins.marketplaceAutoUpdateOff')}
                    </Badge>
                  </div>
                  <div className="mt-2 break-words text-xs leading-5 text-[var(--color-text-secondary)]">
                    {marketplace.source}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--color-text-tertiary)]">
                    <span>{t('settings.plugins.marketplaceInstalledCount', { count: String(marketplace.installedCount) })}</span>
                    {formatMarketplaceUpdatedAt(marketplace.lastUpdated) && (
                      <span>
                        {t('settings.plugins.marketplaceUpdatedAt', {
                          value: formatMarketplaceUpdatedAt(marketplace.lastUpdated)!,
                        })}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </CardContent>
        </Card>
      )}

      {renderGroup('attention', grouped.attention, {
        fetchPluginDetail,
        cwd: currentWorkDir,
        t,
        selectedPluginIds,
        onToggleSelection: togglePluginSelection,
        onOpenPlugin,
      })}
      {renderGroup('enabled', grouped.enabled, {
        fetchPluginDetail,
        cwd: currentWorkDir,
        t,
        selectedPluginIds,
        onToggleSelection: togglePluginSelection,
        onOpenPlugin,
      })}
      {renderGroup('disabled', grouped.disabled, {
        fetchPluginDetail,
        cwd: currentWorkDir,
        t,
        selectedPluginIds,
        onToggleSelection: togglePluginSelection,
        onOpenPlugin,
      })}

      <AlertDialog
        open={confirmBatchAction !== null}
        onOpenChange={(open) => {
          if (!open && !isApplying) {
            setConfirmBatchAction(null)
            setBatchError(null)
          }
        }}
      >
        <AlertDialogContent
          onEscapeKeyDown={(event) => {
            if (isApplying) event.preventDefault()
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            const trigger = confirmBatchAction === 'disable'
              ? disableBatchTriggerRef.current
              : enableBatchTriggerRef.current
            trigger?.focus()
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmBatchAction === 'enable'
                ? t('settings.plugins.bulkEnableTitle', { count: String(confirmBatchPlugins.length) })
                : t('settings.plugins.bulkDisableTitle', { count: String(confirmBatchPlugins.length) })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmBatchAction === 'enable'
                ? t('settings.plugins.bulkEnableBody', { names: confirmBatchNames })
                : t('settings.plugins.bulkDisableBody', { names: confirmBatchNames })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {batchError && (
            <Alert variant="destructive">
              <AlertDescription className="break-words">{batchError}</AlertDescription>
            </Alert>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isApplying}>
              {t('common.cancel')}
            </AlertDialogCancel>
            <LoadingButton
              variant={confirmBatchAction === 'disable' ? 'destructive' : 'default'}
              loading={isApplying}
              onClick={() => void handleBatchConfirm()}
            >
              {confirmBatchAction === 'enable'
                ? t('settings.plugins.enable')
                : t('settings.plugins.disable')}
            </LoadingButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

type RenderGroupOptions = {
  fetchPluginDetail: (id: string, cwd?: string) => Promise<void>
  cwd: string | undefined
  t: ReturnType<typeof useTranslation>
  selectedPluginIds: Set<string>
  onToggleSelection: (pluginId: string, selected: boolean) => void
  onOpenPlugin?: (pluginId: string) => void
}

function renderGroup(
  bucket: PluginBucket,
  items: PluginSummary[],
  {
    fetchPluginDetail,
    cwd,
    t,
    selectedPluginIds,
    onToggleSelection,
    onOpenPlugin,
  }: RenderGroupOptions,
) {
  if (items.length === 0) return null

  const titleKey =
    bucket === 'attention'
      ? 'settings.plugins.group.attention'
      : bucket === 'enabled'
        ? 'settings.plugins.group.enabled'
        : 'settings.plugins.group.disabled'

  return (
    <Card
      key={bucket}
      className="overflow-hidden bg-[var(--color-surface)]"
    >
      <CardHeader className="flex-row items-start justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-5 py-4">
        <div className="min-w-0">
          <CardTitle className="text-sm">
            {t(titleKey)}
          </CardTitle>
          <CardDescription className="mt-1 text-xs leading-5">
            {t('settings.plugins.groupHint', { count: String(items.length) })}
          </CardDescription>
        </div>
        <Badge variant="secondary">{items.length}</Badge>
      </CardHeader>
      <CardContent className="flex flex-col p-2">
        {items.map((plugin) => (
          <div
            key={plugin.id}
            className={`group rounded-xl border px-3 py-3 transition-all hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface-hover)] ${
              selectedPluginIds.has(plugin.id)
                ? 'border-[var(--color-brand)]/45 bg-[var(--color-surface-selected)]'
                : 'border-transparent'
            }`}
          >
            <div className="flex items-start gap-3">
              {canMutatePlugin(plugin) ? (
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center">
                  <Checkbox
                    aria-label={t('settings.plugins.selectPlugin', { name: plugin.name })}
                    checked={selectedPluginIds.has(plugin.id)}
                    onCheckedChange={(checked) => onToggleSelection(plugin.id, checked === true)}
                  />
                </div>
              ) : (
                <span className="mt-0.5 h-6 w-6 shrink-0" aria-hidden="true" />
              )}
              <Button
                variant="ghost"
                size="sm"
                data-plugin-key={plugin.id}
                onClick={() => {
                  onOpenPlugin?.(plugin.id)
                  void fetchPluginDetail(plugin.id, cwd)
                }}
                className="h-auto min-w-0 flex-1 items-start justify-start gap-3 rounded-lg p-0 text-left hover:bg-transparent active:translate-y-0"
              >
                {plugin.hasErrors
                  ? <AlertTriangle className="mt-0.5 size-[18px] text-[var(--color-error)]" aria-hidden="true" />
                  : <Puzzle className="mt-0.5 size-[18px] text-[var(--color-text-tertiary)]" aria-hidden="true" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-[var(--color-text-primary)] break-all">
                      {plugin.name}
                    </span>
                    <StatusPill plugin={plugin} />
                    <ScopePill scope={plugin.scope} />
                    {plugin.version && (
                      <Badge variant="secondary" className="min-h-4 px-2 py-0 text-[10px]">
                        v{plugin.version}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)] break-words">
                    {plugin.description || t('settings.plugins.noDescription')}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--color-text-tertiary)]">
                    <span>{plugin.marketplace}</span>
                    {plugin.componentCounts.skills > 0 && (
                      <span>{t('settings.plugins.capability.skills', { count: String(plugin.componentCounts.skills) })}</span>
                    )}
                    {plugin.componentCounts.agents > 0 && (
                      <span>{t('settings.plugins.capability.agents', { count: String(plugin.componentCounts.agents) })}</span>
                    )}
                    {plugin.componentCounts.mcpServers > 0 && (
                      <span>{t('settings.plugins.capability.mcpServers', { count: String(plugin.componentCounts.mcpServers) })}</span>
                    )}
                    {plugin.errors.length > 0 && (
                      <span className="text-[var(--color-error)]">
                        {t('settings.plugins.errorCount', { count: String(plugin.errors.length) })}
                      </span>
                    )}
                  </div>
                </div>
                <ChevronRight className="size-[18px] text-[var(--color-text-tertiary)] opacity-60 transition-transform group-hover:translate-x-0.5 group-hover:opacity-100" aria-hidden="true" />
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function canMutatePlugin(plugin: PluginSummary) {
  return plugin.scope !== 'managed' && plugin.scope !== 'builtin'
}

function formatPluginNames(plugins: PluginSummary[]) {
  const names = plugins.map((plugin) => plugin.name)
  if (names.length <= 4) return names.join(', ')
  return `${names.slice(0, 4).join(', ')} +${names.length - 4}`
}

function formatMarketplaceUpdatedAt(value: string | undefined) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString()
}

function SummaryCard({
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
    <Card className="min-w-0 bg-[var(--color-surface)]">
      <CardContent className="px-3 py-3">
      <div className="flex min-w-0 items-center gap-1.5 text-[11px] uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
        <Icon className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 truncate text-[10px] leading-4">
          {label}
        </span>
      </div>
      <div className="mt-1.5 truncate text-lg font-semibold text-[var(--color-text-primary)]">
        {value}
      </div>
      </CardContent>
    </Card>
  )
}

function StatusPill({ plugin }: { plugin: PluginSummary }) {
  const t = useTranslation()

  if (plugin.hasErrors) {
    return (
      <Badge variant="destructive" className="min-h-4 px-2 py-0 text-[10px]">
        {t('settings.plugins.status.attention')}
      </Badge>
    )
  }

  return (
    <Badge className={`min-h-4 border-transparent px-2 py-0 text-[10px] ${
      plugin.enabled
        ? 'bg-[var(--color-success-container)] text-[var(--color-success)]'
        : 'bg-[var(--color-surface-container-high)] text-[var(--color-text-tertiary)]'
    }`}>
      {plugin.enabled
        ? t('settings.plugins.status.enabled')
        : t('settings.plugins.status.disabled')}
    </Badge>
  )
}

function ScopePill({ scope }: { scope: PluginSummary['scope'] }) {
  const t = useTranslation()
  return (
    <Badge variant="outline" className="min-h-4 px-2 py-0 text-[10px]">
      {t(`settings.plugins.scope.${scope}`)}
    </Badge>
  )
}

function PluginListSkeleton() {
  return (
    <div className="grid gap-6" data-testid="plugin-list-skeleton" aria-busy="true">
      <Card>
        <CardContent className="grid gap-4 p-5">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-full max-w-3xl" />
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-[76px] w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
      <Skeleton className="h-48 w-full" />
    </div>
  )
}
