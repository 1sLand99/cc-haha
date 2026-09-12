import { create } from 'zustand'
import { sessionsApi } from '../api/sessions'
import {
  reviewApi,
  type GitReviewSource,
  type ResolvedReviewSource,
  type ReviewDiffResult,
  type ReviewStatusResult,
  type ReviewWriteResult,
} from '../api/review'
import {
  isWritableReviewSource,
  reviewSourceKey,
  type WorkspaceReviewSource,
} from '../lib/workspace/types'

/**
 * Review content, one entry per (task, comparison).
 *
 * The comparison is part of the key because "unstaged" and "staged" are
 * genuinely different data for the same repository — the old status/diff pair
 * had a single cache and therefore could not show both without one overwriting
 * the other.
 */

/**
 * The comparison an entry describes, as the panel should label it.
 *
 * Wider than `ResolvedReviewSource` because the `turn` entry is not served by
 * the Git review service and must not be re-labelled as one of its sources.
 * `resolvedBase` is declared on the `turn` arm too (always absent) so the union
 * stays a single readable shape for consumers.
 */
export type WorkspaceReviewSourceDescriptor =
  | ResolvedReviewSource
  | { kind: 'turn'; turnKey: string; resolvedBase?: undefined }

export type WorkspaceReviewStatus = Omit<ReviewStatusResult, 'source'> & {
  source: WorkspaceReviewSourceDescriptor
}

export type WorkspaceReviewDiff = Omit<ReviewDiffResult, 'source'> & {
  source: WorkspaceReviewSourceDescriptor
}

/** Why the store declined a write before it reached the network. */
export type WorkspaceReviewRefusalReason =
  /** `branch`, `commit` and `turn` compare against something already written. */
  | 'read_only_source'
  /** No status has been read, so the server's staleness guard would be inert. */
  | 'no_snapshot'
  | 'no_paths'

/**
 * Returned instead of `null` so a refusal is something the caller can render.
 * Shares `state`/`snapshot`/`results` with `ReviewWriteResult` so both arms of
 * the union can be read the same way.
 */
export type WorkspaceReviewRefusal = {
  state: 'refused'
  refusal: WorkspaceReviewRefusalReason
  snapshot: string
  results: []
}

export type WorkspaceReviewWriteOutcome = ReviewWriteResult | WorkspaceReviewRefusal

/**
 * What a revert is about to do, split by outcome, so the confirmation can name
 * the deletion instead of describing everything as "discard changes".
 */
export type WorkspaceReviewRevertPlan = {
  /** Tracked files: Git restores the content and the file stays on disk. */
  revertPaths: string[]
  /**
   * Untracked files: **deleted from disk**. Git has never stored them, so the
   * backup the server writes first is the only copy that survives.
   */
  deletePaths: string[]
  /** Paths the loaded status does not describe; the caller should re-read. */
  unknownPaths: string[]
}

export type WorkspaceReviewEntry = {
  status: WorkspaceReviewStatus | null
  loading: boolean
  error: string | null
  /** Set when a write was rejected because the working tree moved underneath. */
  stale: boolean
  /**
   * The comparison accepts no writes. `branch`/`commit` compare against
   * history and `turn` is not Git data at all; the server refuses all three,
   * and this is what lets the panel stop offering the buttons.
   */
  readOnly: boolean
  diffsByPath: Record<string, WorkspaceReviewDiff | undefined>
  diffLoadingByPath: Record<string, boolean | undefined>
  viewedPaths: string[]
  /** Where the last revert stashed recoverable copies. */
  lastBackupDir: string | null
  /** Paths the last revert deleted from disk rather than restored. */
  lastDeletedPaths: string[]
}

const EMPTY_ENTRY: WorkspaceReviewEntry = {
  status: null,
  loading: false,
  error: null,
  stale: false,
  readOnly: false,
  diffsByPath: {},
  diffLoadingByPath: {},
  viewedPaths: [],
  lastBackupDir: null,
  lastDeletedPaths: [],
}

