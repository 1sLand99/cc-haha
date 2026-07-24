import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import {
  File,
  FileCode2,
  FileJson2,
  FileText,
  FolderX,
  RefreshCw,
  Scissors,
  SquareTerminal,
  TriangleAlert,
} from 'lucide-react'
import { useTranslation } from '../../i18n'
import { Alert, AlertDescription, AlertTitle } from '../ui/alert'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader } from '../ui/card'
import { ScrollArea } from '../ui/scroll-area'
import { Skeleton } from '../ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group'
import { CodeViewer } from '../chat/CodeViewer'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'

export type PreviewFile = {
  path: string
  size: number
  language: string
  tooBig?: boolean
}

export type PreviewFileContent = {
  path: string
  content: string
  language: string
  size: number
  truncated: boolean
}

const LANG_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  markdown: FileText,
  python: FileCode2,
  javascript: FileCode2,
  typescript: FileCode2,
  bash: SquareTerminal,
  json: FileJson2,
  yaml: FileJson2,
  text: FileText,
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'loaded'; file: PreviewFileContent }

/**
 * Two-pane file preview shared by market and local skill details. Content is
 * loaded lazily and cached per file while the selected skill remains mounted.
 */
export function FilePreview({
  files,
  loadFile,
  initialPath,
  blockExternalResources = false,
}: {
  files: PreviewFile[]
  loadFile: (path: string) => Promise<PreviewFileContent>
  initialPath?: string
  blockExternalResources?: boolean
}) {
  const t = useTranslation()
  const defaultPath = useMemo(
    () => initialPath ?? files.find((file) => file.path === 'SKILL.md')?.path ?? files[0]?.path ?? null,
    [files, initialPath],
  )
  const [activePath, setActivePath] = useState<string | null>(defaultPath)
  const [state, setState] = useState<LoadState>({ kind: 'idle' })
  const cacheRef = useRef(new Map<string, PreviewFileContent>())
  const requestSeq = useRef(0)

  const open = useCallback(
    async (path: string) => {
      setActivePath(path)
      const cached = cacheRef.current.get(path)
      if (cached) {
        setState({ kind: 'loaded', file: cached })
        return
      }

      const seq = ++requestSeq.current
      setState({ kind: 'loading' })
      try {
        const file = await loadFile(path)
        cacheRef.current.set(path, file)
        if (requestSeq.current !== seq) return
        setState({ kind: 'loaded', file })
      } catch (error) {
        if (requestSeq.current !== seq) return
        setState({
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
        })
      }
    },
    [loadFile],
  )

  useEffect(() => {
    cacheRef.current.clear()
    requestSeq.current += 1
    setActivePath(defaultPath)
    setState({ kind: 'idle' })
    if (defaultPath) void open(defaultPath)
    return () => {
      requestSeq.current += 1
    }
  }, [defaultPath, open])

  if (files.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="px-6 py-12 text-center">
          <FolderX className="mx-auto mb-2 h-8 w-8 text-[var(--color-text-tertiary)]" aria-hidden="true" />
          <p className="text-sm text-[var(--color-text-tertiary)]">{t('market.file.noFiles')}</p>
        </CardContent>
      </Card>
    )
  }

  const activeFile = files.find((file) => file.path === activePath)

  return (
    <div
      className="grid min-w-0 gap-4 lg:grid-cols-[240px_minmax(0,1fr)]"
      data-testid="market-file-preview"
    >
      <Card className="min-w-0 overflow-hidden">
        <ScrollArea className="h-[520px] max-h-[55vh]">
          <CardContent className="p-1.5">
            <ToggleGroup
              type="single"
              orientation="vertical"
              value={activePath ?? ''}
              onValueChange={(path) => {
                if (path) void open(path)
              }}
              aria-label={t('market.detail.files')}
              className="flex-col items-stretch gap-0.5"
            >
            {files.map((file) => {
              const active = file.path === activePath
              const FileIcon = LANG_ICONS[file.language] ?? File
              return (
                <ToggleGroupItem
                  key={file.path}
                  variant="ghost"
                  value={file.path}
                  data-testid={`market-file-item-${file.path}`}
                  className={`h-auto min-h-12 w-full justify-start whitespace-normal px-2.5 py-2 text-left ${
                    active
                      ? 'bg-[var(--color-primary-fixed)] text-[var(--color-brand)]'
                      : ''
                  }`}
                >
                  <FileIcon className="h-4 w-4" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">{file.path}</span>
                    <span className={`block text-[10px] font-normal ${active ? 'opacity-80' : 'text-[var(--color-text-tertiary)]'}`}>
                      {file.language} · {formatSize(file.size)}
                    </span>
                  </span>
                </ToggleGroupItem>
              )
            })}
            </ToggleGroup>
          </CardContent>
        </ScrollArea>
      </Card>

      <Card className="min-w-0 overflow-hidden">
        {activeFile && (
          <CardHeader className="flex-row flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-4 py-2.5 text-[11px] text-[var(--color-text-tertiary)]">
            <span className="font-mono font-medium text-[var(--color-text-secondary)]">{activeFile.path}</span>
            <span>{activeFile.language}</span>
            <span>{formatSize(activeFile.size)}</span>
            {state.kind === 'loaded' && state.file.truncated && (
              <span className="inline-flex items-center gap-1 text-[var(--color-warning)]">
                <Scissors className="h-3.5 w-3.5" aria-hidden="true" />
                {t('market.file.truncated')}
              </span>
            )}
          </CardHeader>
        )}

        <ScrollArea className="h-[480px] max-h-[52vh]">
          <CardContent className="p-4">
            {state.kind === 'loading' && (
              <div className="grid gap-3 py-4" data-testid="market-file-loading" aria-busy="true">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
              </div>
            )}
            {state.kind === 'error' && (
              <Alert variant="destructive" data-testid="market-file-error">
                <TriangleAlert aria-hidden="true" />
                <AlertTitle>{t('market.file.loadError')}</AlertTitle>
                <AlertDescription className="break-words">{state.message}</AlertDescription>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2 w-fit"
                  onClick={() => {
                    if (activePath) void open(activePath)
                  }}
                >
                  <RefreshCw aria-hidden="true" />
                  {t('market.retry')}
                </Button>
              </Alert>
            )}
            {state.kind === 'idle' && (
              <p className="py-10 text-center text-sm text-[var(--color-text-tertiary)]">
                {t('market.file.empty')}
              </p>
            )}
            {state.kind === 'loaded' && (
              state.file.language === 'markdown' ? (
                <MarkdownRenderer
                  content={state.file.content}
                  variant="document"
                  blockExternalResources={blockExternalResources}
                />
              ) : (
                <CodeViewer
                  code={state.file.content}
                  language={state.file.language}
                  showLineNumbers
                  wrapLongLines
                  maxLines={500}
                />
              )
            )}
          </CardContent>
        </ScrollArea>
      </Card>
    </div>
  )
}
