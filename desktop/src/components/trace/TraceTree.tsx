import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronDown, ChevronRight, Search } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { previewTraceValue, type TraceSpan, type TraceViewModel } from '../../lib/traceViewModel'
import { formatDurationMs } from '../../lib/trace/formatters'
import { StatusGlyph, TypeIcon, spanDisplayTitle, turnDisplayTitle } from './TraceBadges'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Collapsible, CollapsibleContent } from '../ui/collapsible'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { ScrollArea } from '../ui/scroll-area'
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group'

export type TraceTreeFilter = 'all' | 'llm' | 'tool' | 'error'

type TreeRow = {
  span: TraceSpan
  depth: number
}

type TreeGroup = {
  turnId: string
  turnSpan: TraceSpan
  rows: TreeRow[]
  errorCount: number
}

export function TraceTree({
  viewModel,
  selectedId,
  onSelect,
}: {
  viewModel: TraceViewModel
  selectedId: string | null
  onSelect: (spanId: string) => void
}) {
  const t = useTranslation()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<TraceTreeFilter>('all')
  const [collapsedTurns, setCollapsedTurns] = useState<ReadonlySet<string>>(new Set())
  const scrollRef = useRef<HTMLDivElement>(null)

  const groups = useMemo(
    () => buildTreeGroups(viewModel, filter, query),
    [viewModel, filter, query],
  )

  const navigableIds = useMemo(() => {
    const ids: string[] = []
    for (const group of groups) {
      ids.push(group.turnId)
      if (collapsedTurns.has(group.turnId)) continue
      for (const row of group.rows) ids.push(row.span.id)
    }
    return ids
  }, [groups, collapsedTurns])

  const selectWithTreeFocus = (spanId: string) => {
    onSelect(spanId)
    scrollRef.current?.focus({ preventScroll: true })
  }

  useEffect(() => {
    if (!selectedId) return
    const container = scrollRef.current
    if (!container) return
    const row = container.querySelector<HTMLElement>(`[data-span-id="${CSS.escape(selectedId)}"]`)
    row?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (navigableIds.length === 0) return
    const currentIndex = selectedId ? navigableIds.indexOf(selectedId) : -1
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const nextIndex = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? navigableIds.length - 1
          : event.key === 'ArrowDown'
            ? Math.min(navigableIds.length - 1, currentIndex + 1)
            : Math.max(0, currentIndex <= 0 ? 0 : currentIndex - 1)
      const nextId = navigableIds[nextIndex]
      if (nextId && nextId !== selectedId) onSelect(nextId)
      return
    }

    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    const selectedGroup = groups.find((group) =>
      group.turnId === selectedId || group.rows.some((row) => row.span.id === selectedId),
    )
    if (!selectedGroup) return
    event.preventDefault()
    const isTurnSelected = selectedId === selectedGroup.turnId
    const isCollapsed = collapsedTurns.has(selectedGroup.turnId)
    if (event.key === 'ArrowLeft') {
      if (isTurnSelected && !isCollapsed) toggleTurn(selectedGroup.turnId)
      else if (!isTurnSelected) onSelect(selectedGroup.turnId)
      return
    }
    if (isTurnSelected && isCollapsed) {
      toggleTurn(selectedGroup.turnId)
    } else if (isTurnSelected) {
      const firstRowId = selectedGroup.rows[0]?.span.id
      if (firstRowId) onSelect(firstRowId)
    }
  }

  const toggleTurn = (turnId: string) => {
    setCollapsedTurns((previous) => {
      const next = new Set(previous)
      if (next.has(turnId)) next.delete(turnId)
      else next.add(turnId)
      return next
    })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--color-surface-container-lowest)]" data-testid="trace-tree">
      <div className="shrink-0 border-b border-[var(--color-border)] px-3 py-2.5">
        <Label htmlFor="trace-span-search" className="sr-only">{t('trace.searchSpans')}</Label>
        <div className="relative">
          <Search size={13} strokeWidth={2} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" aria-hidden="true" />
          <Input
            id="trace-span-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('trace.searchSpans')}
            className="h-8 pl-8 text-xs"
          />
        </div>
        <ToggleGroup
          type="single"
          value={filter}
          onValueChange={(value) => {
            if (value) setFilter(value as TraceTreeFilter)
          }}
          variant="default"
          size="sm"
          aria-label={t('trace.filter.aria')}
          className="mt-2 w-fit flex-wrap gap-1"
        >
          {(['all', 'llm', 'tool', 'error'] as const).map((value) => (
            <ToggleGroupItem
              key={value}
              value={value}
              aria-label={filterLabel(value, t)}
              className="h-6 rounded-[var(--radius-sm)] px-2 text-[10px]"
            >
              {filterLabel(value, t)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <ScrollArea
        ref={scrollRef}
        role="tree"
        aria-label={t('trace.tree.aria')}
        aria-activedescendant={selectedId ? treeItemDomId(selectedId) : undefined}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="min-h-0 flex-1 pb-2 outline-none focus-visible:shadow-[var(--shadow-focus-ring)]"
      >
        {groups.length > 0 ? (
          groups.map((group) => (
            <TurnGroup
              key={group.turnId}
              group={group}
              collapsed={collapsedTurns.has(group.turnId)}
              selectedId={selectedId}
              onSelect={selectWithTreeFocus}
              onToggle={() => toggleTurn(group.turnId)}
            />
          ))
        ) : (
          <div role="status" className="px-4 py-8 text-center text-xs text-[var(--color-text-tertiary)]">
            {t('trace.noMatchingSpans')}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}

function TurnGroup({
  group,
  collapsed,
  selectedId,
  onSelect,
  onToggle,
}: {
  group: TreeGroup
  collapsed: boolean
  selectedId: string | null
  onSelect: (spanId: string) => void
  onToggle: () => void
}) {
  const t = useTranslation()
  const turnSpan = group.turnSpan
  const selected = selectedId === group.turnId
  const turnNumber = (turnSpan.turnIndex ?? 0) + 1
  const turnLabel = t('trace.turnLabel', { index: turnNumber })
  const preview = turnPreview(turnSpan, t)

  return (
    <Collapsible open={!collapsed} onOpenChange={(open) => {
      if (open === collapsed) onToggle()
    }}>
      <div
        className={`sticky top-0 z-10 flex items-center gap-1 border-b border-[var(--color-border)]/60 bg-[var(--color-surface-container-lowest)] py-1.5 pl-1.5 pr-3 ${
          selected ? 'shadow-[inset_2px_0_0_var(--color-brand)]' : ''
        }`}
      >
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onToggle}
          tabIndex={-1}
          aria-label={t('trace.tree.toggleTurn')}
          aria-expanded={!collapsed}
          className="size-7 shrink-0 rounded-[var(--radius-sm)]"
        >
          {collapsed
            ? <ChevronRight size={13} strokeWidth={2} />
            : <ChevronDown size={13} strokeWidth={2} />}
        </Button>
        <Button
          variant="ghost"
          type="button"
          onClick={() => onSelect(group.turnId)}
          role="treeitem"
          aria-selected={selected}
          aria-level={1}
          tabIndex={-1}
          id={treeItemDomId(group.turnId)}
          data-span-id={group.turnId}
          onMouseDown={(event) => event.preventDefault()}
          className="h-7 min-w-0 flex-1 justify-start gap-1.5 px-1 text-left"
        >
          <span className={`shrink-0 text-[10px] font-semibold uppercase tracking-[0.08em] ${
            selected ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'
          }`}>
            {turnLabel}
          </span>
          {preview && preview !== turnLabel ? (
            <span className="truncate text-[11px] text-[var(--color-text-tertiary)]">{preview}</span>
          ) : null}
        </Button>
        {group.errorCount > 0 ? (
          <Badge variant="destructive" className="min-h-4 shrink-0 rounded-[var(--radius-sm)] px-1.5 py-0 font-mono text-[10px]">
            {group.errorCount}
          </Badge>
        ) : null}
      </div>
      <CollapsibleContent>
        {group.rows.map((row) => (
          <TreeRowButton
            key={row.span.id}
            row={row}
            selected={selectedId === row.span.id}
            onSelect={() => onSelect(row.span.id)}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}

function TreeRowButton({ row, selected, onSelect }: { row: TreeRow; selected: boolean; onSelect: () => void }) {
  const t = useTranslation()
  const span = row.span
  const preview = rowPreview(span)
  const duration = span.durationMs !== undefined ? formatDurationMs(span.durationMs) : null

  return (
    <Button
      type="button"
      variant="ghost"
      role="treeitem"
      aria-selected={selected}
      aria-level={row.depth + 1}
      tabIndex={-1}
      id={treeItemDomId(span.id)}
      data-span-id={span.id}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSelect}
      className={`trace-row-cv relative flex h-[34px] w-full justify-start gap-2 rounded-none pr-3 text-left transition-colors ${
        selected
          ? 'bg-[var(--color-surface-container-high)]'
          : 'hover:bg-[var(--color-surface-container-low)]'
      }`}
      style={{ paddingLeft: `${12 + row.depth * 14}px` }}
    >
      {selected ? <span className="absolute inset-y-0 left-0 w-[2px] bg-[var(--color-brand)]" aria-hidden="true" /> : null}
      <TypeIcon span={span} />
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span className={`shrink-0 truncate text-xs font-semibold ${
          selected ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'
        }`}>
          {spanDisplayTitle(span, t)}
        </span>
        {preview ? (
          <span className="truncate text-[11px] text-[var(--color-text-tertiary)]">{preview}</span>
        ) : null}
        {span.isSidechain ? (
          <Badge variant="outline" className="min-h-4 shrink-0 rounded-[var(--radius-sm)] px-1 py-0 text-[9px] text-[var(--color-text-tertiary)]">
            {t('trace.sidechain')}
          </Badge>
        ) : null}
      </span>
      {duration ? (
        <span className="shrink-0 font-mono text-[10px] text-[var(--color-text-tertiary)]">{duration}</span>
      ) : null}
      <StatusGlyph status={span.status} />
    </Button>
  )
}

function rowPreview(span: TraceSpan): string | null {
  if (span.kind === 'message' || span.kind === 'event') {
    const preview = span.subtitle
    return preview && preview !== 'empty' ? preview : null
  }
  return null
}

function turnPreview(turnSpan: TraceSpan, t: ReturnType<typeof useTranslation>): string {
  return turnDisplayTitle(turnSpan.title, (turnSpan.turnIndex ?? 0) + 1, t)
}

function buildTreeGroups(viewModel: TraceViewModel, filter: TraceTreeFilter, query: string): TreeGroup[] {
  const visibleIds = filterSpanIds(viewModel, filter, query)
  const depthById = computeDepths(viewModel)
  const groupsByTurn = new Map<string, TreeGroup>()
  const groups: TreeGroup[] = []

  for (const id of viewModel.orderedSpanIds) {
    const span = viewModel.spansById.get(id)
    if (!span) continue
    if (span.kind === 'session') continue
    if (span.kind === 'turn') {
      const group: TreeGroup = { turnId: span.id, turnSpan: span, rows: [], errorCount: 0 }
      groupsByTurn.set(span.id, group)
      groups.push(group)
      continue
    }
    if (span.kind === 'tool_result') continue
    if (span.isLifecycleNoise === true) continue
    if (!visibleIds.has(span.id)) continue
    const turnId = `turn:${span.turnIndex ?? 0}`
    const group = groupsByTurn.get(turnId)
    if (!group) continue
    // Depth relative to the turn header: session=0, turn=1, direct child=2.
    const depth = Math.max(0, (depthById.get(span.id) ?? 2) - 2)
    group.rows.push({ span, depth })
    if (span.status === 'error') group.errorCount += 1
  }

  return groups.filter((group) => group.rows.length > 0 || (!query.trim() && filter === 'all'))
}

function filterSpanIds(viewModel: TraceViewModel, filter: TraceTreeFilter, query: string): Set<string> {
  const normalizedQuery = query.trim().toLowerCase()
  const matched = new Set<string>()
  for (const span of viewModel.spans) {
    const filterMatch =
      filter === 'all' ||
      (filter === 'llm' && span.kind === 'llm') ||
      (filter === 'tool' && (span.kind === 'tool' || span.kind === 'tool_result')) ||
      (filter === 'error' && span.status === 'error')
    const queryMatch = !normalizedQuery || spanSearchText(span).includes(normalizedQuery)
    if (filterMatch && queryMatch) {
      includeWithAncestors(viewModel, span.id, matched)
    }
  }
  return matched
}

function includeWithAncestors(viewModel: TraceViewModel, spanId: string, target: Set<string>) {
  let current = viewModel.spansById.get(spanId)
  while (current) {
    target.add(current.id)
    current = current.parentId ? viewModel.spansById.get(current.parentId) : undefined
  }
}

function spanSearchText(span: TraceSpan): string {
  return [
    span.title,
    span.subtitle,
    span.kind,
    span.status,
    span.toolName,
    span.toolUseId,
    span.call?.model,
    span.call?.provider?.name,
    span.call?.request.url,
    span.event?.phase,
    span.event?.message,
    span.event?.provider?.name,
    previewTraceValue(span.raw, 500),
  ].filter(Boolean).join(' ').toLowerCase()
}

function computeDepths(viewModel: TraceViewModel): Map<string, number> {
  const depths = new Map<string, number>()
  const visit = (id: string, depth: number) => {
    depths.set(id, depth)
    const span = viewModel.spansById.get(id)
    if (!span) return
    for (const childId of span.childIds) visit(childId, depth + 1)
  }
  visit(viewModel.rootId, 0)
  return depths
}

function filterLabel(filter: TraceTreeFilter, t: ReturnType<typeof useTranslation>): string {
  switch (filter) {
    case 'llm': return t('trace.filter.llm')
    case 'tool': return t('trace.filter.tools')
    case 'error': return t('trace.filter.errors')
    default: return t('trace.filter.all')
  }
}

function treeItemDomId(spanId: string): string {
  return `trace-tree-item-${spanId.replace(/[^a-zA-Z0-9_-]/g, '-')}`
}
