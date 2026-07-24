import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { BookOpenText, ChevronRight, Database, FileText, FolderGit2, PencilLine, RefreshCw, RotateCcw, Save, Search, X } from 'lucide-react'
import { MarkdownRenderer } from '../components/markdown/MarkdownRenderer'
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
import { Alert, AlertDescription } from '../components/ui/alert'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { IconButton } from '../components/ui/custom/icon-button'
import { LoadingButton } from '../components/ui/custom/loading-button'
import { MemoryResourceTree } from '../components/ui/custom/memory-resource-tree'
import { Input } from '../components/ui/input'
import { Skeleton } from '../components/ui/skeleton'
import { Textarea } from '../components/ui/textarea'
import { useTranslation } from '../i18n'
import { formatBytes } from '../lib/formatBytes'
import { useMemoryStore } from '../stores/memoryStore'
import { useSessionStore } from '../stores/sessionStore'
import { useUIStore } from '../stores/uiStore'
import type { MemoryFile, MemoryProject } from '../types/memory'

const DEFAULT_MEMORY_PATH = 'MEMORY.md'

type MemoryNavigationIntent =
  | { kind: 'cwd'; cwd?: string }
  | { kind: 'refresh'; cwd?: string; projectId: string | null }
  | { kind: 'project'; projectId: string }
  | { kind: 'file'; projectId: string; path: string; clearPendingPath?: boolean }

