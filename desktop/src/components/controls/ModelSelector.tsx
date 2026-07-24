import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { OFFICIAL_MODELS } from '../../constants/modelCatalog'
import {
  OPENAI_OFFICIAL_MODELS,
  OPENAI_OFFICIAL_PROVIDER_ID,
} from '../../constants/openaiOfficialProvider'
import { useTranslation } from '../../i18n'
import { useChatStore } from '../../stores/chatStore'
import { useProviderStore } from '../../stores/providerStore'
import { DRAFT_RUNTIME_SELECTION_KEY, useSessionRuntimeStore } from '../../stores/sessionRuntimeStore'
import { useSettingsStore } from '../../stores/settingsStore'
import type { SavedProvider } from '../../types/provider'
import type { RuntimeSelection } from '../../types/runtime'
import type { ModelInfo, ReasoningEffortLevel } from '../../types/settings'
import { useMobileViewport } from '../../hooks/useMobileViewport'
import { isDesktopRuntime } from '../../lib/desktopRuntime'
import { resolveDefaultRuntimeSelection } from '../../lib/runtimeSelection'
import { useHahaOAuthStore } from '../../stores/hahaOAuthStore'
import { useHahaOpenAIOAuthStore } from '../../stores/hahaOpenAIOAuthStore'
import { useHahaGrokOAuthStore } from '../../stores/hahaGrokOAuthStore'
import {
  GROK_OFFICIAL_MODELS,
  GROK_OFFICIAL_PROVIDER_ID,
} from '../../constants/grokOfficialProvider'
import { MobileBottomSheet } from '../shared/MobileBottomSheet'
import { ReasoningEffortPopover } from './ReasoningEffortPopover'
import { Button } from '../ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../ui/popover'
import { ScrollArea } from '../ui/scroll-area'

type ProviderChoice = {
  providerId: string | null
  providerName: string
  isDefault: boolean
  models: ModelInfo[]
}

type Props = {
  value?: string
  onChange?: (modelId: string) => void
  runtimeSelection?: RuntimeSelection
  onRuntimeSelectionChange?: (selection: RuntimeSelection) => void
  runtimeKey?: string
  disabled?: boolean
  compact?: boolean
  fluid?: boolean
}

export type ModelSelectorHandle = {
  open: () => void
}

function officialChoices(
  providerId: string | null,
  models: ModelInfo[],
  isDefault: boolean,
  officialName: string,
): ProviderChoice {
  return {
    providerId,
    providerName: officialName,
    isDefault,
    models,
  }
}

function mergeOfficialModels(availableModels: ModelInfo[]): ModelInfo[] {
  const merged = [...OFFICIAL_MODELS]
  const knownIds = new Set(merged.map(model => model.id))
  for (const model of availableModels) {
    if (!knownIds.has(model.id)) {
      knownIds.add(model.id)
      merged.push(model)
    }
  }
  return merged
}

function buildProviderModels(
  provider: SavedProvider,
  labels: Record<'main' | 'haiku' | 'sonnet' | 'opus', string>,
): ModelInfo[] {
  const entries: Array<{ id: string; label: string }> = [
    { id: provider.models.main.trim(), label: labels.main },
    { id: provider.models.haiku.trim(), label: labels.haiku },
    { id: provider.models.sonnet.trim(), label: labels.sonnet },
    { id: provider.models.opus.trim(), label: labels.opus },
  ]

  const byId = new Map<string, { id: string; labels: string[] }>()
  for (const entry of entries) {
    if (!entry.id) continue
    const existing = byId.get(entry.id)
    if (existing) {
      if (!existing.labels.includes(entry.label)) {
        existing.labels.push(entry.label)
      }
      continue
    }
    byId.set(entry.id, { id: entry.id, labels: [entry.label] })
  }

  return [...byId.values()].map((entry) => ({
    id: entry.id,
    name: entry.id,
    description: entry.labels.join(' · '),
    context: '',
  }))
}

