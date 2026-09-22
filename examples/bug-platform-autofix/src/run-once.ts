/**
 * Manual one-shot / force-ticket / batch / poll entry for bug-platform autofix.
 * Library-only: no cordis.yml; constructs clients and calls `runOneTicket` / `runBatch`.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BugPlatformClient } from '@deepseek-ai/dsh-bug-platform-http'
import {
  acquireRunLock,
  assertGlobalSkillsRunnable,
  createDefaultAgentRunner,
  defaultRunGit,
  inspectAutofixWorkspaces,
  loadManifest,
  loadMenuMapping,
  loadOperatorConfig,
  loadState,
  runBatch,
  runLockPath,
  runOneTicket,
  saveState,
  type OperatorConfig,
  type OperatorWorkspace,
  type OrchestratorConfig,
  type TicketOutcome,
  type TicketStateStore,
} from '@deepseek-ai/dsh-bug-platform-autofix'
import {
  parseRunOnceArgs,
  resolveOperatorConfigPath,
  DEFAULT_EMPTY_BATCH_BACKOFF_SECONDS,
} from './cli-args.ts'
import { BatchProgress } from './batch-progress.ts'
import { claimedOutcomeCount } from './claimed-outcome-count.ts'
import { loadRepoEnv } from './load-repo-env.ts'
import { runPollLoop } from './poll-loop.ts'

/** deepseek-harness worktree root (parent of `examples/`). */
const HARNESS_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
loadRepoEnv(HARNESS_ROOT)

/**
 * headless typert-loader loads package `exports["./typert"]` → `lib/typert.host.js`.
 * Fail before claiming a ticket when this worktree has not been built.
 */
function assertHarnessBuilt(harnessRoot: string): void {
  const probes = [
    join(harnessRoot, 'packages/goal/goal/lib/typert.host.js'),
    join(harnessRoot, 'packages/interaction/commands/lib/typert.host.js'),
  ]
  const missing = probes.filter(path => !existsSync(path))
  if (missing.length === 0) return
  throw new Error(
    [
      'harness 未构建：headless 需要各包 lib/typert.host.js（typert-loader 走 artifact 面）。',
      '请在本 worktree 根执行：pnpm run build:lib',
      `缺少: ${missing.join(', ')}`,
    ].join('\n'),
  )
}

/**
 * @param name - required environment variable name.
 * @returns non-empty value.
 */
function requireEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined || value.length === 0) {
    throw new Error(`缺少环境变量 ${name}`)
  }
  return value
}

/**
 * @param outcome - one ticket result.
 * @returns a one-line console summary (no secrets).
 */
function formatOutcome(outcome: TicketOutcome): string {
  switch (outcome.kind) {
    case 'skipped':
      return `skipped: ${outcome.reason}`
    case 'done':
      return `done: MR ${outcome.mrUrl}`
    case 'awaiting_push':
      return `awaiting_push: ${outcome.branch} @ ${outcome.commitSha}`
    case 'failed':
      return `failed: ${outcome.reason}`
    default: {
      const _exhaustive: never = outcome
      return String(_exhaustive)
    }
  }
}

/**
 * @param ms - delay in milliseconds.
 * @returns a promise that resolves after `ms`.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
 * Require mappingRepo custom / ailpha / home workspaces from operator.yaml.
 * @param cfg - parsed operator.yaml.
 * @returns the three product workspaces.
 */
function requireProductWorkspaces(cfg: OperatorConfig): {
  custom: OperatorWorkspace
  ailpha: OperatorWorkspace
  home: OperatorWorkspace
} {
  const custom = cfg.workspaceByMappingRepo('custom')
  const ailpha = cfg.workspaceByMappingRepo('ailpha')
  const home = cfg.workspaceByMappingRepo('home')
  if (custom === undefined || ailpha === undefined || home === undefined) {
    throw new Error('operator.yaml 必须包含 mappingRepo 为 custom、ailpha、home 的三条工作区')
  }
  return { custom, ailpha, home }
}

/**
 * Print aggregated `id: 原因` lines for every failing `autofix: true` workspace.
 * @param cfg - parsed operator.yaml.
 * @param runGit - same git runner the orchestrator will use.
 * @returns true when every inspected workspace is healthy.
 */
