import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type WheelEvent } from 'react'
import { Eraser, ExternalLink, FolderOpen, Info, Monitor, Plus, RotateCcw, X } from 'lucide-react'
import { useTranslation, type TranslationKey } from '../i18n'
import { terminalApi } from '../api/terminal'
import { useSettingsStore } from '../stores/settingsStore'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { IconButton } from '../components/ui/custom/icon-button'
import { LoadingButton } from '../components/ui/custom/loading-button'
import { SettingField } from '../components/ui/custom/setting-field'
import { TerminalStatusBadge } from '../components/ui/custom/terminal-status-badge'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '../components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../components/ui/tooltip'
import type { DesktopTerminalStartupShell } from '../types/settings'
import { getDesktopHost } from '../lib/desktopHost'
import {
  attachTerminalRuntime,
  createLocalTerminalRuntimeId,
  destroyTerminalRuntime,
  getTerminalRuntime,
  isTerminalRuntimeCurrent,
  subscribeTerminalRuntime,
  updateTerminalRuntime,
  type TerminalRuntime,
  type TerminalStatus,
} from '../lib/terminalRuntime'

const STATUS_LABEL_KEYS: Record<TerminalStatus, TranslationKey> = {
  idle: 'settings.terminal.status.idle',
  starting: 'settings.terminal.status.starting',
  running: 'settings.terminal.status.running',
  exited: 'settings.terminal.status.exited',
  error: 'settings.terminal.status.error',
  unavailable: 'settings.terminal.status.unavailable',
}

const MAX_PENDING_TERMINAL_OUTPUT = 64 * 1024

type PendingTerminalEvent =
  | { type: 'output'; data: string }
  | { type: 'exit'; code: number; signal?: string | null }

function readTerminalTheme(host: HTMLElement) {
  const styles = window.getComputedStyle(host)
  const color = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback
  const foreground = color('--color-terminal-fg', '#d7d2d0')

  return {
    background: color('--color-terminal-bg', '#121212'),
    foreground,
    cursor: foreground,
    selectionBackground: color('--color-selection-bg', '#5f4a40'),
    black: color('--color-terminal-border', '#1f1f1f'),
    red: color('--color-terminal-danger', '#ff6d67'),
    green: color('--color-terminal-accent', '#7ef18a'),
    yellow: color('--color-terminal-warning', '#f8c55f'),
    blue: '#77a8ff',
    magenta: '#d699ff',
    cyan: '#61d6d6',
    white: foreground,
    brightBlack: color('--color-terminal-muted', '#8f8683'),
    brightRed: '#ff8a85',
    brightGreen: '#9ff7a7',
    brightYellow: '#ffdd7a',
    brightBlue: '#a6c5ff',
    brightMagenta: '#e3b8ff',
    brightCyan: '#8ceeee',
    brightWhite: '#ffffff',
  }
}

function findScrollableAncestor(element: HTMLElement, deltaY: number): HTMLElement | null {
  let parent = element.parentElement
  while (parent) {
    const style = window.getComputedStyle(parent)
    const canScrollY = style.overflowY === 'auto' || style.overflowY === 'scroll'
    if (canScrollY && parent.scrollHeight > parent.clientHeight) {
      const maxScrollTop = parent.scrollHeight - parent.clientHeight
      const canMove = deltaY < 0 ? parent.scrollTop > 0 : parent.scrollTop < maxScrollTop
      if (canMove) return parent
    }
    parent = parent.parentElement
  }
  return null
}

type TerminalSettingsProps = {
  active?: boolean
  cwd?: string
  onNewTerminal?: () => void
  onOpenInTab?: () => void
  onClose?: () => void
  testId?: string
  workspace?: boolean
  docked?: boolean
  showPreferences?: boolean
  runtimeId?: string
  preserveOnUnmount?: boolean
}

