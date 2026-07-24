import { useEffect, useMemo, useRef, useState } from 'react'
import { DirectoryPicker } from '../components/shared/DirectoryPicker'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog'
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent } from '../components/ui/card'
import { IconButton } from '../components/ui/custom/icon-button'
import { LoadingButton } from '../components/ui/custom/loading-button'
import { SettingField } from '../components/ui/custom/setting-field'
import { SettingRadioCard } from '../components/ui/custom/setting-radio-card'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { RadioGroup } from '../components/ui/radio-group'
import { Separator } from '../components/ui/separator'
import { Skeleton } from '../components/ui/skeleton'
import { Switch } from '../components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '../components/ui/toggle-group'
import { useTranslation } from '../i18n'
import { useUIStore } from '../stores/uiStore'
import { useMcpStore } from '../stores/mcpStore'
import { useSessionStore } from '../stores/sessionStore'
import { sessionsApi } from '../api/sessions'
import { mcpApi } from '../api/mcp'
import type { McpServerRecord, McpUpsertPayload, McpWritableScope } from '../types/mcp'

type EditorMode =
  | { type: 'list' }
  | { type: 'create' }
  | { type: 'edit'; server: McpServerRecord }
  | { type: 'details'; server: McpServerRecord }

type TransportKind = 'stdio' | 'http' | 'sse'

type StringRow = {
  id: string
  value: string
  containsSensitiveValue?: boolean
}

type KeyValueRow = {
  id: string
  key: string
  value: string
  containsSensitiveValue?: boolean
}

type McpDraft = {
  name: string
  scope: McpWritableScope
  projectPath: string
  transport: TransportKind
  command: string
  args: StringRow[]
  env: KeyValueRow[]
  url: string
  headers: KeyValueRow[]
  headersHelper: string
  oauthClientId: string
  oauthCallbackPort: string
}

type McpGroupKey =
  | 'plugin'
  | 'user'
  | 'project'
  | 'local'
  | 'managed'
  | 'enterprise'
  | 'claudeai'
  | 'dynamic'

const MCP_GROUP_ORDER: McpGroupKey[] = [
  'plugin',
  'user',
  'project',
  'local',
  'managed',
  'enterprise',
  'claudeai',
  'dynamic',
]

const WRITABLE_SCOPES: McpWritableScope[] = ['local', 'project', 'user']

const STATUS_TONE: Record<McpServerRecord['status'], string> = {
  connected: 'bg-[var(--color-inspector-success-bg)] text-[var(--color-inspector-success)] border-[var(--color-border)]',
  checking: 'bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] border-[var(--color-border)]',
  'needs-auth': 'bg-[var(--color-surface-container-low)] text-[var(--color-warning)] border-[var(--color-border)]',
  failed: 'bg-[var(--color-inspector-danger-bg)] text-[var(--color-inspector-danger)] border-[var(--color-border)]',
  disabled: 'bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] border-[var(--color-border)]',
}

const SENSITIVE_MCP_FIELD = /(?:api[_-]?key|auth[_-]?token|authorization|bearer|token|secret|password|credential)/i
const SENSITIVE_CLI_FLAG = /^--(?:api-key|api_key|auth-token|auth_token|authorization|bearer|token|secret|password|credential)$/i
const REDACTED_INPUT_VALUE = '[redacted]'

function isMcpServerNameValid(name: string): boolean {
  const trimmed = name.trim()
  return trimmed.length > 0 && !/[^\p{L}\p{N}_-]/u.test(trimmed)
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/(bearer\s+)(?:"[^"]+"|'[^']+'|[^\s"',}]+)/gi, '$1[redacted]')
    .replace(/(--(?:api-key|api_key|auth-token|auth_token|authorization|bearer|token|secret|password|credential)(?:=|\s+))(?:"[^"]+"|'[^']+'|[^\s"',}]+)/gi, '$1[redacted]')
    .replace(/((?:api[_-]?key|auth[_-]?token|authorization|bearer|token|secret|password|credential)(?:["']?\s*[:=]\s*["']?))([^"',\s}]+)/gi, '$1[redacted]')
    .replace(/\bsk-[A-Za-z0-9][A-Za-z0-9_-]{5,}\b/g, '[redacted]')
}

function redactMcpDisplayValue(value: unknown): unknown {
  if (typeof value === 'string') return redactSensitiveText(value)
  if (Array.isArray(value)) {
    return value.map((item, index) => {
      const previous = value[index - 1]
      if (typeof previous === 'string' && SENSITIVE_CLI_FLAG.test(previous)) return '[redacted]'
      return redactMcpDisplayValue(item)
    })
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        SENSITIVE_MCP_FIELD.test(key) ? '[redacted]' : redactMcpDisplayValue(nested),
      ]),
    )
  }
  return value
}

function displayMcpArgumentValue(rows: StringRow[], index: number): string {
  const row = rows[index]
  if (!row) return ''
  if (row.containsSensitiveValue) return REDACTED_INPUT_VALUE
  const previous = rows[index - 1]?.value
  if (row.value && previous && SENSITIVE_CLI_FLAG.test(previous.trim())) return REDACTED_INPUT_VALUE
  return redactSensitiveText(row.value)
}

function displayMcpKeyValueRowValue(row: KeyValueRow): string {
  if (row.containsSensitiveValue) return REDACTED_INPUT_VALUE
  if (row.value && SENSITIVE_MCP_FIELD.test(row.key)) return REDACTED_INPUT_VALUE
  return redactSensitiveText(row.value)
}

function createId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function createStringRow(value = '', containsSensitiveValue = false): StringRow {
  return { id: createId(), value, containsSensitiveValue }
}

function createKeyValueRow(key = '', value = '', containsSensitiveValue = false): KeyValueRow {
  return { id: createId(), key, value, containsSensitiveValue }
}

