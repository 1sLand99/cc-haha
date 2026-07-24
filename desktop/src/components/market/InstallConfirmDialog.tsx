import { useRef } from 'react'
import { ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react'
import { useTranslation } from '../../i18n'
import type { NormalizedSkill } from '../../types/market'
import { Alert, AlertDescription } from '../ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog'
import { buttonVariants } from '../ui/button'
import { Card, CardContent } from '../ui/card'
import { Separator } from '../ui/separator'
import { cn } from '../../lib/utils'
import { SecurityBadge } from './SecurityBadge'

const RISK_KEYS = {
  verified: 'market.installConfirm.riskVerified',
  benign: 'market.installConfirm.riskBenign',
  unknown: 'market.installConfirm.riskUnknown',
  flagged: 'market.installConfirm.riskFlagged',
} as const

export function InstallConfirmDialog({
  skill,
  open,
  installing,
  onConfirm,
  onClose,
}: {
  skill: NormalizedSkill | null
  open: boolean
  installing: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  const t = useTranslation()
  const cancelRef = useRef<HTMLButtonElement>(null)
  if (!skill) return null

  const risky = skill.securityStatus === 'flagged' || skill.securityStatus === 'unknown'
  const RiskIcon = skill.securityStatus === 'flagged'
    ? ShieldAlert
    : risky
      ? ShieldQuestion
      : ShieldCheck

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !installing) onClose()
      }}
    >
      <AlertDialogContent
        className="w-[min(92vw,480px)]"
        data-testid="market-install-confirm"
        onEscapeKeyDown={(event) => {
          if (installing) event.preventDefault()
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          queueMicrotask(() => cancelRef.current?.focus())
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{t('market.installConfirm.title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('market.installConfirm.message', {
              name: skill.name,
              source: t(`market.source.${skill.source}`),
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <Card className="bg-[var(--color-surface-container-low)]">
          <CardContent className="p-0 text-xs">
            <dl>
              <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <dt className="text-[var(--color-text-tertiary)]">{t('market.filter.source')}</dt>
                <dd className="font-medium text-[var(--color-text-primary)]">{t(`market.source.${skill.source}`)}</dd>
              </div>
              {skill.version && (
                <>
                  <Separator />
                  <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                    <dt className="text-[var(--color-text-tertiary)]">{t('market.detail.version')}</dt>
                    <dd className="font-medium text-[var(--color-text-primary)]">v{skill.version}</dd>
                  </div>
                </>
              )}
              <Separator />
              <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <dt className="text-[var(--color-text-tertiary)]">{t('market.filter.security')}</dt>
                <dd><SecurityBadge status={skill.securityStatus} /></dd>
              </div>
              <Separator />
              <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <dt className="text-[var(--color-text-tertiary)]">{t('market.installConfirm.location')}</dt>
                <dd className="min-w-0 truncate font-mono text-[11px] text-[var(--color-text-secondary)]">
                  …/skills/{skill.slug.toLowerCase()}/
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Alert
          variant={skill.securityStatus === 'flagged' ? 'destructive' : 'default'}
          className={cn(
            'grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2',
            risky && skill.securityStatus !== 'flagged'
              ? 'border-[var(--color-warning)]/40 bg-[var(--color-warning-container)]/40'
              : !risky
                ? 'border-[var(--color-success)]/30 bg-[var(--color-success-container)]/40'
                : '',
          )}
        >
          <RiskIcon
            className={cn(
              'mt-0.5 size-4',
              skill.securityStatus === 'flagged'
                ? 'text-[var(--color-error)]'
                : risky
                  ? 'text-[var(--color-warning)]'
                  : 'text-[var(--color-success)]',
            )}
            aria-hidden="true"
          />
          <AlertDescription className="text-[var(--color-text-primary)]">
            {t(RISK_KEYS[skill.securityStatus])}
          </AlertDescription>
        </Alert>

        <p className="text-[11px] leading-5 text-[var(--color-text-tertiary)]">
          {t('market.installConfirm.effectNote')}
        </p>

        <AlertDialogFooter>
          <AlertDialogCancel ref={cancelRef} disabled={installing}>
            {t('market.installConfirm.cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            type="button"
            data-testid="market-install-confirm-button"
            aria-busy={installing || undefined}
            disabled={installing}
            onClick={(event) => {
              event.preventDefault()
              onConfirm()
            }}
            className={cn(
              buttonVariants({
                variant: skill.securityStatus === 'flagged' ? 'destructive' : 'default',
              }),
              'gap-2',
            )}
          >
            {installing && (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border border-current border-t-transparent" aria-hidden />
            )}
            {installing ? t('market.install.installing') : t('market.installConfirm.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