export function MemorySettings() {
  const t = useTranslation()
  const {
    projects,
    files,
    selectedProjectId,
    selectedFile,
    draftContent,
    isLoadingProjects,
    isLoadingFiles,
    isLoadingFile,
    isSaving,
    error,
    lastSavedAt,
    fetchProjects,
    selectProject,
    fetchFiles,
    openFile,
    updateDraft,
    saveFile,
  } = useMemoryStore()
  const sessions = useSessionStore((s) => s.sessions)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const pendingMemoryPath = useUIStore((s) => s.pendingMemoryPath)
  const setPendingMemoryPath = useUIStore((s) => s.setPendingMemoryPath)
  const [resourceQuery, setResourceQuery] = useState('')
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null)
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set())
  const [isEditing, setIsEditing] = useState(false)
  const [pendingNavigation, setPendingNavigation] = useState<MemoryNavigationIntent | null>(null)
  const navigationTriggerRef = useRef<HTMLElement | null>(null)
  const pendingOpenAttemptRef = useRef<string | null>(null)
  const discardCancelRef = useRef<HTMLButtonElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const editorRef = useRef<HTMLTextAreaElement | null>(null)
  const editButtonRef = useRef<HTMLButtonElement | null>(null)

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId),
    [activeSessionId, sessions],
  )
  const activeCwd = activeSession?.workDir || activeSession?.projectPath || undefined
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null
  const isDirty = Boolean(selectedFile && draftContent !== selectedFile.content)
  const filteredProjects = useMemo(
    () => filterProjects(projects, resourceQuery, selectedProjectId, files),
    [files, projects, resourceQuery, selectedProjectId],
  )
  const filteredFiles = useMemo(
    () => filterFiles(files, resourceQuery),
    [files, resourceQuery],
  )
  const previewContent = stripMarkdownFrontmatter(draftContent)
  const selectedFilePath = selectedFile?.path ?? null

  const performNavigation = useCallback((intent: MemoryNavigationIntent) => {
    if (intent.kind === 'cwd') {
      void fetchProjects(intent.cwd)
      return
    }
    if (intent.kind === 'refresh') {
      void fetchProjects(intent.cwd)
      if (intent.projectId) void fetchFiles(intent.projectId)
      return
    }
    if (intent.kind === 'project') {
      setExpandedProjectId(intent.projectId)
      if (intent.projectId !== selectedProjectId) {
        selectProject(intent.projectId)
      }
      return
    }
    void openFile(intent.projectId, intent.path).then((opened) => {
      if (opened && intent.clearPendingPath) {
        setPendingMemoryPath(null)
      }
    })
  }, [
    fetchFiles,
    fetchProjects,
    openFile,
    selectProject,
    selectedProjectId,
    setPendingMemoryPath,
  ])

  const requestNavigation = useCallback((
    intent: MemoryNavigationIntent,
    trigger?: HTMLElement | null,
  ) => {
    if (isSaving) return
    if (isEditing && isDirty) {
      const activeElement = document.activeElement
      navigationTriggerRef.current =
        trigger ??
        (activeElement instanceof HTMLElement ? activeElement : null)
      setPendingNavigation(intent)
      return
    }
    performNavigation(intent)
  }, [isDirty, isEditing, isSaving, performNavigation])

  const requestNavigationRef = useRef(requestNavigation)
  useEffect(() => {
    requestNavigationRef.current = requestNavigation
  }, [requestNavigation])

  useEffect(() => {
    requestNavigationRef.current({ kind: 'cwd', cwd: activeCwd })
  }, [activeCwd])

  useEffect(() => {
    if (!selectedProjectId) return
    void fetchFiles(selectedProjectId)
  }, [fetchFiles, selectedProjectId])

  useEffect(() => {
    if (!selectedProjectId) return
    setExpandedProjectId(selectedProjectId)
  }, [selectedProjectId])

  useEffect(() => {
    setIsEditing(false)
  }, [selectedFilePath])

  useEffect(() => {
    if (isEditing) editorRef.current?.focus()
  }, [isEditing])

  useEffect(() => {
    if (!selectedProjectId || selectedFile || isLoadingFiles || isLoadingFile) return
    if (pendingMemoryPath) return
    const firstFile = files[0]
    if (firstFile) {
      void openFile(selectedProjectId, firstFile.path)
    }
  }, [files, isLoadingFile, isLoadingFiles, openFile, pendingMemoryPath, selectedFile, selectedProjectId])

  useEffect(() => {
    if (!pendingMemoryPath) {
      pendingOpenAttemptRef.current = null
      return
    }
    if (
      pendingNavigation ||
      isLoadingProjects ||
      projects.length === 0
    ) return
    const target = resolveMemoryFileTarget(projects, pendingMemoryPath)
    if (!target) {
      setPendingMemoryPath(null)
      return
    }
    if (selectedProjectId !== target.projectId) {
      requestNavigation({ kind: 'project', projectId: target.projectId })
      return
    }
    if (selectedFile?.path === target.path && !isLoadingFile) {
      setPendingMemoryPath(null)
      return
    }
    if (pendingOpenAttemptRef.current === pendingMemoryPath) return
    pendingOpenAttemptRef.current = pendingMemoryPath
    requestNavigation({
      kind: 'file',
      projectId: target.projectId,
      path: target.path,
      clearPendingPath: true,
    })
  }, [
    isLoadingFile,
    isLoadingProjects,
    pendingMemoryPath,
    pendingNavigation,
    projects,
    requestNavigation,
    selectedFile?.path,
    selectedProjectId,
    setPendingMemoryPath,
  ])

  const handleRefresh = (trigger: HTMLButtonElement) => {
    pendingOpenAttemptRef.current = null
    requestNavigation({
      kind: 'refresh',
      cwd: activeCwd,
      projectId: selectedProjectId,
    }, trigger)
  }

  const handleProjectToggle = (projectId: string, trigger: HTMLButtonElement) => {
    if (expandedProjectId === projectId) {
      setExpandedProjectId(null)
      return
    }
    requestNavigation({ kind: 'project', projectId }, trigger)
  }

  const handleFileOpen = (file: MemoryFile, trigger: HTMLButtonElement) => {
    if (!selectedProjectId || file.path === selectedFile?.path) return
    requestNavigation({
      kind: 'file',
      projectId: selectedProjectId,
      path: file.path,
    }, trigger)
  }

  const handleSave = useCallback(async () => {
    if (!selectedFile) return
    if (!isDirty) {
      setIsEditing(false)
      return
    }
    const saved = await saveFile()
    if (saved) {
      setIsEditing(false)
      requestAnimationFrame(() => editButtonRef.current?.focus())
    }
  }, [isDirty, saveFile, selectedFile])

  useEffect(() => {
    if (!isEditing || !selectedFile || isSaving) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return
      event.preventDefault()
      void handleSave()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isEditing, isSaving, selectedFile, handleSave])

  const handlePreviewLinkClick = (href: string): boolean => {
    if (!selectedProjectId || !selectedFile) return false
    const targetPath = resolveMarkdownMemoryLink(
      href,
      selectedFile.path,
      selectedProject?.memoryDir,
      files,
    )
    if (!targetPath || targetPath === selectedFile.path) return false
    requestNavigation({
      kind: 'file',
      projectId: selectedProjectId,
      path: targetPath,
    })
    return true
  }

  const toggleFolder = (path: string) => {
    setCollapsedFolders((previous) => {
      const next = new Set(previous)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }

  const forceExpandFiles = Boolean(resourceQuery.trim())

  const handleCancelEdit = () => {
    if (selectedFile) {
      updateDraft(selectedFile.content)
    }
    setIsEditing(false)
    requestAnimationFrame(() => editButtonRef.current?.focus())
  }

  const handleDiscardNavigation = () => {
    if (!pendingNavigation) return
    const intent = pendingNavigation
    if (selectedFile) updateDraft(selectedFile.content)
    setIsEditing(false)
    setPendingNavigation(null)
    performNavigation(intent)
  }

  return (
    <Card className="flex h-full min-h-[640px] flex-col overflow-hidden bg-[var(--color-surface-container-lowest)]">
      <header className="grid min-h-[58px] border-b border-[var(--color-border)] bg-[var(--color-surface-container-low)] lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="flex min-w-0 items-center gap-3 border-b border-[var(--color-border)] px-4 py-3 lg:border-b-0 lg:border-r">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-brand)]">
            <BookOpenText size={16} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-[var(--color-text-primary)]">
              {t('settings.memory.title')}
            </h2>
            <p className="truncate text-xs text-[var(--color-text-tertiary)]">
              {t('settings.memory.projects')}
            </p>
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Breadcrumb
            project={selectedProject}
            filePath={selectedFile?.path}
            fallbackProject={activeCwd ? projectDisplayName(activeCwd) : '~/.claude/projects'}
            fallbackFile={t('settings.memory.noFileSelected')}
          />
          <div className="flex shrink-0 flex-wrap gap-2">
            <LoadingButton
              variant="secondary"
              size="sm"
              onClick={(event) => handleRefresh(event.currentTarget)}
              disabled={isSaving}
              loading={isLoadingProjects || isLoadingFiles}
            >
              <RefreshCw size={15} aria-hidden="true" />
              {t('settings.memory.refresh')}
            </LoadingButton>
          </div>
        </div>
      </header>

      {error && (
        <Alert variant="destructive" className="m-3 w-auto">
          <AlertDescription className="break-words text-[var(--color-error)]">
            {error}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid min-h-0 flex-1 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="min-h-0 overflow-hidden border-b border-[var(--color-border)] lg:border-b-0 lg:border-r">
          <section className="flex h-full min-h-0 flex-col bg-[var(--color-surface-container-lowest)]">
            <PanelHeader
              icon={<Database size={15} aria-hidden="true" />}
              title={t('settings.memory.resourceManager')}
              meta={isLoadingProjects ? t('common.loading') : undefined}
            />
            <div className="px-3 py-3">
              <SearchField
                inputRef={searchInputRef}
                value={resourceQuery}
                onChange={setResourceQuery}
                placeholder={t('settings.memory.resourceSearchPlaceholder')}
                ariaLabel={t('settings.memory.resourceSearchPlaceholder')}
                clearLabel={t('settings.memory.clearSearch')}
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
              {isLoadingProjects && projects.length === 0 ? (
                <div className="grid gap-2 px-2 py-2" aria-label={t('common.loading')}>
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-5/6" />
                  <Skeleton className="h-9 w-full" />
                </div>
              ) : projects.length === 0 ? (
                <EmptyState icon={<FolderGit2 size={18} />} text={t('settings.memory.emptyProjects')} />
              ) : filteredProjects.length === 0 ? (
                <EmptyState icon={<Search size={18} />} text={t('settings.memory.noProjectMatches')} />
              ) : (
                <MemoryResourceTree
                  projects={filteredProjects}
                  selectedProjectId={selectedProjectId}
                  expandedProjectId={expandedProjectId}
                  loadingProjectId={isLoadingFiles ? selectedProjectId : null}
                  files={filteredFiles}
                  activePath={selectedFile?.path ?? null}
                  collapsedFolders={collapsedFolders}
                  forceExpanded={forceExpandFiles}
                  disabled={isSaving || isLoadingFile}
                  onProjectToggle={handleProjectToggle}
                  onToggleFolder={toggleFolder}
                  onFileSelect={handleFileOpen}
                  emptyText={t('settings.memory.emptyFiles')}
                />
              )}
            </div>
          </section>
        </aside>

        <section className="flex min-h-0 flex-col overflow-hidden bg-[var(--color-surface-container-lowest)]">
          <div className="grid gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-4 py-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
                  {selectedFile?.path ? fileNameFromPath(selectedFile.path) : t('settings.memory.noFileSelected')}
                </h3>
                {isDirty && <Badge variant="secondary">{t('settings.memory.unsaved')}</Badge>}
                {lastSavedAt && !isDirty && <Badge variant="secondary">{t('settings.memory.saved')}</Badge>}
              </div>
              <p className="mt-1 truncate text-xs text-[var(--color-text-tertiary)]">
                {selectedProject?.memoryDir ?? t('settings.memory.selectProject')}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2 text-xs text-[var(--color-text-tertiary)]">
              {selectedFile ? (
                <>
                  <span>{formatBytes(selectedFile.bytes)}</span>
                  {selectedFile.updatedAt ? <span>{formatDate(selectedFile.updatedAt)}</span> : null}
                </>
              ) : null}
            </div>
          </div>

          {selectedFile ? (
            isEditing ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-3 text-xs font-medium uppercase tracking-normal text-[var(--color-text-tertiary)]">
                  <div className="flex min-w-0 items-center gap-2">
                    <span>{t('settings.memory.editor')}</span>
                    <span>MARKDOWN</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 normal-case">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={isSaving}
                      onClick={handleCancelEdit}
                    >
                      {t('common.cancel')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!isDirty || isSaving}
                      onClick={() => selectedFile && updateDraft(selectedFile.content)}
                    >
                      <RotateCcw size={14} aria-hidden="true" />
                      {t('settings.memory.revert')}
                    </Button>
                    <LoadingButton
                      size="sm"
                      disabled={isSaving}
                      loading={isSaving}
                      onClick={() => void handleSave()}
                    >
                      <Save size={14} aria-hidden="true" />
                      {t('common.save')}
                    </LoadingButton>
                  </div>
                </div>
                <Textarea
                  ref={editorRef}
                  aria-label={t('settings.memory.editor')}
                  value={draftContent}
                  onChange={(event) => updateDraft(event.target.value)}
                  readOnly={isSaving}
                  aria-busy={isSaving || undefined}
                  spellCheck={false}
                  className="min-h-0 flex-1 resize-none overflow-auto rounded-none border-0 bg-transparent p-5 font-mono text-[13px] leading-6 shadow-none focus-visible:border-transparent focus-visible:shadow-none"
                />
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-3 text-xs font-medium uppercase tracking-normal text-[var(--color-text-tertiary)]">
                  <div className="flex min-w-0 items-center gap-2">
                    <span>{t('settings.memory.preview')}</span>
                    <span>{t('settings.memory.rendered')}</span>
                  </div>
                  <IconButton
                    ref={editButtonRef}
                    variant="ghost"
                    label={t('settings.memory.edit')}
                    disabled={isSaving || isLoadingFile}
                    onClick={() => setIsEditing(true)}
                  >
                    <PencilLine size={14} aria-hidden="true" />
                  </IconButton>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-6">
                  <MarkdownRenderer
                    content={previewContent || ' '}
                    variant="document"
                    onLinkClick={handlePreviewLinkClick}
                  />
                </div>
              </div>
            )
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center p-8">
              {isLoadingFile ? (
                <div className="grid w-full max-w-xl gap-3" aria-label={t('common.loading')}>
                  <Skeleton className="h-6 w-40" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                </div>
              ) : (
                <EmptyState icon={<FileText size={20} />} text={t('settings.memory.selectFile')} />
              )}
            </div>
          )}
        </section>
      </div>

      <AlertDialog
        open={pendingNavigation !== null}
        onOpenChange={(open) => {
          if (!open) setPendingNavigation(null)
        }}
      >
        <AlertDialogContent
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            discardCancelRef.current?.focus()
          }}
          onCloseAutoFocus={(event) => {
            const target = navigationTriggerRef.current
            navigationTriggerRef.current = null
            if (!target?.isConnected) return
            event.preventDefault()
            target.focus()
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.memory.unsaved')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('settings.memory.discardUnsavedConfirm')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel ref={discardCancelRef}>
              {t('common.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-[var(--color-error)] text-white hover:opacity-90"
              onClick={handleDiscardNavigation}
            >
              {t('settings.memory.discardUnsavedAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

function Breadcrumb({
  project,
  filePath,
  fallbackProject,
  fallbackFile,
}: {
  project: MemoryProject | null
  filePath?: string
  fallbackProject: string
  fallbackFile: string
}) {
  const projectLabel = project ? projectDisplayName(project.label) : fallbackProject
  const parts = filePath ? [projectLabel, ...filePath.split('/').filter(Boolean)] : [projectLabel, fallbackFile]
  return (
    <nav aria-label="Memory file path" className="flex min-w-0 items-center gap-1 text-sm text-[var(--color-text-tertiary)]">
      {parts.map((part, index) => {
        const isLast = index === parts.length - 1
        return (
          <span key={`${part}-${index}`} className="flex min-w-0 items-center gap-1">
            {index > 0 ? <ChevronRight size={14} className="shrink-0" aria-hidden="true" /> : null}
            <span className={`truncate ${isLast ? 'font-semibold text-[var(--color-text-primary)]' : ''}`}>
              {part}
            </span>
          </span>
        )
      })}
    </nav>
  )
}

function SearchField({
  inputRef,
  value,
  onChange,
  placeholder,
  ariaLabel,
  clearLabel,
}: {
  inputRef: RefObject<HTMLInputElement>
  value: string
  onChange: (value: string) => void
  placeholder: string
  ariaLabel: string
  clearLabel: string
}) {
  return (
    <div className="relative">
      <Search
        size={15}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
        aria-hidden="true"
      />
      <Input
        ref={inputRef}
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="pl-9 pr-9"
      />
      {value ? (
        <IconButton
          label={clearLabel}
          variant="ghost"
          onClick={() => {
            onChange('')
            inputRef.current?.focus()
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2"
        >
          <X aria-hidden="true" />
        </IconButton>
      ) : null}
    </div>
  )
}

function PanelHeader({ icon, title, meta }: { icon?: ReactNode; title: string; meta?: string }) {
  return (
    <div className="flex h-11 items-center justify-between border-b border-[var(--color-border)] px-3">
      <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
        {icon ? <span className="text-[var(--color-text-tertiary)]">{icon}</span> : null}
        <span className="truncate">{title}</span>
      </h3>
      {meta ? <span className="text-xs text-[var(--color-text-tertiary)]">{meta}</span> : null}
    </div>
  )
}

function EmptyState({ icon, text }: { icon?: ReactNode; text: string }) {
  return (
    <div className="grid place-items-center gap-2 px-3 py-8 text-center text-sm text-[var(--color-text-tertiary)]">
      {icon ? (
        <span className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface-container-low)] text-[var(--color-text-tertiary)]">
          {icon}
        </span>
      ) : null}
      <span>{text}</span>
    </div>
  )
}

function normalizeSearch(value: string): string {
  return value.toLowerCase().replace(/\\/g, '/').replace(/\/+/g, '/').trim()
}

function filterProjects(
  projects: MemoryProject[],
  query: string,
  selectedProjectId: string | null,
  selectedProjectFiles: MemoryFile[],
): MemoryProject[] {
  const normalized = normalizeSearch(query)
  if (!normalized) return projects
  return projects.filter((project) =>
    normalizeSearch(`${project.label} ${project.memoryDir} ${project.id}`).includes(normalized) ||
    (project.id === selectedProjectId && selectedProjectFiles.some((file) =>
      normalizeSearch(`${file.title} ${file.path} ${file.description ?? ''} ${file.type ?? ''}`).includes(normalized),
    )),
  )
}

function filterFiles(files: MemoryFile[], query: string): MemoryFile[] {
  const normalized = normalizeSearch(query)
  if (!normalized) return files
  return files.filter((file) =>
    normalizeSearch(`${file.title} ${file.path} ${file.description ?? ''} ${file.type ?? ''}`).includes(normalized),
  )
}

function projectDisplayName(label: string): string {
  const normalized = label.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '')
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length >= 2) return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
  return parts[0] ?? label
}

function stripMarkdownFrontmatter(content: string): string {
  if (!content.startsWith('---')) return content
  const end = content.indexOf('\n---', 3)
  if (end < 0) return content
  const after = content.indexOf('\n', end + 4)
  return after < 0 ? '' : content.slice(after + 1).trimStart()
}

function normalizeFsPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '')
}

function resolveMemoryFileTarget(projects: MemoryProject[], absolutePath: string): { projectId: string; path: string } | null {
  const target = normalizeFsPath(absolutePath)
  for (const project of projects) {
    const memoryDir = normalizeFsPath(project.memoryDir)
    if (!memoryDir) continue
    if (target === memoryDir) {
      return { projectId: project.id, path: DEFAULT_MEMORY_PATH }
    }
    if (target.startsWith(`${memoryDir}/`)) {
      return {
        projectId: project.id,
        path: target.slice(memoryDir.length + 1),
      }
    }
  }
  return null
}

function resolveMarkdownMemoryLink(
  href: string,
  currentPath: string,
  projectMemoryDir: string | undefined,
  files: MemoryFile[],
): string | null {
  const rawHref = safeDecodeUriComponent(href.trim())
  if (!rawHref || rawHref.startsWith('#')) return null

  let target = rawHref
  try {
    const url = new URL(rawHref)
    if (url.protocol !== 'file:') return null
    target = url.pathname
  } catch {
    if (/^[a-z][a-z\d+.-]*:/i.test(rawHref)) return null
  }

  target = stripMarkdownLinkSuffix(target)
  if (!target || !target.endsWith('.md')) return null

  const absoluteTarget = normalizeFsPath(target)
  const memoryDir = projectMemoryDir ? normalizeFsPath(projectMemoryDir) : ''
  if (memoryDir) {
    if (absoluteTarget === memoryDir) return DEFAULT_MEMORY_PATH
    if (absoluteTarget.startsWith(`${memoryDir}/`)) {
      return findMemoryFileByPath(files, absoluteTarget.slice(memoryDir.length + 1))
    }
  }

  if (target.startsWith('/')) return null

  const currentParts = currentPath.split('/').filter(Boolean)
  const baseParts = currentParts.slice(0, -1)
  const resolvedParts: string[] = []
  for (const part of [...baseParts, ...target.split('/')]) {
    if (!part || part === '.') continue
    if (part === '..') {
      resolvedParts.pop()
      continue
    }
    resolvedParts.push(part)
  }

  return findMemoryFileByPath(files, resolvedParts.join('/'))
}

function safeDecodeUriComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function stripMarkdownLinkSuffix(value: string): string {
  return value.split('#')[0]?.split('?')[0]?.trim() ?? ''
}

function findMemoryFileByPath(files: MemoryFile[], path: string): string | null {
  const normalized = normalizeFsPath(path)
  return files.find((file) => normalizeFsPath(file.path) === normalized)?.path ?? null
}

function fileNameFromPath(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? path
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}
