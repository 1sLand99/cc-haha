import type { MarkedExtension, Tokens } from 'marked'
import { isBareUrlOnly, matchBareUrl } from './urlBoundary'

/**
 * Replace marked's built-in GFM `url` tokenizer with a CJK-aware one.
 *
 * Only the boundary logic changes — returning `false` hands the input back to
 * the built-in tokenizer, which still covers schemeless `www.` links and bare
 * email addresses. See `urlBoundary.ts` for why the built-in boundaries are
 * wrong in Chinese prose.
 */
export const cjkAwareAutolink: MarkedExtension = {
  tokenizer: {
    url(src: string): Tokens.Link | false {
      const url = matchBareUrl(src)
      if (!url) return false

      return {
        type: 'link',
        raw: url,
        href: url,
        title: null,
        text: url,
        tokens: [{ type: 'text', raw: url, text: url }],
      }
    },
  },
}

/** Class marking an anchor that wraps an inline-code chip rather than prose. */
export const CODE_LINK_CLASS = 'md-code-link'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Render inline code, linking it when the whole span is nothing but a bare URL.
 *
 * `codespan` runs before `url` in marked's inline loop, so a very common
 * assistant phrasing — "访问 `http://localhost:3000`" — produced a `<code>` that
 * could not be clicked at all. Wrapping the chip in an anchor keeps the code
 * styling while routing the click through the normal preview-link handler.
 *
 * Deliberately whole-span only: `` `curl http://localhost:3000` `` is a command,
 * not a link, and stays plain code.
 */
export function renderCodespan({ text }: Tokens.Codespan): string {
  const code = `<code>${escapeHtml(text)}</code>`
  if (!isBareUrlOnly(text)) return code

  return `<a href="${escapeHtml(text.trim())}" class="${CODE_LINK_CLASS}">${code}</a>`
}
