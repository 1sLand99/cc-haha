import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowLeft, ArrowRight, Loader2, RotateCw } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { isHtmlFilePath } from '../../lib/htmlPreviewPolicy'
import { IconButton } from '../ui/custom/icon-button'
import { Input } from '../ui/input'
import { Progress } from '../ui/progress'

type Props = {
  url: string
  canGoBack: boolean
  canGoForward: boolean
  loading?: boolean
  onNavigate: (url: string) => void
  onBack: () => void
  onForward: () => void
  onReload: () => void
  rightActions?: ReactNode
}

export function BrowserAddressBar({ url, canGoBack, canGoForward, loading = false, onNavigate, onBack, onForward, onReload, rightActions }: Props) {
  const t = useTranslation()
  const [draft, setDraft] = useState(url)
  useEffect(() => { setDraft(url) }, [url])

  return (
    <div
      data-testid="browser-address-bar"
      className="relative flex h-11 items-center gap-1 border-b border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-2"
    >
      <IconButton
        label={t('browser.back')}
        variant="ghost"
        className="size-8 rounded-full"
        disabled={!canGoBack}
        onClick={onBack}
      >
        <ArrowLeft size={16} aria-hidden="true" />
      </IconButton>
      <IconButton
        label={t('browser.forward')}
        variant="ghost"
        className="size-8 rounded-full"
        disabled={!canGoForward}
        onClick={onForward}
      >
        <ArrowRight size={16} aria-hidden="true" />
      </IconButton>
      <IconButton
        label={t('browser.reload')}
        variant="ghost"
        className="size-8 rounded-full"
        aria-busy={loading}
        onClick={onReload}
      >
        {loading
          ? (
              <Loader2
                size={16}
                aria-hidden="true"
                className="motion-safe:animate-spin motion-reduce:animate-none"
              />
            )
          : <RotateCw size={16} aria-hidden="true" />}
      </IconButton>
      <form className="min-w-0 flex-1" onSubmit={(e) => { e.preventDefault(); onNavigate(normalizeBrowserAddress(draft)) }}>
        <Input
          aria-label={t('browser.addressLabel')}
          className="h-8 rounded-full px-3 text-xs"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('browser.addressPlaceholder')}
          spellCheck={false}
        />
      </form>
      {rightActions && (
        <div data-testid="browser-toolbar-actions" className="ml-1 flex shrink-0 items-center gap-1">
          {rightActions}
        </div>
      )}
      {loading && (
        <Progress
          value={null}
          aria-label={t('browser.loading')}
          data-testid="browser-loading-bar"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 rounded-none"
        />
      )}
    </div>
  )
}

export function normalizeBrowserAddress(input: string): string {
  const value = input.trim()
  if (!value) return ''
  if (/^[a-z][a-z\d+\-.]*:\/\//i.test(value) || /^(about|data|file):/i.test(value)) return value
  if (isHtmlFilePath(value)) return value
  if (/^(localhost|127(?:\.\d{1,3}){3}|\[::1\]|::1)(?::\d+)?(?:[/?#].*)?$/i.test(value)) {
    return `http://${value}`
  }
  return `https://${value}`
}
