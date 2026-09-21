import type { PerSessionState } from '../stores/chatStore'
import type { UIMessage } from '../types/chat'
import { boundChatHistory } from './chatHistoryBudget'

export const CHAT_HISTORY_CACHE_BYTES = 16 * 1024 * 1024

type HistoryCache = Pick<PerSessionState, 'messages' | 'historyInitialPage' | 'historyWindowPages' | 'historyBrowseMessages' | 'historyWindowOverlay'>
const sizes = new WeakMap<UIMessage[], { initial: HistoryCache['historyInitialPage']; pages: HistoryCache['historyWindowPages']; browse: UIMessage[] | undefined; overlay: UIMessage[] | undefined; bytes: number }>()

/** Count shared message objects once across live and durable page projections. */
export function historyCacheBytes(session: HistoryCache): number {
  const cached = sizes.get(session.messages)
  if (cached && cached.initial === session.historyInitialPage && cached.pages === session.historyWindowPages && cached.browse === session.historyBrowseMessages && cached.overlay === session.historyWindowOverlay) return cached.bytes
  const seen = new Set<UIMessage>()
  let bytes = 0
  const count = (messages: UIMessage[] | undefined) => {
    for (const message of messages ?? []) {
      if (seen.has(message)) continue
      seen.add(message)
      // A one-row window always retains its whole payload and uses the shared
      // identity-memoized estimator without creating a shortened replacement.
      bytes += boundChatHistory([message]).bytes
    }
  }
  count(session.messages)
  count(session.historyInitialPage?.messages)
  count(session.historyBrowseMessages)
  count(session.historyWindowOverlay)
  for (const page of session.historyWindowPages ?? []) count(page.messages)
  sizes.set(session.messages, { initial: session.historyInitialPage, pages: session.historyWindowPages, browse: session.historyBrowseMessages, overlay: session.historyWindowOverlay, bytes })
  return bytes
}
