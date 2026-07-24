import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import {
  ChevronRight,
  CircleSlash2,
  Folder,
  Layers3,
  Network,
  NotebookText,
  Package,
  Puzzle,
  Search,
  Sparkles,
  User,
  X,
} from 'lucide-react'
import { useSkillStore } from '../../stores/skillStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTranslation } from '../../i18n'
import type { SkillMeta, SkillSource } from '../../types/skill'
import { Alert, AlertDescription, AlertTitle } from '../ui/alert'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../ui/card'
import { IconButton } from '../ui/custom/icon-button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Skeleton } from '../ui/skeleton'

const SOURCE_ORDER: SkillSource[] = ['user', 'project', 'plugin', 'mcp', 'bundled']

const SOURCE_ICONS: Record<SkillSource, ComponentType<{ className?: string }>> = {
  user: User,
  project: Folder,
  plugin: Puzzle,
  mcp: Network,
  bundled: Package,
}

const SOURCE_ACCENT_CLASSES: Record<SkillSource, string> = {
  user: 'bg-[var(--color-primary-fixed)] text-[var(--color-brand)]',
  project: 'bg-[var(--color-success-container)] text-[var(--color-success)]',
  plugin: 'bg-[var(--color-warning-container)] text-[var(--color-warning)]',
  mcp: 'bg-[var(--color-info-container)] text-[var(--color-info)]',
  bundled: 'bg-[var(--color-surface-container-high)] text-[var(--color-text-tertiary)]',
}

function estimateTokens(contentLength: number) {
  return Math.ceil(contentLength / 4)
}

export function getSkillKey(skill: Pick<SkillMeta, 'source' | 'name'>) {
  return `${skill.source}:${skill.name}`
}