const EMPTY_READ_ONLY_ENTRY: WorkspaceReviewEntry = { ...EMPTY_ENTRY, readOnly: true }

/**
 * Both are module constants on purpose: `getEntry` is used as a Zustand
 * selector, so returning a freshly built object for an unseen key would make
 * every render produce a new snapshot.
 */
function emptyEntryFor(source: WorkspaceReviewSource): WorkspaceReviewEntry {
  return isWritableReviewSource(source) ? EMPTY_ENTRY : EMPTY_READ_ONLY_ENTRY
}

type WorkspaceReviewStore = {
  byKey: Record<string, WorkspaceReviewEntry | undefined>

  getEntry: (sessionId: string, source: WorkspaceReviewSource) => WorkspaceReviewEntry
  load: (
    sessionId: string,
    source: WorkspaceReviewSource,
    options?: { force?: boolean },
  ) => Promise<void>
  loadDiff: (sessionId: string, source: WorkspaceReviewSource, path: string, oldPath?: string) => Promise<void>
  toggleViewed: (sessionId: string, source: WorkspaceReviewSource, path: string) => void
  /**
   * Classifies the paths a revert would touch, from the status already loaded.
   * Call this before confirming: `deletePaths` is not recoverable from Git.
   */
  describeRevert: (
    sessionId: string,
    source: WorkspaceReviewSource,
    paths: string[],
  ) => WorkspaceReviewRevertPlan
  stage: (sessionId: string, source: WorkspaceReviewSource, paths: string[]) => Promise<WorkspaceReviewWriteOutcome>
  unstage: (sessionId: string, source: WorkspaceReviewSource, paths: string[]) => Promise<WorkspaceReviewWriteOutcome>
  revert: (sessionId: string, source: WorkspaceReviewSource, paths: string[]) => Promise<WorkspaceReviewWriteOutcome>
  clearSession: (sessionId: string) => void
}

/** `turn` history is not Git data and never reaches this service. */
export function toGitReviewSource(source: WorkspaceReviewSource): GitReviewSource | null {
  return source.kind === 'turn' ? null : source
}

function entryKey(sessionId: string, source: WorkspaceReviewSource) {
  return `${sessionId}::${reviewSourceKey(source)}`
}

function refuse(reason: WorkspaceReviewRefusalReason): WorkspaceReviewRefusal {
  return { state: 'refused', refusal: reason, snapshot: '', results: [] }
}

const requests = new Map<string, number>()

function nextRequest(key: string) {
  const next = (requests.get(key) ?? 0) + 1
  requests.set(key, next)
  return next
}

