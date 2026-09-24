/**
 * Fail-open Git sync for the lessons warehouse: fast-forward pull, commit/push,
 * and porcelain dirty checks. Callers inject {@link RunGit} in tests.
 *
 * @module @deepseek-ai/dsh-bug-platform-autofix/lesson-sync
 */

import type { RunGit } from './git-workspace.ts'

/** Successful lesson sync operation (no payload). */
export type LessonSyncOk = { ok: true }

/** Failed lesson sync operation with a caller-safe message. */
export type LessonSyncErr = { ok: false; error: string }

/** Result of {@link pullLessonsFf}, {@link requireLessonsHeadMain}, or {@link commitAndPushLessons}. */
export type LessonSyncResult = LessonSyncOk | LessonSyncErr

/**
 * Normalize caught values into an error string for {@link LessonSyncErr}.
 * @param error - thrown value from git.
 * @returns message for Errors, otherwise `String(error)`.
 */
function lessonSyncErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Fetch `origin` and fast-forward pull `origin/main` in the lessons repo.
 * Never throws; git failures return `{ ok: false, error }`.
 * @param options - lessons repo root and git runner.
 * @param options.localRoot - absolute path of the lessons git worktree.
 * @param options.runGit - git command injector.
 * @returns `{ ok: true }` or `{ ok: false, error }`.
 */
export async function pullLessonsFf(options: {
  localRoot: string
  runGit: RunGit
}): Promise<LessonSyncResult> {
  const { localRoot, runGit } = options
  try {
    await runGit(localRoot, ['fetch', 'origin'])
    await runGit(localRoot, ['pull', '--ff-only', 'origin', 'main'])
    return { ok: true }
  } catch (error) {
    return { ok: false, error: lessonSyncErrorMessage(error) }
  }
}

/**
 * Refuse lesson writes unless the clone HEAD is `main`. Never throws.
 * {@link pullLessonsFf} does not call this, so fast-forward pull may still run off-main.
 * @param options - lessons repo root and git runner.
 * @param options.localRoot - absolute path of the lessons git worktree.
 * @param options.runGit - git command injector.
 * @returns `{ ok: true }` when HEAD is `main`; `{ ok: false, error }` with a Chinese message otherwise.
 */
export async function requireLessonsHeadMain(options: {
  localRoot: string
  runGit: RunGit
}): Promise<LessonSyncResult> {
  const { localRoot, runGit } = options
  try {
    const head = (await runGit(localRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
    if (head === 'main') {
      return { ok: true }
    }
    return { ok: false, error: `经验仓当前不在 main 分支（HEAD 为 ${head}）` }
  } catch (error) {
    return { ok: false, error: lessonSyncErrorMessage(error) }
  }
}

/**
 * Stage all changes, commit with `message`, and push `origin main`.
 * Refuses when HEAD is not `main` (no add/commit/push). Never throws; git failures return `{ ok: false, error }`.
 * @param options - lessons repo root, commit message, and git runner.
 * @param options.localRoot - absolute path of the lessons git worktree.
 * @param options.message - full `git commit -m` message.
 * @param options.runGit - git command injector.
 * @returns `{ ok: true }` or `{ ok: false, error }`.
 */
export async function commitAndPushLessons(options: {
  localRoot: string
  message: string
  runGit: RunGit
}): Promise<LessonSyncResult> {
  const { localRoot, message, runGit } = options
  const head = await requireLessonsHeadMain({ localRoot, runGit })
  if (!head.ok) {
    return head
  }
  try {
    await runGit(localRoot, ['add', '-A'])
    await runGit(localRoot, ['commit', '-m', message])
    await runGit(localRoot, ['push', 'origin', 'main'])
    return { ok: true }
  } catch (error) {
    return { ok: false, error: lessonSyncErrorMessage(error) }
  }
}

/**
 * Whether the lessons worktree has uncommitted changes (`git status --porcelain`).
 * When status cannot be read, returns `true` so callers avoid unsafe writes.
 * @param options - lessons repo root and git runner.
 * @param options.localRoot - absolute path of the lessons git worktree.
 * @param options.runGit - git command injector.
 * @returns `true` if porcelain is non-empty after trim, or status failed.
 */
export async function lessonsWorkingTreeDirty(options: {
  localRoot: string
  runGit: RunGit
}): Promise<boolean> {
  const { localRoot, runGit } = options
  try {
    const porcelain = await runGit(localRoot, ['status', '--porcelain'])
    return porcelain.trim().length > 0
  } catch {
    // porcelain unavailable — assume dirty (fail-closed for writes).
    return true
  }
}
