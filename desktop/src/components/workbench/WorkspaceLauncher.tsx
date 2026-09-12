import { FolderClosed, Globe, SquareTerminal, SquareSplitVertical } from 'lucide-react'
import { useTranslation } from '../../i18n'
import {
  detectPlatform,
  formatWorkspaceShortcut,
  type WorkspaceShortcutAction,
} from '../../lib/workspace/shortcuts'
import type { WorkspaceTabKind } from '../../lib/workspace/types'

type LauncherEntry = {
  kind: WorkspaceTabKind
  labelKey: 'workspace.launcher.review' | 'workspace.launcher.terminal' | 'workspace.launcher.browser' | 'workspace.launcher.files'
  shortcut: WorkspaceShortcutAction
  Icon: typeof Globe
}

/**
 * Order matches the reference: review, terminal, browser, files. It is not
 * alphabetical and not usage-ranked — it runs from "look at what changed" to
 * "look at anything", which is the order the work itself tends to go in.
 */
const ENTRIES: readonly LauncherEntry[] = [
  { kind: 'review', labelKey: 'workspace.launcher.review', shortcut: 'open-review', Icon: SquareSplitVertical },
  { kind: 'terminal', labelKey: 'workspace.launcher.terminal', shortcut: 'toggle-bottom-panel', Icon: SquareTerminal },
  { kind: 'browser', labelKey: 'workspace.launcher.browser', shortcut: 'new-browser-tab', Icon: Globe },
  { kind: 'file', labelKey: 'workspace.launcher.files', shortcut: 'quick-open-file', Icon: FolderClosed },
]

export type WorkspaceLauncherProps = {
  onSelect: (kind: WorkspaceTabKind) => void
  /**
   * Kinds this dock can actually hold. The bottom dock takes terminals only, and
   * offering it a browser would quietly open the page in the *side* panel — an
   * entry point to a state the user did not ask for.
   */
  kinds?: readonly WorkspaceTabKind[]
  /**
   * Why review cannot run here, if it cannot. A directory that is not a Git
   * repository still shows the entry — disabled with the reason — rather than
   * hiding it, so the absence reads as a fact about the folder instead of as a
   * missing feature.
   */
  reviewUnavailableReason?: string | null
}

export function WorkspaceLauncher({
  onSelect,
  reviewUnavailableReason,
  kinds,
}: WorkspaceLauncherProps) {
  const t = useTranslation()
  const platform = detectPlatform()
  const entries = kinds ? ENTRIES.filter((entry) => kinds.includes(entry.kind)) : ENTRIES

  return (
    <div
      data-testid="workspace-launcher"
      className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 py-10"
    >
      <ul className="w-full max-w-[520px] space-y-0.5" aria-label={t('workspace.launcher.label')}>
        {entries.map(({ kind, labelKey, shortcut, Icon }) => {
          const disabledReason = kind === 'review' ? reviewUnavailableReason ?? null : null
          const hint = formatWorkspaceShortcut(shortcut, platform)
          return (
            <li key={kind}>
              <button
                type="button"
                data-testid={`workspace-launcher-${kind}`}
                disabled={disabledReason !== null}
                title={disabledReason ?? undefined}
                onClick={() => onSelect(kind)}
                className="group flex w-full items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
              >
                <Icon
                  size={16}
                  strokeWidth={1.9}
                  aria-hidden="true"
                  className="shrink-0 text-[var(--color-text-tertiary)]"
                />
                <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--color-text-primary)]">
                  {t(labelKey)}
                </span>
                {disabledReason ? (
                  <span className="shrink-0 text-[11px] text-[var(--color-text-tertiary)]">
                    {disabledReason}
                  </span>
                ) : hint ? (
                  <kbd className="shrink-0 rounded-[var(--radius-sm)] bg-[var(--color-surface-container)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--color-text-tertiary)]">
                    {hint}
                  </kbd>
                ) : null}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
