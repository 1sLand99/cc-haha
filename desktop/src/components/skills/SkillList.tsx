import { useEffect, useMemo, useState } from 'react'
import { useSkillStore } from '../../stores/skillStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTranslation } from '../../i18n'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { IconButton } from '@/components/ui/IconButton'
import { LoadingState } from '@/components/ui/LoadingState'
import type { SkillMeta, SkillSource } from '../../types/skill'

const SOURCE_ORDER: SkillSource[] = ['user', 'project', 'plugin', 'mcp', 'bundled']

const SOURCE_ICONS: Record<SkillSource, string> = {
  user: 'person',
  project: 'folder',
  plugin: 'extension',
  mcp: 'hub',
  bundled: 'inventory_2',
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

export function SkillList() {
  const { skills, isLoading, error, fetchSkills, fetchSkillDetail } =
    useSkillStore()
  const sessions = useSessionStore((s) => s.sessions)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const t = useTranslation()
  const activeSession = sessions.find((session) => session.id === activeSessionId)
  const currentWorkDir = activeSession?.workDir || undefined
  const [searchQuery, setSearchQuery] = useState('')
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase()

  useEffect(() => {
    fetchSkills(currentWorkDir)
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
      const src = skill.source as SkillSource
      ;(result[src] ??= []).push(skill)
    }
    return result
  }, [filteredSkills])

  const totalTokens = useMemo(
    () => filteredSkills.reduce((sum, skill) => sum + estimateTokens(skill.contentLength), 0),
    [filteredSkills],
  )

  const visibleGroupCount = useMemo(
    () => SOURCE_ORDER.filter((source) => (grouped[source] ?? []).length > 0).length,
    [grouped],
  )

  if (isLoading) {
    return <LoadingState label={t('common.loading')} labelHidden />
  }

  if (error) {
    // Was a bare red line of text with no role, so a screen reader only found
    // the failure by walking into it.
    return <ErrorState title={error} />
  }

  if (skills.length === 0) {
    return (
      <EmptyState
        icon={<span className="material-symbols-outlined text-[20px]">auto_awesome</span>}
        title={t('settings.skills.empty')}
        description={t('settings.skills.emptyHint')}
      />
    )
  }

  return (
    <div className="flex flex-col gap-6 min-w-0">
      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] overflow-hidden">
        <div className="grid gap-4 px-5 py-5 min-w-0 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)] xl:items-end">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--color-text-tertiary)] mb-2">
              {t('settings.skills.browserEyebrow')}
            </div>
            <div className="flex items-center gap-3 mb-2">
              <span className="material-symbols-outlined text-[22px] text-[var(--color-brand)]">
                auto_awesome
              </span>
              <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">
                {t('settings.skills.browserTitle')}
              </h3>
            </div>
            <p className="text-sm leading-6 text-[var(--color-text-secondary)] max-w-3xl">
              {t('settings.skills.browserDescription')}
            </p>
            <div className="mt-4 max-w-2xl">
              <label className="sr-only" htmlFor="settings-skill-search">
                {t('settings.skills.searchLabel')}
              </label>
              <div className="flex min-h-11 items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 transition-colors focus-within:border-[var(--color-border-focus)] focus-within:ring-2 focus-within:ring-[var(--color-brand)]/20">
                <span className="material-symbols-outlined text-[18px] text-[var(--color-text-tertiary)]">
                  search
                </span>
                <input
                  id="settings-skill-search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder={t('settings.skills.searchPlaceholder')}
                  className="min-w-0 flex-1 bg-transparent text-sm text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
                />
                {searchQuery && (
                  <IconButton
                    icon="close"
                    label={t('settings.skills.clearSearch')}
                    size="sm"
                    shape="circle"
                    tone="muted"
                    onClick={() => setSearchQuery('')}
                  />
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

          <div className="grid grid-cols-2 gap-3 min-w-0 sm:grid-cols-3">
            <SummaryCard
              label={t('settings.skills.summary.totalSkills')}
              value={String(filteredSkills.length)}
              icon="auto_awesome"
            />
            <SummaryCard
              label={t('settings.skills.summary.sources')}
              value={String(
                SOURCE_ORDER.filter((source) => (grouped[source] ?? []).length > 0)
                  .length,
              )}
              icon="layers"
            />
            <SummaryCard
              label={t('settings.skills.summary.tokens')}
              value={t('settings.skills.tokenEstimateShort', { count: String(totalTokens) })}
              icon="notes"
              className="col-span-2 sm:col-span-1"
            />
          </div>
        </div>
      </section>

      {filteredSkills.length === 0 && (
        <EmptyState
          icon={<span className="material-symbols-outlined text-[20px]">search_off</span>}
          title={t('settings.skills.noSearchResults')}
          description={t('settings.skills.noSearchResultsHint')}
          action={{ label: t('settings.skills.clearSearch'), onClick: () => setSearchQuery('') }}
        />
      )}

      <div className={`grid gap-4 ${visibleGroupCount >= 2 ? 'xl:grid-cols-2' : ''}`}>
        {SOURCE_ORDER.map((source) => {
          const group = grouped[source]
          if (!group?.length) return null

          const sourceLabel = t(`settings.skills.source.${source}`)
          const sourceTokenCount = group.reduce(
            (sum, skill) => sum + estimateTokens(skill.contentLength),
            0,
          )

          return (
            <section
              key={source}
              className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden min-w-0"
            >
              <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[var(--color-border)] bg-[var(--color-surface-container-low)]">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${SOURCE_ACCENT_CLASSES[source]}`}>
                      <span className="material-symbols-outlined text-[16px]">
                        {SOURCE_ICONS[source]}
                      </span>
                    </span>
                    <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">
                      {sourceLabel}
                    </h4>
                    <span className="text-xs text-[var(--color-text-tertiary)]">
                      {group.length}
                    </span>
                  </div>
                  <p className="text-xs leading-5 text-[var(--color-text-tertiary)]">
                    {t('settings.skills.groupHint', {
                      source: sourceLabel,
                      count: String(group.length),
                    })}
                  </p>
                </div>
                <div className="text-[11px] text-[var(--color-text-tertiary)] whitespace-nowrap">
                  {t('settings.skills.tokenEstimateShort', { count: String(sourceTokenCount) })}
                </div>
              </div>

              <div className="flex flex-col p-2">
                {group.map((skill) => (
                  <button
                    key={`${skill.source}-${skill.name}`}
                    onClick={() =>
                      skill.hasDirectory &&
                      fetchSkillDetail(skill.source, skill.name, currentWorkDir, 'skills')
                    }
                    disabled={!skill.hasDirectory}
                    className="group rounded-xl border border-transparent px-3 py-3 text-left transition-all hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)] disabled:opacity-60 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:border-transparent"
                  >
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 material-symbols-outlined text-[18px] text-[var(--color-text-tertiary)]">
                        auto_awesome
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-[var(--color-text-primary)] break-all">
                            {skill.displayName || skill.name}
                          </span>
                          {skill.version && <Badge mono>v{skill.version}</Badge>}
                          {skill.userInvocable && (
                            <Badge variant="outline">{t('settings.skills.slashCommand')}</Badge>
                          )}
                          {/* Only flagged for `.agents`: `.claude` is the norm and
                              badging it would be noise on every existing skill. */}
                          {skill.rootFlavor === 'agents' && (
                            // The badge covers both scopes, and they are not
                            // equally trusted: a project one ships with the
                            // repository rather than being installed by the
                            // user — hence two hint strings.
                            <Badge
                              mono
                              title={t(skill.source === 'project'
                                ? 'settings.skills.agentsDirProjectHint'
                                : 'settings.skills.agentsDirHint')}
                            >
                              {t('settings.skills.agentsDirBadge')}
                            </Badge>
                          )}
                        </div>
                        <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)] break-words">

                          {skill.description}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--color-text-tertiary)]">
                          <span>{sourceLabel}</span>
                          <span>{t('settings.skills.tokenEstimateShort', { count: String(estimateTokens(skill.contentLength)) })}</span>
                          <span>{skill.hasDirectory ? t('settings.skills.ready') : t('settings.skills.unavailable')}</span>
                        </div>
                      </div>
                      <span className="material-symbols-outlined text-[18px] text-[var(--color-text-tertiary)] opacity-60 transition-transform group-hover:translate-x-0.5 group-hover:opacity-100">
                        chevron_right
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </section>
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
  icon: string
  className?: string
}) {
  return (
    <Card radius="lg" padding="sm" className={`min-w-0 ${className}`}>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] text-[var(--color-text-tertiary)] min-w-0">
        <span className="material-symbols-outlined text-[14px] flex-shrink-0">{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-2 text-lg font-semibold text-[var(--color-text-primary)] truncate">
        {value}
      </div>
    </Card>
  )
}
