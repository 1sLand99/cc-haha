import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { computerUseApi, type ComputerUseStatus, type SetupResult, type InstalledApp, type AuthorizedApp } from '../api/computerUse'
import { useTranslation } from '../i18n'
import { Button } from '@/components/ui/Button'
import { ErrorState } from '@/components/ui/ErrorState'
import { LoadingState } from '@/components/ui/LoadingState'
import { Modal } from '@/components/ui/Modal'
import { Switch } from '@/components/ui/Switch'
import { getDesktopHost } from '../lib/desktopHost'

type CheckState = 'loading' | 'ready' | 'error'
const PYTHON_DOWNLOAD_URLS: Record<string, string> = {
  darwin: 'https://www.python.org/downloads/macos/',
  win32: 'https://www.python.org/downloads/windows/',
}

function StatusIcon({ ok }: { ok: boolean | null }) {
  if (ok === null) {
    return <span className="material-symbols-outlined text-[18px] text-[var(--color-text-tertiary)]">help</span>
  }
  return ok ? (
    <span className="material-symbols-outlined text-[18px] text-[var(--color-success)]" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
  ) : (
    <span className="material-symbols-outlined text-[18px] text-[var(--color-error)]" style={{ fontVariationSettings: "'FILL' 1" }}>cancel</span>
  )
}

