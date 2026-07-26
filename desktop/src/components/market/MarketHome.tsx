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
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[var(--color-surface-container-lowest)]">
      <header className="shrink-0 border-b border-[var(--color-border)]/70 bg-[var(--color-surface)]">
        <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center justify-between gap-5 px-6 py-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] text-[var(--color-brand)] shadow-[0_1px_2px_rgba(27,28,26,0.06)]">
              <Store className="h-5 w-5" strokeWidth={1.9} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h1 className="text-[22px] font-semibold leading-7 tracking-[-0.025em] text-[var(--color-text-primary)]">
                {t('market.title')}
              </h1>
              <p className="mt-0.5 max-w-2xl text-[13px] leading-5 text-[var(--color-text-secondary)]">
                {t('market.subtitle')}
              </p>
            </div>
          </div>
          <SourceStatusBar sources={sources} />
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4 px-6 py-5 lg:px-8">
        <MarketDisclaimer />

        <section className="sticky top-0 z-20 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-glass)] p-2.5 shadow-[0_8px_24px_rgba(27,28,26,0.06)] backdrop-blur-xl">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex min-h-10 min-w-[260px] flex-1 items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-3 transition-colors focus-within:border-[var(--color-border-focus)] focus-within:shadow-[var(--shadow-focus-ring)]">
              <Search className="h-4 w-4 flex-shrink-0 text-[var(--color-text-tertiary)]" strokeWidth={2} aria-hidden="true" />
              <input
                data-testid="market-search-input"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('market.searchPlaceholder')}
                aria-label={t('market.searchPlaceholder')}
                className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
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
        </section>

        {!isLoading && items.length > 0 && (
          <div className="flex items-center gap-3 px-0.5">
            <p className="flex-shrink-0 text-[11px] font-medium tabular-nums text-[var(--color-text-tertiary)]">
              {t('market.resultCount', { count: String(items.length) })}
            </p>
            <div className="h-px flex-1 bg-[var(--color-border)]/60" />
          </div>
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
            className="flex flex-col items-center gap-3 rounded-[var(--radius-lg)] border border-dashed border-[var(--color-error-soft-hover)] bg-[var(--color-error-soft)] px-6 py-14 text-center"
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
          <div data-testid="market-empty">
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
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="market-grid">
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
              <div className="flex justify-center py-2 pb-5">
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
    <div data-testid="market-loading">
      <SkeletonCards
        label={label}
        count={6}
        minHeight="212px"
        withAvatar
        className="grid-cols-1 md:grid-cols-2 xl:grid-cols-3"
      />
    </div>
  )
}
