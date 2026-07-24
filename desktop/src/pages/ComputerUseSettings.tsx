import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  Check,
  CircleCheck,
  Download,
  ExternalLink,
  FolderOpen,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
} from 'lucide-react'
import {
  computerUseApi,
  type AuthorizedApp,
  type ComputerUseConfig,
  type ComputerUseStatus,
  type InstalledApp,
  type SetupResult,
} from '../api/computerUse'
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card'
import { Checkbox } from '../components/ui/checkbox'
import {
  ComputerUseStatusRow,
  StatusIcon,
} from '../components/ui/custom/computer-use-status-row'
import { LoadingButton } from '../components/ui/custom/loading-button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { ScrollArea } from '../components/ui/scroll-area'
import { Skeleton } from '../components/ui/skeleton'
import { Switch } from '../components/ui/switch'
import { useTranslation } from '../i18n'
import { getDesktopHost } from '../lib/desktopHost'

type CheckState = 'loading' | 'ready' | 'error'
type ConfigState = 'loading' | 'ready' | 'error'
type SaveState = 'idle' | 'saving' | 'saved' | 'error'
const PYTHON_DOWNLOAD_URLS: Record<string, string> = {
  darwin: 'https://www.python.org/downloads/macos/',
  win32: 'https://www.python.org/downloads/windows/',
}

async function openSystemSettings(pane: 'Privacy_ScreenCapture' | 'Privacy_Accessibility') {
  await computerUseApi.openSettings(pane)
}

