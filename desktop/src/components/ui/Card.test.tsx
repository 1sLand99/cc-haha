import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, expect, it } from 'vitest'

import { Card } from './Card'

describe('Card', () => {
  it('renders its children', () => {
    render(<Card>Body</Card>)
    expect(screen.getByText('Body')).toBeInTheDocument()
  })

  it('always uses the radius scale, never a Tailwind radius', () => {
    // `rounded-lg` is 8px and `rounded-[var(--radius-lg)]` is 12px — the same
    // name for two values is how 21 corner radii shipped.
    for (const radius of ['sm', 'md', 'lg', 'xl'] as const) {
      const { container, unmount } = render(<Card radius={radius}>x</Card>)
      expect(container.firstElementChild?.className).toContain(`rounded-[var(--radius-${radius})]`)
      unmount()
    }
  })

  it('supports the surface layers without hardcoding a color', () => {
    for (const surface of ['base', 'low', 'lowest', 'high'] as const) {
      const { container, unmount } = render(<Card surface={surface}>x</Card>)
      expect(container.firstElementChild?.className).toMatch(/bg-\[var\(--color-surface[\w-]*\)\]/)
      unmount()
    }
  })

  it('can drop its surface and border', () => {
    const { container } = render(<Card surface="none" border="none">x</Card>)
    const className = container.firstElementChild!.className
    expect(className).not.toMatch(/\bbg-\[/)
    expect(className).not.toContain('border')
  })

  it('supports a dashed border for placeholders', () => {
    const { container } = render(<Card border="dashed">x</Card>)
    expect(container.firstElementChild?.className).toContain('border-dashed')
  })

  it('adds hover and focus affordances only when interactive', () => {
    const { container: plain } = render(<Card>x</Card>)
    expect(plain.firstElementChild?.className).not.toContain('focus-visible:ring-2')

    const { container: clickable } = render(<Card interactive>x</Card>)
    expect(clickable.firstElementChild?.className).toContain('focus-visible:ring-2')
    expect(clickable.firstElementChild?.className).toContain('cursor-pointer')
  })

  it('renders as the requested element', () => {
    const { container } = render(<Card as="article">x</Card>)
    expect(container.firstElementChild?.tagName).toBe('ARTICLE')
  })
})
