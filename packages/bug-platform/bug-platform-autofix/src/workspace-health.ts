/**
 * Local workspace diagnosis for bug-platform autofix: directory, `.git`, HEAD,
 * clean porcelain, and origin hostname vs `gitlab.host`. Does not call GitLab HTTP.
 *
 * @module @deepseek-ai/dsh-bug-platform-autofix/workspace-health
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { RunGit } from './git-workspace.ts'

/** Result of {@link inspectWorkspace}. */
export type WorkspaceHealthReport = {
  /** True when every check passed. */
  ok: boolean
  /** Chinese failure reasons; empty when {@link WorkspaceHealthReport.ok} is true. */
  reasons: string[]
}

/** Inputs for {@link inspectWorkspace}. */
export type InspectWorkspaceOptions = {
  /** Absolute path of the product worktree. */
  localRoot: string
  /** Bound product baseline branch, e.g. `dkh-custom-jinan`. */
  productBranch: string
  /** GitLab origin from operator.yaml `gitlab.host` (scheme + host). */
  gitlabHost: string
  /**
   * Numeric GitLab project id for this workspace. Recorded by callers; this
   * function does not query GitLab HTTP.
   */
  gitlabProjectId: number
  /** Injectable git runner (tests and production share this slot). */
  runGit: RunGit
  /**
   * Test hook: skip a real `existsSync(localRoot)` when set.
   * `true` pretends the directory exists; `false` forces the missing-dir reason.
   */
  directoryExists?: boolean
  /**
   * Test hook: skip a real `existsSync(.git)` when set.
   * `true` pretends `.git` exists; `false` forces the missing-git reason.
   */
  isGit?: boolean
}

const BUGFIX_HEAD = /^bugfix\/\d+$/

/**
 * Diagnose one local product workspace without calling the GitLab HTTP API.
 * @param opts - workspace path, expected branch, gitlab host, git runner, optional test hooks.
 * @returns `{ ok, reasons }` — `reasons` are Chinese operator-facing lines.
 */
export async function inspectWorkspace(
  opts: InspectWorkspaceOptions,
): Promise<WorkspaceHealthReport> {
  void opts.gitlabProjectId
  const reasons: string[] = []
  const dirExists = opts.directoryExists ?? existsSync(opts.localRoot)
  if (!dirExists) {
    return { ok: false, reasons: ['目录不存在'] }
  }

  const gitExists = opts.isGit ?? existsSync(join(opts.localRoot, '.git'))
  if (!gitExists) {
    return { ok: false, reasons: ['不是 git 仓库（缺少 .git）'] }
  }

  const head = await readGitLine(opts.runGit, opts.localRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (head.ok) {
    if (head.value !== opts.productBranch && !BUGFIX_HEAD.test(head.value)) {
      reasons.push(
        `HEAD 为 ${head.value}，期望 ${opts.productBranch} 或 bugfix/<工单号>`,
      )
    }
  } else {
    reasons.push(`无法读取 HEAD：${head.error}`)
  }

  const status = await readGitLine(opts.runGit, opts.localRoot, ['status', '--porcelain'])
  if (status.ok) {
    if (status.value !== '') {
      reasons.push('工作区有未提交变更')
    }
  } else {
    reasons.push(`无法读取 git status：${status.error}`)
  }

  const origin = await readGitLine(opts.runGit, opts.localRoot, ['remote', 'get-url', 'origin'])
  if (origin.ok) {
    const originHost = hostnameFromGitRemote(origin.value)
    const gitlabHost = hostnameFromConfiguredHost(opts.gitlabHost)
    if (originHost === null || gitlabHost === null || originHost !== gitlabHost) {
      reasons.push(`origin 与 gitlab.host 不一致（origin=${origin.value}，host=${opts.gitlabHost}）`)
    }
  } else {
    reasons.push(`无法读取 origin：${origin.error}`)
  }

  return { ok: reasons.length === 0, reasons }
}

/**
 * Run git and return trimmed stdout, or a string error when the command rejects.
 * @param runGit - git runner.
 * @param cwd - repository working directory.
 * @param args - git argv after `git`.
 * @returns ok value or error text.
 */
async function readGitLine(
  runGit: RunGit,
  cwd: string,
  args: readonly string[],
): Promise<{ ok: true; value: string } | { ok: false; error: string }> {
  try {
    const out = await runGit(cwd, args)
    return { ok: true, value: out.trim() }
  } catch (error) {
    return { ok: false, error: errorMessage(error) }
  }
}

/**
 * Extract a hostname from `git remote get-url` (scp-like SSH or URL).
 * Username is ignored; comparison is case-insensitive.
 * @param remoteUrl - origin URL, e.g. `git@host:group/repo.git` or `https://user@host/path`.
 * @returns lowercase hostname, or null when unparseable.
 */
function hostnameFromGitRemote(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim()
  if (trimmed.length === 0) {
    return null
  }
  if (trimmed.includes('://')) {
    return hostnameFromUrl(trimmed)
  }
  const scp = /^(?:[^@]+@)?([^:]+):/
  const match = scp.exec(trimmed)
  if (match?.[1] === undefined) {
    return null
  }
  return match[1].toLowerCase()
}

/**
 * Extract a hostname from operator.yaml `gitlab.host`.
 * @param host - configured host, with or without a URI scheme.
 * @returns lowercase hostname, or null when unparseable.
 */
function hostnameFromConfiguredHost(host: string): string | null {
  const trimmed = host.trim()
  if (trimmed.length === 0) {
    return null
  }
  const withScheme = trimmed.includes('://') ? trimmed : `https://${trimmed}`
  return hostnameFromUrl(withScheme)
}

/**
 * Parse a URL and return its hostname.
 * @param value - absolute URL string.
 * @returns lowercase hostname, or null when `URL` rejects the string.
 */
function hostnameFromUrl(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase()
  } catch {
    // Invalid absolute URL: treat as unparseable rather than throwing to the operator.
    return null
  }
}

/**
 * @param error - unknown thrown value.
 * @returns stable string for a health reason.
 */
function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