export function SkillList({
  onOpenSkill,
}: {
  onOpenSkill?: (skillKey: string) => void
}) {
  const {
    skills,
    isLoading,
    error,
    fetchSkills,
    fetchSkillDetail,
  } = useSkillStore()
  const sessions = useSessionStore((state) => state.sessions)
  const activeSessionId = useSessionStore((state) => state.activeSessionId)
  const t = useTranslation()
  const activeSession = sessions.find((session) => session.id === activeSessionId)
  const currentWorkDir = activeSession?.workDir || undefined
  const [searchQuery, setSearchQuery] = useState('')
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase()

  useEffect(() => {
    void fetchSkills(currentWorkDir)
  }, [fetchSkills, currentWorkDir])

  const filteredSkills = useMemo(() => {
    if (!normalizedSearchQuery) return skills

    return skills.filter((skill) => {
      const fields = [
        skill.name,
        skill.displayName,
        skill.description,
        skill.source,
        t(`settings.skills.source.${skill.source}`),
        skill.version,
        skill.pluginName,
      ]

      return fields.some((field) =>
        field?.toLocaleLowerCase().includes(normalizedSearchQuery),
      )
    })
  }, [skills, normalizedSearchQuery, t])

  const grouped = useMemo(() => {
    const result: Partial<Record<SkillSource, SkillMeta[]>> = {}
    for (const skill of filteredSkills) {
      const source = skill.source as SkillSource
      ;(result[source] ??= []).push(skill)
    }
    return result
  }, [filteredSkills])

  const totalTokens = useMemo(
    () => filteredSkills.reduce(
      (sum, skill) => sum + estimateTokens(skill.contentLength),
      0,
    ),
    [filteredSkills],
  )

  const visibleGroupCount = useMemo(
    () => SOURCE_ORDER.filter((source) => (grouped[source] ?? []).length > 0).length,
    [grouped],
  )

  if (isLoading) return <SkillListSkeleton />

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>{t('settings.skills.title')}</AlertTitle>
        <AlertDescription className="break-words">{error}</AlertDescription>
        <Button
          variant="outline"
          size="sm"
          className="mt-2 w-fit"
          onClick={() => void fetchSkills(currentWorkDir)}
        >
          {t('common.retry')}
        </Button>
      </Alert>
    )
  }

  if (skills.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="px-6 py-12 text-center">
          <Sparkles className="mx-auto mb-2 h-10 w-10 text-[var(--color-text-tertiary)]" aria-hidden="true" />
          <p className="text-sm text-[var(--color-text-tertiary)]">
            {t('settings.skills.empty')}
          </p>
          <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
            {t('settings.skills.emptyHint')}
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Card className="overflow-hidden">
        <CardContent className="grid min-w-0 gap-4 px-5 py-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)] xl:items-end">
          <div className="min-w-0">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--color-text-tertiary)]">
              {t('settings.skills.browserEyebrow')}
            </div>
            <div className="mb-2 flex items-center gap-3">
              <Sparkles className="h-[22px] w-[22px] text-[var(--color-brand)]" aria-hidden="true" />
              <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">
                {t('settings.skills.browserTitle')}
              </h3>
            </div>
            <p className="max-w-3xl text-sm leading-6 text-[var(--color-text-secondary)]">
              {t('settings.skills.browserDescription')}
            </p>
            <div className="mt-4 max-w-2xl">
              <Label className="sr-only" htmlFor="settings-skill-search">
                {t('settings.skills.searchLabel')}
              </Label>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[var(--color-text-tertiary)]"
                  aria-hidden="true"
                />
                <Input
                  id="settings-skill-search"
                  data-skill-search
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder={t('settings.skills.searchPlaceholder')}
                  className="h-11 px-10"
                />
                {searchQuery && (
                  <IconButton
                    type="button"
                    label={t('settings.skills.clearSearch')}
                    variant="ghost"
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full"
                    onClick={() => {
                      setSearchQuery('')
                      document.querySelector<HTMLInputElement>('[data-skill-search]')?.focus()
                    }}
                  >
                    <X aria-hidden="true" />
                  </IconButton>
                )}
              </div>
              {normalizedSearchQuery && (
                <p className="mt-2 text-[11px] text-[var(--color-text-tertiary)]">
                  {t('settings.skills.searchResultCount', {
                    count: String(filteredSkills.length),
                    total: String(skills.length),
                  })}
                </p>
              )}
            </div>
          </div>

          <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3">
            <SummaryCard
              label={t('settings.skills.summary.totalSkills')}
              value={String(filteredSkills.length)}
              icon={<Sparkles aria-hidden="true" />}
            />
            <SummaryCard
              label={t('settings.skills.summary.sources')}
              value={String(visibleGroupCount)}
              icon={<Layers3 aria-hidden="true" />}
            />
            <SummaryCard
              label={t('settings.skills.summary.tokens')}
              value={t('settings.skills.tokenEstimateShort', { count: String(totalTokens) })}
              icon={<NotebookText aria-hidden="true" />}
              className="col-span-2 sm:col-span-1"
            />
          </div>
        </CardContent>
      </Card>

      {filteredSkills.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="px-6 py-12 text-center">
            <CircleSlash2 className="mx-auto mb-2 h-10 w-10 text-[var(--color-text-tertiary)]" aria-hidden="true" />
            <p className="text-sm text-[var(--color-text-tertiary)]">
              {t('settings.skills.noSearchResults')}
            </p>
            <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
              {t('settings.skills.noSearchResultsHint')}
            </p>
          </CardContent>
        </Card>
      )}

      <div className={`grid gap-4 ${visibleGroupCount >= 2 ? 'xl:grid-cols-2' : ''}`}>
        {SOURCE_ORDER.map((source) => {
          const group = grouped[source]
          if (!group?.length) return null

          const SourceIcon = SOURCE_ICONS[source]
          const sourceLabel = t(`settings.skills.source.${source}`)
          const sourceTokenCount = group.reduce(
            (sum, skill) => sum + estimateTokens(skill.contentLength),
            0,
          )

          return (
            <Card key={source} className="min-w-0 overflow-hidden bg-[var(--color-surface)]">
              <CardHeader className="flex-row items-start justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-5 py-4">
                <div className="min-w-0">
                  <div className="mb-1 flex items-center gap-2">
                    <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${SOURCE_ACCENT_CLASSES[source]}`}>
                      <SourceIcon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <CardTitle className="text-sm">{sourceLabel}</CardTitle>
                    <Badge variant="secondary">{group.length}</Badge>
                  </div>
                  <CardDescription className="text-xs leading-5">
                    {t('settings.skills.groupHint', {
                      source: sourceLabel,
                      count: String(group.length),
                    })}
                  </CardDescription>
                </div>
                <Badge variant="outline" className="whitespace-nowrap">
                  {t('settings.skills.tokenEstimateShort', { count: String(sourceTokenCount) })}
                </Badge>
              </CardHeader>

              <CardContent className="flex flex-col p-2">
                {group.map((skill) => {
                  const skillKey = getSkillKey(skill)
                  return (
                    <Button
                      key={skillKey}
                      variant="ghost"
                      data-skill-key={skillKey}
                      disabled={!skill.hasDirectory}
                      onClick={() => {
                        onOpenSkill?.(skillKey)
                        void fetchSkillDetail(
                          skill.source,
                          skill.name,
                          currentWorkDir,
                          'skills',
                        )
                      }}
                      className="group h-auto min-h-20 w-full justify-start whitespace-normal rounded-xl border border-transparent px-3 py-3 text-left hover:border-[var(--color-border-focus)] disabled:hover:border-transparent"
                    >
                      <Sparkles className="mt-0.5 h-[18px] w-[18px] self-start text-[var(--color-text-tertiary)]" aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="break-all text-sm font-semibold text-[var(--color-text-primary)]">
                            {skill.displayName || skill.name}
                          </span>
                          {skill.version && (
                            <Badge variant="secondary" className="font-mono text-[10px]">
                              v{skill.version}
                            </Badge>
                          )}
                          {skill.userInvocable && (
                            <Badge variant="outline" className="text-[10px]">
                              {t('settings.skills.slashCommand')}
                            </Badge>
                          )}
                          {/* Only flagged for `.agents`: `.claude` is the norm and
                              badging it would be noise on every existing skill. */}
                          {skill.rootFlavor === 'agents' && (
                            <Badge
                              variant="secondary"
                              className="font-mono text-[10px]"
                              title={t('settings.skills.agentsDirHint')}
                            >
                              {t('settings.skills.agentsDirBadge')}
                            </Badge>
                          )}
                        </span>
                        <span className="mt-1 block break-words text-xs font-normal leading-5 text-[var(--color-text-secondary)]">
                          {skill.description}
                        </span>
                        <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-normal text-[var(--color-text-tertiary)]">
                          <span>{sourceLabel}</span>
                          <span>{t('settings.skills.tokenEstimateShort', { count: String(estimateTokens(skill.contentLength)) })}</span>
                          <span>{skill.hasDirectory ? t('settings.skills.ready') : t('settings.skills.unavailable')}</span>
                        </span>
                      </span>
                      <ChevronRight className="h-[18px] w-[18px] text-[var(--color-text-tertiary)] opacity-60 transition-transform group-hover:translate-x-0.5 group-hover:opacity-100" aria-hidden="true" />
                    </Button>
                  )
                })}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

function SummaryCard({
  label,
  value,
  icon,
  className = '',
}: {
  label: string
  value: string
  icon: ReactNode
  className?: string
}) {
  return (
    <Card className={`min-w-0 bg-[var(--color-surface)] ${className}`}>
      <CardContent className="px-3 py-3">
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] text-[var(--color-text-tertiary)] [&_svg]:h-3.5 [&_svg]:w-3.5 [&_svg]:shrink-0">
          {icon}
          <span className="truncate">{label}</span>
        </div>
        <div className="mt-2 truncate text-lg font-semibold text-[var(--color-text-primary)]">
          {value}
        </div>
      </CardContent>
    </Card>
  )
}

function SkillListSkeleton() {
  return (
    <div className="grid gap-4" data-testid="skill-list-skeleton" aria-busy="true">
      <Card>
        <CardContent className="grid gap-4 p-5">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-4 w-full max-w-2xl" />
          <Skeleton className="h-11 w-full max-w-2xl" />
        </CardContent>
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        {[0, 1].map((group) => (
          <Card key={group}>
            <CardHeader>
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-3 w-48" />
            </CardHeader>
            <CardContent className="grid gap-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