function createEmptyDraft(): McpDraft {
  return {
    name: '',
    scope: 'local',
    projectPath: '',
    transport: 'stdio',
    command: '',
    args: [createStringRow('')],
    env: [createKeyValueRow()],
    url: '',
    headers: [createKeyValueRow()],
    headersHelper: '',
    oauthClientId: '',
    oauthCallbackPort: '',
  }
}

function asWritableScope(scope: string): McpWritableScope {
  return scope === 'project' || scope === 'user' ? scope : 'local'
}

function scopeRequiresProject(scope: McpWritableScope) {
  return scope === 'local' || scope === 'project'
}

function serverHasProjectContext(server: Pick<McpServerRecord, 'scope' | 'projectPath'>) {
  return (server.scope === 'local' || server.scope === 'project') && !!server.projectPath
}

function isStdioConfig(config: McpServerRecord['config']): config is Extract<McpServerRecord['config'], { type: 'stdio' }> {
  return config.type === 'stdio'
}

function isRemoteConfig(config: McpServerRecord['config']): config is Extract<McpServerRecord['config'], { type: 'http' | 'sse' }> {
  return config.type === 'http' || config.type === 'sse'
}

function draftFromServer(server: McpServerRecord): McpDraft {
  const base = createEmptyDraft()
  base.name = server.name
  base.scope = asWritableScope(server.scope)
  base.projectPath = scopeRequiresProject(base.scope) ? server.projectPath ?? '' : ''

  if (isStdioConfig(server.config)) {
    const args = server.config.args.length ? server.config.args : ['']
    return {
      ...base,
      transport: 'stdio',
      command: server.config.command,
      args: args.map((value, index) => createStringRow(
        value,
        (index > 0 && SENSITIVE_CLI_FLAG.test(args[index - 1] ?? '')) || redactSensitiveText(value) !== value,
      )),
      env: Object.entries(server.config.env ?? {}).map(([key, value]) => createKeyValueRow(
        key,
        value,
        SENSITIVE_MCP_FIELD.test(key) || redactSensitiveText(value) !== value,
      )).concat(
        Object.keys(server.config.env ?? {}).length === 0 ? [createKeyValueRow()] : [],
      ),
    }
  }

  if (isRemoteConfig(server.config)) {
    return {
      ...base,
      transport: server.config.type,
      url: server.config.url,
      headers: Object.entries(server.config.headers ?? {}).map(([key, value]) => createKeyValueRow(
        key,
        value,
        SENSITIVE_MCP_FIELD.test(key) || redactSensitiveText(value) !== value,
      )).concat(
        Object.keys(server.config.headers ?? {}).length === 0 ? [createKeyValueRow()] : [],
      ),
      headersHelper: server.config.headersHelper ?? '',
      oauthClientId: server.config.oauth?.clientId ?? '',
      oauthCallbackPort: server.config.oauth?.callbackPort ? String(server.config.oauth.callbackPort) : '',
    }
  }

  return base
}

function rowsToRecord(rows: KeyValueRow[]) {
  const entries: Array<[string, string]> = []
  for (const row of rows) {
    const key = row.key.trim()
    if (!key) continue
    entries.push([key, row.value])
  }
  return Object.fromEntries(entries)
}

function rowsToList(rows: StringRow[]) {
  return rows.map((row) => row.value.trim()).filter(Boolean)
}

function buildPayload(draft: McpDraft): McpUpsertPayload {
  if (draft.transport === 'stdio') {
    return {
      scope: draft.scope,
      config: {
        type: 'stdio',
        command: draft.command.trim(),
        args: rowsToList(draft.args),
        env: rowsToRecord(draft.env),
      },
    }
  }

  const oauthCallbackPort = draft.oauthCallbackPort.trim()
  const callbackPortNumber = oauthCallbackPort ? Number(oauthCallbackPort) : undefined
  const oauthClientId = draft.oauthClientId.trim()

  return {
    scope: draft.scope,
    config: {
      type: draft.transport,
      url: draft.url.trim(),
      headers: rowsToRecord(draft.headers),
      ...(draft.headersHelper.trim() ? { headersHelper: draft.headersHelper.trim() } : {}),
      ...(oauthClientId || callbackPortNumber
        ? {
            oauth: {
              ...(oauthClientId ? { clientId: oauthClientId } : {}),
              ...(callbackPortNumber ? { callbackPort: callbackPortNumber } : {}),
            },
          }
        : {}),
    },
  }
}

function isDraftValid(draft: McpDraft) {
  if (!isMcpServerNameValid(draft.name)) return false
  if (scopeRequiresProject(draft.scope) && !draft.projectPath.trim()) return false
  if (draft.transport === 'stdio') return draft.command.trim().length > 0
  return draft.url.trim().length > 0
}

function transportLabel(transport: string, t: ReturnType<typeof useTranslation>) {
  switch (transport) {
    case 'stdio':
      return 'STDIO'
    case 'http':
      return t('settings.mcp.transport.http')
    case 'sse':
      return 'SSE'
    default:
      return transport
  }
}

function getServerGroupKey(server: McpServerRecord): McpGroupKey {
  if (server.name.startsWith('plugin:')) return 'plugin'
  switch (server.scope) {
    case 'user':
    case 'project':
    case 'local':
    case 'managed':
    case 'enterprise':
    case 'claudeai':
    case 'dynamic':
      return server.scope
    default:
      return 'dynamic'
  }
}

function scopeLabel(server: McpServerRecord, t: ReturnType<typeof useTranslation>) {
  const group = getServerGroupKey(server)
  if (group === 'plugin') return t('settings.mcp.scope.plugin')
  return t(`settings.mcp.scope.${group}`)
}

