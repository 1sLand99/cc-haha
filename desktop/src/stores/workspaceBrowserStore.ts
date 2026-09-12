import { create } from 'zustand'
import type {
  WorkspaceBrowserDownload,
  WorkspaceBrowserEvent,
} from '../lib/desktopHost/types'

/**
 * Volatile per-page browser state: what the host has told us about a live page.
 *
 * Navigation history here is a *record of visits for the History menu*, not the
 * back/forward stack. Back and forward are answered by `canGoBack`/`canGoForward`
 * straight from the host's own navigation controller — simulating them with an
 * array is exactly what made the previous implementation disagree with the page
 * after a redirect or an in-page navigation.
 */

const HISTORY_LIMIT = 200
const DOWNLOAD_LIMIT = 50

export type WorkspaceBrowserPageState = {
  url: string
  title: string
  canGoBack: boolean
  canGoForward: boolean
  loading: boolean
  find: { active: number; total: number } | null
}

export type WorkspaceBrowserVisit = {
  url: string
  title: string
  visitedAt: number
}

const EMPTY_PAGE_STATE: WorkspaceBrowserPageState = {
  url: '',
  title: '',
  canGoBack: false,
  canGoForward: false,
  loading: false,
  find: null,
}

type WorkspaceBrowserStore = {
  pageByTabId: Record<string, WorkspaceBrowserPageState | undefined>
  historyByTabId: Record<string, WorkspaceBrowserVisit[] | undefined>
  downloads: WorkspaceBrowserDownload[]

  getPage: (browserTabId: string) => WorkspaceBrowserPageState
  getHistory: (browserTabId: string) => WorkspaceBrowserVisit[]

  applyEvent: (event: WorkspaceBrowserEvent) => void
  forgetTab: (browserTabId: string) => void
  clearDownloads: () => void
}

export const useWorkspaceBrowserStore = create<WorkspaceBrowserStore>((set, get) => ({
  pageByTabId: {},
  historyByTabId: {},
  downloads: [],

  getPage: (browserTabId) => get().pageByTabId[browserTabId] ?? EMPTY_PAGE_STATE,
  getHistory: (browserTabId) => get().historyByTabId[browserTabId] ?? [],

  applyEvent: (event) =>
    set((state) => {
      switch (event.type) {
        case 'state': {
          const previous = state.pageByTabId[event.tabId] ?? EMPTY_PAGE_STATE
          const history = state.historyByTabId[event.tabId] ?? []
          // Record a visit only when a *different* URL has committed. Title
          // updates and loading flips arrive as separate `state` events for the
          // same page and would otherwise fill the history with duplicates.
          const isNewVisit = !event.loading && event.url && event.url !== history.at(-1)?.url
          return {
            pageByTabId: {
              ...state.pageByTabId,
              [event.tabId]: {
                url: event.url,
                title: event.title,
                canGoBack: event.canGoBack,
                canGoForward: event.canGoForward,
                loading: event.loading,
                find: event.loading ? null : previous.find,
              },
            },
            historyByTabId: isNewVisit
              ? {
                  ...state.historyByTabId,
                  [event.tabId]: [
                    ...history,
                    { url: event.url, title: event.title, visitedAt: Date.now() },
                  ].slice(-HISTORY_LIMIT),
                }
              : state.historyByTabId,
          }
        }
        case 'found': {
          const previous = state.pageByTabId[event.tabId] ?? EMPTY_PAGE_STATE
          return {
            pageByTabId: {
              ...state.pageByTabId,
              [event.tabId]: {
                ...previous,
                find: { active: event.activeMatchOrdinal, total: event.matches },
              },
            },
          }
        }
        case 'failed': {
          const previous = state.pageByTabId[event.tabId] ?? EMPTY_PAGE_STATE
          return {
            pageByTabId: {
              ...state.pageByTabId,
              [event.tabId]: { ...previous, loading: false },
            },
          }
        }
        case 'download': {
          const rest = state.downloads.filter((item) => item.id !== event.download.id)
          return { downloads: [event.download, ...rest].slice(0, DOWNLOAD_LIMIT) }
        }
        default:
          return state
      }
    }),

  forgetTab: (browserTabId) =>
    set((state) => {
      if (!(browserTabId in state.pageByTabId) && !(browserTabId in state.historyByTabId)) {
        return state
      }
      const { [browserTabId]: _page, ...pageByTabId } = state.pageByTabId
      const { [browserTabId]: _history, ...historyByTabId } = state.historyByTabId
      return { pageByTabId, historyByTabId }
    }),

  clearDownloads: () => set({ downloads: [] }),
}))