async function printAutofixWorkspaceHealth(
  cfg: OperatorConfig,
  runGit: typeof defaultRunGit,
): Promise<boolean> {
  const health = await inspectAutofixWorkspaces({
    workspaces: cfg.workspaces,
    gitlabHost: cfg.gitlab.host,
    runGit,
  })
  for (const line of health.lines) {
    process.stderr.write(`${line}\n`)
  }
  return health.ok
}

/**
 * Fail the process before workspace inspection when any `force: true` skill
 * would inject from a missing, dirty, or unsynced global clone.
 * A missing clone cannot list force names; the call still fails the process
 * so tickets are not all skip-unclaimed.
 * @param cfg - parsed operator.yaml.
 * @param allowStaleRevision - `--allow-stale-global-skills`.
 * @param runGit - same git runner the orchestrator will use.
 */
async function assertForcedGlobalSkillsReady(
  cfg: OperatorConfig,
  allowStaleRevision: boolean,
  runGit: typeof defaultRunGit,
): Promise<void> {
  const globalLocal = cfg.skills.globalLocal
  const forceNames = existsSync(globalLocal)
    ? loadManifest(globalLocal)
      .filter(entry => entry.force === true)
      .map(entry => entry.name)
    : ['missing-clone']
  await assertGlobalSkillsRunnable({
    globalLocal,
    forceNames,
    allowStaleRevision,
    runGit,
  })
}

/**
 * Read GitLab token from yaml `gitlab.tokenEnv`, then `GITLAB_TOKEN`.
 * @param tokenEnv - env var name from operator.yaml.
 * @returns trimmed token, or null when both are unset.
 */
function resolveGitlabToken(tokenEnv: string): string | null {
  const named = process.env[tokenEnv]?.trim()
  if (named !== undefined && named.length > 0) return named
  const fallback = process.env['GITLAB_TOKEN']?.trim()
  return fallback !== undefined && fallback.length > 0 ? fallback : null
}

/**
 * Bug platform base URL: env `BUG_PLATFORM_BASE_URL` overrides yaml.
 * @param fromYaml - `bugPlatform.baseUrl` from operator.yaml.
 * @returns a non-empty URL.
 */
function resolveBugPlatformBaseUrl(fromYaml: string): string {
  const fromEnv = process.env['BUG_PLATFORM_BASE_URL']?.trim()
  return fromEnv !== undefined && fromEnv.length > 0 ? fromEnv : fromYaml
}

/**
 * Run one whitelist batch round and persist local state.
 * @param config - orchestrator config (mutates `stateStore` in place).
 * @param statePath - path for {@link saveState}.
 * @param progressPath - path for {@link BatchProgress} snapshot.
 * @param maxTickets - batch size.
 * @param status - optional list status override.
 * @returns claimed (non-skipped) count used by `--continuous` empty-batch backoff.
 */
async function runWhitelistRound(
  config: OrchestratorConfig,
  statePath: string,
  progressPath: string,
  maxTickets: number,
  status: string | undefined,
): Promise<number> {
  process.stdout.write(
    `按白名单选单跑批（最多 ${maxTickets} 单${status === undefined ? '' : `，status=${status}`}）…\n`,
  )
  let progress: BatchProgress | undefined
  const batchOutcomes = await runBatch(config, {
    maxTickets,
    ...(status === undefined ? {} : { status }),
    onQueue: (ids) => {
      progress = new BatchProgress({ path: progressPath, queue: ids })
      progress.beginRun('whitelist')
    },
    onTicketStart: (info) => {
      progress?.enqueue(info.ticketId)
      progress?.startTicket(info.ticketId)
    },
    onTicketEnd: (info) => {
      progress?.finishTicket(info.ticketId, formatOutcome(info.outcome))
    },
  })
  progress?.dispose()
  if (batchOutcomes.length === 0) {
    process.stdout.write('没有可处理的候选单。\n')
    const empty = new BatchProgress({ path: progressPath, queue: [] })
    empty.beginRun('whitelist')
    empty.dispose()
  }
  saveState(statePath, config.stateStore)
  return claimedOutcomeCount(batchOutcomes)
}

