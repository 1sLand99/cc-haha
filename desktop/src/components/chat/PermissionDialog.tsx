import { useId, useRef, useState } from 'react'
import {
  BadgeCheck,
  Bot,
  Check,
  ChevronDown,
  CloudDownload,
  FilePenLine,
  FilePlus2,
  FileText,
  FolderOpen,
  Globe2,
  NotebookPen,
  ScanSearch,
  Search,
  Shield,
  Sparkles,
  Terminal,
  Waypoints,
  X,
  type LucideIcon,
} from 'lucide-react'
import { getPendingPermission, useChatStore } from '../../stores/chatStore'
import { useTabStore } from '../../stores/tabStore'
import { useTranslation } from '../../i18n'
import type { TranslationKey } from '../../i18n'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '../ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible'
import { Label } from '../ui/label'
import { Textarea } from '../ui/textarea'
import { DiffViewer } from './DiffViewer'
import {
  PlanPreviewCard,
  buildPromptPermissionUpdates,
  extractPlanPreview,
  isExitPlanModeTool,
} from './PlanModePreview'

type Props = {
  sessionId?: string | null
  requestId: string
  toolName: string
  input: unknown
  description?: string
}

/**
 * Presentation metadata for known tool types.
 */
const TOOL_META: Record<string, { Icon: LucideIcon; label: string; color: string }> = {
  Bash: { Icon: Terminal, label: 'Bash', color: 'var(--color-warning)' },
  Edit: { Icon: FilePenLine, label: 'Edit File', color: 'var(--color-brand)' },
  Write: { Icon: FilePlus2, label: 'Write File', color: 'var(--color-success)' },
  Read: { Icon: FileText, label: 'Read File', color: 'var(--color-secondary)' },
  Glob: { Icon: Search, label: 'Glob Search', color: 'var(--color-secondary)' },
  Grep: { Icon: ScanSearch, label: 'Grep Search', color: 'var(--color-secondary)' },
  Agent: { Icon: Bot, label: 'Agent', color: 'var(--color-tertiary)' },
  WebSearch: { Icon: Globe2, label: 'Web Search', color: 'var(--color-secondary)' },
  WebFetch: { Icon: CloudDownload, label: 'Web Fetch', color: 'var(--color-secondary)' },
  NotebookEdit: { Icon: NotebookPen, label: 'Notebook Edit', color: 'var(--color-brand)' },
  Skill: { Icon: Sparkles, label: 'Skill', color: 'var(--color-tertiary)' },
}

/**
 * Extract human-readable detail lines from tool input.
 */
function extractToolDetails(toolName: string, input: unknown, t: (key: TranslationKey, params?: Record<string, string | number>) => string): { primary: string; secondary?: string } {
  const obj = (input && typeof input === 'object') ? input as Record<string, unknown> : {}

  switch (toolName) {
    case 'Bash': {
      const cmd = typeof obj.command === 'string' ? obj.command : ''
      const desc = typeof obj.description === 'string' ? obj.description : undefined
      return { primary: cmd, secondary: desc }
    }
    case 'Edit': {
      const filePath = typeof obj.file_path === 'string' ? obj.file_path : ''
      return { primary: filePath, secondary: obj.old_string ? t('permission.replacingContent') : undefined }
    }
    case 'Write': {
      const filePath = typeof obj.file_path === 'string' ? obj.file_path : ''
      return { primary: filePath }
    }
    case 'Read': {
      const filePath = typeof obj.file_path === 'string' ? obj.file_path : ''
      return { primary: filePath }
    }
    case 'Glob':
      return { primary: typeof obj.pattern === 'string' ? obj.pattern : '' }
    case 'Grep':
      return { primary: typeof obj.pattern === 'string' ? obj.pattern : '' }
    case 'Agent':
      return { primary: typeof obj.description === 'string' ? obj.description : '' }
    case 'WebSearch':
      return { primary: typeof obj.query === 'string' ? obj.query : '' }
    case 'WebFetch':
      return { primary: typeof obj.url === 'string' ? obj.url : '' }
    default:
      return { primary: typeof input === 'string' ? input : JSON.stringify(input, null, 2) }
  }
}

