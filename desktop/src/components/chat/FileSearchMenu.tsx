import { forwardRef, useState, useEffect, useRef, useCallback, useImperativeHandle } from 'react'
import {
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  LoaderCircle,
} from 'lucide-react'
import { ApiError } from '../../api/client'
import { filesystemApi } from '../../api/filesystem'
import { useTranslation } from '../../i18n'
import type { TranslationKey } from '../../i18n'
import { Alert, AlertDescription } from '../ui/alert'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { IconButton } from '../ui/custom/icon-button'
import { KeyboardShortcut } from '../ui/custom/keyboard-shortcut'
import { ScrollArea } from '../ui/scroll-area'
import { Skeleton } from '../ui/skeleton'

type DirEntry = {
  name: string
  path: string
  isDirectory: boolean
  relativePath?: string
}

export type FileSearchMenuHandle = {
  handleKeyDown: (e: KeyboardEvent) => void
}

type Props = {
  cwd: string
  filter?: string
  compact?: boolean
  onSelect: (path: string, relativePath: string, isDirectory: boolean) => void
  onNavigate?: (relativePath: string) => void
  onActiveDescendantChange?: (id: string | undefined) => void
}

export const FileSearchMenu = forwardRef<FileSearchMenuHandle, Props>(({
  cwd,
  filter = '',
  compact = false,
  onSelect,
  onNavigate,
  onActiveDescendantChange,
}, ref) => {
  const t = useTranslation()
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null)
  const [currentPath, setCurrentPath] = useState(cwd)
  const [isSearchMode, setIsSearchMode] = useState(false)
  const [loading, setLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [rootPath, setRootPath] = useState(cwd)
  const listRef = useRef<HTMLDivElement>(null)
  const currentPathRef = useRef(cwd)
  const rootPathRef = useRef(cwd)
  const requestGenerationRef = useRef(0)
  const pendingNavigationLoadRef = useRef<string | null>(null)

  const getErrorState = (error: unknown): { errorKey: TranslationKey | null; errorMessage: string | null } => {
    if (error instanceof ApiError) {
      if (error.status === 403) {
        return { errorKey: 'fileSearch.accessDenied', errorMessage: null }
      }

      const apiMessage =
        typeof error.body === 'string'
          ? error.body
          : typeof error.body === 'object' &&
              error.body !== null &&
              'error' in error.body &&
              typeof error.body.error === 'string'
            ? error.body.error
            : null

      if (apiMessage) {
        return { errorKey: null, errorMessage: apiMessage }
      }
    }

    return { errorKey: 'fileSearch.loadFailed', errorMessage: null }
  }

  const getRelativePath = useCallback((entry: DirEntry) => {
    const basePath = (cwd || rootPath).replace(/\/+$/, '')
    if (entry.path.startsWith(`${basePath}/`)) return entry.path.slice(basePath.length + 1)
    if (entry.relativePath) return entry.relativePath
    return entry.name
  }, [cwd, rootPath])

  const getDisplayPath = useCallback((entry: DirEntry) => {
    const relativePath = getRelativePath(entry).replace(/\\/g, '/')
    if (!entry.isDirectory) return relativePath
    return `${relativePath.replace(/\/+$/, '')}/`
  }, [getRelativePath])

  const selectEntry = useCallback((entry: DirEntry) => {
    onSelect(entry.path, getRelativePath(entry), entry.isDirectory)
  }, [getRelativePath, onSelect])

  const parseFilter = (rawFilter: string): { navigateTo: string; searchQuery: string } => {
    const trimmed = rawFilter.trim()
    const basePath = (cwd || rootPathRef.current).replace(/\/+$/, '')
    if (!trimmed) return { navigateTo: basePath, searchQuery: '' }
    if (trimmed.endsWith('/')) {
      if (!basePath) return { navigateTo: '', searchQuery: trimmed.replace(/\/+$/, '') }
      return { navigateTo: `${basePath}/${trimmed.replace(/\/+$/, '')}`, searchQuery: '' }
    }
    return { navigateTo: basePath, searchQuery: trimmed }
  }

  // Load directory entries
  const loadDir = useCallback(async (dirPath: string, searchQuery: string) => {
    const requestGeneration = ++requestGenerationRef.current
    setLoading(true)
    setEntries([])
    setErrorMessage(null)
    setErrorKey(null)
    // Only update currentPath if actually navigating to a different directory
    if (dirPath !== currentPathRef.current) {
      setCurrentPath(dirPath)
      currentPathRef.current = dirPath
    }
    try {
      if (searchQuery) {
        setIsSearchMode(true)
        const result = await filesystemApi.search(searchQuery, dirPath)
        if (requestGeneration !== requestGenerationRef.current) return
        setCurrentPath(result.currentPath)
        currentPathRef.current = result.currentPath
        if (!cwd) {
          setRootPath(result.currentPath)
          rootPathRef.current = result.currentPath
        }
        setEntries(result.entries)
      } else {
        setIsSearchMode(false)
        const result = await filesystemApi.browse(dirPath, { includeFiles: true })
        if (requestGeneration !== requestGenerationRef.current) return
        setCurrentPath(result.currentPath)
        currentPathRef.current = result.currentPath
        if (!cwd) {
          setRootPath(result.currentPath)
          rootPathRef.current = result.currentPath
        }
        setEntries(result.entries)
      }
      setSelectedIndex(0)
    } catch (error) {
      if (requestGeneration !== requestGenerationRef.current) return
      setEntries([])
      const nextError = getErrorState(error)
      setErrorKey(nextError.errorKey)
      setErrorMessage(nextError.errorMessage)
    }
    if (requestGeneration === requestGenerationRef.current) setLoading(false)
  }, [cwd])

  const navigateEntry = useCallback((entry: DirEntry) => {
    if (!entry.isDirectory) return
    const relativePath = `${getRelativePath(entry).replace(/\/+$/, '')}/`
    pendingNavigationLoadRef.current = entry.path
    void loadDir(entry.path, '')
    onNavigate?.(relativePath)
  }, [getRelativePath, loadDir, onNavigate])

  // Keep the explicit workspace root stable when the host session changes.
  useEffect(() => {
    currentPathRef.current = cwd
    rootPathRef.current = cwd
    setRootPath(cwd)
    setCurrentPath(cwd)
  }, [cwd])

  // Initial load: parse filter path and navigate accordingly
  useEffect(() => {
    const { navigateTo, searchQuery } = parseFilter(filter)
    if (!searchQuery && pendingNavigationLoadRef.current === navigateTo) {
      pendingNavigationLoadRef.current = null
      return
    }
    pendingNavigationLoadRef.current = null
    void loadDir(navigateTo, searchQuery)
  }, [cwd, filter, loadDir])

  // Keyboard navigation handler exposed via ref
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => Math.min(prev + 1, entries.length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => Math.max(prev - 1, 0))
      return
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      const selected = entries[selectedIndex]
      if (selected) {
        selectEntry(selected)
      }
      return
    }
    if (e.key === 'ArrowRight') {
      const selected = entries[selectedIndex]
      if (selected?.isDirectory) {
        e.preventDefault()
        navigateEntry(selected)
      }
      return
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, selectedIndex, selectEntry, navigateEntry])

  useImperativeHandle(ref, () => ({ handleKeyDown }), [handleKeyDown])

  // Scroll selected into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`) as HTMLButtonElement | null
    el?.scrollIntoView({ block: 'nearest' })
    onActiveDescendantChange?.(entries[selectedIndex] ? `file-search-option-${selectedIndex}` : undefined)
  }, [entries, onActiveDescendantChange, selectedIndex])

  // Build breadcrumb segments from current path relative to cwd
  const breadcrumbs: string[] = []
  if (currentPath !== cwd && currentPath.startsWith(cwd)) {
    const rel = currentPath.slice(cwd.length).replace(/^\//, '')
    if (rel) breadcrumbs.push(...rel.split('/'))
  }

  const renderEntry = (entry: DirEntry, index: number) => {
    const relativePath = getRelativePath(entry)
    const displayPath = getDisplayPath(entry)
    const parentPath = relativePath.split('/').slice(0, -1).join('/')
    const selected = selectedIndex === index
    return (
      <div
        key={entry.path}
        data-index={index}
        className={`group flex items-stretch px-1.5 py-0.5 ${
          selected ? 'bg-[var(--color-surface-hover)]' : ''
        }`}
        onMouseEnter={() => setSelectedIndex(index)}
      >
        <Button
          id={`file-search-option-${index}`}
          type="button"
          variant="ghost"
          onClick={() => selectEntry(entry)}
          className={`h-auto min-w-0 flex-1 justify-start whitespace-normal rounded-lg px-2.5 text-left ${
            isSearchMode ? 'gap-2.5 py-2' : 'gap-3 py-2'
          }`}
          role="option"
          aria-selected={selected}
        >
          {entry.isDirectory ? (
            <Folder aria-hidden className="size-[17px] shrink-0 text-[var(--color-brand)]" />
          ) : (
            <FileText aria-hidden className="size-[17px] shrink-0 text-[var(--color-text-secondary)]" />
          )}
          <span className="min-w-0 flex-1">
            {isSearchMode ? (
              <span
                className="block truncate font-[var(--font-mono)] text-sm text-[var(--color-text-primary)]"
                title={displayPath}
              >
                {displayPath}
              </span>
            ) : (
              <>
                <span className="block truncate text-sm font-medium text-[var(--color-text-primary)]">{entry.name}</span>
                <span className="block truncate font-[var(--font-mono)] text-[11px] text-[var(--color-text-tertiary)]">
                  {parentPath || (entry.isDirectory ? t('fileSearch.directory') : t('fileSearch.currentDirectory'))}
                </span>
              </>
            )}
          </span>
          {!isSearchMode ? (
            <Badge variant="outline" className="min-h-0 shrink-0 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.02em]">
              {entry.isDirectory ? t('fileSearch.folderTag') : t('fileSearch.fileTag')}
            </Badge>
          ) : null}
        </Button>
        {entry.isDirectory ? (
          <IconButton
            label={t('fileSearch.openFolder')}
            title={t('fileSearch.openFolder')}
            variant="ghost"
            size="icon"
            onClick={(event) => {
              event.stopPropagation()
              navigateEntry(entry)
            }}
            className="my-1 size-9 shrink-0 rounded-lg text-[var(--color-text-tertiary)] opacity-70 group-hover:opacity-100"
          >
            <ChevronRight aria-hidden className="size-4" />
          </IconButton>
        ) : null}
      </div>
    )
  }

  return (
    <Card
      id="file-search-menu"
      role="listbox"
      aria-label={t('fileSearch.select')}
      aria-busy={loading}
      className={`absolute bottom-full mb-2 z-50 w-full overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] shadow-[var(--shadow-dropdown)] ${
        compact ? 'left-0 right-0 min-w-0 max-w-[calc(100vw-32px)]' : 'left-0 min-w-[480px]'
      }`}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Header with path */}
      <div className="flex items-center gap-1.5 border-b border-[var(--color-border)] px-3 py-2 text-[11px]">
        <FolderOpen aria-hidden className="size-3.5 text-[var(--color-text-tertiary)]" />
        <span className="text-[var(--color-text-tertiary)] font-mono">{cwd.split('/').pop() || cwd}</span>
        {breadcrumbs.map((seg, i) => (
          <span key={i} className="flex items-center gap-1">
            <span className="text-[var(--color-text-tertiary)]">/</span>
            <span className="text-[var(--color-text-primary)] font-mono">{seg}</span>
          </span>
        ))}
        {isSearchMode && filter ? (
          <span className="ml-auto truncate font-mono text-[11px] text-[var(--color-text-tertiary)]">@{filter}</span>
        ) : null}
        {loading && (
          <LoaderCircle aria-hidden className="ml-1 size-3 animate-spin text-[var(--color-text-tertiary)]" />
        )}
      </div>

      {/* File list */}
      <ScrollArea ref={listRef} className="h-[min(300px,var(--radix-popover-content-available-height,300px))] py-1">
        {loading && entries.length === 0 ? (
          <div className="space-y-2 px-4 py-4" aria-label={t('fileSearch.searching')}>
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-4/5" />
            <Skeleton className="h-9 w-11/12" />
          </div>
        ) : (errorKey || errorMessage) ? (
          <Alert variant="destructive" className="m-3 w-auto">
            <AlertDescription className="text-[var(--color-error)]">
              {errorKey ? t(errorKey) : errorMessage}
            </AlertDescription>
          </Alert>
        ) : entries.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-[var(--color-text-tertiary)]">
            {filter ? t('fileSearch.noMatch') : t('fileSearch.noFiles')}
          </div>
        ) : (
          <>
            {entries.map(renderEntry)}
          </>
        )}
      </ScrollArea>

      {/* Footer hint */}
      {!compact ? (
        <div className="flex items-center gap-1.5 border-t border-[var(--color-border)] px-3 py-1.5 text-[10px] text-[var(--color-text-tertiary)]">
          <KeyboardShortcut>↑↓</KeyboardShortcut>
          <span>{t('fileSearch.navigate')}</span>
          <KeyboardShortcut className="ml-2">Enter</KeyboardShortcut>
          <span>{t('fileSearch.select')}</span>
          <KeyboardShortcut className="ml-2">→</KeyboardShortcut>
          <span>{t('fileSearch.open')}</span>
          <KeyboardShortcut className="ml-2">Esc</KeyboardShortcut>
          <span>{t('fileSearch.close')}</span>
        </div>
      ) : null}
    </Card>
  )
})

FileSearchMenu.displayName = 'FileSearchMenu'
