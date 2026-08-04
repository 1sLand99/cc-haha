/**
 * Deciding whether a `did-start-navigation` event actually replaces the renderer
 * document.
 *
 * Electron has carried this signature in two shapes: the modern one puts
 * `isMainFrame` / `isSameDocument` on the details object, the older one passes
 * `isInPlace` and `isMainFrame` as trailing positional arguments. Anything that
 * cleans up renderer-owned resources has to read both, and getting it wrong fails
 * quietly — either the cleanup never fires, or it fires on every in-page route
 * change and tears down live resources.
 *
 * That is subtle enough to be worth exactly one implementation. The preview and the
 * terminal service both anchor on this predicate rather than each spelling it out.
 */

export type NavigationDetails = {
  isSameDocument?: boolean
  isMainFrame?: boolean
}

export type NavigatingWebContents = {
  on(
    event: 'did-start-navigation',
    handler: (
      details: NavigationDetails,
      url?: string,
      isInPlace?: boolean,
      isMainFrame?: boolean,
    ) => void,
  ): unknown
}

/**
 * True when the top-level document is being replaced — a reload, a location
 * assignment, a back/forward entry. False for same-document (hash, history.pushState)
 * navigation and for subframes, neither of which discards renderer state.
 */
export function isDocumentReplacingNavigation(
  details: NavigationDetails,
  isInPlace?: boolean,
  isMainFrame?: boolean,
): boolean {
  const mainFrame = details.isMainFrame ?? isMainFrame === true
  if (!mainFrame) return false
  const sameDocument = details.isSameDocument ?? isInPlace === true
  return !sameDocument
}