export const useWorkspaceReviewStore = create<WorkspaceReviewStore>((set, get) => ({
  byKey: {},

  getEntry: (sessionId, source) =>
    get().byKey[entryKey(sessionId, source)] ?? emptyEntryFor(source),

  load: async (sessionId, source, options) => {
    const git = toGitReviewSource(source)
    if (!git) return loadSessionChangeStatus(set, get, sessionId, source, options)
    const key = entryKey(sessionId, source)
    const current = get().byKey[key]
    if (current?.status && !options?.force) return

    const request = nextRequest(key)
    const base = emptyEntryFor(source)
    set((state) => ({
      byKey: {
        ...state.byKey,
        [key]: { ...(state.byKey[key] ?? base), loading: true, error: null },
      },
    }))

    try {
      const status = await reviewApi.getStatus(sessionId, git)
      if (requests.get(key) !== request) return
      set((state) => {
        const entry = state.byKey[key] ?? base
        // A new snapshot invalidates every cached diff: the per-file payloads
        // were read against the old one and applying a hunk from them would be
        // applying it to content the user never saw.
        const snapshotChanged = entry.status?.snapshot !== status.snapshot
        return {
          byKey: {
            ...state.byKey,
            [key]: {
              ...entry,
              status,
              loading: false,
              stale: false,
              readOnly: base.readOnly,
              // A read that ended in a terminal state is not "no changes".
              // `missing_workdir` in particular used to arrive with no message
              // at all, and the panel drew a green check over a deleted
              // worktree.
              error: status.error ?? null,
              diffsByPath: snapshotChanged ? {} : entry.diffsByPath,
              diffLoadingByPath: snapshotChanged ? {} : entry.diffLoadingByPath,
            },
          },
        }
      })
    } catch (error) {
      if (requests.get(key) !== request) return
      set((state) => ({
        byKey: {
          ...state.byKey,
          [key]: {
            ...(state.byKey[key] ?? base),
            loading: false,
            error: error instanceof Error ? error.message : 'Failed to load review',
          },
        },
      }))
    }
  },

  loadDiff: async (sessionId, source, path, oldPath) => {
    const git = toGitReviewSource(source)
    if (!git) return loadSessionChangeDiff(set, get, sessionId, source, path)
    const key = entryKey(sessionId, source)
    const existing = get().byKey[key]
    // The in-flight check matters as much as the cache one: a re-render while
    // the first request is open would otherwise issue a second request for the
    // same file, and a large review re-renders on every arriving diff.
    if (existing?.diffsByPath[path] || existing?.diffLoadingByPath[path]) return

    const base = emptyEntryFor(source)
    set((state) => {
      const entry = state.byKey[key] ?? base
      return {
        byKey: {
          ...state.byKey,
          [key]: {
            ...entry,
            diffLoadingByPath: { ...entry.diffLoadingByPath, [path]: true },
          },
        },
      }
    })

    try {
      const diff = await reviewApi.getDiff(sessionId, git, path, oldPath)
      set((state) => {
        const entry = state.byKey[key] ?? base
        // Drop a diff that arrived for a snapshot we have already moved past.
        if (entry.status && diff.snapshot && entry.status.snapshot !== diff.snapshot) {
          return {
            byKey: {
              ...state.byKey,
              [key]: {
                ...entry,
                diffLoadingByPath: { ...entry.diffLoadingByPath, [path]: false },
              },
            },
          }
        }
        return {
          byKey: {
            ...state.byKey,
            [key]: {
              ...entry,
              diffsByPath: { ...entry.diffsByPath, [path]: diff },
              diffLoadingByPath: { ...entry.diffLoadingByPath, [path]: false },
            },
          },
        }
      })
    } catch (error) {
      set((state) => {
        const entry = state.byKey[key] ?? base
        return {
          byKey: {
            ...state.byKey,
            [key]: {
              ...entry,
              diffLoadingByPath: { ...entry.diffLoadingByPath, [path]: false },
              diffsByPath: {
                ...entry.diffsByPath,
                [path]: {
                  state: 'error',
                  source: git,
                  snapshot: entry.status?.snapshot ?? '',
                  path,
                  error: error instanceof Error ? error.message : 'Failed to load diff',
                },
              },
            },
          },
        }
      })
    }
  },

  toggleViewed: (sessionId, source, path) =>
    set((state) => {
      const key = entryKey(sessionId, source)
      const entry = state.byKey[key] ?? emptyEntryFor(source)
      const viewedPaths = entry.viewedPaths.includes(path)
        ? entry.viewedPaths.filter((candidate) => candidate !== path)
        : [...entry.viewedPaths, path]
      return { byKey: { ...state.byKey, [key]: { ...entry, viewedPaths } } }
    }),

  describeRevert: (sessionId, source, paths) => {
    const status = get().byKey[entryKey(sessionId, source)]?.status
    const untracked = new Set(status?.untracked ?? [])
    const known = new Set(status?.files.map((file) => file.path) ?? [])

    const plan: WorkspaceReviewRevertPlan = { revertPaths: [], deletePaths: [], unknownPaths: [] }
    for (const path of paths) {
      if (untracked.has(path)) plan.deletePaths.push(path)
      else if (known.has(path)) plan.revertPaths.push(path)
      else plan.unknownPaths.push(path)
    }
    return plan
  },

  stage: (sessionId, source, paths) => runWrite(set, get, sessionId, source, paths, 'stage'),
  unstage: (sessionId, source, paths) => runWrite(set, get, sessionId, source, paths, 'unstage'),
  revert: (sessionId, source, paths) => runWrite(set, get, sessionId, source, paths, 'revert'),

  clearSession: (sessionId) =>
    set((state) => {
      const prefix = `${sessionId}::`
      for (const key of requests.keys()) {
        if (key.startsWith(prefix)) requests.set(key, (requests.get(key) ?? 0) + 1)
      }
      return {
        byKey: Object.fromEntries(
          Object.entries(state.byKey).filter(([key]) => !key.startsWith(prefix)),
        ),
      }
    }),
}))

