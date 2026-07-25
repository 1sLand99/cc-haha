import { useEffect, useRef } from 'react'
import { CloudOff, PackageSearch, RefreshCw, Search, Store, X } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useMarketStore } from '../../stores/marketStore'
import { Alert, AlertDescription, AlertTitle } from '../ui/alert'
import { Button } from '../ui/button'
import { Card, CardContent } from '../ui/card'
import { EmptyState } from '../ui/custom/empty-state'
import { LoadingButton } from '../ui/custom/loading-button'
import { Input } from '../ui/input'
import { Separator } from '../ui/separator'
import { Skeleton } from '../ui/skeleton'
import { FilterBar } from './FilterBar'
import { MarketDisclaimer } from './MarketDisclaimer'
import { SkillCard } from './SkillCard'
import { SourceStatusBar } from './SourceStatusBar'
import { InstalledSkillsOverview } from './InstalledSkillsOverview'

export function MarketHome({
  onRequestInstall,
  onOpenSkill = (id) => void useMarketStore.getState().openDetail(id),
}: {
  onRequestInstall: (id: string) => void
  onOpenSkill?: (id: string) => void
}) {
  const t = useTranslation()
  const searchRef = useRef<HTMLInputElement>(null)
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
        <InstalledSkillsOverview />

        <MarketDisclaimer />

        <Card className="sticky top-0 z-20 bg-[var(--color-surface-glass)] shadow-[0_8px_24px_rgba(27,28,26,0.06)] backdrop-blur-xl">
          <CardContent className="flex flex-wrap items-center gap-2.5 p-2.5">
            <div className="relative min-w-full flex-1 sm:min-w-[260px]">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-[var(--color-text-tertiary)]"
                strokeWidth={2}
                aria-hidden="true"
              />
              <Input
                ref={searchRef}
                type="search"
                data-testid="market-search-input"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('market.searchPlaceholder')}
                aria-label={t('market.searchPlaceholder')}
                className="bg-[var(--color-surface-container-lowest)] pl-9 pr-10 text-[13px] [&::-webkit-search-cancel-button]:appearance-none"
              />
              {query && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('market.clearSearch')}
                  onClick={() => {
                    setQuery('')
                    queueMicrotask(() => searchRef.current?.focus())
                  }}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                </Button>
              )}
            </div>
            <FilterBar />
          </CardContent>
        </Card>

        {!isLoading && items.length > 0 && (
          <div className="flex items-center gap-3 px-0.5" aria-live="polite">
            <p className="flex-shrink-0 text-[11px] font-medium tabular-nums text-[var(--color-text-tertiary)]">
              {t('market.resultCount', { count: String(items.length) })}
            </p>
            <Separator className="flex-1" />
          </div>
        )}

        {isLoading && <MarketGridSkeleton label={t('market.loading')} />}

        {!isLoading && error && (
          <Alert
            variant="destructive"
            data-testid="market-error"
            className="justify-items-center border-dashed px-6 py-12 text-center"
          >
            <CloudOff className="h-8 w-8" strokeWidth={1.7} aria-hidden="true" />
            <AlertTitle className="text-[var(--color-text-primary)]">{t('market.error.list')}</AlertTitle>
            <AlertDescription className="max-w-md break-words">{error}</AlertDescription>
            <Button
              variant="secondary"
              onClick={() => void fetchList({ reset: true })}
              className="mt-2"
            >
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
              {t('market.retry')}
            </Button>
          </Alert>
        )}

        {!isLoading && !error && items.length === 0 && (
          <EmptyState
            testId="market-empty"
            icon={
              hasQuery || hasActiveFilters
                ? <PackageSearch className="h-9 w-9" strokeWidth={1.6} />
                : <Store className="h-9 w-9" strokeWidth={1.6} />
            }
            title={hasQuery || hasActiveFilters ? t('market.emptySearch') : t('market.empty')}
            description={hasQuery || hasActiveFilters ? t('market.emptySearchHint') : t('market.emptyHint')}
          />
        )}

        {!isLoading && items.length > 0 && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="market-grid">
            {items.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                onOpen={onOpenSkill}
                onInstall={onRequestInstall}
                installing={installingIds.has(skill.id)}
              />
            ))}
          </div>
        )}

        {!isLoading && !error && nextCursor && (
          <div className="flex justify-center py-2 pb-5">
            <LoadingButton
              variant="secondary"
              size="lg"
              data-testid="market-load-more"
              loading={isLoadingMore}
              onClick={() => void loadMore()}
            >
              {isLoadingMore ? t('market.loadingMore') : t('market.loadMore')}
            </LoadingButton>
          </div>
        )}
      </div>
    </div>
  )
}

function MarketGridSkeleton({ label }: { label: string }) {
  return (
    <div
      className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3"
      data-testid="market-loading"
      aria-label={label}
      aria-busy="true"
      role="status"
    >
      {Array.from({ length: 6 }, (_, index) => (
        <Card
          key={index}
          aria-hidden="true"
          className="min-h-[212px] border-[var(--color-border)]/60"
        >
          <CardContent className="p-4">
            <div className="flex items-start gap-3.5">
              <Skeleton className="h-[46px] w-[46px] rounded-[14px]" />
              <div className="min-w-0 flex-1 pt-0.5">
                <Skeleton className="h-3.5 w-2/3" />
                <Skeleton className="mt-2 h-2.5 w-1/3" />
              </div>
            </div>
            <Skeleton className="mt-4 h-2.5 w-full" />
            <Skeleton className="mt-2 h-2.5 w-4/5" />
            <Skeleton className="mt-4 h-2.5 w-1/2" />
            <Separator className="mt-5" />
            <div className="mt-3 flex items-center justify-between">
              <Skeleton className="h-6 w-20" />
              <Skeleton className="h-6 w-24" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
