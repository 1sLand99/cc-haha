import { describe, expect, it } from 'vitest'

import css from './globals.css?raw'

/**
 * Contrast guard for the status palette.
 *
 * This exists because the light theme shipped a warning badge at 2.66:1 —
 * unreadable, and invisible to every other kind of test: the structure was
 * right, the ARIA was right, the token names were right, and the two other
 * themes were fine. It only showed up when the colors were actually resolved
 * and measured.
 *
 * Tokens are resolved from the stylesheet rather than from a browser, so this
 * runs in the normal unit suite.
 */

type Rgb = { r: number; g: number; b: number; a: number }

const THEME_BLOCKS = {
  // The light values live in `@theme` and are refined in the `:root` block.
  light: [':root,\n[data-theme="light"]', '@theme'],
  white: ['[data-theme="white"]', '@theme'],
  dark: ['[data-theme="dark"]', '@theme'],
} as const

function blockBody(selector: string): string {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`Missing block: ${selector}`)
  const open = css.indexOf('{', start)
  let depth = 0
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1
    if (css[i] === '}') {
      depth -= 1
      if (depth === 0) return css.slice(open + 1, i)
    }
  }
  throw new Error(`Unclosed block: ${selector}`)
}

/** Reads a token from the first block that defines it, following aliases. */
function resolve(token: string, selectors: readonly string[], seen = new Set<string>()): string {
  if (seen.has(token)) throw new Error(`Cyclic token: ${token}`)
  seen.add(token)

  for (const selector of selectors) {
    const match = blockBody(selector).match(new RegExp(`${token}\\s*:\\s*([^;]+);`))
    if (!match) continue
    const value = match[1]!.trim()
    const alias = value.match(/^var\(\s*(--[\w-]+)\s*\)$/)
    return alias ? resolve(alias[1]!, selectors, seen) : value
  }
  throw new Error(`Unresolved token: ${token}`)
}

function parseColor(value: string): Rgb {
  const hex = value.match(/^#([0-9a-f]{6})$/i)
  if (hex) {
    const n = parseInt(hex[1]!, 16)
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 }
  }
  const rgba = value.match(/^rgba?\(([^)]+)\)$/i)
  if (rgba) {
    const parts = rgba[1]!.split(',').map((p) => Number(p.trim()))
    return { r: parts[0]!, g: parts[1]!, b: parts[2]!, a: parts[3] ?? 1 }
  }
  throw new Error(`Unsupported color: ${value}`)
}

/** Flattens a translucent color onto an opaque one, as the compositor would. */
function flatten(fg: Rgb, bg: Rgb): Rgb {
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  }
}

function luminance({ r, g, b }: Rgb): number {
  const channel = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrast(fg: Rgb, bg: Rgb): number {
  const a = luminance(fg)
  const b = luminance(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/** WCAG AA for text below 18.66px, which every badge and status label is. */
const AA_SMALL_TEXT = 4.5

const STATUS_PAIRS = [
  { name: 'success', fill: '--color-success-container', text: '--color-on-success-container' },
  { name: 'warning', fill: '--color-warning-container', text: '--color-on-warning-container' },
  { name: 'danger', fill: '--color-error-container', text: '--color-on-error-container' },
  { name: 'info', fill: '--color-info-container', text: '--color-on-info-container' },
  { name: 'brand', fill: '--color-brand-soft', text: '--color-brand' },
  { name: 'neutral', fill: '--color-surface-container', text: '--color-text-secondary' },
] as const

describe('status palette contrast', () => {
  for (const [theme, selectors] of Object.entries(THEME_BLOCKS)) {
    describe(theme, () => {
      const surface = parseColor(resolve('--color-surface', selectors))

      for (const pair of STATUS_PAIRS) {
        it(`keeps ${pair.name} badge text readable on its own fill`, () => {
          // Dark's containers are translucent; composite before measuring.
          const fill = flatten(parseColor(resolve(pair.fill, selectors)), surface)
          const text = flatten(parseColor(resolve(pair.text, selectors)), fill)
          const ratio = contrast(text, fill)

          expect(
            Number(ratio.toFixed(2)),
            `${theme}/${pair.name}: ${pair.text} on ${pair.fill} is ${ratio.toFixed(2)}:1, needs ${AA_SMALL_TEXT}:1`,
          ).toBeGreaterThanOrEqual(AA_SMALL_TEXT)
        })
      }
    })
  }
})

describe('primary action contrast', () => {
  for (const [theme, selectors] of Object.entries(THEME_BLOCKS)) {
    it(`keeps the accent chip readable in ${theme}`, () => {
      const container = parseColor(resolve('--color-primary-container', selectors))
      const onContainer = parseColor(resolve('--color-on-primary-container', selectors))
      expect(
        Number(contrast(onContainer, container).toFixed(2)),
        `${theme}: --color-on-primary-container on --color-primary-container`,
      ).toBeGreaterThanOrEqual(AA_SMALL_TEXT)
    })
  }
})
