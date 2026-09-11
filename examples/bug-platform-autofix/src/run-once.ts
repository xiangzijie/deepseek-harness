/**
 * Manual one-shot / force-ticket / batch / poll entry for bug-platform autofix.
 * Library-only: no cordis.yml; constructs clients and calls `runOneTicket` / `runBatch`.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BugPlatformClient,
  DEFAULT_BASE_URL,
} from '@deepseek-ai/dsh-bug-platform-http'
import {
  createDefaultAgentRunner,
  loadMenuMapping,
  loadState,
  runBatch,
  runOneTicket,
  saveState,
  type OrchestratorConfig,
  type TicketOutcome,
  type TicketStateStore,
} from '@deepseek-ai/dsh-bug-platform-autofix'
import { parseRunOnceArgs, DEFAULT_EMPTY_BATCH_BACKOFF_SECONDS } from './cli-args.ts'
import { runPollLoop } from './poll-loop.ts'

/** deepseek-harness worktree root (parent of `examples/`). */
const HARNESS_ROOT = fileURLToPath(new URL('../../..', import.meta.url))

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

/** Local product worktrees + mapping/state home (operator machine defaults). */
const PROJECT_ROOT = 'D:/CODE/COMPANY/dkh-bugFix-project'

const DEFAULT_MAPPING_FILE = join(PROJECT_ROOT, 'menu-mapping.json')
const DEFAULT_STATE_FILE = join(PROJECT_ROOT, '.dsh-bugfix', 'state.json')
/** Per-ticket assets land at `<assetsDir>/<ticketId>/` (orchestrator contract). */
const DEFAULT_ASSETS_DIR = join(PROJECT_ROOT, '.dsh-bugfix')

const WORKSPACE_ROOTS = {
  custom: join(PROJECT_ROOT, 'dkh-custom'),
  ailpha: join(PROJECT_ROOT, 'dkh-ailpha'),
  home: join(PROJECT_ROOT, 'dkh-home'),
} as const

const PRODUCT_BRANCHES = {
  custom: 'dkh-custom-jinan',
  ailpha: 'dkh-ailpha-jinan',
  home: 'dkh-home-jinan',
} as const

const GITLAB_HOST = 'http://gitlab.info.dbappsecurity.com.cn'
const GITLAB_PROJECT_ID = 8325

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
 * Run one whitelist batch round and persist local state.
 * @param config - orchestrator config (mutates `stateStore` in place).
 * @param statePath - path for {@link saveState}.
 * @param maxTickets - batch size.
 * @param status - optional list status override.
 * @returns number of tickets attempted in this round.
 */
async function runWhitelistRound(
  config: OrchestratorConfig,
  statePath: string,
  maxTickets: number,
  status: string | undefined,
): Promise<number> {
  process.stdout.write(
    `按白名单选单跑批（最多 ${maxTickets} 单${status === undefined ? '' : `，status=${status}`}）…\n`,
  )
  const batchOutcomes = await runBatch(config, {
    maxTickets,
    ...(status === undefined ? {} : { status }),
  })
  if (batchOutcomes.length === 0) {
    process.stdout.write('没有可处理的候选单。\n')
  }
  for (const outcome of batchOutcomes) {
    process.stdout.write(`${formatOutcome(outcome)}\n`)
  }
  saveState(statePath, config.stateStore)
  return batchOutcomes.length
}

async function main(): Promise<void> {
  assertHarnessBuilt(HARNESS_ROOT)

  const { ticketIds, maxTickets, status, pollIntervalSeconds, continuous } = parseRunOnceArgs(
    process.argv,
  )

  const username = requireEnv('BUG_PLATFORM_USERNAME')
  const password = requireEnv('BUG_PLATFORM_PASSWORD')
  const deepseekApiKey = requireEnv('DEEPSEEK_API_KEY')

  const baseUrl = process.env['BUG_PLATFORM_BASE_URL']?.trim() || DEFAULT_BASE_URL
  // Optional: set GITLAB_TOKEN in the process env (Windows User env is fine if
  // the shell inherits it). Never log the value.
  const gitlabToken = process.env['GITLAB_TOKEN']?.trim() || null
  const deepseekBaseURL = process.env['DEEPSEEK_BASE_URL']?.trim()
  const visionModel = process.env['BUG_PLATFORM_VISION_MODEL']?.trim()

  const mappingPath = process.env['BUG_PLATFORM_MAPPING_FILE']?.trim() || DEFAULT_MAPPING_FILE
  const statePath = process.env['BUG_PLATFORM_STATE_FILE']?.trim() || DEFAULT_STATE_FILE
  const assetsDir = process.env['BUG_PLATFORM_ASSETS_DIR']?.trim() || DEFAULT_ASSETS_DIR

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
    workspaceRoots: { ...WORKSPACE_ROOTS },
    productBranches: { ...PRODUCT_BRANCHES },
    gitlab: {
      host: GITLAB_HOST,
      projectId: GITLAB_PROJECT_ID,
      token: gitlabToken,
    },
    assetsDir,
    lintEnabled: false,
    buildEnabled: false,
    vision: {
      apiKey: deepseekApiKey,
      ...(deepseekBaseURL === undefined || deepseekBaseURL.length === 0
        ? {}
        : { baseURL: deepseekBaseURL }),
      ...(visionModel === undefined || visionModel.length === 0 ? {} : { model: visionModel }),
    },
    // Spawn harness `apps/cli` with product worktree as cwd — never `pnpm dsh` inside dkh-*.
    agentRunner: createDefaultAgentRunner({ harnessRoot: HARNESS_ROOT }),
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
      for (const ticketId of ticketIds) {
        const record = stateStore.get(ticketId)
        // Force path may retry `awaiting_push` / `done` / `failed` (e.g. second
        // fix pass). Only block in-flight claim/fix phases.
        if (record?.phase === 'claimed' || record?.phase === 'fixing') {
          process.stdout.write(
            `ticket ${ticketId}: 跳过（本地 phase=${record.phase} 仍在进行中，见 ${statePath}）\n`,
          )
          continue
        }
        const outcome = await runOneTicket(config, ticketId)
        process.stdout.write(`ticket ${ticketId}: ${formatOutcome(outcome)}\n`)
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
            return await runWhitelistRound(roundConfig, statePath, maxTickets, status)
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
                  ? `本轮无候选，${DEFAULT_EMPTY_BATCH_BACKOFF_SECONDS}s 后重试…\n`
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

    await runWhitelistRound(config, statePath, maxTickets, status)
  } finally {
    saveState(statePath, stateStore)
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
