/**
 * Per-worktree Git helpers for bug-platform autofix: assert the bound product
 * jinan (or an existing `bugfix/<id>`), keep the tree clean, create the
 * ticket branch, commit, push, and list changed paths. Callers inject
 * {@link RunGit} in tests; production uses the default `git` exec.
 *
 * @module @deepseek-ai/dsh-bug-platform-autofix/git-workspace
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Absolute local roots for the three product worktrees (same remote). */
export type WorkspaceRoots = {
  custom: string
  ailpha: string
  /** Present for mapping completeness; phase-1 edits must not target home. */
  home: string
}

/**
 * Run `git` with `args` in `cwd` and return trimmed stdout.
 * @param cwd - repository working directory.
 * @param args - git argv after `git`.
 * @returns command stdout (may include a trailing newline from git).
 */
export type RunGit = (cwd: string, args: readonly string[]) => Promise<string>

/**
 * Default {@link RunGit}: `git` via `execFile` with UTF-8 stdout.
 * @param cwd - repository working directory.
 * @param args - git argv after `git`.
 * @returns stdout string from git.
 */
export async function defaultRunGit(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', [...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  })
  return stdout
}

function resolveRunGit(runGit: RunGit | undefined): RunGit {
  return runGit ?? defaultRunGit
}

async function currentBranch(localRoot: string, runGit: RunGit): Promise<string> {
  const out = await runGit(localRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])
  return out.trim()
}

/**
 * Assert HEAD is the worktree's bound product jinan, or any `bugfix/<digits>`
 * branch. Hard-fails when HEAD is a different `*-jinan` product branch (same
 * remote, wrong worktree checkout).
 * @param localRoot - absolute path of the product worktree.
 * @param expectedJinan - bound product branch, e.g. `dkh-ailpha-jinan`.
 * @param runGit - optional injectable git runner.
 */
export async function assertProductBranch(
  localRoot: string,
  expectedJinan: string,
  runGit?: RunGit,
): Promise<void> {
  const git = resolveRunGit(runGit)
  const branch = await currentBranch(localRoot, git)
  if (branch === expectedJinan) return
  if (/^bugfix\/\d+$/.test(branch)) return
  if (/-jinan$/.test(branch) && branch !== expectedJinan) {
    throw new Error(
      `wrong product jinan in ${localRoot}: HEAD is ${branch}, expected ${expectedJinan}`,
    )
  }
  throw new Error(
    `unexpected branch in ${localRoot}: HEAD is ${branch}, expected ${expectedJinan} or bugfix/<id>`,
  )
}

/**
 * Assert `git status --porcelain` is empty.
 * @param localRoot - absolute path of the product worktree.
 * @param runGit - optional injectable git runner.
 */
export async function assertClean(localRoot: string, runGit?: RunGit): Promise<void> {
  const git = resolveRunGit(runGit)
  const status = (await git(localRoot, ['status', '--porcelain'])).trim()
  if (status !== '') {
    throw new Error(`worktree is dirty in ${localRoot}:\n${status}`)
  }
}

/**
 * Ensure `bugfix/<ticketId>` exists and is checked out. Reuses HEAD when
 * already on that branch; checks out an existing branch; otherwise creates it
 * from the current HEAD (`checkout -b`).
 * @param localRoot - absolute path of the product worktree.
 * @param ticketId - platform ticket id.
 * @param runGit - optional injectable git runner.
 * @returns the branch name `bugfix/<ticketId>`.
 */
export async function createBugfixBranch(
  localRoot: string,
  ticketId: number,
  runGit?: RunGit,
): Promise<string> {
  const git = resolveRunGit(runGit)
  const branch = `bugfix/${ticketId}`
  const head = await currentBranch(localRoot, git)
  if (head === branch) return branch

  const listed = (await git(localRoot, ['branch', '--list', branch])).trim()
  if (listed !== '') {
    await git(localRoot, ['checkout', branch])
  } else {
    await git(localRoot, ['checkout', '-b', branch])
  }
  return branch
}

/**
 * Stage all changes (`git add -A`), commit with `message`, and return HEAD sha.
 * @param localRoot - absolute path of the product worktree.
 * @param message - commit message.
 * @param runGit - optional injectable git runner.
 * @returns the new HEAD commit sha.
 */
export async function commitAll(
  localRoot: string,
  message: string,
  runGit?: RunGit,
): Promise<string> {
  const git = resolveRunGit(runGit)
  await git(localRoot, ['add', '-A'])
  await git(localRoot, ['commit', '-m', message])
  return (await git(localRoot, ['rev-parse', 'HEAD'])).trim()
}

/**
 * Push `branch` to `origin` with upstream tracking (`git push -u origin <branch>`).
 * @param localRoot - absolute path of the product worktree.
 * @param branch - local branch name to push.
 * @param runGit - optional injectable git runner.
 */
export async function pushBranch(
  localRoot: string,
  branch: string,
  runGit?: RunGit,
): Promise<void> {
  const git = resolveRunGit(runGit)
  await git(localRoot, ['push', '-u', 'origin', branch])
}

/**
 * List changed paths from `git status --porcelain` (staged, unstaged, untracked).
 * @param localRoot - absolute path of the product worktree.
 * @param runGit - optional injectable git runner.
 * @returns relative paths; empty when the worktree matches HEAD with no untracked files.
 */
export async function listChangedFiles(
  localRoot: string,
  runGit?: RunGit,
): Promise<string[]> {
  const git = resolveRunGit(runGit)
  const status = await git(localRoot, ['status', '--porcelain'])
  return parsePorcelainPaths(status)
}

/**
 * Parse `git status --porcelain` lines into path strings (uses the new path on renames).
 * @param status - porcelain stdout.
 * @returns relative file paths in status order.
 */
function parsePorcelainPaths(status: string): string[] {
  const paths: string[] = []
  for (const line of status.split('\n')) {
    if (line.trim() === '') continue
    // XY<space>path  or  XY<space>old -> new
    const rest = line.slice(3)
    const arrow = rest.lastIndexOf(' -> ')
    paths.push(arrow === -1 ? rest : rest.slice(arrow + 4))
  }
  return paths
}
