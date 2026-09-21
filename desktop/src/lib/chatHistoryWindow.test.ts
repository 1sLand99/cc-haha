import { describe, expect, it } from 'vitest'
import { boundHistoryWindow, historyWindowBoundary, historyWindowMessages, type HistoryWindowPage } from './chatHistoryWindow'

function page(index: number, content = 'short message'): HistoryWindowPage {
  return {
    cursor: `page-${index}`,
    page: { nextCursor: `older-${index}`, previousCursor: `newer-${index}`, hasMore: true, historyComplete: false, sourceVersion: 'v1', scannedBytes: 100, omittedOversizedEntries: 0 },
    messages: [{ id: String(index), type: 'assistant_text', timestamp: index, content }],
  }
}

describe('continuous history window', () => {
  it('retains small visited pages instead of evicting them after three requests', () => {
    const pages = Array.from({ length: 12 }, (_, index) => page(index))
    expect(boundHistoryWindow(pages, 1024 * 1024, 'older')).toBe(pages)
    expect(boundHistoryWindow(pages, 1024 * 1024, 'newer')).toBe(pages)
  })

  it('evicts only the opposite boundary when the byte budget is exhausted', () => {
    const pages = Array.from({ length: 20 }, (_, index) => page(index, 'x'.repeat(30_000)))
    const older = boundHistoryWindow(pages, 256 * 1024, 'older')
    const newer = boundHistoryWindow(pages, 256 * 1024, 'newer')
    expect(older.length).toBeGreaterThanOrEqual(3)
    expect(older.length).toBeLessThan(pages.length)
    expect(older[0]).toBe(pages[0])
    expect(newer.at(-1)).toBe(pages.at(-1))
    expect(historyWindowBoundary(older).previousCursor).toBe(older.at(-1)!.page.previousCursor)
    expect(historyWindowBoundary(newer).nextCursor).toBe(newer[0]!.page.nextCursor)
    expect(boundHistoryWindow(newer, 256 * 1024, 'newer')).toBe(newer)
  })

  it('does not shorten displayed text when another page is joined', () => {
    const first = page(0, 'readable reply '.repeat(5000))
    const before = boundHistoryWindow([first], 128 * 1024, 'older')
    const after = boundHistoryWindow([page(-2), page(-1), ...before], 128 * 1024, 'older')
    expect(after.find(entry => entry.cursor === first.cursor)).toBe(before[0])
  })

  it('bounds empty-page metadata even when records project to no visible rows', () => {
    const pages = Array.from({ length: 100 }, (_, index) => ({ ...page(index), messages: [] }))
    const retained = boundHistoryWindow(pages, 1024 * 1024, 'older')
    expect(retained.length).toBeLessThan(100)
    expect(retained[0]).toBe(pages[0])
  })

  it('preserves every row identity when large bodies exhaust the display budget', () => {
    const pages = [page(0), page(1), page(2)]
    for (const [index, entry] of pages.entries()) entry.messages = Array.from({ length: 200 }, (_, row) => ({
      id: `${index}-${row}`, type: 'assistant_text', timestamp: row, content: 'x'.repeat(32_000),
    }))
    const bounded = boundHistoryWindow(pages, 256 * 1024, 'older')
    const messages = historyWindowMessages(bounded)
    expect(messages).toHaveLength(600)
    expect(messages.map(message => message.id)).toEqual(pages.flatMap(entry => entry.messages.map(message => message.id)))
    expect(JSON.stringify(messages).length * 2).toBeLessThan(256 * 1024)
    expect(pages[0]!.messages[0]).toMatchObject({ content: 'x'.repeat(32_000) })
    expect(historyWindowMessages(bounded)).toBe(messages)
  })

  it('deduplicates overlapping page boundaries without reordering history', () => {
    const first = page(0)
    const second = page(1)
    second.messages.unshift(first.messages[0]!)
    expect(historyWindowMessages([first, second]).map(message => message.id)).toEqual(['0', '1'])
    expect(historyWindowBoundary([first, second]).historyComplete).toBe(false)
  })
})
