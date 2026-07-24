import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronDown,
  Folder,
  FolderOpen,
  GitBranch,
} from 'lucide-react'
import { sessionsApi, type RecentProject } from '../../api/sessions'
import { filesystemApi } from '../../api/filesystem'
import { useTranslation } from '../../i18n'
import { useMobileViewport } from '../../hooks/useMobileViewport'
import { getDesktopHost } from '../../lib/desktopHost'
import {
  getCachedRecentProjects,
  invalidateRecentProjectsCache,
  setCachedRecentProjects,
} from '../../lib/recentProjectsCache'
import { MobileBottomSheet } from './MobileBottomSheet'
import { Button } from '../ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { Separator } from '../ui/separator'
import { Skeleton } from '../ui/skeleton'

type Props = {
  value: string
  onChange: (path: string) => void
  variant?: 'chip' | 'workbar'
  isGitProject?: boolean
}

type DirEntry = { name: string; path: string; isDirectory: boolean }

const DESKTOP_WORKTREE_MARKER = '/.claude/worktrees/'
function isDesktopRuntime() {
  return typeof window !== 'undefined' && getDesktopHost().isDesktop
}

function projectNameFromPath(filePath: string) {
  const displayRoot = filePath.includes(DESKTOP_WORKTREE_MARKER)
    ? filePath.slice(0, filePath.indexOf(DESKTOP_WORKTREE_MARKER))
    : filePath
  return displayRoot.split('/').filter(Boolean).pop() || filePath
}

