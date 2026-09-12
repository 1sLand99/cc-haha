import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, PanelRightClose, PanelRightOpen, RefreshCw } from 'lucide-react'
import { IconButton } from '@/components/ui/IconButton'
import { useDismissable } from '@/hooks/useDismissable'
import { useTranslation } from '../../i18n'
import { CodeSurface } from '../workspace/surfaces/CodeSurface'
import { ImagePreview } from '../workspace/surfaces/ImagePreview'
import { MarkdownSurface } from '../workspace/surfaces/MarkdownSurface'
import { PanelMessage } from '../workspace/surfaces/PanelMessage'
import type { WorkspaceTextSelection } from '../workspace/surfaces/textSelection'
import { WorkspaceFileOpenWith } from '../workspace/WorkspaceFileOpenWith'
import { WorkspaceFileTreePane } from './WorkspaceFileTreePane'
import { useMenuKeyboard } from './menuKeyboard'
import { useWorkspaceContentStore } from '../../stores/workspaceContentStore'
import { useWorkspaceChatContextStore } from '../../stores/workspaceChatContextStore'
import { workspaceOpen } from '../../lib/workspace/openTarget'
import { basenameOf, type WorkspaceFileTab as WorkspaceFileTabModel } from '../../lib/workspace/types'

const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdx']

export type WorkspaceFileTabProps = {
  sessionId: string
  tab: WorkspaceFileTabModel
}

function isMarkdown(path: string) {
  const lower = path.toLowerCase()
  return MARKDOWN_EXTENSIONS.some((extension) => lower.endsWith(extension))
}

/**
 * File content with its tree alongside it.
 *
 * The tree is a sibling of the content, not a mode the content replaces, so
 * opening a file never changes the shape of the panel — it changes what the
 * selected row points at. Narrow widths collapse the tree rather than dropping
 * the content, because the content is what was asked for.
 */