function buildProviderChoices(
  providers: SavedProvider[],
  activeId: string | null,
  availableModels: ModelInfo[],
  officialName: string,
  openAIOfficialName: string,
  grokOfficialName: string,
  labels: Record<'main' | 'haiku' | 'sonnet' | 'opus', string>,
  claudeOfficialLoggedIn: boolean,
  openAIOfficialLoggedIn: boolean,
  grokOfficialLoggedIn: boolean,
): ProviderChoice[] {
  const claudeOfficialModels = activeId === null && availableModels.length > 0
    ? mergeOfficialModels(availableModels)
    : OFFICIAL_MODELS
  const openAIOfficialModels = activeId === OPENAI_OFFICIAL_PROVIDER_ID && availableModels.length > 0
    ? availableModels
    : OPENAI_OFFICIAL_MODELS
  const grokOfficialModels = activeId === GROK_OFFICIAL_PROVIDER_ID && availableModels.length > 0
    ? availableModels
    : GROK_OFFICIAL_MODELS

  const choices: ProviderChoice[] = []

  if (claudeOfficialLoggedIn) {
    choices.push(officialChoices(null, claudeOfficialModels, activeId === null, officialName))
  }
  if (openAIOfficialLoggedIn) {
    choices.push(officialChoices(
      OPENAI_OFFICIAL_PROVIDER_ID,
      openAIOfficialModels,
      activeId === OPENAI_OFFICIAL_PROVIDER_ID,
      openAIOfficialName,
    ))
  }
  if (grokOfficialLoggedIn) {
    choices.push(officialChoices(
      GROK_OFFICIAL_PROVIDER_ID,
      grokOfficialModels,
      activeId === GROK_OFFICIAL_PROVIDER_ID,
      grokOfficialName,
    ))
  }

  for (const provider of providers) {
    choices.push({
      providerId: provider.id,
      providerName: provider.name,
      isDefault: activeId === provider.id,
      models: buildProviderModels(provider, labels),
    })
  }

  return choices
}

