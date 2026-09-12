import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Circle,
  Eye,
  Plus,
  RefreshCw,
  Undo2,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { SearchField } from '@/components/ui/SearchField'
import { Spinner } from '@/components/ui/Spinner'
import { useDismissable } from '@/hooks/useDismissable'
import { useTranslation } from '../../i18n'
import { formatBytes } from '../../lib/formatBytes'
import { WorkspaceDiffSurface } from '../workspace/WorkspaceDiffSurface'
import { PanelMessage } from '../workspace/surfaces/PanelMessage'
import { useMenuKeyboard } from './menuKeyboard'
import { useRovingTree } from './treeKeyboard'
import { useWorkspaceReviewStore } from '../../stores/workspaceReviewStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import {
  type WorkspaceReviewSource,
  type WorkspaceReviewTab as WorkspaceReviewTabModel,
} from '../../lib/workspace/types'
import type { ReviewFile } from '../../api/review'

const SOURCE_OPTIONS: readonly WorkspaceReviewSource[] = [
  { kind: 'unstaged' },
  { kind: 'staged' },
  { kind: 'uncommitted' },
]

export type WorkspaceReviewTabProps = {
  sessionId: string
  tab: WorkspaceReviewTabModel
  /** Branch offered in the comparison picker, when the repo reports one. */
  defaultBranchRef?: string | null
}

/** One row of the change tree: a directory group, or a changed file. */
type ChangeRow = {
  path: string
  name: string
  depth: number
  isDirectory: boolean
  expanded: boolean
  file?: ReviewFile
}

type ChangeGroup = {
  name: string
  path: string
  directories: Map<string, ChangeGroup>
  files: ReviewFile[]
}

function emptyGroup(name: string, path: string): ChangeGroup {
  return { name, path, directories: new Map(), files: [] }
}

/**
 * Group the changed files by directory.
 *
 * A flat list of basenames cannot tell two `index.ts` apart, which is exactly
 * the shape a change set tends to have. The reference groups by directory, and
 * so does this.
 */
function buildChangeRows(files: readonly ReviewFile[], collapsed: ReadonlySet<string>): ChangeRow[] {
  const root = emptyGroup('', '')

  for (const file of files) {
    const segments = file.path.split('/')
    segments.pop()
    let group = root
    let prefix = ''
    for (const segment of segments) {
      prefix = prefix ? `${prefix}/${segment}` : segment
      const existing = group.directories.get(segment) ?? emptyGroup(segment, prefix)
      group.directories.set(segment, existing)
      group = existing
    }
    group.files.push(file)
  }

  const rows: ChangeRow[] = []
  const walk = (group: ChangeGroup, depth: number) => {
    for (const directory of group.directories.values()) {
      const expanded = !collapsed.has(directory.path)
      rows.push({
        path: directory.path,
        name: directory.name,
        depth,
        isDirectory: true,
        expanded,
      })
      if (expanded) walk(directory, depth + 1)
    }
    for (const file of group.files) {
      rows.push({
        path: file.path,
        name: file.path.split('/').pop() ?? file.path,
        depth,
        isDirectory: false,
        expanded: false,
        file,
      })
    }
  }
  walk(root, 0)
  return rows
}

/** Split a path so the ellipsis can eat the front and leave the filename whole. */
function splitForStartTruncation(value: string): { head: string; tail: string } {
  const cut = value.lastIndexOf('/')
  if (cut < 0) return { head: '', tail: value }
  return { head: value.slice(0, cut), tail: value.slice(cut + 1) }
}

function useSourceLabel() {
  const t = useTranslation()
  return useCallback((source: WorkspaceReviewSource) => {
    switch (source.kind) {
      case 'unstaged':
        return t('workspace.review.sourceUnstaged')
      case 'staged':
        return t('workspace.review.sourceStaged')
      case 'uncommitted':
        return t('workspace.review.sourceUncommitted')
      case 'branch':
        return t('workspace.review.sourceBranch', { ref: source.baseRef })
      case 'turn':
        return t('workspace.review.sourceTurn')
      case 'commit':
        return t('workspace.review.sourceCommit', { sha: source.commit.slice(0, 8) })
    }
  }, [t])
}

/**
 * Git review: an explicit comparison, its change tree, and real index and
 * working-tree operations.
 *
 * Every write carries the snapshot the user was looking at. A `stale` answer
 * means nothing was applied — the banner asks for a refresh rather than
 * retrying, because a silent retry would apply a hunk to content that has
 * changed since it was read.
 */
