import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OpenWithMenu } from './OpenWithMenu'
import type { OpenWithItem } from '../../lib/openWithItems'

const anchor = { top: 100, bottom: 110, left: 20, right: 120 }

function makeItems(onSelect1 = vi.fn(), onSelect2 = vi.fn(), onSelect3 = vi.fn()): OpenWithItem[] {
  return [
    { id: 'in-app', label: 'In-app browser', icon: 'in-app-browser', onSelect: onSelect1 },
    { id: 'system', label: 'System browser', icon: 'system', onSelect: onSelect2 },
    { id: 'preview', label: 'Workspace preview', icon: 'preview', onSelect: onSelect3 },
  ]
}

describe('OpenWithMenu', () => {
  it('renders all item labels', () => {
    const onClose = vi.fn()
    render(<OpenWithMenu items={makeItems()} anchor={anchor} onClose={onClose} />)
    expect(screen.getByText('In-app browser')).toBeInTheDocument()
    expect(screen.getByText('System browser')).toBeInTheDocument()
    expect(screen.getByText('Workspace preview')).toBeInTheDocument()
  })

  it('renders a menu role', () => {
    const onClose = vi.fn()
    render(<OpenWithMenu items={makeItems()} anchor={anchor} onClose={onClose} />)
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('renders menuitems for each item', () => {
    const onClose = vi.fn()
    render(<OpenWithMenu items={makeItems()} anchor={anchor} onClose={onClose} />)
    const menuItems = screen.getAllByRole('menuitem')
    expect(menuItems).toHaveLength(3)
  })

  it('clicking an item calls its onSelect and onClose', () => {
    const onClose = vi.fn()
    const onSelect1 = vi.fn()
    render(<OpenWithMenu items={makeItems(onSelect1)} anchor={anchor} onClose={onClose} />)
    fireEvent.click(screen.getByText('In-app browser'))
    expect(onSelect1).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('clicking the second item calls its onSelect and onClose', () => {
    const onClose = vi.fn()
    const onSelect2 = vi.fn()
    render(<OpenWithMenu items={makeItems(vi.fn(), onSelect2)} anchor={anchor} onClose={onClose} />)
    fireEvent.click(screen.getByText('System browser'))
    expect(onSelect2).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('pressing Escape calls onClose', () => {
    const onClose = vi.fn()
    render(<OpenWithMenu items={makeItems()} anchor={anchor} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('pointer down outside the menu calls onClose', async () => {
    const onClose = vi.fn()
    render(<OpenWithMenu items={makeItems()} anchor={anchor} onClose={onClose} />)
    fireEvent.pointerDown(document.body, { button: 0, pointerType: 'mouse' })
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('scrolling the viewport calls onClose', () => {
    const onClose = vi.fn()
    render(<OpenWithMenu items={makeItems()} anchor={anchor} onClose={onClose} />)
    fireEvent.scroll(window)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  describe('triggerEl exclusion (re-click-trigger toggle support)', () => {
    it('does NOT call onClose when mousedown lands inside triggerEl', () => {
      // Set up a trigger element + a child within it in the document.
      const trigger = document.createElement('button')
      const triggerChild = document.createElement('span')
      trigger.appendChild(triggerChild)
      document.body.appendChild(trigger)
      const onClose = vi.fn()
      render(<OpenWithMenu items={makeItems()} anchor={anchor} onClose={onClose} triggerEl={trigger} />)

      // mousedown on the trigger itself
      fireEvent.mouseDown(trigger)
      expect(onClose).not.toHaveBeenCalled()

      // mousedown on a descendant of the trigger
      fireEvent.mouseDown(triggerChild)
      expect(onClose).not.toHaveBeenCalled()

      document.body.removeChild(trigger)
    })

    it('STILL calls onClose for true outside clicks (not menu, not trigger)', async () => {
      const trigger = document.createElement('button')
      document.body.appendChild(trigger)
      const outside = document.createElement('div')
      document.body.appendChild(outside)
      const onClose = vi.fn()
      render(<OpenWithMenu items={makeItems()} anchor={anchor} onClose={onClose} triggerEl={trigger} />)

      fireEvent.pointerDown(outside, { button: 0, pointerType: 'mouse' })
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))

      document.body.removeChild(trigger)
      document.body.removeChild(outside)
    })

    it('Escape still closes when triggerEl is provided', () => {
      const trigger = document.createElement('button')
      document.body.appendChild(trigger)
      const onClose = vi.fn()
      render(<OpenWithMenu items={makeItems()} anchor={anchor} onClose={onClose} triggerEl={trigger} />)
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(onClose).toHaveBeenCalledTimes(1)
      document.body.removeChild(trigger)
    })

    it('item click still closes the menu when triggerEl is provided', () => {
      const trigger = document.createElement('button')
      document.body.appendChild(trigger)
      const onClose = vi.fn()
      const onSelect1 = vi.fn()
      render(<OpenWithMenu items={makeItems(onSelect1)} anchor={anchor} onClose={onClose} triggerEl={trigger} />)
      fireEvent.click(screen.getByText('In-app browser'))
      expect(onSelect1).toHaveBeenCalledTimes(1)
      expect(onClose).toHaveBeenCalledTimes(1)
      document.body.removeChild(trigger)
    })
  })

  it('delegates viewport collision handling to the anchored shadcn menu', () => {
    render(<OpenWithMenu items={makeItems()} anchor={{ top: 260, bottom: 270, left: 20, right: 120 }} onClose={vi.fn()} />)
    const menuAnchor = document.querySelector<HTMLElement>('[data-slot="pointer-dropdown-anchor"]')
    expect(menuAnchor).toHaveStyle({ top: '260px', left: '20px', width: '100px', height: '10px' })
    expect(screen.getByRole('menu')).toHaveAttribute('data-slot', 'dropdown-menu-content')
  })
})
