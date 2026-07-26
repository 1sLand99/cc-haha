import { useEffect } from 'react'
import { CloudOff, PackageSearch, RefreshCw, Search, Store, X } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { IconButton } from '@/components/ui/IconButton'
import { SkeletonCards } from '@/components/ui/Skeleton'
import { useMarketStore } from '../../stores/marketStore'
import { FilterBar } from './FilterBar'
import { MarketDisclaimer } from './MarketDisclaimer'
import { SkillCard } from './SkillCard'
import { SourceStatusBar } from './SourceStatusBar'

/**
 * `minmax(340px, 1fr)` verbatim would overflow a phone viewport — the same
 * bundle serves the touch H5 shell — so the floor is clamped to the column
 * width. On desktop it is the handoff's grid exactly.
 */
const CATALOG_GRID = 'repeat(auto-fill,minmax(min(100%,340px),1fr))'

export function MarketHome({ onRequestInstall }: { onRequestInstall: (id: string) => void }) {
  const t = useTranslation()
  const {
    items,
    nextCursor,
    sources,
    query,
    filters,
    isLoading,
    isLoadingMore,
    error,
    fetchList,
    loadMore,
    setQuery,
    installingIds,
  } = useMarketStore()

  useEffect(() => {
    if (items.length === 0 && !isLoading && !error) {
      void fetchList({ reset: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const hasActiveFilters =
    filters.source !== 'all' || filters.security !== 'all' || filters.installed !== 'all'
  const hasQuery = query.trim().length > 0

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[var(--color-surface)]">
      <div className="mx-auto flex w-full max-w-[1280px] flex-col px-6 pb-10 pt-7 lg:px-10">
        <header className="flex flex-wrap items-start gap-x-[18px] gap-y-4">
          <span className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-brand)] shadow-[var(--shadow-card)]">
            <Store className="h-[26px] w-[26px]" strokeWidth={1.4} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h1
              style={{ fontFamily: 'var(--font-headline)' }}
              className="text-[26px] font-bold leading-9 tracking-[-0.012em] text-[var(--color-text-primary)]"
            >
              {t('market.title')}
            </h1>
            <p className="mt-1 max-w-2xl text-[15px] leading-6 text-[var(--color-text-secondary)]">
              {t('market.subtitle')}
            </p>
          </div>
          <SourceStatusBar sources={sources} className="pt-2" />
        </header>

        <MarketDisclaimer />

        <div className="mt-[22px] flex flex-wrap items-center gap-3">
          {/* Kept hand-rolled rather than moved onto `SearchField`: the command
              bar is a 44px field on the `--radius-lg` step, and the shared
              component tops out at h-10 / `--radius-md`. Overriding both from a
              className is the class fight components/AGENTS.md §3.6 warns about. */}
          <div className="flex min-h-11 min-w-[240px] flex-1 items-center gap-2.5 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 transition-colors focus-within:border-[var(--color-border-focus)] focus-within:shadow-[var(--shadow-focus-ring)]">
            <Search className="h-[15px] w-[15px] flex-shrink-0 text-[var(--color-text-tertiary)]" strokeWidth={1.6} aria-hidden="true" />
            <input
              data-testid="market-search-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('market.searchPlaceholder')}
              aria-label={t('market.searchPlaceholder')}
              className="min-w-0 flex-1 bg-transparent text-[14.5px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
            />
            {query && (
              <IconButton
                icon={<X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />}
                label={t('market.clearSearch')}
                size="sm"
                tone="muted"
                onClick={() => setQuery('')}
              />
            )}
          </div>
          <FilterBar />
        </div>

        {!isLoading && items.length > 0 && (
          <p className="mb-4 mt-5 text-sm tabular-nums text-[var(--color-text-secondary)]">
            {t('market.resultCount', { count: String(items.length) })}
          </p>
        )}

        {isLoading && <MarketGridSkeleton label={t('market.loading')} />}

        {/* Kept as a bespoke region-level state rather than `ErrorState`: that
            component is the compact left-aligned inline notice, and the three
            market failure regions are full-height centered states with an icon.
            `EmptyState` has no danger tone. What did change: the `/35` and `/25`
            alpha modifiers are gone — Safari 15 WebView drops that color
            function outright, which rendered this banner as bare text on the
            desktop shell — and the failure now announces itself. */}
        {!isLoading && error && (
          <div
            role="alert"
            data-testid="market-error"
            className="mt-5 flex flex-col items-center gap-3 rounded-[var(--radius-xl)] border border-dashed border-[var(--color-error-soft-hover)] bg-[var(--color-error-soft)] px-6 py-14 text-center"
          >
            <CloudOff className="h-8 w-8 text-[var(--color-error)]" strokeWidth={1.7} aria-hidden="true" />
            <p className="text-sm font-medium text-[var(--color-text-primary)]">{t('market.error.list')}</p>
            <p className="max-w-md break-words text-xs text-[var(--color-text-tertiary)]">{error}</p>
            <Button
              variant="secondary"
              className="mt-1"
              icon={<RefreshCw className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />}
              onClick={() => void fetchList({ reset: true })}
            >
              {t('market.retry')}
            </Button>
          </div>
        )}

        {!isLoading && !error && items.length === 0 && (
          <div data-testid="market-empty" className="mt-5">
            <EmptyState
              size="lg"
              icon={
                hasQuery || hasActiveFilters
                  ? <PackageSearch size={24} strokeWidth={1.6} />
                  : <Store size={24} strokeWidth={1.6} />
              }
              title={hasQuery || hasActiveFilters ? t('market.emptySearch') : t('market.empty')}
              description={hasQuery || hasActiveFilters ? t('market.emptySearchHint') : t('market.emptyHint')}
              action={
                hasQuery
                  ? { label: t('market.clearSearch'), onClick: () => setQuery('') }
                  : { label: t('market.retry'), onClick: () => void fetchList({ reset: true }) }
              }
            />
          </div>
        )}

        {!isLoading && items.length > 0 && (
          <>
            <div
              className="grid gap-[18px]"
              style={{ gridTemplateColumns: CATALOG_GRID }}
              data-testid="market-grid"
            >
              {items.map((skill) => (
                <SkillCard
                  key={skill.id}
                  skill={skill}
                  onOpen={(id) => void useMarketStore.getState().openDetail(id)}
                  onInstall={onRequestInstall}
                  installing={installingIds.has(skill.id)}
                />
              ))}
            </div>

            {nextCursor && (
              <div className="flex justify-center pt-7">
                <Button
                  variant="secondary"
                  size="lg"
                  data-testid="market-load-more"
                  loading={isLoadingMore}
                  onClick={() => void loadMore()}
                >
                  {isLoadingMore ? t('market.loadingMore') : t('market.loadMore')}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function MarketGridSkeleton({ label }: { label: string }) {
  return (
    <div data-testid="market-loading" className="mt-5">
      <SkeletonCards
        label={label}
        count={6}
        minHeight="232px"
        withAvatar
        className="[grid-template-columns:repeat(auto-fill,minmax(min(100%,340px),1fr))]"
      />
    </div>
  )
}
