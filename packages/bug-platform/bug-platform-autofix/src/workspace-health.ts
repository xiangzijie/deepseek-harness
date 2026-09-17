/**
 * Local workspace diagnosis for bug-platform autofix: directory, `.git`, HEAD,
 * clean porcelain, origin hostname vs `gitlab.host`, and aggregation over
 * `autofix: true` workspaces. Does not call GitLab HTTP.
 *
 * @module @deepseek-ai/dsh-bug-platform-autofix/workspace-health
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { RunGit } from './git-workspace.ts'
import type { OperatorWorkspace } from './operator-config.ts'

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

/** Aggregated health for every `autofix: true` workspace. */
export type AutofixWorkspacesHealth = {
  /** True when every inspected workspace passed. */
  ok: boolean
  /** Operator-facing `id: 原因` lines; empty when {@link AutofixWorkspacesHealth.ok} is true. */
  lines: string[]
}

/** Inputs for {@link inspectAutofixWorkspaces}. */
export type InspectAutofixWorkspacesOptions = {
  /** Operator workspaces; only `autofix: true` entries are inspected. */
  workspaces: readonly OperatorWorkspace[]
  /** GitLab origin from operator.yaml `gitlab.host`. */
  gitlabHost: string
  /** Injectable git runner forwarded to {@link inspectWorkspace}. */
  runGit: RunGit
  /**
   * Test hook: replace {@link inspectWorkspace}. Production omits this and
   * uses the real inspector.
   */
  inspectOne?: (opts: InspectWorkspaceOptions) => Promise<WorkspaceHealthReport>
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
 * Inspect every `autofix: true` workspace and collect `id: 原因` lines.
 * `autofix: false` workspaces are not inspected.
 * @param opts - workspaces, gitlab host, git runner, optional inspect hook.
 * @returns `{ ok, lines }` — `ok` is false when any inspected workspace failed.
 */
export async function inspectAutofixWorkspaces(
  opts: InspectAutofixWorkspacesOptions,
): Promise<AutofixWorkspacesHealth> {
  const inspectOne = opts.inspectOne ?? inspectWorkspace
  const lines: string[] = []
  let ok = true
  for (const ws of opts.workspaces) {
    if (ws.autofix !== true) continue
    const report = await inspectOne({
      localRoot: ws.localRoot,
      productBranch: ws.productBranch,
      gitlabHost: opts.gitlabHost,
      gitlabProjectId: ws.gitlabProjectId,
      runGit: opts.runGit,
    })
    if (report.ok) continue
    ok = false
    for (const reason of report.reasons) {
      lines.push(`${ws.id}: ${reason}`)
    }
  }
  return { ok, lines }
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
