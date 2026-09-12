import { useActivityPanelStore } from '../../stores/activityPanelStore'
import { useWorkspaceContentStore } from '../../stores/workspaceContentStore'
import { useWorkspaceReviewStore } from '../../stores/workspaceReviewStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'

/**
 * Release everything a task owns: its PTYs, its pages, its cached content and
 * its review state.
 *
 * This exists because "the task went away" has more than one entry point. The
 * tab strip's close was the only one wired up, so deleting a session from the
 * sidebar — single or batch — left its shells running and its pages alive for
 * the life of the app, and kept writing its tabs to disk forever for a session
 * that could never be reopened to clean them up.
 *
 * Switching away from a task deliberately does NOT come here.
 */
export function releaseWorkspaceSession(sessionId: string): void {
  useWorkspaceStore.getState().clearSession(sessionId)
  useWorkspaceContentStore.getState().clearSession(sessionId)
  useWorkspaceReviewStore.getState().clearSession(sessionId)
  useActivityPanelStore.getState().close(sessionId)
}