export function WorkspaceFileTab({ sessionId, tab }: WorkspaceFileTabProps) {
  const t = useTranslation()
  const [treeOpen, setTreeOpen] = useState(true)
  const [openWithOpen, setOpenWithOpen] = useState(false)
  const openWithRef = useRef<HTMLDivElement>(null)
  const openWithTriggerRef = useRef<HTMLButtonElement>(null)
  const openWithMenuId = useId()
  const loadFile = useWorkspaceContentStore((state) => state.loadFile)
  const loadStatus = useWorkspaceContentStore((state) => state.loadStatus)
  const entry = useWorkspaceContentStore((state) => state.filesByKey[`${sessionId}::${tab.path}`])
  /**
   * The working directory is read here rather than taken as a prop: it used to
   * be an optional prop that the only render site never passed, so every
   * "open with" and every Markdown asset resolved against a workspace-relative
   * path and opened the wrong target (or nothing at all).
   */
  const workDir = useWorkspaceContentStore((state) => state.statusBySession[sessionId]?.workDir) ?? null
  const path = tab.path

  useEffect(() => {
    void loadStatus(sessionId)
  }, [loadStatus, sessionId])

  useEffect(() => {
    if (!path) return
    void loadFile(sessionId, path)
  }, [loadFile, path, sessionId])

  const addSelectionToChat = useCallback((selection: WorkspaceTextSelection) => {
    useWorkspaceChatContextStore.getState().addReference(sessionId, {
      kind: 'code-selection',
      path,
      name: basenameOf(path),
      lineStart: selection.startLine,
      lineEnd: selection.endLine,
      quote: selection.text,
    })
  }, [path, sessionId])

  const addLineComment = useCallback((
    lineStart: number,
    lineEnd: number,
    note: string,
    quote: string,
  ) => {
    useWorkspaceChatContextStore.getState().addReference(sessionId, {
      kind: 'code-comment',
      path,
      name: basenameOf(path),
      lineStart,
      lineEnd,
      quote,
      note,
    })
  }, [path, sessionId])

  const closeOpenWith = useCallback(() => setOpenWithOpen(false), [])

  useDismissable({
    open: openWithOpen,
    refs: [openWithRef, openWithTriggerRef],
    onDismiss: closeOpenWith,
  })

  const handleOpenWithKeyDown = useMenuKeyboard({
    open: openWithOpen,
    menuRef: openWithRef,
    triggerRef: openWithTriggerRef,
    onClose: closeOpenWith,
  })

  const segments = path ? path.split('/').filter(Boolean) : []
  const absolutePath = workDir && path ? `${workDir.replace(/\/+$/, '')}/${path}` : path

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <div
          data-testid="workspace-file-header"
          className="flex h-11 shrink-0 items-center gap-1 border-b border-[var(--color-border)] px-2"
        >
          <nav
            aria-label={t('workspace.files.breadcrumb')}
            className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden text-[11px] text-[var(--color-text-tertiary)]"
          >
            {segments.length === 0 ? (
              <span className="truncate">{t('workspace.files.noSelection')}</span>
            ) : (
              segments.map((segment, index) => (
                <span key={`${segment}-${index}`} className="flex min-w-0 items-center gap-0.5">
                  {index > 0 ? (
                    <ChevronRight size={11} aria-hidden="true" className="shrink-0 opacity-60" />
                  ) : null}
                  <span
                    className={`truncate ${index === segments.length - 1 ? 'text-[var(--color-text-primary)]' : ''}`}
                  >
                    {segment}
                  </span>
                </span>
              ))
            )}
          </nav>
          {path ? (
            <>
              <IconButton
                icon={<RefreshCw size={14} strokeWidth={1.9} />}
                label={t('workspace.refresh')}
                size="xs"
                tone="muted"
                onClick={() => { void loadFile(sessionId, path, { force: true }) }}
              />
              <span className="relative shrink-0">
                <button
                  ref={openWithTriggerRef}
                  type="button"
                  data-testid="workspace-file-open-with"
                  aria-haspopup="menu"
                  aria-expanded={openWithOpen}
                  aria-controls={openWithOpen ? openWithMenuId : undefined}
                  onClick={() => setOpenWithOpen((open) => !open)}
                  className="flex h-7 items-center gap-1 rounded-[var(--radius-sm)] px-1.5 text-[11px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
                >
                  {t('workspace.files.openWith')}
                  <ChevronDown size={11} aria-hidden="true" />
                </button>
                {openWithOpen ? (
                  <div
                    ref={openWithRef}
                    id={openWithMenuId}
                    role="menu"
                    aria-label={t('workspace.files.openWith')}
                    onKeyDown={handleOpenWithKeyDown}
                    className="absolute right-0 top-8 z-[var(--z-dropdown)] min-w-[220px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] py-1 shadow-[var(--shadow-dropdown)]"
                  >
                    <WorkspaceFileOpenWith
                      absolutePath={absolutePath}
                      sessionId={sessionId}
                      workspacePath={path}
                      onAfterSelect={closeOpenWith}
                    />
                  </div>
                ) : null}
              </span>
            </>
          ) : null}
          <IconButton
            icon={treeOpen
              ? <PanelRightClose size={14} strokeWidth={1.9} />
              : <PanelRightOpen size={14} strokeWidth={1.9} />}
            label={t('workspace.files.toggleTree')}
            size="xs"
            tone="muted"
            pressed={treeOpen}
            data-testid="workspace-file-tree-toggle"
            onClick={() => setTreeOpen((open) => !open)}
          />
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          {!path ? (
            <PanelMessage icon="description" message={t('workspace.files.pickAFile')} />
          ) : !entry || entry.state === 'loading' ? (
            <PanelMessage icon="hourglass_empty" message={t('workspace.previewState.loading')} />
          ) : entry.state === 'missing' ? (
            <PanelMessage icon="search_off" message={t('workspace.previewState.missing')} />
          ) : entry.state === 'too_large' ? (
            <PanelMessage icon="database" message={t('workspace.previewState.tooLarge')} />
          ) : entry.state === 'binary' ? (
            <PanelMessage icon="data_object" message={t('workspace.previewState.binary')} />
          ) : entry.state === 'error' ? (
            <PanelMessage icon="error" tone="error" message={entry.error || t('workspace.loadError')} />
          ) : entry.previewType === 'image' ? (
            <ImagePreview dataUrl={entry.dataUrl} path={path} error={entry.error} />
          ) : isMarkdown(path) ? (
            <MarkdownSurface
              value={entry.content ?? ''}
              path={path}
              sessionId={sessionId}
              workDir={workDir}
              onAddSelection={addSelectionToChat}
            />
          ) : (
            <CodeSurface
              value={entry.content ?? ''}
              language={entry.language ?? 'text'}
              reveal={tab.reveal}
              onAddLineComment={addLineComment}
              onAddSelection={addSelectionToChat}
            />
          )}
          {entry?.refreshError ? (
            <p
              role="status"
              className="shrink-0 border-t border-[var(--color-border)] px-3 py-1.5 text-[11px] text-[var(--color-text-tertiary)]"
            >
              {t('workspace.files.refreshFailed', { reason: entry.refreshError })}
            </p>
          ) : null}
        </div>
      </div>

      {treeOpen ? (
        <div className="hidden w-[280px] shrink-0 md:block">
          <WorkspaceFileTreePane
            sessionId={sessionId}
            selectedPath={path || null}
            onOpen={(nextPath, options) =>
              workspaceOpen.file(sessionId, nextPath, { preview: options.preview })}
          />
        </div>
      ) : null}
    </div>
  )
}