async function runWrite(
  set: SetState,
  get: () => WorkspaceReviewStore,
  sessionId: string,
  source: WorkspaceReviewSource,
  paths: string[],
  operation: 'stage' | 'unstage' | 'revert',
): Promise<WorkspaceReviewWriteOutcome> {
  const git = toGitReviewSource(source)
  // `branch`, `commit` and `turn` all describe something already written: a
  // commit, a merge-base, or the session's own record. The server refuses them
  // too; refusing here keeps the request off the wire and gives the caller a
  // reason it can show instead of a silent no-op.
  if (!git || !isWritableReviewSource(source)) return refuse('read_only_source')
  if (paths.length === 0) return refuse('no_paths')

  const key = entryKey(sessionId, source)
  const snapshot = get().byKey[key]?.status?.snapshot
  // Without a snapshot there is nothing to compare against, so the guard that
  // stops a write landing on content the user never saw would be inert.
  if (!snapshot) return refuse('no_snapshot')

  const result = await reviewApi[operation](sessionId, { paths, snapshot, source: git })

  set((state) => {
    const entry = state.byKey[key] ?? emptyEntryFor(source)
    return {
      byKey: {
        ...state.byKey,
        [key]: {
          ...entry,
          stale: result.state === 'stale',
          error: result.state === 'stale' ? null : result.error ?? null,
          status: result.status ?? entry.status,
          // Every write moves the snapshot, so cached diffs are worthless.
          diffsByPath: {},
          diffLoadingByPath: {},
          lastBackupDir: result.backupDir ?? entry.lastBackupDir,
          // Deletions are reported separately from restorations because only
          // one of the two is unrecoverable from Git.
          lastDeletedPaths: result.deletedPaths ?? [],
        },
      },
    }
  })

  return result
}

type SetState = (updater: (state: { byKey: Record<string, WorkspaceReviewEntry | undefined> }) => {
  byKey: Record<string, WorkspaceReviewEntry | undefined>
}) => void

/**
 * The `turn` entry, served by `sessionsApi.getWorkspaceStatus`.
 *
 * **This is not a snapshot of one turn.** `turnKey` is not sent anywhere and
 * nothing here is scoped to a turn. The endpoint returns the workspace's
 * *current* `git status` (every uncommitted change, whoever made it) merged
 * with the files this session is recorded as having touched — the semantics the
 * chat "changed files" card has always had, which §5.4 keeps for that card.
 *
 * It stays because the chat card depends on it, and it is marked read-only
 * because a write carrying these paths would act on the live working tree
 * while the panel claims to be showing session history. The label must not
 * promise a turn comparison either; see `workspace.review.sourceTurn`.
 */
