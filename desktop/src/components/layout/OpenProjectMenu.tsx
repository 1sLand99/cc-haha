import { useEffect, useMemo } from 'react'
import { ChevronDown } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useOpenTargetStore } from '../../stores/openTargetStore'
import { TargetIcon } from '../common/TargetIcon'
import { Button } from '../ui/button'
import { IconButton } from '../ui/custom/icon-button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'

type Props = {
  path: string | null | undefined
}

export function OpenProjectMenu({ path }: Props) {
  const t = useTranslation()
  const targets = useOpenTargetStore((state) => state.targets)
  const primaryTargetId = useOpenTargetStore((state) => state.primaryTargetId)
  const ensureTargets = useOpenTargetStore((state) => state.ensureTargets)
  const openTarget = useOpenTargetStore((state) => state.openTarget)

  useEffect(() => {
    if (!path) return
    void ensureTargets()
  }, [ensureTargets, path])

  const primaryTarget = useMemo(
    () => targets.find((target) => target.id === primaryTargetId) ?? targets[0] ?? null,
    [primaryTargetId, targets],
  )
  const hasMenu = targets.length > 1

  const handleOpenTarget = async (targetId: string) => {
    if (!path) return
    try {
      await openTarget(targetId, path)
    } catch {
      // Store state already records the failure; keep the control responsive.
    }
  }

  if (!path || !primaryTarget) return null

  const buttonLabel = hasMenu
    ? t('openProject.openProject')
    : t('openProject.openIn', { target: primaryTarget.label })

  if (!hasMenu) {
    return (
      <IconButton
        label={buttonLabel}
        variant="outline"
        size="icon-sm"
        onClick={() => void handleOpenTarget(primaryTarget.id)}
      >
        <TargetIcon target={primaryTarget} />
      </IconButton>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={buttonLabel}
          className="min-w-11 gap-1 px-2 text-[var(--color-text-tertiary)]"
        >
          <TargetIcon target={primaryTarget} />
          <ChevronDown className="size-3.5" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[220px]">
        {targets.map((target) => (
          <DropdownMenuItem
            key={target.id}
            onSelect={() => void handleOpenTarget(target.id)}
            className="gap-3 py-2.5 font-medium"
          >
            <span className="flex size-7 items-center justify-center text-[var(--color-text-secondary)]">
              <TargetIcon target={target} size={24} />
            </span>
            <span className="min-w-0 truncate">{target.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