function getPermissionTitle(toolName: string, input: unknown, t: (key: TranslationKey, params?: Record<string, string | number>) => string) {
  const obj = (input && typeof input === 'object') ? input as Record<string, unknown> : {}
  const filePath = typeof obj.file_path === 'string' ? obj.file_path : ''
  const fileName = filePath ? filePath.split('/').pop() || filePath : ''

  switch (toolName) {
    case 'Edit':
    case 'Write':
      return fileName ? t('permission.allowEditFile', { toolName, fileName }) : t('permission.allowEditFileGeneric', { toolName: toolName.toLowerCase() })
    case 'Bash':
      return t('permission.allowBash')
    default:
      return t('permission.allowTool', { toolName })
  }
}

function renderPermissionPreview(toolName: string, input: unknown) {
  const obj = (input && typeof input === 'object') ? input as Record<string, unknown> : {}
  const filePath = typeof obj.file_path === 'string' ? obj.file_path : 'file'

  if (toolName === 'Edit' && typeof obj.old_string === 'string' && typeof obj.new_string === 'string') {
    return <DiffViewer filePath={filePath} oldString={obj.old_string} newString={obj.new_string} />
  }

  if (toolName === 'Write' && typeof obj.content === 'string') {
    return <DiffViewer filePath={filePath} oldString="" newString={obj.content} />
  }

  if (toolName === 'Bash' && typeof obj.command === 'string') {
    return (
      <div className="overflow-x-auto rounded-[var(--radius-md)] bg-[var(--color-terminal-bg)] px-3 py-2.5">
        <pre className="font-[var(--font-mono)] text-[11px] leading-[1.3] text-[var(--color-terminal-fg)] whitespace-pre-wrap break-words">
          <span className="text-[var(--color-terminal-accent)] select-none">$ </span>{obj.command}
        </pre>
      </div>
    )
  }

  return null
}

