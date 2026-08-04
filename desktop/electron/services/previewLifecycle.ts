import { isDocumentReplacingNavigation } from './rendererNavigation'
import type { NavigatingWebContents } from './rendererNavigation'

export type PreviewCleanupWebContents = NavigatingWebContents

export function installPreviewCleanupOnRendererNavigation(
  webContents: PreviewCleanupWebContents,
  closePreview: () => void,
): void {
  webContents.on('did-start-navigation', (details, _url, isInPlace, isMainFrame) => {
    if (!isDocumentReplacingNavigation(details, isInPlace, isMainFrame)) return
    closePreview()
  })
}