export function DirectoryPicker({ value, onChange, variant = 'chip', isGitProject = false }: Props) {
  const t = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const [mode, setMode] = useState<'recent' | 'browse'>('recent')
  const [projects, setProjects] = useState<RecentProject[]>([])
  const [browseEntries, setBrowseEntries] = useState<DirEntry[]>([])
  const [browsePath, setBrowsePath] = useState('')
  const [browseParent, setBrowseParent] = useState('')
  const [loading, setLoading] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const isMobileBrowser = useMobileViewport() && !isDesktopRuntime()

  const dropdownRef = useRef<HTMLDivElement>(null)

  // Load recent projects when opened (with client-side cache)
  useEffect(() => {
    if (!isOpen || mode !== 'recent') return
    // Use cache if fresh
    const cachedProjects = getCachedRecentProjects()
    if (cachedProjects) {
      setProjects(cachedProjects)
      return
    }
    setLoading(true)
    sessionsApi.getRecentProjects()
      .then(({ projects: p }) => {
        setCachedRecentProjects(p)
        setProjects(p)
      })
      .catch(() => setProjects([]))
      .finally(() => setLoading(false))
  }, [isOpen, mode])

  const loadBrowseDir = async (path?: string) => {
    setLoading(true)
    try {
      const result = await filesystemApi.browse(path)
      setBrowsePath(result.currentPath)
      setBrowseParent(result.parentPath)
      setBrowseEntries(result.entries)
    } catch { /* API not available */ }
    setLoading(false)
  }

  const handleSelect = (path: string) => {
    onChange(path)
    setIsOpen(false)
    setMode('recent')
    // Invalidate cache so next open reflects the new selection
    invalidateRecentProjectsCache()
  }

  const handleChooseFolder = async () => {
    const host = getDesktopHost()
    if (host.isDesktop && host.capabilities.dialogs) {
      // Desktop: native OS folder dialog
      setIsOpen(false)
      try {
        const selected = await host.dialogs.open({
          directory: true,
          multiple: false,
          title: t('dirPicker.chooseProjectFolder'),
        })
        if (typeof selected === 'string' && selected.length > 0) onChange(selected)
      } catch (err) {
        console.error('[DirectoryPicker] Failed to open folder dialog:', err)
      }
    } else {
      // Web browser: directory tree via backend API
      setMode('browse')
      loadBrowseDir(value || undefined)
    }
  }

  // Find selected project info
  const selectedProject = projects.find((p) => p.realPath === value)
  const isWorkbar = variant === 'workbar'
  const selectedLabel = selectedProject?.repoName || selectedProject?.projectName || projectNameFromPath(value)
  const showGitIcon = selectedProject?.isGit || isGitProject
  const triggerClassName = isWorkbar
    ? 'h-9 max-w-full min-w-0 justify-start gap-1.5 rounded-[7px] border-transparent px-2.5 text-[13px] leading-none'
    : 'h-8 justify-start gap-2 rounded-full border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-3 text-xs'
  const emptyTriggerClassName = isWorkbar
    ? 'h-9 min-w-0 justify-start gap-1.5 rounded-[7px] px-2.5 text-[13px] leading-none text-[var(--color-text-secondary)]'
    : 'h-8 justify-start gap-2 px-0 text-xs text-[var(--color-text-tertiary)]'
  const dropdownTitle = mode === 'recent' ? t('dirPicker.recent') : t('dirPicker.chooseProjectFolder')
  const dropdownContent = mode === 'recent' ? (
    <div role="listbox" aria-label={dropdownTitle}>
      {!isMobileBrowser && (
        <div className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-[var(--color-outline)]">
          {t('dirPicker.recent')}
        </div>
      )}
      <div className={`${isMobileBrowser ? '' : 'max-h-[300px]'} overflow-y-auto`}>
        {loading ? (
          <div className="space-y-2 px-4 py-4" aria-label={t('common.loading')}>
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : projects.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-[var(--color-text-tertiary)]">{t('dirPicker.noRecent')}</div>
        ) : (
          projects.map((project) => {
            const isSelected = project.realPath === value
            return (
              <Button
                key={project.projectPath}
                type="button"
                variant="ghost"
                role="option"
                aria-selected={isSelected}
                onClick={() => handleSelect(project.realPath)}
                className={`h-auto w-full justify-start gap-3 rounded-none px-4 text-left ${
                  isMobileBrowser ? 'min-h-[72px] py-3.5' : 'py-3'
                } ${
                  isSelected ? 'bg-[var(--color-surface-selected)]' : ''
                }`}
              >
                {project.isGit ? (
                  <GitBranch className="size-5 shrink-0 text-[var(--color-text-secondary)]" aria-hidden="true" />
                ) : (
                  <Folder className="size-5 shrink-0 text-[var(--color-text-secondary)]" aria-hidden="true" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
                    {project.repoName || project.projectName}
                  </div>
                  <div className="truncate font-[var(--font-mono)] text-[11px] text-[var(--color-text-tertiary)]">
                    {project.realPath}
                  </div>
                </div>
                {isSelected && (
                  <Check className="size-4 shrink-0 text-[var(--color-brand)]" aria-hidden="true" />
                )}
              </Button>
            )
          })
        )}
      </div>
      <Separator />
      <div>
        <Button
          type="button"
          variant="ghost"
          onClick={handleChooseFolder}
          className="h-auto w-full justify-start gap-3 rounded-none px-4 py-3 text-left"
        >
          <FolderOpen className="size-5 text-[var(--color-text-tertiary)]" aria-hidden="true" />
          <span className="text-sm text-[var(--color-text-secondary)]">{t('dirPicker.chooseFolder')}</span>
        </Button>
      </div>
    </div>
  ) : (
    <div>
      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--color-border)] px-3 py-2">
        <Button
          type="button"
          variant="link"
          size="sm"
          onClick={() => setMode('recent')}
          className="mr-2 h-7 gap-1 text-xs"
        >
          <ArrowLeft aria-hidden="true" />
          {t('dirPicker.recent')}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => loadBrowseDir('/')} className="h-7 px-1.5 text-[10px]">/</Button>
        {browsePath.split('/').filter(Boolean).map((seg, i, arr) => (
          <span key={i} className="flex items-center gap-1">
            <span className="text-[10px] text-[var(--color-text-tertiary)]">/</span>
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={() => loadBrowseDir('/' + arr.slice(0, i + 1).join('/'))}
              className="h-7 px-0 text-[10px]"
            >{seg}</Button>
          </span>
        ))}
      </div>

      <div className={`${isMobileBrowser ? '' : 'max-h-[240px]'} overflow-y-auto`}>
        {loading ? (
          <div className="space-y-2 px-3 py-4" aria-label={t('common.loading')}>
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : (
          <>
            {browseParent && browseParent !== browsePath && (
              <Button type="button" variant="ghost" onClick={() => loadBrowseDir(browseParent)} className="h-auto w-full justify-start gap-2 rounded-none px-3 py-2 text-left">
                <ArrowUp className="size-4 text-[var(--color-text-tertiary)]" aria-hidden="true" />
                <span className="text-xs text-[var(--color-text-secondary)]">..</span>
              </Button>
            )}
            {browseEntries.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-[var(--color-text-tertiary)]">{t('dirPicker.noSubdirs')}</div>
            ) : browseEntries.map((entry) => (
              <div
                key={entry.path}
                className="flex w-full items-center gap-2 px-3 py-2 hover:bg-[var(--color-surface-hover)]"
              >
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => loadBrowseDir(entry.path)}
                  className="h-auto min-w-0 flex-1 justify-start gap-2 px-0 text-left hover:bg-transparent"
                >
                  <Folder className="size-4 text-[var(--color-text-tertiary)]" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-xs text-[var(--color-text-primary)]">{entry.name}</span>
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => handleSelect(entry.path)} className="h-7 px-2 text-[10px] text-[var(--color-brand)]">
                  {t('common.select')}
                </Button>
              </div>
            ))}
          </>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-[var(--color-border)] px-3 py-2">
        <span className="truncate font-[var(--font-mono)] text-[10px] text-[var(--color-text-tertiary)]">{browsePath}</span>
        <Button type="button" size="sm" onClick={() => handleSelect(browsePath)}>
          {t('dirPicker.useThisFolder')}
        </Button>
      </div>
    </div>
  )

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open)
    if (open) setMode('recent')
  }

  const trigger = (
    <Button
      ref={triggerRef}
      type="button"
      variant="ghost"
      aria-expanded={isOpen}
      aria-haspopup={isMobileBrowser ? 'dialog' : 'listbox'}
      onClick={isMobileBrowser ? () => handleOpenChange(!isOpen) : undefined}
      className={value ? triggerClassName : emptyTriggerClassName}
      title={value || t('dirPicker.selectProject')}
    >
      {value ? (
        showGitIcon ? (
          <GitBranch className="size-4 shrink-0 text-[var(--color-text-secondary)]" aria-hidden="true" />
        ) : (
          <Folder className="size-4 shrink-0 text-[var(--color-text-secondary)]" aria-hidden="true" />
        )
      ) : (
        <FolderOpen className="size-4 shrink-0" aria-hidden="true" />
      )}
      <span className="min-w-0 flex-1 truncate text-[var(--color-text-primary)]">
        {value ? selectedLabel : t('dirPicker.selectProject')}
      </span>
      <ChevronDown className="size-4 shrink-0 text-[var(--color-text-tertiary)]" aria-hidden="true" />
    </Button>
  )

  return (
    <div className={isWorkbar ? `relative min-w-0 ${isMobileBrowser ? 'flex-1' : 'max-w-[320px] shrink'}` : 'relative'}>
      {isMobileBrowser ? trigger : (
        <Popover open={isOpen} onOpenChange={handleOpenChange}>
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
          <PopoverContent
            ref={dropdownRef}
            data-testid="directory-picker-menu"
            align="start"
            collisionPadding={12}
            className="w-[min(400px,calc(100vw-24px))] overflow-hidden p-0"
          >
            {dropdownContent}
          </PopoverContent>
        </Popover>
      )}

      {isMobileBrowser && isOpen ? (
        <MobileBottomSheet
          open={isOpen}
          onClose={() => setIsOpen(false)}
          title={dropdownTitle}
          closeLabel={t('tabs.close')}
          panelRef={dropdownRef}
        >
          {dropdownContent}
        </MobileBottomSheet>
      ) : null}
    </div>
  )
}
