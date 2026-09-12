import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { SearchField } from '@/components/ui/SearchField'
import { Spinner } from '@/components/ui/Spinner'
import { useTranslation } from '../../i18n'
import { useWorkspaceContentStore } from '../../stores/workspaceContentStore'
import { basenameOf } from '../../lib/workspace/types'
import { useRovingTree } from './treeKeyboard'

export type WorkspaceFileTreePaneProps = {
  sessionId: string
  /** Highlighted row; the path of whatever the content area is showing. */
  selectedPath: string | null
  /** Single click previews (replaceable tab), double click pins. */
  onOpen: (path: string, options: { preview: boolean }) => void
}

type TreeRow = {
  path: string
  name: string
  depth: number
  isDirectory: boolean
  expanded: boolean
}

/**
 * The tree lives beside the content, not instead of it.
 *
 * That is the whole point of the layout change: the previous panel hid its
 * navigation the moment a file opened, so browsing a repository meant the
 * structure kept appearing and disappearing. Here it stays put and the content
 * changes underneath the selection.
 */
export function WorkspaceFileTreePane({
  sessionId,
  selectedPath,
  onOpen,
}: WorkspaceFileTreePaneProps) {
  const t = useTranslation()
  const [filter, setFilter] = useState('')
  const clickTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const loadTree = useWorkspaceContentStore((state) => state.loadTree)
  const toggleDirectory = useWorkspaceContentStore((state) => state.toggleDirectory)
  const treeByKey = useWorkspaceContentStore((state) => state.treeByKey)
  const expandedBySession = useWorkspaceContentStore((state) => state.expandedBySession)
  const rootLoading = useWorkspaceContentStore((state) => state.treeLoadingByKey[`${sessionId}::`])

  useEffect(() => {
    void loadTree(sessionId, '')
  }, [loadTree, sessionId])

  useEffect(() => () => {
    for (const timer of clickTimers.current.values()) clearTimeout(timer)
    clickTimers.current.clear()
  }, [])

  const expanded = useMemo(
    () => new Set(expandedBySession[sessionId] ?? []),
    [expandedBySession, sessionId],
  )

  const rows = useMemo(() => {
    const query = filter.trim().toLowerCase()
    const out: TreeRow[] = []

    const walk = (path: string, depth: number) => {
      const node = treeByKey[`${sessionId}::${path}`]
      if (!node || node.state !== 'ok') return
      for (const entry of node.entries) {
        const matches = !query || entry.name.toLowerCase().includes(query)
        // A filter must not make a directory's matching children unreachable,
        // so a directory survives when anything under it survives. That is why
        // the recursion happens before the row is dropped.
        const childStart = out.length
        if (entry.isDirectory && (expanded.has(entry.path) || query)) {
          walk(entry.path, depth + 1)
        }
        const hasVisibleChildren = out.length > childStart
        if (!matches && !hasVisibleChildren) {
          out.length = childStart
          continue
        }
        out.splice(childStart, 0, {
          path: entry.path,
          name: entry.name,
          depth,
          isDirectory: entry.isDirectory,
          expanded: entry.isDirectory && (expanded.has(entry.path) || (!!query && hasVisibleChildren)),
        })
      }
    }

    walk('', 0)
    return out
  }, [expanded, filter, sessionId, treeByKey])

  // Filtering reaches into directories that were never opened, so ask for the
  // listings the filter needs. Without this a query only ever matches what the
  // user had already expanded by hand.
  useEffect(() => {
    if (!filter.trim()) return
    for (const row of rows) {
      if (row.isDirectory) void loadTree(sessionId, row.path)
    }
  }, [filter, loadTree, rows, sessionId])

  const handleActivate = (row: TreeRow) => {
    if (row.isDirectory) {
      void toggleDirectory(sessionId, row.path)
      return
    }
    // Defer the preview open by one double-click window so a double click
    // pins instead of previewing-then-pinning, which would otherwise load the
    // file twice.
    const pending = clickTimers.current.get(row.path)
    if (pending) {
      clearTimeout(pending)
      clickTimers.current.delete(row.path)
      onOpen(row.path, { preview: false })
      return
    }
    const timer = setTimeout(() => {
      clickTimers.current.delete(row.path)
      onOpen(row.path, { preview: true })
    }, 220)
    clickTimers.current.set(row.path, timer)
  }

  const { activePath, handleKeyDown, registerRow, setFocusedPath } = useRovingTree(rows, {
    selectedPath,
    onActivate: handleActivate,
    onToggleDirectory: (row) => { void toggleDirectory(sessionId, row.path) },
  })

  return (
    <div
      data-testid="workspace-file-tree"
      className="flex h-full min-h-0 w-full flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)]"
    >
      <div className="shrink-0 px-2 py-2">
        <SearchField
          value={filter}
          onChange={setFilter}
          size="sm"
          label={t('workspace.files.filter')}
          placeholder={t('workspace.files.filter')}
          clearLabel={t('workspace.clearFilter')}
          data-testid="workspace-file-tree-filter"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-1 pb-2" role="tree" aria-label={t('workspace.files.tree')}>
        {rootLoading && rows.length === 0 ? (
          <div className="flex items-center justify-center py-6">
            <Spinner size={16} label={t('common.loading')} />
          </div>
        ) : rows.length === 0 ? (
          <p className="px-2 py-3 text-[12px] text-[var(--color-text-tertiary)]">
            {t('workspace.files.empty')}
          </p>
        ) : (
          rows.map((row) => {
            const isSelected = !row.isDirectory && row.path === selectedPath
            return (
              <div
                key={row.path}
                ref={registerRow(row.path)}
                role="treeitem"
                // Exactly one row is tabbable; the arrow keys move the tab stop.
                tabIndex={row.path === activePath ? 0 : -1}
                aria-selected={isSelected}
                aria-expanded={row.isDirectory ? row.expanded : undefined}
                // Depth is conveyed by padding for sighted users; without this
                // it reaches assistive tech as a flat list.
                aria-level={row.depth + 1}
                data-testid={`workspace-tree-row-${row.path}`}
                onClick={() => {
                  setFocusedPath(row.path)
                  handleActivate(row)
                }}
                onFocus={() => setFocusedPath(row.path)}
                onKeyDown={(event) => handleKeyDown(event, row)}
                style={{ paddingLeft: 6 + row.depth * 12 }}
                className={[
                  'flex h-6 cursor-default items-center gap-1 rounded-[var(--radius-sm)] pr-2 text-[12px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-border-focus)]',
                  isSelected
                    ? 'bg-[var(--color-surface-container)] text-[var(--color-text-primary)]'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]',
                ].join(' ')}
              >
                <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-[var(--color-text-tertiary)]">
                  {row.isDirectory
                    ? row.expanded
                      ? <ChevronDown size={12} aria-hidden="true" />
                      : <ChevronRight size={12} aria-hidden="true" />
                    : null}
                </span>
                <span className="min-w-0 flex-1 truncate" title={row.path}>
                  {row.name || basenameOf(row.path)}
                </span>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
