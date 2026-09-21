import type { SessionHistoryPage } from '../api/sessions'
import type { UIMessage } from '../types/chat'

export type HistoryDirection = 'older' | 'newer'
export type HistoryWindowPage = {
  cursor: string | null
  page: NonNullable<SessionHistoryPage['page']>
  messages: UIMessage[]
}

// Raw transcript pages may collapse into a single tool summary. Bound by bytes,
// not three requests, while still capping metadata for empty/hidden pages.
const MAX_WINDOW_PAGES = 64
const pageSizes = new WeakMap<HistoryWindowPage, number>()
export function historyPageBytes(page: HistoryWindowPage): number {
  let size = pageSizes.get(page)
  if (size === undefined) {
    size = 256 + JSON.stringify(page).length * 2
    pageSizes.set(page, size)
  }
  return size
}
const cache = new WeakMap<HistoryWindowPage[], { budget: number; direction: HistoryDirection; pages: HistoryWindowPage[] }>()

export function boundHistoryWindow(pages: HistoryWindowPage[], budget: number, direction: HistoryDirection): HistoryWindowPage[] {
  const cached = cache.get(pages)
  if (cached?.budget === budget && cached.direction === direction) return cached.pages
  // Cursors address whole pages. Drop the opposite boundary, never shorten a
  // body within a retained page. A single oversized record may own its page.
  const normalized = direction === 'older' ? pages.slice(0, MAX_WINDOW_PAGES) : pages.slice(-MAX_WINDOW_PAGES)
  let start = direction === 'older' ? 0 : normalized.length
  let end = start
  let bytes = 0
  while (direction === 'older' ? end < normalized.length : start > 0) {
    const next = normalized[direction === 'older' ? end : start - 1]!
    const size = historyPageBytes(next)
    // Retain the current page and its two neighbours so a page insertion
    // cannot evict the reader's anchor. Each server page has a record limit.
    if (end - start >= 3 && bytes + size > budget) break
    bytes += size
    if (direction === 'older') end++
    else start--
  }
  const result = normalized.slice(start, end)
  const bounded = result.length === pages.length && result.every((page, index) => page === pages[index]) ? pages : result
  const memo = { budget, direction, pages: bounded }
  cache.set(pages, memo)
  cache.set(bounded, memo)
  return bounded
}

const flattened = new WeakMap<HistoryWindowPage[], UIMessage[]>()
export function historyWindowMessages(pages: HistoryWindowPage[]): UIMessage[] {
  const cached = flattened.get(pages)
  if (cached) return cached
  const seen = new Set<string>()
  const messages: UIMessage[] = []
  for (const page of pages) for (const message of page.messages) {
    if (seen.has(message.id)) continue
    seen.add(message.id)
    messages.push(message)
  }
  flattened.set(pages, messages)
  return messages
}

export function historyWindowBoundary(pages: HistoryWindowPage[]): NonNullable<SessionHistoryPage['page']> {
  const oldest = pages[0]!.page
  const newest = pages[pages.length - 1]!.page
  return {
    ...oldest,
    previousCursor: newest.previousCursor ?? null,
    // A collection of display pages must never become authoritative recovery.
    historyComplete: pages.length === 1 && oldest.historyComplete,
  }
}
