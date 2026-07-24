import { useState, useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react'
import QRCode from 'qrcode'
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  GripVertical,
  KeyRound,
  Lightbulb,
  Paintbrush,
  PowerOff,
  QrCode,
  RotateCw,
  Shrink,
  X,
} from 'lucide-react'
import { useSettingsStore, UI_ZOOM_DEFAULT, UI_ZOOM_MIN, UI_ZOOM_MAX, UI_ZOOM_STEP } from '../stores/settingsStore'
import { useProviderStore } from '../stores/providerStore'
import { useTranslation, type TranslationKey } from '../i18n'
import { ConfirmDialog } from '../components/shared/ConfirmDialog'
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog'
import { Badge } from '../components/ui/badge'
import { Button as ShadcnButton } from '../components/ui/button'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from '../components/ui/card'
import { Checkbox } from '../components/ui/checkbox'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../components/ui/collapsible'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog'
import { Input as ShadcnInput } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Progress } from '../components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select'
import { Slider } from '../components/ui/slider'
import { Skeleton } from '../components/ui/skeleton'
import { Separator } from '../components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Textarea } from '../components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '../components/ui/toggle-group'
import { RadioGroup } from '../components/ui/radio-group'
import { SettingRadioCard } from '../components/ui/custom/setting-radio-card'
import { SettingField } from '../components/ui/custom/setting-field'
import { SettingSwitchRow } from '../components/ui/custom/setting-switch-row'
import { LoadingButton } from '../components/ui/custom/loading-button'
import { IconButton } from '../components/ui/custom/icon-button'
import { PermissionModeSelector } from '../components/controls/PermissionModeSelector'
import type { ThemeMode, UpdateProxyMode, NetworkProxyMode, WebSearchMode, AppMode, ChatSendBehavior, OutputStyleSource } from '../types/settings'
import type { Locale } from '../i18n'
import type { SavedProvider, UpdateProviderInput, ProviderTestResult, ModelMapping, Model1mSupport, ApiFormat, ProviderAuthStrategy } from '../types/provider'
import type { ProviderPreset } from '../types/providerPreset'
import { AdapterSettings } from './AdapterSettings'
import { useSessionStore } from '../stores/sessionStore'
import { MarkdownRenderer } from '../components/markdown/MarkdownRenderer'
import { useSkillStore } from '../stores/skillStore'
import { SkillList } from '../components/skills/SkillList'
import { SkillDetail } from '../components/skills/SkillDetail'
import { usePluginStore } from '../stores/pluginStore'
import { PluginList } from '../components/plugins/PluginList'
import { PluginDetail } from '../components/plugins/PluginDetail'
import { ComputerUseSettings } from './ComputerUseSettings'
import { McpSettings } from './McpSettings'
import { TerminalSettings } from './TerminalSettings'
import { DiagnosticsSettings } from './DiagnosticsSettings'
import { TraceList } from './TraceList'
import { ActivitySettings } from './ActivitySettings'
import { MemorySettings } from './MemorySettings'
import { PetSettings } from '../features/pets/PetSettings'
import { useUIStore, type SettingsTab } from '../stores/uiStore'
import { ClaudeOfficialLogin } from '../components/settings/ClaudeOfficialLogin'
import { ChatGPTOfficialLogin } from '../components/settings/ChatGPTOfficialLogin'
import { GrokOfficialLogin } from '../components/settings/GrokOfficialLogin'
import { AgentManager } from '../components/settings/AgentManager'
import {
  BUILT_IN_PROVIDER_IDS,
  CLAUDE_OFFICIAL_PROVIDER_ID,
  OPENAI_OFFICIAL_PROVIDER_ID,
} from '../constants/openaiOfficialProvider'
import { GROK_OFFICIAL_PROVIDER_ID } from '../constants/grokOfficialProvider'
import { useUpdateStore } from '../stores/updateStore'
import { getBaseUrl } from '../api/client'
import { formatBytes } from '../lib/formatBytes'
import { isDesktopRuntime } from '../lib/desktopRuntime'
import { getDesktopHost } from '../lib/desktopHost'
import { publicAssetPath } from '../lib/publicAsset'
import { isBrowserSafePort } from '../lib/browserSafePort'
import {
  getDesktopNotificationPermission,
  notifyDesktop,
  getDesktopNotificationPlatform,
  openDesktopNotificationSettings,
  requestDesktopNotificationPermission,
  type DesktopNotificationPermission,
} from '../lib/desktopNotifications'
import {
  API_KEY_JSON_PLACEHOLDER,
  maskSettingsJsonSecrets,
  restoreSettingsJsonSecrets,
  stripProviderSettingsJsonEnv,
} from '../lib/providerSettingsJson'
import { copyTextToClipboard } from '../components/chat/clipboard'

const NETWORK_TIMEOUT_MIN_SECONDS = 30
const NETWORK_TIMEOUT_MAX_SECONDS = 1800
const NETWORK_TIMEOUT_STEP_SECONDS = 30
const DEFAULT_RESPONSE_LANGUAGE_SELECT_VALUE = '__default__'
const BUILT_IN_OUTPUT_STYLE_TRANSLATION_KEYS = {
  default: {
    label: 'settings.general.outputStyleBuiltin.default.label',
    description: 'settings.general.outputStyleBuiltin.default.description',
  },
  Explanatory: {
    label: 'settings.general.outputStyleBuiltin.explanatory.label',
    description: 'settings.general.outputStyleBuiltin.explanatory.description',
  },
  Learning: {
    label: 'settings.general.outputStyleBuiltin.learning.label',
    description: 'settings.general.outputStyleBuiltin.learning.description',
  },
} satisfies Record<string, { label: TranslationKey; description: TranslationKey }>

function buildH5LaunchUrl(baseUrl: string | null, token: string | null): string | null {
  if (!baseUrl) return null

  try {
    const url = new URL(baseUrl)
    if (token) {
      url.searchParams.set('serverUrl', baseUrl)
      url.searchParams.set('h5Token', token)
    }
    return url.toString().replace(/\/$/, '')
  } catch {
    return token
      ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}serverUrl=${encodeURIComponent(baseUrl)}&h5Token=${encodeURIComponent(token)}`
      : baseUrl
  }
}

function isLanH5BaseUrl(url: URL): boolean {
  return url.protocol === 'http:' &&
    !!url.port &&
    (
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname.startsWith('10.') ||
      url.hostname.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(url.hostname) ||
      url.hostname.startsWith('169.254.')
    )
}

function extractH5AccessAddressDraft(baseUrl: string | null): string {
  if (!baseUrl) return ''

  try {
    const url = new URL(baseUrl)
    return isLanH5BaseUrl(url) ? url.hostname : baseUrl
  } catch {
    return baseUrl
  }
}

function extractHostnameFromUrl(value: string | null): string | null {
  if (!value) return null
  try {
    return new URL(value).hostname || null
  } catch {
    return null
  }
}

function extractH5AccessPort(baseUrl: string | null): string | null {
  if (!baseUrl) return null

  try {
    const url = new URL(baseUrl)
    return url.port || null
  } catch {
    return null
  }
}

// Mirrors the server-side fixedPort range (h5AccessService MIN/MAX_FIXED_PORT).
function parseH5FixedPortDraft(draft: string): number | null | 'invalid' {
  const trimmed = draft.trim()
  if (!trimmed) return null
  if (!/^\d{1,5}$/.test(trimmed)) return 'invalid'
  const port = Number(trimmed)
  return port >= 1024 && port <= 65535 && isBrowserSafePort(port) ? port : 'invalid'
}

// Mirrors the server-side disconnect grace range (h5AccessService
// MIN/MAX_DISCONNECT_GRACE_SECONDS). Empty = use the built-in 30s default.
function parseH5GraceDraft(draft: string): number | null | 'invalid' {
  const trimmed = draft.trim()
  if (!trimmed) return null
  if (!/^\d{1,5}$/.test(trimmed)) return 'invalid'
  const seconds = Number(trimmed)
  return seconds >= 5 && seconds <= 86400 ? seconds : 'invalid'
}

function buildH5PublicBaseUrlFromHostDraft(
  draft: string,
  currentBaseUrl: string | null,
  fallbackPort: string | null,
): string | null {
  const trimmed = draft.trim()
  if (!trimmed) return null
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed

  try {
    const current = currentBaseUrl ? new URL(currentBaseUrl) : null
    if (!current) {
      const port = fallbackPort ? `:${fallbackPort}` : ''
      return `http://${trimmed}${port}`
    }

    const port = current.port ? `:${current.port}` : ''
    const path = current.pathname === '/' ? '' : current.pathname.replace(/\/+$/, '')
    return `${current.protocol}//${trimmed}${port}${path}`
  } catch {
    const port = fallbackPort ? `:${fallbackPort}` : ''
    return `http://${trimmed}${port}`
  }
}

export function Settings() {
  const activeTab = useUIStore((s) => s.activeSettingsTab)
  const setActiveTab = useUIStore((s) => s.setActiveSettingsTab)
  const pendingSettingsTab = useUIStore((s) => s.pendingSettingsTab)
  const t = useTranslation()

  useEffect(() => {
    if (!pendingSettingsTab) return
    setActiveTab(pendingSettingsTab)
    useUIStore.getState().setPendingSettingsTab(null)
  }, [pendingSettingsTab, setActiveTab])

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[var(--color-surface)]">
      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as SettingsTab)}
        orientation="vertical"
        className="flex-1 gap-0 overflow-hidden"
      >
        {/* Tab navigation */}
        <TabsList
          aria-label={t('settings.title')}
          className="h-auto w-[180px] flex-shrink-0 flex-col items-stretch justify-start rounded-none border-r border-[var(--color-border)] bg-transparent py-3"
        >
          <div className="flex-1">
            <SettingsTabTrigger value="providers" icon="dns" label={t('settings.tab.providers')} active={activeTab === 'providers'} />
            <SettingsTabTrigger value="general" icon="tune" label={t('settings.tab.general')} active={activeTab === 'general'} />
            <SettingsTabTrigger value="h5Access" icon="qr_code_2" label={t('settings.tab.h5Access')} active={activeTab === 'h5Access'} />
            <SettingsTabTrigger value="adapters" icon="chat" label={t('settings.tab.adapters')} active={activeTab === 'adapters'} />
            <SettingsTabTrigger value="terminal" icon="terminal" label={t('settings.tab.terminal')} active={activeTab === 'terminal'} />
            <SettingsTabTrigger value="mcp" icon="dns" label={t('settings.tab.mcp')} active={activeTab === 'mcp'} />
            <SettingsTabTrigger value="agents" icon="smart_toy" label={t('settings.tab.agents')} active={activeTab === 'agents'} />
            <SettingsTabTrigger value="skills" icon="auto_awesome" label={t('settings.tab.skills')} active={activeTab === 'skills'} />
            <SettingsTabTrigger value="memory" icon="history_edu" label={t('settings.tab.memory')} active={activeTab === 'memory'} />
            <SettingsTabTrigger value="plugins" icon="extension" label={t('settings.tab.plugins')} active={activeTab === 'plugins'} />
            <SettingsTabTrigger value="pets" icon="pets" label={t('settings.tab.pets')} active={activeTab === 'pets'} />
            <SettingsTabTrigger value="computerUse" icon="mouse" label={t('settings.tab.computerUse')} active={activeTab === 'computerUse'} />
            <SettingsTabTrigger value="activity" icon="monitoring" label={t('settings.tab.activity')} active={activeTab === 'activity'} />
            <SettingsTabTrigger value="trace" icon="account_tree" label={t('settings.tab.trace')} active={activeTab === 'trace'} />
            <SettingsTabTrigger value="diagnostics" icon="monitor_heart" label={t('settings.tab.diagnostics')} active={activeTab === 'diagnostics'} />
          </div>
          <div className="border-t border-[var(--color-border)]/40 pt-1">
            <SettingsTabTrigger value="about" icon="info" label={t('settings.tab.about')} active={activeTab === 'about'} />
          </div>
        </TabsList>

        {/* Tab content; trace embeds a full-bleed page that manages its own scroll */}
        <SettingsTabContent value="providers"><ProviderSettings /></SettingsTabContent>
        <SettingsTabContent value="activity"><ActivitySettings /></SettingsTabContent>
        <SettingsTabContent value="general"><GeneralSettings /></SettingsTabContent>
        <SettingsTabContent value="h5Access"><H5AccessSettings /></SettingsTabContent>
        <SettingsTabContent value="adapters"><AdapterSettings /></SettingsTabContent>
        <SettingsTabContent value="terminal"><TerminalSettings showPreferences /></SettingsTabContent>
        <SettingsTabContent value="mcp"><McpSettings /></SettingsTabContent>
        <SettingsTabContent value="agents"><AgentManager /></SettingsTabContent>
        <SettingsTabContent value="skills"><SkillSettings /></SettingsTabContent>
        <SettingsTabContent value="memory"><MemorySettings /></SettingsTabContent>
        <SettingsTabContent value="plugins"><PluginSettings /></SettingsTabContent>
        <SettingsTabContent value="pets"><PetSettings /></SettingsTabContent>
        <SettingsTabContent value="computerUse"><ComputerUseSettings /></SettingsTabContent>
        <SettingsTabContent value="trace" fullBleed><TraceList /></SettingsTabContent>
        <SettingsTabContent value="diagnostics"><DiagnosticsSettings /></SettingsTabContent>
        <SettingsTabContent value="about"><AboutSettings /></SettingsTabContent>
      </Tabs>
    </div>
  )
}

function SettingsTabTrigger({
  value,
  icon,
  label,
  active,
}: {
  value: SettingsTab
  icon: string
  label: string
  active: boolean
}) {
  return (
    <TabsTrigger
      value={value}
      aria-current={active ? 'page' : undefined}
      onClick={() => {
        const state = useUIStore.getState()
        if (state.activeSettingsTab !== value) state.setActiveSettingsTab(value)
      }}
      className="w-full justify-start rounded-none px-4 py-2.5 text-left"
    >
      <span className="material-symbols-outlined text-[18px]" aria-hidden="true">{icon}</span>
      {label}
    </TabsTrigger>
  )
}

function SettingsTabContent({
  value,
  fullBleed = false,
  children,
}: {
  value: SettingsTab
  fullBleed?: boolean
  children: ReactNode
}) {
  return (
    <TabsContent
      value={value}
      className={fullBleed
        ? 'min-h-0 flex-1 flex-col overflow-hidden data-[state=active]:flex'
        : 'flex-1 overflow-y-auto px-8 py-6'}
    >
      {children}
    </TabsContent>
  )
}

// ─── Provider Settings ──────────────────────────────────────

type ProviderListItem =
  | { id: typeof CLAUDE_OFFICIAL_PROVIDER_ID; kind: 'claude-official' }
  | { id: typeof OPENAI_OFFICIAL_PROVIDER_ID; kind: 'openai-official' }
  | { id: typeof GROK_OFFICIAL_PROVIDER_ID; kind: 'grok-official' }
  | { id: string; kind: 'saved'; provider: SavedProvider }

function defaultProviderOrder(providers: SavedProvider[]): string[] {
  return [
    ...providers.map((provider) => provider.id),
    ...BUILT_IN_PROVIDER_IDS,
  ]
}

function normalizeProviderOrder(providerOrder: string[] | undefined, providers: SavedProvider[]): string[] {
  const knownIds = new Set<string>(defaultProviderOrder(providers))
  const seen = new Set<string>()
  const order: string[] = []

  const source = providerOrder && providerOrder.length > 0
    ? providerOrder
    : defaultProviderOrder(providers)

  for (const id of source) {
    if (!knownIds.has(id) || seen.has(id)) continue
    seen.add(id)
    order.push(id)
  }

  for (const id of defaultProviderOrder(providers)) {
    if (seen.has(id)) continue
    seen.add(id)
    order.push(id)
  }

  return order
}

function buildProviderListItems(
  providers: SavedProvider[],
  providerOrder: string[] | undefined,
): ProviderListItem[] {
  const savedItems = new Map(
    providers.map((provider) => [
      provider.id,
      { id: provider.id, kind: 'saved', provider } satisfies ProviderListItem,
    ]),
  )
  const items = new Map<string, ProviderListItem>([
    [CLAUDE_OFFICIAL_PROVIDER_ID, { id: CLAUDE_OFFICIAL_PROVIDER_ID, kind: 'claude-official' }],
    [OPENAI_OFFICIAL_PROVIDER_ID, { id: OPENAI_OFFICIAL_PROVIDER_ID, kind: 'openai-official' }],
    [GROK_OFFICIAL_PROVIDER_ID, { id: GROK_OFFICIAL_PROVIDER_ID, kind: 'grok-official' }],
    ...savedItems,
  ])

  return normalizeProviderOrder(providerOrder, providers)
    .map((id) => items.get(id))
    .filter((item): item is ProviderListItem => item !== undefined)
}

function providerItemTestId(item: ProviderListItem): string {
  switch (item.kind) {
    case 'claude-official':
      return 'claude-official-provider'
    case 'openai-official':
      return 'openai-official-provider'
    case 'grok-official':
      return 'grok-official-provider'
    case 'saved':
      return `provider-${item.provider.id}`
  }
}

