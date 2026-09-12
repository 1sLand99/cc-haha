import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FileTypeBadge, getFileBadgeMeta } from './FileTypeBadge'

describe('getFileBadgeMeta', () => {
  it.each([
    ['app.ts', 'TS'],
    ['App.tsx', 'TSX'],
    ['main.js', 'JS'],
    ['App.jsx', 'JSX'],
    ['tsconfig.json', '{}'],
    ['README.md', 'MD'],
    ['globals.css', 'CSS'],
    ['index.html', 'H'],
    ['logo.png', 'IMG'],
    ['photo.jpg', 'IMG'],
    ['photo.jpeg', 'IMG'],
    ['loop.gif', 'IMG'],
    ['icon.svg', 'SVG'],
  ])('labels %s as %s', (name, label) => {
    expect(getFileBadgeMeta(name).label).toBe(label)
  })

  it('falls back to the first three characters of an unmapped extension', () => {
    expect(getFileBadgeMeta('main.rust').label).toBe('RUS')
    expect(getFileBadgeMeta('query.sql').label).toBe('SQL')
  })

  it('labels an extensionless file as plain text', () => {
    expect(getFileBadgeMeta('Makefile').label).toBe('TXT')
  })
})

describe('FileTypeBadge', () => {
  it('renders the mapped label with its tone', () => {
    render(<FileTypeBadge name="App.tsx" />)

    const badge = screen.getByText('TSX')
    expect(badge.className).toContain('bg-[var(--color-info-container)]')
    expect(badge.className).toContain('text-[var(--color-on-info-container)]')
  })

  it('hides itself from screen readers, which already get the file name', () => {
    render(<FileTypeBadge name="App.tsx" />)

    expect(screen.getByText('TSX')).toHaveAttribute('aria-hidden', 'true')
  })

  it('dims the badge on inactive rows', () => {
    const { container: subtle } = render(<FileTypeBadge name="App.tsx" subtle />)
    const { container: plain } = render(<FileTypeBadge name="App.tsx" />)

    expect(subtle.firstElementChild?.className).toContain('opacity-55 grayscale')
    expect(plain.firstElementChild?.className).not.toContain('opacity-55')
  })
})
