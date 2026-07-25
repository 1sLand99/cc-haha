import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ImageGalleryModal } from './ImageGalleryModal'
import { useOverlayStore } from '../../stores/overlayStore'

const images = [{ src: 'data:image/png;base64,AAAA', name: 'a.png' }]

const reset = () => {
  useOverlayStore.setState(useOverlayStore.getInitialState(), true)
}

beforeEach(reset)
afterEach(reset)

describe('ImageGalleryModal · overlay suppression', () => {
  it('increments overlay count while open and decrements on unmount', () => {
    expect(useOverlayStore.getState().count).toBe(0)

    const { unmount } = render(
      <ImageGalleryModal
        open
        images={images}
        activeIndex={0}
        onClose={() => {}}
        onSelect={() => {}}
      />,
    )
    expect(useOverlayStore.getState().count).toBe(1)

    unmount()
    expect(useOverlayStore.getState().count).toBe(0)
  })

  it('does not increment when rendered with open=false', () => {
    const { unmount } = render(
      <ImageGalleryModal
        open={false}
        images={images}
        activeIndex={0}
        onClose={() => {}}
        onSelect={() => {}}
      />,
    )
    expect(useOverlayStore.getState().count).toBe(0)
    unmount()
    expect(useOverlayStore.getState().count).toBe(0)
  })

  it('toggles count when open prop flips closed → open → closed', () => {
    const { rerender, unmount } = render(
      <ImageGalleryModal
        open={false}
        images={images}
        activeIndex={0}
        onClose={() => {}}
        onSelect={() => {}}
      />,
    )
    expect(useOverlayStore.getState().count).toBe(0)

    rerender(
      <ImageGalleryModal
        open
        images={images}
        activeIndex={0}
        onClose={() => {}}
        onSelect={() => {}}
      />,
    )
    expect(useOverlayStore.getState().count).toBe(1)

    rerender(
      <ImageGalleryModal
        open={false}
        images={images}
        activeIndex={0}
        onClose={() => {}}
        onSelect={() => {}}
      />,
    )
    expect(useOverlayStore.getState().count).toBe(0)

    unmount()
    expect(useOverlayStore.getState().count).toBe(0)
  })

  it('provides an accessible title and clamps an invalid active index', async () => {
    const onSelect = vi.fn()
    render(
      <ImageGalleryModal
        open
        images={[
          { src: 'data:image/png;base64,AAAA', name: 'a.png' },
          { src: 'data:image/png;base64,BBBB', name: 'b.png' },
        ]}
        activeIndex={99}
        onClose={() => {}}
        onSelect={onSelect}
      />,
    )

    expect(screen.getByRole('dialog', { name: 'b.png' })).toBeInTheDocument()
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(1))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close image preview' })).toHaveFocus())
  })

  it('navigates with arrow keys and restores focus to the opener on close', async () => {
    function GalleryHarness() {
      const [open, setOpen] = useState(false)
      const [activeIndex, setActiveIndex] = useState(0)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open gallery</button>
          <ImageGalleryModal
            open={open}
            images={[
              { src: 'data:image/png;base64,AAAA', name: 'a.png' },
              { src: 'data:image/png;base64,BBBB', name: 'b.png' },
            ]}
            activeIndex={activeIndex}
            onClose={() => setOpen(false)}
            onSelect={setActiveIndex}
          />
        </>
      )
    }

    render(<GalleryHarness />)
    const opener = screen.getByRole('button', { name: 'Open gallery' })
    opener.focus()
    fireEvent.click(opener)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Close image preview' })).toHaveFocus())
    fireEvent.keyDown(document, { key: 'ArrowLeft' })
    expect(screen.getByRole('dialog', { name: 'b.png' })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'ArrowRight' })
    expect(screen.getByRole('dialog', { name: 'a.png' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close image preview' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(opener).toHaveFocus()
    })
  })

  it('calls onClose when opened with an empty image list', async () => {
    const onClose = vi.fn()
    render(
      <ImageGalleryModal
        open
        images={[]}
        activeIndex={0}
        onClose={onClose}
        onSelect={() => {}}
      />,
    )

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
