/**
 * End-to-end orchestrator for one ticket / one batch (design §3).
 * Mapping is resolved before any `处理中` claim; home / unmapped /
 * {@link EXCLUDED_TARGET_MENU} never claim.
 *
 * @module @deepseek-ai/dsh-bug-platform-autofix/orchestrator
 */

import { mkdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type {
  BugAttachment,
  BugPlatformClient,
  BugTicketDetail,
} from '@deepseek-ai/dsh-bug-platform-http'
import { buildAgentBrief } from './agent-brief.ts'
import {
  assertClean,
  assertProductBranch,
  commitAll,
  createBugfixBranch,
  listChangedFiles,
  pushBranch,
  type RunGit,
  type WorkspaceRoots,
} from './git-workspace.ts'
import {
  addMergeRequestNote,
  ensureMergeRequest,
  GitlabTokenMissingError,
  type AddMergeRequestNoteOptions,
  type CreateMergeRequestOptions,
  type EnsuredMergeRequest,
} from './gitlab-mr.ts'
import {
  resolveMenu,
  type MenuMappingIndex,
  type ResolvedMenu,
} from './menu-mapping.ts'
import type { AgentRunner } from './run-agent.ts'
import { EXCLUDED_TARGET_MENU, selectTickets } from './select.ts'
import type { TicketPhase, TicketStateStore } from './ticket-state.ts'

/** Fixed product jinan branch names for the three worktrees. */
export type ProductBranches = {
  custom: string
  ailpha: string
  home: string
}

/** GitLab project settings for optional MR creation. */
export type OrchestratorGitlabConfig = {
  host: string
  projectId: number
  token?: string | null
}

/** Optional lint hook used only when {@link OrchestratorConfig.lintEnabled} is true. */
export type LintRunner = (opts: {
  cwd: string
  files: readonly string[]
}) => Promise<{ ok: boolean; summary: string }>

/** Client methods the orchestrator needs (full client or a test fake). */
export type OrchestratorClient = Pick<
  BugPlatformClient,
  'ensureToken' | 'listTickets' | 'getTicket' | 'createFollowup' | 'downloadToFile'
>

/** Injectable orchestration config. */
export interface OrchestratorConfig {
  client: OrchestratorClient
  menuIndex: MenuMappingIndex
  stateStore: TicketStateStore
  workspaceRoots: WorkspaceRoots
  productBranches: ProductBranches
  gitlab: OrchestratorGitlabConfig
  /** Parent directory for per-ticket asset folders (`<assetsDir>/<id>/`). */
  assetsDir: string
  /** Default `false`: skip lint. */
  lintEnabled?: boolean
  /** Default `false`: skip full build. */
  buildEnabled?: boolean
  agentRunner: AgentRunner
  runGit?: RunGit
  /**
   * Create or reuse an MR for `bugfix/<id>`. Defaults to {@link ensureMergeRequest}.
   * Prefer this over a bare create so a second autofix pass does not fail on 409.
   */
  ensureMr?: (opts: CreateMergeRequestOptions) => Promise<EnsuredMergeRequest>
  /** Post an MR discussion note; defaults to {@link addMergeRequestNote}. */
  addMrNote?: (opts: AddMergeRequestNoteOptions) => Promise<void>
  /** Invoked only when `lintEnabled` is true. */
  lintRunner?: LintRunner
  /** When true (default), write an optional skip followup for unmapped/home. */
  writeSkipFollowup?: boolean
  /** Platform project id for list/get; defaults to `47`. */
  projectId?: number
}

/** Outcome of {@link runOneTicket}. */
export type TicketOutcome =
  | { kind: 'skipped'; reason: string }
  | { kind: 'done'; mrUrl: string }
  | { kind: 'awaiting_push'; branch: string; commitSha: string }
  | { kind: 'failed'; reason: string }

/** Options for {@link runBatch}. */
export interface RunBatchOptions {
  /** Max tickets to attempt in this batch; defaults to `1`. */
  maxTickets?: number
  /** Comma-separated list status filter; defaults to `待确认,验证未通过`. */
  status?: string
}

const DEFAULT_PROJECT_ID = 47
const DEFAULT_LIST_STATUS = '待确认,验证未通过'

/**
 * Run the §3 state machine for one ticket.
 * Pass a preloaded {@link BugTicketDetail} to force a ticket (e.g. `--ticket 428`)
 * without going through the list status whitelist.
 * @param config - injectable client, mapping, git, agent, gitlab.
 * @param ticketIdOrDetail - platform id or already-loaded detail.
 * @returns terminal outcome for this ticket.
 */
export async function runOneTicket(
  config: OrchestratorConfig,
  ticketIdOrDetail: number | BugTicketDetail,
): Promise<TicketOutcome> {
  const detail =
    typeof ticketIdOrDetail === 'number'
      ? await config.client.getTicket(ticketIdOrDetail)
      : ticketIdOrDetail

  const targetMenu = detail.target_menu
  if (targetMenu === EXCLUDED_TARGET_MENU) {
    const reason = `排除菜单：${EXCLUDED_TARGET_MENU}，保持原状态`
    if (config.writeSkipFollowup !== false) {
      await config.client.createFollowup(detail.id, {
        content: reason,
        status_change: null,
        assignee_change: null,
      })
    }
    return { kind: 'skipped', reason }
  }

  const resolved =
    targetMenu === null ? null : resolveMenu(config.menuIndex, targetMenu)

  if (resolved === null) {
    const reason = skipReason(config.menuIndex, targetMenu)
    if (config.writeSkipFollowup !== false) {
      await config.client.createFollowup(detail.id, {
        content: reason,
        status_change: null,
        assignee_change: null,
      })
    }
    return { kind: 'skipped', reason }
  }

  const localRoot = config.workspaceRoots[resolved.repo]
  const expectedJinan = config.productBranches[resolved.repo]
  const branchName = `bugfix/${detail.id}`
  const routesFile = resolved.repo === 'custom' ? 'src/routes.js' : 'src/commonRoutes.js'
  const prior = config.stateStore.get(detail.id)
  const isReprocess =
    prior !== undefined &&
    (prior.phase === 'done' || prior.phase === 'awaiting_push' || prior.phase === 'failed')

  await config.client.createFollowup(detail.id, {
    content: isReprocess
      ? '自动修复重新处理开始：再次改为处理中（不改指派）'
      : '自动修复开始：已领单，状态改为处理中（不改指派）',
    status_change: '处理中',
    assignee_change: null,
  })
  upsertPhase(config, {
    ticketId: detail.id,
    phase: 'claimed',
    repo: resolved.repo,
    branch: branchName,
  })

  const { screenshotPaths, missingAssets } = await downloadAssets(config, detail)

  try {
    await assertProductBranch(localRoot, expectedJinan, config.runGit)
    await assertClean(localRoot, config.runGit)
    await createBugfixBranch(localRoot, detail.id, expectedJinan, config.runGit)
  } catch (error) {
    const reason = errorMessage(error)
    return failClaimed(config, detail.id, resolved, branchName, reason)
  }

  upsertPhase(config, {
    ticketId: detail.id,
    phase: 'fixing',
    repo: resolved.repo,
    branch: branchName,
  })

  const brief = buildAgentBrief({
    detail,
    resolved,
    localRoot,
    routesFile,
    screenshotPaths,
    missingAssets,
  })

  let agentResult: { ok: boolean; summary: string }
  try {
    agentResult = await config.agentRunner({ cwd: localRoot, brief })
  } catch (error) {
    return failClaimed(config, detail.id, resolved, branchName, errorMessage(error))
  }

  if (!agentResult.ok) {
    return failClaimed(config, detail.id, resolved, branchName, agentResult.summary)
  }

  const changed = await listChangedFiles(localRoot, config.runGit)
  if (changed.length === 0) {
    return failClaimed(config, detail.id, resolved, branchName, '无有效 diff（工作区无变更）')
  }

  if (config.lintEnabled === true) {
    if (config.lintRunner === undefined) {
      return failClaimed(
        config,
        detail.id,
        resolved,
        branchName,
        'lintEnabled=true 但未提供 lintRunner',
      )
    }
    const lint = await config.lintRunner({ cwd: localRoot, files: changed })
    if (!lint.ok) {
      return failClaimed(config, detail.id, resolved, branchName, `lint 失败：${lint.summary}`)
    }
  }

  // buildEnabled reserved; default false — skipped in phase 1.
  void config.buildEnabled

  let commitSha: string
  try {
    commitSha = await commitAll(
      localRoot,
      `fix(bug-platform): #${detail.id} ${detail.target_menu ?? ''}`,
      config.runGit,
    )
  } catch (error) {
    return failClaimed(config, detail.id, resolved, branchName, `git commit 失败：${errorMessage(error)}`)
  }

  try {
    await pushBranch(localRoot, branchName, config.runGit)
    const ensureMr = config.ensureMr ?? ensureMergeRequest
    const mr = await ensureMr({
      host: config.gitlab.host,
      projectId: config.gitlab.projectId,
      token: config.gitlab.token,
      sourceBranch: branchName,
      targetBranch: expectedJinan,
      title: `fix(bug #${detail.id}): ${detail.target_menu ?? ''}`,
      description: `${agentResult.summary}\n\ncommit: ${commitSha}`,
    })

    const noteBody =
      `自动修复提交\ncommit: ${commitSha}\n${agentResult.summary}`
    const addMrNote = config.addMrNote ?? addMergeRequestNote
    await addMrNote({
      host: config.gitlab.host,
      projectId: config.gitlab.projectId,
      token: config.gitlab.token,
      mergeRequestIid: mr.iid,
      body: noteBody,
    })

    const followupPrefix =
      isReprocess || !mr.created
        ? '自动修复重新处理完成：已更新 MR，请人工审阅合入。'
        : '自动修复完成：已开 MR，请人工审阅合入。'
    await config.client.createFollowup(detail.id, {
      content:
        `${followupPrefix}\nMR: ${mr.webUrl}\ncommit: ${commitSha}\n${agentResult.summary}`,
      status_change: '处理中',
      assignee_change: null,
    })
    upsertPhase(config, {
      ticketId: detail.id,
      phase: 'done',
      repo: resolved.repo,
      branch: branchName,
      mrUrl: mr.webUrl,
    })
    return { kind: 'done', mrUrl: mr.webUrl }
  } catch (error) {
    // Local commit exists: keep 处理中 / awaiting_push for any push or MR failure
    // (including GitlabTokenMissingError). Autofix never claims 现场验证.
    void (error instanceof GitlabTokenMissingError)
    const reason =
      `本地已 commit（${commitSha}），分支 ${branchName}，待人工推送/开 MR：${errorMessage(error)}`
    await config.client.createFollowup(detail.id, {
      content: reason,
      status_change: '处理中',
      assignee_change: null,
    })
    upsertPhase(config, {
      ticketId: detail.id,
      phase: 'awaiting_push',
      repo: resolved.repo,
      branch: branchName,
    })
    return { kind: 'awaiting_push', branch: branchName, commitSha }
  }
}

/**
 * Login once, list eligible tickets, and run {@link runOneTicket} up to `maxTickets`.
 * @param config - shared orchestration config.
 * @param options - batch size and list status filter.
 * @returns outcomes in attempt order.
 */
export async function runBatch(
  config: OrchestratorConfig,
  options: RunBatchOptions = {},
): Promise<TicketOutcome[]> {
  const maxTickets = options.maxTickets ?? 1
  const projectId = config.projectId ?? DEFAULT_PROJECT_ID
  const status = options.status ?? DEFAULT_LIST_STATUS

  await config.client.ensureToken()

  const collected: BugTicketDetail[] = []
  let page = 1
  while (collected.length < maxTickets * 5) {
    const pageRows = await config.client.listTickets({
      projectId,
      status,
      page,
      pageSize: 50,
    })
    if (pageRows.length === 0) break
    collected.push(...(pageRows as BugTicketDetail[]))
    if (pageRows.length < 50) break
    page += 1
  }

  const candidates = selectTickets(collected, config.menuIndex, config.stateStore)
  const outcomes: TicketOutcome[] = []
  for (const row of candidates) {
    if (outcomes.length >= maxTickets) break
    outcomes.push(await runOneTicket(config, row.id))
  }
  return outcomes
}

/**
 * @param index - menu mapping index.
 * @param targetMenu - ticket menu label.
 * @returns human-readable skip reason without claiming.
 */
function skipReason(index: MenuMappingIndex, targetMenu: string | null): string {
  if (targetMenu === null || targetMenu.length === 0) {
    return '无菜单映射：target_menu 为空，保持原状态'
  }
  if (targetMenu === EXCLUDED_TARGET_MENU) {
    return `排除菜单：${EXCLUDED_TARGET_MENU}，保持原状态`
  }
  const hits = index.items.filter(item => item.targetMenu === targetMenu)
  if (hits.some(item => item.repo === 'home')) {
    return 'home 不在自动修复范围，保持原状态'
  }
  return `无菜单映射：${targetMenu}，保持原状态`
}

/**
 * Download screenshots and follow-up attachments; skip `file_size === 0` and failures.
 * @param config - orchestrator config (client + assetsDir).
 * @param detail - ticket detail.
 * @returns local paths and missing remote urls.
 */
async function downloadAssets(
  config: OrchestratorConfig,
  detail: BugTicketDetail,
): Promise<{ screenshotPaths: string[]; missingAssets: string[] }> {
  const destDir = join(config.assetsDir, String(detail.id))
  await mkdir(destDir, { recursive: true })

  const items: BugAttachment[] = [
    ...detail.screenshots,
    ...detail.followups.flatMap(f => f.attachments ?? []),
  ]

  const screenshotPaths: string[] = []
  const missingAssets: string[] = []
  let index = 0
  for (const item of items) {
    if (item.file_size === 0) {
      missingAssets.push(`${item.url} (file_size=0)`)
      continue
    }
    const rawName = item.name ?? basename(item.url)
    const name = safeFileName(rawName || `asset-${index}`)
    const destPath = join(destDir, `${index}-${name}`)
    index += 1
    try {
      await config.client.downloadToFile(item.url, destPath)
      screenshotPaths.push(destPath)
    } catch {
      // Skip failed downloads; record for the agent brief.
      missingAssets.push(item.url)
    }
  }
  return { screenshotPaths, missingAssets }
}

/**
 * @param name - raw attachment name.
 * @returns a filesystem-safe basename fragment.
 */
function safeFileName(name: string): string {
  return name.replace(/[^\w.\-()+@]+/g, '_') || 'asset'
}

/**
 * Followup stay-处理中 + phase failed after a successful claim.
 * @param config - orchestrator config.
 * @param ticketId - platform id.
 * @param resolved - menu hit used for repo/branch bookkeeping.
 * @param branch - bugfix branch name.
 * @param reason - failure text.
 * @returns failed outcome.
 */
async function failClaimed(
  config: OrchestratorConfig,
  ticketId: number,
  resolved: ResolvedMenu,
  branch: string,
  reason: string,
): Promise<TicketOutcome> {
  await config.client.createFollowup(ticketId, {
    content: `自动修复失败，保持处理中：${reason}`,
    status_change: '处理中',
    assignee_change: null,
  })
  upsertPhase(config, {
    ticketId,
    phase: 'failed',
    repo: resolved.repo,
    branch,
  })
  return { kind: 'failed', reason }
}

/**
 * @param config - orchestrator config.
 * @param partial - fields to upsert (updatedAt filled here).
 */
function upsertPhase(
  config: OrchestratorConfig,
  partial: {
    ticketId: number
    phase: TicketPhase
    repo: 'custom' | 'ailpha'
    branch: string
    mrUrl?: string
  },
): void {
  const record: {
    ticketId: number
    phase: TicketPhase
    repo: 'custom' | 'ailpha'
    branch: string
    mrUrl?: string
    updatedAt: string
  } = {
    ticketId: partial.ticketId,
    phase: partial.phase,
    repo: partial.repo,
    branch: partial.branch,
    updatedAt: new Date().toISOString(),
  }
  if (partial.mrUrl !== undefined) {
    record.mrUrl = partial.mrUrl
  }
  config.stateStore.upsert(record)
}

/**
 * @param error - unknown thrown value.
 * @returns stable string for follow-up content.
 */
function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
