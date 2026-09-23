/**
 * End-to-end orchestrator for one ticket / one batch (design §3).
 * Mapping is resolved before any `处理中` claim; home / unmapped /
 * {@link isExcludedTargetMenu} / `autofix: false` never claim. Context precheck,
 * optional eligibility (`needFrontendFix === false`), and forced-skill resolution
 * run after mapping and asset download, still before claim, so
 * `forceMaxCount` / `forceMaxChars` / `disable-model-invocation` failures and
 * clear no-frontend decisions skip without `处理中`.
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
  assessPreAgentContext,
  formatAutofixStopFollowup,
  parseSkipAutofixSummary,
  type AutofixStop,
} from './autofix-stop.ts'
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
import { loadLessonIndex } from './lesson-index.ts'
import { loadAcceptedLessonBodies } from './lesson-inject.ts'
import {
  resolveForcedSkills,
  type ForcedSkill,
} from './skill-manifest.ts'
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
import type { OperatorWorkspace } from './operator-config.ts'
import type { AgentRunner } from './run-agent.ts'
import { isExcludedTargetMenu, selectTickets } from './select.ts'
import type { TicketPhase, TicketStateStore } from './ticket-state.ts'
import {
  assessNeedFrontendFix,
  type EligibilityParseErr,
  type EligibilityParseOk,
  type EligibilityPreflightOptions,
} from './eligibility-preflight.ts'
import {
  describeScreenshots,
  type VisionPreflightOptions,
} from './vision-preflight.ts'

/** Fixed product jinan branch names for the three worktrees. */
export type ProductBranches = {
  custom: string
  ailpha: string
  home: string
}