export function WorkspaceReviewTab({
  sessionId,
  tab,
  defaultBranchRef,
}: WorkspaceReviewTabProps) {
  const t = useTranslation()
  const sourceLabel = useSourceLabel()
  const [filter, setFilter] = useState('')
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false)
  const [collapsedDirs, setCollapsedDirs] = useState<ReadonlySet<string>>(() => new Set())
  const [pendingRevert, setPendingRevert] = useState<string[] | null>(null)
  const [operationError, setOperationError] = useState<string | null>(null)
  const sourceMenuRef = useRef<HTMLDivElement>(null)
  const sourceTriggerRef = useRef<HTMLButtonElement>(null)
  const sectionRefs = useRef(new Map<string, HTMLElement>())
  const fieldIds = useId()

  const source = tab.source
  const selectedPath = tab.selectedPath
  const entry = useWorkspaceReviewStore((state) => state.getEntry(sessionId, source))
  const load = useWorkspaceReviewStore((state) => state.load)
  const loadDiff = useWorkspaceReviewStore((state) => state.loadDiff)
  const writable = !entry.readOnly
  // Computed from the status already on screen, before the write: a deletion of
  // an untracked file is the one revert outcome Git cannot undo, so the dialog
  // has to say so and name the files rather than promising a recoverable copy.
  const revertPlan = useMemo(
    () => useWorkspaceReviewStore.getState().describeRevert(sessionId, source, pendingRevert ?? []),
    [pendingRevert, sessionId, source],
  )

  const closeSourceMenu = useCallback(() => setSourceMenuOpen(false), [])

  useDismissable({
    open: sourceMenuOpen,
    refs: [sourceMenuRef, sourceTriggerRef],
    onDismiss: closeSourceMenu,
  })

  const handleSourceMenuKeyDown = useMenuKeyboard({
    open: sourceMenuOpen,
    menuRef: sourceMenuRef,
    triggerRef: sourceTriggerRef,
    onClose: closeSourceMenu,
  })

  useEffect(() => {
    void load(sessionId, source)
  }, [load, sessionId, source])

  const files = entry.status?.files ?? []
  const untracked = useMemo(() => new Set(entry.status?.untracked ?? []), [entry.status])

  /**
   * The typed query narrows the content; the change-tree selection does not.
   *
   * Selecting a file used to filter every other section out of the panel, which
   * turned "take me to this file" into "hide the rest of the review" — the diff
   * above and below the selection is most of what a review is for. Spec §4.3
   * asks for 单文件定位: locate it, keep it mounted next to its neighbours.
   */
  const visibleFiles = useMemo(() => {
    const query = filter.trim().toLowerCase()
    return query ? files.filter((file) => file.path.toLowerCase().includes(query)) : files
  }, [files, filter])

  // Requested per section as it scrolls into view. Fetching every file on mount
  // meant a 200-file review issued 200 requests at once, each spawning several
  // `git` processes.
  const requestDiff = useCallback((file: ReviewFile) => {
    if (file.binary || file.conflicted || file.statsTruncated) return
    void loadDiff(sessionId, source, file.path, file.oldPath)
  }, [loadDiff, sessionId, source])

  const locate = useCallback((path: string) => {
    // jsdom implements no scrolling at all, and a section can be unmounted by
    // an in-flight filter, so both the node and the method are optional.
    sectionRefs.current.get(path)?.scrollIntoView?.({ block: 'start' })
  }, [])

  useEffect(() => {
    if (selectedPath) locate(selectedPath)
  }, [locate, selectedPath])

  const runWrite = useCallback(async (
    operation: 'stage' | 'unstage' | 'revert',
    paths: string[],
  ) => {
    setOperationError(null)
    const result = await useWorkspaceReviewStore.getState()[operation](sessionId, source, paths)
    if (result.state === 'refused') {
      // A refusal used to be a silent `null`: the button moved and nothing
      // happened, with no way to tell whether it had worked.
      if (result.refusal === 'no_paths') return
      setOperationError(t(result.refusal === 'no_snapshot'
        ? 'workspace.review.refusedNoSnapshot'
        : 'workspace.review.readOnlySource'))
      return
    }
    if (result.state === 'stale') return
    const failed = result.results.filter((item) => !item.ok)
    if (failed.length > 0) {
      setOperationError(t('workspace.review.failed', {
        reason: failed.map((item) => `${item.path}: ${item.error ?? ''}`).join('; '),
      }))
    }
  }, [sessionId, source, t])

  const sourceOptions = useMemo(() => (
    defaultBranchRef
      ? [...SOURCE_OPTIONS, { kind: 'branch', baseRef: defaultBranchRef } as WorkspaceReviewSource]
      : SOURCE_OPTIONS
  ), [defaultBranchRef])

  const changeRows = useMemo(
    () => buildChangeRows(visibleFiles, collapsedDirs),
    [collapsedDirs, visibleFiles],
  )

  const toggleDirectory = useCallback((path: string) => {
    setCollapsedDirs((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const selectFile = useCallback((path: string) => {
    // Always select rather than toggle: with the content no longer filtered,
    // clicking a row again means "take me back there".
    useWorkspaceStore.getState().setReviewSelectedPath(sessionId, tab.id, path)
    locate(path)
  }, [locate, sessionId, tab.id])

  const {
    activePath,
    handleKeyDown: handleTreeKeyDown,
    registerRow,
    setFocusedPath,
  } = useRovingTree(changeRows, {
    selectedPath,
    onActivate: (row) => {
      if (row.isDirectory) toggleDirectory(row.path)
      else selectFile(row.path)
    },
    onToggleDirectory: (row) => toggleDirectory(row.path),
  })

  const totals = entry.status?.totals

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <div
          data-testid="workspace-review-toolbar"
          className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-2"
        >
          <span className="relative shrink-0">
            <button
              ref={sourceTriggerRef}
              type="button"
              data-testid="workspace-review-source"
              /*
                `aria-label` used to sit here and overrode the visible text, so
                the control announced "Comparison" and never which comparison.
                Labelling by reference keeps both halves.
              */
              aria-labelledby={`${fieldIds}-source-label ${fieldIds}-source-value`}
              aria-haspopup="menu"
              aria-expanded={sourceMenuOpen}
              onClick={() => setSourceMenuOpen((open) => !open)}
              className="flex h-7 items-center gap-1 rounded-[var(--radius-sm)] px-1.5 text-[12px] font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
            >
              <span id={`${fieldIds}-source-label`} className="sr-only">
                {t('workspace.review.sourceLabel')}
              </span>
              <span id={`${fieldIds}-source-value`}>{sourceLabel(source)}</span>
              <ChevronDown size={11} aria-hidden="true" />
            </button>
            {sourceMenuOpen ? (
              <div
                ref={sourceMenuRef}
                role="menu"
                aria-label={t('workspace.review.sourceLabel')}
                onKeyDown={handleSourceMenuKeyDown}
                className="absolute left-0 top-8 z-[var(--z-dropdown)] min-w-[200px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] py-1 shadow-[var(--shadow-dropdown)]"
              >
                {sourceOptions.map((option) => (
                  <button
                    key={`${option.kind}-${'baseRef' in option ? option.baseRef : ''}`}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setSourceMenuOpen(false)
                      useWorkspaceStore.getState().setReviewSource(sessionId, tab.id, option)
                    }}
                    className="w-full px-3.5 py-1.5 text-left text-[12px] text-[var(--color-text-primary)] outline-none transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-border-focus)]"
                  >
                    {sourceLabel(option)}
                  </button>
                ))}
              </div>
            ) : null}
          </span>

          {totals ? (
            <span className="shrink-0 font-mono text-[11px] tabular-nums">
              <span className="text-[var(--color-success)]">+{totals.additions}</span>
              {' '}
              <span className="text-[var(--color-error)]">-{totals.deletions}</span>
            </span>
          ) : null}
          {entry.status?.source.resolvedBase ? (
            <span className="min-w-0 truncate font-mono text-[11px] text-[var(--color-text-tertiary)]">
              {t('workspace.review.resolvedBase', {
                ref: entry.status.source.resolvedBase.slice(0, 10),
              })}
            </span>
          ) : null}

          <span className="ml-auto flex shrink-0 items-center gap-0.5">
            <IconButton
              icon={<RefreshCw size={14} strokeWidth={1.9} />}
              label={t('workspace.review.refresh')}
              size="xs"
              tone="muted"
              data-testid="workspace-review-refresh"
              onClick={() => { void load(sessionId, source, { force: true }) }}
            />
          </span>
        </div>

        {entry.stale ? (
          <p
            role="alert"
            data-testid="workspace-review-stale"
            className="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-warning-container)] px-3 py-1.5 text-[11px] text-[var(--color-on-warning-container)]"
          >
            {t('workspace.review.stale')}
          </p>
        ) : null}
        {operationError ? (
          <p
            role="alert"
            className="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-error-container)] px-3 py-1.5 text-[11px] text-[var(--color-on-error-container)]"
          >
            {operationError}
          </p>
        ) : null}
        {entry.lastDeletedPaths.length > 0 ? (
          <p
            role="status"
            className="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-warning-container)] px-3 py-1.5 text-[11px] text-[var(--color-on-warning-container)]"
          >
            {t('workspace.review.revertDeleted', {
              count: entry.lastDeletedPaths.length,
              path: entry.lastBackupDir ?? '',
            })}
          </p>
        ) : null}
        {entry.lastBackupDir ? (
          <p className="shrink-0 border-b border-[var(--color-border)] px-3 py-1.5 text-[11px] text-[var(--color-text-tertiary)]">
            {t('workspace.review.backupSaved', { path: entry.lastBackupDir })}
          </p>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {entry.loading && !entry.status ? (
            <div className="flex items-center justify-center py-8">
              <Spinner size={18} label={t('common.loading')} />
            </div>
          ) : entry.status?.state === 'not_git_repo' ? (
            <PanelMessage icon="folder_off" message={t('workspace.review.notGitRepo')} />
          ) : entry.status?.state === 'missing_workdir' ? (
            <PanelMessage icon="folder_off" tone="error" message={t('workspace.review.missingWorkdir')} />
          ) : entry.status?.state === 'no_head' ? (
            <PanelMessage icon="history" message={t('workspace.review.noHead')} />
          ) : entry.error ? (
            <PanelMessage icon="error" tone="error" message={entry.error} />
          ) : visibleFiles.length === 0 ? (
            <PanelMessage icon="check_circle" message={t('workspace.review.empty')} />
          ) : (
            visibleFiles.map((file) => (
              <ReviewFileSection
                key={file.path}
                file={file}
                registerSection={(node) => {
                  if (node) sectionRefs.current.set(file.path, node)
                  else sectionRefs.current.delete(file.path)
                }}
                untracked={untracked.has(file.path)}
                writable={writable}
                viewed={entry.viewedPaths.includes(file.path)}
                diff={entry.diffsByPath[file.path]?.diff}
                diffTruncated={entry.diffsByPath[file.path]?.truncated}
                diffBytes={entry.diffsByPath[file.path]?.bytes}
                diffLoading={entry.diffLoadingByPath[file.path] === true}
                onReachedView={() => requestDiff(file)}
                onStage={() => { void runWrite('stage', [file.path]) }}
                onUnstage={() => { void runWrite('unstage', [file.path]) }}
                onRevert={() => setPendingRevert([file.path])}
                onToggleViewed={() =>
                  useWorkspaceReviewStore.getState().toggleViewed(sessionId, source, file.path)}
              />
            ))
          )}
        </div>

        {/*
          The bulk actions are a labelled bar of their own, away from the
          per-file icons. They were two 2xs icon buttons in the toolbar, pixel
          -identical to the per-file revert/stage pair about 30px below them:
          "discard this file" and "discard everything" were the same gesture
          aimed slightly differently.
        */}
        {writable && files.length > 0 ? (
          <div
            data-testid="workspace-review-bulk-bar"
            className="flex h-11 shrink-0 items-center justify-end gap-2 border-t border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-3"
          >
            <Button
              variant="danger-outline"
              size="base"
              icon={<Undo2 size={13} strokeWidth={1.9} />}
              data-testid="workspace-review-revert-all"
              onClick={() => setPendingRevert(
                // Untracked files are deliberately excluded: a bulk discard
                // must not delete files Git has never seen.
                files.filter((file) => !untracked.has(file.path)).map((file) => file.path),
              )}
            >
              {t('workspace.review.revertAll')}
            </Button>
            <Button
              variant="secondary"
              size="base"
              icon={<Plus size={13} strokeWidth={1.9} />}
              data-testid="workspace-review-stage-all"
              onClick={() => { void runWrite('stage', files.map((file) => file.path)) }}
            >
              {t('workspace.review.stageAll')}
            </Button>
          </div>
        ) : null}
      </div>

      <div className="hidden w-[280px] shrink-0 flex-col border-l border-[var(--color-border)] md:flex">
        <div className="shrink-0 px-2 py-2">
          <SearchField
            value={filter}
            onChange={setFilter}
            size="sm"
            label={t('workspace.review.filterFiles')}
            placeholder={t('workspace.review.filterFiles')}
            clearLabel={t('workspace.clearFilter')}
            data-testid="workspace-review-filter"
          />
        </div>
        <div
          className="min-h-0 flex-1 overflow-auto px-1 pb-2"
          role="tree"
          aria-label={t('workspace.review.changeTree')}
        >
          {changeRows.map((row) => {
            const selected = !row.isDirectory && selectedPath === row.path
            return (
              <div
                key={row.path}
                ref={registerRow(row.path)}
                role="treeitem"
                tabIndex={row.path === activePath ? 0 : -1}
                aria-level={row.depth + 1}
                aria-expanded={row.isDirectory ? row.expanded : undefined}
                aria-selected={row.isDirectory ? undefined : selected}
                // The selection locates a section rather than filtering the
                // panel, so it is "the one you are looking at", not "the one
                // shown".
                aria-current={selected ? 'true' : undefined}
                data-testid={row.isDirectory
                  ? `workspace-review-dir-${row.path}`
                  : `workspace-review-file-${row.path}`}
                onFocus={() => setFocusedPath(row.path)}
                onClick={() => {
                  setFocusedPath(row.path)
                  if (row.isDirectory) toggleDirectory(row.path)
                  else selectFile(row.path)
                }}
                onKeyDown={(event) => handleTreeKeyDown(event, row)}
                style={{ paddingLeft: 6 + row.depth * 12 }}
                className={[
                  'flex h-6 cursor-default items-center gap-1.5 rounded-[var(--radius-sm)] pr-1.5 text-left text-[12px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-border-focus)]',
                  selected
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
                  {row.name}
                </span>
                {row.file?.conflicted ? (
                  <Circle size={8} aria-hidden="true" className="shrink-0 fill-[var(--color-error)] text-[var(--color-error)]" />
                ) : null}
                {row.file ? (
                  <span className="shrink-0 font-mono text-[10px] text-[var(--color-text-tertiary)]">
                    {untracked.has(row.file.path) ? 'U' : row.file.staged ? 'S' : 'M'}
                  </span>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>

      <ConfirmDialog
        open={pendingRevert !== null}
        onClose={() => setPendingRevert(null)}
        onConfirm={async () => {
          const paths = pendingRevert
          setPendingRevert(null)
          if (paths) await runWrite('revert', paths)
        }}
        title={revertPlan.deletePaths.length > 0
          ? t('workspace.review.revertDeleteTitle')
          : t('workspace.review.revertTitle')}
        body={revertPlan.deletePaths.length > 0
          ? [
              t('workspace.review.revertDeleteBody', { count: revertPlan.deletePaths.length }),
              t('workspace.review.revertDeleteList', { paths: revertPlan.deletePaths.join(', ') }),
              revertPlan.revertPaths.length > 0
                ? t('workspace.review.revertTrackedBody', { count: revertPlan.revertPaths.length })
                : '',
            ].filter(Boolean).join('\n')
          : [
              t('workspace.review.revertBody', { count: revertPlan.revertPaths.length }),
              t('workspace.review.revertUntrackedWarning'),
            ].join('\n')}
        confirmLabel={t('workspace.review.revert')}
        cancelLabel={t('common.cancel')}
        confirmVariant="danger"
      />
    </div>
  )
}

function ReviewFileSection({
  file,
  registerSection,
  untracked,
  writable,
  viewed,
  diff,
  diffTruncated,
  diffBytes,
  diffLoading,
  onReachedView,
  onStage,
  onUnstage,
  onRevert,
  onToggleViewed,
}: {
  file: ReviewFile
  registerSection: (node: HTMLElement | null) => void
  untracked: boolean
  writable: boolean
  viewed: boolean
  diff?: string
  /** The file was past the diff cap; `diff` is a header with no hunk. */
  diffTruncated?: boolean
  diffBytes?: number
  diffLoading: boolean
  onReachedView: () => void
  onStage: () => void
  onUnstage: () => void
  onRevert: () => void
  onToggleViewed: () => void
}) {
  const t = useTranslation()
  const display = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path
  const { head, tail } = splitForStartTruncation(display)
  const sectionRef = useRef<HTMLElement | null>(null)

  // Ask for this file's diff when its section reaches the screen. Fetching every
  // file on mount meant a 200-file review issued 200 requests at once, each
  // spawning several `git` processes.
  useEffect(() => {
    const element = sectionRef.current
    if (!element) return
    // jsdom has no IntersectionObserver; requesting immediately there keeps the
    // component testable without pretending the browser path ran.
    if (typeof IntersectionObserver !== 'function') {
      onReachedView()
      return
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      onReachedView()
      observer.disconnect()
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [onReachedView])

  return (
    <section
      ref={(node) => {
        sectionRef.current = node
        registerSection(node)
      }}
      data-testid={`workspace-review-section-${file.path}`}
      className="border-b border-[var(--color-border)]"
    >
      <header className="sticky top-0 z-[var(--z-sticky)] flex h-8 items-center gap-2 bg-[var(--color-surface)] px-2">
        <span
          data-testid={`workspace-review-path-${file.path}`}
          className="flex min-w-0 flex-1 items-center font-mono text-[11px] text-[var(--color-text-primary)]"
          title={display}
        >
          {head ? (
            /*
              Ellipsise the *front*. Trailing truncation cut off the filename —
              the one part of a path that identifies what is on screen — so a
              long path read as ".agent-teams/archive/ui-back…". R4 keeps the
              tail: "...w/inbox/captain.jsonl".
            */
            <span
              data-testid={`workspace-review-path-head-${file.path}`}
              dir="rtl"
              className="min-w-0 truncate text-left text-[var(--color-text-tertiary)]"
            >
              {/*
                The RTL box is what moves the ellipsis to the front; the inner
                LTR isolate is what keeps the path itself in order. Without it
                the bidi algorithm hands a leading neutral — the dot of
                `.agent-teams` — to the paragraph direction and renders it at
                the far end.
              */}
              <span dir="ltr">{head}</span>
            </span>
          ) : null}
          <span data-testid={`workspace-review-path-tail-${file.path}`} className="shrink-0">
            {head ? `/${tail}` : tail}
          </span>
        </span>
        {file.statsTruncated ? (
          <span className="shrink-0 text-[10px] text-[var(--color-text-tertiary)]">
            {t('workspace.review.statsTruncated')}
          </span>
        ) : (
          <span className="shrink-0 font-mono text-[10px] tabular-nums">
            <span className="text-[var(--color-success)]">+{file.additions}</span>
            {' '}
            <span className="text-[var(--color-error)]">-{file.deletions}</span>
          </span>
        )}
        {untracked ? (
          <span className="shrink-0 text-[10px] text-[var(--color-text-tertiary)]">
            {t('workspace.review.untracked')}
          </span>
        ) : null}
        <IconButton
          icon={<Eye size={12} strokeWidth={1.9} />}
          label={t(viewed ? 'workspace.review.viewed' : 'workspace.review.markViewed')}
          size="2xs"
          tone="muted"
          pressed={viewed}
          onClick={onToggleViewed}
        />
        {writable ? (
          <>
            <IconButton
              icon={<Undo2 size={12} strokeWidth={1.9} />}
              label={t('workspace.review.revert')}
              size="2xs"
              tone="muted"
              hoverTone="danger"
              onClick={onRevert}
            />
            <IconButton
              icon={<Plus size={12} strokeWidth={1.9} />}
              label={t(file.staged && !file.unstaged ? 'workspace.review.unstage' : 'workspace.review.stage')}
              size="2xs"
              tone="muted"
              onClick={file.staged && !file.unstaged ? onUnstage : onStage}
            />
          </>
        ) : null}
      </header>

      {file.conflicted ? (
        <p className="px-3 py-2 text-[11px] text-[var(--color-text-tertiary)]">
          {t('workspace.review.conflicted')}
        </p>
      ) : file.binary ? (
        <p className="px-3 py-2 text-[11px] text-[var(--color-text-tertiary)]">
          {t('workspace.review.binary')}
        </p>
      ) : diffTruncated ? (
        <p className="px-3 py-2 text-[11px] text-[var(--color-text-tertiary)]">
          {t('workspace.review.diffTruncated', { size: formatBytes(diffBytes ?? 0) })}
        </p>
      ) : diffLoading ? (
        <div className="flex items-center justify-center py-4">
          <Spinner size={14} label={t('common.loading')} />
        </div>
      ) : diff ? (
        <WorkspaceDiffSurface
          value={diff}
          path={file.path}
          hideSingleFileHeader
          className="bg-[var(--color-code-bg)]"
        />
      ) : null}
    </section>
  )
}
