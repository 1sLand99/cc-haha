import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  Check,
  ChevronDown,
  GitBranch,
  GitFork,
  Search,
} from 'lucide-react'
import {
  sessionsApi,
  type RepositoryBranchInfo,
  type RepositoryContextResult,
} from '../../api/sessions'
import { useTranslation } from '../../i18n'
import { DirectoryPicker } from './DirectoryPicker'
import { useMobileViewport } from '../../hooks/useMobileViewport'
import { isDesktopRuntime } from '../../lib/desktopRuntime'
import { MobileBottomSheet } from './MobileBottomSheet'
import { Alert, AlertDescription } from '../ui/alert'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { Separator } from '../ui/separator'
import { Skeleton } from '../ui/skeleton'

type Props = {
  workDir: string
  onWorkDirChange: (path: string) => void
  branch: string | null
  onBranchChange: (branch: string | null) => void
  useWorktree: boolean
  onUseWorktreeChange: (enabled: boolean) => void
  onLaunchReadyChange?: (ready: boolean) => void
  disabled?: boolean
  placement?: 'standalone' | 'composer'
}

function stateMessage(context: RepositoryContextResult | null, error: string | null) {
  if (error) return error
  if (!context) return null
  if (context.state === 'not_git_repo') return null
  if (context.state === 'missing_workdir') return 'missing'
  if (context.state === 'error') return context.error || 'error'
  return null
}