function StatusRow({ label, ok, detail }: { label: string; ok: boolean | null; detail: string }) {
  return (
    <div className="flex items-center gap-3 py-2.5 px-4 rounded-[var(--radius-lg)] bg-[var(--color-surface-container-low)]">
      <StatusIcon ok={ok} />
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-[var(--color-text-primary)]">{label}</span>
        <span className="ml-2 text-xs text-[var(--color-text-tertiary)]">{detail}</span>
      </div>
    </div>
  )
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
  const [configState, setConfigState] = useState<CheckState>('loading')
  const [configError, setConfigError] = useState<string | null>(null)
  const [setupRunning, setSetupRunning] = useState(false)
  const [setupResult, setSetupResult] = useState<SetupResult | null>(null)

  // App authorization state
  const [installedApps, setInstalledApps] = useState<InstalledApp[]>([])
  const [authorizedBundleIds, setAuthorizedBundleIds] = useState<Set<string>>(new Set())
  const [authorizedApps, setAuthorizedApps] = useState<AuthorizedApp[]>([])
  const [appsLoading, setAppsLoading] = useState(false)
  const [appsSaved, setAppsSaved] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [computerUseEnabled, setComputerUseEnabled] = useState(true)
  const [clipboardAccess, setClipboardAccess] = useState(true)
  const [systemKeys, setSystemKeys] = useState(true)
  const [pythonPathDraft, setPythonPathDraft] = useState('')
  const [pythonPathSaved, setPythonPathSaved] = useState('')
  const [pythonPathSaving, setPythonPathSaving] = useState(false)
  const [pythonPathMessage, setPythonPathMessage] = useState<string | null>(null)
  // Native (cu-helper) Codex-style UI state
  const [pickerOpen, setPickerOpen] = useState(false)
  const [cardOpening, setCardOpening] = useState(false)
  const [cardError, setCardError] = useState<string | null>(null)
  const configMutationSeqRef = useRef(0)
  const statusRequestSeqRef = useRef(0)

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
    setComputerUseEnabled(configResult.enabled)
    setAuthorizedApps(configResult.authorizedApps)
    setAuthorizedBundleIds(new Set(configResult.authorizedApps.map(a => a.bundleId)))
    setClipboardAccess(configResult.grantFlags.clipboardRead)
    setSystemKeys(configResult.grantFlags.systemKeyCombos)
    setPythonPathDraft(configResult.pythonPath ?? '')
    setPythonPathSaved(configResult.pythonPath ?? '')
  }, [])

  const fetchConfig = useCallback(async () => {
    const requestSeq = configMutationSeqRef.current
    setConfigState('loading')
    try {
      const config = await computerUseApi.getAuthorizedApps()
      if (requestSeq !== configMutationSeqRef.current) return
      applyConfig(config, requestSeq)
      setConfigState('ready')
    } catch {
      if (requestSeq !== configMutationSeqRef.current) return
      setConfigState('error')
    }
  }, [applyConfig])

  const fetchApps = useCallback(async () => {
    const requestSeq = configMutationSeqRef.current
    setAppsLoading(true)
    try {
      const [appsResult, configResult] = await Promise.all([
        computerUseApi.getInstalledApps(),
        computerUseApi.getAuthorizedApps(),
      ])
      setInstalledApps(appsResult.apps)
      applyConfig(configResult, requestSeq)
    } catch {
      // API not ready
    } finally {
      setAppsLoading(false)
    }
  }, [applyConfig])

  useEffect(() => {
    fetchStatus()
    fetchConfig()
  }, [fetchStatus, fetchConfig])

  // Load apps when environment is ready
  const envReady = status?.venv.created && status?.dependencies.installed
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

  const toggleApp = (app: InstalledApp) => {
    configMutationSeqRef.current += 1
    const newSet = new Set(authorizedBundleIds)
    let newAuthorized = [...authorizedApps]
    if (newSet.has(app.bundleId)) {
      newSet.delete(app.bundleId)
      newAuthorized = newAuthorized.filter(a => a.bundleId !== app.bundleId)
    } else {
      newSet.add(app.bundleId)
      newAuthorized.push({
        bundleId: app.bundleId,
        displayName: app.displayName,
        authorizedAt: new Date().toISOString(),
      })
    }
    setAuthorizedBundleIds(newSet)
    setAuthorizedApps(newAuthorized)

    // Auto-save
    computerUseApi.setAuthorizedApps({
      authorizedApps: newAuthorized,
      grantFlags: { clipboardRead: clipboardAccess, clipboardWrite: clipboardAccess, systemKeyCombos: systemKeys },
    }).then(() => {
      setAppsSaved(true)
      setTimeout(() => setAppsSaved(false), 1500)
    })
  }

  const toggleFlag = (flag: 'clipboard' | 'systemKeys', value: boolean) => {
    configMutationSeqRef.current += 1
    if (flag === 'clipboard') setClipboardAccess(value)
    else setSystemKeys(value)

    computerUseApi.setAuthorizedApps({
      authorizedApps,
      grantFlags: {
        clipboardRead: flag === 'clipboard' ? value : clipboardAccess,
        clipboardWrite: flag === 'clipboard' ? value : clipboardAccess,
        systemKeyCombos: flag === 'systemKeys' ? value : systemKeys,
      },
    })
  }

  const toggleComputerUseEnabled = async (value: boolean): Promise<boolean> => {
    const requestSeq = ++configMutationSeqRef.current
    const previous = computerUseEnabled
    setConfigError(null)
    setComputerUseEnabled(value)
    try {
      await computerUseApi.setAuthorizedApps({ enabled: value })
      if (requestSeq !== configMutationSeqRef.current) return true
      setAppsSaved(true)
      setTimeout(() => setAppsSaved(false), 1500)
      return true
    } catch {
      if (requestSeq === configMutationSeqRef.current) {
        setComputerUseEnabled(previous)
        setConfigError(t('settings.computerUse.configSaveFailed'))
      }
      return false
    }
  }

  // ── Native (cu-helper) handlers ──

  // Spawn the native cu-helper permission card, then re-read status (the card
  // resolves only when the user closes it). Safe to call even when perms are
  // already granted (the user can use the "reopen" button to revisit it).
  const openPermissionCard = useCallback(async () => {
    setCardOpening(true)
    setCardError(null)
    try {
      const result = await computerUseApi.openPermissionCard()
      if (!result.ok) throw new Error(result.reason ?? 'permission card failed')
    } catch {
      setCardError(t('settings.computerUse.openCardFailed'))
    } finally {
      setCardOpening(false)
      // Always refresh — the card may have changed OS permission state.
      await fetchStatus()
    }
  }, [t, fetchStatus])

  // Master Computer Use toggle on the native path. Mirrors toggleComputerUseEnabled
  // for persistence, but additionally pops the native OS-permission card when
  // turning ON while macOS permissions are still missing (the headline flow).
  const toggleAnyApp = (value: boolean) => {
    void (async () => {
      const saved = await toggleComputerUseEnabled(value)
      if (
        saved &&
        value &&
        (status?.permissions.accessibility === false ||
          status?.permissions.screenRecording === false)
      ) {
        await openPermissionCard()
      }
    })()
  }

  // Persist an authorized-apps list change (native add/remove). Reuses the same
  // setAuthorizedApps shape + saved-flash + stale-guard discipline as toggleApp.
  const persistAuthorizedApps = useCallback((next: AuthorizedApp[]) => {
    configMutationSeqRef.current += 1
    setAuthorizedApps(next)
    setAuthorizedBundleIds(new Set(next.map(a => a.bundleId)))
    computerUseApi.setAuthorizedApps({
      authorizedApps: next,
      grantFlags: { clipboardRead: clipboardAccess, clipboardWrite: clipboardAccess, systemKeyCombos: systemKeys },
    }).then(() => {
      setAppsSaved(true)
      setTimeout(() => setAppsSaved(false), 1500)
    })
  }, [clipboardAccess, systemKeys])

  const removeAuthorizedApp = (bundleId: string) => {
    persistAuthorizedApps(authorizedApps.filter(a => a.bundleId !== bundleId))
  }

  const addAuthorizedApp = (app: InstalledApp) => {
    if (authorizedBundleIds.has(app.bundleId)) {
      setPickerOpen(false)
      return
    }
    persistAuthorizedApps([
      ...authorizedApps,
      {
        bundleId: app.bundleId,
        displayName: app.displayName,
        authorizedAt: new Date().toISOString(),
      },
    ])
    setPickerOpen(false)
  }

  // Lazy-load installed apps the first time the picker opens (the native path
  // has no Python env-ready gate, so fetchApps' envReady effect never fires).
  const openPicker = useCallback(() => {
    setSearchQuery('')
    setPickerOpen(true)
    if (installedApps.length === 0) void fetchApps()
  }, [installedApps.length, fetchApps])

  const savePythonPath = async (value = pythonPathDraft) => {
    configMutationSeqRef.current += 1
    const normalized = value.trim()
    setPythonPathSaving(true)
    setPythonPathMessage(null)
    try {
      await computerUseApi.setAuthorizedApps({ pythonPath: normalized || null })
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

  // Native (cu-helper) path: drop the entire Python setup flow in favor of the
  // Codex-style page. Branch ONLY when on macOS AND the Swift helper resolves.
  const native = status?.engine === 'macos-native'

  // Picker list (native "+ 添加应用"): installed apps not yet authorized, sorted.
  const pickerApps = useMemo(() => {
    return [...filteredApps]
      .filter(a => !authorizedBundleIds.has(a.bundleId))
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
  }, [filteredApps, authorizedBundleIds])

  // The renderer cannot choose between the native macOS page and the
  // compatibility page until the capability probe finishes. Rendering the
  // compatibility page here used to flash its header toggle before the native
  // page replaced the entire tree.
  if (status === null) {
    return (
      <div className="max-w-2xl">
        {checkState === 'error' ? (
          <ErrorState
            size="lg"
            title="Failed to check status."
            retryLabel={t('common.retry')}
            onRetry={fetchStatus}
          />
        ) : (
          <LoadingState size="md" label={t('common.loading')} />
        )}
      </div>
    )
  }

  // Status chooses the page implementation, while config supplies the switch
  // value. Waiting for both prevents a native disabled setting from briefly
  // rendering as enabled when the capability probe wins the race.
  if (configState === 'loading') {
    return (
      <div className="max-w-2xl">
        <LoadingState size="md" label={t('common.loading')} />
      </div>
    )
  }

  if (configState === 'error') {
    return (
      <div className="max-w-2xl">
        <ErrorState
          size="lg"
          title={t('settings.computerUse.configLoadFailed')}
          retryLabel={t('common.retry')}
          onRetry={fetchConfig}
        />
      </div>
    )
  }

  if (status.engine === 'unsupported') {
    const macosVersionProblem = status.platform === 'darwin'
    const versionDetectionFailed = status.cuHelper.reason === 'system_version_unknown'
    return (
      <div className="max-w-2xl space-y-5">
        <div>
          <h2 className="text-[24px] font-semibold leading-tight text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-headline)' }}>
            {t('settings.computerUse.controlTitle')}
          </h2>
          <p className="mt-1.5 text-[13.5px] leading-6 text-[var(--color-text-secondary)]">
            {t('settings.computerUse.controlSubtitle')}
          </p>
        </div>
        <ErrorState
          size="lg"
          title={versionDetectionFailed
            ? t('settings.computerUse.macosDetectionFailedTitle')
            : macosVersionProblem
            ? t('settings.computerUse.macosUnsupportedTitle', { version: status.cuHelper.minimumMacosVersion })
            : t('settings.computerUse.notSupported')}
          detail={versionDetectionFailed
            ? t('settings.computerUse.macosDetectionFailedDetail')
            : macosVersionProblem
            ? t('settings.computerUse.macosUnsupportedDetail', { current: status.systemVersion ?? t('settings.computerUse.unknownVersion') })
            : undefined}
          retryLabel={versionDetectionFailed ? t('settings.computerUse.recheckBtn') : undefined}
          onRetry={versionDetectionFailed ? fetchStatus : undefined}
          tone="strong"
        />
      </div>
    )
  }

  if (native && status) {
    return (
      <NativeComputerUse
        t={t}
        status={status}
        enabled={computerUseEnabled}
        onToggleEnabled={toggleAnyApp}
        authorizedApps={authorizedApps}
        onRemoveApp={removeAuthorizedApp}
        appsSaved={appsSaved}
        configError={configError}
        statusError={checkState === 'error'}
        cardOpening={cardOpening}
        cardError={cardError}
        onOpenCard={openPermissionCard}
        onRecheck={fetchStatus}
        pickerOpen={pickerOpen}
        onOpenPicker={openPicker}
        onClosePicker={() => setPickerOpen(false)}
        onAddApp={addAuthorizedApp}
        appsLoading={appsLoading}
        pickerApps={pickerApps}
        searchQuery={searchQuery}
        onSearch={setSearchQuery}
      />
    )
  }

  // The Python compatibility page is Windows-only. Missing or future engine
  // values (for example during a rolling sidecar/UI upgrade) fail closed on
  // the native page instead of resurrecting the retired macOS setup screen.
  if (status.engine !== 'windows-compat') {
    return (
      <div className="max-w-2xl space-y-5">
        <ErrorState
          size="lg"
          title={t('settings.computerUse.nativeUnavailableTitle')}
          detail={t('settings.computerUse.nativeUnavailableDetail')}
          retryLabel={t('settings.computerUse.recheckBtn')}
          onRetry={fetchStatus}
          tone="strong"
        />
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* Title */}
      <div>
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-[24px] font-semibold leading-tight text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-headline)' }}>
            {t('settings.computerUse.title')}
          </h2>
          <Switch
            checked={computerUseEnabled}
            onChange={value => { void toggleComputerUseEnabled(value) }}
            label={t('settings.computerUse.enabledToggle')}
            size="sm"
          />
        </div>
        <p className="mt-1.5 text-[13.5px] leading-6 text-[var(--color-text-secondary)]">
          {t('settings.computerUse.description')}
        </p>
      </div>

      {configError && (
        <div className="px-4 py-3 rounded-[var(--radius-lg)] border border-[var(--color-error)] bg-[var(--color-error-container)] text-sm text-[var(--color-on-error-container)]">
          {configError}
        </div>
      )}

      {!computerUseEnabled && (
        <div className="px-4 py-3 rounded-[var(--radius-lg)] border border-[var(--color-warning)] bg-[var(--color-warning-container)] text-sm text-[var(--color-on-warning-container)]">
          {t('settings.computerUse.disabledHint')}
        </div>
      )}

      {checkState === 'loading' ? (
        <LoadingState size="md" label={t('common.loading')} />
      ) : checkState === 'error' ? (
        <ErrorState
          size="lg"
          title="Failed to check status."
          retryLabel={t('common.retry')}
          onRetry={fetchStatus}
        />
      ) : status ? (
        <>
          {!status.supported && (
            <div className="px-4 py-3 rounded-[var(--radius-lg)] border border-[var(--color-warning)] bg-[var(--color-warning-container)] text-sm text-[var(--color-on-warning-container)]">
              {t('settings.computerUse.notSupported')}
            </div>
          )}

          {/* Status checks */}
          <div className="space-y-2">
            <StatusRow
              label={t('settings.computerUse.python')}
              ok={status.python.installed}
              detail={pythonDetail}
            />
            <StatusRow
              label={t('settings.computerUse.venv')}
              ok={status.venv.created}
              detail={status.venv.created ? `${t('settings.computerUse.venvReady')} — ${status.venv.path}` : t('settings.computerUse.venvNotReady')}
            />
            <StatusRow
              label={t('settings.computerUse.deps')}
              ok={status.dependencies.installed}
              detail={status.dependencies.installed ? t('settings.computerUse.depsReady') : t('settings.computerUse.depsNotReady')}
            />
          </div>

          <div className="space-y-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-4">
            <label htmlFor="computer-use-python-path" className="block text-sm font-medium text-[var(--color-text-primary)]">
              {t('settings.computerUse.pythonPathLabel')}
            </label>
            <div className="flex flex-wrap gap-2">
              <input
                id="computer-use-python-path"
                type="text"
                value={pythonPathDraft}
                onChange={e => {
                  setPythonPathDraft(e.target.value)
                  setPythonPathMessage(null)
                }}
                placeholder={t('settings.computerUse.pythonPathPlaceholder')}
                className="min-w-[220px] flex-1 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container)] px-3 py-2 font-mono text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-brand)] focus:outline-none"
              />
              <Button
                variant="secondary"
                size="base"
                onClick={choosePythonPath}
                disabled={pythonPathSaving}
                icon={<span className="material-symbols-outlined text-[16px]">folder_open</span>}
              >
                {t('settings.computerUse.pythonPathBrowse')}
              </Button>
              <Button
                variant="primary"
                size="base"
                onClick={() => savePythonPath()}
                disabled={!pythonPathDirty}
                loading={pythonPathSaving}
                icon={<span className="material-symbols-outlined text-[16px]">save</span>}
              >
                {t('settings.computerUse.pythonPathSave')}
              </Button>
              {pythonPathSaved && (
                <Button
                  variant="secondary"
                  size="base"
                  onClick={() => savePythonPath('')}
                  disabled={pythonPathSaving}
                  icon={<span className="material-symbols-outlined text-[16px]">restart_alt</span>}
                >
                  {t('settings.computerUse.pythonPathAuto')}
                </Button>
              )}
            </div>
            <p className="text-xs text-[var(--color-text-tertiary)]">
              {pythonPathMessage ?? t('settings.computerUse.pythonPathHint')}
            </p>
          </div>

          {/* macOS Permissions — only shown on macOS (darwin) */}
          {envReady && status.platform === 'darwin' && (
            <>
              <StatusRow
                label={t('settings.computerUse.accessibility')}
                ok={status.permissions.accessibility}
                detail={
                  status.permissions.accessibility === null ? t('settings.computerUse.permUnknown')
                    : status.permissions.accessibility ? t('settings.computerUse.permGranted')
                      : t('settings.computerUse.permDenied')
                }
              />
              <StatusRow
                label={t('settings.computerUse.screenRecording')}
                ok={screenRecordingReady}
                detail={
                  status.permissions.screenRecording === true ? t('settings.computerUse.permGranted')
                    : status.permissions.screenRecording === false ? t('settings.computerUse.permDenied')
                      : t('settings.computerUse.permScreenRecordingUnknownSoft')
                }
              />
              {(accessibilityNeedsAttention || screenRecordingNeedsAttention) && (
                <div className="flex flex-col gap-2 px-4 py-3 rounded-[var(--radius-lg)] border border-[var(--color-warning)] bg-[var(--color-warning-container)]">
                  <p className="text-xs text-[var(--color-on-warning-container)]">{t('settings.computerUse.permRestartHint')}</p>
                  <div className="flex gap-2">
                    {accessibilityNeedsAttention && (
                      <Button
                        variant="secondary"
                        size="base"
                        onClick={() => openSystemSettings('Privacy_Accessibility')}
                        icon={<span className="material-symbols-outlined text-[14px]">open_in_new</span>}
                      >
                        {t('settings.computerUse.openAccessibility')}
                      </Button>
                    )}
                    {screenRecordingNeedsAttention && (
                      <Button
                        variant="secondary"
                        size="base"
                        onClick={() => openSystemSettings('Privacy_ScreenCapture')}
                        icon={<span className="material-symbols-outlined text-[14px]">open_in_new</span>}
                      >
                        {t('settings.computerUse.openScreenRecording')}
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {allReady && (status.platform !== 'darwin' || (status.permissions.accessibility && screenRecordingReady)) && (
            <div className="px-4 py-3 rounded-[var(--radius-lg)] border border-[var(--color-success)] bg-[var(--color-success-container)] text-sm text-[var(--color-on-success-container)] flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
              {t('settings.computerUse.allReady')}
            </div>
          )}

          {setupResult && (
            <div className={`rounded-[var(--radius-lg)] border p-4 space-y-2 ${setupResult.success ? 'border-[var(--color-success)] bg-[var(--color-success-container)]' : 'border-[var(--color-error)] bg-[var(--color-error-container)]'}`}>
              <div className={`text-sm font-medium ${setupResult.success ? 'text-[var(--color-on-success-container)]' : 'text-[var(--color-on-error-container)]'}`}>
                {setupResult.success ? t('settings.computerUse.setupSuccess') : t('settings.computerUse.setupFail')}
              </div>
              {setupResult.steps.map((step, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                  <StatusIcon ok={step.ok} />
                  <span>{step.message}</span>
                </div>
              ))}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-3">
            {!status.python.installed && (
              <Button
                variant="primary"
                size="lg"
                onClick={() => openExternalUrl(pythonDownloadUrl)}
                icon={<span className="material-symbols-outlined text-[18px]">open_in_new</span>}
              >
                {t('settings.computerUse.downloadPython')}
              </Button>
            )}
            {!envReady && status.python.installed && (
              <Button
                variant="primary"
                size="lg"
                onClick={handleSetup}
                loading={setupRunning}
                icon={<span className="material-symbols-outlined text-[18px]">download</span>}
              >
                {setupRunning ? t('settings.computerUse.setupRunning') : t('settings.computerUse.setupBtn')}
              </Button>
            )}
            <Button
              variant="secondary"
              size="lg"
              onClick={fetchStatus}
              icon={<span className="material-symbols-outlined text-[18px]">refresh</span>}
            >
              {t('settings.computerUse.recheckBtn')}
            </Button>
          </div>

          {/* ─── App Authorization Section ─── */}
          {envReady && (
            <div className="space-y-4 pt-4 border-t border-[var(--color-border)]">
              <div>
                <h3 className="text-base font-semibold text-[var(--color-text-primary)] flex items-center gap-2" style={{ fontFamily: 'var(--font-headline)' }}>
                  {t('settings.computerUse.appsTitle')}
                  {appsSaved && (
                    <span className="text-xs font-normal text-[var(--color-success)] flex items-center gap-1">
                      <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>check</span>
                      {t('settings.computerUse.appsSaved')}
                    </span>
                  )}
                </h3>
                <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                  {t('settings.computerUse.appsDescription')}
                </p>
              </div>

              {/* Grant flags */}
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={clipboardAccess}
                    onChange={e => toggleFlag('clipboard', e.target.checked)}
                    className="rounded border-[var(--color-border)] accent-[var(--color-brand)]"
                  />
                  {t('settings.computerUse.flagClipboard')}
                </label>
                <label className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={systemKeys}
                    onChange={e => toggleFlag('systemKeys', e.target.checked)}
                    className="rounded border-[var(--color-border)] accent-[var(--color-brand)]"
                  />
                  {t('settings.computerUse.flagSystemKeys')}
                </label>
              </div>

              {/* Search */}
              <div className="relative">
                <span className="material-symbols-outlined text-[18px] text-[var(--color-text-tertiary)] absolute left-3 top-1/2 -translate-y-1/2">search</span>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder={t('settings.computerUse.appsSearch')}
                  className="w-full pl-9 pr-4 py-2 text-sm bg-[var(--color-surface-container-low)] border border-[var(--color-border)] rounded-[var(--radius-lg)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:border-[var(--color-brand)]"
                />
              </div>

              {/* App list */}
              {appsLoading ? (
                <div className="py-6 text-center text-sm text-[var(--color-text-tertiary)]">
                  {t('settings.computerUse.appsLoading')}
                </div>
              ) : installedApps.length === 0 ? (
                <div className="py-6 text-center text-sm text-[var(--color-text-tertiary)]">
                  {t('settings.computerUse.appsEmpty')}
                </div>
              ) : (
                <div className="max-h-[400px] overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--color-border)]">
                  {sortedApps.map(app => {
                    const isAuthorized = authorizedBundleIds.has(app.bundleId)
                    return (
                      <button
                        key={app.bundleId}
                        onClick={() => toggleApp(app)}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--color-surface-hover)] border-b border-[var(--color-border)] last:border-b-0 ${
                          isAuthorized ? 'bg-[var(--color-brand-soft)]' : ''
                        }`}
                      >
                        <div className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border ${
                          isAuthorized
                            ? 'bg-[var(--color-brand)] border-[var(--color-brand)]'
                            : 'border-[var(--color-border)]'
                        }`}>
                          {isAuthorized && (
                            <span className="material-symbols-outlined text-[14px] text-[var(--color-on-primary)]" style={{ fontVariationSettings: "'FILL' 1" }}>check</span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                            {app.displayName}
                          </div>
                          <div className="text-[11px] text-[var(--color-text-tertiary)] truncate font-mono">
                            {app.bundleId}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </>
      ) : null}
    </div>
  )
}

// ============================================================================
// Native (cu-helper) Codex-style page — macOS only, no Python.
// ============================================================================

type Translate = ReturnType<typeof useTranslation>

/**
 * An app's real icon, falling back to a letter tile.
 *
 * The `/apps` payload deliberately carries no icon bytes — it lists every
 * installed application, and inlining hundreds of PNGs would bloat one
 * response. Each row instead points an `<img>` at the icon endpoint, which
 * reads the bundle's own `.icns` the same way Finder does. `loading="lazy"`
 * matters here: the picker is a long scroller, and without it every row off
 * screen would still cost a request and a rasterisation.
 *
 * A bundle with no icon 404s, which is an ordinary outcome rather than a
 * failure — that is what the letter tile is for.
 */
function AppIcon({ name, bundleId }: { name: string; bundleId?: string }) {
  const [iconUrl, setIconUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!bundleId) {
      setIconUrl(null)
      return
    }
    let cancelled = false
    setIconUrl(null)
    void computerUseApi.loadAppIcon(bundleId).then(url => {
      if (!cancelled) setIconUrl(url)
    })
    return () => {
      cancelled = true
    }
  }, [bundleId])

  const tileClass =
    'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface-container-high)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'

  if (iconUrl) {
    return (
      <div className={tileClass}>
        <img
          src={iconUrl}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="block h-7 w-7 object-contain"
        />
      </div>
    )
  }

  // Shown both while the icon is in flight and when the bundle has none. The
  // letter is a stable placeholder rather than a spinner, so a list of
  // iconless utilities does not read as permanently loading.
  const letter = name.trim().charAt(0).toUpperCase() || '?'
  return (
    <div className={`${tileClass} text-[13px] font-semibold text-[var(--color-text-secondary)]`}>
      {letter}
    </div>
  )
}

/** macOS OS-permission status row (辅助功能 / 屏幕录制): a refined row with a
 *  status dot (granted=emerald, needed=amber, checking=neutral) + label + state,
 *  built to live inside a divide-y group rather than as a standalone boxy card. */
function PermissionStatusRow({
  t,
  label,
  state,
  failed = false,
}: {
  t: Translate
  label: string
  state: boolean | null
  failed?: boolean
}) {
  const granted = state === true
  const needed = state === false
  const detail = failed
    ? t('settings.computerUse.permCheckFailed')
    : granted
    ? t('settings.computerUse.permGranted')
    : needed
      ? t('settings.computerUse.permNeeded')
      : t('settings.computerUse.permChecking')
  const dotClass = failed
    ? 'bg-[var(--color-error)]'
    : granted
    ? 'bg-[var(--color-success)]'
    : needed
      ? 'bg-[var(--color-warning)]'
      : 'bg-[var(--color-text-tertiary)]'
  // Status colors ride the semantic tokens so they follow [data-theme]
  // (stock emerald/amber shades are fixed colors — see paletteEscapes.test.ts).
  const detailClass = failed
    ? 'text-[var(--color-error)]'
    : granted
    ? 'text-[var(--color-success)]'
    : needed
      ? 'text-[var(--color-warning)]'
      : 'text-[var(--color-text-tertiary)]'
  return (
    <div className="flex items-center gap-3 py-2.5">
      <span className="relative flex h-2 w-2 flex-shrink-0 items-center justify-center" aria-hidden>
        <span className={`h-2 w-2 rounded-full ${dotClass} ${granted ? 'shadow-[0_0_0_3px_rgba(16,185,129,0.15)]' : needed ? 'shadow-[0_0_0_3px_rgba(245,158,11,0.15)]' : ''}`} />
        {needed && (
          <span className="absolute h-2 w-2 animate-ping rounded-full bg-[var(--color-warning)] opacity-60" />
        )}
      </span>
      <span className="flex-1 min-w-0 text-sm font-medium text-[var(--color-text-primary)]">
        {label}
      </span>
      <span className={`text-xs font-medium ${detailClass}`}>{detail}</span>
    </div>
  )
}

function NativeComputerUse({
  t,
  status,
  enabled,
  onToggleEnabled,
  authorizedApps,
  onRemoveApp,
  appsSaved,
  configError,
  statusError,
  cardOpening,
  cardError,
  onOpenCard,
  onRecheck,
  pickerOpen,
  onOpenPicker,
  onClosePicker,
  onAddApp,
  appsLoading,
  pickerApps,
  searchQuery,
  onSearch,
}: {
  t: Translate
  status: ComputerUseStatus
  enabled: boolean
  onToggleEnabled: (value: boolean) => void
  authorizedApps: AuthorizedApp[]
  onRemoveApp: (bundleId: string) => void
  appsSaved: boolean
  configError: string | null
  statusError: boolean
  cardOpening: boolean
  cardError: string | null
  onOpenCard: () => void
  onRecheck: () => void
  pickerOpen: boolean
  onOpenPicker: () => void
  onClosePicker: () => void
  onAddApp: (app: InstalledApp) => void
  appsLoading: boolean
  pickerApps: InstalledApp[]
  searchQuery: string
  onSearch: (value: string) => void
}) {
  const accessibility = status.permissions.accessibility
  const screenRecording = status.permissions.screenRecording
  const permissionProbeFailed = Boolean(status.permissions.error)
  const header = (
    <div className="flex items-start justify-between gap-6">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold tracking-tight text-[var(--color-text-primary)]">
          {t('settings.computerUse.controlTitle')}
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-text-secondary)]">
          {t('settings.computerUse.controlSubtitle')}
        </p>
      </div>
      <Switch
        checked={enabled}
        onChange={onToggleEnabled}
        label={t('settings.computerUse.enabledToggle')}
        size="sm"
      />
    </div>
  )
  const configErrorNotice = configError ? (
    <div className="px-4 py-3 rounded-[var(--radius-lg)] border border-[var(--color-error)] bg-[var(--color-error-container)] text-sm text-[var(--color-on-error-container)]">
      {configError}
    </div>
  ) : null

  if (statusError) {
    return (
      <div className="max-w-2xl space-y-5">
        {header}
        {configErrorNotice}
        <ErrorState
          size="lg"
          title="Failed to check status."
          retryLabel={t('common.retry')}
          onRetry={onRecheck}
          tone="strong"
        />
      </div>
    )
  }

  if (!status.cuHelper.available) {
    return (
      <div className="max-w-2xl space-y-5">
        {header}
        {configErrorNotice}
        <ErrorState
          size="lg"
          title={t('settings.computerUse.nativeUnavailableTitle')}
          detail={t('settings.computerUse.nativeUnavailableDetail')}
          retryLabel={t('settings.computerUse.recheckBtn')}
          onRetry={onRecheck}
          tone="strong"
        />
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-10">
      {header}
      {configErrorNotice}

      {/* ─── 控制 (Control) ─── */}
      <section className="space-y-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          {t('settings.computerUse.sectionControl')}
        </h3>

        {/* One elevated surface for the OS permissions required by the master
            toggle in the page header. */}
        <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
          {/* OS-permission group */}
          <div className="px-4 py-4">
            <div className="text-sm font-semibold text-[var(--color-text-primary)]">
              {t('settings.computerUse.osPermTitle')}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-tertiary)]">
              {t('settings.computerUse.osPermHint')}
            </p>
            <div className="mt-2 divide-y divide-[var(--color-border)]">
              <PermissionStatusRow
                t={t}
                label={t('settings.computerUse.accessibility')}
                state={accessibility}
                failed={permissionProbeFailed}
              />
              <PermissionStatusRow
                t={t}
                label={t('settings.computerUse.screenRecording')}
                state={screenRecording}
                failed={permissionProbeFailed}
              />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                onClick={onOpenCard}
                disabled={cardOpening}
                className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-container)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-accent)] transition hover:bg-[var(--color-surface-hover)] active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
              >
                <span className="material-symbols-outlined text-[16px]">
                  {cardOpening ? 'hourglass_empty' : 'shield_person'}
                </span>
                {cardOpening ? t('settings.computerUse.openingCard') : t('settings.computerUse.openCard')}
              </button>
              <button
                onClick={onRecheck}
                className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] transition hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] active:scale-[0.98]"
              >
                <span className="material-symbols-outlined text-[16px]">refresh</span>
                {t('settings.computerUse.recheckBtn')}
              </button>
            </div>
            {cardError && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-[var(--color-error)]">
                <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                  error
                </span>
                {cardError}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* ─── 始终允许的应用 (Always-allowed apps) ─── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
            {t('settings.computerUse.allowedAppsTitle')}
            {appsSaved && (
              <span className="flex items-center gap-1 text-[11px] font-medium normal-case tracking-normal text-[var(--color-success)]">
                <span
                  className="material-symbols-outlined text-[14px]"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  check_circle
                </span>
                {t('settings.computerUse.appsSaved')}
              </span>
            )}
          </h3>
          <button
            onClick={onOpenPicker}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--color-brand)] px-3 py-1.5 text-xs font-semibold text-[var(--color-btn-primary-fg)] shadow-[0_1px_2px_rgba(0,0,0,0.08)] transition hover:opacity-90 active:scale-[0.98]"
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
            {t('settings.computerUse.addApp')}
          </button>
        </div>
        <p className="text-xs leading-relaxed text-[var(--color-text-secondary)]">
          {t('settings.computerUse.allowedAppsDesc')}
        </p>

        {authorizedApps.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface-container-low)]/40 px-6 py-10 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container)] text-[var(--color-text-tertiary)]">
              <span className="material-symbols-outlined text-[22px]">apps</span>
            </div>
            <p className="max-w-xs text-xs leading-relaxed text-[var(--color-text-tertiary)]">
              {t('settings.computerUse.allowedAppsEmpty')}
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
            <div className="divide-y divide-[var(--color-border)]">
              {authorizedApps.map(app => (
                <div
                  key={app.bundleId}
                  className="group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-[var(--color-surface-hover)]"
                >
                  <AppIcon name={app.displayName} bundleId={app.bundleId} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-[var(--color-text-primary)]">
                      {app.displayName}
                    </div>
                    <div className="truncate font-mono text-[11px] text-[var(--color-text-tertiary)]">
                      {app.bundleId}
                    </div>
                  </div>
                  <button
                    onClick={() => onRemoveApp(app.bundleId)}
                    aria-label={`${t('settings.computerUse.removeApp')} ${app.displayName}`}
                    title={t('settings.computerUse.removeApp')}
                    className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-[var(--color-text-tertiary)] opacity-0 transition group-hover:opacity-100 hover:bg-[var(--color-error-container)] hover:text-[var(--color-error)] focus-visible:opacity-100 active:scale-90"
                  >
                    <span className="material-symbols-outlined text-[18px]">delete</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* App picker dialog.
          Uses the shared Modal rather than a hand-rolled overlay: Modal portals
          to document.body, so it cannot be trapped by an ancestor's stacking
          context, and it sits on `--z-dialog` instead of a bare `z-50` that the
          rest of the `--z-*` scale does not know about. It also brings the focus
          trap, Escape-to-close and focus restore this picker used to lack. */}
      <Modal
        open={pickerOpen}
        onClose={onClosePicker}
        title={t('settings.computerUse.addAppTitle')}
        width={448}
      >
        {/* Cancel Modal's content padding so the app rows stay edge-to-edge —
            their divider lines are the list's structure, and inset dividers
            would read as a nested card. The search field keeps the padding. */}
        <div className="-mx-6 -my-4 flex max-h-[60vh] flex-col">
          <div className="shrink-0 px-6 pb-3 pt-4">
            <div className="relative">
              <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-[var(--color-text-tertiary)]">
                search
              </span>
              <input
                type="text"
                autoFocus
                value={searchQuery}
                onChange={e => onSearch(e.target.value)}
                placeholder={t('settings.computerUse.appsSearch')}
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-container-low)] py-2 pl-9 pr-4 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] transition focus:border-[var(--color-brand)] focus:outline-none focus:ring-1 focus:ring-[var(--color-brand)]"
              />
            </div>
          </div>
          {/* The list scrolls, not the dialog — otherwise the search field
              scrolls out of view exactly when a long list needs it most. */}
          <div className="min-h-0 flex-1 divide-y divide-[var(--color-border)] overflow-y-auto border-t border-[var(--color-border)]">
              {appsLoading ? (
                <div className="flex flex-col items-center gap-2 py-12 text-center">
                  <span className="material-symbols-outlined animate-spin text-[20px] text-[var(--color-text-tertiary)]">
                    progress_activity
                  </span>
                  <span className="text-sm text-[var(--color-text-tertiary)]">
                    {t('settings.computerUse.appsPickerLoading')}
                  </span>
                </div>
              ) : pickerApps.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-12 text-center">
                  <span className="material-symbols-outlined text-[20px] text-[var(--color-text-tertiary)]">
                    search_off
                  </span>
                  <span className="text-sm text-[var(--color-text-tertiary)]">
                    {t('settings.computerUse.appsPickerEmpty')}
                  </span>
                </div>
              ) : (
                pickerApps.map(app => (
                  <button
                    key={app.bundleId}
                    onClick={() => onAddApp(app)}
                    className="group flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--color-surface-hover)]"
                  >
                    <AppIcon name={app.displayName} bundleId={app.bundleId} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-[var(--color-text-primary)]">
                        {app.displayName}
                      </div>
                      <div className="truncate font-mono text-[11px] text-[var(--color-text-tertiary)]">
                        {app.bundleId}
                      </div>
                    </div>
                    <span className="material-symbols-outlined text-[18px] text-[var(--color-text-tertiary)] transition-colors group-hover:text-[var(--color-brand)]">
                      add_circle
                    </span>
                  </button>
                ))
              )}
          </div>
        </div>
      </Modal>
    </div>
  )
}
