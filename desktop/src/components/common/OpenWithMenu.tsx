import { Globe, ExternalLink, FileText } from 'lucide-react'
import { TargetIcon } from './TargetIcon'
import type { OpenWithItem } from '../../lib/openWithItems'
import { DropdownMenuItem } from '../ui/dropdown-menu'
import { PointerDropdownMenu } from '../ui/custom/pointer-dropdown-menu'

type Props = {
  items: OpenWithItem[]
  anchor: { top: number; bottom: number; left: number; right: number }
  onClose: () => void
  // Optional trigger element to exclude from outside-close detection. When the
  // user clicks the same trigger that opened this menu, the trigger's own
  // click handler is responsible for toggling — don't double-close here.
  triggerEl?: HTMLElement | null
}

function ItemIcon({ item }: { item: OpenWithItem }) {
  if ((item.icon === 'ide' || item.icon === 'file-manager') && item.target) return <TargetIcon target={item.target} size={20} />
  if (item.icon === 'in-app-browser') return <Globe size={18} strokeWidth={1.9} />
  if (item.icon === 'preview') return <FileText size={18} strokeWidth={1.9} />
  return <ExternalLink size={18} strokeWidth={1.9} />
}

export function OpenWithMenu({ items, anchor, onClose, triggerEl }: Props) {
  return (
    <PointerDropdownMenu
      open
      anchor={anchor}
      triggerEl={triggerEl}
      dismissOnViewportChange
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      className="min-w-[220px] rounded-[12px] bg-[var(--color-surface)]"
    >
      {items.map((item) => (
        <DropdownMenuItem
          key={item.id}
          onSelect={item.onSelect}
          className="gap-3 px-3 py-2.5 text-sm font-medium"
        >
          <span className="flex h-6 w-6 items-center justify-center text-[var(--color-text-secondary)]"><ItemIcon item={item} /></span>
          <span className="min-w-0 truncate">{item.label}</span>
        </DropdownMenuItem>
      ))}
    </PointerDropdownMenu>
  )
}