function ProviderSettings() {
  const {
    providers,
    providerOrder,
    activeId,
    hasLoadedProviders,
    presets,
    isLoading,
    fetchProviders,
    deleteProvider,
    reorderProviders,
    activateProvider,
    activateOfficial,
    testProvider,
  } = useProviderStore()
  const fetchSettings = useSettingsStore((s) => s.fetchAll)
  const t = useTranslation()
  const [editingProvider, setEditingProvider] = useState<SavedProvider | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [pendingDeleteProvider, setPendingDeleteProvider] = useState<SavedProvider | null>(null)
  const [isDeletingProvider, setIsDeletingProvider] = useState(false)
  const deleteProviderTriggerRef = useRef<HTMLButtonElement | null>(null)
  const providerFormTriggerRef = useRef<HTMLButtonElement | null>(null)
  const [testResults, setTestResults] = useState<Record<string, { loading: boolean; result?: ProviderTestResult }>>({})
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  useEffect(() => {
    void fetchProviders()
  }, [fetchProviders])

  const presetMap = useMemo(
    () => new Map(presets.map((preset) => [preset.id, preset])),
    [presets],
  )

  const handleDelete = (provider: SavedProvider, trigger: HTMLButtonElement) => {
    if (activeId === provider.id) return
    deleteProviderTriggerRef.current = trigger
    setPendingDeleteProvider(provider)
  }

  const restoreProviderFormFocus = () => {
    window.setTimeout(() => providerFormTriggerRef.current?.focus(), 0)
  }

  const closeCreateProvider = () => {
    setShowCreateModal(false)
    restoreProviderFormFocus()
  }

  const closeEditProvider = () => {
    setEditingProvider(null)
    restoreProviderFormFocus()
  }

  const closeDeleteDialog = () => {
    if (isDeletingProvider) return
    setPendingDeleteProvider(null)
    window.setTimeout(() => deleteProviderTriggerRef.current?.focus(), 0)
  }

  const confirmDelete = async () => {
    if (!pendingDeleteProvider) return
    setIsDeletingProvider(true)
    try {
      await deleteProvider(pendingDeleteProvider.id)
      setPendingDeleteProvider(null)
    } catch (error) {
      console.error(error)
    } finally {
      setIsDeletingProvider(false)
    }
  }

  const handleTest = async (provider: SavedProvider) => {
    setTestResults((r) => ({ ...r, [provider.id]: { loading: true } }))
    try {
      const result = await testProvider(provider.id)
      setTestResults((r) => ({ ...r, [provider.id]: { loading: false, result } }))
    } catch {
      setTestResults((r) => ({ ...r, [provider.id]: { loading: false, result: { connectivity: { success: false, latencyMs: 0, error: t('settings.providers.requestFailed') } } } }))
    }
  }

  const handleActivate = async (id: string) => {
    await activateProvider(id)
    await fetchSettings()
  }

  const handleActivateOfficial = async () => {
    await activateOfficial()
    await fetchSettings()
  }

  const providerItems = useMemo(
    () => buildProviderListItems(providers, providerOrder),
    [providerOrder, providers],
  )

  const handleProviderDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const ids = providerItems.map((item) => item.id)
    const oldIndex = ids.indexOf(String(active.id))
    const newIndex = ids.indexOf(String(over.id))
    if (oldIndex === -1 || newIndex === -1) return

    void reorderProviders(arrayMove(ids, oldIndex, newIndex))
  }

  const isClaudeOfficialActive = hasLoadedProviders && activeId === null
  const isOpenAIOfficialActive = hasLoadedProviders && activeId === OPENAI_OFFICIAL_PROVIDER_ID
  const isGrokOfficialActive = hasLoadedProviders && activeId === GROK_OFFICIAL_PROVIDER_ID

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{t('settings.providers.title')}</h2>
          <p className="text-sm text-[var(--color-text-tertiary)] mt-0.5">{t('settings.providers.description')}</p>
        </div>
        <ShadcnButton
          size="sm"
          onClick={(event) => {
            providerFormTriggerRef.current = event.currentTarget
            setShowCreateModal(true)
          }}
        >
          <span className="material-symbols-outlined text-[16px]">add</span>
          {t('settings.providers.addProvider')}
        </ShadcnButton>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleProviderDragEnd}
      >
        <SortableContext
          items={providerItems.map((item) => item.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="flex flex-col gap-2">
            {providerItems.map((item) => {
              if (item.kind === 'claude-official') {
                return (
                  <SortableProviderCard
                    key={item.id}
                    item={item}
                    isActive={isClaudeOfficialActive}
                    dragLabel={t('settings.providers.dragToReorder')}
                    onActivate={!isClaudeOfficialActive ? handleActivateOfficial : undefined}
                    title={t('settings.providers.officialName')}
                    subtitle={t('settings.providers.officialDesc')}
                    badges={isClaudeOfficialActive ? (
                      <Badge variant="outline" className="min-h-0 border-[var(--color-brand)]/20 bg-[var(--color-brand)]/10 px-1.5 py-0.5 text-[10px] font-bold leading-none text-[var(--color-brand)]">{t('settings.providers.default')}</Badge>
                    ) : null}
                    details={isClaudeOfficialActive ? (
                      <div className="border-t border-[var(--color-border-separator)] px-4 pb-4 pt-3">
                        <ClaudeOfficialLogin />
                      </div>
                    ) : null}
                  />
                )
              }

              if (item.kind === 'openai-official') {
                return (
                  <SortableProviderCard
                    key={item.id}
                    item={item}
                    isActive={isOpenAIOfficialActive}
                    dragLabel={t('settings.providers.dragToReorder')}
                    onActivate={!isOpenAIOfficialActive ? () => handleActivate(OPENAI_OFFICIAL_PROVIDER_ID) : undefined}
                    title={t('settings.providers.openaiOfficialName')}
                    subtitle={t('settings.providers.openaiOfficialDesc')}
                    badges={isOpenAIOfficialActive ? (
                      <Badge variant="outline" className="min-h-0 border-[var(--color-brand)]/20 bg-[var(--color-brand)]/10 px-1.5 py-0.5 text-[10px] font-bold leading-none text-[var(--color-brand)]">{t('settings.providers.default')}</Badge>
                    ) : null}
                    details={isOpenAIOfficialActive ? (
                      <div className="border-t border-[var(--color-border-separator)] px-4 pb-4 pt-3">
                        <ChatGPTOfficialLogin />
                      </div>
                    ) : null}
                  />
                )
              }

              if (item.kind === 'grok-official') {
                return (
                  <SortableProviderCard
                    key={item.id}
                    item={item}
                    isActive={isGrokOfficialActive}
                    dragLabel={t('settings.providers.dragToReorder')}
                    onActivate={!isGrokOfficialActive ? () => handleActivate(GROK_OFFICIAL_PROVIDER_ID) : undefined}
                    title={t('settings.providers.grokOfficialName')}
                    subtitle={t('settings.providers.grokOfficialDesc')}
                    badges={isGrokOfficialActive ? (
                      <Badge variant="outline" className="min-h-0 border-[var(--color-brand)]/20 bg-[var(--color-brand)]/10 px-1.5 py-0.5 text-[10px] font-bold leading-none text-[var(--color-brand)]">{t('settings.providers.default')}</Badge>
                    ) : null}
                    details={isGrokOfficialActive ? (
                      <div className="border-t border-[var(--color-border-separator)] px-4 pb-4 pt-3">
                        <GrokOfficialLogin />
                      </div>
                    ) : null}
                  />
                )
              }

              const provider = item.provider
              const isActive = activeId === provider.id
              const test = testResults[provider.id]
              const preset = presetMap.get(provider.presetId)

              return (
                <SortableProviderCard
                  key={item.id}
                  item={item}
                  isActive={isActive}
                  dragLabel={t('settings.providers.dragToReorder')}
                  onActivate={!isActive ? () => handleActivate(provider.id) : undefined}
                  title={provider.name}
                  subtitle={`${provider.baseUrl} · ${provider.models.main}`}
                  badges={(
                    <>
                      {preset && preset.id !== 'custom' && (
                        <Badge variant="secondary" className="min-h-0 px-1.5 py-0.5 text-[10px] leading-none">{preset.name}</Badge>
                      )}
                      {provider.apiFormat && provider.apiFormat !== 'anthropic' && (
                        <Badge variant="secondary" className="min-h-0 px-1.5 py-0.5 text-[10px] leading-none text-[var(--color-warning)]">
                          {provider.apiFormat === 'openai_chat' ? 'OpenAI Chat' : 'OpenAI Responses'}
                        </Badge>
                      )}
                      {isActive && (
                        <Badge variant="outline" className="min-h-0 border-[var(--color-brand)]/20 bg-[var(--color-brand)]/10 px-1.5 py-0.5 text-[10px] font-bold leading-none text-[var(--color-brand)]">{t('settings.providers.default')}</Badge>
                      )}
                    </>
                  )}
                  result={test && !test.loading && test.result ? (
                    <Alert
                      variant={test.result.connectivity.success && (!test.result.proxy || test.result.proxy.success) ? 'default' : 'destructive'}
                      className="mt-2 gap-0.5 px-2 py-1.5 text-xs"
                    >
                      <span className={test.result.connectivity.success ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}>
                        {test.result.connectivity.success
                          ? t('settings.providers.connectivityOk', { latency: String(test.result.connectivity.latencyMs) })
                          : t('settings.providers.connectivityFailed', { error: test.result.connectivity.error || '' })}
                      </span>
                      {test.result.proxy && (
                        <span className={test.result.proxy.success ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}>
                          {test.result.proxy.success
                            ? t('settings.providers.proxyOk', { latency: String(test.result.proxy.latencyMs) })
                            : t('settings.providers.proxyFailed', { error: test.result.proxy.error || '' })}
                        </span>
                      )}
                    </Alert>
                  ) : null}
                  actions={(
                    <>
                      {!isActive && (
                        <ShadcnButton variant="ghost" size="sm" onClick={() => handleActivate(provider.id)}>{t('settings.providers.setDefault')}</ShadcnButton>
                      )}
                      <LoadingButton variant="ghost" size="sm" onClick={() => handleTest(provider)} loading={test?.loading}>{t('settings.providers.test')}</LoadingButton>
                      <ShadcnButton
                        variant="ghost"
                        size="sm"
                        onClick={(event) => {
                          providerFormTriggerRef.current = event.currentTarget
                          setEditingProvider(provider)
                        }}
                      >
                        {t('settings.providers.edit')}
                      </ShadcnButton>
                      {!isActive && (
                        <ShadcnButton variant="ghost" size="sm" onClick={(event) => handleDelete(provider, event.currentTarget)} className="text-[var(--color-error)] hover:text-[var(--color-error)]">{t('common.delete')}</ShadcnButton>
                      )}
                    </>
                  )}
                />
              )
            })}
          </div>
        </SortableContext>
      </DndContext>

      {isLoading && providers.length === 0 ? (
        <div className="grid gap-2 py-2" role="status" aria-label={t('common.loading')}>
          <Skeleton className="h-[66px] w-full" />
          <Skeleton className="h-[66px] w-full" />
        </div>
      ) : null}

      {/* Create Modal — conditionally rendered so state resets on close */}
      {showCreateModal && (
        <ProviderFormModal open={true} onClose={closeCreateProvider} mode="create" presets={presets} />
      )}

      {/* Edit Modal */}
      {editingProvider && (
        <ProviderFormModal key={editingProvider.id} open={true} onClose={closeEditProvider} mode="edit" provider={editingProvider} presets={presets} />
      )}

      <AlertDialog
        open={pendingDeleteProvider !== null}
        onOpenChange={(open) => {
          if (open) return
          closeDeleteDialog()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('common.delete')}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDeleteProvider ? t('settings.providers.confirmDelete', { name: pendingDeleteProvider.name }) : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingProvider}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction asChild>
              <LoadingButton
                variant="destructive"
                loading={isDeletingProvider}
                onClick={(event) => {
                  event.preventDefault()
                  void confirmDelete()
                }}
              >
                {t('common.delete')}
              </LoadingButton>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

type SortableProviderCardProps = {
  item: ProviderListItem
  isActive: boolean
  dragLabel: string
  title: ReactNode
  subtitle: ReactNode
  badges?: ReactNode
  result?: ReactNode
  actions?: ReactNode
  details?: ReactNode
  onActivate?: () => void
}

function SortableProviderCard({
  item,
  isActive,
  dragLabel,
  title,
  subtitle,
  badges,
  result,
  actions,
  details,
  onActivate,
}: SortableProviderCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 20 : undefined,
  }

  return (
    <Card
      ref={setNodeRef}
      style={style}
      data-testid={providerItemTestId(item)}
      className={`group relative flex flex-col overflow-visible rounded-[8px] transition-colors ${
        isActive
          ? 'border-[var(--color-border-focus)] bg-[var(--color-surface-container-low)]'
          : 'border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface-hover)]'
      } ${isDragging ? 'shadow-[var(--shadow-dropdown)] opacity-90' : ''}`}
    >
      <div className="flex items-center gap-2 px-3 py-3">
        <IconButton
          {...attributes}
          {...listeners}
          label={dragLabel}
          tooltip={dragLabel}
          variant="ghost"
          className="h-8 w-8 cursor-grab rounded-[6px] text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-container-high)] hover:text-[var(--color-text-secondary)] active:cursor-grabbing"
          style={{ touchAction: 'none' }}
        >
          <GripVertical className="h-4 w-4" aria-hidden="true" />
        </IconButton>
        <ShadcnButton
          variant="ghost"
          onClick={onActivate}
          aria-disabled={!onActivate}
          disabled={!onActivate}
          className={`h-auto min-w-0 flex-1 items-center justify-start gap-3 rounded-[6px] px-0 py-0 text-left whitespace-normal disabled:opacity-100 ${
            onActivate ? 'cursor-pointer' : 'cursor-default'
          }`}
        >
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${isActive ? 'bg-[var(--color-success)]' : 'bg-[var(--color-text-tertiary)]'}`} />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{title}</span>
              {badges}
            </span>
            <span className="mt-0.5 block truncate text-xs text-[var(--color-text-tertiary)]">{subtitle}</span>
            {result}
          </span>
        </ShadcnButton>
        {actions && (
          <div className="flex shrink-0 items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
            {actions}
          </div>
        )}
      </div>
      {details}
    </Card>
  )
}

// ─── Provider Form Modal ──────────────────────────────────────

type ProviderFormProps = {
  open: boolean
  onClose: () => void
  mode: 'create' | 'edit'
  provider?: SavedProvider
  presets: ProviderPreset[]
}

function requirePreset(preset: ProviderPreset | undefined): ProviderPreset {
  if (!preset) {
    throw new Error('Provider presets are not configured')
  }
  return preset
}

const AUTO_COMPACT_WINDOW_ENV_KEY = 'CLAUDE_CODE_AUTO_COMPACT_WINDOW'
const MODEL_CONTEXT_WINDOWS_ENV_KEY = 'CLAUDE_CODE_MODEL_CONTEXT_WINDOWS'
const DISABLE_EXPERIMENTAL_BETAS_ENV_KEY = 'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS'
const MODEL_CONTEXT_WINDOW_MIN = 16000
const MODEL_CONTEXT_WINDOW_MAX = 10000000
const MODEL_1M_CONTEXT_WINDOW = 1000000
const MODEL_SLOTS = ['main', 'haiku', 'sonnet', 'opus'] as const
const DEFAULT_MODEL_1M_SUPPORT: Model1mSupport = {
  main: false,
  haiku: false,
  sonnet: false,
  opus: false,
}
const DEFAULT_PROVIDER_AUTH_STRATEGY: ProviderAuthStrategy = 'auth_token'
const AUTH_ENV_KEYS = new Set(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'])
type ModelSlot = typeof MODEL_SLOTS[number]
type ModelContextInputs = Record<ModelSlot, string>

function formatContextWindow(value: number): string {
  return value.toLocaleString('en-US')
}

function getPresetAutoCompactWindow(preset: ProviderPreset): string {
  return preset.defaultEnv?.[AUTO_COMPACT_WINDOW_ENV_KEY] ?? ''
}

function getPresetAuthStrategy(preset: ProviderPreset): ProviderAuthStrategy {
  return preset.authStrategy ?? DEFAULT_PROVIDER_AUTH_STRATEGY
}

function omitAuthEnv(env: Record<string, string> | undefined): Record<string, string> {
  if (!env) return {}
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => !AUTH_ENV_KEYS.has(key.toUpperCase())),
  )
}

function getProviderAuthValue(apiKey: string, preset: ProviderPreset): string {
  return apiKey || preset.defaultEnv?.ANTHROPIC_AUTH_TOKEN || preset.defaultEnv?.ANTHROPIC_API_KEY || (preset.needsApiKey ? '(your API key)' : '')
}

function buildSettingsJsonAuthEnv(
  apiFormat: ApiFormat,
  authStrategy: ProviderAuthStrategy,
  apiKey: string,
  preset: ProviderPreset,
): Record<string, string> {
  if (apiFormat !== 'anthropic') {
    return { ANTHROPIC_API_KEY: 'proxy-managed' }
  }

  const value = getProviderAuthValue(apiKey, preset)
  switch (authStrategy) {
    case 'api_key':
      return value ? { ANTHROPIC_API_KEY: value } : {}
    case 'auth_token':
      return value ? { ANTHROPIC_AUTH_TOKEN: value } : {}
    case 'auth_token_empty_api_key':
      return {
        ANTHROPIC_API_KEY: '',
        ...(value ? { ANTHROPIC_AUTH_TOKEN: value } : {}),
      }
    case 'dual_same_token':
      return value ? { ANTHROPIC_API_KEY: value, ANTHROPIC_AUTH_TOKEN: value } : {}
    case 'dual_dummy':
      return { ANTHROPIC_API_KEY: 'dummy', ANTHROPIC_AUTH_TOKEN: 'dummy' }
  }
}

function inferAuthStrategyFromEnv(env: Record<string, string>): ProviderAuthStrategy | null {
  if (env.ANTHROPIC_API_KEY === 'dummy' && env.ANTHROPIC_AUTH_TOKEN === 'dummy') return 'dual_dummy'
  if (env.ANTHROPIC_API_KEY === '' && env.ANTHROPIC_AUTH_TOKEN) return 'auth_token_empty_api_key'
  if (env.ANTHROPIC_API_KEY && env.ANTHROPIC_AUTH_TOKEN && env.ANTHROPIC_API_KEY === env.ANTHROPIC_AUTH_TOKEN) return 'dual_same_token'
  if (env.ANTHROPIC_AUTH_TOKEN) return 'auth_token'
  if (env.ANTHROPIC_API_KEY) return 'api_key'
  return null
}

function parseAutoCompactWindowInput(value: string): number | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed)) return undefined
  if (parsed < MODEL_CONTEXT_WINDOW_MIN || parsed > MODEL_CONTEXT_WINDOW_MAX) return undefined
  return parsed
}

function getAutoCompactWindowErrorKey(value: string): 'number' | 'range' | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed)) return 'number'
  if (parsed < MODEL_CONTEXT_WINDOW_MIN || parsed > MODEL_CONTEXT_WINDOW_MAX) return 'range'
  return null
}

function parseModelContextWindowsInput(value: string): number | undefined {
  return parseAutoCompactWindowInput(value)
}

function getModelContextWindowErrorKey(value: string): 'number' | 'range' | null {
  return getAutoCompactWindowErrorKey(value)
}

function getModelContextInputValue(
  model: string | undefined,
  preset: ProviderPreset,
  provider?: SavedProvider,
): string {
  const trimmedModel = model?.trim()
  if (!trimmedModel) return ''
  const value = provider?.modelContextWindows?.[trimmedModel] ?? preset.modelContextWindows?.[trimmedModel]
  return value !== undefined ? String(value) : ''
}

function getModelContextInputs(
  models: ModelMapping,
  preset: ProviderPreset,
  provider?: SavedProvider,
): ModelContextInputs {
  const inputs = {} as ModelContextInputs
  for (const slot of MODEL_SLOTS) {
    inputs[slot] = getModelContextInputValue(models[slot], preset, provider)
  }
  return inputs
}

function buildModelContextWindows(
  models: ModelMapping,
  inputs: ModelContextInputs,
): Record<string, number> {
  const windows: Record<string, number> = {}
  for (const slot of MODEL_SLOTS) {
    const model = models[slot]?.trim()
    const parsed = parseModelContextWindowsInput(inputs[slot])
    if (model && parsed !== undefined) {
      windows[model] = parsed
    }
  }
  return windows
}

function hasModel1mMarker(model: string): boolean {
  return /\[1m\]$/i.test(model.trim()) || /:1m$/i.test(model.trim())
}

function stripModel1mMarker(model: string): string {
  return model.trim().replace(/\[1m\]$/i, '').replace(/:1m$/i, '').trim()
}

function stripModel1mMarkers(models: ModelMapping): ModelMapping {
  return {
    main: stripModel1mMarker(models.main),
    ...(models.fable ? { fable: stripModel1mMarker(models.fable) } : {}),
    haiku: stripModel1mMarker(models.haiku),
    sonnet: stripModel1mMarker(models.sonnet),
    opus: stripModel1mMarker(models.opus),
  }
}

function getInitialModel1mSupport(
  models: ModelMapping,
  provider?: SavedProvider,
): Model1mSupport {
  return {
    main: provider?.model1mSupport?.main === true || hasModel1mMarker(models.main),
    haiku: provider?.model1mSupport?.haiku === true || hasModel1mMarker(models.haiku),
    sonnet: provider?.model1mSupport?.sonnet === true || hasModel1mMarker(models.sonnet),
    opus: provider?.model1mSupport?.opus === true || hasModel1mMarker(models.opus),
  }
}

function applyModel1mSupport(model: string, enabled: boolean): string {
  const stripped = stripModel1mMarker(model)
  return enabled && stripped ? `${stripped}[1m]` : stripped
}

function applyModel1mSupportMapping(
  models: ModelMapping,
  model1mSupport: Model1mSupport,
): ModelMapping {
  return {
    main: applyModel1mSupport(models.main, model1mSupport.main),
    ...(models.fable ? { fable: stripModel1mMarker(models.fable) } : {}),
    haiku: applyModel1mSupport(models.haiku, model1mSupport.haiku),
    sonnet: applyModel1mSupport(models.sonnet, model1mSupport.sonnet),
    opus: applyModel1mSupport(models.opus, model1mSupport.opus),
  }
}

function hasAnyModel1mSupport(model1mSupport: Model1mSupport): boolean {
  return MODEL_SLOTS.some((slot) => model1mSupport[slot])
}

function shouldFill1mContextWindow(value: string): boolean {
  const parsed = parseModelContextWindowsInput(value)
  return parsed === undefined || parsed < MODEL_1M_CONTEXT_WINDOW
}

function apply1mSupportToContextInput(
  inputs: ModelContextInputs,
  slot: ModelSlot,
  enabled: boolean,
): ModelContextInputs {
  if (!enabled || !shouldFill1mContextWindow(inputs[slot])) return inputs
  return { ...inputs, [slot]: String(MODEL_1M_CONTEXT_WINDOW) }
}

function apply1mSupportToContextInputs(
  inputs: ModelContextInputs,
  model1mSupport: Model1mSupport,
): ModelContextInputs {
  let nextInputs = inputs
  for (const slot of MODEL_SLOTS) {
    nextInputs = apply1mSupportToContextInput(nextInputs, slot, model1mSupport[slot])
  }
  return nextInputs
}

function normalizeModelMapping(models: ModelMapping): ModelMapping {
  const main = models.main.trim()
  return {
    main,
    ...(models.fable?.trim() ? { fable: models.fable.trim() } : {}),
    haiku: models.haiku.trim() || main,
    sonnet: models.sonnet.trim() || main,
    opus: models.opus.trim() || main,
  }
}

function readSettingsEnvString(env: Record<string, unknown>, key: string): string | undefined {
  const value = env[key]
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function readModelMappingFromSettingsEnv(env: Record<string, unknown>): Partial<ModelMapping> {
  const hasModelEnv = [
    'ANTHROPIC_MODEL',
    'ANTHROPIC_DEFAULT_FABLE_MODEL',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL',
    'ANTHROPIC_DEFAULT_SONNET_MODEL',
    'ANTHROPIC_DEFAULT_OPUS_MODEL',
  ].some((key) => Object.prototype.hasOwnProperty.call(env, key))
  const fable = readSettingsEnvString(env, 'ANTHROPIC_DEFAULT_FABLE_MODEL')
  const haiku = readSettingsEnvString(env, 'ANTHROPIC_DEFAULT_HAIKU_MODEL')
  const sonnet = readSettingsEnvString(env, 'ANTHROPIC_DEFAULT_SONNET_MODEL')
  const opus = readSettingsEnvString(env, 'ANTHROPIC_DEFAULT_OPUS_MODEL')
  const main = readSettingsEnvString(env, 'ANTHROPIC_MODEL') ?? sonnet ?? haiku ?? opus

  return {
    ...(main ? { main } : {}),
    ...(hasModelEnv ? { fable } : {}),
    ...(haiku ? { haiku } : {}),
    ...(sonnet ? { sonnet } : {}),
    ...(opus ? { opus } : {}),
  }
}

function applyToolSearchEnv(
  env: Record<string, unknown>,
  apiFormat: ApiFormat,
  toolSearchEnabled: boolean,
): void {
  delete env.ENABLE_TOOL_SEARCH
  if (apiFormat === 'anthropic') {
    env.ENABLE_TOOL_SEARCH = toolSearchEnabled ? 'true' : 'false'
  }
}

function applyDisableExperimentalBetasEnv(
  env: Record<string, unknown>,
  disableExperimentalBetas: boolean,
): void {
  if (disableExperimentalBetas) {
    env[DISABLE_EXPERIMENTAL_BETAS_ENV_KEY] = '1'
  } else {
    delete env[DISABLE_EXPERIMENTAL_BETAS_ENV_KEY]
  }
}

function updateSettingsJsonToolSearch(
  raw: string,
  apiFormat: ApiFormat,
  toolSearchEnabled: boolean,
): string {
  try {
    const parsed = JSON.parse(raw || '{}') as { env?: Record<string, unknown> }
    const existingEnv = parsed.env && typeof parsed.env === 'object' && !Array.isArray(parsed.env)
      ? parsed.env
      : {}
    const env = { ...existingEnv }
    applyToolSearchEnv(env, apiFormat, toolSearchEnabled)
    parsed.env = env
    return JSON.stringify(parsed, null, 2)
  } catch {
    return raw
  }
}

function updateSettingsJsonDisableExperimentalBetas(
  raw: string,
  disableExperimentalBetas: boolean,
): string {
  try {
    const parsed = JSON.parse(raw || '{}') as { env?: Record<string, unknown> }
    const existingEnv = parsed.env && typeof parsed.env === 'object' && !Array.isArray(parsed.env)
      ? parsed.env
      : {}
    const env = { ...existingEnv }
    applyDisableExperimentalBetasEnv(env, disableExperimentalBetas)
    parsed.env = env
    return JSON.stringify(parsed, null, 2)
  } catch {
    return raw
  }
}

function readToolSearchEnabledFromEnv(env: Record<string, unknown>): boolean {
  const value = env.ENABLE_TOOL_SEARCH
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['0', 'false', 'off', 'no'].includes(normalized)) return false
    if (['1', 'true', 'on', 'yes', 'auto'].includes(normalized) || normalized.startsWith('auto:')) {
      return true
    }
  }
  return true
}

function readDisableExperimentalBetasFromEnv(env: Record<string, unknown>): boolean {
  const value = env[DISABLE_EXPERIMENTAL_BETAS_ENV_KEY]
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['0', 'false', 'off', 'no'].includes(normalized)) return false
    if (['1', 'true', 'on', 'yes'].includes(normalized)) return true
  }
  return false
}

function updateSettingsJsonAutoCompactWindow(raw: string, value: string): string {
  try {
    const parsed = JSON.parse(raw || '{}') as { env?: Record<string, unknown> }
    const existingEnv = parsed.env && typeof parsed.env === 'object' && !Array.isArray(parsed.env)
      ? parsed.env
      : {}
    const env = { ...existingEnv }
    const trimmed = value.trim()
    if (trimmed) {
      env[AUTO_COMPACT_WINDOW_ENV_KEY] = trimmed
    } else {
      delete env[AUTO_COMPACT_WINDOW_ENV_KEY]
    }
    parsed.env = env
    return JSON.stringify(parsed, null, 2)
  } catch {
    return raw
  }
}

function updateSettingsJsonModelContextWindows(
  raw: string,
  modelContextWindows: Record<string, number>,
): string {
  try {
    const parsed = JSON.parse(raw || '{}') as { env?: Record<string, unknown> }
    const existingEnv = parsed.env && typeof parsed.env === 'object' && !Array.isArray(parsed.env)
      ? parsed.env
      : {}
    const env = { ...existingEnv }
    if (Object.keys(modelContextWindows).length > 0) {
      env[MODEL_CONTEXT_WINDOWS_ENV_KEY] = JSON.stringify(modelContextWindows)
    } else {
      delete env[MODEL_CONTEXT_WINDOWS_ENV_KEY]
    }
    parsed.env = env
    return JSON.stringify(parsed, null, 2)
  } catch {
    return raw
  }
}

function updateSettingsJsonModels(
  raw: string,
  models: ModelMapping,
  model1mSupport: Model1mSupport = DEFAULT_MODEL_1M_SUPPORT,
): string {
  try {
    const parsed = JSON.parse(raw || '{}') as { env?: Record<string, unknown> }
    const existingEnv = parsed.env && typeof parsed.env === 'object' && !Array.isArray(parsed.env)
      ? parsed.env
      : {}
    const runtimeModels = applyModel1mSupportMapping(models, model1mSupport)
    const env = { ...existingEnv }
    delete env.ANTHROPIC_DEFAULT_FABLE_MODEL
    delete env.ANTHROPIC_DEFAULT_FABLE_MODEL_DESCRIPTION
    delete env.ANTHROPIC_DEFAULT_FABLE_MODEL_NAME
    delete env.ANTHROPIC_DEFAULT_FABLE_MODEL_SUPPORTED_CAPABILITIES
    parsed.env = {
      ...env,
      ANTHROPIC_MODEL: runtimeModels.main,
      ...(runtimeModels.fable ? { ANTHROPIC_DEFAULT_FABLE_MODEL: runtimeModels.fable } : {}),
      ANTHROPIC_DEFAULT_HAIKU_MODEL: runtimeModels.haiku,
      ANTHROPIC_DEFAULT_SONNET_MODEL: runtimeModels.sonnet,
      ANTHROPIC_DEFAULT_OPUS_MODEL: runtimeModels.opus,
    }
    return JSON.stringify(parsed, null, 2)
  } catch {
    return raw
  }
}

function updateSettingsJsonProviderConnection(
  raw: string,
  apiFormat: ApiFormat,
  authStrategy: ProviderAuthStrategy,
  apiKey: string,
  preset: ProviderPreset,
  baseUrl: string,
  proxyBaseUrl: string,
  toolSearchEnabled = true,
  disableExperimentalBetas = false,
): string {
  try {
    const parsed = JSON.parse(raw || '{}') as { env?: Record<string, unknown> }
    const existingEnv = parsed.env && typeof parsed.env === 'object' && !Array.isArray(parsed.env)
      ? parsed.env
      : {}
    const env = { ...existingEnv }
    delete env.ANTHROPIC_API_KEY
    delete env.ANTHROPIC_AUTH_TOKEN
    applyToolSearchEnv(env, apiFormat, toolSearchEnabled)
    applyDisableExperimentalBetasEnv(env, disableExperimentalBetas)
    env.ANTHROPIC_BASE_URL = apiFormat !== 'anthropic' ? proxyBaseUrl : baseUrl
    Object.assign(env, buildSettingsJsonAuthEnv(apiFormat, authStrategy, apiKey, preset))
    parsed.env = env
    return JSON.stringify(parsed, null, 2)
  } catch {
    return raw
  }
}

function getProviderProxyBaseUrl(): string {
  return `${getBaseUrl().replace(/\/$/, '')}/proxy`
}

function buildFallbackPreset(provider?: SavedProvider): ProviderPreset {
  return {
    id: provider?.presetId ?? 'custom',
    name: provider?.name ?? 'Custom',
    baseUrl: provider?.baseUrl ?? '',
    apiFormat: provider?.apiFormat ?? 'anthropic',
    authStrategy: provider?.authStrategy,
    defaultModels: provider?.models ?? { main: '', haiku: '', sonnet: '', opus: '' },
    modelContextWindows: provider?.modelContextWindows,
    defaultEnv: provider?.autoCompactWindow !== undefined
      ? { [AUTO_COMPACT_WINDOW_ENV_KEY]: String(provider.autoCompactWindow) }
      : undefined,
    needsApiKey: true,
    websiteUrl: '',
  }
}

function openExternalUrl(url: string) {
  void getDesktopHost().shell.open(url)
    .catch(() => window.open(url, '_blank', 'noopener,noreferrer'))
}

function ProviderFormModal({ open, onClose, mode, provider, presets }: ProviderFormProps) {
  const { createProvider, updateProvider, testConfig } = useProviderStore()
  const fetchSettings = useSettingsStore((s) => s.fetchAll)
  const t = useTranslation()

  const fallbackPreset = buildFallbackPreset(provider)
  const loadedPresets = presets.filter((p) => p.id !== 'official')
  const availablePresets = loadedPresets.length > 0 ? loadedPresets : [fallbackPreset]
  const regularPresets = availablePresets.filter((p) => !p.featured)
  const featuredPresets = availablePresets.filter((p) => p.featured)
  const presetDefaultEnvKeys = useMemo(
    () => presets.flatMap((preset) => Object.keys(preset.defaultEnv ?? {})),
    [presets],
  )
  const initialPreset = provider
    ? availablePresets.find((p) => p.id === provider.presetId) ?? fallbackPreset
    : availablePresets[0] ?? fallbackPreset
  const initialModels = stripModel1mMarkers(provider?.models ?? initialPreset.defaultModels)
  const initialModel1mSupport = getInitialModel1mSupport(
    provider?.models ?? initialPreset.defaultModels,
    provider,
  )
  const initialModelContextInputs = apply1mSupportToContextInputs(
    getModelContextInputs(initialModels, initialPreset, provider),
    initialModel1mSupport,
  )

  const [selectedPreset, setSelectedPreset] = useState<ProviderPreset>(initialPreset)
  const [name, setName] = useState(provider?.name ?? initialPreset.name)
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? initialPreset.baseUrl)
  const [apiFormat, setApiFormat] = useState<ApiFormat>(provider?.apiFormat ?? initialPreset.apiFormat ?? 'anthropic')
  const [authStrategy, setAuthStrategy] = useState<ProviderAuthStrategy>(provider?.authStrategy ?? getPresetAuthStrategy(initialPreset))
  const [apiKey, setApiKey] = useState(provider?.apiKey ?? '')
  const [showApiKey, setShowApiKey] = useState(false)
  const [notes, setNotes] = useState(provider?.notes ?? '')
  const [models, setModels] = useState<ModelMapping>(initialModels)
  const [model1mSupport, setModel1mSupport] = useState<Model1mSupport>(initialModel1mSupport)
  const [modelContextInputs, setModelContextInputs] = useState<ModelContextInputs>(initialModelContextInputs)
  const [autoCompactWindow, setAutoCompactWindow] = useState(
    provider?.autoCompactWindow !== undefined
      ? String(provider.autoCompactWindow)
      : getPresetAutoCompactWindow(initialPreset),
  )
  const [toolSearchEnabled, setToolSearchEnabled] = useState(provider?.toolSearchEnabled ?? true)
  const [disableExperimentalBetas, setDisableExperimentalBetas] = useState(provider?.disableExperimentalBetas ?? false)
  const [showContextSettings, setShowContextSettings] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null)
  const [isTesting, setIsTesting] = useState(false)
  const [settingsJson, setSettingsJson] = useState('')
  const [settingsJsonError, setSettingsJsonError] = useState<string | null>(null)
  const jsonPastedRef = useRef(false)
  const providerProxyBaseUrl = useMemo(() => getProviderProxyBaseUrl(), [])

  // Load current settings.json and merge provider env vars
  useEffect(() => {
    // Skip if JSON was just populated by user paste
    if (jsonPastedRef.current) {
      jsonPastedRef.current = false
      return
    }
    import('../api/providers').then(({ providersApi }) => {
      providersApi.getSettings().then((settings) => {
        const needsProxy = apiFormat !== 'anthropic'
        const autoCompactWindowEnv = autoCompactWindow.trim()
        const modelContextWindows = buildModelContextWindows(models, modelContextInputs)
        const normalizedModels = normalizeModelMapping(models)
        const runtimeModels = applyModel1mSupportMapping(normalizedModels, model1mSupport)
        const existingEnv = (settings.env as Record<string, string>) || {}
        const cleanedEnv = stripProviderSettingsJsonEnv(existingEnv, presetDefaultEnvKeys)
        const mergedEnv: Record<string, unknown> = {
          ...cleanedEnv,
          ...omitAuthEnv(selectedPreset.defaultEnv),
          ...(autoCompactWindowEnv ? { [AUTO_COMPACT_WINDOW_ENV_KEY]: autoCompactWindowEnv } : {}),
          ...(Object.keys(modelContextWindows).length > 0
            ? { [MODEL_CONTEXT_WINDOWS_ENV_KEY]: JSON.stringify(modelContextWindows) }
            : {}),
          ANTHROPIC_BASE_URL: needsProxy ? providerProxyBaseUrl : baseUrl,
          ...buildSettingsJsonAuthEnv(apiFormat, authStrategy, apiKey, selectedPreset),
          ANTHROPIC_MODEL: runtimeModels.main,
          ...(runtimeModels.fable ? { ANTHROPIC_DEFAULT_FABLE_MODEL: runtimeModels.fable } : {}),
          ANTHROPIC_DEFAULT_HAIKU_MODEL: runtimeModels.haiku,
          ANTHROPIC_DEFAULT_SONNET_MODEL: runtimeModels.sonnet,
          ANTHROPIC_DEFAULT_OPUS_MODEL: runtimeModels.opus,
        }
        applyToolSearchEnv(mergedEnv, apiFormat, toolSearchEnabled)
        applyDisableExperimentalBetasEnv(mergedEnv, disableExperimentalBetas)
        const merged = {
          ...settings,
          skipWebFetchPreflight: settings.skipWebFetchPreflight ?? true,
          env: mergedEnv,
        }
        setSettingsJson(JSON.stringify(merged, null, 2))
      }).catch(() => {
        setSettingsJson(JSON.stringify({}, null, 2))
      })
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPreset.id, providerProxyBaseUrl])

  const handlePresetChange = (preset: ProviderPreset) => {
    setSelectedPreset(preset)
    setName(preset.name)
    setBaseUrl(preset.baseUrl)
    setApiFormat(preset.apiFormat ?? 'anthropic')
    setAuthStrategy(getPresetAuthStrategy(preset))
    const nextModels = stripModel1mMarkers(preset.defaultModels)
    const nextModel1mSupport = getInitialModel1mSupport(preset.defaultModels)
    const nextModelContextInputs = apply1mSupportToContextInputs(
      getModelContextInputs(nextModels, preset),
      nextModel1mSupport,
    )
    setModels(nextModels)
    setModel1mSupport(nextModel1mSupport)
    setModelContextInputs(nextModelContextInputs)
    setAutoCompactWindow(getPresetAutoCompactWindow(preset))
    setToolSearchEnabled(true)
    setDisableExperimentalBetas(false)
    setShowContextSettings(false)
    setTestResult(null)
  }

  const isCustom = selectedPreset.id === 'custom'
  const requiresApiKey = selectedPreset.needsApiKey !== false
  const autoCompactWindowErrorKey = getAutoCompactWindowErrorKey(autoCompactWindow)
  const modelContextWindowErrorSlots = MODEL_SLOTS.filter((slot) => getModelContextWindowErrorKey(modelContextInputs[slot]))
  const canSubmit = name.trim() && baseUrl.trim() && (mode === 'edit' || !requiresApiKey || apiKey.trim()) && models.main.trim() && !settingsJsonError && !autoCompactWindowErrorKey && modelContextWindowErrorSlots.length === 0
  const apiKeyUrl = selectedPreset.apiKeyUrl?.trim()
  const promoText = selectedPreset.promoText?.trim()
  const displayedSettingsJson = showApiKey
    ? settingsJson
    : maskSettingsJsonSecrets(settingsJson)
  const apiFormatItems = [
    {
      value: 'anthropic' as const,
      label: t('settings.providers.apiFormatAnthropic'),
      icon: <span className="material-symbols-outlined text-[17px]">hub</span>,
    },
    {
      value: 'openai_chat' as const,
      label: t('settings.providers.apiFormatOpenaiChat'),
      icon: <span className="material-symbols-outlined text-[17px]">forum</span>,
    },
    {
      value: 'openai_responses' as const,
      label: t('settings.providers.apiFormatOpenaiResponses'),
      icon: <span className="material-symbols-outlined text-[17px]">route</span>,
    },
  ]
  const selectedApiFormatLabel = apiFormatItems.find((item) => item.value === apiFormat)?.label ?? t('settings.providers.apiFormatAnthropic')
  const authStrategyItems = [
    {
      value: 'auth_token' as const,
      label: t('settings.providers.authStrategyAuthToken'),
      description: t('settings.providers.authStrategyAuthTokenDesc'),
      icon: <span className="material-symbols-outlined text-[17px]">key</span>,
    },
    {
      value: 'auth_token_empty_api_key' as const,
      label: t('settings.providers.authStrategyAuthTokenEmptyApiKey'),
      description: t('settings.providers.authStrategyAuthTokenEmptyApiKeyDesc'),
      icon: <span className="material-symbols-outlined text-[17px]">key_off</span>,
    },
    {
      value: 'api_key' as const,
      label: t('settings.providers.authStrategyApiKey'),
      description: t('settings.providers.authStrategyApiKeyDesc'),
      icon: <span className="material-symbols-outlined text-[17px]">vpn_key</span>,
    },
    {
      value: 'dual_same_token' as const,
      label: t('settings.providers.authStrategyDualSameToken'),
      description: t('settings.providers.authStrategyDualSameTokenDesc'),
      icon: <span className="material-symbols-outlined text-[17px]">sync_alt</span>,
    },
    {
      value: 'dual_dummy' as const,
      label: t('settings.providers.authStrategyDualDummy'),
      description: t('settings.providers.authStrategyDualDummyDesc'),
      icon: <span className="material-symbols-outlined text-[17px]">construction</span>,
    },
  ] satisfies Array<{ value: ProviderAuthStrategy; label: string; description: string; icon: ReactNode }>
  const selectedAuthStrategyLabel = authStrategyItems.find((item) => item.value === authStrategy)?.label ?? t('settings.providers.authStrategyAuthToken')
  const toolSearchUnsupported = apiFormat !== 'anthropic'
  const toolSearchDescription = toolSearchUnsupported
    ? t('settings.providers.toolSearchUnsupported')
    : t('settings.providers.toolSearchDesc')
  const configuredContextWindows = buildModelContextWindows(models, modelContextInputs)
  const configuredContextSummary = Object.entries(configuredContextWindows)
    .filter(([model], index, entries) => entries.findIndex(([candidate]) => candidate === model) === index)
    .map(([model, value]) => `${model}: ${formatContextWindow(value)}`)
  const parsedFallbackContextWindow = parseAutoCompactWindowInput(autoCompactWindow)
  const fallbackContextSummary = parsedFallbackContextWindow !== undefined
    ? t('settings.providers.contextFallbackSummary', {
      tokens: formatContextWindow(parsedFallbackContextWindow),
    })
    : t('settings.providers.contextFallbackAuto')
  const contextSummary = configuredContextSummary.length > 0
    ? [...configuredContextSummary, fallbackContextSummary].join(' · ')
    : t('settings.providers.contextSummaryAuto')
  const shouldShowContextFields = showContextSettings || modelContextWindowErrorSlots.length > 0 || !!autoCompactWindowErrorKey
  const testPassed = !!testResult?.connectivity.success && (testResult.proxy?.success ?? true)
  const handleAutoCompactWindowChange = (value: string) => {
    setAutoCompactWindow(value)
    setSettingsJson((current) => updateSettingsJsonAutoCompactWindow(current, value))
  }
  const handleBaseUrlChange = (value: string) => {
    setBaseUrl(value)
    setSettingsJson((current) => updateSettingsJsonProviderConnection(current, apiFormat, authStrategy, apiKey, selectedPreset, value, providerProxyBaseUrl, toolSearchEnabled, disableExperimentalBetas))
  }
  const handleApiKeyChange = (value: string) => {
    setApiKey(value)
    setSettingsJson((current) => updateSettingsJsonProviderConnection(current, apiFormat, authStrategy, value, selectedPreset, baseUrl, providerProxyBaseUrl, toolSearchEnabled, disableExperimentalBetas))
  }
  const handleApiFormatChange = (value: ApiFormat) => {
    setApiFormat(value)
    setSettingsJson((current) => updateSettingsJsonProviderConnection(current, value, authStrategy, apiKey, selectedPreset, baseUrl, providerProxyBaseUrl, toolSearchEnabled, disableExperimentalBetas))
  }
  const handleAuthStrategyChange = (value: ProviderAuthStrategy) => {
    setAuthStrategy(value)
    setSettingsJson((current) => updateSettingsJsonProviderConnection(current, apiFormat, value, apiKey, selectedPreset, baseUrl, providerProxyBaseUrl, toolSearchEnabled, disableExperimentalBetas))
  }
  const handleToolSearchToggle = (enabled: boolean) => {
    if (toolSearchUnsupported) return
    setToolSearchEnabled(enabled)
    setSettingsJson((current) => updateSettingsJsonToolSearch(current, apiFormat, enabled))
  }
  const handleDisableExperimentalBetasToggle = (disabled: boolean) => {
    setDisableExperimentalBetas(disabled)
    setSettingsJson((current) => updateSettingsJsonDisableExperimentalBetas(current, disabled))
  }
  const handleModelChange = (slot: ModelSlot, value: string) => {
    const hasMarker = hasModel1mMarker(value)
    const nextModels = { ...models, [slot]: stripModel1mMarker(value) }
    const nextModel1mSupport = hasMarker
      ? { ...model1mSupport, [slot]: true }
      : model1mSupport
    const nextInputs = {
      ...modelContextInputs,
      [slot]: getModelContextInputValue(nextModels[slot], selectedPreset, provider),
    }
    const nextInputsWith1mSupport = apply1mSupportToContextInput(
      nextInputs,
      slot,
      nextModel1mSupport[slot],
    )
    setModels(nextModels)
    setModel1mSupport(nextModel1mSupport)
    setModelContextInputs(nextInputsWith1mSupport)
    setSettingsJson((current) => updateSettingsJsonModelContextWindows(
      updateSettingsJsonModels(current, normalizeModelMapping(nextModels), nextModel1mSupport),
      buildModelContextWindows(nextModels, nextInputsWith1mSupport),
    ))
  }
  const handleModel1mSupportChange = (slot: ModelSlot, enabled: boolean) => {
    const nextModel1mSupport = { ...model1mSupport, [slot]: enabled }
    const nextInputs = apply1mSupportToContextInput(modelContextInputs, slot, enabled)
    setModel1mSupport(nextModel1mSupport)
    setModelContextInputs(nextInputs)
    setSettingsJson((current) => updateSettingsJsonModelContextWindows(
      updateSettingsJsonModels(current, normalizeModelMapping(models), nextModel1mSupport),
      buildModelContextWindows(models, nextInputs),
    ))
  }
  const handleModelContextWindowChange = (slot: ModelSlot, value: string) => {
    const nextInputs = { ...modelContextInputs, [slot]: value }
    setModelContextInputs(nextInputs)
    setSettingsJson((current) => updateSettingsJsonModelContextWindows(
      current,
      buildModelContextWindows(models, nextInputs),
    ))
  }
  const renderPresetButton = (preset: ProviderPreset) => (
    <ShadcnButton
      key={preset.id}
      type="button"
      variant="outline"
      size="sm"
      onClick={() => handlePresetChange(preset)}
      aria-pressed={selectedPreset.id === preset.id}
      className={`rounded-full ${
        selectedPreset.id === preset.id
          ? 'border-[var(--color-brand)] bg-[var(--color-surface-container-high)] text-[var(--color-brand)] shadow-[var(--shadow-focus-ring)]'
          : ''
      }`}
    >
      {preset.name}
    </ShadcnButton>
  )

  const handleSubmit = async () => {
    if (!canSubmit || isSubmitting) return
    const normalizedModels = normalizeModelMapping(models)
    const parsedAutoCompactWindow = parseAutoCompactWindowInput(autoCompactWindow)
    const parsedModelContextWindows = buildModelContextWindows(models, modelContextInputs)
    const storedModel1mSupport = hasAnyModel1mSupport(model1mSupport)
      ? model1mSupport
      : undefined
    setIsSubmitting(true)
    try {
      // Write the edited cc-haha settings.json first so provider-specific model
      // settings never conflict with the user's global ~/.claude/settings.json.
      if (settingsJson.trim()) {
        try {
          const parsed = restoreSettingsJsonSecrets(JSON.parse(settingsJson), settingsJson, apiKey)
          const { providersApi } = await import('../api/providers')
          await providersApi.updateSettings(parsed)
        } catch {
          // JSON validation already prevents this
        }
      }

      if (mode === 'create') {
        await createProvider({
          presetId: selectedPreset.id,
          name: name.trim(),
          apiKey: apiKey.trim(),
          authStrategy,
          baseUrl: baseUrl.trim(),
          apiFormat,
          models: normalizedModels,
          ...(storedModel1mSupport !== undefined && { model1mSupport: storedModel1mSupport }),
          ...(parsedAutoCompactWindow !== undefined && { autoCompactWindow: parsedAutoCompactWindow }),
          ...(Object.keys(parsedModelContextWindows).length > 0 && { modelContextWindows: parsedModelContextWindows }),
          toolSearchEnabled,
          ...(disableExperimentalBetas && { disableExperimentalBetas }),
          notes: notes.trim() || undefined,
        })
      } else if (provider) {
        const input: UpdateProviderInput = {
          name: name.trim(),
          baseUrl: baseUrl.trim(),
          authStrategy,
          apiFormat,
          models: normalizedModels,
          model1mSupport: storedModel1mSupport ?? null,
          autoCompactWindow: parsedAutoCompactWindow ?? null,
          modelContextWindows: Object.keys(parsedModelContextWindows).length > 0
            ? parsedModelContextWindows
            : null,
          toolSearchEnabled,
          disableExperimentalBetas,
          notes: notes.trim() || undefined,
        }
        if (apiKey.trim()) input.apiKey = apiKey.trim()
        await updateProvider(provider.id, input)
      }
      await fetchSettings()
      onClose()
    } catch (err) {
      console.error('Failed to save provider:', err)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleClose = () => {
    if (isSubmitting) return
    onClose()
  }

  const handleTest = async () => {
    if (!baseUrl.trim() || !models.main.trim()) return
    setIsTesting(true)
    setTestResult(null)
    try {
      let result: ProviderTestResult
      if (mode === 'edit' && provider && !apiKey.trim()) {
        result = await useProviderStore.getState().testProvider(provider.id, {
          baseUrl: baseUrl.trim(),
          modelId: models.main.trim(),
          apiFormat,
          authStrategy,
        })
      } else {
        if (requiresApiKey && !apiKey.trim()) return
        result = await testConfig({
          baseUrl: baseUrl.trim(),
          apiKey: apiKey.trim() || selectedPreset.defaultEnv?.ANTHROPIC_AUTH_TOKEN || 'local',
          modelId: models.main.trim(),
          authStrategy,
          apiFormat,
        })
      }
      setTestResult(result)
    } catch {
      setTestResult({ connectivity: { success: false, latencyMs: 0, error: t('settings.providers.requestFailed') } })
    } finally {
      setIsTesting(false)
    }
  }

  const handleSettingsJsonChange = (raw: string) => {
    try {
      const parsed = restoreSettingsJsonSecrets(JSON.parse(raw), settingsJson, apiKey)
      setSettingsJson(JSON.stringify(parsed, null, 2))
      setSettingsJsonError(null)
      const env = parsed.env as Record<string, string> | undefined
      if (!env) return

      if (env.ANTHROPIC_BASE_URL) {
        setBaseUrl(env.ANTHROPIC_BASE_URL)
        if (mode === 'create') {
          const matchedPreset = availablePresets.find(
            (preset) => preset.id !== 'custom' && preset.baseUrl === env.ANTHROPIC_BASE_URL,
          )
          const targetPreset = requirePreset(
            matchedPreset ?? availablePresets.find((preset) => preset.id === 'custom'),
          )
          if (targetPreset.id !== selectedPreset.id) {
            jsonPastedRef.current = true
            setSelectedPreset(targetPreset)
          }
        }
      }

      const nextApiKey = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY
      if (
        nextApiKey
        && nextApiKey !== '(your API key)'
        && nextApiKey !== API_KEY_JSON_PLACEHOLDER
      ) {
        setApiKey(nextApiKey)
      }
      const nextAuthStrategy = inferAuthStrategyFromEnv(env)
      if (nextAuthStrategy) setAuthStrategy(nextAuthStrategy)
      setToolSearchEnabled(readToolSearchEnabledFromEnv(env))
      setDisableExperimentalBetas(readDisableExperimentalBetasFromEnv(env))
      setAutoCompactWindow(
        env[AUTO_COMPACT_WINDOW_ENV_KEY] !== undefined
          ? String(env[AUTO_COMPACT_WINDOW_ENV_KEY])
          : '',
      )

      let parsedContextWindows: Record<string, number> = {}
      if (typeof env[MODEL_CONTEXT_WINDOWS_ENV_KEY] === 'string') {
        try {
          const parsedContext = JSON.parse(
            env[MODEL_CONTEXT_WINDOWS_ENV_KEY],
          ) as Record<string, unknown>
          parsedContextWindows = Object.fromEntries(
            Object.entries(parsedContext)
              .filter(([, value]) => typeof value === 'number' && Number.isInteger(value)),
          ) as Record<string, number>
        } catch {
          parsedContextWindows = {}
        }
      }

      const newModels = readModelMappingFromSettingsEnv(env)
      if (Object.keys(newModels).length > 0) {
        setModels((previousModels) => {
          const mergedModels = { ...previousModels, ...newModels }
          const nextModel1mSupport = {
            main: hasModel1mMarker(mergedModels.main),
            haiku: hasModel1mMarker(mergedModels.haiku),
            sonnet: hasModel1mMarker(mergedModels.sonnet),
            opus: hasModel1mMarker(mergedModels.opus),
          }
          const nextModels = stripModel1mMarkers(mergedModels)
          setModel1mSupport(nextModel1mSupport)
          setModelContextInputs(apply1mSupportToContextInputs(
            getModelContextInputs(nextModels, {
              ...selectedPreset,
              modelContextWindows: parsedContextWindows,
            }),
            nextModel1mSupport,
          ))
          return nextModels
        })
      } else if (Object.keys(parsedContextWindows).length > 0) {
        setModelContextInputs(getModelContextInputs(models, {
          ...selectedPreset,
          modelContextWindows: parsedContextWindows,
        }))
      }
    } catch (error) {
      setSettingsJson(raw)
      setSettingsJsonError(error instanceof Error ? error.message : 'Invalid JSON')
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) handleClose()
      }}
    >
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="flex max-h-[85vh] w-[min(92vw,720px)] flex-col gap-0 overflow-hidden p-0"
        onEscapeKeyDown={(event) => {
          if (isSubmitting) event.preventDefault()
        }}
        onInteractOutside={(event) => {
          if (isSubmitting) event.preventDefault()
        }}
      >
        <DialogHeader className="flex-row items-center justify-between px-6 pb-4 pt-6">
          <DialogTitle>
            {mode === 'create'
              ? t('settings.providers.addTitle')
              : t('settings.providers.editTitle')}
          </DialogTitle>
          <DialogClose asChild>
            <ShadcnButton
              variant="ghost"
              size="icon"
              disabled={isSubmitting}
              aria-label="Close dialog"
              className="rounded-full"
            >
              <X aria-hidden="true" />
            </ShadcnButton>
          </DialogClose>
        </DialogHeader>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 pb-4">
          {mode === 'create' && (
            <div data-slot="provider-presets">
              <Label className="mb-2">{t('settings.providers.preset')}</Label>
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap gap-2">
                  {regularPresets.map(renderPresetButton)}
                </div>
                {featuredPresets.length > 0 && (
                  <div className="flex flex-wrap gap-2 border-t border-[var(--color-border)]/60 pt-2">
                    {featuredPresets.map(renderPresetButton)}
                  </div>
                )}
              </div>
            </div>
          )}

          <SettingField
            id="provider-name"
            label={t('settings.providers.name')}
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('settings.providers.namePlaceholder')}
          />

          <SettingField
            id="provider-notes"
            label={t('settings.providers.notes')}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder={t('settings.providers.notesPlaceholder')}
          />

          <SettingField
            id="provider-base-url"
            label={t('settings.providers.baseUrl')}
            required
            value={baseUrl}
            onChange={(event) => handleBaseUrlChange(event.target.value)}
            placeholder={t('settings.providers.baseUrlPlaceholder')}
          />

          {(isCustom || mode === 'edit') ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="provider-api-format">
                {t('settings.providers.apiFormat')}
              </Label>
              <Select
                value={apiFormat}
                onValueChange={(value) => handleApiFormatChange(value as ApiFormat)}
              >
                <SelectTrigger
                  id="provider-api-format"
                  aria-label={t('settings.providers.apiFormat')}
                >
                  <SelectValue>{selectedApiFormatLabel}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {apiFormatItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      <span className="inline-flex items-center gap-2">
                        {item.icon}
                        <span>{item.label}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {apiFormat !== 'anthropic' && (
                <p className="text-[11px] text-[var(--color-text-tertiary)]">
                  {t('settings.providers.proxyHint')}
                </p>
              )}
            </div>
          ) : apiFormat !== 'anthropic' ? (
            <div className="flex flex-col gap-1.5">
              <Label>{t('settings.providers.apiFormat')}</Label>
              <Badge variant="outline" className="min-h-9 w-full justify-start px-3">
                {apiFormat === 'openai_chat'
                  ? t('settings.providers.apiFormatOpenaiChat')
                  : t('settings.providers.apiFormatOpenaiResponses')}
              </Badge>
            </div>
          ) : null}

          {apiFormat === 'anthropic' && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="provider-auth-strategy">
                {t('settings.providers.authStrategy')}
              </Label>
              <Select
                value={authStrategy}
                onValueChange={(value) => (
                  handleAuthStrategyChange(value as ProviderAuthStrategy)
                )}
              >
                <SelectTrigger
                  id="provider-auth-strategy"
                  aria-label={t('settings.providers.authStrategy')}
                >
                  <SelectValue>{selectedAuthStrategyLabel}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {authStrategyItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      <span className="inline-flex items-center gap-2">
                        {item.icon}
                        <span>{item.label}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] leading-5 text-[var(--color-text-tertiary)]">
                {authStrategyItems.find((item) => item.value === authStrategy)?.description}
              </p>
            </div>
          )}

          <Card
            className={`flex items-start gap-3 p-3 ${
              toolSearchUnsupported
                ? 'opacity-70'
                : 'transition-colors hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface-hover)]'
            }`}
          >
            <Checkbox
              id="provider-tool-search"
              checked={toolSearchEnabled && !toolSearchUnsupported}
              disabled={toolSearchUnsupported}
              onCheckedChange={(checked) => handleToolSearchToggle(checked === true)}
              aria-label={t('settings.providers.toolSearchEnabled')}
              className="mt-0.5"
            />
            <Label
              htmlFor="provider-tool-search"
              className={toolSearchUnsupported ? 'cursor-not-allowed' : 'cursor-pointer'}
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium">
                  {t('settings.providers.toolSearchEnabled')}
                </span>
                <span className="mt-1 block text-xs font-normal leading-5 text-[var(--color-text-tertiary)]">
                  {toolSearchDescription}
                </span>
              </span>
            </Label>
          </Card>

          <Card className="flex items-start gap-3 p-3 transition-colors hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface-hover)]">
            <Checkbox
              id="provider-disable-betas"
              checked={disableExperimentalBetas}
              onCheckedChange={(checked) => (
                handleDisableExperimentalBetasToggle(checked === true)
              )}
              aria-label={t('settings.providers.disableExperimentalBetas')}
              className="mt-0.5"
            />
            <Label htmlFor="provider-disable-betas" className="cursor-pointer">
              <span className="min-w-0">
                <span className="block text-sm font-medium">
                  {t('settings.providers.disableExperimentalBetas')}
                </span>
                <span className="mt-1 block text-xs font-normal leading-5 text-[var(--color-text-tertiary)]">
                  {t('settings.providers.disableExperimentalBetasDesc')}
                </span>
              </span>
            </Label>
          </Card>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="provider-api-key">
              {t('settings.providers.apiKey')}
              {mode === 'create' && requiresApiKey && (
                <span className="text-[var(--color-error)]">*</span>
              )}
            </Label>
            <div className="relative">
              <ShadcnInput
                id="provider-api-key"
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(event) => handleApiKeyChange(event.target.value)}
                placeholder="sk-..."
                className="pr-10"
              />
              <IconButton
                type="button"
                variant="ghost"
                size="icon-sm"
                label={showApiKey ? 'Hide API Key' : 'Show API Key'}
                onClick={() => setShowApiKey((visible) => !visible)}
                className="absolute right-1.5 top-1/2 -translate-y-1/2"
              >
                {showApiKey
                  ? <EyeOff aria-hidden="true" />
                  : <Eye aria-hidden="true" />}
              </IconButton>
            </div>
          </div>

          {(apiKeyUrl || promoText) && (
            <div className="-mt-2 flex flex-col gap-2">
              {apiKeyUrl && (
                <ShadcnButton
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => openExternalUrl(apiKeyUrl)}
                  className="w-fit text-[var(--color-brand)]"
                >
                  <KeyRound aria-hidden="true" />
                  {t('settings.providers.getApiKey')}
                  <ExternalLink aria-hidden="true" />
                </ShadcnButton>
              )}
              {promoText && (
                apiKeyUrl ? (
                  <ShadcnButton
                    type="button"
                    variant="outline"
                    onClick={() => openExternalUrl(apiKeyUrl)}
                    className="h-auto w-full justify-start whitespace-normal border-[var(--color-brand)]/25 bg-[var(--color-brand)]/8 px-3 py-2 text-left text-xs font-normal leading-5"
                  >
                    <Lightbulb className="mt-0.5 self-start text-[var(--color-brand)]" aria-hidden="true" />
                    <span className="flex-1">{promoText}</span>
                    <ExternalLink className="self-start text-[var(--color-brand)]" aria-hidden="true" />
                  </ShadcnButton>
                ) : (
                  <Alert>
                    <AlertDescription>{promoText}</AlertDescription>
                  </Alert>
                )
              )}
            </div>
          )}

          <div>
            <Label className="mb-2">{t('settings.providers.modelMapping')}</Label>
            <div className="grid grid-cols-2 gap-3">
              {MODEL_SLOTS.map((slot) => {
                const labelKey = slot === 'main'
                  ? 'settings.providers.mainModel'
                  : slot === 'haiku'
                    ? 'settings.providers.haikuModel'
                    : slot === 'sonnet'
                      ? 'settings.providers.sonnetModel'
                      : 'settings.providers.opusModel'
                const label = t(labelKey)
                const checkboxId = `provider-model-1m-${slot}`
                return (
                  <div key={slot} className="min-w-0">
                    <SettingField
                      id={`provider-model-${slot}`}
                      label={label}
                      required={slot === 'main'}
                      value={models[slot]}
                      onChange={(event) => handleModelChange(slot, event.target.value)}
                      placeholder={
                        slot === 'main'
                          ? t('settings.providers.modelIdPlaceholder')
                          : t('settings.providers.sameAsMain')
                      }
                    />
                    <div className="mt-1 flex h-6 items-center gap-1.5 px-1">
                      <Checkbox
                        id={checkboxId}
                        checked={model1mSupport[slot]}
                        onCheckedChange={(checked) => (
                          handleModel1mSupportChange(slot, checked === true)
                        )}
                        aria-label={`1M support: ${slot}`}
                        className="size-3.5"
                      />
                      <Label
                        htmlFor={checkboxId}
                        className="cursor-pointer text-xs font-normal text-[var(--color-text-secondary)]"
                      >
                        {t('settings.providers.model1mSupportShort')}
                      </Label>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <Collapsible
            open={shouldShowContextFields}
            onOpenChange={setShowContextSettings}
          >
            <Card className="overflow-hidden">
              <CollapsibleTrigger asChild>
                <ShadcnButton
                  type="button"
                  variant="ghost"
                  className="h-auto w-full items-start justify-start rounded-none px-3 py-3 text-left"
                >
                  <Shrink className="mt-0.5 text-[var(--color-brand)]" aria-hidden="true" />
                  <span className="min-w-0 flex-1 whitespace-normal">
                    <span className="block text-sm font-medium">
                      {t('settings.providers.contextSettingsTitle')}
                    </span>
                    <span className="mt-1 block truncate text-xs font-normal text-[var(--color-text-secondary)]">
                      {contextSummary}
                    </span>
                    <span className="mt-1 block text-[11px] font-normal leading-5 text-[var(--color-text-tertiary)]">
                      {t('settings.providers.contextSettingsDesc')}
                    </span>
                  </span>
                  <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-[var(--color-brand)]">
                    {shouldShowContextFields
                      ? t('settings.providers.contextSettingsHide')
                      : t('settings.providers.contextSettingsEdit')}
                    {shouldShowContextFields
                      ? <ChevronUp aria-hidden="true" />
                      : <ChevronDown aria-hidden="true" />}
                  </span>
                </ShadcnButton>
              </CollapsibleTrigger>

              <CollapsibleContent className="border-t border-[var(--color-border)] px-3 pb-3 pt-3">
                <Label className="mb-2">
                  {t('settings.providers.modelContextWindows')}
                </Label>
                <div className="grid grid-cols-2 gap-3">
                  {MODEL_SLOTS.map((slot) => {
                    const errorKey = getModelContextWindowErrorKey(modelContextInputs[slot])
                    const labelKey = slot === 'main'
                      ? 'settings.providers.mainContextWindow'
                      : slot === 'haiku'
                        ? 'settings.providers.haikuContextWindow'
                        : slot === 'sonnet'
                          ? 'settings.providers.sonnetContextWindow'
                          : 'settings.providers.opusContextWindow'
                    const error = errorKey === 'number'
                      ? t('settings.providers.modelContextWindowNumberError')
                      : errorKey === 'range'
                        ? t('settings.providers.modelContextWindowRangeError')
                        : undefined
                    return (
                      <SettingField
                        key={slot}
                        id={`provider-context-${slot}`}
                        label={t(labelKey)}
                        value={modelContextInputs[slot]}
                        onChange={(event) => (
                          handleModelContextWindowChange(slot, event.target.value)
                        )}
                        placeholder={t('settings.providers.contextWindowPlaceholder')}
                        error={error}
                        inputMode="numeric"
                      />
                    )
                  })}
                </div>
                <p className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">
                  {t('settings.providers.modelContextWindowsDesc')}
                </p>

                <div className="mt-3">
                  <SettingField
                    id="provider-auto-compact-window"
                    label={t('settings.providers.autoCompactWindow')}
                    value={autoCompactWindow}
                    onChange={(event) => handleAutoCompactWindowChange(event.target.value)}
                    placeholder={t('settings.providers.autoCompactWindowPlaceholder')}
                    inputMode="numeric"
                    error={
                      autoCompactWindowErrorKey === 'number'
                        ? t('settings.providers.autoCompactWindowNumberError')
                        : autoCompactWindowErrorKey === 'range'
                          ? t('settings.providers.autoCompactWindowRangeError')
                          : undefined
                    }
                  />
                </div>
                {!autoCompactWindowErrorKey && (
                  <p className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">
                    {t('settings.providers.autoCompactWindowDesc')}
                  </p>
                )}
              </CollapsibleContent>
            </Card>
          </Collapsible>

          <div className="flex flex-col gap-2">
            <LoadingButton
              variant="secondary"
              size="sm"
              loading={isTesting}
              onClick={() => void handleTest()}
              disabled={!baseUrl.trim() || !models.main.trim()}
              className="w-fit"
            >
              {t('settings.providers.testConnection')}
            </LoadingButton>
            {testResult && (
              <Alert
                variant={testPassed ? 'default' : 'destructive'}
                className={
                  testPassed
                    ? 'border-[var(--color-success)]/35 bg-[var(--color-success)]/8'
                    : undefined
                }
              >
                <AlertDescription
                  className={
                    testPassed
                      ? 'text-[var(--color-success)]'
                      : 'text-[var(--color-error)]'
                  }
                >
                  <span className="block">
                    {testResult.connectivity.success
                      ? t('settings.providers.connectivityOk', {
                        latency: String(testResult.connectivity.latencyMs),
                      })
                      : t('settings.providers.connectivityFailed', {
                        error: testResult.connectivity.error || '',
                      })}
                  </span>
                  {testResult.proxy && (
                    <span className="mt-1 block">
                      {testResult.proxy.success
                        ? t('settings.providers.proxyOk', {
                          latency: String(testResult.proxy.latencyMs),
                        })
                        : t('settings.providers.proxyFailed', {
                          error: testResult.proxy.error || '',
                        })}
                    </span>
                  )}
                </AlertDescription>
              </Alert>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="provider-settings-json">
              {t('settings.providers.settingsJson')}
            </Label>
            <Textarea
              id="provider-settings-json"
              value={displayedSettingsJson}
              onChange={(event) => handleSettingsJsonChange(event.target.value)}
              rows={16}
              spellCheck={false}
              aria-invalid={settingsJsonError ? true : undefined}
              aria-describedby={
                settingsJsonError
                  ? 'provider-settings-json-error provider-settings-json-description'
                  : 'provider-settings-json-description'
              }
              className="min-h-[18rem] bg-[var(--color-surface-container-low)] font-mono text-xs leading-relaxed text-[var(--color-text-secondary)]"
            />
            {settingsJsonError && (
              <p
                id="provider-settings-json-error"
                className="text-[11px] text-[var(--color-error)]"
              >
                {t('settings.providers.jsonError', { error: settingsJsonError })}
              </p>
            )}
            <p
              id="provider-settings-json-description"
              className="text-[11px] text-[var(--color-text-tertiary)]"
            >
              {t('settings.providers.settingsJsonDesc')}
            </p>
          </div>
        </div>

        <DialogFooter className="border-t border-[var(--color-border)] px-6 py-4">
          <ShadcnButton
            variant="secondary"
            onClick={handleClose}
            disabled={isSubmitting}
          >
            {t('common.cancel')}
          </ShadcnButton>
          <LoadingButton
            onClick={() => void handleSubmit()}
            disabled={!canSubmit || isSubmitting}
            loading={isSubmitting}
          >
            {mode === 'create' ? t('common.add') : t('common.save')}
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}


// ─── General Settings ──────────────────────────────────────

export function GeneralSettings() {
  const {
    thinkingEnabled,
    setThinkingEnabled,
    permissionMode,
    setPermissionMode,
    autoDreamEnabled,
    setAutoDreamEnabled,
    locale,
    setLocale,
    theme,
    setTheme,
    chatSendBehavior,
    setChatSendBehavior,
    outputStyle,
    outputStyles,
    outputStyleScope,
    outputStylesLoading,
    outputStyleError,
    fetchOutputStyles,
    setOutputStyle,
    skipWebFetchPreflight,
    setSkipWebFetchPreflight,
    desktopNotificationsEnabled,
    setDesktopNotificationsEnabled,
    webSearch,
    setWebSearch,
    network,
    setNetwork,
    traceCapture,
    setTraceCaptureEnabled,
    responseLanguage,
    setResponseLanguage,
    appMode,
    appModeRequiresRestart,
    fetchAppMode,
    setAppMode: setAppModeAction,
    uiZoom,
    setUiZoom,
  } = useSettingsStore()
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const sessions = useSessionStore((s) => s.sessions)
  const t = useTranslation()
  const [webSearchDraft, setWebSearchDraft] = useState(webSearch)
  const [networkDraft, setNetworkDraft] = useState(network)
  const [networkTimeoutInput, setNetworkTimeoutInput] = useState(String(Math.round(network.aiRequestTimeoutMs / 1000)))
  const [networkSaveError, setNetworkSaveError] = useState<string | null>(null)
  const [isSavingNetwork, setIsSavingNetwork] = useState(false)
  const [notificationPermission, setNotificationPermission] = useState<DesktopNotificationPermission>('default')
  const [notificationActionRunning, setNotificationActionRunning] = useState(false)
  const [autoDreamConfirmOpen, setAutoDreamConfirmOpen] = useState(false)
  const [autoDreamActionRunning, setAutoDreamActionRunning] = useState(false)
  const [modeSwitchConfirmOpen, setModeSwitchConfirmOpen] = useState(false)
  const [pendingMode, setPendingMode] = useState<AppMode | null>(null)
  const [pendingPortableDir, setPendingPortableDir] = useState<string | null>(null)
  const [portableDirDraft, setPortableDirDraft] = useState('')
  const [modeActionRunning, setModeActionRunning] = useState(false)
  const [modeError, setModeError] = useState<string | null>(null)
  const [uiZoomDraft, setUiZoomDraft] = useState(uiZoom)
  const [isUiZoomDragging, setIsUiZoomDragging] = useState(false)
  const isUiZoomDraggingRef = useRef(false)
  const addToast = useUIStore((s) => s.addToast)
  const webSearchDirty = JSON.stringify(webSearchDraft) !== JSON.stringify(webSearch)
  const uiZoomPercent = Math.round(uiZoomDraft * 100)
  const uiZoomRangeProgress = `${Math.round(((uiZoomDraft - UI_ZOOM_MIN) / (UI_ZOOM_MAX - UI_ZOOM_MIN)) * 1000) / 10}%`
  const activeConfigDir = appMode.activeConfigDir ?? (appMode.mode === 'portable' ? appMode.portableDir : null)
  const configDirSource = appMode.configDirSource ?? (appMode.mode === 'portable' ? 'portable' : 'system')
  const isEnvironmentConfigDir = configDirSource === 'environment'
  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId),
    [activeSessionId, sessions],
  )
  const outputStyleWorkDir =
    activeSession?.workDirExists === false
      ? null
      : activeSession?.workDir ?? activeSession?.projectRoot ?? null

  useEffect(() => {
    setWebSearchDraft(webSearch)
  }, [webSearch])

  useEffect(() => {
    void fetchOutputStyles(outputStyleWorkDir)
  }, [fetchOutputStyles, outputStyleWorkDir])

  useEffect(() => {
    setNetworkDraft(network)
    setNetworkTimeoutInput(String(Math.round(network.aiRequestTimeoutMs / 1000)))
    setNetworkSaveError(null)
  }, [network])

  useEffect(() => {
    if (!isUiZoomDragging) {
      setUiZoomDraft(uiZoom)
    }
  }, [isUiZoomDragging, uiZoom])

  useEffect(() => {
    let cancelled = false
    getDesktopNotificationPermission().then((permission) => {
      if (!cancelled) setNotificationPermission(permission)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!isDesktopRuntime()) return
    void fetchAppMode()
  }, [fetchAppMode])

  useEffect(() => {
    setPortableDirDraft(appMode.portableDir ?? '')
  }, [appMode.portableDir])

  const LANGUAGES: Array<{ value: Locale; label: string }> = [
    { value: 'en', label: 'English' },
    { value: 'zh', label: '简体中文' },
    { value: 'zh-TW', label: '繁體中文' },
    { value: 'jp', label: '日本語' },
    { value: 'kr', label: '한국어' },
  ]


  const RESPONSE_LANGUAGES: Array<{ value: string; label: string }> = [
    { value: '', label: t('settings.general.responseLangDefault') },
    { value: 'english', label: 'English' },
    { value: 'chinese', label: '中文 (Chinese)' },
    { value: 'japanese', label: '日本語 (Japanese)' },
    { value: 'korean', label: '한국어 (Korean)' },
    { value: 'spanish', label: 'Español (Spanish)' },
    { value: 'french', label: 'Français (French)' },
    { value: 'german', label: 'Deutsch (German)' },
    { value: 'portuguese', label: 'Português (Portuguese)' },
    { value: 'italian', label: 'Italiano (Italian)' },
    { value: 'russian', label: 'Русский (Russian)' },
    { value: 'dutch', label: 'Nederlands (Dutch)' },
    { value: 'polish', label: 'Polski (Polish)' },
    { value: 'turkish', label: 'Türkçe (Turkish)' },
    { value: 'hindi', label: 'हिन्दी (Hindi)' },
    { value: 'indonesian', label: 'Bahasa Indonesia' },
    { value: 'ukrainian', label: 'Українська (Ukrainian)' },
    { value: 'greek', label: 'Ελληνικά (Greek)' },
    { value: 'czech', label: 'Čeština (Czech)' },
    { value: 'danish', label: 'Dansk (Danish)' },
    { value: 'swedish', label: 'Svenska (Swedish)' },
    { value: 'norwegian', label: 'Norsk (Norwegian)' },
  ]
  const selectedResponseLanguageLabel =
    RESPONSE_LANGUAGES.find(({ value }) => value === responseLanguage)?.label ?? RESPONSE_LANGUAGES[0]!.label
  const outputStyleItems = outputStyles.map((style) => ({
    value: style.value,
    label: getOutputStyleLabel(style, t),
    description: `${getOutputStyleDescription(style, t)} · ${getOutputStyleSourceLabel(style.source, t)}`,
  }))
  const selectedOutputStyle =
    outputStyles.find((style) => style.value === outputStyle) ?? outputStyles[0]
  const selectedOutputStyleLabel = selectedOutputStyle
    ? getOutputStyleLabel(selectedOutputStyle, t)
    : outputStyle
  const selectedOutputStyleDescription = selectedOutputStyle
    ? getOutputStyleDescription(selectedOutputStyle, t)
    : ''
  const outputStyleScopeLabel = outputStyleScope === 'localSettings'
    ? t('settings.general.outputStyleScopeLocal')
    : t('settings.general.outputStyleScopeUser')
  const outputStyleScopeHint = outputStyleScope === 'localSettings'
    ? t('settings.general.outputStyleScopeLocalHint')
    : t('settings.general.outputStyleScopeUserHint')

  const THEMES: Array<{ value: ThemeMode; label: string }> = [
    { value: 'white', label: t('settings.general.appearance.white') },
    { value: 'light', label: t('settings.general.appearance.light') },
    { value: 'dark', label: t('settings.general.appearance.dark') },
  ]

  const WEB_SEARCH_MODES: Array<{ value: WebSearchMode; label: string }> = [
    { value: 'auto', label: t('settings.general.webSearch.mode.auto') },
    { value: 'tavily', label: t('settings.general.webSearch.mode.tavily') },
    { value: 'brave', label: t('settings.general.webSearch.mode.brave') },
    { value: 'anthropic', label: t('settings.general.webSearch.mode.anthropic') },
    { value: 'disabled', label: t('settings.general.webSearch.mode.disabled') },
  ]

  const NETWORK_PROXY_MODES: Array<{ value: NetworkProxyMode; label: string; description: string }> = [
    {
      value: 'direct',
      label: t('settings.general.networkProxyModeDirect'),
      description: t('settings.general.networkProxyModeDirectDescription'),
    },
    {
      value: 'system',
      label: t('settings.general.networkProxyModeSystem'),
      description: t('settings.general.networkProxyModeSystemDescription'),
    },
    {
      value: 'manual',
      label: t('settings.general.networkProxyModeManual'),
      description: t('settings.general.networkProxyModeManualDescription'),
    },
  ]

  const CHAT_SEND_BEHAVIORS: Array<{ value: ChatSendBehavior; label: string; description: string }> = [
    {
      value: 'enter',
      label: t('settings.general.chatSendBehaviorEnter'),
      description: t('settings.general.chatSendBehaviorEnterDescription'),
    },
    {
      value: 'modifierEnter',
      label: t('settings.general.chatSendBehaviorModifier'),
      description: t('settings.general.chatSendBehaviorModifierDescription'),
    },
  ]

  const notificationStatusLabel: Record<DesktopNotificationPermission, string> = {
    granted: t('settings.general.notificationsStatusGranted'),
    denied: t('settings.general.notificationsStatusDenied'),
    default: t('settings.general.notificationsStatusDefault'),
    unsupported: t('settings.general.notificationsStatusUnsupported'),
  }

  const handleDesktopNotificationsToggle = async (enabled: boolean) => {
    await setDesktopNotificationsEnabled(enabled)
    if (!enabled) return

    setNotificationActionRunning(true)
    try {
      const permission = await requestDesktopNotificationPermission()
      setNotificationPermission(permission)
      if (permission === 'granted' && getDesktopNotificationPlatform() !== 'win32') {
        void notifyDesktop({
          title: t('settings.general.notificationsTestTitle'),
          body: t('settings.general.notificationsTestBody'),
        })
      }
    } finally {
      setNotificationActionRunning(false)
    }
  }

  const handleAutoDreamToggle = (enabled: boolean) => {
    if (enabled) {
      setAutoDreamConfirmOpen(true)
      return
    }
    void setAutoDreamEnabled(false)
  }

  const confirmAutoDreamEnable = async () => {
    setAutoDreamActionRunning(true)
    try {
      await setAutoDreamEnabled(true)
      setAutoDreamConfirmOpen(false)
    } finally {
      setAutoDreamActionRunning(false)
    }
  }

  const handleNotificationPermissionAction = async () => {
    setNotificationActionRunning(true)
    try {
      if (notificationPermission === 'denied') {
        await openDesktopNotificationSettings()
      } else {
        const permission = await requestDesktopNotificationPermission()
        setNotificationPermission(permission)
        if (permission === 'granted') {
          void notifyDesktop({
            title: t('settings.general.notificationsTestTitle'),
            body: t('settings.general.notificationsTestBody'),
          })
        }
        if (permission === 'denied') {
          await openDesktopNotificationSettings()
        }
      }
    } finally {
      setNotificationActionRunning(false)
    }
  }

  const networkProxyUrl = networkDraft.proxy.url.trim()
  const networkProxyError =
    networkDraft.proxy.mode === 'manual' && !networkProxyUrl
      ? t('settings.general.networkProxyUrlRequired')
      : networkDraft.proxy.mode === 'manual' && !isValidHttpProxyUrl(networkProxyUrl)
        ? t('settings.general.networkProxyUrlInvalid')
        : null
  const timeoutSeconds = Math.round(networkDraft.aiRequestTimeoutMs / 1000)
  const parsedNetworkTimeoutSeconds = (() => {
    const trimmed = networkTimeoutInput.trim()
    if (!/^\d+$/.test(trimmed)) return null
    const seconds = Number(trimmed)
    if (!Number.isFinite(seconds) || seconds < NETWORK_TIMEOUT_MIN_SECONDS || seconds > NETWORK_TIMEOUT_MAX_SECONDS) return null
    return seconds
  })()
  const networkTimeoutError =
    networkTimeoutInput.trim().length === 0
      ? t('settings.general.networkTimeoutRequired')
      : parsedNetworkTimeoutSeconds === null
        ? t('settings.general.networkTimeoutRange', {
            min: String(NETWORK_TIMEOUT_MIN_SECONDS),
            max: String(NETWORK_TIMEOUT_MAX_SECONDS),
          })
        : null
  const networkDirty =
    networkDraft.aiRequestTimeoutMs !== network.aiRequestTimeoutMs ||
    networkDraft.proxy.mode !== network.proxy.mode ||
    networkDraft.proxy.url.trim() !== network.proxy.url.trim()

  const setNetworkTimeoutSeconds = (seconds: number) => {
    const nextSeconds = Math.min(Math.max(Math.round(seconds), NETWORK_TIMEOUT_MIN_SECONDS), NETWORK_TIMEOUT_MAX_SECONDS)
    setNetworkTimeoutInput(String(nextSeconds))
    setNetworkDraft((current) => ({
      ...current,
      aiRequestTimeoutMs: nextSeconds * 1000,
    }))
    setNetworkSaveError(null)
  }

  const saveNetworkSettings = async () => {
    if (networkProxyError) {
      setNetworkSaveError(networkProxyError)
      return
    }
    if (networkTimeoutError || parsedNetworkTimeoutSeconds === null) {
      setNetworkSaveError(networkTimeoutError ?? t('settings.general.networkTimeoutRange', {
        min: String(NETWORK_TIMEOUT_MIN_SECONDS),
        max: String(NETWORK_TIMEOUT_MAX_SECONDS),
      }))
      return
    }

    setIsSavingNetwork(true)
    setNetworkSaveError(null)
    try {
      await setNetwork({
        aiRequestTimeoutMs: parsedNetworkTimeoutSeconds * 1000,
        proxy: {
          mode: networkDraft.proxy.mode,
          url: networkDraft.proxy.mode === 'manual' ? networkProxyUrl : '',
        },
      })
      addToast({
        type: 'success',
        message: t('settings.general.networkSaved'),
      })
    } catch (error) {
      setNetworkSaveError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsSavingNetwork(false)
    }
  }

  const handleOutputStyleChange = async (value: string) => {
    try {
      await setOutputStyle(value, outputStyleWorkDir)
      addToast({
        type: 'success',
        message: t('settings.general.outputStyleSaved'),
      })
    } catch {
      // The store exposes outputStyleError below; keep the interaction local.
    }
  }

  const openPortableDirPicker = async () => {
    setModeError(null)
    const host = getDesktopHost()
    if (!host.capabilities.dialogs) {
      setModeError(t('settings.general.storagePickerError'))
      return
    }
    try {
      const selected = await host.dialogs.open({
        directory: true,
        multiple: false,
        title: t('settings.general.storageChooseDirTitle'),
      })
      if (typeof selected === 'string') {
        setPortableDirDraft(selected)
      }
    } catch {
      setModeError(t('settings.general.storagePickerError'))
    }
  }

  const openModeSwitchConfirm = (mode: AppMode) => {
    if (isEnvironmentConfigDir) {
      setModeError(t('settings.general.storageEnvironmentSwitchBlocked'))
      return
    }

    const portableDir = portableDirDraft.trim()
    if (mode === 'portable' && !portableDir) {
      setModeError(t('settings.general.storageNoDirError'))
      return
    }

    setModeError(null)
    setPendingMode(mode)
    setPendingPortableDir(mode === 'portable' ? portableDir : null)
    setModeSwitchConfirmOpen(true)
  }

  const closeModeSwitchConfirm = () => {
    if (modeActionRunning) return
    setModeSwitchConfirmOpen(false)
    setPendingMode(null)
    setPendingPortableDir(null)
  }

  const confirmModeSwitch = async () => {
    if (!pendingMode) return

    setModeActionRunning(true)
    setModeError(null)
    try {
      await setAppModeAction(pendingMode, pendingPortableDir)
      const host = getDesktopHost()
      await host.appMode.prepareRestart()
      await host.appMode.restart()
    } catch (error) {
      setModeError(
        error instanceof Error
          ? error.message
          : t('settings.general.storageRestartError'),
      )
      setModeSwitchConfirmOpen(false)
      setPendingMode(null)
      setPendingPortableDir(null)
      setModeActionRunning(false)
    }
  }

  const setUiZoomDraggingState = (dragging: boolean) => {
    isUiZoomDraggingRef.current = dragging
    setIsUiZoomDragging(dragging)
  }

  const commitUiZoom = (value: number) => {
    const nextZoom = Number.isFinite(value) ? value : UI_ZOOM_DEFAULT
    setUiZoomDraggingState(false)
    setUiZoomDraft(nextZoom)
    setUiZoom(nextZoom)
  }

  const uiZoomSection = (
    <div className="mt-8">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">{t('settings.general.uiZoom')}</h2>
          <p className="text-sm text-[var(--color-text-tertiary)]">{t('settings.general.uiZoomDescription')}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--color-text-tertiary)]">
            <span>{t('settings.general.uiZoomShortcutHint')}</span>
            <span className="inline-flex items-center gap-1">
              <span className="font-medium text-[var(--color-text-secondary)]">{t('settings.general.uiZoomShortcutMac')}</span>
              <kbd className="settings-zoom-kbd">⌘</kbd>
              <kbd className="settings-zoom-kbd">+</kbd>
              <span>/</span>
              <kbd className="settings-zoom-kbd">⌘</kbd>
              <kbd className="settings-zoom-kbd">-</kbd>
              <span>/</span>
              <kbd className="settings-zoom-kbd">⌘</kbd>
              <kbd className="settings-zoom-kbd">0</kbd>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="font-medium text-[var(--color-text-secondary)]">{t('settings.general.uiZoomShortcutWindows')}</span>
              <kbd className="settings-zoom-kbd">Ctrl</kbd>
              <kbd className="settings-zoom-kbd">+</kbd>
              <span>/</span>
              <kbd className="settings-zoom-kbd">Ctrl</kbd>
              <kbd className="settings-zoom-kbd">-</kbd>
              <span>/</span>
              <kbd className="settings-zoom-kbd">Ctrl</kbd>
              <kbd className="settings-zoom-kbd">0</kbd>
            </span>
            <span>{t('settings.general.uiZoomShortcutResetHint')}</span>
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <span className="min-w-[48px] rounded-md bg-[var(--color-surface-container-low)] px-2 py-1 text-center text-sm font-medium text-[var(--color-text-secondary)]">
            {uiZoomPercent}%
          </span>
          <ShadcnButton
            aria-label={t('settings.general.uiZoomReset')}
            title={t('settings.general.uiZoomReset')}
            size="sm"
            variant="secondary"
            onClick={() => {
              setIsUiZoomDragging(false)
              setUiZoomDraft(UI_ZOOM_DEFAULT)
              setUiZoom(UI_ZOOM_DEFAULT)
            }}
            className="h-8"
          >
            <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
            100%
          </ShadcnButton>
        </div>
      </div>
      <div
        className={`settings-zoom-control flex items-center gap-3 ${isUiZoomDragging ? 'is-dragging' : ''}`}
        style={{ '--settings-zoom-range-progress': uiZoomRangeProgress } as CSSProperties}
      >
        <span className="w-9 text-right text-xs text-[var(--color-text-tertiary)]">{Math.round(UI_ZOOM_MIN * 100)}%</span>
        <div className="settings-zoom-range-wrap flex-1">
          <div className="settings-zoom-preview" aria-hidden="true">
            {uiZoomPercent}%
          </div>
          <Slider
            aria-label={t('settings.general.uiZoom')}
            min={UI_ZOOM_MIN}
            max={UI_ZOOM_MAX}
            step={UI_ZOOM_STEP}
            value={[uiZoomDraft]}
            onPointerDown={() => {
              setUiZoomDraggingState(true)
            }}
            onValueCommit={([value]) => commitUiZoom(value ?? UI_ZOOM_DEFAULT)}
            onPointerCancel={() => {
              setUiZoomDraggingState(false)
              setUiZoomDraft(uiZoom)
            }}
            onValueChange={([value]) => {
              const nextZoom = Number.isFinite(value) ? value! : UI_ZOOM_DEFAULT
              setUiZoomDraft(nextZoom)
              if (!isUiZoomDraggingRef.current) {
                setUiZoom(nextZoom)
              }
            }}
            onBlur={() => {
              if (uiZoomDraft !== uiZoom) {
                commitUiZoom(uiZoomDraft)
              } else {
                setUiZoomDraggingState(false)
              }
            }}
            className="settings-zoom-range w-full"
          />
        </div>
        <span className="w-9 text-xs text-[var(--color-text-tertiary)]">{Math.round(UI_ZOOM_MAX * 100)}%</span>
      </div>
    </div>
  )

  return (
    <div className="max-w-xl">
      {/* Appearance selector */}
      <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">{t('settings.general.appearanceTitle')}</h2>
      <p className="text-sm text-[var(--color-text-tertiary)] mb-3">{t('settings.general.appearanceDescription')}</p>
      <ToggleGroup
        type="single"
        value={theme}
        onValueChange={(value) => {
          if (value) void setTheme(value as ThemeMode)
        }}
        aria-label={t('settings.general.appearanceTitle')}
        className="mb-8"
      >
        {THEMES.map(({ value, label }) => (
          <ToggleGroupItem
            key={value}
            value={value}
            aria-label={label}
            className="flex-1"
          >
            {label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {/* Language selector */}
      <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">{t('settings.general.languageTitle')}</h2>
      <p className="text-sm text-[var(--color-text-tertiary)] mb-3">{t('settings.general.languageDescription')}</p>
      <ToggleGroup
        type="single"
        value={locale}
        onValueChange={(value) => {
          if (value) setLocale(value as Locale)
        }}
        aria-label={t('settings.general.languageTitle')}
        className="mb-8"
      >
        {LANGUAGES.map(({ value, label }) => (
          <ToggleGroupItem
            key={value}
            value={value}
            aria-label={label}
            className="flex-1 data-[state=on]:bg-none data-[state=on]:bg-[var(--color-brand)]"
          >
            {label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {/* Response Language */}
      <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">{t('settings.general.responseLangTitle')}</h2>
      <p className="text-sm text-[var(--color-text-tertiary)] mb-3">{t('settings.general.responseLangDescription')}</p>
      <Select
        value={responseLanguage || DEFAULT_RESPONSE_LANGUAGE_SELECT_VALUE}
        onValueChange={(value) => {
          void setResponseLanguage(
            value === DEFAULT_RESPONSE_LANGUAGE_SELECT_VALUE ? '' : value,
          )
        }}
      >
        <SelectTrigger
          aria-label={t('settings.general.responseLangTitle')}
          className="mb-8"
        >
          <SelectValue className="min-w-0 flex-1 truncate">
            {selectedResponseLanguageLabel}
          </SelectValue>
        </SelectTrigger>
        <SelectContent className="max-h-[320px]" align="start">
          {RESPONSE_LANGUAGES.map((item) => (
            <SelectItem
              key={item.value || DEFAULT_RESPONSE_LANGUAGE_SELECT_VALUE}
              value={item.value || DEFAULT_RESPONSE_LANGUAGE_SELECT_VALUE}
            >
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Output style */}
      <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">{t('settings.general.outputStyleTitle')}</h2>
      <p className="text-sm text-[var(--color-text-tertiary)] mb-3">{t('settings.general.outputStyleDescription')}</p>
      <Card className="mb-8">
        <CardContent>
          <Select
            value={outputStyle}
            onValueChange={(value) => void handleOutputStyleChange(value)}
          >
            <SelectTrigger
              aria-label={t('settings.general.outputStyleSelectLabel')}
              disabled={outputStylesLoading}
            >
              <Paintbrush
                className="size-[18px] flex-shrink-0 text-[var(--color-text-secondary)]"
                aria-hidden="true"
              />
              <SelectValue className="min-w-0 flex-1">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {outputStylesLoading
                      ? t('settings.general.outputStyleLoading')
                      : selectedOutputStyleLabel}
                  </span>
                  {selectedOutputStyleDescription && (
                    <span className="mt-0.5 block truncate text-xs text-[var(--color-text-tertiary)]">
                      {selectedOutputStyleDescription}
                    </span>
                  )}
                </span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="max-h-[360px]" align="start">
              {outputStyleItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">{item.label}</span>
                    <span className="mt-0.5 truncate text-xs text-[var(--color-text-tertiary)]">
                      {item.description}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-tertiary)]">
            <Badge variant="secondary">
              {outputStyleScopeLabel}
            </Badge>
            {selectedOutputStyle && (
              <Badge variant="outline">
                {getOutputStyleSourceLabel(selectedOutputStyle.source, t)}
              </Badge>
            )}
            <span className="min-w-0 flex-1 leading-5">{outputStyleScopeHint}</span>
          </div>
          <p className="mt-2 text-xs leading-5 text-[var(--color-text-tertiary)]">
            {t('settings.general.outputStyleRestartHint')}
          </p>
          {outputStyleError && (
            <Alert variant="destructive" className="mt-2">
              <AlertDescription className="text-[var(--color-error)]">
                {outputStyleError}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <div className="mt-8">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">{t('settings.general.defaultPermissionTitle')}</h2>
        <p className="text-sm text-[var(--color-text-tertiary)] mb-3">{t('settings.general.defaultPermissionDescription')}</p>
        <Card className="px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-[var(--color-text-primary)]">
                {t('settings.general.defaultPermissionLabel')}
              </div>
              <div className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">
                {t('settings.general.defaultPermissionHint')}
              </div>
            </div>
            <PermissionModeSelector
              value={permissionMode}
              onChange={(mode) => void setPermissionMode(mode)}
              workDir={t('settings.general.defaultPermissionScope')}
              menuPlacement="bottom"
            />
          </div>
        </Card>
      </div>

      <div className="mt-8">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">{t('settings.general.thinkingTitle')}</h2>
        <p className="text-sm text-[var(--color-text-tertiary)] mb-3">{t('settings.general.thinkingDescription')}</p>
        <SettingSwitchRow
          checked={thinkingEnabled}
          onCheckedChange={(checked) => void setThinkingEnabled(checked)}
          label={t('settings.general.thinkingEnabled')}
          description={t('settings.general.thinkingHint')}
        />
      </div>

      <div className="mt-8">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">{t('settings.general.autoDreamTitle')}</h2>
        <p className="text-sm text-[var(--color-text-tertiary)] mb-3">{t('settings.general.autoDreamDescription')}</p>
        <SettingSwitchRow
          checked={autoDreamEnabled}
          onCheckedChange={handleAutoDreamToggle}
          label={t('settings.general.autoDreamEnabled')}
          description={autoDreamEnabled
            ? t('settings.general.autoDreamHintOn')
            : t('settings.general.autoDreamHintOff')}
        />
      </div>

      <div className="mt-8">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">{t('settings.general.traceTitle')}</h2>
        <p className="text-sm text-[var(--color-text-tertiary)] mb-3">{t('settings.general.traceDescription')}</p>
        <SettingSwitchRow
          checked={traceCapture.enabled}
          onCheckedChange={(checked) => void setTraceCaptureEnabled(checked)}
          label={t('settings.general.traceEnabled')}
          description={traceCapture.enabled ? t('settings.general.traceHintOn') : t('settings.general.traceHintOff')}
        >
          {traceCapture.storageDir && (
            <div className="mt-2 truncate rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono text-[11px] text-[var(--color-text-secondary)]">
              {traceCapture.storageDir}
            </div>
          )}
        </SettingSwitchRow>
      </div>

      <div className="mt-8">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">{t('settings.general.notificationsTitle')}</h2>
        <p className="text-sm text-[var(--color-text-tertiary)] mb-3">{t('settings.general.notificationsDescription')}</p>
        <SettingSwitchRow
          checked={desktopNotificationsEnabled}
          onCheckedChange={(checked) => void handleDesktopNotificationsToggle(checked)}
          label={t('settings.general.notificationsEnabled')}
          description={desktopNotificationsEnabled
            ? t('settings.general.notificationsHintOn')
            : t('settings.general.notificationsHintOff')}
        >
          {desktopNotificationsEnabled && (
            <div className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--color-border)]/60 pt-3">
              <div className="min-w-0 text-xs text-[var(--color-text-tertiary)]">
                {t('settings.general.notificationsStatus')}: {notificationStatusLabel[notificationPermission]}
              </div>
              {notificationPermission !== 'granted' && notificationPermission !== 'unsupported' && (
                <ShadcnButton
                  size="sm"
                  variant="secondary"
                  className="px-3 whitespace-nowrap"
                  disabled={notificationActionRunning}
                  onClick={() => void handleNotificationPermissionAction()}
                >
                  {notificationPermission === 'denied'
                    ? t('settings.general.notificationsOpenSettings')
                    : t('settings.general.notificationsAuthorize')}
                </ShadcnButton>
              )}
            </div>
          )}
        </SettingSwitchRow>
      </div>

      <div className="mt-8">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">{t('settings.general.chatSendBehaviorTitle')}</h2>
        <p className="text-sm text-[var(--color-text-tertiary)] mb-3">{t('settings.general.chatSendBehaviorDescription')}</p>
        <RadioGroup
          value={chatSendBehavior}
          onValueChange={(value) => void setChatSendBehavior(value as ChatSendBehavior)}
          aria-label={t('settings.general.chatSendBehaviorTitle')}
          className="grid grid-cols-2 gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-2"
        >
          {CHAT_SEND_BEHAVIORS.map((option) => (
            <SettingRadioCard
              key={option.value}
              value={option.value}
              label={option.label}
              description={option.description}
            />
          ))}
        </RadioGroup>
      </div>

      {uiZoomSection}

      <div className="mt-8">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">{t('settings.general.networkTitle')}</h2>
        <p className="text-sm text-[var(--color-text-tertiary)] mb-3">{t('settings.general.networkDescription')}</p>
        <Card className="px-4 py-4">
          <RadioGroup
            value={networkDraft.proxy.mode}
            onValueChange={(value) => {
              setNetworkDraft((current) => ({
                ...current,
                proxy: { ...current.proxy, mode: value as NetworkProxyMode },
              }))
              setNetworkSaveError(null)
            }}
            aria-label={t('settings.general.networkTitle')}
            className="grid grid-cols-2 gap-2"
          >
            {NETWORK_PROXY_MODES.map((mode) => (
              <SettingRadioCard
                key={mode.value}
                value={mode.value}
                label={mode.label}
                description={mode.description}
              />
            ))}
          </RadioGroup>

          {networkDraft.proxy.mode === 'manual' && (
            <div className="mt-4">
              <SettingField
                id="network-proxy-url"
                label={t('settings.general.networkProxyUrl')}
                value={networkDraft.proxy.url}
                placeholder="http://127.0.0.1:7890"
                autoComplete="off"
                onChange={(event) => {
                  setNetworkDraft((current) => ({
                    ...current,
                    proxy: { ...current.proxy, url: event.target.value },
                  }))
                  setNetworkSaveError(null)
                }}
              />
              <p className={`mt-1 text-[11px] leading-4 ${networkProxyError ? 'text-[var(--color-error)]' : 'text-[var(--color-text-tertiary)]'}`}>
                {networkProxyError ?? t('settings.general.networkProxyUrlHint')}
              </p>
            </div>
          )}

          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <label htmlFor="network-timeout-seconds" className="text-sm font-medium text-[var(--color-text-primary)]">
                {t('settings.general.networkTimeout')}
              </label>
              <span className="rounded-md bg-[var(--color-surface)] px-2 py-1 text-xs font-medium text-[var(--color-text-secondary)]">
                {t('settings.general.networkTimeoutValue', { seconds: String(timeoutSeconds) })}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <LoadingButton
                size="sm"
                variant="secondary"
                className="h-10 w-10 px-0"
                aria-label={t('settings.general.networkTimeoutDecrease')}
                onClick={() => setNetworkTimeoutSeconds((parsedNetworkTimeoutSeconds ?? timeoutSeconds) - NETWORK_TIMEOUT_STEP_SECONDS)}
              >
                -30
              </LoadingButton>
              <div className="relative min-w-0 flex-1">
                <ShadcnInput
                  id="network-timeout-seconds"
                  type="number"
                  min={NETWORK_TIMEOUT_MIN_SECONDS}
                  max={NETWORK_TIMEOUT_MAX_SECONDS}
                  step={1}
                  inputMode="numeric"
                  value={networkTimeoutInput}
                  aria-invalid={networkTimeoutError ? true : undefined}
                  aria-describedby="network-timeout-help"
                  onChange={(event) => {
                    const nextValue = event.currentTarget.value
                    if (!/^\d*$/.test(nextValue)) return
                    setNetworkTimeoutInput(nextValue)
                    const seconds = Number(nextValue)
                    if (nextValue.length > 0 && seconds >= NETWORK_TIMEOUT_MIN_SECONDS && seconds <= NETWORK_TIMEOUT_MAX_SECONDS) {
                      setNetworkDraft((current) => ({
                        ...current,
                        aiRequestTimeoutMs: seconds * 1000,
                      }))
                    }
                    setNetworkSaveError(null)
                  }}
                  className="pr-12"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--color-text-tertiary)]">
                  {t('settings.general.networkTimeoutUnit')}
                </span>
              </div>
              <LoadingButton
                size="sm"
                variant="secondary"
                className="h-10 w-10 px-0"
                aria-label={t('settings.general.networkTimeoutIncrease')}
                onClick={() => setNetworkTimeoutSeconds((parsedNetworkTimeoutSeconds ?? timeoutSeconds) + NETWORK_TIMEOUT_STEP_SECONDS)}
              >
                +30
              </LoadingButton>
            </div>
            <p
              id="network-timeout-help"
              className={`mt-2 text-xs leading-5 ${networkTimeoutError ? 'text-[var(--color-error)]' : 'text-[var(--color-text-tertiary)]'}`}
            >
              {networkTimeoutError ?? t('settings.general.networkTimeoutHint')}
            </p>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="min-w-0 text-[11px] leading-4 text-[var(--color-text-tertiary)]">
              {t('settings.general.networkScopeHint')}
            </p>
            <LoadingButton
              size="sm"
              variant="secondary"
              className="min-w-[72px] px-4 whitespace-nowrap"
              disabled={!networkDirty || !!networkProxyError || !!networkTimeoutError || isSavingNetwork}
              loading={isSavingNetwork}
              onClick={() => void saveNetworkSettings()}
            >
              {t('settings.general.networkSave')}
            </LoadingButton>
          </div>

          {networkSaveError && (
            <p className="mt-2 text-[11px] leading-4 text-[var(--color-error)]">
              {networkSaveError}
            </p>
          )}
        </Card>
      </div>

      <div className="mt-8">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">{t('settings.general.webFetchPreflightTitle')}</h2>
        <p className="text-sm text-[var(--color-text-tertiary)] mb-3">{t('settings.general.webFetchPreflightDescription')}</p>
        <SettingSwitchRow
          checked={skipWebFetchPreflight}
          onCheckedChange={(checked) => void setSkipWebFetchPreflight(checked)}
          label={t('settings.general.webFetchPreflightEnabled')}
          description={t('settings.general.webFetchPreflightHint')}
        />
      </div>

      <div className="mt-8">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">{t('settings.general.webSearchTitle')}</h2>
        <p className="text-sm text-[var(--color-text-tertiary)] mb-3">{t('settings.general.webSearchDescription')}</p>
        <Card className="px-4 py-4">
          <ToggleGroup
            type="single"
            value={webSearchDraft.mode ?? 'auto'}
            onValueChange={(value) => {
              if (value) {
                setWebSearchDraft({ ...webSearchDraft, mode: value as WebSearchMode })
              }
            }}
            aria-label={t('settings.general.webSearchTitle')}
            className="mb-4 grid grid-cols-5 gap-1.5"
          >
            {WEB_SEARCH_MODES.map(({ value, label }) => (
              <ToggleGroupItem
                key={value}
                value={value}
                aria-label={label}
                className="h-9 truncate px-2 text-xs"
                title={label}
              >
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <div className="grid grid-cols-1 gap-3">
            <SettingField
              id="web-search-tavily-key"
              type="password"
              label={t('settings.general.webSearchTavilyKey')}
              value={webSearchDraft.tavilyApiKey ?? ''}
              placeholder="tvly-..."
              autoComplete="off"
              onChange={(event) =>
                setWebSearchDraft({
                  ...webSearchDraft,
                  tavilyApiKey: event.target.value,
                })
              }
            />
            <div className="-mt-1 flex items-center justify-between gap-3 text-xs text-[var(--color-text-tertiary)]">
              <span>{t('settings.general.webSearchTavilyFreeHint')}</span>
              <a
                href="https://app.tavily.com/home"
                target="_blank"
                rel="noreferrer"
                aria-label={t('settings.general.webSearchTavilyApiKeyLink')}
                className="font-medium text-[var(--color-brand)] hover:underline whitespace-nowrap"
              >
                {t('settings.general.webSearchGetApiKey')}
              </a>
            </div>
            <SettingField
              id="web-search-brave-key"
              type="password"
              label={t('settings.general.webSearchBraveKey')}
              value={webSearchDraft.braveApiKey ?? ''}
              placeholder={t('settings.general.webSearchBravePlaceholder')}
              autoComplete="off"
              onChange={(event) =>
                setWebSearchDraft({
                  ...webSearchDraft,
                  braveApiKey: event.target.value,
                })
              }
            />
            <div className="-mt-1 flex items-center justify-between gap-3 text-xs text-[var(--color-text-tertiary)]">
              <span>{t('settings.general.webSearchBraveFreeHint')}</span>
              <a
                href="https://api-dashboard.search.brave.com/app/keys"
                target="_blank"
                rel="noreferrer"
                aria-label={t('settings.general.webSearchBraveApiKeyLink')}
                className="font-medium text-[var(--color-brand)] hover:underline whitespace-nowrap"
              >
                {t('settings.general.webSearchGetApiKey')}
              </a>
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-3">
            <p className="text-xs text-[var(--color-text-tertiary)] leading-5">
              {t('settings.general.webSearchHint')}
            </p>
            <div className="flex justify-end">
              <LoadingButton
                size="sm"
                variant="secondary"
                className="min-w-[72px] px-4 whitespace-nowrap"
                disabled={!webSearchDirty}
                onClick={() => void setWebSearch(webSearchDraft)}
              >
                {t('settings.general.webSearchSave')}
              </LoadingButton>
            </div>
          </div>
        </Card>
      </div>

      {isDesktopRuntime() && (
        <div className="mt-8 border-t border-[var(--color-border)] pt-8">
          <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">{t('settings.general.storageTitle')}</h2>
          <p className="text-sm text-[var(--color-text-tertiary)] mb-3">{t('settings.general.storageDescription')}</p>

          <Card className="px-4 py-4">
            <div className="flex flex-col gap-3">
              <ShadcnButton
                variant="outline"
                onClick={() => {
                  if (isEnvironmentConfigDir) {
                    setModeError(t('settings.general.storageEnvironmentSwitchBlocked'))
                    return
                  }
                  if (appMode.mode !== 'default') {
                    openModeSwitchConfirm('default')
                  }
                }}
                aria-pressed={appMode.mode === 'default' && !isEnvironmentConfigDir}
                className={`h-auto w-full items-start justify-start gap-3 px-3 py-3 text-left whitespace-normal ${
                  appMode.mode === 'default' && !isEnvironmentConfigDir
                    ? 'border-[var(--color-brand)] bg-[var(--color-surface)] shadow-[var(--shadow-focus-ring)]'
                    : 'bg-[var(--color-surface)]'
                }`}
              >
                <span className="material-symbols-outlined mt-0.5 text-[20px] text-[var(--color-text-secondary)]">settings_applications</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-[var(--color-text-primary)]">{t('settings.general.storageSystemTitle')}</span>
                  <span className="mt-1 block text-xs leading-5 text-[var(--color-text-tertiary)]">{t('settings.general.storageSystemDescription')}</span>
                </span>
              </ShadcnButton>

              <Card
                className={`rounded-lg border px-3 py-3 transition-all ${
                  appMode.mode === 'portable' && !isEnvironmentConfigDir
                    ? 'border-[var(--color-brand)] bg-[var(--color-surface)] shadow-[var(--shadow-focus-ring)]'
                    : 'border-[var(--color-border)] bg-[var(--color-surface)]'
                }`}
              >
                <div className="mb-3 flex items-start gap-3">
                  <span className="material-symbols-outlined mt-0.5 text-[20px] text-[var(--color-text-secondary)]">drive_file_move</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-[var(--color-text-primary)]">{t('settings.general.storagePortableTitle')}</div>
                    <div className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">{t('settings.general.storagePortableDescription')}</div>
                  </div>
                </div>

                <div className="flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <SettingField
                      id="portable-data-dir"
                      label={t('settings.general.storagePortableDirLabel')}
                      value={portableDirDraft}
                      placeholder={t('settings.general.storagePortableDirPlaceholder')}
                      onChange={(event) => {
                        setPortableDirDraft(event.target.value)
                        setModeError(null)
                      }}
                      className="w-full font-mono text-xs"
                    />
                  </div>
                  <LoadingButton
                    variant="secondary"
                    className="h-10 flex-shrink-0 px-3 whitespace-nowrap"
                    onClick={() => void openPortableDirPicker()}
                  >
                    {t('settings.general.storageChooseDir')}
                  </LoadingButton>
                </div>

                <div className="mt-3 flex justify-end">
                  <LoadingButton
                    size="sm"
                    variant="secondary"
                    disabled={modeActionRunning || (appMode.mode === 'portable' && portableDirDraft.trim() === (appMode.portableDir ?? ''))}
                    onClick={() => openModeSwitchConfirm('portable')}
                  >
                    {t('settings.general.storageApplyPortable')}
                  </LoadingButton>
                </div>
              </Card>
            </div>

            {activeConfigDir && (
              <div className="mt-3 rounded-lg border border-[var(--color-border)]/70 bg-[var(--color-surface)] px-3 py-2">
                <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-text-tertiary)]">{t('settings.general.storageActiveDir')}</div>
                <div className="mt-1 break-all font-mono text-xs text-[var(--color-text-secondary)]">{activeConfigDir}</div>
              </div>
            )}

            {isEnvironmentConfigDir && (
              <div className="mt-3 rounded-lg border border-[var(--color-warning)] bg-[var(--color-warning)]/10 px-3 py-2 text-xs leading-5 text-[var(--color-text-secondary)]">
                {t('settings.general.storageEnvironmentHint')}
              </div>
            )}

            {appModeRequiresRestart && (
              <div className="mt-3 rounded-lg border border-[var(--color-warning)] bg-[var(--color-warning)]/10 px-3 py-2 text-xs leading-5 text-[var(--color-text-secondary)]">
                {t('settings.general.storageRestartHint')}
              </div>
            )}

            <div className="mt-3 text-xs leading-5 text-[var(--color-text-tertiary)]">
              {t('settings.general.storageMoveHint')}
            </div>

            {modeError && (
              <div className="mt-3 text-xs text-[var(--color-error)]">
                {modeError}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Confirm dialog for mode switch */}
      <ConfirmDialog
        open={modeSwitchConfirmOpen}
        onClose={closeModeSwitchConfirm}
        onConfirm={() => void confirmModeSwitch()}
        title={t('settings.general.modeSwitchTitle')}
        body={(
          <div className="space-y-3 text-sm leading-6 text-[var(--color-text-secondary)]">
            <p>
              {pendingMode === 'portable'
                ? t('settings.general.storageSwitchPortableBody')
                : t('settings.general.storageSwitchDefaultBody')}
            </p>
            {pendingMode === 'portable' && pendingPortableDir && (
              <div className="rounded-lg bg-[var(--color-surface-container-low)] px-3 py-2 font-mono text-xs break-all text-[var(--color-text-secondary)]">
                {pendingPortableDir}
              </div>
            )}
            <p>{t('settings.general.storageSwitchRestartBody')}</p>
          </div>
        )}
        confirmLabel={t('settings.general.modeSwitchConfirm')}
        cancelLabel={t('common.cancel')}
        confirmVariant="primary"
        loading={modeActionRunning}
      />
      <ConfirmDialog
        open={autoDreamConfirmOpen}
        onClose={() => {
          if (!autoDreamActionRunning) setAutoDreamConfirmOpen(false)
        }}
        onConfirm={() => void confirmAutoDreamEnable()}
        title={t('settings.general.autoDreamConfirmTitle')}
        body={(
          <div className="space-y-2">
            <p>{t('settings.general.autoDreamConfirmKeepRunning')}</p>
            <p>{t('settings.general.autoDreamConfirmTokenCost')}</p>
          </div>
        )}
        confirmLabel={t('settings.general.autoDreamConfirmEnable')}
        cancelLabel={t('common.cancel')}
        confirmVariant="primary"
        loading={autoDreamActionRunning}
      />
    </div>
  )
}

function getBuiltInOutputStyleTranslationKeys(style: {
  value: string
  source: OutputStyleSource
}) {
  if (style.source !== 'built-in') return null
  return BUILT_IN_OUTPUT_STYLE_TRANSLATION_KEYS[
    style.value as keyof typeof BUILT_IN_OUTPUT_STYLE_TRANSLATION_KEYS
  ] ?? null
}

function getOutputStyleLabel(
  style: {
    value: string
    label: string
    source: OutputStyleSource
  },
  t: (key: TranslationKey) => string,
) {
  const keys = getBuiltInOutputStyleTranslationKeys(style)
  return keys ? t(keys.label) : style.label
}

function getOutputStyleDescription(
  style: {
    value: string
    description: string
    source: OutputStyleSource
  },
  t: (key: TranslationKey) => string,
) {
  const keys = getBuiltInOutputStyleTranslationKeys(style)
  return keys ? t(keys.description) : style.description
}

function getOutputStyleSourceLabel(
  source: OutputStyleSource,
  t: (key: TranslationKey) => string,
) {
  switch (source) {
    case 'built-in':
      return t('settings.general.outputStyleSourceBuiltIn')
    case 'userSettings':
      return t('settings.general.outputStyleSourceUser')
    case 'projectSettings':
      return t('settings.general.outputStyleSourceProject')
    case 'localSettings':
      return t('settings.general.outputStyleSourceLocal')
    case 'policySettings':
      return t('settings.general.outputStyleSourcePolicy')
    case 'plugin':
      return t('settings.general.outputStyleSourcePlugin')
  }
}

// ─── H5 Access Settings ──────────────────────────────────────

function H5AccessSettings() {
  const {
    h5Access,
    h5AccessDiagnostics,
    h5AccessError,
    enableH5Access,
    disableH5Access,
    regenerateH5AccessToken,
    updateH5AccessSettings,
  } = useSettingsStore()
  const t = useTranslation()
  const addToast = useUIStore((s) => s.addToast)
  const [h5PublicBaseUrlDraft, setH5PublicBaseUrlDraft] = useState(extractH5AccessAddressDraft(h5Access.publicBaseUrl))
  const [h5FixedPortDraft, setH5FixedPortDraft] = useState(h5Access.fixedPort != null ? String(h5Access.fixedPort) : '')
  const [h5GraceDraft, setH5GraceDraft] = useState(h5Access.disconnectGraceSeconds != null ? String(h5Access.disconnectGraceSeconds) : '')
  const [h5TokenVisible, setH5TokenVisible] = useState(false)
  const [h5EnableConfirmOpen, setH5EnableConfirmOpen] = useState(false)
  const [h5QrDataUrl, setH5QrDataUrl] = useState<string | null>(null)
  const [h5ActionRunning, setH5ActionRunning] = useState(false)
  const h5EnableTriggerRef = useRef<HTMLButtonElement>(null)
  const h5AccessUrl = h5Access.publicBaseUrl
  // The token is persisted server-side, so the QR code and copy actions stay
  // available across desktop restarts (issue #767).
  const h5Token = h5Access.token
  const h5LaunchUrl = useMemo(
    () => buildH5LaunchUrl(h5AccessUrl, h5Token),
    [h5AccessUrl, h5Token],
  )
  const h5ActivePort = h5AccessDiagnostics?.activePort != null
    ? String(h5AccessDiagnostics.activePort)
    : extractH5AccessPort(h5AccessUrl)
  const h5NextPublicBaseUrl = buildH5PublicBaseUrlFromHostDraft(
    h5PublicBaseUrlDraft,
    h5Access.publicBaseUrl,
    h5ActivePort,
  )
  const h5NextFixedPort = parseH5FixedPortDraft(h5FixedPortDraft)
  const h5FixedPortInvalid = h5NextFixedPort === 'invalid'
  const h5NextGrace = parseH5GraceDraft(h5GraceDraft)
  const h5GraceInvalid = h5NextGrace === 'invalid'
  const h5AccessDirty = h5NextPublicBaseUrl !== (h5Access.publicBaseUrl ?? null) ||
    (!h5FixedPortInvalid && h5NextFixedPort !== h5Access.fixedPort) ||
    (!h5GraceInvalid && h5NextGrace !== h5Access.disconnectGraceSeconds)
  const h5FixedPortPendingRestart = h5Access.fixedPort != null &&
    h5ActivePort != null &&
    String(h5Access.fixedPort) !== h5ActivePort

  useEffect(() => {
    setH5PublicBaseUrlDraft(extractH5AccessAddressDraft(h5Access.publicBaseUrl))
    setH5FixedPortDraft(h5Access.fixedPort != null ? String(h5Access.fixedPort) : '')
    setH5GraceDraft(h5Access.disconnectGraceSeconds != null ? String(h5Access.disconnectGraceSeconds) : '')
  }, [h5Access])

  useEffect(() => {
    let cancelled = false
    if (!h5Access.enabled || !h5LaunchUrl || !h5Token) {
      setH5QrDataUrl(null)
      return () => {
        cancelled = true
      }
    }

    QRCode.toDataURL(h5LaunchUrl, { margin: 1, width: 192 })
      .then((dataUrl) => {
        if (!cancelled) setH5QrDataUrl(dataUrl)
      })
      .catch(() => {
        if (!cancelled) setH5QrDataUrl(null)
      })

    return () => {
      cancelled = true
    }
  }, [h5Access.enabled, h5LaunchUrl, h5Token])

  const runH5Action = async (action: () => Promise<void>) => {
    setH5ActionRunning(true)
    try {
      await action()
    } catch {
      // The store owns H5-specific error state.
    } finally {
      setH5ActionRunning(false)
    }
  }

  const handleH5SettingsSave = async () => {
    if (h5FixedPortInvalid || h5GraceInvalid) return
    await runH5Action(async () => {
      await updateH5AccessSettings({
        publicBaseUrl: h5NextPublicBaseUrl,
        fixedPort: h5NextFixedPort,
        disconnectGraceSeconds: h5NextGrace,
      })
    })
  }

  const handleH5SwitchToSuggestedHost = async () => {
    const suggested = h5AccessDiagnostics?.suggestedHost
    if (!suggested) return
    await runH5Action(async () => {
      // Build URL using current port if available, otherwise let backend pick.
      const port = extractH5AccessPort(h5Access.publicBaseUrl)
      const nextUrl = port ? `http://${suggested}:${port}` : `http://${suggested}`
      await updateH5AccessSettings({ publicBaseUrl: nextUrl })
    })
  }

  const handleH5UrlCopy = async () => {
    if (!h5AccessUrl) return
    const copied = await copyTextToClipboard(h5AccessUrl)
    addToast({
      type: copied ? 'success' : 'error',
      message: copied ? t('settings.general.h5AccessUrlCopied') : t('common.copyFailed'),
    })
  }

  const handleH5LaunchUrlCopy = async () => {
    if (!h5LaunchUrl) return
    const copied = await copyTextToClipboard(h5LaunchUrl)
    addToast({
      type: copied ? 'success' : 'error',
      message: copied ? t('settings.general.h5AccessLaunchUrlCopied') : t('common.copyFailed'),
    })
  }

  const handleH5EnableConfirm = async () => {
    await runH5Action(async () => {
      await enableH5Access()
      setH5TokenVisible(false)
      setH5EnableConfirmOpen(false)
      setTimeout(() => h5EnableTriggerRef.current?.focus(), 0)
    })
  }

  const handleH5EnableConfirmClose = () => {
    if (h5ActionRunning) return
    setH5EnableConfirmOpen(false)
    setTimeout(() => h5EnableTriggerRef.current?.focus(), 0)
  }

  const handleH5Disable = async () => {
    await runH5Action(async () => {
      await disableH5Access()
      setH5TokenVisible(false)
    })
  }

  const handleH5Regenerate = async () => {
    await runH5Action(async () => {
      await regenerateH5AccessToken()
      setH5TokenVisible(false)
    })
  }

  return (
    <div className="max-w-3xl">
      <section aria-labelledby="h5-access-title" role="region">
        <div className="mb-5 flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-container-low)] text-[var(--color-brand)]">
            <QrCode className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2
              id="h5-access-title"
              className="text-base font-semibold text-[var(--color-text-primary)] mb-1"
            >
              {t('settings.general.h5AccessTitle')}
            </h2>
            <p className="text-sm text-[var(--color-text-tertiary)]">
              {t('settings.general.h5AccessDescription')}
            </p>
          </div>
        </div>

        <Card>
          <CardContent className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <Checkbox
                id="h5-access-enabled"
                ref={h5EnableTriggerRef}
                className="mt-1"
                checked={h5Access.enabled}
                disabled={h5ActionRunning}
                aria-label={t('settings.general.h5AccessEnabled')}
                onCheckedChange={(checked) => {
                  if (checked === true) {
                    setH5EnableConfirmOpen(true)
                  } else {
                    void handleH5Disable()
                  }
                }}
              />
              <Label
                htmlFor="h5-access-enabled"
                className="min-w-0 cursor-pointer font-normal"
              >
                <span className="block text-sm font-medium text-[var(--color-text-primary)]">
                  {t('settings.general.h5AccessEnabled')}
                </span>
                <span className="mt-1 block text-xs leading-5 text-[var(--color-text-tertiary)]">
                  {t('settings.general.h5AccessEnabledHint')}
                </span>
              </Label>
            </div>
            <Badge
              variant={h5Access.enabled ? 'default' : 'secondary'}
              className={h5Access.enabled
                ? 'bg-[var(--color-success)] text-white'
                : undefined}
            >
              {h5Access.enabled ? t('settings.general.h5AccessStatusEnabled') : t('settings.general.h5AccessDisabledValue')}
            </Badge>
          </div>

          {h5AccessDiagnostics?.storedHostStaleness === 'unreachable' && h5AccessDiagnostics.storedPublicBaseUrl ? (
            <Alert
              data-testid="h5-access-stale-host-banner"
              className="mt-4 border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10"
            >
              <AlertTitle>
                {t('settings.general.h5AccessStaleHostTitle')}
              </AlertTitle>
              <AlertDescription className="text-[var(--color-text-secondary)]">
                {h5AccessDiagnostics.suggestedHost
                  ? t('settings.general.h5AccessStaleHostBody', {
                      storedHost: extractHostnameFromUrl(h5AccessDiagnostics.storedPublicBaseUrl) ?? h5AccessDiagnostics.storedPublicBaseUrl,
                    })
                  : t('settings.general.h5AccessStaleHostNoSuggestion', {
                      storedHost: extractHostnameFromUrl(h5AccessDiagnostics.storedPublicBaseUrl) ?? h5AccessDiagnostics.storedPublicBaseUrl,
                    })}
              </AlertDescription>
              {h5AccessDiagnostics.suggestedHost && (
                <div className="mt-2">
                  <LoadingButton
                    size="sm"
                    variant="default"
                    loading={h5ActionRunning}
                    onClick={() => void handleH5SwitchToSuggestedHost()}
                    data-testid="h5-access-stale-host-apply"
                  >
                    {t('settings.general.h5AccessStaleHostApply', {
                      suggestedHost: h5AccessDiagnostics.suggestedHost,
                    })}
                  </LoadingButton>
                </div>
              )}
            </Alert>
          ) : null}

          {h5AccessDiagnostics?.storedHostStaleness === 'proxy' ? (
            <Alert
              data-testid="h5-access-proxy-note"
              className="mt-4 bg-[var(--color-surface-container-lowest)]"
            >
              <AlertDescription>{t('settings.general.h5AccessProxyNote')}</AlertDescription>
            </Alert>
          ) : null}

          <div className="mt-4 grid grid-cols-1 gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_9rem]">
              <SettingField
                id="h5-access-public-url"
                label={t('settings.general.h5AccessPublicHost')}
                value={h5PublicBaseUrlDraft}
                placeholder={t('settings.general.h5AccessPublicHostPlaceholder')}
                onChange={(event) => setH5PublicBaseUrlDraft(event.target.value)}
              />
              <SettingField
                id="h5-access-fixed-port"
                label={t('settings.general.h5AccessFixedPort')}
                value={h5FixedPortDraft}
                placeholder={t('settings.general.h5AccessFixedPortPlaceholder')}
                inputMode="numeric"
                error={h5FixedPortInvalid ? t('settings.general.h5AccessFixedPortInvalid') : undefined}
                onChange={(event) => setH5FixedPortDraft(event.target.value)}
              />
              <SettingField
                id="h5-access-current-port"
                label={t('settings.general.h5AccessCurrentPort')}
                value={h5ActivePort ?? t('settings.general.h5AccessCurrentPortUnknown')}
                readOnly
                className="text-[var(--color-text-tertiary)]"
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-start">
              <SettingField
                id="h5-access-disconnect-grace"
                label={t('settings.general.h5AccessDisconnectGrace')}
                value={h5GraceDraft}
                placeholder={t('settings.general.h5AccessDisconnectGracePlaceholder')}
                inputMode="numeric"
                error={h5GraceInvalid ? t('settings.general.h5AccessDisconnectGraceInvalid') : undefined}
                onChange={(event) => setH5GraceDraft(event.target.value)}
              />
              <p className="text-xs leading-5 text-[var(--color-text-tertiary)] sm:pt-7">
                {t('settings.general.h5AccessDisconnectGraceHint')}
              </p>
            </div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-[var(--color-text-tertiary)]">
                {t('settings.general.h5AccessOpenHint')}
                {' '}
                {t('settings.general.h5AccessFixedPortHint')}
              </p>
              <LoadingButton
                size="sm"
                variant="secondary"
                loading={h5ActionRunning}
                onClick={() => void handleH5SettingsSave()}
                disabled={!h5AccessDirty || h5FixedPortInvalid || h5GraceInvalid || h5ActionRunning}
                aria-label={t('settings.general.h5AccessSave')}
              >
                {t('settings.general.h5AccessSave')}
              </LoadingButton>
            </div>
            {h5FixedPortPendingRestart && (
              <Alert
                data-testid="h5-access-fixed-port-restart-note"
                className="border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10"
              >
                <AlertDescription className="text-[var(--color-text-primary)]">
                  {t('settings.general.h5AccessFixedPortRestartNote', {
                    fixedPort: String(h5Access.fixedPort),
                    activePort: h5ActivePort ?? '',
                  })}
                </AlertDescription>
              </Alert>
            )}
          </div>

          {h5AccessUrl && (
            <div className="mt-4 border-t border-[var(--color-border)]/60 pt-4">
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-xs uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
                    {t('settings.general.h5AccessUrl')}
                  </div>
                  <div className="mt-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] break-all">
                    {h5AccessUrl}
                  </div>
                </div>
                <ShadcnButton
                  size="sm"
                  variant="secondary"
                  className="shrink-0"
                  aria-label={t('settings.general.h5AccessCopyUrl')}
                  onClick={() => void handleH5UrlCopy()}
                >
                  <Copy aria-hidden="true" />
                  {t('settings.general.h5AccessCopy')}
                </ShadcnButton>
              </div>
            </div>
          )}

          {h5Access.enabled && h5AccessUrl && (
            <div className="mt-4 border-t border-[var(--color-border)]/60 pt-4">
              <div className="flex flex-col gap-4 sm:flex-row">
                <div className="flex h-48 w-48 shrink-0 items-center justify-center rounded-lg border border-[var(--color-border)] bg-white p-3">
                  {h5QrDataUrl ? (
                    <img
                      src={h5QrDataUrl}
                      alt={t('settings.general.h5AccessQrAlt')}
                      className="h-full w-full"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-3 px-4 text-center">
                      <QrCode className="h-12 w-12 text-neutral-400" aria-hidden="true" />
                      <p className="text-xs leading-5 text-neutral-500">
                        {t('settings.general.h5AccessQrEmptyHint')}
                      </p>
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium uppercase text-[var(--color-text-tertiary)]">
                    {t('settings.general.h5AccessQrTitle')}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">
                    {h5Token
                      ? t('settings.general.h5AccessQrHint')
                      : t('settings.general.h5AccessQrRefreshHint')}
                  </p>
                  {h5LaunchUrl && (
                    <div className="mt-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] break-all">
                      {h5LaunchUrl}
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <ShadcnButton
                      size="sm"
                      variant="secondary"
                      disabled={!h5LaunchUrl || !h5Token}
                      onClick={() => void handleH5LaunchUrlCopy()}
                    >
                      <Copy aria-hidden="true" />
                      {t('settings.general.h5AccessCopyLaunchUrl')}
                    </ShadcnButton>
                    <LoadingButton
                      size="sm"
                      variant={h5Token ? 'secondary' : 'default'}
                      loading={h5ActionRunning}
                      onClick={() => void handleH5Regenerate()}
                    >
                      <RotateCw aria-hidden="true" />
                      {h5Token ? t('settings.general.h5AccessRegenerate') : t('settings.general.h5AccessGenerateToken')}
                    </LoadingButton>
                  </div>
                </div>
              </div>
            </div>
          )}

          {h5Access.enabled && (
            <div className="mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-medium uppercase text-[var(--color-text-tertiary)]">
                    {t('settings.general.h5AccessTokenPreview')}
                  </div>
                  <div className="mt-1 break-all text-sm text-[var(--color-text-primary)]">
                    {h5TokenVisible && h5Token
                      ? h5Token
                      : h5Access.tokenPreview || t('settings.general.h5AccessTokenNotAvailable')}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-2">
                  <ShadcnButton
                    size="sm"
                    variant="secondary"
                    disabled={!h5Token}
                    onClick={() => setH5TokenVisible((visible) => !visible)}
                  >
                    {h5TokenVisible
                      ? <EyeOff aria-hidden="true" />
                      : <Eye aria-hidden="true" />}
                    {h5TokenVisible ? t('settings.general.h5AccessHideToken') : t('settings.general.h5AccessShowToken')}
                  </ShadcnButton>
                  <LoadingButton
                    size="sm"
                    variant="destructive"
                    loading={h5ActionRunning}
                    onClick={() => void handleH5Disable()}
                  >
                    <PowerOff aria-hidden="true" />
                    {t('settings.general.h5AccessDisable')}
                  </LoadingButton>
                </div>
              </div>
            </div>
          )}

          <p className="mt-4 text-xs text-[var(--color-text-tertiary)] leading-5">
            {t('settings.general.h5AccessSafetyNote')}
          </p>
          {h5AccessError && (
            <Alert variant="destructive" className="mt-2">
              <AlertDescription className="text-[var(--color-error)]">
                {h5AccessError}
              </AlertDescription>
            </Alert>
          )}
          </CardContent>
        </Card>
      </section>

      <AlertDialog
        open={h5EnableConfirmOpen}
        onOpenChange={(open) => {
          if (!open) handleH5EnableConfirmClose()
        }}
      >
        <AlertDialogContent
          onEscapeKeyDown={(event) => {
            if (h5ActionRunning) event.preventDefault()
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.general.h5AccessConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('settings.general.h5AccessConfirmBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={h5ActionRunning}>
              {t('common.cancel')}
            </AlertDialogCancel>
            <LoadingButton
              variant="destructive"
              loading={h5ActionRunning}
              onClick={() => void handleH5EnableConfirm()}
            >
              {t('settings.general.h5AccessConfirmEnable')}
            </LoadingButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ─── Skill Settings ──────────────────────────────────────

function SkillSettings() {
  const selectedSkill = useSkillStore((s) => s.selectedSkill)
  const selectedSkillContext = useSkillStore((s) => s.selectedSkillContext)
  const isDetailLoading = useSkillStore((s) => s.isDetailLoading)
  const clearSelection = useSkillStore((s) => s.clearSelection)
  const sessions = useSessionStore((s) => s.sessions)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const [returnFocusKey, setReturnFocusKey] = useState<string | null>(null)
  const hadDetailRef = useRef(false)
  const t = useTranslation()
  const activeSession = sessions.find((session) => session.id === activeSessionId)
  const currentWorkDir = activeSession?.workDir
  const currentContext = currentWorkDir ?? ''
  const showDetail = Boolean(selectedSkill) || isDetailLoading

  useEffect(() => {
    if (
      (selectedSkill || isDetailLoading)
      && selectedSkillContext !== null
      && selectedSkillContext !== currentContext
    ) {
      clearSelection()
    }
  }, [
    clearSelection,
    currentContext,
    isDetailLoading,
    selectedSkill,
    selectedSkillContext,
  ])

  useEffect(() => {
    if (showDetail) {
      hadDetailRef.current = true
      return
    }
    if (!hadDetailRef.current) return
    hadDetailRef.current = false

    requestAnimationFrame(() => {
      const skillRows = Array.from(
        document.querySelectorAll<HTMLButtonElement>('[data-skill-key]'),
      )
      const target = skillRows.find((row) => row.dataset.skillKey === returnFocusKey)
        ?? document.querySelector<HTMLInputElement>('[data-skill-search]')
      target?.scrollIntoView?.({ block: 'nearest' })
      target?.focus()
    })
  }, [returnFocusKey, showDetail])

  return (
    <div className="w-full min-w-0">
      {showDetail && <SkillDetail />}
      <div hidden={showDetail}>
        <h2 className="mb-1 text-base font-semibold text-[var(--color-text-primary)]">
          {t('settings.skills.title')}
        </h2>
        <p className="mb-4 text-sm text-[var(--color-text-tertiary)]">
          {t('settings.skills.description')}
        </p>
        <SkillList onOpenSkill={setReturnFocusKey} />
      </div>
    </div>
  )
}

function PluginSettings() {
  const selectedPlugin = usePluginStore((s) => s.selectedPlugin)
  const selectedPluginContext = usePluginStore((s) => s.selectedPluginContext)
  const isDetailLoading = usePluginStore((s) => s.isDetailLoading)
  const clearSelection = usePluginStore((s) => s.clearSelection)
  const sessions = useSessionStore((s) => s.sessions)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const [returnFocusKey, setReturnFocusKey] = useState<string | null>(null)
  const hadDetailRef = useRef(false)
  const t = useTranslation()
  const activeSession = sessions.find((session) => session.id === activeSessionId)
  const currentContext = activeSession?.workDir ?? ''
  const showDetail = Boolean(selectedPlugin) || isDetailLoading

  useEffect(() => {
    if (
      showDetail
      && selectedPluginContext !== null
      && selectedPluginContext !== currentContext
    ) {
      clearSelection()
    }
  }, [clearSelection, currentContext, selectedPluginContext, showDetail])

  useEffect(() => {
    if (showDetail) {
      hadDetailRef.current = true
      return
    }
    if (!hadDetailRef.current) return
    hadDetailRef.current = false

    requestAnimationFrame(() => {
      const pluginRows = Array.from(
        document.querySelectorAll<HTMLButtonElement>('[data-plugin-key]'),
      )
      const target = pluginRows.find((row) => row.dataset.pluginKey === returnFocusKey)
        ?? pluginRows[0]
        ?? document.querySelector<HTMLElement>('[data-plugin-list-heading]')
      target?.scrollIntoView?.({ block: 'nearest' })
      target?.focus()
    })
  }, [returnFocusKey, showDetail])

  return (
    <div className="w-full min-w-0">
      {showDetail && <PluginDetail />}
      <div hidden={showDetail}>
        <h2
          data-plugin-list-heading
          tabIndex={-1}
          className="mb-1 text-base font-semibold text-[var(--color-text-primary)]"
        >
          {t('settings.plugins.title')}
        </h2>
        <p className="mb-4 text-sm text-[var(--color-text-tertiary)]">
          {t('settings.plugins.description')}
        </p>
        <PluginList onOpenPlugin={setReturnFocusKey} />
      </div>
    </div>
  )
}

// ─── About Settings ──────────────────────────────────────

const GITHUB_REPO = 'https://github.com/NanmiCoder/cc-haha'
const GITHUB_ISSUES = `${GITHUB_REPO}/issues`
const GITHUB_RELEASES = `${GITHUB_REPO}/releases`
const AUTHOR_GITHUB = 'https://github.com/NanmiCoder'
const SOCIAL_LINKS = [
  { name: 'Bilibili', icon: '/icons/bilibili.svg', url: 'https://space.bilibili.com/434377496', label: '程序员阿江-Relakkes' },
  { name: 'Douyin', icon: '/icons/douyin.svg', url: 'https://www.douyin.com/user/MS4wLjABAAAATJPY7LAlaa5X-c8uNdWkvz0jUGgpw4eeXIwu_8BhvqE', label: '程序员阿江-Relakkes' },
  { name: 'Xiaohongshu', icon: '/icons/xiaohongshu.svg', url: 'https://www.xiaohongshu.com/user/profile/5f58bd990000000001003753', label: '程序员阿江-Relakkes' },
] as const

function isValidHttpProxyUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function AboutSettings() {
  const t = useTranslation()
  const [version, setVersion] = useState('')
  const updateProxy = useSettingsStore((s) => s.updateProxy)
  const setUpdateProxy = useSettingsStore((s) => s.setUpdateProxy)
  const updateStatus = useUpdateStore((s) => s.status)
  const availableVersion = useUpdateStore((s) => s.availableVersion)
  const releaseNotes = useUpdateStore((s) => s.releaseNotes)
  const progressPercent = useUpdateStore((s) => s.progressPercent)
  const downloadedBytes = useUpdateStore((s) => s.downloadedBytes)
  const totalBytes = useUpdateStore((s) => s.totalBytes)
  const error = useUpdateStore((s) => s.error)
  const checkedAt = useUpdateStore((s) => s.checkedAt)
  const checkForUpdates = useUpdateStore((s) => s.checkForUpdates)
  const installUpdate = useUpdateStore((s) => s.installUpdate)
  const initialize = useUpdateStore((s) => s.initialize)
  const [showUpdateProxyAdvanced, setShowUpdateProxyAdvanced] = useState(false)
  const [updateProxyDraft, setUpdateProxyDraft] = useState(updateProxy)
  const [updateProxySaveError, setUpdateProxySaveError] = useState<string | null>(null)
  const [isSavingUpdateProxy, setIsSavingUpdateProxy] = useState(false)

  useEffect(() => {
    let cancelled = false

    getDesktopHost().app.getVersion()
      .then((value) => {
        if (!cancelled) setVersion(value)
      })
      .catch(() => {
        if (!cancelled) setVersion('')
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    void initialize()
  }, [initialize])

  useEffect(() => {
    setUpdateProxyDraft(updateProxy)
    setUpdateProxySaveError(null)
  }, [updateProxy])

  const openUrl = (url: string) => {
    void getDesktopHost().shell.open(url).catch(() => window.open(url, '_blank', 'noopener,noreferrer'))
  }

  const checkedAtText =
    checkedAt
      ? new Date(checkedAt).toLocaleString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
          month: 'short',
          day: 'numeric',
        })
      : null
  const updateProxyModes: Array<{ value: UpdateProxyMode; label: string; description: string }> = [
    {
      value: 'system',
      label: t('update.proxyModeSystem'),
      description: t('update.proxyModeSystemDescription'),
    },
    {
      value: 'manual',
      label: t('update.proxyModeManual'),
      description: t('update.proxyModeManualDescription'),
    },
  ]
  const manualProxyUrl = updateProxyDraft.url.trim()
  const manualProxyError =
    updateProxyDraft.mode === 'manual' && !manualProxyUrl
      ? t('update.proxyUrlRequired')
      : updateProxyDraft.mode === 'manual' && !isValidHttpProxyUrl(manualProxyUrl)
        ? t('update.proxyUrlInvalid')
        : null
  const updateProxyDirty =
    updateProxyDraft.mode !== updateProxy.mode ||
    updateProxyDraft.url.trim() !== updateProxy.url.trim()

  const saveUpdateProxy = async () => {
    if (manualProxyError) {
      setUpdateProxySaveError(manualProxyError)
      return
    }

    setIsSavingUpdateProxy(true)
    setUpdateProxySaveError(null)
    try {
      await setUpdateProxy({
        mode: updateProxyDraft.mode,
        url: manualProxyUrl,
      })
    } catch (error) {
      setUpdateProxySaveError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsSavingUpdateProxy(false)
    }
  }

  const hasKnownProgress = typeof totalBytes === 'number' && totalBytes > 0
  const downloadedText = formatBytes(downloadedBytes)
  const updateDescription = (() => {
    if (updateStatus === 'checking') return t('update.checking')
    if (updateStatus === 'downloading') {
      return hasKnownProgress
        ? t('update.progress', { progress: String(progressPercent) })
        : t('update.progressBytes', { downloaded: downloadedText })
    }
    if (updateStatus === 'downloaded') return t('update.downloaded')
    if (updateStatus === 'installing') return t('update.installing')
    if (updateStatus === 'restarting') return t('update.restarting')
    if (updateStatus === 'available' && availableVersion) return t('update.newVersion', { version: availableVersion })
    if (updateStatus === 'up-to-date') return t('update.upToDate', { version: version || t('update.currentVersionUnknown') })
    return t('update.idle')
  })()

  return (
    <div className="w-full min-w-0 max-w-2xl mx-auto flex flex-col items-center py-6">
      {/* Logo + App Name + Version */}
      <img src={publicAssetPath('app-icon.png')} alt="Claude Code Haha" className="w-20 h-20 mb-4" />
      <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Claude Code Haha</h1>
      {version && (
        <div className="mt-1 flex items-center gap-2 text-xs text-[var(--color-text-tertiary)]">
          <span>{t('settings.about.version')} {version}</span>
          <span className="text-[var(--color-border)]">·</span>
          <ShadcnButton
            variant="link"
            size="sm"
            onClick={() => openUrl(GITHUB_RELEASES)}
            className="h-auto rounded-[var(--radius-sm)] p-0 text-xs text-[var(--color-text-accent)] hover:text-[var(--color-brand)]"
          >
            {t('settings.about.changelog')}
          </ShadcnButton>
        </div>
      )}

      {/* GitHub Repo */}
      <div className="mt-6 w-full">
        <ShadcnButton
          variant="outline"
          onClick={() => openUrl(GITHUB_REPO)}
          className="h-auto w-full justify-start gap-3 rounded-xl px-4 py-3"
        >
          <img src={publicAssetPath('icons/github.svg')} alt="GitHub" className="w-5 h-5 opacity-70" />
          <div className="flex-1 text-left">
            <div className="text-sm font-medium text-[var(--color-text-primary)]">NanmiCoder/cc-haha</div>
            <div className="text-xs text-[var(--color-text-tertiary)]">{t('settings.about.starHint')}</div>
          </div>
        </ShadcnButton>
      </div>

      <Card className="mt-4 w-full">
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-medium text-[var(--color-text-primary)]">
              {t('settings.about.updates')}
            </h2>
            <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
              {t('settings.about.updatesDesc')}
            </p>
          </div>
          <LoadingButton
            size="sm"
            variant="secondary"
            loading={updateStatus === 'checking'}
            disabled={updateStatus === 'installing' || updateStatus === 'restarting'}
            onClick={() => void checkForUpdates()}
          >
            {t('update.checkNow')}
          </LoadingButton>
        </CardHeader>

        <CardContent className="pt-0">
          <Card className="bg-[var(--color-surface)]">
            <CardContent className="p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">
                    {t('settings.about.version')}
                  </div>
                  <div className="mt-1 text-sm font-medium text-[var(--color-text-primary)]">
                    {version || t('update.currentVersionUnknown')}
                  </div>
                </div>

                {availableVersion && (
                  <div className="text-right">
                    <div className="text-xs uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">
                      {t('update.availableLabel')}
                    </div>
                    <Badge className="mt-1" variant="secondary">
                      {availableVersion}
                    </Badge>
                  </div>
                )}
              </div>

              <p
                role="status"
                aria-live="polite"
                aria-atomic="true"
                className="mt-3 text-sm text-[var(--color-text-secondary)]"
              >
                {updateDescription}
              </p>

              {error && (
                <Alert variant="destructive" className="mt-3">
                  <AlertDescription className="text-[var(--color-error)]">
                    {t('update.failed', { error })}
                  </AlertDescription>
                </Alert>
              )}

              {checkedAtText && (
                <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
                  {t('update.checkedAt', { time: checkedAtText })}
                </p>
              )}

              <Separator className="my-3" />

              <Collapsible
                open={showUpdateProxyAdvanced}
                onOpenChange={setShowUpdateProxyAdvanced}
              >
                <CollapsibleTrigger asChild>
                  <ShadcnButton
                    className="w-full justify-between px-1"
                    size="sm"
                    variant="ghost"
                  >
                    <span>{t('update.proxyAdvanced')}</span>
                    {showUpdateProxyAdvanced
                      ? <ChevronUp aria-hidden="true" />
                      : <ChevronDown aria-hidden="true" />}
                  </ShadcnButton>
                </CollapsibleTrigger>

                <CollapsibleContent
                  id="update-proxy-advanced-content"
                  className="mt-3 space-y-3"
                >
                  <RadioGroup
                    aria-label={t('update.proxyAdvanced')}
                    className="grid-cols-2"
                    value={updateProxyDraft.mode}
                    onValueChange={(value) => {
                      setUpdateProxyDraft((current) => ({
                        ...current,
                        mode: value as UpdateProxyMode,
                      }))
                      setUpdateProxySaveError(null)
                    }}
                  >
                    {updateProxyModes.map((mode) => (
                      <SettingRadioCard
                        key={mode.value}
                        value={mode.value}
                        label={mode.label}
                        description={mode.description}
                      />
                    ))}
                  </RadioGroup>

                  {updateProxyDraft.mode === 'manual' && (
                    <div className="space-y-1.5">
                      <Label htmlFor="update-proxy-url">
                        {t('update.proxyUrl')}
                      </Label>
                      <ShadcnInput
                        id="update-proxy-url"
                        value={updateProxyDraft.url}
                        placeholder="http://127.0.0.1:7890"
                        autoComplete="off"
                        aria-invalid={!!manualProxyError}
                        aria-describedby="update-proxy-url-description"
                        onChange={(event) => {
                          setUpdateProxyDraft((current) => ({ ...current, url: event.target.value }))
                          setUpdateProxySaveError(null)
                        }}
                      />
                      <p
                        id="update-proxy-url-description"
                        className={`text-[11px] leading-4 ${
                          manualProxyError
                            ? 'text-[var(--color-error)]'
                            : 'text-[var(--color-text-tertiary)]'
                        }`}
                      >
                        {manualProxyError ?? t('update.proxyUrlHint')}
                      </p>
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-3">
                    <p className="min-w-0 text-[11px] leading-4 text-[var(--color-text-tertiary)]">
                      {t('update.proxyScopeHint')}
                    </p>
                    <LoadingButton
                      size="sm"
                      variant="secondary"
                      className="min-w-[72px] whitespace-nowrap px-4"
                      disabled={!updateProxyDirty || !!manualProxyError}
                      loading={isSavingUpdateProxy}
                      onClick={() => void saveUpdateProxy()}
                    >
                      {t('update.proxySave')}
                    </LoadingButton>
                  </div>

                  {updateProxySaveError && (
                    <Alert variant="destructive">
                      <AlertDescription className="text-[var(--color-error)]">
                        {updateProxySaveError}
                      </AlertDescription>
                    </Alert>
                  )}
                </CollapsibleContent>
              </Collapsible>

              {(updateStatus === 'downloading' || updateStatus === 'restarting') && (
                <div className="mt-3">
                  <Progress
                    value={hasKnownProgress || updateStatus === 'restarting' ? progressPercent : null}
                    aria-label={updateDescription}
                    aria-valuetext={updateDescription}
                  />
                  {!hasKnownProgress && updateStatus === 'downloading' && downloadedBytes > 0 && (
                    <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
                      {downloadedText}
                    </p>
                  )}
                </div>
              )}

              {releaseNotes && availableVersion && (
                <Card className="mt-3 border-0 bg-[var(--color-surface-container-low)]">
                  <CardContent className="p-3">
                    <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">
                      {t('update.releaseNotes')}
                    </div>
                    <MarkdownRenderer
                      content={releaseNotes}
                      variant="document"
                      className="mt-2 text-[13px] leading-6 text-[var(--color-text-secondary)] [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm [&_p]:text-[13px] [&_p]:leading-6"
                    />
                  </CardContent>
                </Card>
              )}
            </CardContent>

            {availableVersion && (
              <CardFooter className="justify-end px-3 pb-3">
                <LoadingButton
                  size="sm"
                  onClick={() => void installUpdate()}
                  loading={
                    updateStatus === 'downloading' ||
                    updateStatus === 'installing' ||
                    updateStatus === 'restarting'
                  }
                  disabled={updateStatus === 'checking'}
                >
                  {updateStatus === 'downloaded'
                    ? t('update.installAndRestart')
                    : updateStatus === 'installing'
                      ? t('update.installing')
                      : updateStatus === 'restarting'
                        ? t('update.restarting')
                        : t('update.now')}
                </LoadingButton>
              </CardFooter>
            )}
          </Card>
        </CardContent>
      </Card>

      {/* Divider */}
      <div className="w-full border-t border-[var(--color-border)]/40 my-6" />

      {/* Author */}
      <div className="w-full">
        <h3 className="text-xs font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider mb-3">{t('settings.about.author')}</h3>
        <ShadcnButton
          variant="ghost"
          onClick={() => openUrl(AUTHOR_GITHUB)}
          className="h-auto w-full justify-start gap-3 rounded-lg px-4 py-2.5"
        >
          <img src={publicAssetPath('icons/github.svg')} alt="GitHub" className="w-4 h-4 opacity-60" />
          <span className="text-sm text-[var(--color-text-primary)]">程序员阿江-Relakkes</span>
          <span className="text-xs text-[var(--color-text-tertiary)] ml-auto">GitHub</span>
        </ShadcnButton>
      </div>

      {/* Social Media */}
      <div className="w-full mt-4">
        <h3 className="text-xs font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider mb-3">{t('settings.about.socialMedia')}</h3>
        <div className="flex flex-col gap-0.5">
          {SOCIAL_LINKS.map((link) => (
            <ShadcnButton
              variant="ghost"
              key={link.name}
              onClick={() => openUrl(link.url)}
              className="h-auto w-full justify-start gap-3 rounded-lg px-4 py-2.5"
            >
              <img src={publicAssetPath(link.icon)} alt={link.name} className="w-4 h-4 opacity-60" />
              <span className="text-sm text-[var(--color-text-primary)]">{link.label}</span>
              <span className="text-xs text-[var(--color-text-tertiary)] ml-auto">{link.name}</span>
            </ShadcnButton>
          ))}
        </div>
      </div>

      <div className="mt-6 w-full">
        <ShadcnButton
          variant="outline"
          onClick={() => openUrl(GITHUB_ISSUES)}
          className="h-auto w-full justify-start gap-3 rounded-xl px-4 py-3"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[20px] text-[var(--color-text-tertiary)]">feedback</span>
          <div className="flex-1 text-left">
            <div className="text-sm font-medium text-[var(--color-text-primary)]">{t('settings.about.feedback')}</div>
            <div className="text-xs text-[var(--color-text-tertiary)]">{t('settings.about.feedbackDesc')}</div>
          </div>
        </ShadcnButton>
      </div>
    </div>
  )
}
