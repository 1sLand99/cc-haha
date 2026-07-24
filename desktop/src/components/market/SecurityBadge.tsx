import { BadgeCheck, ShieldAlert, ShieldCheck, ShieldQuestion, type LucideIcon } from 'lucide-react'
import { useTranslation } from '../../i18n'
import type { SecurityStatus } from '../../types/market'
import { Badge } from '../ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'

const STYLES: Record<SecurityStatus, { icon: LucideIcon; className: string }> = {
  verified: {
    icon: BadgeCheck,
    className: 'border-[var(--color-success)]/20 bg-[var(--color-success-container)] text-[var(--color-success)]',
  },
  benign: {
    icon: ShieldCheck,
    className: 'border-[var(--color-success)]/20 bg-[var(--color-success-container)] text-[var(--color-success)]',
  },
  unknown: {
    icon: ShieldQuestion,
    // text-secondary: tertiary lands at ~3.3-3.9:1 on this container across themes — below AA for 10px text.
    className: 'border-[var(--color-border)] bg-[var(--color-surface-container-low)] text-[var(--color-text-secondary)]',
  },
  flagged: {
    icon: ShieldAlert,
    className: 'border-[var(--color-error)]/20 bg-[var(--color-error-container)] text-[var(--color-error)]',
  },
}

export function SecurityBadge({ status, className = '' }: { status: SecurityStatus; className?: string }) {
  const t = useTranslation()
  const style = STYLES[status]
  const Icon = style.icon
  const label = t(`market.security.${status}`)
  const hint = t(`market.securityHint.${status}`)
  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            tabIndex={0}
            data-testid={`security-badge-${status}`}
            aria-label={`${label}. ${hint}`}
            className={`gap-1.5 whitespace-nowrap py-1 text-[11px] ${style.className} ${className}`}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            {label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>{hint}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
