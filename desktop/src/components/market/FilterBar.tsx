import { useTranslation } from '../../i18n'
import { useMarketStore } from '../../stores/marketStore'
import type {
  MarketInstalledFilter,
  MarketSecurityFilter,
  MarketSourceFilter,
} from '../../types/market'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select'

function MarketFilterMenu<V extends string>({
  label,
  value,
  items,
  active,
  onValueChange,
}: {
  label: string
  value: V
  items: Array<{ value: V; label: string }>
  active: boolean
  onValueChange: (value: V) => void
}) {
  return (
    <Select value={value} onValueChange={(nextValue) => onValueChange(nextValue as V)}>
      <SelectTrigger
        aria-label={label}
        className={`w-auto min-w-[148px] gap-1.5 text-xs ${
          active
            ? 'border-[var(--color-brand)]/35 bg-[var(--color-primary-fixed)] text-[var(--color-brand)]'
            : 'bg-[var(--color-surface-container-lowest)] text-[var(--color-text-secondary)]'
        }`}
      >
        <span className={active ? 'text-[var(--color-brand)]/75' : 'text-[var(--color-text-tertiary)]'}>
          {label}
        </span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="min-w-[220px]">
        {items.map((item) => (
          <SelectItem key={String(item.value)} value={String(item.value)}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function FilterBar({ className = '' }: { className?: string }) {
  const t = useTranslation()
  const filters = useMarketStore((s) => s.filters)
  const setFilter = useMarketStore((s) => s.setFilter)

  const sourceItems: Array<{ value: MarketSourceFilter; label: string }> = [
    { value: 'all', label: t('market.source.all') },
    { value: 'clawhub', label: t('market.source.clawhub') },
    { value: 'skillhub', label: t('market.source.skillhub') },
  ]
  const securityItems: Array<{ value: MarketSecurityFilter; label: string }> = [
    { value: 'all', label: t('market.security.all') },
    { value: 'verified', label: t('market.security.verified') },
    { value: 'benign', label: t('market.security.benign') },
    { value: 'unknown', label: t('market.security.unknown') },
    { value: 'flagged', label: t('market.security.flagged') },
  ]
  const installedItems: Array<{ value: MarketInstalledFilter; label: string }> = [
    { value: 'all', label: t('market.installedFilter.all') },
    { value: 'installed', label: t('market.installedFilter.installed') },
    { value: 'installable', label: t('market.installedFilter.installable') },
  ]

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`} data-testid="market-filter-bar">
      <MarketFilterMenu
        label={t('market.filter.source')}
        items={sourceItems}
        value={filters.source}
        active={filters.source !== 'all'}
        onValueChange={(value) => setFilter('source', value)}
      />
      <MarketFilterMenu
        label={t('market.filter.security')}
        items={securityItems}
        value={filters.security}
        active={filters.security !== 'all'}
        onValueChange={(value) => setFilter('security', value)}
      />
      <MarketFilterMenu
        label={t('market.filter.installed')}
        items={installedItems}
        value={filters.installed}
        active={filters.installed !== 'all'}
        onValueChange={(value) => setFilter('installed', value)}
      />
    </div>
  )
}
