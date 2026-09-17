/**
 * Process-level check that the global skill clone is safe to inject as forced
 * brief text: no uncommitted force files, and HEAD matches origin of the
 * protected branch unless the operator opts into a stale revision.
 *
 * @module @deepseek-ai/dsh-bug-platform-autofix/skill-sync
 */

import { existsSync } from 'node:fs'
import type { RunGit } from './git-workspace.ts'

/** Inputs for {@link assertGlobalSkillsRunnable}. */
export interface AssertGlobalSkillsRunnableOptions {
  /** Local clone root that contains `manifest.yaml` and `skills/`. */
  globalLocal: string
  /** `force: true` skill names that would be injected this run. */
  forceNames: readonly string[]
  /**
   * When true, a HEAD that does not match `origin/<protectedBranch>` is allowed.
   * Dirty `manifest.yaml` or force skill files still refuse.
   */
  allowStaleRevision: boolean
  /** Remote branch compared to HEAD. Defaults to `main`. */
  protectedBranch?: string
  /** Injectable git runner; production passes `defaultRunGit`. */
  runGit: RunGit
  /**
   * Test hook: skip a real `existsSync(globalLocal)` when set.
   * `true` pretends the directory exists; `false` forces the missing-dir failure.
   */
  directoryExists?: boolean
}

/**
 * Refuse to start a run that would inject uncommitted or unsynced force skills.
 * Callers with no `force: true` names skip the check (including a missing clone).
 * @param options - clone root, force names, stale-revision flag, optional git runner.
 * @returns nothing when the clone may be used for forced injection.
 * @throws {Error} when the clone is missing and `forceNames` is non-empty, when
 *   porcelain includes `manifest.yaml` or a force skill path (even if
 *   `allowStaleRevision` is true), or when HEAD does not match
 *   `origin/<protectedBranch>` and `allowStaleRevision` is not true.
 */
export async function assertGlobalSkillsRunnable(
  options: AssertGlobalSkillsRunnableOptions,
): Promise<void> {
  const {
    globalLocal,
    forceNames,
    allowStaleRevision,
    protectedBranch = 'main',
    runGit,
  } = options
  if (forceNames.length === 0) return

  const dirExists = options.directoryExists ?? existsSync(globalLocal)
  if (!dirExists) {
    throw new Error(`全局 skill 仓不存在，无法加载强制 skill: ${globalLocal}`)
  }

  const porcelain = await runGit(globalLocal, ['status', '--porcelain'])
  const dirty = dirtyProtectedPaths(porcelain, forceNames)
  if (dirty.length > 0) {
    throw new Error(`未合入的强制 skill 草稿不得开跑: ${dirty.join(', ')}`)
  }

  if (allowStaleRevision === true) return

  const head = (await runGit(globalLocal, ['rev-parse', 'HEAD'])).trim()
  const originRef = `origin/${protectedBranch}`
  const origin = (await runGit(globalLocal, ['rev-parse', originRef])).trim()
  if (head !== origin) {
    throw new Error(`请先同步全局 skill（HEAD 与 ${originRef} 不一致）`)
  }
}

/**
 * Collect porcelain paths that are `manifest.yaml` or a forced skill file.
 * @param porcelain - `git status --porcelain` stdout.
 * @param forceNames - forced skill names.
 * @returns matching relative paths in status order.
 */
function dirtyProtectedPaths(porcelain: string, forceNames: readonly string[]): string[] {
  const protectedPaths = protectedRelativePaths(forceNames)
  const dirty: string[] = []
  for (const path of parsePorcelainPaths(porcelain)) {
    if (protectedPaths.has(path)) dirty.push(path)
  }
  return dirty
}

/**
 * Relative paths whose dirty porcelain must refuse a run.
 * @param forceNames - forced skill names.
 * @returns `manifest.yaml` plus bundled and flat skill markdown paths.
 */
function protectedRelativePaths(forceNames: readonly string[]): Set<string> {
  const paths = new Set<string>(['manifest.yaml'])
  for (const name of forceNames) {
    paths.add(`skills/${name}/SKILL.md`)
    paths.add(`skills/${name}.md`)
  }
  return paths
}

/**
 * Parse `git status --porcelain` lines into path strings (uses the new path on renames).
 * @param status - porcelain stdout.
 * @returns relative file paths with `/` separators, in status order.
 */
function parsePorcelainPaths(status: string): string[] {
  const paths: string[] = []
  for (const line of status.split('\n')) {
    if (line.trim() === '') continue
    const rest = line.slice(3)
    const arrow = rest.lastIndexOf(' -> ')
    const raw = arrow === -1 ? rest : rest.slice(arrow + 4)
    paths.push(raw.replaceAll('\\', '/'))
  }
  return paths
}
