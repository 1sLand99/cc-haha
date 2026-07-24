import {
  CircleAlert,
  CircleCheck,
  FolderOpen,
  FolderX,
  GitBranch,
  ImageOff,
  LoaderCircle,
  SearchX,
  type LucideIcon,
} from 'lucide-react'

import { cn } from '@/lib/utils'

type InlineStateIcon =
  | 'account_tree'
  | 'check_circle'
  | 'error'
  | 'folder_off'
  | 'folder_open'
  | 'image_not_supported'
  | 'progress_activity'
  | 'search_off'

const iconByName: Record<InlineStateIcon, LucideIcon> = {
  account_tree: GitBranch,
  check_circle: CircleCheck,
  error: CircleAlert,
  folder_off: FolderX,
  folder_open: FolderOpen,
  image_not_supported: ImageOff,
  progress_activity: LoaderCircle,
  search_off: SearchX,
}

function InlineState({
  icon,
  message,
  tone = 'muted',
  compact = false,
  announce = true,
}: {
  icon: InlineStateIcon
  message: string
  tone?: 'muted' | 'error'
  compact?: boolean
  announce?: boolean
}) {
  const Icon = iconByName[icon]

  return (
    <div
      data-slot="inline-state"
      className={cn(
        'flex items-center gap-2 px-4',
        compact ? 'py-2 text-[11px]' : 'py-8 text-xs',
        tone === 'error' ? 'text-[var(--color-error)]' : 'text-[var(--color-text-tertiary)]',
      )}
      role={announce ? tone === 'error' ? 'alert' : 'status' : undefined}
    >
      <Icon
        size={16}
        aria-hidden="true"
        className={cn(
          'shrink-0',
          icon === 'progress_activity' && 'motion-safe:animate-spin motion-reduce:animate-none',
        )}
      />
      <span className="min-w-0 leading-relaxed">{message}</span>
    </div>
  )
}

export { InlineState }
