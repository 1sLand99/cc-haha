import { Maximize2, Minimize2, PanelBottom, PanelRight } from 'lucide-react'
import { IconButton } from '@/components/ui/IconButton'
import { useTranslation } from '../../i18n'
import type { WorkspaceLayout } from '../../lib/workspace/types'

export type WorkspaceLayoutControlsProps = {
  layout: WorkspaceLayout
  bottomOpen: boolean
  onToggleFullscreen: () => void
  onToggleBottom: () => void
  onToggleWorkspace: () => void
}

/**
 * The three fixed layout entry points, in the reference's order: maximize,
 * bottom terminal, right workspace.
 *
 * Each button's pressed state reflects *only* whether its own panel is showing.
 * The old toolbar tied the workspace button to the panel being in file mode, so
 * with the browser open it still offered "show workspace" — pressing it then
 * silently switched content instead of hiding anything.
 */
export function WorkspaceLayoutControls({
  layout,
  bottomOpen,
  onToggleFullscreen,
  onToggleBottom,
  onToggleWorkspace,
}: WorkspaceLayoutControlsProps) {
  const t = useTranslation()
  const isFull = layout === 'full'
  const isVisible = layout !== 'hidden'

  return (
    <>
      <IconButton
        icon={isFull
          ? <Minimize2 size={15} strokeWidth={1.9} />
          : <Maximize2 size={15} strokeWidth={1.9} />}
        label={t(isFull ? 'workspace.controls.restore' : 'workspace.controls.expand')}
        size="sm"
        tone="muted"
        pressed={isFull}
        data-testid="workspace-toggle-fullscreen"
        onClick={onToggleFullscreen}
      />
      <IconButton
        icon={<PanelBottom size={15} strokeWidth={1.9} />}
        label={t('workspace.controls.bottomPanel')}
        size="sm"
        tone="muted"
        pressed={bottomOpen}
        data-testid="workspace-toggle-bottom"
        onClick={onToggleBottom}
      />
      <IconButton
        icon={<PanelRight size={15} strokeWidth={1.9} />}
        label={t('workspace.controls.sidePanel')}
        size="sm"
        tone="muted"
        pressed={isVisible}
        data-testid="workspace-toggle-side"
        onClick={onToggleWorkspace}
      />
    </>
  )
}