export function PermissionDialog({ sessionId, requestId, toolName, input, description }: Props) {
  const { respondToPermission } = useChatStore()
  const activeTabId = useTabStore((s) => s.activeTabId)
  const targetSessionId = sessionId ?? activeTabId
  const pendingPermission = useChatStore((s) => targetSessionId
    ? getPendingPermission(s.sessions[targetSessionId], requestId)
    : undefined)
  const t = useTranslation()
  const isPending = Boolean(pendingPermission)
  const [showRaw, setShowRaw] = useState(false)
  const [isResponding, setIsResponding] = useState(false)
  const respondingRef = useRef(false)

  if (isExitPlanModeTool(toolName)) {
    return (
      <ExitPlanModePermissionDialog
        sessionId={targetSessionId}
        requestId={requestId}
        input={input}
        description={description}
        isPending={isPending}
      />
    )
  }

  const meta = TOOL_META[toolName] || { Icon: Shield, label: toolName, color: 'var(--color-text-tertiary)' }
  const ToolIcon = meta.Icon
  const details = extractToolDetails(toolName, input, t)
  const rawInput = typeof input === 'string' ? input : JSON.stringify(input, null, 2)
  const preview = renderPermissionPreview(toolName, input)
  const title = getPermissionTitle(toolName, input, t)
  const allowRawToggle = !preview
  const permissionContext = (details.primary || description || toolName).slice(0, 160)
  const handleResponse = (
    allowed: boolean,
    options?: Parameters<typeof respondToPermission>[3],
  ) => {
    if (!targetSessionId || respondingRef.current) return
    respondingRef.current = true
    setIsResponding(true)
    respondToPermission(targetSessionId, requestId, allowed, options)
  }

  return (
    <Card
      role="group"
      aria-label={`${title}: ${permissionContext}`}
      className={`mb-4 overflow-hidden rounded-[var(--radius-lg)] border ${
        isPending
          ? 'border-[var(--color-warning)] bg-[var(--color-surface-container-lowest)]'
          : 'border-[var(--color-outline-variant)]/40 bg-[var(--color-surface-container-low)] opacity-70'
      }`}
    >
      {/* Header */}
      <CardHeader className={`flex-row items-center gap-3 px-4 py-3 ${
        isPending
          ? 'bg-[var(--color-surface-container)]'
          : 'bg-[var(--color-surface-container-low)]'
      }`}>
        <div
          className="flex items-center justify-center w-8 h-8 rounded-[var(--radius-md)]"
          style={{ backgroundColor: `${meta.color}18` }}
        >
          <ToolIcon aria-hidden className="size-[18px]" style={{ color: meta.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[var(--color-text-primary)]">
              {title}
            </span>
            {isPending && (
              <Badge className="border-transparent bg-[var(--color-warning)]/15 text-[10px] font-bold uppercase tracking-wider text-[var(--color-warning)]">
                <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-[var(--color-warning)] animate-pulse-dot" />
                {t('permission.awaitingApproval')}
              </Badge>
            )}
            {!isPending && (
              <Badge variant="secondary" className="border-transparent bg-[var(--color-surface-container-high)] text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-tertiary)]">
                {t('permission.responded')}
              </Badge>
            )}
          </div>
          {description && (
            <p className="mt-0.5 text-xs text-[var(--color-text-secondary)] truncate">{description}</p>
          )}
        </div>
      </CardHeader>

      {/* Tool details */}
      <CardContent className="border-t border-[var(--color-outline-variant)]/20 px-4 py-3">
        {preview ? (
          <div className="space-y-2">
            {details.primary && toolName !== 'Bash' ? (
              <div className="flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container)] px-3 py-2 text-xs font-[var(--font-mono)] text-[var(--color-text-secondary)]">
                <FolderOpen aria-hidden className="size-3.5 flex-shrink-0 text-[var(--color-outline)]" />
                <span className="truncate">{details.primary}</span>
              </div>
            ) : null}
            {preview}
          </div>
        ) : details.primary ? (
          <div className="mb-2">
            <div className="flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container)] px-3 py-2 text-xs font-[var(--font-mono)] text-[var(--color-text-secondary)]">
              {toolName === 'Glob' || toolName === 'Grep'
                ? <Search aria-hidden className="size-3.5 flex-shrink-0 text-[var(--color-outline)]" />
                : <FolderOpen aria-hidden className="size-3.5 flex-shrink-0 text-[var(--color-outline)]" />}
              <span className="truncate">{details.primary}</span>
            </div>
          </div>
        ) : null}

        {/* Secondary detail */}
        {details.secondary && (
          <p className="mt-2 text-xs text-[var(--color-text-tertiary)]">{details.secondary}</p>
        )}

        {allowRawToggle && (
          <Collapsible open={showRaw} onOpenChange={setShowRaw}>
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="mt-1 h-7 px-1 text-[11px] text-[var(--color-text-accent)]"
              >
                <ChevronDown
                  aria-hidden
                  className={`size-3.5 transition-transform ${showRaw ? 'rotate-180' : ''}`}
                />
                {showRaw ? t('permission.hideDetails') : t('permission.showFullInput')}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre className="mt-2 max-h-[220px] overflow-y-auto overflow-x-auto rounded-[var(--radius-md)] bg-[var(--color-terminal-bg)] px-3 py-2.5 font-[var(--font-mono)] text-[11px] leading-[1.3] text-[var(--color-terminal-fg)] whitespace-pre-wrap break-words">
                {rawInput}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>

      {/* Action buttons */}
      {isPending && (
        <CardFooter className="gap-2 border-t border-[var(--color-outline-variant)]/20 bg-[var(--color-surface-container-low)] px-4 py-3">
          <Button
            size="sm"
            aria-label={`${t('permission.allow')}: ${permissionContext}`}
            disabled={isResponding}
            aria-busy={isResponding}
            onClick={() => handleResponse(true)}
          >
            <Check aria-hidden className="size-3.5" />
            {t('permission.allow')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`${t('permission.allowForSession')}: ${permissionContext}`}
            disabled={isResponding}
            onClick={() => handleResponse(true, { rule: 'always' })}
          >
            <BadgeCheck aria-hidden className="size-3.5" />
            {t('permission.allowForSession')}
          </Button>
          <div className="flex-1" />
          <Button
            variant="destructive"
            size="sm"
            aria-label={`${t('permission.deny')}: ${permissionContext}`}
            disabled={isResponding}
            onClick={() => handleResponse(false)}
          >
            <X aria-hidden className="size-3.5" />
            {t('permission.deny')}
          </Button>
        </CardFooter>
      )}
    </Card>
  )
}

function ExitPlanModePermissionDialog({
  sessionId,
  requestId,
  input,
  description,
  isPending,
}: {
  sessionId?: string | null
  requestId: string
  input: unknown
  description?: string
  isPending: boolean
}) {
  const { respondToPermission } = useChatStore()
  const t = useTranslation()
  const [feedback, setFeedback] = useState('')
  const [isResponding, setIsResponding] = useState(false)
  const respondingRef = useRef(false)
  const feedbackId = useId()
  const preview = extractPlanPreview(input)
  const permissionUpdates = buildPromptPermissionUpdates(preview.allowedPrompts)
  const trimmedFeedback = feedback.trim()
  const handleResponse = (
    allowed: boolean,
    options?: Parameters<typeof respondToPermission>[3],
  ) => {
    if (!sessionId || respondingRef.current) return
    respondingRef.current = true
    setIsResponding(true)
    respondToPermission(sessionId, requestId, allowed, options)
  }

  return (
    <Card
      role="group"
      aria-label={t('permission.planReadyTitle')}
      className={`mb-4 overflow-hidden rounded-[var(--radius-lg)] border ${
      isPending
        ? 'border-[var(--color-brand)]/60 bg-[var(--color-surface-container-lowest)]'
        : 'border-[var(--color-outline-variant)]/40 bg-[var(--color-surface-container-low)] opacity-70'
    }`}
    >
      <CardHeader className={`flex-row items-center gap-3 px-4 py-3 ${
        isPending
          ? 'bg-[var(--color-surface-container)]'
          : 'bg-[var(--color-surface-container-low)]'
      }`}>
        <div className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-brand)]/15">
          <Waypoints aria-hidden className="size-[18px] text-[var(--color-brand)]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[var(--color-text-primary)]">
              {t('permission.planReadyTitle')}
            </span>
            {isPending ? (
              <Badge className="border-transparent bg-[var(--color-brand)]/15 text-[10px] font-bold uppercase text-[var(--color-brand)]">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--color-brand)] animate-pulse-dot" />
                {t('permission.awaitingApproval')}
              </Badge>
            ) : (
              <Badge variant="secondary" className="border-transparent bg-[var(--color-surface-container-high)] text-[10px] font-bold uppercase text-[var(--color-text-tertiary)]">
                {t('permission.responded')}
              </Badge>
            )}
          </div>
          {description ? (
            <p className="mt-0.5 truncate text-xs text-[var(--color-text-secondary)]">{description}</p>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="space-y-3 border-t border-[var(--color-outline-variant)]/20 px-4 py-3">
        <PlanPreviewCard
          title={t('permission.planPreviewTitle')}
          plan={preview.plan}
          filePath={preview.filePath}
          allowedPrompts={preview.allowedPrompts}
          requestedPermissionsTitle={t('permission.planRequestedPermissions')}
          emptyLabel={t('permission.planEmpty')}
        />
        {isPending ? (
          <div className="space-y-1.5">
            <Label htmlFor={feedbackId} className="text-xs text-[var(--color-text-secondary)]">
              {t('permission.planFeedbackPlaceholder')}
            </Label>
            <Textarea
              id={feedbackId}
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
              placeholder={t('permission.planFeedbackPlaceholder')}
              rows={3}
              className="min-h-[72px] resize-y border-[var(--color-border)] focus-visible:border-[var(--color-brand)]/60 focus-visible:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-brand)_15%,transparent)]"
            />
          </div>
        ) : null}
      </CardContent>

      {isPending ? (
        <CardFooter className="gap-2 border-t border-[var(--color-outline-variant)]/20 bg-[var(--color-surface-container-low)] px-4 py-3">
          <Button
            size="sm"
            disabled={isResponding}
            aria-busy={isResponding}
            onClick={() => handleResponse(true, permissionUpdates.length ? { permissionUpdates } : undefined)}
          >
            <Check aria-hidden className="size-3.5" />
            {t('permission.planApprove')}
          </Button>
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="sm"
            disabled={isResponding}
            onClick={() => handleResponse(false, trimmedFeedback ? { denyMessage: trimmedFeedback } : undefined)}
          >
            <FilePenLine aria-hidden className="size-3.5" />
            {t('permission.planKeepPlanning')}
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  )
}