export function TerminalSettings({
  active = true,
  cwd,
  onNewTerminal,
  onOpenInTab,
  onClose,
  testId = 'settings-terminal-host',
  workspace = false,
  docked = false,
  showPreferences = false,
  runtimeId,
  preserveOnUnmount = false,
}: TerminalSettingsProps = {}) {
  const t = useTranslation()
  const desktopTerminal = useSettingsStore((state) => state.desktopTerminal)
  const setDesktopTerminal = useSettingsStore((state) => state.setDesktopTerminal)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const lifecycleVersionRef = useRef(0)
  const localRuntimeIdRef = useRef<string | null>(null)
  if (!localRuntimeIdRef.current) {
    localRuntimeIdRef.current = runtimeId ?? createLocalTerminalRuntimeId()
  }
  const effectiveRuntimeId = runtimeId ?? localRuntimeIdRef.current
  const runtimeRef = useRef<TerminalRuntime | null>(null)
  if (!runtimeRef.current || runtimeRef.current.id !== effectiveRuntimeId) {
    runtimeRef.current = getTerminalRuntime(effectiveRuntimeId, terminalApi.isAvailable() ? 'idle' : 'unavailable')
  }
  const runtime = runtimeRef.current
  const [, forceRuntimeUpdate] = useState(0)
  const status = runtime.status
  const error = runtime.error
  const shellInfo = runtime.shellInfo
  const [startupShell, setStartupShell] = useState<DesktopTerminalStartupShell>(desktopTerminal?.startupShell ?? 'system')
  const [customShellPath, setCustomShellPath] = useState(desktopTerminal?.customShellPath ?? '')
  const [preferencesError, setPreferencesError] = useState<string | null>(null)
  const [preferencesSaved, setPreferencesSaved] = useState(false)
  const [preferencesSaving, setPreferencesSaving] = useState(false)
  const preferencesSavingRef = useRef(false)
  const restartButtonRef = useRef<HTMLButtonElement | null>(null)
  const restoreRestartFocusRef = useRef(false)
  const startupShellId = useId()
  const isWindows = typeof navigator !== 'undefined' && /Win/i.test(navigator.platform || navigator.userAgent)

  useEffect(() => {
    return subscribeTerminalRuntime(runtime, () => forceRuntimeUpdate((value) => value + 1))
  }, [runtime])

  useEffect(() => {
    setStartupShell(desktopTerminal?.startupShell ?? 'system')
    setCustomShellPath(desktopTerminal?.customShellPath ?? '')
  }, [desktopTerminal])

  useEffect(() => {
    if (!preferencesSaved) return
    const timer = window.setTimeout(() => setPreferencesSaved(false), 2500)
    return () => window.clearTimeout(timer)
  }, [preferencesSaved])

  const shellItems = useMemo(() => [
    {
      value: 'system' as const,
      label: t('settings.terminal.shell.system'),
      description: t('settings.terminal.shell.systemDesc'),
    },
    {
      value: 'pwsh' as const,
      label: t('settings.terminal.shell.pwsh'),
      description: t('settings.terminal.shell.pwshDesc'),
    },
    {
      value: 'powershell' as const,
      label: t('settings.terminal.shell.powershell'),
      description: t('settings.terminal.shell.powershellDesc'),
    },
    {
      value: 'cmd' as const,
      label: t('settings.terminal.shell.cmd'),
      description: t('settings.terminal.shell.cmdDesc'),
    },
    {
      value: 'custom' as const,
      label: t('settings.terminal.shell.custom'),
      description: t('settings.terminal.shell.customDesc'),
    },
  ], [t])

  const resizeSession = useCallback(() => {
    const terminal = runtime.terminal
    const fit = runtime.fit
    const sessionId = runtime.nativeSessionId
    if (!terminal || !fit) return

    fit.fit()
    if (sessionId) {
      void terminalApi.resize(sessionId, terminal.cols, terminal.rows).catch(() => {})
    }
  }, [runtime])

  const startTerminal = useCallback(() => {
    if (!terminalApi.isAvailable()) {
      updateTerminalRuntime(runtime, { status: 'unavailable' })
      return Promise.resolve()
    }

    if (runtime.startPromise) {
      const host = hostRef.current
      void runtime.startPromise.then(() => {
        if (!host || !isTerminalRuntimeCurrent(runtime) || !runtime.terminal) return
        attachTerminalRuntime(runtime, host)
        resizeSession()
      })
      return runtime.startPromise
    }

    const host = hostRef.current
    if (!host) return Promise.resolve()

    const startToken = runtime.startToken + 1
    runtime.startToken = startToken
    const isCurrentStart = () => isTerminalRuntimeCurrent(runtime) && runtime.startToken === startToken

    const startPromise = Promise.resolve().then(async () => {
      if (!isCurrentStart()) return
      updateTerminalRuntime(runtime, { error: null, status: 'starting', shellInfo: null })

      const existing = runtime.nativeSessionId
      if (existing) {
        await terminalApi.kill(existing).catch(() => {})
        if (!isCurrentStart()) return
        runtime.nativeSessionId = null
      }
      runtime.dataDisposable?.dispose()
      runtime.dataDisposable = null
      runtime.unlisteners.forEach((unlisten) => unlisten())
      runtime.unlisteners = []

      runtime.terminal?.dispose()
      runtime.terminal = null
      runtime.fit = null
      host.innerHTML = ''

      let TerminalModule: typeof import('@xterm/xterm')
      let FitAddonModule: typeof import('@xterm/addon-fit')
      try {
        [TerminalModule, FitAddonModule] = await Promise.all([
          import('@xterm/xterm'),
          import('@xterm/addon-fit'),
        ])
      } catch (err) {
        if (isCurrentStart()) {
          updateTerminalRuntime(runtime, {
            error: err instanceof Error ? err.message : String(err),
            status: 'error',
          })
        }
        return
      }
      if (!isCurrentStart()) return

      let terminal: import('@xterm/xterm').Terminal | null = null
      let fit: import('@xterm/addon-fit').FitAddon | null = null
      let outputUnlisten: (() => void) | null = null
      let exitUnlisten: (() => void) | null = null
      const pendingEvents = new Map<number, PendingTerminalEvent[]>()
      const pendingOutputSizes = new Map<number, number>()

      const appendPendingEvent = (sessionId: number, event: PendingTerminalEvent) => {
        const events = pendingEvents.get(sessionId) ?? []
        if (event.type === 'output') {
          const currentSize = pendingOutputSizes.get(sessionId) ?? 0
          const remaining = MAX_PENDING_TERMINAL_OUTPUT - currentSize
          if (remaining <= 0) return
          const data = event.data.slice(0, remaining)
          events.push({ type: 'output', data })
          pendingOutputSizes.set(sessionId, currentSize + data.length)
        } else {
          events.push(event)
        }
        pendingEvents.set(sessionId, events)
      }

      const writeExit = (
        activeTerminal: import('@xterm/xterm').Terminal,
        payload: { code: number; signal?: string | null },
      ) => {
        updateTerminalRuntime(runtime, { status: 'exited', nativeSessionId: null })
        const signal = payload.signal ? `, ${payload.signal}` : ''
        activeTerminal.writeln(`\r\n[process exited: ${payload.code}${signal}]`)
      }

      try {
        terminal = new TerminalModule.Terminal({
          cursorBlink: true,
          convertEol: false,
          fontFamily: "var(--font-mono), 'SFMono-Regular', Consolas, monospace",
          fontSize: 12,
          lineHeight: 1.25,
          scrollback: 4000,
          theme: readTerminalTheme(host),
        })
        fit = new FitAddonModule.FitAddon()
        const activeTerminal = terminal
        const activeFit = fit
        activeTerminal.loadAddon(activeFit)
        activeTerminal.open(host)
        if (!isCurrentStart()) {
          activeTerminal.dispose()
          return
        }
        updateTerminalRuntime(runtime, { terminal: activeTerminal, fit: activeFit })
        activeFit.fit()

        outputUnlisten = await terminalApi.onOutput((payload) => {
          if (payload.session_id === runtime.nativeSessionId) {
            activeTerminal.write(payload.data)
          } else if (runtime.nativeSessionId === null && runtime.status === 'starting') {
            appendPendingEvent(payload.session_id, { type: 'output', data: payload.data })
          }
        })
        exitUnlisten = await terminalApi.onExit((payload) => {
          if (payload.session_id === runtime.nativeSessionId) {
            writeExit(activeTerminal, payload)
          } else if (runtime.nativeSessionId === null && runtime.status === 'starting') {
            appendPendingEvent(payload.session_id, {
              type: 'exit',
              code: payload.code,
              ...(payload.signal ? { signal: payload.signal } : {}),
            })
          }
        })
        if (!isCurrentStart()) {
          outputUnlisten()
          exitUnlisten()
          activeTerminal.dispose()
          return
        }
        runtime.unlisteners = [outputUnlisten, exitUnlisten]

        runtime.dataDisposable = terminal.onData((data) => {
          const sessionId = runtime.nativeSessionId
          if (sessionId) {
            void terminalApi.write(sessionId, data).catch((err) => {
              updateTerminalRuntime(runtime, {
                error: err instanceof Error ? err.message : String(err),
                status: 'error',
              })
            })
          }
        })

        const result = await terminalApi.spawn({
          cols: activeTerminal.cols,
          rows: activeTerminal.rows,
          ...(cwd ? { cwd } : {}),
        })
        if (!isCurrentStart()) {
          await terminalApi.kill(result.session_id).catch(() => {})
          outputUnlisten()
          exitUnlisten()
          activeTerminal.dispose()
          return
        }
        const replayEvents = pendingEvents.get(result.session_id) ?? []
        const earlyExit = replayEvents.findLast((event) => event.type === 'exit')
        updateTerminalRuntime(runtime, {
          nativeSessionId: earlyExit ? null : result.session_id,
          shellInfo: { shell: result.shell, cwd: result.cwd },
          status: earlyExit ? 'exited' : 'running',
        })
        replayEvents.forEach((event) => {
          if (event.type === 'output') {
            activeTerminal.write(event.data)
          } else {
            writeExit(activeTerminal, event)
          }
        })
        pendingEvents.clear()
        pendingOutputSizes.clear()
        resizeSession()
      } catch (err) {
        outputUnlisten?.()
        exitUnlisten?.()
        terminal?.dispose()
        if (isCurrentStart()) {
          updateTerminalRuntime(runtime, {
            terminal: null,
            fit: null,
            error: err instanceof Error ? err.message : String(err),
            status: 'error',
          })
        }
      }
    })
    runtime.startPromise = startPromise
    void startPromise.finally(() => {
      if (runtime.startPromise === startPromise) {
        runtime.startPromise = null
      }
    }).catch(() => {})
    return startPromise
  }, [cwd, resizeSession, runtime])

  useEffect(() => {
    lifecycleVersionRef.current += 1
    const lifecycleVersion = lifecycleVersionRef.current
    if (!terminalApi.isAvailable()) return
    if (runtime.terminal) {
      if (hostRef.current) {
        attachTerminalRuntime(runtime, hostRef.current)
      }
      resizeSession()
    } else if (runtime.startPromise) {
      void runtime.startPromise.then(() => {
        if (!hostRef.current || !isTerminalRuntimeCurrent(runtime) || !runtime.terminal) return
        attachTerminalRuntime(runtime, hostRef.current)
        resizeSession()
      })
    } else {
      void startTerminal()
    }

    const observer = new ResizeObserver(() => resizeSession())
    if (hostRef.current) observer.observe(hostRef.current)

    return () => {
      observer.disconnect()
      if (!preserveOnUnmount) {
        // StrictMode replays effects once during initial mount. Let the replay
        // retain this runtime instead of leaving the component with a stale
        // object that can never start or restart.
        queueMicrotask(() => {
          if (lifecycleVersionRef.current !== lifecycleVersion) return
          destroyTerminalRuntime(runtime.id)
        })
      }
    }
  }, [preserveOnUnmount, resizeSession, runtime, startTerminal])

  useEffect(() => {
    if (active) {
      requestAnimationFrame(() => resizeSession())
    }
  }, [active, resizeSession])

  useEffect(() => {
    if (!restoreRestartFocusRef.current || status === 'starting') return
    restoreRestartFocusRef.current = false
    restartButtonRef.current?.focus()
  }, [status])

  const clearTerminal = () => {
    runtime.terminal?.clear()
  }

  const restartTerminal = async () => {
    restoreRestartFocusRef.current = true
    await startTerminal()
  }

  const handleTerminalWheelCapture = useCallback((event: WheelEvent<HTMLDivElement>) => {
    const host = hostRef.current
    if (!host || host.contains(document.activeElement)) return

    const scroller = findScrollableAncestor(event.currentTarget, event.deltaY)
    if (!scroller) return

    event.preventDefault()
    event.stopPropagation()
    scroller.scrollBy({ top: event.deltaY, left: event.deltaX })
  }, [])

  const handleTerminalKeyDownCapture = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const terminal = runtime.terminal
    if (!terminal) return

    if (isTerminalCopyShortcut(event, terminal)) {
      event.preventDefault()
      event.stopPropagation()
      void copyTerminalSelection(terminal).catch(() => {})
      return
    }

    if (isTerminalPasteShortcut(event)) {
      event.preventDefault()
      event.stopPropagation()
      void pasteClipboardIntoTerminal(terminal).catch(() => {})
    }
  }, [runtime])

  const savePreferences = async () => {
    if (preferencesSavingRef.current) return
    setPreferencesError(null)
    setPreferencesSaved(false)

    const trimmedPath = customShellPath.trim()
    if (startupShell === 'custom') {
      if (!trimmedPath) {
        setPreferencesError(t('settings.terminal.customPathRequired'))
        return
      }
      if (!/^[A-Za-z]:[\\/]/.test(trimmedPath)) {
        setPreferencesError(t('settings.terminal.customPathAbsolute'))
        return
      }
    }

    preferencesSavingRef.current = true
    setPreferencesSaving(true)
    try {
      await setDesktopTerminal({
        startupShell,
        customShellPath: trimmedPath,
      })
      setPreferencesSaved(true)
    } catch (err) {
      setPreferencesError(err instanceof Error ? err.message : String(err))
    } finally {
      preferencesSavingRef.current = false
      setPreferencesSaving(false)
    }
  }

  return (
    <div className={`flex h-full flex-col overflow-hidden ${
      docked
        ? 'min-h-0 bg-[var(--color-surface-container-lowest)] px-3 py-1.5'
        : workspace
          ? 'min-h-0 bg-[var(--color-surface)] px-5 py-4'
          : 'min-h-[min(720px,calc(100vh-8rem))]'
    }`}>
      <div
        data-testid="settings-terminal-toolbar"
        className={`${docked ? 'mb-1.5 min-h-8' : 'mb-2 min-h-9'} flex min-w-0 flex-wrap items-center gap-2`}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--color-terminal-danger)]" aria-hidden="true" />
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--color-terminal-warning)]" aria-hidden="true" />
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--color-terminal-accent)]" aria-hidden="true" />
          <h2 className={`${docked ? 'text-[13px]' : 'text-sm'} shrink-0 font-semibold text-[var(--color-text-primary)]`}>
            {t('settings.terminal.title')}
          </h2>
          <TerminalHelpHint compact={docked} />
          <TerminalStatusBadge status={status} label={t(STATUS_LABEL_KEYS[status])} compact={docked} />
          {shellInfo && (
            <div className="flex min-w-0 items-center gap-1.5 text-xs text-[var(--color-text-tertiary)]">
              <span className="shrink-0 font-mono">{shellInfo.shell}</span>
              <span className="shrink-0 text-[var(--color-border)]">/</span>
              <span className="min-w-0 truncate font-mono">{shellInfo.cwd}</span>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {onOpenInTab && (
            <Button
              variant="outline"
              size="sm"
              onClick={onOpenInTab}
              className="h-8"
            >
              <ExternalLink aria-hidden="true" />
              {t('terminal.openInTab')}
            </Button>
          )}
          {onNewTerminal && (
            <Button
              variant="outline"
              size="sm"
              onClick={onNewTerminal}
              className="h-8"
            >
              <Plus aria-hidden="true" />
              {t('terminal.newTab')}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={clearTerminal}
            disabled={!runtime.terminal}
            className="h-8"
          >
            <Eraser aria-hidden="true" />
            {t('settings.terminal.clear')}
          </Button>
          <LoadingButton
            ref={restartButtonRef}
            size="sm"
            onClick={() => {
              if (status !== 'starting') void restartTerminal()
            }}
            loading={status === 'starting'}
            disableWhileLoading={false}
            className="h-8"
          >
            {status !== 'starting' && <RotateCcw aria-hidden="true" />}
            {t('settings.terminal.restart')}
          </LoadingButton>
          {onClose && (
            <IconButton
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              label={t('terminal.closePanel')}
              className="size-8"
            >
              <X aria-hidden="true" />
            </IconButton>
          )}
        </div>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-3">
          <AlertDescription className="text-[var(--color-error)]">{error}</AlertDescription>
        </Alert>
      )}

      {showPreferences && isWindows && (
        <>
          <Card className="mb-4">
            <CardHeader>
              <CardTitle className="text-sm">
                {t('settings.terminal.preferencesTitle')}
              </CardTitle>
              <CardDescription>
                {t('settings.terminal.preferencesBody')}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 pt-0">
              <div className="flex flex-col gap-2">
                <Label htmlFor={startupShellId}>
                  {t('settings.terminal.startupShell')}
                </Label>
                <Select
                  value={startupShell}
                  disabled={preferencesSaving}
                  onValueChange={(value) => {
                    setStartupShell(value as DesktopTerminalStartupShell)
                    setPreferencesError(null)
                    setPreferencesSaved(false)
                  }}
                >
                  <SelectTrigger id={startupShellId}>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">
                        {shellItems.find((item) => item.value === startupShell)?.label ?? startupShell}
                      </span>
                      <span className="truncate text-xs text-[var(--color-text-tertiary)]">
                        {shellItems.find((item) => item.value === startupShell)?.description}
                      </span>
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {shellItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        <span className="flex flex-col">
                          <span>{item.label}</span>
                          <span className="text-xs text-[var(--color-text-tertiary)]">
                            {item.description}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {startupShell === 'custom' && (
                <SettingField
                  id={`${startupShellId}-custom-path`}
                  label={t('settings.terminal.customPath')}
                  placeholder={t('settings.terminal.customPathPlaceholder')}
                  value={customShellPath}
                  disabled={preferencesSaving}
                  aria-invalid={Boolean(preferencesError)}
                  onChange={(event) => {
                    setCustomShellPath(event.target.value)
                    setPreferencesError(null)
                    setPreferencesSaved(false)
                  }}
                />
              )}

              {preferencesError && (
                <Alert variant="destructive">
                  <AlertDescription className="text-[var(--color-error)]">
                    {preferencesError}
                  </AlertDescription>
                </Alert>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <LoadingButton
                  size="sm"
                  loading={preferencesSaving}
                  onClick={() => void savePreferences()}
                >
                  {t('settings.terminal.saveShell')}
                </LoadingButton>
                {preferencesSaved && (
                  <span role="status" aria-live="polite" className="text-xs text-[var(--color-text-secondary)]">
                    {t('settings.terminal.saveShellSuccess')}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
          <BashPathSettings isTauri={terminalApi.isAvailable()} />
        </>
      )}

      {status === 'unavailable' ? (
        <Card className="flex flex-1 items-center justify-center border-dashed p-8 text-center">
          <div>
            <Monitor className="mx-auto mb-3 size-8 text-[var(--color-text-tertiary)]" aria-hidden="true" />
            <p className="text-sm font-medium text-[var(--color-text-primary)]">
              {t('settings.terminal.unavailableTitle')}
            </p>
            <p className="mt-1 text-sm text-[var(--color-text-tertiary)]">
              {t('settings.terminal.unavailableBody')}
            </p>
          </div>
        </Card>
      ) : (
        <div
          data-testid="settings-terminal-frame"
          onKeyDownCapture={handleTerminalKeyDownCapture}
          onWheelCapture={handleTerminalWheelCapture}
          className="min-h-0 flex-1 overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-terminal-border)] bg-[var(--color-terminal-bg)] shadow-[var(--shadow-dropdown)]"
        >
          <div
            ref={hostRef}
            data-testid={testId}
            className="settings-terminal-host h-full w-full overflow-hidden px-2 pb-2 pt-1.5"
          />
        </div>
      )}
    </div>
  )
}

type TerminalKeyboardEvent = Pick<KeyboardEvent<HTMLElement>, 'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>
type ClipboardTerminal = {
  focus(): void
  getSelection(): string
  hasSelection(): boolean
  paste(data: string): void
}

function isApplePlatform() {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform)
}

function isWindowsPlatform() {
  if (typeof navigator === 'undefined') return false
  return /Win/i.test(navigator.platform || navigator.userAgent)
}

function normalizedKey(event: TerminalKeyboardEvent) {
  return event.key.toLowerCase()
}

function isTerminalCopyShortcut(event: TerminalKeyboardEvent, terminal: ClipboardTerminal) {
  if (event.altKey || !terminal.hasSelection()) return false

  const key = normalizedKey(event)
  if (isApplePlatform()) {
    return event.metaKey && !event.ctrlKey && key === 'c'
  }

  if (key === 'insert') {
    return event.ctrlKey && !event.shiftKey && !event.metaKey
  }

  if (isWindowsPlatform() && event.ctrlKey && !event.metaKey && !event.shiftKey && key === 'c') {
    return true
  }

  return event.ctrlKey && !event.metaKey && event.shiftKey && key === 'c'
}

function isTerminalPasteShortcut(event: TerminalKeyboardEvent) {
  if (event.altKey) return false

  const key = normalizedKey(event)
  if (isApplePlatform()) {
    return event.metaKey && !event.ctrlKey && key === 'v'
  }

  if (key === 'insert') {
    return event.shiftKey && !event.ctrlKey && !event.metaKey
  }

  if (isWindowsPlatform() && event.ctrlKey && !event.metaKey && !event.shiftKey && key === 'v') {
    return true
  }

  return event.ctrlKey && !event.metaKey && event.shiftKey && key === 'v'
}

async function copyTerminalSelection(terminal: ClipboardTerminal) {
  const text = terminal.getSelection()
  if (!text) return
  await getDesktopHost().clipboard.writeText(text)
  terminal.focus()
}

async function pasteClipboardIntoTerminal(terminal: ClipboardTerminal) {
  const text = await getDesktopHost().clipboard.readText()
  if (!text) return
  terminal.paste(text)
  terminal.focus()
}

function TerminalHelpHint({ compact = false }: { compact?: boolean }) {
  const t = useTranslation()
  const tooltipId = useId()
  const [open, setOpen] = useState(false)

  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('settings.terminal.infoLabel')}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setOpen(false)
            }}
            className={compact ? 'size-6 rounded-full' : 'size-7 rounded-full'}
          >
            <Info className={compact ? 'size-3.5' : 'size-4'} aria-hidden="true" strokeWidth={2.2} />
          </Button>
        </TooltipTrigger>
        <TooltipContent
          id={tooltipId}
          side="bottom"
          align="start"
          className="max-w-[min(340px,calc(100vw-3rem))] px-3 py-2 leading-5 text-[var(--color-text-secondary)]"
        >
          {t('settings.terminal.description')}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function BashPathSettings({ isTauri }: { isTauri: boolean }) {
  const t = useTranslation()
  const inputId = useId()
  const [bashPath, setBashPath] = useState('')
  const [loading, setLoading] = useState(isTauri)
  const [mutation, setMutation] = useState<'save' | 'reset' | null>(null)
  const [saved, setSaved] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const dirtyRef = useRef(false)
  const mountedRef = useRef(false)
  const mutationRef = useRef(false)
  const savedTimerRef = useRef<number | null>(null)

  useEffect(() => {
    mountedRef.current = true
    if (!isTauri) {
      setLoading(false)
      return () => {
        mountedRef.current = false
      }
    }

    setLoading(true)
    void terminalApi.getBashPath()
      .then((path) => {
        if (mountedRef.current && !dirtyRef.current) {
          setBashPath(path ?? '')
        }
      })
      .catch(() => {
        if (mountedRef.current) {
          setFeedback(t('settings.terminal.bashPathLoadError'))
        }
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false)
      })

    return () => {
      mountedRef.current = false
      if (savedTimerRef.current !== null) {
        window.clearTimeout(savedTimerRef.current)
      }
    }
  }, [isTauri, t])

  const showSaved = () => {
    setSaved(true)
    if (savedTimerRef.current !== null) {
      window.clearTimeout(savedTimerRef.current)
    }
    savedTimerRef.current = window.setTimeout(() => {
      if (mountedRef.current) setSaved(false)
      savedTimerRef.current = null
    }, 2000)
  }

  const handleSave = async () => {
    if (mutationRef.current) return
    const trimmed = bashPath.trim() || null
    mutationRef.current = true
    setMutation('save')
    setFeedback(null)
    setSaved(false)
    try {
      await terminalApi.setBashPath(trimmed)
      if (!mountedRef.current) return
      setBashPath(trimmed ?? '')
      dirtyRef.current = false
      showSaved()
    } catch {
      if (mountedRef.current) {
        setFeedback(t('settings.terminal.bashPathInvalid'))
      }
    } finally {
      mutationRef.current = false
      if (mountedRef.current) setMutation(null)
    }
  }

  const handleReset = async () => {
    if (mutationRef.current) return
    mutationRef.current = true
    setMutation('reset')
    setSaved(false)
    setFeedback(null)
    try {
      await terminalApi.setBashPath(null)
      if (!mountedRef.current) return
      setBashPath('')
      dirtyRef.current = false
      showSaved()
    } catch {
      if (mountedRef.current) {
        setFeedback(t('settings.terminal.bashPathResetError'))
      }
    } finally {
      mutationRef.current = false
      if (mountedRef.current) setMutation(null)
    }
  }

  const handleBrowse = async () => {
    if (!isTauri) return
    const host = getDesktopHost()
    if (!host.capabilities.dialogs) {
      setFeedback(t('settings.terminal.bashPathBrowseError'))
      return
    }
    setFeedback(null)
    setSaved(false)
    try {
      const selected = await host.dialogs.open({
        title: t('settings.terminal.bashPathLabel'),
        multiple: false,
        filters: [{
          name: 'Bash Executable',
          extensions: ['exe', '', 'bat', 'cmd', 'ps1'],
        }],
      })
      if (selected && typeof selected === 'string') {
        setBashPath(selected)
        dirtyRef.current = true
      }
    } catch {
      if (mountedRef.current) {
        setFeedback(t('settings.terminal.bashPathBrowseError'))
      }
    }
  }

  if (!isTauri) return null
  const busy = loading || mutation !== null

  return (
    <Card className="mb-3" aria-busy={busy || undefined}>
      <CardHeader>
        <CardTitle className="text-sm">{t('settings.terminal.bashPathLabel')}</CardTitle>
        <CardDescription>{t('settings.terminal.bashPathDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        <Label htmlFor={inputId} className="sr-only">
          {t('settings.terminal.bashPathLabel')}
        </Label>
        <div className="flex flex-wrap gap-2">
          <Input
            id={inputId}
            type="text"
            value={bashPath}
            disabled={busy}
            onChange={(event) => {
              dirtyRef.current = true
              setBashPath(event.target.value)
              setFeedback(null)
              setSaved(false)
            }}
            placeholder={t('settings.terminal.bashPathLabel')}
            className="min-w-64 flex-1 font-mono"
          />
          <IconButton
            variant="outline"
            size="icon"
            onClick={() => void handleBrowse()}
            disabled={busy}
            label={t('settings.terminal.bashPathBrowse')}
          >
            <FolderOpen aria-hidden="true" />
          </IconButton>
          <LoadingButton
            size="sm"
            loading={mutation === 'save'}
            disabled={busy && mutation !== 'save'}
            onClick={() => void handleSave()}
            className="h-10"
          >
            {saved ? t('settings.terminal.bashPathSaved') : t('settings.terminal.bashPathSave')}
          </LoadingButton>
          <LoadingButton
            variant="outline"
            size="sm"
            loading={mutation === 'reset'}
            disabled={busy || bashPath.trim() === ''}
            onClick={() => void handleReset()}
            className="h-10"
          >
            {t('settings.terminal.bashPathReset')}
          </LoadingButton>
        </div>
        {feedback && (
          <Alert variant="destructive">
            <AlertDescription className="text-[var(--color-error)]">
              {feedback}
            </AlertDescription>
          </Alert>
        )}
        {saved && (
          <span role="status" aria-live="polite" className="text-xs text-[var(--color-text-secondary)]">
            {t('settings.terminal.bashPathSaved')}
          </span>
        )}
      </CardContent>
    </Card>
  )
}