/** GitLab host/token for optional MR creation. Per-workspace project ids live on {@link OrchestratorConfig.workspaces}. */
export type OrchestratorGitlabConfig = {
  host: string
  /**
   * Test-compat only: when {@link OrchestratorConfig.workspaces} is omitted,
   * synthesize one project id for every {@link OrchestratorConfig.workspaceRoots} entry.
   * Production `run-once` must pass full workspaces and omit this field.
   */
  projectId?: number
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
> &
  Partial<Pick<BugPlatformClient, 'getLoggedInUserId'>>

/** Injectable orchestration config. */
export interface OrchestratorConfig {
  client: OrchestratorClient
  menuIndex: MenuMappingIndex
  stateStore: TicketStateStore
  workspaceRoots: WorkspaceRoots
  productBranches: ProductBranches
  gitlab: OrchestratorGitlabConfig
  /**
   * Per-workspace GitLab project id and autofix flag. When omitted, tests
   * synthesize from {@link OrchestratorGitlabConfig.projectId} plus
   * {@link OrchestratorConfig.workspaceRoots} / {@link OrchestratorConfig.productBranches}.
   */
  workspaces?: readonly OperatorWorkspace[]
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
  /**
   * When set, run DeepSeek vision on downloaded screenshots before claim and
   * inject the observation into the agent brief. Omit to skip vision.
   */
  vision?: Omit<VisionPreflightOptions, 'ticketId'>
  /**
   * When set, ask a text model whether the ticket still needs a frontend fix
   * after the cheap context gate and before claim. Omit to skip the check.
   * Inject `assess` in tests; production uses {@link assessNeedFrontendFix}.
   */
  eligibility?: Omit<EligibilityPreflightOptions, 'fetchImpl'> & {
    fetchImpl?: typeof fetch
    assess?: (detail: BugTicketDetail) => Promise<EligibilityParseOk | EligibilityParseErr>
  }
  /**
   * Global skill clone and force-injection limits. When omitted, the brief has
   * no forced-skill section. Production `run-once` always passes this from
   * `operator.yaml`.
   */
  skills?: {
    /** Local clone root containing `manifest.yaml` and `skills/`. */
    globalLocal: string
    /** Maximum forced skills for one workspace. */
    forceMaxCount: number
    /** Maximum combined forced-skill body characters. */
    forceMaxChars: number
  }
  /**
   * Lessons clone used to inject accepted bodies into the agent brief.
   * When omitted, the brief has no lessons section. Inject load failures
   * omit the section and do not skip claim.
   */
  lessons?: {
    /** Local clone root containing `index.yaml` and `accepted/`. */
    local: string
    /** Maximum accepted bodies to inject for this ticket's menu. */
    injectMax: number
  }
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
  /** Max non-skipped tickets to process in this batch; defaults to `1`. */
  maxTickets?: number
  /** Comma-separated list status filter; defaults to `待确认,验证未通过,转派,转需求`. */
  status?: string
  /**
   * Called once candidates are selected (before any ticket runs), with all
   * candidate ids (not sliced by {@link RunBatchOptions.maxTickets}).
   * @param ticketIds - attempt order.
   */
  onQueue?: (ticketIds: readonly number[]) => void
  /**
   * Called immediately before {@link runOneTicket} for each attempted candidate.
   * `total` is the full candidate list length.
   * @param info - 1-based index, total, and ticket id.
   */
  onTicketStart?: (info: { index: number; total: number; ticketId: number }) => void
  /**
   * Called after {@link runOneTicket} returns for each candidate.
   * @param info - index, total, ticket id, and outcome.
   */
  onTicketEnd?: (info: {
    index: number
    total: number
    ticketId: number
    outcome: TicketOutcome
  }) => void
}

const DEFAULT_PROJECT_ID = 47
const DEFAULT_LIST_STATUS = '待确认,验证未通过,转派,转需求'

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
  if (isExcludedTargetMenu(targetMenu)) {
    const reason = `排除菜单：${targetMenu}，保持原状态`
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

  const workspace = workspaceForRepo(config, resolved.repo)
  if (workspace === undefined) {
    return skipMappedWithoutClaim(
      config,
      detail.id,
      `未配置工作区 ${resolved.repo}，保持原状态`,
    )
  }
  if (workspace.autofix === false) {
    return skipMappedWithoutClaim(
      config,
      detail.id,
      `${workspace.id} 未开启自动修复（autofix: false），保持原状态`,
    )
  }

  const localRoot = config.workspaceRoots[resolved.repo]
  const expectedJinan = config.productBranches[resolved.repo]
  const branchName = `bugfix/${detail.id}`
  const routesFile = resolved.repo === 'custom' ? 'src/routes.js' : 'src/commonRoutes.js'
  const prior = config.stateStore.get(detail.id)
  const isReprocess =
    prior !== undefined &&
    (prior.phase === 'done' ||
      prior.phase === 'awaiting_push' ||
      prior.phase === 'failed' ||
      prior.phase === 'skipped')

  // Download + cheap context gate before claiming so thin tickets never become 处理中.
  const { screenshotPaths, missingAssets } = await downloadAssets(config, detail)
  const preStop = assessPreAgentContext(detail.description, screenshotPaths)
  if (preStop !== null) {
    return skipBeforeClaim(config, detail.id, resolved, branchName, preStop)
  }

  if (config.eligibility !== undefined) {
    const assessed =
      config.eligibility.assess !== undefined
        ? await config.eligibility.assess(detail)
        : await assessNeedFrontendFix(detail, config.eligibility)
    if (assessed.ok && assessed.needFrontendFix === false) {
      return skipBeforeClaim(config, detail.id, resolved, branchName, {
        category: 'out_of_scope',
        reason: assessed.reason,
      })
    }
  }

  let forcedSkills: ForcedSkill[] = []
  if (config.skills !== undefined) {
    try {
      forcedSkills = resolveForcedSkills({
        globalLocal: config.skills.globalLocal,
        workspaceId: workspace.id,
        autofixWorkspaceIds: resolveWorkspaces(config)
          .filter(ws => ws.autofix !== false)
          .map(ws => ws.id),
        forceMaxCount: config.skills.forceMaxCount,
        forceMaxChars: config.skills.forceMaxChars,
      })
    } catch (error) {
      return skipUnclaimed(
        config,
        detail.id,
        resolved,
        branchName,
        `强制 skill 无法注入，未领单：${errorMessage(error)}`,
      )
    }
  }

  let visionObservation: string | undefined
  if (config.vision !== undefined && screenshotPaths.length > 0) {
    const visionResult = await describeScreenshots(screenshotPaths, {
      ...config.vision,
      ticketId: detail.id,
    })
    if (visionResult.ok) {
      visionObservation = visionResult.text
    } else if (config.writeSkipFollowup !== false) {
      await config.client.createFollowup(detail.id, {
        content: `视觉预跑未成功（仍继续自动修复）：${visionResult.error}`,
        status_change: null,
        assignee_change: null,
      })
    }
  }

  // Workspace gates before claim: dirty / wrong jinan must not become 处理中.
  try {
    await assertProductBranch(localRoot, expectedJinan, config.runGit)
    await assertClean(localRoot, config.runGit)
  } catch (error) {
    return skipUnclaimed(
      config,
      detail.id,
      resolved,
      branchName,
      `工作区未就绪，未领单：${errorMessage(error)}`,
    )
  }

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

  try {
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

  let lessonBodies: { id: string; symptom: string; body: string }[] = []
  if (config.lessons !== undefined) {
    try {
      const index = loadLessonIndex(config.lessons.local)
      lessonBodies = loadAcceptedLessonBodies({
        localRoot: config.lessons.local,
        index,
        targetMenu: detail.target_menu ?? '',
        injectMax: config.lessons.injectMax,
      })
    } catch (error) {
      // Unreadable lessons clone: omit inject; ticket claim continues.
      void error
      lessonBodies = []
    }
  }

  const brief = buildAgentBrief({
    detail,
    resolved,
    localRoot,
    routesFile,
    screenshotPaths,
    missingAssets,
    ...(visionObservation === undefined ? {} : { visionObservation }),
    ...(forcedSkills.length === 0 ? {} : { forcedSkills }),
    ...(lessonBodies.length === 0 ? {} : { lessons: lessonBodies }),
  })

  let agentResult: { ok: boolean; summary: string }
  try {
    agentResult = await config.agentRunner({ cwd: localRoot, brief })
  } catch (error) {
    return failClaimed(config, detail.id, resolved, branchName, errorMessage(error))
  }

  if (!agentResult.ok) {
    const skip = parseSkipAutofixSummary(agentResult.summary)
    if (skip !== null) {
      return stopClaimed(config, detail.id, resolved, branchName, skip)
    }
    return failClaimed(config, detail.id, resolved, branchName, agentResult.summary)
  }

  const changed = await listChangedFiles(localRoot, config.runGit)
  if (changed.length === 0) {
    const skip = parseSkipAutofixSummary(agentResult.summary)
    if (skip !== null) {
      return stopClaimed(config, detail.id, resolved, branchName, skip)
    }
    return failClaimed(
      config,
      detail.id,
      resolved,
      branchName,
      '无有效 diff（工作区无变更）；若因上下文不足或非前端问题停止，请在摘要中写 SKIP_AUTOFIX|<类别>|<原因>',
    )
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
      projectId: workspace.gitlabProjectId,
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
      projectId: workspace.gitlabProjectId,
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
 * Login once, list eligible tickets, and run {@link runOneTicket} until
 * `maxTickets` non-skipped outcomes or the candidate list is exhausted.
 * Skip outcomes do not consume `maxTickets`.
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

  const selfId = config.client.getLoggedInUserId?.()
  const candidates = selectTickets(collected, config.menuIndex, config.stateStore, {
    alsoAssignedTo: selfId === undefined ? [] : [selfId],
    workspaces: resolveWorkspaces(config),
  })
  options.onQueue?.(candidates.map(row => row.id))
  const outcomes: TicketOutcome[] = []
  let claimed = 0
  let index = 0
  const total = candidates.length
  for (const row of candidates) {
    if (claimed >= maxTickets) break
    index += 1
    options.onTicketStart?.({ index, total, ticketId: row.id })
    const outcome = await runOneTicket(config, row.id)
    options.onTicketEnd?.({ index, total, ticketId: row.id, outcome })
    outcomes.push(outcome)
    if (outcome.kind !== 'skipped') {
      claimed += 1
    }
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
  if (isExcludedTargetMenu(targetMenu)) {
    return `排除菜单：${targetMenu}，保持原状态`
  }
  const hits = index.items.filter(item => item.targetMenu === targetMenu)
  if (hits.some(item => item.repo === 'home')) {
    return 'home 不在自动修复范围，保持原状态'
  }
  return `无菜单映射：${targetMenu}，保持原状态`
}

/**
 * Prefer explicit workspaces; otherwise synthesize from gitlab.projectId + roots (tests only).
 * @param config - orchestrator config.
 * @returns workspace list used for autofix flags and GitLab project ids.
 */
function resolveWorkspaces(config: OrchestratorConfig): readonly OperatorWorkspace[] {
  if (config.workspaces !== undefined) {
    return config.workspaces
  }
  const projectId = config.gitlab.projectId
  if (typeof projectId !== 'number') {
    throw new Error('OrchestratorConfig.workspaces 缺失且无法从 gitlab.projectId 合成')
  }
  return [
    {
      id: 'custom',
      localRoot: config.workspaceRoots.custom,
      gitlabProjectId: projectId,
      productBranch: config.productBranches.custom,
      mappingRepo: 'custom',
      autofix: true,
    },
    {
      id: 'ailpha',
      localRoot: config.workspaceRoots.ailpha,
      gitlabProjectId: projectId,
      productBranch: config.productBranches.ailpha,
      mappingRepo: 'ailpha',
      autofix: true,
    },
    {
      id: 'home',
      localRoot: config.workspaceRoots.home,
      gitlabProjectId: projectId,
      productBranch: config.productBranches.home,
      mappingRepo: 'home',
      autofix: false,
    },
  ]
}

/**
 * Look up the configured workspace for a mapped custom/ailpha repo.
 * @param config - orchestrator config.
 * @param repo - mapping repo after {@link resolveMenu} succeeds.
 * @returns workspace, or undefined when that mappingRepo is not configured.
 */
function workspaceForRepo(
  config: OrchestratorConfig,
  repo: 'custom' | 'ailpha',
): OperatorWorkspace | undefined {
  return resolveWorkspaces(config).find(ws => ws.mappingRepo === repo)
}

/**
 * Skip a mapped ticket without claiming 处理中 (same followup as home / unmapped).
 * @param config - orchestrator config.
 * @param ticketId - platform id.
 * @param reason - followup / outcome text.
 * @returns skipped outcome.
 */
async function skipMappedWithoutClaim(
  config: OrchestratorConfig,
  ticketId: number,
  reason: string,
): Promise<TicketOutcome> {
  if (config.writeSkipFollowup !== false) {
    await config.client.createFollowup(ticketId, {
      content: reason,
      status_change: null,
      assignee_change: null,
    })
  }
  return { kind: 'skipped', reason }
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
 * Pre-claim stop: write a platform followup without changing status, record
 * local `skipped` so whitelist batches do not immediately re-pick the ticket.
 * @param config - orchestrator config.
 * @param ticketId - platform id.
 * @param resolved - menu hit used for repo/branch bookkeeping.
 * @param branch - planned bugfix branch name (may not exist on disk yet).
 * @param stop - structured stop category + reason.
 * @returns skipped outcome whose reason is the followup body.
 */
async function skipBeforeClaim(
  config: OrchestratorConfig,
  ticketId: number,
  resolved: ResolvedMenu,
  branch: string,
  stop: AutofixStop,
): Promise<TicketOutcome> {
  return skipUnclaimed(config, ticketId, resolved, branch, formatAutofixStopFollowup(stop))
}

/**
 * Pre-claim abort: platform followup without status change; local `skipped`.
 * @param config - orchestrator config.
 * @param ticketId - platform id.
 * @param resolved - menu hit used for repo/branch bookkeeping.
 * @param branch - planned bugfix branch name.
 * @param content - followup / outcome text.
 * @returns skipped outcome.
 */
async function skipUnclaimed(
  config: OrchestratorConfig,
  ticketId: number,
  resolved: ResolvedMenu,
  branch: string,
  content: string,
): Promise<TicketOutcome> {
  if (config.writeSkipFollowup !== false) {
    await config.client.createFollowup(ticketId, {
      content,
      status_change: null,
      assignee_change: null,
    })
  }
  upsertPhase(config, {
    ticketId,
    phase: 'skipped',
    repo: resolved.repo,
    branch,
  })
  return { kind: 'skipped', reason: content }
}

/**
 * Followup stay-处理中 + phase failed when autofix stops without a code fix
 * after claim (agent SKIP_AUTOFIX).
 * @param config - orchestrator config.
 * @param ticketId - platform id.
 * @param resolved - menu hit used for repo/branch bookkeeping.
 * @param branch - bugfix branch name.
 * @param stop - structured stop category + reason.
 * @returns failed outcome whose reason is the followup body.
 */
async function stopClaimed(
  config: OrchestratorConfig,
  ticketId: number,
  resolved: ResolvedMenu,
  branch: string,
  stop: AutofixStop,
): Promise<TicketOutcome> {
  const content = formatAutofixStopFollowup(stop)
  await config.client.createFollowup(ticketId, {
    content,
    status_change: '处理中',
    assignee_change: null,
  })
  upsertPhase(config, {
    ticketId,
    phase: 'failed',
    repo: resolved.repo,
    branch,
  })
  return { kind: 'failed', reason: content }
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
