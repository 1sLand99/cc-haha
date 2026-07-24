import { useState, useRef, useEffect, useId } from 'react'
import DOMPurify from 'dompurify'
import {
  Bot,
  Check,
  ChevronDown,
  Folder,
  Gavel,
  ShieldCheck,
  Workflow,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { useSettingsStore } from '../../stores/settingsStore'
import { useChatStore } from '../../stores/chatStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTabStore } from '../../stores/tabStore'
import { useUIStore } from '../../stores/uiStore'
import { useTranslation } from '../../i18n'
import type { PermissionMode } from '../../types/settings'
import { useMobileViewport } from '../../hooks/useMobileViewport'
import { isDesktopRuntime } from '../../lib/desktopRuntime'
import { MobileBottomSheet } from '../shared/MobileBottomSheet'
import { ActionDialog } from '../shared/ActionDialog'
import { AutoModeOptInDialog } from './AutoModeOptInDialog'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { RadioGroup, RadioGroupItem } from '../ui/radio-group'

const MODE_ICONS: Record<PermissionMode, LucideIcon> = {
  default: ShieldCheck,
  acceptEdits: Zap,
  auto: Bot,
  plan: Workflow,
  bypassPermissions: Gavel,
  dontAsk: Gavel,
}

type Props = {
  workDir?: string
  compact?: boolean
  menuPlacement?: 'top' | 'bottom'
  /** Controlled mode: override current value */
  value?: PermissionMode
  /** Controlled mode: called on change instead of updating global store */
  onChange?: (mode: PermissionMode) => void
}

export function PermissionModeSelector({ workDir: workDirProp, compact = false, menuPlacement = 'top', value, onChange }: Props = {}) {
  const t = useTranslation()
  const isMobile = useMobileViewport() && !isDesktopRuntime()
  const {
    permissionMode: storeMode,
    autoModeOptInAccepted,
    acceptAutoModeOptIn,
  } = useSettingsStore()
  const setSessionPermissionMode = useChatStore((s) => s.setSessionPermissionMode)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const sessions = useSessionStore((s) => s.sessions)
  const chatState = useChatStore((s) =>
    activeTabId ? s.sessions[activeTabId]?.chatState ?? 'idle' : 'idle',
  )
  const isTurnActive = chatState !== 'idle'
  const isTurnActiveNow = (tabId: string | null) => {
    if (!tabId) return false
    return (useChatStore.getState().sessions[tabId]?.chatState ?? 'idle') !== 'idle'
  }
  const [open, setOpen] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState(false)
  const [autoDialog, setAutoDialog] = useState(false)
  const [autoConsentPending, setAutoConsentPending] = useState(false)
  const interactionTabIdRef = useRef<string | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dialogWasOpenRef = useRef(false)
  const menuId = `permission-mode-menu-${useId().replace(/:/g, '')}`

  const isControlled = value !== undefined
  const PERMISSION_ITEMS: Array<{
    value: PermissionMode
    label: string
    description: string
    icon: LucideIcon
    color?: string
  }> = [
    {
      value: 'default',
      label: t('permMode.askPermissions'),
      description: t('permMode.askPermDesc'),
      icon: ShieldCheck,
    },
    {
      value: 'acceptEdits',
      label: t('permMode.autoAccept'),
      description: t('permMode.autoAcceptDesc'),
      icon: Zap,
    },
    {
      value: 'auto',
      label: t('permMode.autoMode'),
      description: t('permMode.autoModeDesc'),
      icon: Bot,
      color: 'text-[var(--color-brand)]',
    },
    {
      value: 'plan',
      label: t('permMode.planMode'),
      description: t('permMode.planModeDesc'),
      icon: Workflow,
      color: 'text-[var(--color-text-tertiary)]',
    },
    {
      value: 'bypassPermissions',
      label: t('permMode.bypass'),
      description: t('permMode.bypassDesc'),
      icon: Gavel,
      color: 'text-[var(--color-error)]',
    },
  ]

  const MODE_LABELS: Record<PermissionMode, string> = {
    default: t('permMode.label.default'),
    acceptEdits: t('permMode.label.acceptEdits'),
    auto: t('permMode.label.auto'),
    plan: t('permMode.label.plan'),
    bypassPermissions: t('permMode.label.bypassPermissions'),
    dontAsk: t('permMode.label.dontAsk'),
  }

  const activeSession = activeTabId
    ? sessions.find((s) => s.id === activeTabId)
    : null
  const currentMode = isControlled
    ? value
    : (activeSession?.permissionMode as PermissionMode | undefined) || storeMode
  const workDir = workDirProp || activeSession?.workDir || '~'
  const compactButtonClass = compact
    ? isMobile
      ? 'h-11 w-11 justify-center rounded-xl p-0'
      : 'h-8 w-8 justify-center rounded-full p-0'
    : 'h-auto gap-1.5 rounded-full px-2.5 py-1.5 text-xs'
  useEffect(() => {
    if (isTurnActive) {
      setOpen(false)
      setConfirmDialog(false)
      setAutoDialog(false)
      interactionTabIdRef.current = null
    }
  }, [isTurnActive])

  useEffect(() => {
    if (
      (open || confirmDialog || autoDialog) &&
      activeTabId !== interactionTabIdRef.current
    ) {
      setOpen(false)
      setConfirmDialog(false)
      setAutoDialog(false)
      interactionTabIdRef.current = null
    }
  }, [activeTabId, autoDialog, confirmDialog, open])

  useEffect(() => {
    setOpen(false)
  }, [currentMode])

  useEffect(() => {
    const dialogOpen = confirmDialog || autoDialog
    if (dialogWasOpenRef.current && !dialogOpen) {
      requestAnimationFrame(() => triggerRef.current?.focus())
    }
    dialogWasOpenRef.current = dialogOpen
  }, [autoDialog, confirmDialog])

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setOpen(false)
      return
    }

    const actionTabId = useTabStore.getState().activeTabId
    if (isTurnActiveNow(actionTabId)) return
    interactionTabIdRef.current = actionTabId
    setOpen(true)
  }

  const selectPermission = (item: (typeof PERMISSION_ITEMS)[number]) => {
    const actionTabId = useTabStore.getState().activeTabId
    if (
      actionTabId !== interactionTabIdRef.current ||
      isTurnActiveNow(actionTabId)
    ) {
      setOpen(false)
      setConfirmDialog(false)
      setAutoDialog(false)
      interactionTabIdRef.current = null
      return
    }
    if (item.value === 'auto' && item.value !== currentMode) {
      setOpen(false)
      setAutoDialog(true)
      return
    }
    if (item.value === 'bypassPermissions') {
      setOpen(false)
      setConfirmDialog(true)
      return
    }
    if (isControlled) {
      onChange?.(item.value)
    } else if (actionTabId) {
      setSessionPermissionMode(actionTabId, item.value)
    }
    setOpen(false)
    interactionTabIdRef.current = null
  }

  const renderPermissionItem = (item: (typeof PERMISSION_ITEMS)[number]) => (
    <>
      <item.icon
        aria-hidden
        className={`mt-0.5 size-5 ${item.color || 'text-[var(--color-text-secondary)]'}`}
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-[var(--color-text-primary)]">{item.label}</div>
        <div className="mt-0.5 text-xs text-[var(--color-text-tertiary)]">{item.description}</div>
      </div>
    </>
  )

  const CurrentModeIcon = MODE_ICONS[currentMode]
  const trigger = (
    <Button
      ref={triggerRef}
      variant="ghost"
      size="sm"
      onClick={isMobile ? () => handleOpenChange(!open) : undefined}
      disabled={isTurnActive}
      aria-label={MODE_LABELS[currentMode]}
      aria-haspopup={isMobile ? 'dialog' : undefined}
      aria-expanded={isMobile ? open : undefined}
      aria-controls={open ? menuId : undefined}
      title={isTurnActive ? t('permMode.disabledDuringTurn') : (compact ? MODE_LABELS[currentMode] : undefined)}
      className={`flex items-center bg-[var(--color-surface-container-low)] font-medium text-[var(--color-text-secondary)] transition-colors ${
        isTurnActive ? 'cursor-not-allowed opacity-50' : 'hover:bg-[var(--color-surface-hover)]'
      } ${compactButtonClass}`}
    >
      <CurrentModeIcon aria-hidden className="size-3.5" />
      {!compact && (
        <>
          <span>{MODE_LABELS[currentMode]}</span>
          <ChevronDown aria-hidden className="size-3" />
        </>
      )}
    </Button>
  )

  return (
    <div className="relative">
      {isMobile ? (
        <>
          {trigger}
          {open && (
            <MobileBottomSheet
              open={open}
              onClose={() => setOpen(false)}
              title={t('permMode.executionPermissions')}
              closeLabel={t('tabs.close')}
              ariaLabel={t('permMode.executionPermissions')}
              contentClassName="py-2"
            >
              <RadioGroup
                id={menuId}
                value={currentMode}
                aria-label={t('permMode.executionPermissions')}
                className="gap-0"
                onValueChange={(nextMode) => {
                  const item = PERMISSION_ITEMS.find(candidate => candidate.value === nextMode)
                  if (item) selectPermission(item)
                }}
              >
                {PERMISSION_ITEMS.map((item) => (
                  <label
                    key={item.value}
                    className={`flex min-h-14 cursor-pointer items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--color-surface-hover)] ${
                      item.value === currentMode ? 'bg-[var(--color-surface-selected)]' : ''
                    }`}
                  >
                    <RadioGroupItem
                      value={item.value}
                      aria-label={item.label}
                      className="mt-1"
                    />
                    {renderPermissionItem(item)}
                  </label>
                ))}
              </RadioGroup>
            </MobileBottomSheet>
          )}
        </>
      ) : (
        <DropdownMenu open={open} onOpenChange={handleOpenChange}>
          <DropdownMenuTrigger asChild>
            {trigger}
          </DropdownMenuTrigger>
          <DropdownMenuContent
            id={menuId}
            align="start"
            side={menuPlacement === 'bottom' ? 'bottom' : 'top'}
            className="w-[320px] p-2"
          >
            <DropdownMenuLabel className="px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-[var(--color-outline)]">
              {t('permMode.executionPermissions')}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={currentMode}
              onValueChange={(nextMode) => {
                const item = PERMISSION_ITEMS.find(candidate => candidate.value === nextMode)
                if (item) selectPermission(item)
              }}
            >
              {PERMISSION_ITEMS.map((item) => (
                <DropdownMenuRadioItem
                  key={item.value}
                  value={item.value}
                  className={`items-start gap-3 py-3 pl-8 pr-2 ${
                    item.value === currentMode ? 'bg-[var(--color-surface-selected)]' : ''
                  }`}
                >
                  {renderPermissionItem(item)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <ActionDialog
        open={confirmDialog}
        onClose={() => {
          setConfirmDialog(false)
          interactionTabIdRef.current = null
        }}
        title={t('permMode.enableBypassTitle')}
        width={420}
        body={(
          <div className="space-y-3">
            <p className="text-xs font-medium text-[var(--color-error)]">
              {t('permMode.enableBypassSubtitle')}
            </p>
            <p
              className="text-xs leading-relaxed text-[var(--color-text-secondary)]"
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(t('permMode.enableBypassBody')) }}
            />
            <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-container)] px-3 py-2" title={workDir}>
              <Folder aria-hidden className="size-4 shrink-0 text-[var(--color-text-tertiary)]" />
              <code className="truncate text-xs font-[var(--font-mono)] text-[var(--color-text-primary)]">{workDir}</code>
            </div>
            <ul className="space-y-1.5 text-xs text-[var(--color-text-secondary)]">
              <li className="flex items-start gap-2">
                <Check aria-hidden className="mt-0.5 size-3.5 text-[var(--color-error)]" />
                {t('permMode.permReadWrite')}
              </li>
              <li className="flex items-start gap-2">
                <Check aria-hidden className="mt-0.5 size-3.5 text-[var(--color-error)]" />
                {t('permMode.permShell')}
              </li>
              <li className="flex items-start gap-2">
                <Check aria-hidden className="mt-0.5 size-3.5 text-[var(--color-error)]" />
                {t('permMode.permPackages')}
              </li>
            </ul>
          </div>
        )}
        actions={[
          {
            label: t('common.cancel'),
            onClick: () => {
              setConfirmDialog(false)
              interactionTabIdRef.current = null
            },
            variant: 'secondary',
          },
          {
            label: t('permMode.enableBypassBtn'),
            onClick: () => {
              const actionTabId = useTabStore.getState().activeTabId
              if (
                actionTabId !== interactionTabIdRef.current ||
                isTurnActiveNow(actionTabId)
              ) {
                setConfirmDialog(false)
                interactionTabIdRef.current = null
                return
              }
              if (isControlled) {
                onChange?.('bypassPermissions')
              } else if (actionTabId) {
                setSessionPermissionMode(actionTabId, 'bypassPermissions')
              }
              setConfirmDialog(false)
              interactionTabIdRef.current = null
            },
            variant: 'danger',
          },
        ]}
      />

      <AutoModeOptInDialog
        open={autoDialog}
        loading={autoConsentPending}
        onClose={() => {
          if (autoConsentPending) return
          setAutoDialog(false)
          interactionTabIdRef.current = null
        }}
        onConfirm={async () => {
          const actionTabId = useTabStore.getState().activeTabId
          if (
            actionTabId !== interactionTabIdRef.current ||
            isTurnActiveNow(actionTabId)
          ) {
            setAutoDialog(false)
            interactionTabIdRef.current = null
            return
          }

          setAutoConsentPending(true)
          try {
            if (!autoModeOptInAccepted) {
              await acceptAutoModeOptIn()
            }
            const confirmedTabId = useTabStore.getState().activeTabId
            if (
              confirmedTabId !== interactionTabIdRef.current ||
              isTurnActiveNow(confirmedTabId)
            ) {
              return
            }
            if (isControlled) {
              onChange?.('auto')
            } else if (confirmedTabId) {
              setSessionPermissionMode(confirmedTabId, 'auto')
            }
            setAutoDialog(false)
            interactionTabIdRef.current = null
          } catch (err) {
            useUIStore.getState().addToast({
              type: 'error',
              message: err instanceof Error ? err.message : t('common.error'),
            })
          } finally {
            setAutoConsentPending(false)
          }
        }}
      />
    </div>
  )
}
