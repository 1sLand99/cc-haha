import { useCallback, useMemo } from 'react'
import { ArrowLeft, CircleAlert, Download, KeyRound, RefreshCw, Trash2 } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useMarketStore } from '../../stores/marketStore'
import { Alert, AlertDescription, AlertTitle } from '../ui/alert'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { LoadingButton } from '../ui/custom/loading-button'
import { Skeleton } from '../ui/skeleton'
import { SkillDetailView, type SkillDetailMetaItem } from './SkillDetailView'

function formatCount(value?: number): string {
  if (value === undefined) return '—'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(value)
}

function formatDate(ts?: number): string {
  if (!ts) return '—'
  try {
    return new Date(ts).toLocaleDateString()
  } catch {
    return '—'
  }
}

export function MarketSkillDetail({
  onRequestInstall,
  onRequestUninstall,
}: {
  onRequestInstall: (id: string) => void
  onRequestUninstall: (id: string) => void
}) {
  const t = useTranslation()
  const selectedId = useMarketStore((s) => s.selectedId)
  const detail = useMarketStore((s) => s.detail)
  const isDetailLoading = useMarketStore((s) => s.isDetailLoading)
  const detailError = useMarketStore((s) => s.detailError)
  const installingIds = useMarketStore((s) => s.installingIds)
  const installError = useMarketStore((s) => s.installError)
  const backToList = useMarketStore((s) => s.backToList)
  const refreshDetail = useMarketStore((s) => s.refreshDetail)
  const fetchFileContent = useMarketStore((s) => s.fetchFileContent)

  const loadFile = useCallback(
    (path: string) => {
      if (!selectedId) return Promise.reject(new Error('No skill selected'))
      return fetchFileContent(selectedId, path)
    },
    [selectedId, fetchFileContent],
  )

  const meta = useMemo<SkillDetailMetaItem[]>(() => {
    if (!detail) return []
    const items: SkillDetailMetaItem[] = [
      {
        label: t('market.detail.author'),
        value: detail.author.displayName || detail.author.handle || '—',
      },
      { label: t('market.detail.downloads'), value: formatCount(detail.stats.downloads) },
    ]
    if (detail.stats.installs !== undefined) {
      items.push({ label: t('market.detail.installs'), value: formatCount(detail.stats.installs) })
    }
    if (detail.stats.stars !== undefined) {
      items.push({ label: t('market.detail.stars'), value: formatCount(detail.stats.stars) })
    }
    items.push({ label: t('market.detail.updated'), value: formatDate(detail.updatedAt) })
    if (detail.category) items.push({ label: t('market.detail.category'), value: detail.category })
    if (detail.license) items.push({ label: t('market.detail.license'), value: detail.license })
    if (detail.requiresApiKey) {
      items.push({
        label: t('market.detail.requiresApiKey'),
        value: (
          <KeyRound
            className="ml-auto h-4 w-4 text-[var(--color-warning)]"
            strokeWidth={2}
            role="img"
            aria-label={t('market.detail.requiresApiKey')}
          />
        ),
      })
    }
    return items
  }, [detail, t])

  if (!selectedId) return null

  if (isDetailLoading) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[var(--color-surface-container-lowest)]" data-testid="market-detail-loading">
        <div
          className="mx-auto w-full max-w-[1320px] px-6 py-6 lg:px-8"
          role="status"
          aria-busy="true"
          aria-label={t('market.loading')}
        >
          <Button
            variant="ghost"
            size="sm"
            onClick={backToList}
            className="w-fit px-2"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            {t('market.detail.back')}
          </Button>
          <div className="mt-5" aria-hidden="true">
            <div className="flex items-start gap-5 border-b border-[var(--color-border)]/70 pb-6">
              <Skeleton className="h-16 w-16 flex-shrink-0 rounded-[14px]" />
              <div className="min-w-0 flex-1 pt-1">
                <Skeleton className="h-2.5 w-24" />
                <Skeleton className="mt-3 h-6 w-64 max-w-full" />
                <Skeleton className="mt-4 h-3 w-[min(100%,36rem)]" />
              </div>
            </div>
            <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
              <div>
                <Skeleton className="h-10 w-52" />
                <Card className="mt-5 h-72 border-[var(--color-border)]/60" />
              </div>
              <Card className="order-first h-72 border-[var(--color-border)]/60 lg:order-none" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (detailError || !detail) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-20">
        <Alert
          variant="destructive"
          className="max-w-lg justify-items-center px-6 py-8 text-center"
          data-testid="market-detail-error"
        >
          <CircleAlert className="h-9 w-9" strokeWidth={1.7} aria-hidden="true" />
          <AlertTitle className="text-[var(--color-text-primary)]">{t('market.detail.loadError')}</AlertTitle>
          {detailError && <AlertDescription className="max-w-md break-words">{detailError}</AlertDescription>}
        <div className="mt-1 flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => void refreshDetail(selectedId)}
          >
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            {t('market.retry')}
          </Button>
          <Button
            variant="ghost"
            onClick={backToList}
          >
            {t('market.detail.back')}
          </Button>
        </div>
        </Alert>
      </div>
    )
  }

  const installing = installingIds.has(detail.id)
  const mirrorSource = detail.mirrors?.length
    ? detail.mirrors[0]!.split(':')[0]
    : detail.upstream
      ? detail.upstream.source
      : null

  const actions = (
    <>
      {detail.installState === 'installable' && (
        <LoadingButton
          size="lg"
          data-testid="market-install-button"
          data-market-skill-action-id={detail.id}
          loading={installing}
          onClick={() => onRequestInstall(detail.id)}
        >
          {!installing && <Download className="h-4 w-4" strokeWidth={2} aria-hidden="true" />}
          {installing ? t('market.install.installing') : t('market.install.action')}
        </LoadingButton>
      )}
      {detail.installState === 'installed' && (
        <LoadingButton
          variant="outline"
          size="lg"
          data-testid="market-uninstall-button"
          data-market-skill-action-id={detail.id}
          loading={installing}
          onClick={() => onRequestUninstall(detail.id)}
          className="border-[var(--color-error)]/25 text-[var(--color-error)] hover:border-[var(--color-error)]/50 hover:bg-[var(--color-error-container)]/35"
        >
          {!installing && <Trash2 className="h-4 w-4" strokeWidth={2} aria-hidden="true" />}
          {installing ? t('market.uninstall.uninstalling') : t('market.uninstall.action')}
        </LoadingButton>
      )}
    </>
  )

  const banner = (
    <>
      {mirrorSource && (
        <Badge variant="secondary" className="mt-3 text-[11px] font-normal">
          {t('market.detail.mirror', { source: t(`market.source.${mirrorSource as 'clawhub' | 'skillhub'}`) })}
        </Badge>
      )}
      {installError && installError.id === detail.id && (
        <Alert
          variant="destructive"
          data-testid="market-install-error"
          className="mt-4 grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2"
        >
          <CircleAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-error)]" strokeWidth={2} aria-hidden="true" />
          <AlertDescription className="break-words text-[var(--color-text-primary)]">
            {installError.kind === 'generic'
              ? t('market.installError.generic', { message: installError.message })
              : t(`market.installError.${installError.kind}`)}
          </AlertDescription>
        </Alert>
      )}
    </>
  )

  return (
    <SkillDetailView
      name={detail.name}
      version={detail.version}
      iconUrl={detail.iconUrl}
      sourceLabel={t(`market.source.${detail.source}`)}
      summary={detail.summary}
      securityStatus={detail.securityStatus}
      securityReports={detail.securityReports}
      installState={detail.installState}
      notInstallableReason={detail.notInstallableReason}
      actions={actions}
      banner={banner}
      meta={meta}
      description={detail.description}
      files={detail.files.map((f) => ({ path: f.path, size: f.size, language: f.language, tooBig: f.tooBig }))}
      loadFile={loadFile}
      blockExternalResources
      onBack={backToList}
      backLabel={t('market.detail.back')}
    />
  )
}
