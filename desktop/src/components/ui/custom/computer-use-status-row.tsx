import { CircleCheck, CircleHelp, CircleX } from 'lucide-react'

import { Card } from '@/components/ui/card'

type ComputerUseStatusRowProps = {
  label: string
  ok: boolean | null
  detail: string
}

function StatusIcon({ ok }: { ok: boolean | null }) {
  if (ok === null) {
    return (
      <CircleHelp
        className="h-[18px] w-[18px] text-[var(--color-text-tertiary)]"
        aria-hidden="true"
      />
    )
  }
  return ok ? (
    <CircleCheck
      className="h-[18px] w-[18px] text-green-500"
      aria-hidden="true"
    />
  ) : (
    <CircleX
      className="h-[18px] w-[18px] text-red-400"
      aria-hidden="true"
    />
  )
}

function ComputerUseStatusRow({
  label,
  ok,
  detail,
}: ComputerUseStatusRowProps) {
  return (
    <Card
      data-slot="computer-use-status-row"
      className="flex items-center gap-3 px-4 py-2.5"
    >
      <StatusIcon ok={ok} />
      <div className="min-w-0 flex-1">
        <span className="text-sm font-medium text-[var(--color-text-primary)]">
          {label}
        </span>
        <span className="ml-2 text-xs text-[var(--color-text-tertiary)]">
          {detail}
        </span>
      </div>
    </Card>
  )
}

export { ComputerUseStatusRow, StatusIcon }
