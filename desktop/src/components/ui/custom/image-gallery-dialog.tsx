import { useEffect, useRef } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { IconButton } from '@/components/ui/custom/icon-button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

type GalleryImage = {
  src: string
  name: string
}

type ImageGalleryDialogProps = {
  open: boolean
  images: GalleryImage[]
  activeIndex: number
  onClose: () => void
  onSelect: (index: number) => void
}

function ImageGalleryDialog({
  open,
  images,
  activeIndex,
  onClose,
  onSelect,
}: ImageGalleryDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const wasOpenRef = useRef(false)
  if (
    open &&
    !wasOpenRef.current &&
    typeof document !== 'undefined' &&
    document.activeElement instanceof HTMLElement
  ) {
    returnFocusRef.current = document.activeElement
  }
  const safeActiveIndex = images.length > 0
    ? Math.min(Math.max(activeIndex, 0), images.length - 1)
    : -1
  const activeImage = safeActiveIndex >= 0 ? images[safeActiveIndex] : undefined

  useEffect(() => {
    wasOpenRef.current = open
    if (!open) return
    return () => {
      const returnTarget = returnFocusRef.current
      window.requestAnimationFrame(() => {
        if (returnTarget?.isConnected) returnTarget.focus()
      })
    }
  }, [open])

  useEffect(() => {
    if (open && safeActiveIndex >= 0 && activeIndex !== safeActiveIndex) {
      onSelect(safeActiveIndex)
    }
  }, [activeIndex, onSelect, open, safeActiveIndex])

  useEffect(() => {
    if (!open || images.length <= 1 || safeActiveIndex < 0) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        onSelect((safeActiveIndex - 1 + images.length) % images.length)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        onSelect((safeActiveIndex + 1) % images.length)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [images.length, onSelect, open, safeActiveIndex])

  if (!activeImage) return null

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen) onClose()
    }}>
      <DialogContent
        showCloseButton={false}
        className="w-[min(94vw,960px)] max-w-none"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          closeRef.current?.focus()
        }}
        onEscapeKeyDown={(event) => {
          event.preventDefault()
          onClose()
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          onClose()
        }}
      >
        <DialogHeader className="flex-row items-start justify-between gap-4 pr-0">
          <div className="min-w-0">
            <DialogTitle className="truncate text-sm">{activeImage.name}</DialogTitle>
            <DialogDescription className="text-xs">
              {safeActiveIndex + 1} / {images.length}
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <IconButton
              ref={closeRef}
              label="Close image preview"
              variant="ghost"
              size="icon"
              className="size-9 rounded-full"
            >
              <X aria-hidden className="size-4" />
            </IconButton>
          </DialogClose>
        </DialogHeader>

        {images.length > 1 && (
          <div className="absolute right-[68px] top-5 flex items-center gap-2">
            <IconButton
              label="Previous image"
              variant="outline"
              size="icon"
              className="size-9 rounded-full"
              onClick={() => onSelect((safeActiveIndex - 1 + images.length) % images.length)}
            >
              <ChevronLeft aria-hidden className="size-[18px]" />
            </IconButton>
            <IconButton
              label="Next image"
              variant="outline"
              size="icon"
              className="size-9 rounded-full"
              onClick={() => onSelect((safeActiveIndex + 1) % images.length)}
            >
              <ChevronRight aria-hidden className="size-[18px]" />
            </IconButton>
          </div>
        )}

        <div className="flex max-h-[70vh] items-center justify-center overflow-hidden rounded-2xl bg-[#111]">
          <img src={activeImage.src} alt={activeImage.name} className="max-h-[70vh] w-full object-contain" />
        </div>

        {images.length > 1 && (
          <ToggleGroup
            type="single"
            value={String(safeActiveIndex)}
            onValueChange={(value) => {
              if (value) onSelect(Number(value))
            }}
            aria-label="Image thumbnails"
            className="justify-start overflow-x-auto pb-1"
          >
            {images.map((image, index) => (
              <ToggleGroupItem
                key={`${image.name}-${index}`}
                value={String(index)}
                aria-label={`View ${image.name}`}
                className={`h-auto shrink-0 overflow-hidden rounded-xl border p-0 transition-all ${
                  index === safeActiveIndex
                    ? 'border-[var(--color-brand)] shadow-[0_0_0_1px_var(--color-brand)]'
                    : 'border-[var(--color-border)]'
                }`}
              >
                <img src={image.src} alt="" className="h-16 w-16 object-cover" />
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
      </DialogContent>
    </Dialog>
  )
}

export { ImageGalleryDialog }
export type { GalleryImage, ImageGalleryDialogProps }