async function main(): Promise<void> {
  assertHarnessBuilt(HARNESS_ROOT)

  const args = parseRunOnceArgs(process.argv)
  const { ticketIds, status, pollIntervalSeconds, continuous } = args
  const configPath = resolveOperatorConfigPath(args.configPath)
  const cfg = loadOperatorConfig(configPath)
  const progressPath = cfg.progressFile
  const releaseLock = acquireRunLock(runLockPath(progressPath), {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    configPath,
    progressFile: progressPath,
  })
  try {
    await runWithLock(args, cfg, progressPath, ticketIds, status, pollIntervalSeconds, continuous)
  } finally {
    releaseLock()
  }
}

/**
 * Force / whitelist / poll work after the progress-file lock is held.
 * @param args - parsed CLI args (maxTickets may be omitted).
 * @param cfg - validated operator.yaml.
 * @param progressPath - yaml `progressFile` (also the lock's cited path).
 * @param ticketIds - forced ticket ids; empty means whitelist batch.
 * @param status - optional list status override.
 * @param pollIntervalSeconds - timed poll interval when set.
 * @param continuous - true for empty-batch backoff looping.
 */
async function runWithLock(
  args: ReturnType<typeof parseRunOnceArgs>,
  cfg: OperatorConfig,
  progressPath: string,
  ticketIds: number[],
  status: string | undefined,
  pollIntervalSeconds: number | undefined,
  continuous: boolean | undefined,
): Promise<void> {
  await assertForcedGlobalSkillsReady(
    cfg,
    args.allowStaleGlobalSkills === true,
    defaultRunGit,
  )
  const { custom, ailpha, home } = requireProductWorkspaces(cfg)
  const maxTickets = args.maxTickets ?? cfg.run.maxTickets

  const username = requireEnv('BUG_PLATFORM_USERNAME')
  const password = requireEnv('BUG_PLATFORM_PASSWORD')
  const deepseekApiKey = requireEnv('DEEPSEEK_API_KEY')

  const baseUrl = resolveBugPlatformBaseUrl(cfg.bugPlatform.baseUrl)
  const gitlabToken = resolveGitlabToken(cfg.gitlab.tokenEnv)
  const deepseekBaseURL = process.env['DEEPSEEK_BASE_URL']?.trim()
  const visionModel = process.env['BUG_PLATFORM_VISION_MODEL']?.trim()
  const eligibilityModel = process.env['BUG_PLATFORM_ELIGIBILITY_MODEL']?.trim()

  const mappingPath = cfg.mappingFile
  const statePath = cfg.stateFile
  const assetsDir = cfg.assetsDir

  const menuIndex = loadMenuMapping(JSON.parse(readFileSync(mappingPath, 'utf8')) as unknown)
  const stateStore: TicketStateStore = loadState(statePath)

  const client = new BugPlatformClient({
    baseUrl,
    username,
    password,
  })

  const config: OrchestratorConfig = {
    client,
    menuIndex,
    stateStore,
    workspaceRoots: { custom: custom.localRoot, ailpha: ailpha.localRoot, home: home.localRoot },
    productBranches: {
      custom: custom.productBranch,
      ailpha: ailpha.productBranch,
      home: home.productBranch,
    },
    gitlab: {
      host: cfg.gitlab.host,
      token: gitlabToken,
    },
    workspaces: cfg.workspaces,
    assetsDir,
    lintEnabled: cfg.run.lintEnabled,
    buildEnabled: cfg.run.buildEnabled,
    projectId: cfg.bugPlatform.projectId,
    skills: {
      globalLocal: cfg.skills.globalLocal,
      forceMaxCount: cfg.skills.forceMaxCount,
      forceMaxChars: cfg.skills.forceMaxChars,
    },
    vision: {
      apiKey: deepseekApiKey,
      ...(deepseekBaseURL === undefined || deepseekBaseURL.length === 0
        ? {}
        : { baseURL: deepseekBaseURL }),
      ...(visionModel === undefined || visionModel.length === 0 ? {} : { model: visionModel }),
    },
    eligibility: {
      apiKey: deepseekApiKey,
      ...(deepseekBaseURL === undefined || deepseekBaseURL.length === 0
        ? {}
        : { baseURL: deepseekBaseURL }),
      ...(eligibilityModel === undefined || eligibilityModel.length === 0
        ? {}
        : { model: eligibilityModel }),
    },
    // Spawn harness `apps/cli` with product worktree as cwd — never `pnpm dsh` inside dkh-*.
    agentRunner: createDefaultAgentRunner({
      harnessRoot: cfg.harnessRoot,
      skillPatch: {
        globalSkillsDir: join(cfg.skills.globalLocal, 'skills'),
        personalRoot: join(cfg.skills.personalRoot, cfg.run.operatorId),
      },
    }),
  }

  const healthOk = await printAutofixWorkspaceHealth(cfg, config.runGit ?? defaultRunGit)
  if (!healthOk) {
    process.exitCode = 1
    return
  }

  let keepPolling = true
  const onStop = (): void => {
    keepPolling = false
    process.stdout.write('收到停止信号，完成本轮后退出…\n')
  }

  try {
    await client.ensureToken()

    if (ticketIds.length > 0) {
      process.stdout.write(
        `强制处理 ${ticketIds.length} 单（绕过选单白名单）：${ticketIds.join(', ')}…\n`,
      )
      const progress = new BatchProgress({ path: progressPath, queue: ticketIds })
      progress.beginRun('force')
      try {
        for (const ticketId of ticketIds) {
          const record = stateStore.get(ticketId)
          // Force path may retry `awaiting_push` / `done` / `failed` (e.g. second
          // fix pass). Only block in-flight claim/fix phases.
          if (record?.phase === 'claimed' || record?.phase === 'fixing') {
            const summary = `跳过（本地 phase=${record.phase} 仍在进行中，见 ${statePath}）`
            progress.startTicket(ticketId)
            progress.finishTicket(ticketId, summary)
            continue
          }
          progress.startTicket(ticketId)
          try {
            const outcome = await runOneTicket(config, ticketId)
            progress.finishTicket(ticketId, formatOutcome(outcome))
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            progress.finishTicket(ticketId, `failed: ${message}`)
            throw error
          }
        }
      } finally {
        progress.dispose()
      }
      return
    }

    if (pollIntervalSeconds !== undefined || continuous === true) {
      const modeLabel =
        continuous === true
          ? `连续批处理：每批最多 ${maxTickets} 单，批内串行，批完立刻拉下一批（空批等待 ${DEFAULT_EMPTY_BATCH_BACKOFF_SECONDS}s）`
          : `定时轮询：每 ${pollIntervalSeconds}s 跑一批（max=${maxTickets}）`
      process.stdout.write(`守护循环启动：${modeLabel}，Ctrl+C 停止。\n`)
      process.on('SIGINT', onStop)
      process.on('SIGTERM', onStop)
      try {
        await runPollLoop({
          runRound: async () => {
            const roundStore = loadState(statePath)
            const roundConfig: OrchestratorConfig = { ...config, stateStore: roundStore }
            return await runWhitelistRound(roundConfig, statePath, progressPath, maxTickets, status)
          },
          sleep,
          delayMsAfterRound: (processed) => {
            if (continuous === true) {
              return processed === 0 ? DEFAULT_EMPTY_BATCH_BACKOFF_SECONDS * 1000 : 0
            }
            return (pollIntervalSeconds ?? 0) * 1000
          },
          shouldContinue: () => keepPolling,
          onRoundError: (error) => {
            const message = error instanceof Error ? error.message : String(error)
            process.stderr.write(`本轮失败（将继续）: ${message}\n`)
          },
          onRoundComplete: (processed) => {
            if (!keepPolling) {
              process.stdout.write('本轮结束，即将退出…\n')
              return
            }
            if (continuous === true) {
              process.stdout.write(
                processed === 0
                  ? `本轮无人领单，${DEFAULT_EMPTY_BATCH_BACKOFF_SECONDS}s 后重试…\n`
                  : `本批 ${processed} 单已处理完，立刻拉下一批…\n`,
              )
              return
            }
            process.stdout.write(`本轮结束，${pollIntervalSeconds}s 后下一轮…\n`)
          },
        })
      } finally {
        process.off('SIGINT', onStop)
        process.off('SIGTERM', onStop)
      }
      return
    }

    await runWhitelistRound(config, statePath, progressPath, maxTickets, status)
  } finally {
    saveState(statePath, stateStore)
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
