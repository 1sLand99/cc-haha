import { ArrowUpRight, Download, Star } from 'lucide-react'
import { useTranslation } from '../../i18n'
import type { NormalizedSkill } from '../../types/market'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent, CardFooter } from '../ui/card'
import { LoadingButton } from '../ui/custom/loading-button'
import { InstallStateBadge } from './InstallStateBadge'
import { SecurityBadge } from './SecurityBadge'
import { SkillAvatar } from './SkillAvatar'

function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(value)
}

const MAX_VISIBLE_TAGS = 3

export function SkillCard({
  skill,
  onOpen,
  onInstall,
  installing,
}: {
  skill: NormalizedSkill
  onOpen: (id: string) => void
  onInstall?: (id: string) => void
  installing?: boolean
}) {
  const t = useTranslation()
  const extraTags = Math.max(0, skill.tags.length - MAX_VISIBLE_TAGS)
  const showInstallButton = Boolean(onInstall) && skill.installState === 'installable'

  return (
    <article data-testid={`market-skill-card-${skill.id}`}>
      <Card
        className="group relative isolate flex min-h-[212px] min-w-0 flex-col overflow-hidden border-[var(--color-border)]/70 transition-[background-color,border-color,box-shadow] duration-200 hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface)] hover:shadow-[var(--shadow-dropdown)] focus-within:border-[var(--color-border-focus)] focus-within:shadow-[var(--shadow-focus-ring)]"
        style={{ contentVisibility: 'auto', containIntrinsicSize: '212px' }}
      >
        <Button
          variant="ghost"
          aria-label={skill.name}
          data-market-skill-open-id={skill.id}
          onClick={() => onOpen(skill.id)}
          className="absolute inset-0 z-0 h-auto rounded-xl p-0 hover:bg-transparent focus-visible:border-transparent focus-visible:shadow-none"
        />

        <div className="pointer-events-none absolute inset-x-5 top-0 z-10 h-px bg-gradient-to-r from-transparent via-[var(--color-brand)]/55 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100" />

        <CardContent className="pointer-events-none relative z-10 flex flex-1 flex-col p-4 pb-0">
          <div className="flex items-start gap-3.5">
            <SkillAvatar skill={skill} size={46} />
            <div className="min-w-0 flex-1">
              <div className="flex items-start gap-2">
                <h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-5 tracking-[-0.01em] text-[var(--color-text-primary)]">
                  {skill.name}
                </h3>
                {skill.version && (
                  <Badge
                    variant="outline"
                    className="flex-shrink-0 border-transparent px-1.5 py-0 font-mono text-[10px] font-normal text-[var(--color-text-tertiary)]"
                  >
                    v{skill.version}
                  </Badge>
                )}
              </div>
              <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--color-text-tertiary)]">
                <span className="flex-shrink-0 font-semibold uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">
                  {t(`market.source.${skill.source}`)}
                </span>
                {skill.author.handle && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="truncate">{t('market.card.by', { author: skill.author.displayName || skill.author.handle })}</span>
                  </>
                )}
              </div>
            </div>
            <ArrowUpRight
              className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-text-tertiary)] opacity-0 transition-[opacity,transform] duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-100 group-focus-within:translate-x-0.5 group-focus-within:-translate-y-0.5 group-focus-within:opacity-100"
              strokeWidth={1.8}
              aria-hidden="true"
            />
          </div>

          <p className="mt-3 line-clamp-2 min-h-[2.75rem] break-words text-[12px] leading-[1.375rem] text-[var(--color-text-secondary)]">
            {skill.summary || t('market.detail.noDescription')}
          </p>

          {skill.tags.length > 0 && (
            <div className="mt-2.5 flex min-h-4 flex-wrap items-center gap-1">
              {skill.tags.slice(0, MAX_VISIBLE_TAGS).map((tag) => (
                <Badge
                  key={tag}
                  variant="outline"
                  className="min-h-4 border-transparent bg-transparent px-1 py-0 text-[10px] font-normal text-[var(--color-text-tertiary)]"
                >
                  #{tag}
                </Badge>
              ))}
              {extraTags > 0 && (
                <Badge
                  variant="outline"
                  className="min-h-4 border-transparent bg-transparent px-1 py-0 text-[10px] font-normal text-[var(--color-text-tertiary)]"
                >
                  {t('market.card.moreTags', { count: String(extraTags) })}
                </Badge>
              )}
            </div>
          )}
        </CardContent>

        <CardFooter className="pointer-events-none relative z-10 mx-4 mt-auto flex flex-wrap justify-between gap-x-2 gap-y-2 border-t border-[var(--color-border)]/60 px-0 py-3">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <SecurityBadge status={skill.securityStatus} />
            {/* The quick-install button already communicates "installable" — skip the badge when the button renders. */}
            {!(skill.installState === 'installable' && showInstallButton) && (
              <InstallStateBadge state={skill.installState} />
            )}
          </div>
          <div className="ml-auto flex flex-shrink-0 items-center gap-2.5 text-[11px] tabular-nums text-[var(--color-text-tertiary)]">
            <span
              className="inline-flex items-center gap-1"
              title={t('market.detail.downloads')}
              aria-label={`${t('market.detail.downloads')}: ${formatCount(skill.stats.downloads)}`}
            >
              <Download className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
              <span aria-hidden="true">{formatCount(skill.stats.downloads)}</span>
            </span>
            {typeof skill.stats.stars === 'number' && skill.stats.stars > 0 && (
              <span
                className="inline-flex items-center gap-1"
                title={t('market.detail.stars')}
                aria-label={`${t('market.detail.stars')}: ${formatCount(skill.stats.stars)}`}
              >
                <Star className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
                <span aria-hidden="true">{formatCount(skill.stats.stars)}</span>
              </span>
            )}
            {showInstallButton && (
              <LoadingButton
                variant="outline"
                size="sm"
                loading={installing}
                data-market-skill-action-id={skill.id}
                onClick={() => onInstall?.(skill.id)}
                className="pointer-events-auto relative z-20 border-[var(--color-brand)]/25 bg-[var(--color-surface)] text-[11px] font-semibold text-[var(--color-brand)] hover:border-[var(--color-brand)]/45 hover:bg-[var(--color-primary-fixed)]"
              >
                {!installing && <Download className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />}
                {installing ? t('market.install.installing') : t('market.install.action')}
              </LoadingButton>
            )}
          </div>
        </CardFooter>
      </Card>
    </article>
  )
}