async function loadSessionChangeStatus(
  set: SetState,
  get: () => WorkspaceReviewStore,
  sessionId: string,
  source: WorkspaceReviewSource,
  options?: { force?: boolean },
): Promise<void> {
  const key = entryKey(sessionId, source)
  if (get().byKey[key]?.status && !options?.force) return

  const request = nextRequest(key)
  const base = emptyEntryFor(source)
  const descriptor: WorkspaceReviewSourceDescriptor = source.kind === 'turn'
    ? { kind: 'turn', turnKey: source.turnKey }
    : source

  set((state) => ({
    byKey: { ...state.byKey, [key]: { ...(state.byKey[key] ?? base), loading: true, error: null } },
  }))

  try {
    const result = await sessionsApi.getWorkspaceStatus(sessionId)
    if (requests.get(key) !== request) return
    set((state) => ({
      byKey: {
        ...state.byKey,
        [key]: {
          ...(state.byKey[key] ?? base),
          loading: false,
          readOnly: true,
          error: result.error ?? null,
          status: {
            state: result.state,
            // Reported as what it is. Labelling it `unstaged` claimed a Git
            // comparison this data never ran.
            source: descriptor,
            // No snapshot: there is no Git version token behind this view, so
            // no write could be guarded against it — consistent with the entry
            // being read-only.
            snapshot: '',
            untracked: [],
            files: result.changedFiles.map((file) => ({
              path: file.path,
              ...(file.oldPath ? { oldPath: file.oldPath } : {}),
              status: file.status === 'unknown' ? 'unknown' : file.status,
              additions: file.additions,
              deletions: file.deletions,
              binary: false,
              staged: false,
              unstaged: true,
              conflicted: false,
            })),
            totals: {
              additions: result.changedFiles.reduce((sum, file) => sum + file.additions, 0),
              deletions: result.changedFiles.reduce((sum, file) => sum + file.deletions, 0),
              files: result.changedFiles.length,
            },
          },
        },
      },
    }))
  } catch (error) {
    if (requests.get(key) !== request) return
    set((state) => ({
      byKey: {
        ...state.byKey,
        [key]: {
          ...(state.byKey[key] ?? base),
          loading: false,
          error: error instanceof Error ? error.message : 'Failed to load changes',
        },
      },
    }))
  }
}

/**
 * Per-file diff for the same entry, from `sessionsApi.getWorkspaceDiff`.
 *
 * Same caveat as the status above: this is the live working-tree diff against
 * `HEAD` for that path, not the diff a particular turn produced.
 */
async function loadSessionChangeDiff(
  set: SetState,
  get: () => WorkspaceReviewStore,
  sessionId: string,
  source: WorkspaceReviewSource,
  path: string,
): Promise<void> {
  const key = entryKey(sessionId, source)
  const existing = get().byKey[key]
  if (existing?.diffsByPath[path] || existing?.diffLoadingByPath[path]) return

  const base = emptyEntryFor(source)
  const descriptor: WorkspaceReviewSourceDescriptor = source.kind === 'turn'
    ? { kind: 'turn', turnKey: source.turnKey }
    : source

  set((state) => {
    const entry = state.byKey[key] ?? base
    return {
      byKey: {
        ...state.byKey,
        [key]: { ...entry, diffLoadingByPath: { ...entry.diffLoadingByPath, [path]: true } },
      },
    }
  })

  const result = await sessionsApi.getWorkspaceDiff(sessionId, path).catch((error: unknown) => ({
    state: 'error' as const,
    path,
    error: error instanceof Error ? error.message : 'Failed to load diff',
  }))

  set((state) => {
    const entry = state.byKey[key] ?? base
    return {
      byKey: {
        ...state.byKey,
        [key]: {
          ...entry,
          diffLoadingByPath: { ...entry.diffLoadingByPath, [path]: false },
          diffsByPath: {
            ...entry.diffsByPath,
            [path]: {
              state: result.state === 'ok' ? 'ok' : result.state === 'missing' ? 'missing' : 'error',
              source: descriptor,
              snapshot: '',
              path,
              diff: 'diff' in result ? result.diff : undefined,
              error: result.error,
            },
          },
        },
      },
    }
  })
}
