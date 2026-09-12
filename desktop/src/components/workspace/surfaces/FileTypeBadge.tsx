import { getFileExtension } from '../WorkspaceCodeSurface'

const FILE_BADGE_META: Record<string, { label: string; className: string }> = {
  ts: { label: 'TS', className: 'bg-[var(--color-info-container)] text-[var(--color-on-info-container)]' },
  tsx: { label: 'TSX', className: 'bg-[var(--color-info-container)] text-[var(--color-on-info-container)]' },
  js: { label: 'JS', className: 'bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)]' },
  jsx: { label: 'JSX', className: 'bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)]' },
  json: { label: '{}', className: 'bg-[var(--color-surface-container-high)] text-[var(--color-text-secondary)]' },
  md: { label: 'MD', className: 'bg-[var(--color-surface-container-high)] text-[var(--color-text-secondary)]' },
  css: { label: 'CSS', className: 'bg-[var(--color-info-container)] text-[var(--color-on-info-container)]' },
  html: { label: 'H', className: 'bg-[var(--color-brand-soft)] text-[var(--color-on-brand-soft)]' },
  png: { label: 'IMG', className: 'bg-[var(--color-success-container)] text-[var(--color-on-success-container)]' },
  jpg: { label: 'IMG', className: 'bg-[var(--color-success-container)] text-[var(--color-on-success-container)]' },
  jpeg: { label: 'IMG', className: 'bg-[var(--color-success-container)] text-[var(--color-on-success-container)]' },
  gif: { label: 'IMG', className: 'bg-[var(--color-success-container)] text-[var(--color-on-success-container)]' },
  svg: { label: 'SVG', className: 'bg-[var(--color-success-container)] text-[var(--color-on-success-container)]' },
}

export function getFileBadgeMeta(name: string) {
  const extension = getFileExtension(name)
  return FILE_BADGE_META[extension] ?? {
    label: extension ? extension.slice(0, 3).toUpperCase() : 'TXT',
    className: 'bg-[var(--color-surface-container-high)] text-[var(--color-text-secondary)]',
  }
}

export function FileTypeBadge({ name, subtle = false }: { name: string; subtle?: boolean }) {
  const meta = getFileBadgeMeta(name)
  return (
    <span
      className={`inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-[var(--radius-sm)] px-1 font-[var(--font-label)] text-[9px] font-semibold leading-none ${meta.className} ${subtle ? 'opacity-55 grayscale' : ''}`}
      aria-hidden="true"
    >
      {meta.label}
    </span>
  )
}
