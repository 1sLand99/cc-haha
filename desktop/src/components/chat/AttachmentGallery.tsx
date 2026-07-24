import { useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { ChevronDown, MessageSquare, MousePointerClick, X } from 'lucide-react'
import { useTranslation, type TranslationKey } from '../../i18n'
import { getDesktopHost } from '../../lib/desktopHost'
import { isAbsoluteLocalPath } from '../../lib/handlePreviewLink'
import { buildOpenWithItems, describeFileType, type OpenWithItem } from '../../lib/openWithItems'
import { useOpenTargetStore } from '../../stores/openTargetStore'
import { useUIStore } from '../../stores/uiStore'
import { OpenWithMenu } from '../common/OpenWithMenu'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { FileTypeIcon } from '../ui/custom/file-type-icon'
import { IconButton } from '../ui/custom/icon-button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'
import { ImageGalleryModal } from './ImageGalleryModal'

export type AttachmentPreview = {
  id?: string
  type: 'image' | 'file'
  name: string
  path?: string
  data?: string
  mimeType?: string
  previewUrl?: string
  isDirectory?: boolean
  lineStart?: number
  lineEnd?: number
  diffSide?: 'old' | 'new'
  hunkId?: string
  note?: string
  quote?: string
}

const FILE_ICON_ACCENTS: Record<string, string> = {
  picture_as_pdf: '#d14343',
  docs: '#3f6ecf',
  markdown: '#4d6b8a',
  text_snippet: '#667085',
  table_chart: '#24845b',
  slideshow: '#c85b2b',
  folder_zip: '#a46a17',
  code: '#7656b5',
  audio_file: '#ad477c',
  video_file: '#6655b8',
  html: '#c05d2c',
  image: '#24899a',
  folder: '#a46a17',
  insert_drive_file: '#667085',
}

function fileIconAccent(icon: string): string {
  return FILE_ICON_ACCENTS[icon] ?? FILE_ICON_ACCENTS.insert_drive_file!
}

type Props = {
  attachments: AttachmentPreview[]
  variant?: 'composer' | 'message'
  onRemove?: (id: string) => void
}

export function AttachmentGallery({ attachments, variant = 'message', onRemove }: Props) {
  const t = useTranslation()
  const [activeImageIndex, setActiveImageIndex] = useState<number | null>(null)
  const [openWith, setOpenWith] = useState<{ items: OpenWithItem[]; anchor: DOMRect; triggerEl: HTMLElement } | null>(null)
  const galleryRef = useRef<HTMLDivElement>(null)
  const desktopHost = getDesktopHost()

  const images = useMemo(
    () =>
      attachments
        .filter((attachment) => attachment.type === 'image' && (attachment.previewUrl || attachment.data))
        .map((attachment) => ({
          src: attachment.previewUrl || attachment.data || '',
          name: attachment.name,
        })),
    [attachments],
  )

  if (attachments.length === 0) return null

  const isComposer = variant === 'composer'

  const showOpenFailure = (name: string) => {
    useUIStore.getState().addToast({
      type: 'error',
      message: t('attachments.openFailed', { name }),
    })
  }

  const openLocalAttachment = (attachment: AttachmentPreview) => {
    if (!attachment.path) return
    void desktopHost.shell.openPath(attachment.path).catch(() => showOpenFailure(attachment.name))
  }

  const openAttachmentWith = (
    event: ReactMouseEvent<HTMLButtonElement>,
    attachment: AttachmentPreview,
  ) => {
    event.stopPropagation()
    if (!attachment.path) return
    if (openWith) {
      setOpenWith(null)
      return
    }

    const triggerEl = event.currentTarget
    const anchor = triggerEl.getBoundingClientRect()
    void (async () => {
      await useOpenTargetStore.getState().ensureTargets()
      const items = buildOpenWithItems(
        { kind: 'file', absolutePath: attachment.path! },
        useOpenTargetStore.getState().targets,
        {
          openInAppBrowser: () => {},
          openSystem: (path) => {
            void desktopHost.shell.openPath(path).catch(() => showOpenFailure(attachment.name))
          },
          openWorkspacePreview: () => {},
          openTarget: (targetId, path) => {
            void useOpenTargetStore.getState().openTarget(targetId, path)
              .catch(() => showOpenFailure(attachment.name))
          },
          t: (key, vars) => t(key as TranslationKey, vars),
        },
      )
      if (items.length > 0) setOpenWith({ items, anchor, triggerEl })
    })()
  }

  const removeAttachment = (id: string, attachmentIndex: number) => {
    if (!onRemove) return
    const removeIndex = attachments
      .slice(0, attachmentIndex)
      .filter((attachment) => Boolean(attachment.id))
      .length
    onRemove(id)
    window.requestAnimationFrame(() => {
      const remainingButtons = galleryRef.current
        ? Array.from(galleryRef.current.querySelectorAll<HTMLButtonElement>('[data-attachment-remove-id]'))
        : []
      const nextButton = remainingButtons[Math.min(removeIndex, remainingButtons.length - 1)]
      if (nextButton) {
        nextButton.focus()
        return
      }
      document
        .querySelector<HTMLTextAreaElement>('textarea[role="combobox"]:not([disabled])')
        ?.focus()
    })
  }

  return (
    <>
      <div ref={galleryRef} className={isComposer ? 'flex flex-wrap items-center gap-2' : 'flex flex-wrap justify-end gap-2'}>
        {attachments.map((attachment, index) => {
          if (attachment.type === 'image' && (attachment.previewUrl || attachment.data)) {
            const src = attachment.previewUrl || attachment.data || ''
            const selectionNote = attachment.note?.trim()
            const hasSelectionNote = !isComposer && !!selectionNote
            const tooltipId = hasSelectionNote
              ? `selection-note-${(attachment.id || `${attachment.name}-${index}`).replace(/[^a-zA-Z0-9_-]/g, '-')}`
              : undefined
            return (
              <div
                key={attachment.id || `${attachment.name}-${index}`}
                className={isComposer ? 'group relative' : 'group/selection relative flex max-w-full flex-col items-end gap-1.5'}
              >
                <Button
                  variant="ghost"
                  aria-label={`Open ${attachment.name}`}
                  onClick={() => {
                    const imageIndex = attachments
                      .slice(0, index)
                      .filter((item) => item.type === 'image' && (item.previewUrl || item.data))
                      .length
                    setActiveImageIndex(imageIndex)
                  }}
                  className={
                    isComposer
                      ? 'h-auto overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-0'
                      : 'h-auto overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-0 text-left shadow-sm transition-transform hover:scale-[1.01]'
                  }
                >
                  <img
                    src={src}
                    alt={attachment.name}
                    className={
                      isComposer
                        ? 'h-16 w-16 object-cover'
                        : 'max-h-[340px] w-full max-w-[360px] object-cover'
                    }
                  />
                </Button>
                {hasSelectionNote && (
                  <TooltipProvider delayDuration={0}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge
                          id={tooltipId}
                          variant="secondary"
                          aria-label={`Selection note: ${selectionNote}`}
                          title={selectionNote}
                          tabIndex={0}
                          className="h-7 max-w-[260px] cursor-default gap-1.5 rounded-full bg-[var(--color-surface-container-low)] px-2.5 text-[12px] text-[var(--color-text-primary)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:border-[var(--color-brand)]/45 hover:bg-[var(--color-surface-container)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-offset-2"
                        >
                          <MousePointerClick aria-hidden className="size-[15px] text-[var(--color-text-tertiary)]" />
                          <span className="min-w-0 truncate">{attachment.name}</span>
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent side="top" align="end" className="w-max max-w-[min(340px,calc(100vw-3rem))] px-3 py-2 text-left text-[13px] leading-5">
                      <span className="block text-[11px] font-medium uppercase tracking-wide text-[var(--color-text-tertiary)]">
                        修改内容
                      </span>
                      <span className="mt-1 block whitespace-pre-wrap break-words">
                        {selectionNote}
                      </span>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                {onRemove && attachment.id && (
                  <IconButton
                    label={t('attachments.remove', { name: attachment.name })}
                    variant="destructive"
                    size="icon-sm"
                    data-attachment-remove-id={attachment.id}
                    onClick={(event) => {
                      event.stopPropagation()
                      removeAttachment(attachment.id!, index)
                    }}
                    className="absolute -right-1 -top-1 size-5 rounded-full text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100"
                  >
                    <X aria-hidden className="size-3" />
                  </IconButton>
                )}
              </div>
            )
          }

          if (attachment.diffSide) {
            const lineRange = attachment.lineStart
              ? `L${attachment.lineStart}${attachment.lineEnd && attachment.lineEnd !== attachment.lineStart ? `-L${attachment.lineEnd}` : ''}`
              : ''
            const location = [
              attachment.path || attachment.name,
              '·',
              t(`workspace.diffReview.side.${attachment.diffSide}`),
              lineRange,
            ]
              .filter(Boolean)
              .join(' ')
            const note = attachment.note?.trim()
            const quotePreview = attachment.quote?.trim().replace(/\s+/g, ' ')

            return (
              <Card
                key={attachment.id || `${attachment.name}-${index}`}
                data-testid="diff-comment-card"
                className="group/diff-comment flex max-w-[min(420px,100%)] min-w-[240px] items-start gap-2 rounded-[8px] px-2.5 py-2 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
              >
                <MessageSquare aria-hidden="true" size={15} className="mt-0.5 shrink-0 text-[var(--color-text-tertiary)]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] font-medium text-[var(--color-text-tertiary)]">
                    {location}
                  </span>
                  {note && (
                    <span className="mt-0.5 block text-[13px] font-medium leading-5 text-[var(--color-text-primary)]">
                      {note}
                    </span>
                  )}
                  {quotePreview && (
                    <span className="mt-0.5 block truncate font-[var(--font-mono)] text-[11px] leading-4 text-[var(--color-text-tertiary)]">
                      {quotePreview}
                    </span>
                  )}
                </span>
                {onRemove && attachment.id && (
                  <IconButton
                    label={t('attachments.remove', { name: attachment.name })}
                    variant="ghost"
                    size="icon-sm"
                    data-attachment-remove-id={attachment.id}
                    onClick={() => removeAttachment(attachment.id!, index)}
                    className="size-5 shrink-0 rounded-[4px] text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
                  >
                    <X aria-hidden="true" size={14} />
                  </IconButton>
                )}
              </Card>
            )
          }

          const lineLabel = attachment.lineStart
            ? `:L${attachment.lineStart}${attachment.lineEnd && attachment.lineEnd !== attachment.lineStart ? `-L${attachment.lineEnd}` : ''}`
            : ''
          const quotePreview = attachment.quote?.trim().replace(/\s+/g, ' ')
          const hasQuotePreview = !!quotePreview
          const typeInfo = describeFileType(attachment.path || attachment.name)
          const fileIcon = attachment.isDirectory ? 'folder' : typeInfo.icon
          const typeLabel = attachment.isDirectory
            ? t('openWith.fileType.file')
            : typeInfo.ext || t(typeInfo.categoryKey as TranslationKey)
          const canOpenLocally =
            !isComposer &&
            !!attachment.path &&
            isAbsoluteLocalPath(attachment.path) &&
            desktopHost.isDesktop &&
            desktopHost.capabilities.shell

          const fileVisual = (
            <>
              <span
                aria-hidden="true"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-[var(--color-surface)] shadow-[inset_0_0_0_1px_var(--color-border)]"
                style={{ color: fileIconAccent(fileIcon) }}
              >
                <FileTypeIcon icon={fileIcon} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block min-w-0 max-w-[260px] truncate text-[13px] font-semibold leading-5 text-[var(--color-text-primary)]">
                  {attachment.name}{lineLabel}
                </span>
                <span className="block truncate text-[10px] font-semibold uppercase leading-3 tracking-[0.08em] text-[var(--color-text-tertiary)]">
                  {typeLabel}
                </span>
                {hasQuotePreview && (
                  <span className="mt-0.5 block max-w-[320px] truncate font-[var(--font-mono)] text-[11px] leading-4 text-[var(--color-text-tertiary)]">
                    {quotePreview}
                  </span>
                )}
              </span>
            </>
          )

          if (canOpenLocally) return (
            <Card
              key={attachment.id || `${attachment.name}-${index}`}
              data-file-extension={typeInfo.ext || undefined}
              className={[
                'group/file inline-flex max-w-full min-w-[220px] items-stretch overflow-hidden rounded-[12px] border border-[var(--color-border)]',
                'bg-[var(--color-surface-container-low)] text-[var(--color-text-secondary)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]',
                'transition-colors hover:border-[var(--color-brand)]/35 hover:bg-[var(--color-surface-container)]',
              ].join(' ')}
            >
              <Button
                variant="ghost"
                onClick={() => openLocalAttachment(attachment)}
                aria-label={t('attachments.open', { name: attachment.name })}
                title={attachment.path}
                className="h-auto min-h-12 min-w-0 flex-1 justify-start rounded-none px-2.5 py-1.5 text-left focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-brand)]/40"
              >
                {fileVisual}
              </Button>
              <IconButton
                label={t('openWith.title')}
                tooltip={t('openWith.title')}
                variant="ghost"
                size="icon"
                onClick={(event) => openAttachmentWith(event, attachment)}
                title={t('openWith.title')}
                className="h-auto w-9 self-stretch rounded-none border-l border-[var(--color-border)] text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-brand)]/40"
              >
                <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
              </IconButton>
            </Card>
          )

          return (
            <Card
              key={attachment.id || `${attachment.name}-${index}`}
              data-file-extension={typeInfo.ext || undefined}
              className={[
                'group/file inline-flex max-w-full min-w-0 items-center gap-2.5 border border-[var(--color-border)]',
                'rounded-[12px] bg-[var(--color-surface-container-low)] px-2.5 py-1.5 text-[var(--color-text-secondary)]',
                'shadow-[0_1px_2px_rgba(0,0,0,0.04)]',
              ].join(' ')}
            >
              {fileVisual}
              {onRemove && attachment.id && (
                <IconButton
                  label={t('attachments.remove', { name: attachment.name })}
                  variant="ghost"
                  size="icon-sm"
                  data-attachment-remove-id={attachment.id}
                  onClick={() => removeAttachment(attachment.id!, index)}
                  className={`${hasQuotePreview ? 'mt-0.5' : 'ml-0.5'} size-5 shrink-0 rounded-full text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]`}
                >
                  <X aria-hidden className="size-[17px]" />
                </IconButton>
              )}
            </Card>
          )
        })}
      </div>

      {activeImageIndex !== null && activeImageIndex >= 0 && (
        <ImageGalleryModal
          open={activeImageIndex !== null}
          images={images}
          activeIndex={activeImageIndex}
          onClose={() => setActiveImageIndex(null)}
          onSelect={setActiveImageIndex}
        />
      )}
      {openWith && (
        <OpenWithMenu
          items={openWith.items}
          anchor={openWith.anchor}
          triggerEl={openWith.triggerEl}
          onClose={() => setOpenWith(null)}
        />
      )}
    </>
  )
}