export const ModelSelector = forwardRef<ModelSelectorHandle, Props>(function ModelSelector({
  value,
  onChange,
  runtimeSelection: controlledRuntimeSelection,
  onRuntimeSelectionChange,
  runtimeKey,
  disabled = false,
  compact = false,
  fluid = false,
}: Props = {}, selectorRef) {
  const t = useTranslation()
  const isMobileBrowser = useMobileViewport() && !isDesktopRuntime()
  const {
    currentModel: storeModel,
    availableModels,
    effortLevel,
    activeProviderName,
    setModel,
  } = useSettingsStore()
  const {
    providers,
    activeId,
    isLoading: providersLoading,
    fetchProviders,
  } = useProviderStore()
  const claudeOAuthStatus = useHahaOAuthStore((s) => s.status)
  const fetchClaudeOAuthStatus = useHahaOAuthStore((s) => s.fetchStatus)
  const openAIOAuthStatus = useHahaOpenAIOAuthStore((s) => s.status)
  const fetchOpenAIOAuthStatus = useHahaOpenAIOAuthStore((s) => s.fetchStatus)
  const grokOAuthStatus = useHahaGrokOAuthStore((s) => s.status)
  const fetchGrokOAuthStatus = useHahaGrokOAuthStore((s) => s.fetchStatus)
  const runtimeSelection = useSessionRuntimeStore((state) =>
    runtimeKey ? state.selections[runtimeKey] : undefined,
  )
  const [open, setOpen] = useState(false)
  const [effortOpen, setEffortOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const requestedProvidersRef = useRef(false)
  const requestedOAuthStatusRef = useRef(false)

  const EFFORT_OPTIONS: { value: ReasoningEffortLevel; label: string }[] = [
    { value: 'low', label: t('settings.general.effort.low') },
    { value: 'medium', label: t('settings.general.effort.medium') },
    { value: 'high', label: t('settings.general.effort.high') },
    { value: 'xhigh', label: t('settings.general.effort.xhigh') },
    { value: 'max', label: t('settings.general.effort.max') },
  ]
  const effortLabels: Record<ReasoningEffortLevel, string> = {
    low: t('settings.general.effort.low'),
    medium: t('settings.general.effort.medium'),
    high: t('settings.general.effort.high'),
    xhigh: t('settings.general.effort.xhigh'),
    max: t('settings.general.effort.max'),
  }

  const isControlled = value !== undefined
  const isRuntimeScoped =
    !isControlled &&
    (runtimeKey !== undefined || onRuntimeSelectionChange !== undefined)
  const canEditRuntimeEffort = runtimeKey !== undefined

  useEffect(() => {
    if (!isRuntimeScoped || providersLoading || requestedProvidersRef.current) return
    requestedProvidersRef.current = true
    void fetchProviders()
  }, [fetchProviders, isRuntimeScoped, providersLoading])

  useEffect(() => {
    if (!isRuntimeScoped || !open || requestedOAuthStatusRef.current) return
    requestedOAuthStatusRef.current = true
    void fetchClaudeOAuthStatus()
    void fetchOpenAIOAuthStatus()
    void fetchGrokOAuthStatus()
  }, [fetchClaudeOAuthStatus, fetchGrokOAuthStatus, fetchOpenAIOAuthStatus, isRuntimeScoped, open])

  const openSelector = useCallback(() => {
    if (!disabled) {
      setEffortOpen(false)
      setOpen(true)
    }
  }, [disabled])

  useImperativeHandle(selectorRef, () => ({
    open: openSelector,
  }), [openSelector])

  const roleLabels = useMemo(
    () => ({
      main: t('settings.providers.mainModel'),
      haiku: t('settings.providers.haikuModel'),
      sonnet: t('settings.providers.sonnetModel'),
      opus: t('settings.providers.opusModel'),
    }),
    [t],
  )

  const providerChoices = useMemo(
    () => buildProviderChoices(
      providers,
      activeId,
      availableModels,
      t('settings.providers.officialName'),
      t('settings.providers.openaiOfficialName'),
      t('settings.providers.grokOfficialName'),
      roleLabels,
      claudeOAuthStatus?.loggedIn === true,
      openAIOAuthStatus?.loggedIn === true,
      grokOAuthStatus?.loggedIn === true,
    ),
    [activeId, availableModels, providers, roleLabels, t, claudeOAuthStatus, grokOAuthStatus, openAIOAuthStatus],
  )

  const selectedModel = isControlled
    ? availableModels.find((model) => model.id === value) || null
    : storeModel

  const activeRuntimeSelection = isRuntimeScoped
    ? controlledRuntimeSelection ?? runtimeSelection ?? resolveDefaultRuntimeSelection(
      activeId,
      activeProviderName,
      providers,
      storeModel?.id,
    )
    : null

  const selectedProviderChoice = activeRuntimeSelection
    ? providerChoices.find((choice) => choice.providerId === activeRuntimeSelection.providerId) ?? null
    : null

  const selectedRuntimeModel = activeRuntimeSelection
    ? selectedProviderChoice?.models.find((model) => model.id === activeRuntimeSelection.modelId)
      ?? {
        id: activeRuntimeSelection.modelId,
        name: activeRuntimeSelection.modelId,
        description: '',
        context: '',
      }
    : null

  const buttonModelLabel = isRuntimeScoped
    ? selectedRuntimeModel?.name ?? storeModel?.name ?? t('model.selectModel')
    : selectedModel?.name ?? t('model.selectModel')
  const buttonProviderLabel = isRuntimeScoped
    ? selectedProviderChoice?.providerName ?? activeProviderName ?? t('settings.providers.officialName')
    : null
  const supportedRuntimeEfforts = selectedRuntimeModel?.supportedReasoningEfforts
  const selectedRuntimeEffort = supportedRuntimeEfforts?.length === 0
    ? undefined
    : activeRuntimeSelection?.effortLevel
      ?? selectedRuntimeModel?.defaultReasoningEffort
      ?? effortLevel
  const runtimeEffortOptions = supportedRuntimeEfforts === undefined
    ? EFFORT_OPTIONS.filter((option) => option.value !== 'xhigh')
    : EFFORT_OPTIONS.filter((option) => supportedRuntimeEfforts.includes(option.value))

  const handleRuntimeSelect = (selection: RuntimeSelection) => {
    onRuntimeSelectionChange?.(selection)
    if (runtimeKey) {
      useSessionRuntimeStore.getState().setSelection(runtimeKey, selection)
      if (runtimeKey !== DRAFT_RUNTIME_SELECTION_KEY) {
        useChatStore.getState().setSessionRuntime(runtimeKey, selection)
      }
    }
    setOpen(false)
  }

  const handleRuntimeEffortSelect = (level: ReasoningEffortLevel) => {
    if (!activeRuntimeSelection) return
    handleRuntimeSelect({
      ...activeRuntimeSelection,
      effortLevel: level,
    })
  }

  useEffect(() => {
    if (!disabled) return
    setOpen(false)
    setEffortOpen(false)
  }, [disabled])

  const selectRuntimeModel = (choice: ProviderChoice, model: ModelInfo) => {
    const supportedEfforts = model.supportedReasoningEfforts
    const explicitEffort = activeRuntimeSelection?.effortLevel
    const nextEffort = supportedEfforts === undefined
      ? explicitEffort ?? effortLevel
      : supportedEfforts.length
        ? explicitEffort && supportedEfforts.includes(explicitEffort)
          ? explicitEffort
          : model.defaultReasoningEffort ?? supportedEfforts[0]
        : undefined
    handleRuntimeSelect({
      providerId: choice.providerId,
      modelId: model.id,
      ...(nextEffort ? { effortLevel: nextEffort } : {}),
    })
  }

  const selectPlainModel = (model: ModelInfo) => {
    if (isControlled) {
      onChange?.(model.id)
    } else {
      void setModel(model.id)
    }
    setOpen(false)
  }

  const handleOptionKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const options = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-model-option]')]
      .filter(option => !option.disabled)
    if (!options.length) return
    event.preventDefault()
    const currentIndex = options.indexOf(document.activeElement as HTMLButtonElement)
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? options.length - 1
        : event.key === 'ArrowDown'
          ? (currentIndex + 1 + options.length) % options.length
          : (currentIndex - 1 + options.length) % options.length
    options[nextIndex]?.focus()
  }

  const dropdownContent = (
    <div
      ref={dropdownRef}
      role="listbox"
      aria-label={t('model.configuration')}
      onKeyDown={handleOptionKeyDown}
    >
      <ScrollArea className={isMobileBrowser ? '' : 'max-h-[min(420px,var(--radix-popover-content-available-height))]'}>
        <div className={isMobileBrowser ? 'p-1' : 'p-3'}>
        {!isMobileBrowser && (
          <div className="mb-2 px-1 text-[10px] font-bold uppercase tracking-widest text-[var(--color-outline)]">
            {t('model.configuration')}
          </div>
        )}

        {isRuntimeScoped ? (
          <div className="space-y-3">
            {providerChoices.map((choice) => (
              <div key={choice.providerId ?? 'official'} className="space-y-1.5">
                <div className="flex items-center justify-between px-2 pt-1">
                  <span className="truncate text-[11px] font-semibold tracking-[0.01em] text-[var(--color-text-secondary)]">
                    {choice.providerName}
                  </span>
                  {choice.isDefault && (
                    <span className="flex-shrink-0 text-[10px] font-medium text-[var(--color-text-tertiary)]">
                      {t('settings.providers.default')}
                    </span>
                  )}
                </div>

                <div className="space-y-1">
                  {choice.models.map((model) => {
                    const isSelected =
                      activeRuntimeSelection?.providerId === choice.providerId &&
                      activeRuntimeSelection.modelId === model.id
                    return (
                      <Button
                        key={`${choice.providerId ?? 'official'}:${model.id}`}
                        type="button"
                        variant="ghost"
                        role="option"
                        aria-selected={isSelected}
                        data-model-option
                        onClick={() => selectRuntimeModel(choice, model)}
                        className={`
                          h-auto w-full justify-start rounded-lg border px-3 text-left transition-colors
                          ${isMobileBrowser ? 'min-h-[56px] py-3' : 'py-2.5'}
                          ${isSelected
                            ? 'border-[var(--color-model-option-selected-border)] bg-[var(--color-model-option-selected-bg)]'
                            : 'border-transparent hover:bg-[var(--color-surface-hover)]'
                          }
                        `}
                      >
                        <div className="flex items-start gap-3">
                          <Check
                            aria-hidden="true"
                            className={`mt-0.5 size-4 flex-shrink-0 ${
                              isSelected ? 'text-[var(--color-brand)]' : 'opacity-0'
                            }`}
                          />

                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
                              {model.name}
                            </div>
                            {model.description && (
                              <div className="mt-0.5 truncate pr-[6px] text-[10px] text-[var(--color-text-tertiary)]">
                                {model.description}
                              </div>
                            )}
                          </div>
                        </div>
                      </Button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            {availableModels.map((model) => {
              const isSelected = model.id === selectedModel?.id
              return (
                <Button
                  key={model.id}
                  type="button"
                  variant="ghost"
                  role="option"
                  aria-selected={isSelected}
                  data-model-option
                  onClick={() => selectPlainModel(model)}
                  className={`
                    h-auto w-full justify-start rounded-lg px-3 text-left transition-colors
                    ${isMobileBrowser ? 'min-h-[56px] py-3' : 'py-2.5'}
                    ${isSelected
                      ? 'border border-[var(--color-model-option-selected-border)] bg-[var(--color-model-option-selected-bg)]'
                      : 'hover:bg-[var(--color-surface-hover)]'
                    }
                  `}
                >
                  <div className="flex items-center gap-3">
                    <Check
                      aria-hidden="true"
                      className={`size-4 flex-shrink-0 ${
                        isSelected ? 'text-[var(--color-brand)]' : 'opacity-0'
                      }`}
                    />

                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-[var(--color-text-primary)]">{model.name}</div>
                      {model.description && (
                        <div className="mt-0.5 truncate text-[10px] text-[var(--color-text-tertiary)]">
                          {model.description}
                        </div>
                      )}
                    </div>
                  </div>
                </Button>
              )
            })}
          </div>
        )}
        </div>
      </ScrollArea>
    </div>
  )

  const modelTrigger = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={disabled}
      onClick={isMobileBrowser ? openSelector : undefined}
      aria-label={buttonProviderLabel ? `${buttonModelLabel}, ${buttonProviderLabel}` : buttonModelLabel}
      title={buttonProviderLabel ? `${buttonProviderLabel} · ${buttonModelLabel}` : undefined}
      className={`h-auto min-w-0 gap-2 rounded-l-full text-xs font-medium text-[var(--color-text-secondary)] ${
        compact ? `${fluid ? 'flex-1' : ''} max-w-[112px] py-1.5 pl-2.5 pr-1` : 'max-w-[220px] py-1.5 pl-3 pr-1'
      }`}
    >
      <span className={`${compact ? 'text-xs' : 'text-sm'} min-w-0 flex-1 truncate font-semibold text-[var(--color-text-primary)]`}>
        {buttonModelLabel}
      </span>
      {!canEditRuntimeEffort && !compact && buttonProviderLabel && (
        <span className="max-w-[108px] flex-shrink-0 truncate text-[11px] text-[var(--color-text-tertiary)]">
          {buttonProviderLabel}
        </span>
      )}
      <ChevronDown aria-hidden="true" className="size-3 flex-shrink-0" />
    </Button>
  )

  return (
    <div
      data-testid="model-selector-shell"
      className={`relative min-w-0 ${fluid ? 'flex-1' : 'shrink-0'}`}
    >
      <div className={`flex min-w-0 items-stretch rounded-full bg-[var(--color-surface-container-low)] transition-colors hover:bg-[var(--color-surface-hover)] ${fluid ? 'w-full' : ''} ${disabled ? 'opacity-50' : ''}`}>
        {isMobileBrowser ? (
          <>
            {modelTrigger}
            <MobileBottomSheet
              open={open}
              onClose={() => setOpen(false)}
              title={t('model.configuration')}
              closeLabel={t('tabs.close')}
              ariaLabel={t('model.configuration')}
              contentClassName="p-3"
              testId="model-selector-dropdown"
            >
              {dropdownContent}
            </MobileBottomSheet>
          </>
        ) : (
          <Popover
            open={open}
            onOpenChange={(nextOpen) => {
              if (disabled) return
              setEffortOpen(false)
              setOpen(nextOpen)
            }}
          >
            <PopoverTrigger asChild>
              {modelTrigger}
            </PopoverTrigger>
            <PopoverContent
              data-testid="model-selector-dropdown"
              side="top"
              align="start"
              sideOffset={8}
              className="w-[360px] overflow-hidden p-0"
              onOpenAutoFocus={(event) => {
                event.preventDefault()
                queueMicrotask(() => {
                  const dropdown = dropdownRef.current
                  const selectedOption = dropdown
                    ?.querySelector<HTMLButtonElement>('[data-model-option][aria-selected="true"]')
                  const firstOption = dropdown
                    ?.querySelector<HTMLButtonElement>('[data-model-option]:not(:disabled)')
                  ;(selectedOption ?? firstOption)?.focus()
                })
              }}
            >
              {dropdownContent}
            </PopoverContent>
          </Popover>
        )}

        {canEditRuntimeEffort && selectedRuntimeEffort && runtimeEffortOptions.length > 0 && (
          <ReasoningEffortPopover
            open={effortOpen}
            trigger={(
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                aria-label={`${t('model.effort')}: ${effortLabels[selectedRuntimeEffort]}`}
                className={`h-auto rounded-r-full pr-3 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] ${compact ? 'pl-1 text-[10px]' : 'pl-1.5 text-xs'}`}
                onClick={() => {
                  setOpen(false)
                  setEffortOpen(current => !current)
                }}
              >
                {effortLabels[selectedRuntimeEffort]}
              </Button>
            )}
            options={runtimeEffortOptions.map((option) => option.value)}
            value={selectedRuntimeEffort}
            labels={effortLabels}
            ariaLabel={t('model.effort')}
            onChange={handleRuntimeEffortSelect}
            onClose={() => setEffortOpen(false)}
          />
        )}
      </div>
    </div>
  )
})
