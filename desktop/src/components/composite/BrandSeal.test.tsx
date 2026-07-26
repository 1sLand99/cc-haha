import { render } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, expect, it } from 'vitest'

import { BrandSeal } from './BrandSeal'

describe('BrandSeal', () => {
  it('is decorative and hidden from assistive tech', () => {
    // The product name always sits beside the seal (sidebar) or under it
    // (empty state); announcing the glyph as well reads the brand twice.
    const { container } = render(<BrandSeal />)
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders the 哈 glyph in the headline serif at every size', () => {
    for (const size of ['sm', 'md', 'lg', 'xl'] as const) {
      const { container, unmount } = render(<BrandSeal size={size} />)
      const glyph = container.querySelector('span span:last-child') as HTMLElement
      expect(glyph.textContent).toBe('哈')
      expect(glyph.style.fontFamily).toContain('var(--font-headline)')
      unmount()
    }
  })

  it('fills with the brand token so all six palettes recolor it', () => {
    // This is why the seal replaced the raster app icon: a bitmap kept its own
    // colors under every theme while the chrome around it moved.
    const { container } = render(<BrandSeal />)
    expect(container.firstElementChild?.className).toContain('bg-[var(--color-brand)]')
  })

  it('engraves the inner rule only at the empty-state size', () => {
    // At 38px and below the 1.5px inset ring closes up into a smudge; the
    // handoff only draws it on the 80px seal.
    const { container: xl } = render(<BrandSeal size="xl" />)
    expect(xl.querySelector('.border-\\[1\\.5px\\]')).not.toBeNull()

    for (const size of ['sm', 'md', 'lg'] as const) {
      const { container, unmount } = render(<BrandSeal size={size} />)
      expect(container.querySelector('.border-\\[1\\.5px\\]')).toBeNull()
      unmount()
    }
  })
})
