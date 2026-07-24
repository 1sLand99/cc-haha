import type { KeyboardEvent } from 'react'
import { ChevronDown, ChevronRight, FileText, Folder } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { MemoryFile, MemoryProject } from '@/types/memory'
import { useTranslation } from '@/i18n'

type MemoryResourceTreeProps = {
  projects: MemoryProject[]
  selectedProjectId: string | null
  expandedProjectId: string | null
  loadingProjectId: string | null
  files: MemoryFile[]
  activePath: string | null
  collapsedFolders: Set<string>
  forceExpanded: boolean
  emptyText: string
  disabled?: boolean
  onProjectToggle: (projectId: string, trigger: HTMLButtonElement) => void
  onToggleFolder: (path: string) => void
  onFileSelect: (file: MemoryFile, trigger: HTMLButtonElement) => void
}

export function MemoryResourceTree({
  projects,
  selectedProjectId,
  expandedProjectId,
  loadingProjectId,
  files,
  activePath,
  collapsedFolders,
  forceExpanded,
  emptyText,
  disabled = false,
  onProjectToggle,
  onToggleFolder,
  onFileSelect,
}: MemoryResourceTreeProps) {
  const fileTree = buildMemoryFileTree(files)

  const handleTreeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target
    if (!(target instanceof HTMLButtonElement) || !target.dataset.memoryTreeItem) return
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        'button[data-memory-tree-item]:not(:disabled)',
      ),
    )
    const currentIndex = items.indexOf(target)
    if (currentIndex < 0) return

    let next: HTMLButtonElement | undefined
    if (event.key === 'ArrowDown') next = items[Math.min(currentIndex + 1, items.length - 1)]
    if (event.key === 'ArrowUp') next = items[Math.max(currentIndex - 1, 0)]
    if (event.key === 'Home') next = items[0]
    if (event.key === 'End') next = items.at(-1)
    if (next) {
      event.preventDefault()
      next.focus()
      return
    }

    if (
      event.key === 'ArrowRight' &&
      target.getAttribute('aria-expanded') === 'false'
    ) {
      event.preventDefault()
      target.click()
    }
    if (
      event.key === 'ArrowLeft' &&
      target.getAttribute('aria-expanded') === 'true'
    ) {
      event.preventDefault()
      target.click()
    }
  }

  return (
    <div role="tree" className="py-1" onKeyDown={handleTreeKeyDown}>
      {projects.map((project) => {
        const isExpanded = project.id === expandedProjectId
        const isSelected = project.id === selectedProjectId
        return (
          <ProjectTreeRow
            key={project.id}
            project={project}
            expanded={isExpanded}
            active={isSelected}
            loading={project.id === loadingProjectId}
            fileTree={isSelected ? fileTree : []}
            activePath={activePath}
            collapsedFolders={collapsedFolders}
            forceExpanded={forceExpanded}
            disabled={disabled}
            onToggle={(trigger) => onProjectToggle(project.id, trigger)}
            onToggleFolder={onToggleFolder}
            onFileSelect={onFileSelect}
            emptyText={emptyText}
          />
        )
      })}
    </div>
  )
}