export function RepositoryLaunchControls({
  workDir,
  onWorkDirChange,
  branch,
  onBranchChange,
  useWorktree,
  onUseWorktreeChange,
  onLaunchReadyChange,
  disabled = false,
  placement = 'standalone',
}: Props) {
  const t = useTranslation()
  const isMobileBrowser = useMobileViewport() && !isDesktopRuntime()
  const isComposerPlacement = placement === 'composer' && !isMobileBrowser
  const [context, setContext] = useState<RepositoryContextResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [branchMenuOpen, setBranchMenuOpen] = useState(false)
  const [branchFilter, setBranchFilter] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [worktreeMenuOpen, setWorktreeMenuOpen] = useState(false)
  const branchButtonRef = useRef<HTMLButtonElement>(null)
  const worktreeButtonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const worktreeMenuRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const currentWorktreeOptionRef = useRef<HTMLButtonElement>(null)
  const isolatedWorktreeOptionRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const searchInputId = useId()
  const listboxId = useId()
  const worktreeListboxId = useId()

  useEffect(() => {
    if (!workDir) {
      setContext(null)
      setError(null)
      setLoading(false)
      onBranchChange(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)
    sessionsApi.getRepositoryContext(workDir)
      .then((result) => {
        if (cancelled) return
        setContext(result)
      })
      .catch((err) => {
        if (cancelled) return
        setContext(null)
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [workDir, onBranchChange])

  useEffect(() => {
    if (context?.state !== 'ok') {
      if (context && branch !== null) onBranchChange(null)
      return
    }

    const branchExists = branch && context.branches.some((candidate) => candidate.name === branch)
    if (branchExists) return

    const fallbackBranch = [
      context.currentBranch,
      context.defaultBranch,
      context.branches[0]?.name,
    ].find((name) => name && context.branches.some((candidate) => candidate.name === name))

    onBranchChange(fallbackBranch || null)
  }, [branch, context, onBranchChange])

  useEffect(() => {
    if (!branchMenuOpen) return
    if (isMobileBrowser) requestAnimationFrame(() => searchRef.current?.focus())
  }, [branchMenuOpen, isMobileBrowser])

  useEffect(() => {
    setSelectedIndex(0)
  }, [branchFilter])

  useEffect(() => {
    const activeItem = branchMenuOpen ? itemRefs.current[selectedIndex] : null
    activeItem?.scrollIntoView({ block: 'nearest' })
  }, [branchMenuOpen, selectedIndex])

  const selectedBranch = useMemo(() => {
    if (context?.state !== 'ok') return null
    return context.branches.find((candidate) => candidate.name === branch) ?? null
  }, [branch, context])

  const filteredBranches = useMemo(() => {
    if (context?.state !== 'ok') return []
    const query = branchFilter.trim().toLowerCase()
    if (!query) return context.branches
    return context.branches.filter((candidate) => (
      candidate.name.toLowerCase().includes(query) ||
      candidate.remoteRef?.toLowerCase().includes(query) ||
      candidate.worktreePath?.toLowerCase().includes(query)
    ))
  }, [branchFilter, context])

  const warningMessage = useMemo(() => {
    if (context?.state !== 'ok' || !selectedBranch || useWorktree) return null
    if (selectedBranch.name !== context.currentBranch && context.dirty) {
      return t('repoLaunch.dirtyWarning')
    }
    if (selectedBranch.name !== context.currentBranch && selectedBranch.checkedOut) {
      return t('repoLaunch.checkedOutWarning')
    }
    return null
  }, [context, selectedBranch, t, useWorktree])

  const selectBranch = (candidate: RepositoryBranchInfo) => {
    onBranchChange(candidate.name)
    setBranchMenuOpen(false)
    setBranchFilter('')
  }

  const selectWorktreeMode = (enabled: boolean) => {
    onUseWorktreeChange(enabled)
    setWorktreeMenuOpen(false)
  }

  const handleBranchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelectedIndex((prev) => Math.min(prev + 1, Math.max(filteredBranches.length - 1, 0)))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelectedIndex((prev) => Math.max(prev - 1, 0))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const candidate = filteredBranches[selectedIndex]
      if (candidate) selectBranch(candidate)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setBranchMenuOpen(false)
    }
  }

  const message = stateMessage(context, error)
  const isGitReady = context?.state === 'ok'
  const isLaunchReady = !workDir || (
    !loading &&
    (!!context || !!error) &&
    (
      context?.state !== 'ok' ||
      context.branches.length === 0 ||
      !!selectedBranch
    )
  )

  useEffect(() => {
    onLaunchReadyChange?.(isLaunchReady)
  }, [isLaunchReady, onLaunchReadyChange])

  const worktreeLabel = useWorktree ? t('repoLaunch.worktreeIsolated') : t('repoLaunch.worktreeCurrent')
  const workbarButtonClassName = 'h-9 min-w-0 justify-start gap-1.5 rounded-[7px] border-transparent px-2.5 text-[13px] leading-none text-[var(--color-text-secondary)]'

  const branchSearch = (
    <div className="relative">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-text-tertiary)]"
        aria-hidden="true"
      />
      <Input
        id={searchInputId}
        ref={searchRef}
        value={branchFilter}
        onChange={(event) => setBranchFilter(event.target.value)}
        onKeyDown={handleBranchKeyDown}
        aria-label={t('repoLaunch.searchBranch')}
        aria-controls={listboxId}
        aria-activedescendant={filteredBranches[selectedIndex] ? `${listboxId}-option-${selectedIndex}` : undefined}
        placeholder={t('repoLaunch.searchBranch')}
        className="h-9 bg-[var(--color-surface-container-low)] pl-9"
      />
    </div>
  )

  const branchOptions = (mobile: boolean) => (
    <div
      id={listboxId}
      role="listbox"
      aria-label={t('repoLaunch.selectBranch')}
      className={`${mobile ? '' : 'max-h-[280px]'} overflow-y-auto py-1`}
    >
      {filteredBranches.length === 0 ? (
        <div className="px-4 py-8 text-center text-xs text-[var(--color-text-tertiary)]">
          {t('repoLaunch.noBranchMatch')}
        </div>
      ) : filteredBranches.map((candidate, index) => {
        const isSelected = candidate.name === selectedBranch?.name
        return (
          <Button
            key={candidate.name}
            id={`${listboxId}-option-${index}`}
            ref={(element) => { itemRefs.current[index] = element }}
            type="button"
            variant="ghost"
            role="option"
            aria-selected={isSelected}
            onMouseEnter={() => setSelectedIndex(index)}
            onClick={() => selectBranch(candidate)}
            className={`h-auto w-full justify-start gap-3 rounded-none px-4 text-left ${
              mobile ? 'min-h-[56px] py-3' : 'py-3'
            } ${
              index === selectedIndex || isSelected ? 'bg-[var(--color-surface-hover)]' : ''
            }`}
          >
            <span className={`h-8 w-1 shrink-0 rounded-full ${isSelected ? 'bg-[var(--color-brand)]' : 'bg-transparent'}`} />
            <GitBranch className="size-[17px] text-[var(--color-text-secondary)]" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-[var(--color-text-primary)]">
                {candidate.name}
              </span>
              <span className="block truncate text-[11px] text-[var(--color-text-tertiary)]">
                {candidate.current
                  ? t('repoLaunch.currentBranch')
                  : candidate.checkedOut
                    ? t('repoLaunch.checkedOut')
                    : candidate.remote && !candidate.local
                      ? candidate.remoteRef || t('repoLaunch.remoteBranch')
                      : t('repoLaunch.localBranch')}
              </span>
            </span>
            {isSelected && <Check className="size-[17px] text-[var(--color-brand)]" aria-hidden="true" />}
          </Button>
        )
      })}
    </div>
  )

  const worktreeOptions = (mobile: boolean) => (
    <div id={worktreeListboxId} role="listbox" aria-label={t('repoLaunch.selectWorktree')}>
      <Button
        ref={currentWorktreeOptionRef}
        type="button"
        variant="ghost"
        role="option"
        aria-selected={!useWorktree}
        onClick={() => selectWorktreeMode(false)}
        className={`h-auto w-full justify-start gap-2.5 rounded-none text-left ${
          mobile ? 'min-h-[52px] px-4 py-3' : 'px-3 py-2.5'
        } ${!useWorktree ? 'bg-[var(--color-surface-hover)]' : ''}`}
      >
        <GitFork className="size-4 text-[var(--color-text-tertiary)]" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--color-text-primary)]">
          {t('repoLaunch.worktreeCurrent')}
        </span>
        {!useWorktree && <Check className="size-4 text-[var(--color-brand)]" aria-hidden="true" />}
      </Button>

      <Button
        ref={isolatedWorktreeOptionRef}
        type="button"
        variant="ghost"
        role="option"
        aria-selected={useWorktree}
        onClick={() => selectWorktreeMode(true)}
        className={`h-auto w-full justify-start gap-2.5 rounded-none text-left ${
          mobile ? 'min-h-[52px] px-4 py-3' : 'px-3 py-2.5'
        } ${useWorktree ? 'bg-[var(--color-surface-hover)]' : ''}`}
      >
        <GitFork className="size-4 text-[var(--color-text-tertiary)]" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--color-text-primary)]">
          {t('repoLaunch.worktreeIsolated')}
        </span>
        {useWorktree && <Check className="size-4 text-[var(--color-brand)]" aria-hidden="true" />}
      </Button>
    </div>
  )

  const branchTrigger = (
    <Button
      ref={branchButtonRef}
      type="button"
      variant="ghost"
      disabled={disabled || loading || context?.state !== 'ok' || context.branches.length === 0}
      aria-expanded={branchMenuOpen}
      aria-label={`${t('repoLaunch.selectBranch')}: ${selectedBranch?.name || t('repoLaunch.noBranch')}`}
      title={selectedBranch?.name || t('repoLaunch.noBranch')}
      onClick={isMobileBrowser ? () => {
        setBranchMenuOpen((open) => !open)
        setWorktreeMenuOpen(false)
        setBranchFilter('')
      } : undefined}
      className={`${workbarButtonClassName} ${isMobileBrowser ? 'max-w-[160px] shrink-0 bg-[var(--color-surface-container)]' : 'max-w-[260px] shrink'}`}
    >
      <GitBranch className="size-[17px] text-[var(--color-text-tertiary)]" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-[var(--color-text-primary)]">
        {selectedBranch?.name || t('repoLaunch.noBranch')}
      </span>
      <ChevronDown className="size-4 text-[var(--color-text-tertiary)]" aria-hidden="true" />
    </Button>
  )

  const worktreeTrigger = (
    <Button
      ref={worktreeButtonRef}
      type="button"
      variant="ghost"
      disabled={disabled}
      aria-expanded={worktreeMenuOpen}
      aria-controls={worktreeMenuOpen ? worktreeListboxId : undefined}
      aria-label={`${t('repoLaunch.selectWorktree')}: ${worktreeLabel}`}
      title={worktreeLabel}
      onClick={isMobileBrowser ? () => {
        setWorktreeMenuOpen((open) => !open)
        setBranchMenuOpen(false)
      } : undefined}
      className={`${workbarButtonClassName} shrink-0 ${isMobileBrowser ? 'bg-[var(--color-surface-container)]' : ''} ${
        useWorktree
          ? 'bg-[var(--color-surface-container-lowest)] text-[var(--color-text-primary)]'
          : ''
      }`}
    >
      <GitFork className="size-[17px] text-[var(--color-text-tertiary)]" aria-hidden="true" />
      <span className="min-w-0 truncate">{worktreeLabel}</span>
      <ChevronDown className="size-4 text-[var(--color-text-tertiary)]" aria-hidden="true" />
    </Button>
  )

  return (
    <div className={`flex min-w-0 flex-col ${isMobileBrowser ? 'gap-0' : isComposerPlacement ? 'gap-1' : 'gap-2'}`}>
      <div className={`flex min-w-0 items-center justify-start gap-x-1.5 gap-y-1 overflow-hidden border-t border-[var(--color-border-separator)] ${
        isMobileBrowser
          ? 'min-h-[52px] flex-wrap rounded-none bg-[var(--color-surface-container-lowest)] px-3 py-2 shadow-none'
          : isComposerPlacement
            ? 'min-h-[44px] flex-nowrap bg-transparent px-4 py-2'
          : 'min-h-[48px] flex-nowrap rounded-b-xl bg-[var(--color-surface-container-low)] px-4 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]'
      }`}>
        <DirectoryPicker value={workDir} onChange={onWorkDirChange} variant="workbar" isGitProject={isGitReady} />

        {loading && workDir && !isMobileBrowser && (
          <Skeleton className="h-9 w-24" aria-label={t('common.loading')} />
        )}

        {isGitReady && (
          <>
            <Separator orientation="vertical" className="hidden h-4 opacity-70 sm:block" />
            {isMobileBrowser ? branchTrigger : (
              <Popover
                open={branchMenuOpen}
                onOpenChange={(open) => {
                  setBranchMenuOpen(open)
                  if (open) {
                    setWorktreeMenuOpen(false)
                    setBranchFilter('')
                  }
                }}
              >
                <PopoverTrigger asChild>{branchTrigger}</PopoverTrigger>
                <PopoverContent
                  ref={menuRef}
                  align="start"
                  collisionPadding={12}
                  className="w-[390px] overflow-hidden p-0"
                  onOpenAutoFocus={(event) => {
                    event.preventDefault()
                    searchRef.current?.focus()
                  }}
                >
                  <div className="space-y-2 border-b border-[var(--color-border)] p-3">
                    <Label htmlFor={searchInputId} className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-outline)]">
                      {t('repoLaunch.selectBranch')}
                    </Label>
                    {branchSearch}
                  </div>
                  {branchOptions(false)}
                </PopoverContent>
              </Popover>
            )}

            {isMobileBrowser ? worktreeTrigger : (
              <Popover
                open={worktreeMenuOpen}
                onOpenChange={(open) => {
                  setWorktreeMenuOpen(open)
                  if (open) setBranchMenuOpen(false)
                }}
              >
                <PopoverTrigger asChild>{worktreeTrigger}</PopoverTrigger>
                <PopoverContent
                  ref={worktreeMenuRef}
                  align="start"
                  collisionPadding={12}
                  className="w-[226px] overflow-hidden p-0 py-1"
                  onOpenAutoFocus={(event) => {
                    event.preventDefault()
                    const selectedOption = useWorktree
                      ? isolatedWorktreeOptionRef.current
                      : currentWorktreeOptionRef.current
                    selectedOption?.focus()
                  }}
                >
                  {worktreeOptions(false)}
                </PopoverContent>
              </Popover>
            )}
          </>
        )}
      </div>

      {message && workDir && (
        <Alert variant="destructive" className="flex items-center gap-2 px-2 py-1.5 text-[11px]">
          <AlertCircle className="size-[13px] shrink-0" aria-hidden="true" />
          <AlertDescription className="text-current">
            {message === 'missing'
              ? t('repoLaunch.missingWorkdir')
              : message}
          </AlertDescription>
        </Alert>
      )}

      {warningMessage && (
        <Alert className="flex items-center gap-2 border-[var(--color-warning)]/35 bg-[var(--color-warning-container)] px-2 py-1.5 text-[11px] text-[var(--color-warning)]">
          <AlertCircle className="size-[13px] shrink-0" aria-hidden="true" />
          <AlertDescription className="text-current">{warningMessage}</AlertDescription>
        </Alert>
      )}

      {isMobileBrowser && branchMenuOpen && (
        <MobileBottomSheet
          open={branchMenuOpen}
          onClose={() => setBranchMenuOpen(false)}
          title={t('repoLaunch.selectBranch')}
          closeLabel={t('tabs.close')}
          panelRef={menuRef}
          headerExtra={branchSearch}
        >
          {branchOptions(true)}
        </MobileBottomSheet>
      )}

      {isMobileBrowser && worktreeMenuOpen && (
        <MobileBottomSheet
          open={worktreeMenuOpen}
          onClose={() => setWorktreeMenuOpen(false)}
          title={t('repoLaunch.selectWorktree')}
          closeLabel={t('tabs.close')}
          panelRef={worktreeMenuRef}
          contentClassName="py-2"
        >
          {worktreeOptions(true)}
        </MobileBottomSheet>
      )}
    </div>
  )
}