async function openExternalUrl(url: string) {
  const host = getDesktopHost()
  try {
    await host.shell.open(url)
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

export function ComputerUseSettings() {
  const t = useTranslation()
  const [status, setStatus] = useState<ComputerUseStatus | null>(null)
  const [checkState, setCheckState] = useState<CheckState>('loading')
  const [setupRunning, setSetupRunning] = useState(false)
  const [setupResult, setSetupResult] = useState<SetupResult | null>(null)

  // App authorization state
  const [installedApps, setInstalledApps] = useState<InstalledApp[]>([])
  const [authorizedBundleIds, setAuthorizedBundleIds] = useState<Set<string>>(new Set())
  const [appsLoading, setAppsLoading] = useState(false)
  const [configState, setConfigState] = useState<ConfigState>('loading')
  const [configSaveState, setConfigSaveState] = useState<SaveState>('idle')
  const [appsLoadFailed, setAppsLoadFailed] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [computerUseEnabled, setComputerUseEnabled] = useState(false)
  const [clipboardRead, setClipboardRead] = useState(false)
  const [clipboardWrite, setClipboardWrite] = useState(false)
  const [systemKeys, setSystemKeys] = useState(false)
  const [pythonPathDraft, setPythonPathDraft] = useState('')
  const [pythonPathSaved, setPythonPathSaved] = useState('')
  const [pythonPathSaving, setPythonPathSaving] = useState(false)
  const [pythonPathMessage, setPythonPathMessage] = useState<string | null>(null)
  const [systemSettingsError, setSystemSettingsError] = useState<string | null>(null)
  const configMutationSeqRef = useRef(0)
  const configSnapshotRef = useRef({
    enabled: false,
    authorizedApps: [] as AuthorizedApp[],
    grantFlags: {
      clipboardRead: false,
      clipboardWrite: false,
      systemKeyCombos: false,
    },
  })
  const statusRequestSeqRef = useRef(0)
  const appsRequestSeqRef = useRef(0)
  const configWriteSeqRef = useRef(0)
  const configWriteQueueRef = useRef<Promise<void>>(Promise.resolve())
  const saveFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchStatus = useCallback(async () => {
    const requestSeq = ++statusRequestSeqRef.current
    setCheckState('loading')
    try {
      const s = await computerUseApi.getStatus()
      if (requestSeq !== statusRequestSeqRef.current) return
      setStatus(s)
      setCheckState('ready')
    } catch {
      if (requestSeq !== statusRequestSeqRef.current) return
      setCheckState('error')
    }
  }, [])

  const applyConfig = useCallback((
    configResult: Awaited<ReturnType<typeof computerUseApi.getAuthorizedApps>>,
    requestSeq = configMutationSeqRef.current,
  ) => {
    if (requestSeq !== configMutationSeqRef.current) return
    configSnapshotRef.current = {
      enabled: configResult.enabled,
      authorizedApps: configResult.authorizedApps,
      grantFlags: configResult.grantFlags,
    }
    setComputerUseEnabled(configResult.enabled)
    setAuthorizedBundleIds(new Set(configResult.authorizedApps.map(a => a.bundleId)))
    setClipboardRead(configResult.grantFlags.clipboardRead)
    setClipboardWrite(configResult.grantFlags.clipboardWrite)
    setSystemKeys(configResult.grantFlags.systemKeyCombos)
    setPythonPathDraft(configResult.pythonPath ?? '')
    setPythonPathSaved(configResult.pythonPath ?? '')
    setConfigState('ready')
  }, [])

  const fetchConfig = useCallback(async () => {
    const requestSeq = configMutationSeqRef.current
    setConfigState('loading')
    try {
      applyConfig(await computerUseApi.getAuthorizedApps(), requestSeq)
    } catch {
      if (requestSeq === configMutationSeqRef.current) setConfigState('error')
    }
  }, [applyConfig])

  const fetchApps = useCallback(async () => {
    const appsRequestSeq = ++appsRequestSeqRef.current
    const requestSeq = configMutationSeqRef.current
    setAppsLoading(true)
    setAppsLoadFailed(false)
    try {
      const [appsResult, configResult] = await Promise.all([
        computerUseApi.getInstalledApps(),
        computerUseApi.getAuthorizedApps(),
      ])
      if (appsRequestSeq !== appsRequestSeqRef.current) return
      setInstalledApps(appsResult.apps)
      applyConfig(configResult, requestSeq)
    } catch {
      if (appsRequestSeq !== appsRequestSeqRef.current) return
      setAppsLoadFailed(true)
    } finally {
      if (appsRequestSeq === appsRequestSeqRef.current) setAppsLoading(false)
    }
  }, [applyConfig])

  const persistConfig = useCallback((
    config: Partial<ComputerUseConfig>,
    showFeedback = true,
  ) => {
    const writeSeq = ++configWriteSeqRef.current
    if (showFeedback) {
      if (saveFeedbackTimerRef.current) clearTimeout(saveFeedbackTimerRef.current)
      setConfigSaveState('saving')
    }

    const request = configWriteQueueRef.current
      .catch(() => undefined)
      .then(() => computerUseApi.setAuthorizedApps(config))
    configWriteQueueRef.current = request.then(() => undefined, () => undefined)

    void request.then(() => {
      if (!showFeedback || writeSeq !== configWriteSeqRef.current) return
      setConfigSaveState('saved')
      saveFeedbackTimerRef.current = setTimeout(() => {
        if (writeSeq === configWriteSeqRef.current) setConfigSaveState('idle')
      }, 1500)
    }).catch(() => {
      if (showFeedback && writeSeq === configWriteSeqRef.current) {
        setConfigSaveState('error')
        void fetchConfig()
      }
    })

    return request
  }, [fetchConfig])

  useEffect(() => {
    fetchStatus()
    fetchConfig()
  }, [fetchStatus, fetchConfig])

  useEffect(() => () => {
    statusRequestSeqRef.current += 1
    appsRequestSeqRef.current += 1
    configWriteSeqRef.current += 1
    if (saveFeedbackTimerRef.current) clearTimeout(saveFeedbackTimerRef.current)
  }, [])

  // Load apps when environment is ready
  const envReady = Boolean(
    status?.supported
    && status.venv.created
    && status.dependencies.installed,
  )
  useEffect(() => {
    if (envReady) fetchApps()
  }, [envReady, fetchApps])

  const handleSetup = async () => {
    setSetupRunning(true)
    setSetupResult(null)
    try {
      const result = await computerUseApi.runSetup()
      setSetupResult(result)
      await fetchStatus()
      if (result.success) await fetchApps()
    } catch {
      setSetupResult({ success: false, steps: [{ name: 'error', ok: false, message: 'Request failed' }] })
    } finally {
      setSetupRunning(false)
    }
  }

  const toggleApp = (app: InstalledApp, authorized: boolean) => {
    configMutationSeqRef.current += 1
    const snapshot = configSnapshotRef.current
    const existing = snapshot.authorizedApps.some(
      candidate => candidate.bundleId === app.bundleId,
    )
    if (existing === authorized) return

    const newAuthorized = authorized
      ? [
          ...snapshot.authorizedApps,
          {
        bundleId: app.bundleId,
        displayName: app.displayName,
        authorizedAt: new Date().toISOString(),
          },
        ]
      : snapshot.authorizedApps.filter(
          candidate => candidate.bundleId !== app.bundleId,
        )
    configSnapshotRef.current = {
      ...snapshot,
      authorizedApps: newAuthorized,
    }
    setAuthorizedBundleIds(new Set(newAuthorized.map(candidate => candidate.bundleId)))

    persistConfig({
      authorizedApps: newAuthorized,
      grantFlags: snapshot.grantFlags,
    })
  }

  const toggleFlag = (
    flag: 'clipboardRead' | 'clipboardWrite' | 'systemKeys',
    value: boolean,
  ) => {
    configMutationSeqRef.current += 1
    const snapshot = configSnapshotRef.current
    const grantFlags = {
      ...snapshot.grantFlags,
      ...(flag === 'clipboardRead' ? { clipboardRead: value } : {}),
      ...(flag === 'clipboardWrite' ? { clipboardWrite: value } : {}),
      ...(flag === 'systemKeys' ? { systemKeyCombos: value } : {}),
    }
    configSnapshotRef.current = { ...snapshot, grantFlags }
    if (flag === 'clipboardRead') setClipboardRead(value)
    else if (flag === 'clipboardWrite') setClipboardWrite(value)
    else setSystemKeys(value)

    persistConfig({
      authorizedApps: snapshot.authorizedApps,
      grantFlags,
    })
  }

  const toggleComputerUseEnabled = (value: boolean) => {
    configMutationSeqRef.current += 1
    configSnapshotRef.current = {
      ...configSnapshotRef.current,
      enabled: value,
    }
    setComputerUseEnabled(value)
    persistConfig({ enabled: value })
  }

  const handleOpenSystemSettings = async (
    pane: 'Privacy_ScreenCapture' | 'Privacy_Accessibility',
  ) => {
    setSystemSettingsError(null)
    try {
      await openSystemSettings(pane)
    } catch {
      setSystemSettingsError(t('settings.computerUse.openSettingsFailed'))
    }
  }

  const savePythonPath = async (value = pythonPathDraft) => {
    configMutationSeqRef.current += 1
    const normalized = value.trim()
    setPythonPathSaving(true)
    setPythonPathMessage(null)
    try {
      await persistConfig({ pythonPath: normalized || null }, false)
      setPythonPathDraft(normalized)
      setPythonPathSaved(normalized)
      setPythonPathMessage(t('settings.computerUse.pythonPathSaved'))
      await fetchStatus()
    } catch {
      setPythonPathMessage(t('settings.computerUse.pythonPathSaveFailed'))
    } finally {
      setPythonPathSaving(false)
    }
  }

  const choosePythonPath = async () => {
    const host = getDesktopHost()
    if (!host.capabilities.dialogs) {
      setPythonPathMessage(t('settings.computerUse.pythonPathDialogFailed'))
      return
    }
    try {
      const selected = await host.dialogs.open({
        multiple: false,
        directory: false,
        title: t('settings.computerUse.pythonPathDialogTitle'),
      })
      const selectedPath = Array.isArray(selected) ? selected[0] : selected
      if (typeof selectedPath === 'string' && selectedPath.trim()) {
        setPythonPathDraft(selectedPath)
        await savePythonPath(selectedPath)
      }
    } catch {
      setPythonPathMessage(t('settings.computerUse.pythonPathDialogFailed'))
    }
  }

  const allReady =
    status?.supported &&
    status.python.installed &&
    status.venv.created &&
    status.dependencies.installed

  const accessibilityNeedsAttention = status?.permissions.accessibility === false
  const screenRecordingNeedsAttention = status?.permissions.screenRecording === false
  const screenRecordingReady = status ? status.permissions.screenRecording !== false : null
  const pythonDownloadUrl = status
    ? PYTHON_DOWNLOAD_URLS[status.platform] ?? 'https://www.python.org/downloads/'
    : 'https://www.python.org/downloads/'
  const pythonPathDirty = pythonPathDraft.trim() !== pythonPathSaved
  const pythonDetail = status?.python.installed
    ? `${t('settings.computerUse.pythonFound')} — ${status.python.version} (${status.python.path})`
    : status?.python.source === 'custom'
      ? `${t('settings.computerUse.pythonCustomInvalid')} — ${status.python.path}${status.python.error ? `: ${status.python.error}` : ''}`
      : t('settings.computerUse.pythonNotFound')

  // Filter apps by search query
  const filteredApps = useMemo(() => {
    if (!searchQuery) return installedApps
    const q = searchQuery.toLowerCase()
    return installedApps.filter(
      a => a.displayName.toLowerCase().includes(q) || a.bundleId.toLowerCase().includes(q)
    )
  }, [installedApps, searchQuery])

  // Sort: authorized apps first, then alphabetical
  const sortedApps = useMemo(() => {
    return [...filteredApps].sort((a, b) => {
      const aAuth = authorizedBundleIds.has(a.bundleId) ? 0 : 1
      const bAuth = authorizedBundleIds.has(b.bundleId) ? 0 : 1
      if (aAuth !== bAuth) return aAuth - bAuth
      return a.displayName.localeCompare(b.displayName)
    })
  }, [filteredApps, authorizedBundleIds])

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
            {t('settings.computerUse.title')}
          </h2>
          <div className="flex items-center gap-2">
            <Switch
              id="computer-use-enabled"
              checked={computerUseEnabled}
              disabled={configState !== 'ready'}
              onCheckedChange={toggleComputerUseEnabled}
            />
            <Label htmlFor="computer-use-enabled" className="cursor-pointer text-[var(--color-text-secondary)]">
              {t('settings.computerUse.enabledToggle')}
            </Label>
          </div>
        </div>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          {t('settings.computerUse.description')}
        </p>
      </div>

      {configState === 'error' && (
        <Alert variant="destructive">
          <AlertTitle>{t('common.error')}</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{t('settings.computerUse.configLoadFailed')}</span>
            <Button variant="outline" size="sm" onClick={() => void fetchConfig()}>
              <RefreshCw aria-hidden="true" />
              {t('common.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {configState === 'ready' && !computerUseEnabled && (
        <Alert className="border-yellow-500/30 bg-yellow-500/10">
          <AlertDescription className="text-yellow-700">
            {t('settings.computerUse.disabledHint')}
          </AlertDescription>
        </Alert>
      )}

      {checkState === 'loading' ? (
        <div className="space-y-2" role="status" aria-label={t('common.loading')}>
          <Skeleton className="h-[54px] w-full" />
          <Skeleton className="h-[54px] w-full" />
          <Skeleton className="h-[54px] w-full" />
        </div>
      ) : checkState === 'error' ? (
        <Alert variant="destructive">
          <AlertTitle>{t('common.error')}</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{t('settings.computerUse.statusCheckFailed')}</span>
            <Button variant="outline" size="sm" onClick={fetchStatus}>
              <RefreshCw aria-hidden="true" />
              {t('common.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : status ? (
        <>
          {!status.supported && (
            <Alert className="border-yellow-500/30 bg-yellow-500/10">
              <AlertDescription className="text-yellow-700">
                {t('settings.computerUse.notSupported')}
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <ComputerUseStatusRow
              label={t('settings.computerUse.python')}
              ok={status.python.installed}
              detail={pythonDetail}
            />
            <ComputerUseStatusRow
              label={t('settings.computerUse.venv')}
              ok={status.venv.created}
              detail={status.venv.created ? `${t('settings.computerUse.venvReady')} — ${status.venv.path}` : t('settings.computerUse.venvNotReady')}
            />
            <ComputerUseStatusRow
              label={t('settings.computerUse.deps')}
              ok={status.dependencies.installed}
              detail={status.dependencies.installed ? t('settings.computerUse.depsReady') : t('settings.computerUse.depsNotReady')}
            />
          </div>

          <Card>
            <CardContent className="space-y-2">
              <Label htmlFor="computer-use-python-path">
                {t('settings.computerUse.pythonPathLabel')}
              </Label>
              <div className="flex flex-wrap gap-2">
                <Input
                  id="computer-use-python-path"
                  type="text"
                  value={pythonPathDraft}
                  onChange={event => {
                    setPythonPathDraft(event.target.value)
                    setPythonPathMessage(null)
                  }}
                  placeholder={t('settings.computerUse.pythonPathPlaceholder')}
                  aria-describedby="computer-use-python-path-hint"
                  className="min-w-[220px] flex-1 font-mono text-xs"
                />
                <Button
                  variant="secondary"
                  onClick={choosePythonPath}
                  disabled={pythonPathSaving}
                >
                  <FolderOpen aria-hidden="true" />
                  {t('settings.computerUse.pythonPathBrowse')}
                </Button>
                <LoadingButton
                  loading={pythonPathSaving}
                  onClick={() => void savePythonPath()}
                  disabled={!pythonPathDirty}
                >
                  {!pythonPathSaving && <Save aria-hidden="true" />}
                  {t('settings.computerUse.pythonPathSave')}
                </LoadingButton>
                {pythonPathSaved && (
                  <Button
                    variant="secondary"
                    onClick={() => void savePythonPath('')}
                    disabled={pythonPathSaving}
                  >
                    <RotateCcw aria-hidden="true" />
                    {t('settings.computerUse.pythonPathAuto')}
                  </Button>
                )}
              </div>
              <p
                id="computer-use-python-path-hint"
                role={pythonPathMessage ? 'status' : undefined}
                className="text-xs text-[var(--color-text-tertiary)]"
              >
                {pythonPathMessage ?? t('settings.computerUse.pythonPathHint')}
              </p>
            </CardContent>
          </Card>

          {envReady && status.platform === 'darwin' && (
            <>
              <ComputerUseStatusRow
                label={t('settings.computerUse.accessibility')}
                ok={status.permissions.accessibility}
                detail={
                  status.permissions.accessibility === null ? t('settings.computerUse.permUnknown')
                    : status.permissions.accessibility ? t('settings.computerUse.permGranted')
                      : t('settings.computerUse.permDenied')
                }
              />
              <ComputerUseStatusRow
                label={t('settings.computerUse.screenRecording')}
                ok={screenRecordingReady}
                detail={
                  status.permissions.screenRecording === true ? t('settings.computerUse.permGranted')
                    : status.permissions.screenRecording === false ? t('settings.computerUse.permDenied')
                      : t('settings.computerUse.permScreenRecordingUnknownSoft')
                }
              />
              {(accessibilityNeedsAttention || screenRecordingNeedsAttention) && (
                <Alert className="border-yellow-500/20 bg-yellow-500/5">
                  <AlertDescription>
                    <p>{t('settings.computerUse.permRestartHint')}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {accessibilityNeedsAttention && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => void handleOpenSystemSettings('Privacy_Accessibility')}
                        >
                          <ExternalLink aria-hidden="true" />
                          {t('settings.computerUse.openAccessibility')}
                        </Button>
                      )}
                      {screenRecordingNeedsAttention && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => void handleOpenSystemSettings('Privacy_ScreenCapture')}
                        >
                          <ExternalLink aria-hidden="true" />
                          {t('settings.computerUse.openScreenRecording')}
                        </Button>
                      )}
                    </div>
                  </AlertDescription>
                </Alert>
              )}
              {systemSettingsError && (
                <Alert variant="destructive">
                  <AlertDescription>{systemSettingsError}</AlertDescription>
                </Alert>
              )}
            </>
          )}

          {allReady && (status.platform !== 'darwin' || (status.permissions.accessibility && screenRecordingReady)) && (
            <Alert className="border-green-500/30 bg-green-500/10">
              <AlertDescription className="flex items-center gap-2 text-green-600">
                <CircleCheck className="h-[18px] w-[18px]" aria-hidden="true" />
                {t('settings.computerUse.allReady')}
              </AlertDescription>
            </Alert>
          )}

          {setupResult && (
            <Alert
              variant={setupResult.success ? 'default' : 'destructive'}
              className={setupResult.success ? 'border-green-500/30 bg-green-500/5' : undefined}
            >
              <AlertTitle className={setupResult.success ? 'text-green-600' : undefined}>
                {setupResult.success ? t('settings.computerUse.setupSuccess') : t('settings.computerUse.setupFail')}
              </AlertTitle>
              <AlertDescription className="space-y-2">
                {setupResult.steps.map((step, index) => (
                  <div key={`${step.name}-${index}`} className="flex items-center gap-2 text-[var(--color-text-secondary)]">
                    <StatusIcon ok={step.ok} />
                    <span>{step.message}</span>
                  </div>
                ))}
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap gap-3">
            {!status.python.installed && (
              <Button
                size="lg"
                onClick={() => void openExternalUrl(pythonDownloadUrl)}
              >
                <ExternalLink aria-hidden="true" />
                {t('settings.computerUse.downloadPython')}
              </Button>
            )}
            {!envReady && status.supported && status.python.installed && (
              <LoadingButton
                size="lg"
                loading={setupRunning}
                onClick={() => void handleSetup()}
              >
                {!setupRunning && <Download aria-hidden="true" />}
                {setupRunning ? t('settings.computerUse.setupRunning') : t('settings.computerUse.setupBtn')}
              </LoadingButton>
            )}
            <Button
              variant="secondary"
              size="lg"
              onClick={() => void fetchStatus()}
            >
              <RefreshCw aria-hidden="true" />
              {t('settings.computerUse.recheckBtn')}
            </Button>
          </div>

          {envReady && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-base">{t('settings.computerUse.appsTitle')}</CardTitle>
                  {configSaveState === 'saving' && (
                    <Badge variant="secondary">{t('common.loading')}</Badge>
                  )}
                  {configSaveState === 'saved' && (
                    <Badge variant="outline" className="text-green-600">
                      <Check aria-hidden="true" />
                      {t('settings.computerUse.appsSaved')}
                    </Badge>
                  )}
                </div>
                <CardDescription>
                  {t('settings.computerUse.appsDescription')}
                  {' '}
                  {t('settings.computerUse.newSessionsHint')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 pt-0">
                {configSaveState === 'error' && (
                  <Alert variant="destructive">
                    <AlertDescription>{t('settings.computerUse.appsSaveFailed')}</AlertDescription>
                  </Alert>
                )}

                <div className="flex flex-wrap gap-4">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="computer-use-clipboard-read"
                      checked={clipboardRead}
                      disabled={configState !== 'ready'}
                      onCheckedChange={checked => toggleFlag('clipboardRead', checked === true)}
                    />
                    <Label htmlFor="computer-use-clipboard-read" className="cursor-pointer text-[var(--color-text-secondary)]">
                      {t('settings.computerUse.flagClipboardRead')}
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="computer-use-clipboard-write"
                      checked={clipboardWrite}
                      disabled={configState !== 'ready'}
                      onCheckedChange={checked => toggleFlag('clipboardWrite', checked === true)}
                    />
                    <Label htmlFor="computer-use-clipboard-write" className="cursor-pointer text-[var(--color-text-secondary)]">
                      {t('settings.computerUse.flagClipboardWrite')}
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="computer-use-system-keys"
                      checked={systemKeys}
                      disabled={configState !== 'ready'}
                      onCheckedChange={checked => toggleFlag('systemKeys', checked === true)}
                    />
                    <Label htmlFor="computer-use-system-keys" className="cursor-pointer text-[var(--color-text-secondary)]">
                      {t('settings.computerUse.flagSystemKeys')}
                    </Label>
                  </div>
                </div>

                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[var(--color-text-tertiary)]"
                    aria-hidden="true"
                  />
                  <Input
                    type="text"
                    value={searchQuery}
                    onChange={event => setSearchQuery(event.target.value)}
                    placeholder={t('settings.computerUse.appsSearch')}
                    aria-label={t('settings.computerUse.appsSearch')}
                    className="pl-9"
                  />
                </div>

                {appsLoading ? (
                  <div className="space-y-2" role="status" aria-label={t('settings.computerUse.appsLoading')}>
                    <Skeleton className="h-14 w-full" />
                    <Skeleton className="h-14 w-full" />
                    <Skeleton className="h-14 w-full" />
                  </div>
                ) : appsLoadFailed ? (
                  <Alert variant="destructive">
                    <AlertDescription className="flex items-center justify-between gap-3">
                      <span>{t('settings.computerUse.appsLoadFailed')}</span>
                      <Button variant="outline" size="sm" onClick={() => void fetchApps()}>
                        <RefreshCw aria-hidden="true" />
                        {t('common.retry')}
                      </Button>
                    </AlertDescription>
                  </Alert>
                ) : installedApps.length === 0 ? (
                  <Alert>
                    <AlertDescription>{t('settings.computerUse.appsEmpty')}</AlertDescription>
                  </Alert>
                ) : sortedApps.length === 0 ? (
                  <Alert>
                    <AlertDescription>{t('settings.computerUse.appsNoResults')}</AlertDescription>
                  </Alert>
                ) : (
                  <ScrollArea className="h-[400px] rounded-[var(--radius-md)] border border-[var(--color-border)]">
                    <div className="divide-y divide-[var(--color-border)]">
                      {sortedApps.map(app => {
                        const isAuthorized = authorizedBundleIds.has(app.bundleId)
                        const inputId = `computer-use-app-${app.bundleId}`
                        return (
                          <div
                            key={app.bundleId}
                            className={`flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[var(--color-surface-hover)] ${
                              isAuthorized ? 'bg-[var(--color-brand)]/5' : ''
                            }`}
                          >
                            <Checkbox
                              id={inputId}
                              checked={isAuthorized}
                              disabled={configState !== 'ready'}
                              aria-label={app.displayName}
                              onCheckedChange={checked => toggleApp(app, checked === true)}
                            />
                            <Label
                              htmlFor={inputId}
                              className="min-w-0 flex-1 cursor-pointer flex-col items-start gap-0.5"
                            >
                              <span className="block w-full truncate text-sm font-medium text-[var(--color-text-primary)]">
                                {app.displayName}
                              </span>
                              <span className="block w-full truncate font-mono text-[11px] font-normal text-[var(--color-text-tertiary)]">
                                {app.bundleId}
                              </span>
                            </Label>
                          </div>
                        )
                      })}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          )}
        </>
      ) : null}
    </div>
  )
}