function ProjectTreeRow({
  project,
  expanded,
  active,
  loading,
  fileTree,
  activePath,
  collapsedFolders,
  forceExpanded,
  disabled,
  onToggle,
  onToggleFolder,
  onFileSelect,
  emptyText,
}: {
  project: MemoryProject
  expanded: boolean
  active: boolean
  loading: boolean
  fileTree: MemoryTreeNode[]
  activePath: string | null
  collapsedFolders: Set<string>
  forceExpanded: boolean
  disabled: boolean
  onToggle: (trigger: HTMLButtonElement) => void
  onToggleFolder: (path: string) => void
  onFileSelect: (file: MemoryFile, trigger: HTMLButtonElement) => void
  emptyText: string
}) {
  const t = useTranslation()
  const display = projectDisplayName(project.label)
  return (
    <Collapsible open={expanded} className="mb-1" role="treeitem">
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          data-testid="memory-project-row"
          data-memory-tree-item="project"
          disabled={disabled}
          onClick={(event) => onToggle(event.currentTarget)}
          title={project.label}
          aria-label={t('settings.memory.toggleFolder', { name: display })}
          className={cn(
            'group min-h-9 w-full justify-start gap-2 px-2.5 py-1.5 text-left',
            active
              ? 'bg-[var(--color-memory-surface)] text-[var(--color-text-primary)] ring-1 ring-inset ring-[var(--color-memory-border)]'
              : 'text-[var(--color-text-secondary)]',
          )}
        >
          <Folder className="size-[15px] text-[var(--color-brand)]" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{display}</span>
          {!project.exists ? (
            <span className="shrink-0 text-xs text-[var(--color-text-tertiary)]">
              {t('settings.memory.missing')}
            </span>
          ) : null}
        </Button>
      </CollapsibleTrigger>

      <CollapsibleContent
        role="group"
        className="ml-[18px] mt-1.5 border-l border-[var(--color-border)] pl-2.5"
      >
        {loading ? (
          <div className="grid gap-2 px-2 py-1.5" aria-label={t('common.loading')}>
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-7 w-4/5" />
          </div>
        ) : fileTree.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-[var(--color-text-tertiary)]">
            {emptyText}
          </div>
        ) : (
          fileTree.map((node) => (
            <MemoryTreeRow
              key={node.id}
              node={node}
              depth={1}
              activePath={activePath}
              collapsedFolders={collapsedFolders}
              forceExpanded={forceExpanded}
              disabled={disabled}
              onToggleFolder={onToggleFolder}
              onFileSelect={onFileSelect}
            />
          ))
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

function MemoryTreeRow({
  node,
  depth,
  activePath,
  collapsedFolders,
  forceExpanded,
  disabled,
  onToggleFolder,
  onFileSelect,
}: {
  node: MemoryTreeNode
  depth: number
  activePath: string | null
  collapsedFolders: Set<string>
  forceExpanded: boolean
  disabled: boolean
  onToggleFolder: (path: string) => void
  onFileSelect: (file: MemoryFile, trigger: HTMLButtonElement) => void
}) {
  const t = useTranslation()
  if (node.kind === 'file') {
    return (
      <div role="treeitem" aria-selected={node.file.path === activePath}>
        <Button
          variant="ghost"
          data-memory-tree-item="file"
          disabled={disabled}
          onClick={(event) => onFileSelect(node.file, event.currentTarget)}
          style={{ paddingLeft: `${4 + Math.max(depth - 1, 0) * 16}px` }}
          className={cn(
            'mb-1 min-h-8 w-full justify-start gap-1.5 border py-1 pr-2 text-left',
            node.file.path === activePath
              ? 'border-[var(--color-memory-border)] bg-[var(--color-surface-selected)] text-[var(--color-text-primary)]'
              : 'border-transparent text-[var(--color-text-secondary)] hover:border-[var(--color-border)]',
          )}
        >
          <FileText className="size-3.5 text-[var(--color-text-tertiary)]" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-sm">{node.file.title}</span>
        </Button>
      </div>
    )
  }

  const isCollapsed = !forceExpanded && collapsedFolders.has(node.path)
  return (
    <Collapsible open={!isCollapsed} role="treeitem">
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          data-memory-tree-item="folder"
          disabled={disabled}
          onClick={() => onToggleFolder(node.path)}
          aria-label={t('settings.memory.toggleFolder', { name: node.name })}
          style={{ paddingLeft: `${4 + Math.max(depth - 1, 0) * 16}px` }}
          className="mb-1 min-h-8 w-full justify-start gap-1.5 border border-transparent py-1 pr-2 text-left text-sm text-[var(--color-text-secondary)] hover:border-[var(--color-border)]"
        >
          {isCollapsed ? <ChevronRight aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
          <Folder className="size-3.5 text-[var(--color-brand)]" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate font-medium">{node.name}</span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent
        role="group"
        className="ml-[18px] mt-1 border-l border-[var(--color-border)] pl-2.5"
      >
        {node.children.map((child) => (
          <MemoryTreeRow
            key={child.id}
            node={child}
            depth={depth + 1}
            activePath={activePath}
            collapsedFolders={collapsedFolders}
            forceExpanded={forceExpanded}
            disabled={disabled}
            onToggleFolder={onToggleFolder}
            onFileSelect={onFileSelect}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}

type MemoryTreeNode =
  | {
      kind: 'folder'
      id: string
      name: string
      path: string
      children: MemoryTreeNode[]
    }
  | {
      kind: 'file'
      id: string
      name: string
      path: string
      file: MemoryFile
    }

type MutableFolderNode = Extract<MemoryTreeNode, { kind: 'folder' }>

function buildMemoryFileTree(files: MemoryFile[]): MemoryTreeNode[] {
  const root: MutableFolderNode = {
    kind: 'folder',
    id: '__root__',
    name: '__root__',
    path: '',
    children: [],
  }

  const folders = new Map<string, MutableFolderNode>([['', root]])
  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean)
    let parent = root
    parts.slice(0, -1).forEach((part, index) => {
      const folderPath = parts.slice(0, index + 1).join('/')
      let folder = folders.get(folderPath)
      if (!folder) {
        folder = {
          kind: 'folder',
          id: `folder:${folderPath}`,
          name: part,
          path: folderPath,
          children: [],
        }
        folders.set(folderPath, folder)
        parent.children.push(folder)
      }
      parent = folder
    })
    parent.children.push({
      kind: 'file',
      id: `file:${file.path}`,
      name: parts.at(-1) ?? file.name,
      path: file.path,
      file,
    })
  }

  sortMemoryTree(root.children)
  return root.children
}

function sortMemoryTree(nodes: MemoryTreeNode[]): void {
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
    const aIndex = a.kind === 'file' ? a.file.isIndex : false
    const bIndex = b.kind === 'file' ? b.file.isIndex : false
    if (aIndex !== bIndex) return aIndex ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
  for (const node of nodes) {
    if (node.kind === 'folder') sortMemoryTree(node.children)
  }
}

function projectDisplayName(label: string): string {
  const normalized = label.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '')
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length >= 2) return `${parts.at(-2)}/${parts.at(-1)}`
  return parts[0] ?? label
}
