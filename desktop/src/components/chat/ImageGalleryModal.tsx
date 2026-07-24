import { useEffect } from 'react'
import { useOverlayStore } from '../../stores/overlayStore'
import { ImageGalleryDialog } from '../ui/custom/image-gallery-dialog'

type GalleryImage = {
  src: string
  name: string
}

type Props = {
  open: boolean
  images: GalleryImage[]
  activeIndex: number
  onClose: () => void
  onSelect: (index: number) => void
}

export function ImageGalleryModal({ open, images, activeIndex, onClose, onSelect }: Props) {
  // Native child webviews (e.g. the in-app browser preview) always render
  // ABOVE the DOM, so this fullscreen overlay would be partially covered.
  // Bump the overlay count while open so BrowserSurface can hide the webview.
  useEffect(() => {
    if (!open || images.length === 0) return
    const { push, pop } = useOverlayStore.getState()
    push()
    return () => pop()
  }, [images.length, open])

  return (
    <ImageGalleryDialog
      open={open}
      images={images}
      activeIndex={activeIndex}
      onClose={onClose}
      onSelect={onSelect}
    />
  )
}