function StatusBadge({ server }: { server: McpServerRecord }) {
  return (
    <Badge
      variant="outline"
      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_TONE[server.status]}`}
    >
      {server.statusLabel}
    </Badge>
  )
}

function getServerIdentityKey(server: Pick<McpServerRecord, 'name' | 'scope' | 'projectPath'>) {
  if (server.scope === 'local' || server.scope === 'project') {
    return `${server.scope}:${server.projectPath ?? ''}:${server.name}`
  }

  return `${server.scope}:${server.name}`
}

function ArraySection({
  title,
  rows,
  onChange,
  onAdd,
  onRemove,
  keyPlaceholder,
  valuePlaceholder,
  singleValue = false,
  addLabel,
  removeLabel,
  displayValue,
}: {
  title: string
  rows: KeyValueRow[] | StringRow[]
  onChange: (id: string, field: 'key' | 'value', value: string) => void
  onAdd: () => void
  onRemove: (id: string) => void
  keyPlaceholder?: string
  valuePlaceholder: string
  singleValue?: boolean
  addLabel: string
  removeLabel: string
  displayValue?: (row: KeyValueRow | StringRow, index: number) => string
}) {
  const rowInputRefs = useRef(new Map<string, HTMLInputElement>())
  const addButtonRef = useRef<HTMLButtonElement | null>(null)
  const previousRowIdsRef = useRef(rows.map((row) => row.id))
  const pendingFocusRef = useRef<string | 'add' | null>(null)

  useEffect(() => {
    const previousIds = new Set(previousRowIdsRef.current)
    const addedRow = rows.find((row) => !previousIds.has(row.id))
    const focusTarget = pendingFocusRef.current ?? addedRow?.id ?? null
    previousRowIdsRef.current = rows.map((row) => row.id)
    pendingFocusRef.current = null

    if (focusTarget === 'add') {
      addButtonRef.current?.focus()
    } else if (focusTarget) {
      rowInputRefs.current.get(focusTarget)?.focus()
    }
  }, [rows])

  return (
    <Card>
      <CardContent className="p-5">
        <div className="text-sm font-semibold text-[var(--color-text-primary)] mb-4">{title}</div>
        <div className="space-y-3">
          {rows.map((row, index) => (
            <div key={row.id} className={`grid gap-3 ${singleValue ? 'grid-cols-[minmax(0,1fr)_32px]' : 'grid-cols-[minmax(0,1fr)_minmax(0,1fr)_32px]'}`}>
              {!singleValue && 'key' in row && (
                <Input
                  ref={(element) => {
                    if (element) rowInputRefs.current.set(row.id, element)
                    else rowInputRefs.current.delete(row.id)
                  }}
                  value={row.key}
                  onChange={(event) => onChange(row.id, 'key', event.target.value)}
                  placeholder={keyPlaceholder}
                  aria-label={`${title} ${keyPlaceholder} ${index + 1}`}
                />
              )}
              <Input
                ref={(element) => {
                  if (singleValue && element) rowInputRefs.current.set(row.id, element)
                  else if (singleValue) rowInputRefs.current.delete(row.id)
                }}
                value={displayValue ? displayValue(row, index) : row.value}
                onChange={(event) => onChange(row.id, 'value', event.target.value)}
                placeholder={valuePlaceholder}
                aria-label={`${title} ${valuePlaceholder} ${index + 1}`}
              />
              <IconButton
                variant="ghost"
                size="icon-sm"
                onClick={() => {
                  pendingFocusRef.current = rows[index + 1]?.id ?? rows[index - 1]?.id ?? 'add'
                  onRemove(row.id)
                }}
                className="mt-1 text-[var(--color-text-tertiary)]"
                label={`${removeLabel} ${title} ${index + 1}`}
              >
                <span className="material-symbols-outlined text-[18px]" aria-hidden="true">delete</span>
              </IconButton>
            </div>
          ))}
          <Button
            ref={addButtonRef}
            variant="secondary"
            onClick={onAdd}
            className="h-12 w-full"
          >
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">add</span>
            {addLabel}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function StatCard({ label, value, icon }: { label: string; value: number; icon: string }) {
  return (
    <Card>
      <CardContent className="px-5 py-4">
        <div className="mb-2 flex items-center gap-2 text-[var(--color-text-tertiary)]">
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">{icon}</span>
          <span className="text-xs font-semibold uppercase tracking-[0.18em]">{label}</span>
        </div>
        <div className="text-3xl font-semibold text-[var(--color-text-primary)]">{value}</div>
      </CardContent>
    </Card>
  )
}

function LoadingState({ label }: { label: string }) {
  return (
    <Card
      role="status"
      aria-live="polite"
      className="min-h-[220px] border-dashed"
    >
      <CardContent className="flex min-h-[218px] flex-col justify-center gap-4">
        <div className="grid gap-4 md:grid-cols-3" aria-hidden="true">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
        <Skeleton className="h-12 w-full" aria-hidden="true" />
        <div className="text-center text-sm font-medium text-[var(--color-text-secondary)]">{label}</div>
      </CardContent>
    </Card>
  )
}

function ServerRow({
  server,
  isBusy,
  onOpen,
  onToggle,
  t,
}: {
  server: McpServerRecord
  isBusy: boolean
  onOpen: () => void
  onToggle: () => void
  t: ReturnType<typeof useTranslation>
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 px-6 py-5 border-t border-[var(--color-border)] first:border-t-0">
      <div className="min-w-0">
        <div className="flex items-center gap-3 mb-2 min-w-0">
          <div className="text-[1.05rem] font-semibold text-[var(--color-text-primary)] truncate">{server.name}</div>
          <StatusBadge server={server} />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-tertiary)]">
          <Badge variant="secondary" className="rounded-full">
            {transportLabel(server.transport, t)}
          </Badge>
          <Badge variant="secondary" className="rounded-full">
            {scopeLabel(server, t)}
          </Badge>
          {serverHasProjectContext(server) && (
            <Badge
              variant="secondary"
              className="max-w-full truncate rounded-full font-[var(--font-mono)] text-[11px] text-[var(--color-text-tertiary)]"
              title={server.projectPath}
            >
              {server.projectPath}
            </Badge>
          )}
          <span className="truncate">{redactSensitiveText(server.summary)}</span>
        </div>
        {server.statusDetail && (
          <div className="mt-2 text-xs text-[var(--color-text-tertiary)] truncate">
            {redactSensitiveText(server.statusDetail)}
          </div>
        )}
      </div>

      <IconButton
        variant="ghost"
        size="icon"
        onClick={onOpen}
        label={`Open ${server.name}`}
        data-mcp-open-key={getServerIdentityKey(server)}
        className="rounded-full"
      >
        <span className="material-symbols-outlined text-[20px]" aria-hidden="true">settings</span>
      </IconButton>

      <Switch
        checked={server.enabled}
        disabled={isBusy || !server.canToggle}
        aria-busy={isBusy || undefined}
        onCheckedChange={onToggle}
        aria-label={server.name}
      />
    </div>
  )
}

export function McpSettings() {
  const { servers, selectedServer, isLoading, error, fetchServers, createServer, updateServer, deleteServer, toggleServer, reconnectServer, refreshServerStatus, selectServer } = useMcpStore()
  const addToast = useUIStore((s) => s.addToast)
  const sessions = useSessionStore((s) => s.sessions)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const t = useTranslation()
  const [view, setView] = useState<EditorMode>({ type: 'list' })
  const [draft, setDraft] = useState<McpDraft>(createEmptyDraft)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [busyServerKey, setBusyServerKey] = useState<string | null>(null)
  const [pendingDeleteServer, setPendingDeleteServer] = useState<McpServerRecord | null>(null)
  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null)
  const addServerTriggerRef = useRef<HTMLButtonElement | null>(null)
  const editorHeadingRef = useRef<HTMLHeadingElement | null>(null)
  const pendingListFocusRef = useRef<string | 'add' | null>(null)
  const projectPathsForFetchRef = useRef<string[] | undefined>(undefined)
  const refreshInFlightRef = useRef(new Set<string>())
  const selectedServerIdentityRef = useRef<string | null>(null)

  const activeSession = sessions.find((session) => session.id === activeSessionId)
  const currentWorkDir = activeSession?.workDir || undefined
  const resolveOperationCwd = (server?: McpServerRecord) => server?.projectPath ?? currentWorkDir

  useEffect(() => {
    let cancelled = false
    setIsInitialLoading(useMcpStore.getState().servers.length === 0)

    const loadServers = async () => {
      try {
        const [recentProjectPaths, privateMcpProjectPaths] = await Promise.all([
          sessionsApi.getRecentProjects(8)
            .then(({ projects }) => projects.map((project) => project.realPath))
            .catch(() => []),
          mcpApi.projectPaths()
            .then(({ projectPaths }) => projectPaths)
            .catch(() => []),
        ])
        if (cancelled) return
        const paths = [
          currentWorkDir,
          ...recentProjectPaths,
          ...privateMcpProjectPaths,
        ].filter((path): path is string => !!path)
        const projectPathsForFetch = Array.from(new Set(paths))
        projectPathsForFetchRef.current = projectPathsForFetch.length ? projectPathsForFetch : undefined
        await fetchServers(projectPathsForFetchRef.current, currentWorkDir)
      } finally {
        if (!cancelled) setIsInitialLoading(false)
      }
    }

    void loadServers()

    return () => {
      cancelled = true
    }
  }, [fetchServers, currentWorkDir])

  const groupedServers = useMemo(() => {
    const groups: Partial<Record<McpGroupKey, McpServerRecord[]>> = {}
    for (const server of servers) {
      const key = getServerGroupKey(server)
      ;(groups[key] ??= []).push(server)
    }
    return groups
  }, [servers])

  const stats = useMemo(() => ({
    total: servers.length,
    connected: servers.filter((server) => server.status === 'connected').length,
    attention: servers.filter((server) => server.status === 'failed' || server.status === 'needs-auth').length,
  }), [servers])
  const showListLoading = (isInitialLoading || isLoading) && servers.length === 0

  useEffect(() => {
    if (view.type !== 'list' || !pendingListFocusRef.current) return

    const focusTarget = pendingListFocusRef.current
    const target = focusTarget === 'add'
      ? addServerTriggerRef.current
      : Array.from(document.querySelectorAll<HTMLButtonElement>('[data-mcp-open-key]'))
          .find((element) => element.dataset.mcpOpenKey === focusTarget) ?? null

    if (!target) return
    pendingListFocusRef.current = null
    target.focus()
  }, [view.type, servers])

  useEffect(() => {
    if (view.type !== 'create') return
    document.getElementById('mcp-name')?.focus()
  }, [view.type])

  useEffect(() => {
    if (view.type !== 'edit' && view.type !== 'details') return
    editorHeadingRef.current?.focus()
  }, [view.type])

  const returnToList = (focusTarget: string | 'add') => {
    pendingListFocusRef.current = focusTarget
    setView({ type: 'list' })
    selectServer(null)
  }

  const beginCreate = () => {
    setDraft(createEmptyDraft())
    setView({ type: 'create' })
  }

  const beginEdit = (server: McpServerRecord) => {
    selectedServerIdentityRef.current = getServerIdentityKey(server)
    selectServer(server)
    if (!server.canEdit) {
      setView({ type: 'details', server })
      return
    }
    setDraft(draftFromServer(server))
    setView({ type: 'edit', server })
  }

  useEffect(() => {
    if (!selectedServer) {
      selectedServerIdentityRef.current = null
      return
    }

    const identity = getServerIdentityKey(selectedServer)
    const isSameSelection = selectedServerIdentityRef.current === identity
    selectedServerIdentityRef.current = identity

    if (selectedServer.canEdit) {
      if (!isSameSelection) setDraft(draftFromServer(selectedServer))
      setView({ type: 'edit', server: selectedServer })
    } else {
      setView({ type: 'details', server: selectedServer })
    }
  }, [selectedServer])

  useEffect(() => {
    const pendingServers = servers.filter((server) => (
      server.enabled &&
      server.status === 'checking' &&
      !refreshInFlightRef.current.has(getServerIdentityKey(server))
    ))

    if (pendingServers.length === 0) return

    let cancelled = false
    const queue = [...pendingServers]
    const workerCount = Math.min(2, queue.length)

    const runWorker = async () => {
      while (!cancelled) {
        const server = queue.shift()
        if (!server) return

        const key = getServerIdentityKey(server)
        refreshInFlightRef.current.add(key)
        try {
          const updated = await refreshServerStatus(server, resolveOperationCwd(server))
          if (cancelled) return

          setView((current) => {
            if (current.type !== 'details' && current.type !== 'edit') return current
            if (getServerIdentityKey(current.server) !== key) return current
            return { ...current, server: updated }
          })
        } catch {
          // Keep passive checks silent. Explicit reconnect remains the action that
          // surfaces failures to the user.
        } finally {
          refreshInFlightRef.current.delete(key)
        }
      }
    }

    void Promise.all(Array.from({ length: workerCount }, () => runWorker()))

    return () => {
      cancelled = true
    }
  }, [servers, refreshServerStatus, currentWorkDir])

  const handleToggle = async (server: McpServerRecord) => {
    setBusyServerKey(getServerIdentityKey(server))
    try {
      const updated = await toggleServer(server, resolveOperationCwd(server), activeSessionId ?? undefined)
      addToast({
        type: 'success',
        message: updated.enabled ? t('settings.mcp.toast.enabled', { name: server.name }) : t('settings.mcp.toast.disabled', { name: server.name }),
      })
    } catch (error) {
      addToast({
        type: 'error',
        message: error instanceof Error ? redactSensitiveText(error.message) : t('settings.mcp.toast.toggleFailed'),
      })
    } finally {
      setBusyServerKey(null)
    }
  }

  const handleReconnect = async (server: McpServerRecord) => {
    if (busyServerKey || isSaving || isDeleting) return

    const optimistic = {
      ...server,
      status: 'checking' as const,
      statusLabel: t('status.reconnecting'),
      statusDetail: undefined,
    }

    setBusyServerKey(getServerIdentityKey(server))
    setView((current) => {
      if (current.type !== 'details' && current.type !== 'edit') return current
      if (getServerIdentityKey(current.server) !== getServerIdentityKey(server)) return current
      return { ...current, server: optimistic }
    })
    try {
      const updated = await reconnectServer(server, resolveOperationCwd(server))
      addToast({
        type: updated.status === 'connected' ? 'success' : 'warning',
        message: updated.status === 'connected'
          ? t('settings.mcp.toast.reconnected', { name: server.name })
          : redactSensitiveText(updated.statusDetail || updated.statusLabel),
      })
      if (view.type === 'edit') setView({ type: 'edit', server: updated })
      if (view.type === 'details') setView({ type: 'details', server: updated })
    } catch (error) {
      setView((current) => {
        if (current.type !== 'details' && current.type !== 'edit') return current
        if (getServerIdentityKey(current.server) !== getServerIdentityKey(server)) return current
        return { ...current, server }
      })
      addToast({
        type: 'error',
        message: error instanceof Error ? redactSensitiveText(error.message) : t('settings.mcp.toast.reconnectFailed'),
      })
    } finally {
      setBusyServerKey(null)
    }
  }

  const handleDelete = (server: McpServerRecord) => {
    if (busyServerKey || isSaving || isDeleting) return
    setPendingDeleteServer(server)
  }

  const confirmDelete = async () => {
    const server = pendingDeleteServer
    if (!server || busyServerKey || isSaving || isDeleting) return
    setIsDeleting(true)
    try {
      await deleteServer(server, resolveOperationCwd(server))
      addToast({
        type: 'success',
        message: t('settings.mcp.toast.deleted', { name: server.name }),
      })
      returnToList('add')
      setPendingDeleteServer(null)
    } catch (error) {
      addToast({
        type: 'error',
        message: error instanceof Error ? redactSensitiveText(error.message) : t('settings.mcp.toast.deleteFailed'),
      })
    } finally {
      setIsDeleting(false)
    }
  }

  const deleteModal = (
    <AlertDialog
      open={pendingDeleteServer !== null}
      onOpenChange={(open) => {
        if (!open && !isDeleting) setPendingDeleteServer(null)
      }}
    >
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          deleteTriggerRef.current?.focus()
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{t('settings.mcp.form.deleteTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {pendingDeleteServer ? t('settings.mcp.form.deleteConfirmBody', { name: pendingDeleteServer.name }) : ''}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>
            {t('settings.mcp.form.cancel')}
          </AlertDialogCancel>
          <LoadingButton
            variant="destructive"
            loading={isDeleting}
            onClick={() => void confirmDelete()}
          >
            {t('settings.mcp.form.confirmDelete')}
          </LoadingButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  const handleSave = async () => {
    if (!isDraftValid(draft) || busyServerKey || isSaving || isDeleting) return
    setIsSaving(true)
    try {
      const payload = buildPayload(draft)
      const operationCwd = scopeRequiresProject(draft.scope) ? draft.projectPath.trim() : undefined
      const saved = view.type === 'edit'
        ? await updateServer(view.server, payload, operationCwd)
        : await createServer(draft.name.trim(), payload, operationCwd)

      addToast({
        type: 'success',
        message: view.type === 'edit'
          ? t('settings.mcp.toast.saved', { name: saved.name })
          : t('settings.mcp.toast.created', { name: saved.name }),
      })
      returnToList(getServerIdentityKey(saved))
    } catch (error) {
      addToast({
        type: 'error',
        message: error instanceof Error ? redactSensitiveText(error.message) : t('settings.mcp.toast.saveFailed'),
      })
    } finally {
      setIsSaving(false)
    }
  }

  const setDraftField = <K extends keyof McpDraft>(key: K, value: McpDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  const updateStringRows = (key: 'args', id: string, value: string) => {
    setDraft((current) => ({
      ...current,
      [key]: current[key].map((row) => (
        row.id === id ? { ...row, value, containsSensitiveValue: false } : row
      )),
    }))
  }

  const updateKeyValueRows = (key: 'env' | 'headers', id: string, field: 'key' | 'value', value: string) => {
    setDraft((current) => ({
      ...current,
      [key]: current[key].map((row) => (
        row.id === id
          ? {
              ...row,
              [field]: value,
              ...(field === 'value' ? { containsSensitiveValue: false } : {}),
            }
          : row
      )),
    }))
  }

  const addRow = (key: 'args' | 'env' | 'headers') => {
    setDraft((current) => ({
      ...current,
      [key]: [...current[key], key === 'args' ? createStringRow() : createKeyValueRow()],
    }))
  }

  const removeRow = (key: 'args' | 'env' | 'headers', id: string) => {
    setDraft((current) => {
      const next = current[key].filter((row) => row.id !== id)
      return {
        ...current,
        [key]: next.length > 0 ? next : [key === 'args' ? createStringRow() : createKeyValueRow()],
      }
    })
  }

  if (view.type === 'details') {
    const server = view.server
    return (
      <>
        <div className="max-w-5xl min-w-0">
          <Button
            variant="ghost"
            size="sm"
            disabled={busyServerKey === getServerIdentityKey(server)}
            onClick={() => {
              returnToList(getServerIdentityKey(server))
            }}
            className="mb-5"
          >
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">arrow_back</span>
            {t('settings.mcp.form.back')}
          </Button>

          <div className="flex items-start justify-between gap-4 mb-8">
            <div>
              <h2
                ref={editorHeadingRef}
                tabIndex={-1}
                className="text-[2.2rem] font-semibold tracking-[-0.03em] text-[var(--color-text-primary)]"
              >
                {server.name}
              </h2>
              <p className="mt-3 text-base text-[var(--color-text-secondary)]">{redactSensitiveText(server.summary)}</p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <StatusBadge server={server} />
                {server.statusDetail && (
                  <span className="text-sm text-[var(--color-text-tertiary)]">
                    {redactSensitiveText(server.statusDetail)}
                  </span>
                )}
              </div>
            </div>
            {server.canReconnect && (
              <LoadingButton
                variant="secondary"
                onClick={() => void handleReconnect(server)}
                loading={busyServerKey === getServerIdentityKey(server)}
              >
                <span className="material-symbols-outlined text-[16px]" aria-hidden="true">sync</span>
                {t('settings.mcp.form.reconnect')}
              </LoadingButton>
            )}
          </div>

          <Card>
            <CardContent className="p-6">
              <div className="grid gap-4 md:grid-cols-2">
                <InfoPair label={t('settings.mcp.form.transport')} value={transportLabel(server.transport, t)} />
                <InfoPair label={t('settings.mcp.form.scope')} value={scopeLabel(server, t)} />
                <InfoPair label={t('settings.mcp.form.status')} value={server.statusLabel} />
                <InfoPair label={t('settings.mcp.form.location')} value={server.configLocation} />
              </div>
              <Separator className="my-5" />
              <div>
                <div className="text-sm font-semibold text-[var(--color-text-primary)] mb-2">{t('settings.mcp.form.rawConfig')}</div>
                <pre className="overflow-x-auto rounded-[var(--radius-lg)] bg-[var(--color-surface-hover)] p-4 text-xs text-[var(--color-text-secondary)]">
                  {JSON.stringify(redactMcpDisplayValue(server.config), null, 2)}
                </pre>
              </div>
            </CardContent>
          </Card>
        </div>
        {deleteModal}
      </>
    )
  }

  if (view.type === 'create' || view.type === 'edit') {
    const editing = view.type === 'edit'
    const targetServer = editing ? view.server : null
    const transportLocked = editing
    const targetMutationBusy = targetServer
      ? busyServerKey === getServerIdentityKey(targetServer)
      : busyServerKey !== null
    const isBusy = isSaving || isDeleting || targetMutationBusy
    const targetProjectPath = draft.projectPath.trim()
    const needsProjectTarget = scopeRequiresProject(draft.scope)
    const targetProjectHint = draft.scope === 'local'
      ? (targetProjectPath
          ? t('settings.mcp.targetProject.localSelected', { path: targetProjectPath })
          : currentWorkDir
            ? t('settings.mcp.targetProject.emptyWithCurrent', { path: currentWorkDir })
            : t('settings.mcp.targetProject.localEmpty'))
      : draft.scope === 'project'
        ? (targetProjectPath
            ? t('settings.mcp.targetProject.projectSelected', { path: targetProjectPath })
            : currentWorkDir
              ? t('settings.mcp.targetProject.emptyWithCurrent', { path: currentWorkDir })
              : t('settings.mcp.targetProject.projectEmpty'))
        : t('settings.mcp.targetProject.globalHint')

    return (
      <>
        <div className="max-w-5xl min-w-0">
          <Button
            variant="ghost"
            size="sm"
            disabled={isBusy}
            onClick={() => {
              returnToList(targetServer ? getServerIdentityKey(targetServer) : 'add')
            }}
            className="mb-5"
          >
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">arrow_back</span>
            {t('settings.mcp.form.back')}
          </Button>

          <div className="flex items-start justify-between gap-4 mb-8">
            <div>
              <h2
                ref={editorHeadingRef}
                tabIndex={-1}
                className="text-[2.2rem] font-semibold tracking-[-0.03em] text-[var(--color-text-primary)]"
              >
                {editing ? t('settings.mcp.form.editTitle', { name: targetServer!.name }) : t('settings.mcp.form.createTitle')}
              </h2>
              <p className="mt-3 text-base text-[var(--color-text-secondary)]">
                {editing ? t('settings.mcp.form.editHint') : t('settings.mcp.form.createHint')}
              </p>
              {editing && targetServer && (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <StatusBadge server={targetServer} />
                  {targetServer.statusDetail && (
                    <span className="text-sm text-[var(--color-text-tertiary)]">
                      {redactSensitiveText(targetServer.statusDetail)}
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-3">
              {editing && targetServer?.canReconnect && (
                <LoadingButton
                  variant="secondary"
                  onClick={() => void handleReconnect(targetServer)}
                  loading={busyServerKey === getServerIdentityKey(targetServer)}
                  disabled={isSaving || isDeleting}
                >
                  <span className="material-symbols-outlined text-[16px]" aria-hidden="true">sync</span>
                  {t('settings.mcp.form.reconnect')}
                </LoadingButton>
              )}
              {editing && targetServer?.canRemove && (
                <LoadingButton
                  ref={deleteTriggerRef}
                  variant="destructive"
                  onClick={() => handleDelete(targetServer)}
                  loading={isDeleting}
                  disabled={isSaving || targetMutationBusy}
                >
                  <span className="material-symbols-outlined text-[16px]" aria-hidden="true">delete</span>
                  {t('settings.mcp.form.uninstall')}
                </LoadingButton>
              )}
            </div>
          </div>

          <fieldset
            disabled={isBusy}
            aria-busy={isBusy || undefined}
            className="space-y-4"
          >
          <Card>
            <CardContent className="p-5">
              <SettingField
                id="mcp-name"
                label={t('settings.mcp.form.name')}
                value={draft.name}
                onChange={(event) => setDraftField('name', event.target.value)}
                placeholder={t('settings.mcp.form.namePlaceholder')}
                disabled={editing}
                required
                aria-invalid={draft.name.length > 0 && !isMcpServerNameValid(draft.name)}
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <Label id="mcp-scope-label" className="mb-3">
                {t('settings.mcp.form.scope')}
              </Label>
              <RadioGroup
                value={draft.scope}
                onValueChange={(value) => setDraftField('scope', value as McpWritableScope)}
                aria-labelledby="mcp-scope-label"
                className="grid gap-2 md:grid-cols-3"
              >
              {WRITABLE_SCOPES.map((scope) => {
                return (
                  <SettingRadioCard
                    key={scope}
                    value={scope}
                    label={t(`settings.mcp.scope.${scope}`)}
                    description={t(`settings.mcp.scopeDesc.${scope}`)}
                  />
                )
              })}
              </RadioGroup>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-[var(--color-text-primary)]">
                    {needsProjectTarget ? t('settings.mcp.targetProject.title') : t('settings.mcp.targetProject.globalTitle')}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">
                    {targetProjectHint}
                  </p>
                </div>
                {needsProjectTarget && (
                  <DirectoryPicker
                    value={draft.projectPath}
                    onChange={(path) => setDraftField('projectPath', path)}
                  />
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <ToggleGroup
              type="single"
              value={draft.transport}
              onValueChange={(value) => {
                if (value) setDraftField('transport', value as TransportKind)
              }}
              disabled={transportLocked}
              aria-label={t('settings.mcp.form.transport')}
              className="grid grid-cols-3 gap-0"
            >
              {(['stdio', 'http', 'sse'] as TransportKind[]).map((transport) => {
                return (
                  <ToggleGroupItem
                    key={transport}
                    value={transport}
                    size="lg"
                    className="h-14 rounded-none border-0 bg-[var(--color-surface)] text-sm first:border-r last:border-l data-[state=on]:bg-[var(--color-surface-selected)] data-[state=on]:text-[var(--color-text-primary)] data-[state=on]:shadow-none"
                  >
                    {transport === 'stdio' ? 'STDIO' : transportLabel(transport, t)}
                  </ToggleGroupItem>
                )
              })}
            </ToggleGroup>
          </Card>

          {editing && (
            <div className="text-sm text-[var(--color-text-tertiary)]">
              {t('settings.mcp.form.transportLocked')}
            </div>
          )}

          {draft.transport === 'stdio' ? (
            <>
              <Card>
                <CardContent className="p-5">
                  <SettingField
                    id="mcp-command"
                    label={t('settings.mcp.form.command')}
                    value={draft.command}
                    onChange={(event) => setDraftField('command', event.target.value)}
                    placeholder={t('settings.mcp.form.commandPlaceholder')}
                    required
                  />
                  <p className="mt-2 text-xs leading-5 text-[var(--color-text-tertiary)]">
                    {t('settings.mcp.form.commandHostHint')}
                  </p>
                </CardContent>
              </Card>

              <ArraySection
                title={t('settings.mcp.form.arguments')}
                rows={draft.args}
                onChange={(id, _field, value) => updateStringRows('args', id, value)}
                onAdd={() => addRow('args')}
                onRemove={(id) => removeRow('args', id)}
                singleValue
                displayValue={(_row, index) => displayMcpArgumentValue(draft.args, index)}
                valuePlaceholder={t('settings.mcp.form.argumentPlaceholder')}
                addLabel={t('settings.mcp.form.addArgument')}
                removeLabel={t('common.delete')}
              />

              <ArraySection
                title={t('settings.mcp.form.environmentVariables')}
                rows={draft.env}
                onChange={(id, field, value) => updateKeyValueRows('env', id, field, value)}
                onAdd={() => addRow('env')}
                onRemove={(id) => removeRow('env', id)}
                displayValue={(row) => ('key' in row ? displayMcpKeyValueRowValue(row) : row.value)}
                keyPlaceholder={t('settings.mcp.form.keyPlaceholder')}
                valuePlaceholder={t('settings.mcp.form.valuePlaceholder')}
                addLabel={t('settings.mcp.form.addEnv')}
                removeLabel={t('common.delete')}
              />
            </>
          ) : (
            <>
              <Card>
                <CardContent className="p-5">
                  <SettingField
                    id="mcp-url"
                    label={draft.transport === 'http' ? t('settings.mcp.form.url') : t('settings.mcp.form.sseUrl')}
                    value={draft.url}
                    onChange={(event) => setDraftField('url', event.target.value)}
                    placeholder={t('settings.mcp.form.urlPlaceholder')}
                    required
                  />
                </CardContent>
              </Card>

              <ArraySection
                title={t('settings.mcp.form.headers')}
                rows={draft.headers}
                onChange={(id, field, value) => updateKeyValueRows('headers', id, field, value)}
                onAdd={() => addRow('headers')}
                onRemove={(id) => removeRow('headers', id)}
                displayValue={(row) => ('key' in row ? displayMcpKeyValueRowValue(row) : row.value)}
                keyPlaceholder={t('settings.mcp.form.keyPlaceholder')}
                valuePlaceholder={t('settings.mcp.form.valuePlaceholder')}
                addLabel={t('settings.mcp.form.addHeader')}
                removeLabel={t('common.delete')}
              />

              <Card>
                <CardContent className="p-5">
                  <div className="grid gap-4 md:grid-cols-2">
                    <SettingField
                      id="mcp-oauth-client-id"
                      label={t('settings.mcp.form.oauthClientId')}
                      value={draft.oauthClientId}
                      onChange={(event) => setDraftField('oauthClientId', event.target.value)}
                      placeholder={t('settings.mcp.form.oauthClientIdPlaceholder')}
                    />
                    <SettingField
                      id="mcp-oauth-callback-port"
                      label={t('settings.mcp.form.oauthCallbackPort')}
                      value={draft.oauthCallbackPort}
                      onChange={(event) => setDraftField('oauthCallbackPort', event.target.value)}
                      placeholder={t('settings.mcp.form.oauthCallbackPortPlaceholder')}
                    />
                  </div>
                  <div className="mt-4">
                    <SettingField
                      id="mcp-headers-helper"
                      label={t('settings.mcp.form.headersHelper')}
                      value={draft.headersHelper}
                      onChange={(event) => setDraftField('headersHelper', event.target.value)}
                      placeholder={t('settings.mcp.form.headersHelperPlaceholder')}
                    />
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          <div className="flex justify-end pt-2">
            <LoadingButton
              onClick={() => void handleSave()}
              disabled={!isDraftValid(draft) || isBusy}
              loading={isSaving}
            >
              {t('settings.mcp.form.save')}
            </LoadingButton>
          </div>
          </fieldset>
        </div>
        {deleteModal}
      </>
    )
  }

  return (
    <div className="max-w-5xl min-w-0">
      <div className="flex items-start justify-between gap-6 mb-8">
        <div>
          <h2 className="text-[2.2rem] font-semibold tracking-[-0.03em] text-[var(--color-text-primary)]">
            {t('settings.mcp.title')}
          </h2>
          <p className="mt-3 text-base text-[var(--color-text-secondary)]">
            {t('settings.mcp.description')}
          </p>
        </div>
        <Button ref={addServerTriggerRef} variant="secondary" size="lg" onClick={beginCreate}>
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">add</span>
          {t('settings.mcp.addServer')}
        </Button>
      </div>

      {showListLoading ? (
        <LoadingState label={t('common.loading')} />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3 mb-8">
            <StatCard label={t('settings.mcp.stats.total')} value={stats.total} icon="dns" />
            <StatCard label={t('settings.mcp.stats.connected')} value={stats.connected} icon="check_circle" />
            <StatCard label={t('settings.mcp.stats.attention')} value={stats.attention} icon="error" />
          </div>

          {error ? (
            <Alert variant="destructive" className="place-items-center border-dashed py-12 text-center">
              <span className="material-symbols-outlined text-[40px]" aria-hidden="true">error</span>
              <AlertTitle>{error}</AlertTitle>
              <AlertDescription>
                <Button
                  variant="link"
                  onClick={() => void fetchServers(projectPathsForFetchRef.current, currentWorkDir)}
                >
                  {t('common.retry')}
                </Button>
              </AlertDescription>
            </Alert>
          ) : servers.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-16 text-center">
                <span className="material-symbols-outlined mb-3 block text-[40px] text-[var(--color-text-tertiary)]" aria-hidden="true">dns</span>
                <p className="mb-1 text-sm text-[var(--color-text-secondary)]">{t('settings.mcp.empty')}</p>
                <p className="text-xs text-[var(--color-text-tertiary)]">{t('settings.mcp.emptyHint')}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="flex flex-col gap-6">
              {MCP_GROUP_ORDER.map((group) => {
                const groupServers = groupedServers[group]
                if (!groupServers?.length) return null

                return (
                  <section key={group}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-[1.35rem] font-semibold text-[var(--color-text-primary)]">
                        {group === 'plugin' ? t('settings.mcp.scope.plugin') : t(`settings.mcp.scope.${group}`)}
                      </div>
                      <div className="text-sm text-[var(--color-text-tertiary)]">{groupServers.length}</div>
                    </div>
                    <Card className="overflow-hidden rounded-[28px] bg-[var(--color-surface)]">
                      <CardContent className="p-0">
                        {groupServers.map((server) => (
                          <ServerRow
                            key={getServerIdentityKey(server)}
                            server={server}
                            isBusy={busyServerKey === getServerIdentityKey(server)}
                            onOpen={() => beginEdit(server)}
                            onToggle={() => void handleToggle(server)}
                            t={t}
                          />
                        ))}
                      </CardContent>
                    </Card>
                  </section>
                )
              })}
            </div>
          )}
        </>
      )}
      {deleteModal}
    </div>
  )
}

function InfoPair({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-lg)] bg-[var(--color-surface-hover)] px-4 py-3">
      <div className="text-xs uppercase tracking-[0.16em] font-semibold text-[var(--color-text-tertiary)] mb-2">{label}</div>
      <div className="text-sm text-[var(--color-text-primary)] break-all">{value}</div>
    </div>
  )
}
