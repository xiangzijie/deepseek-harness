/**
 * Manual one-shot / force-ticket entry for bug-platform autofix (phase 1).
 * Library-only: no cordis.yml; constructs clients and calls `runOneTicket` / `runBatch`.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
} from '@deepseek-ai/dsh-bug-platform-autofix'

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
 * @param argv - `process.argv` (or a test slice).
 * @returns forced ticket id when `--ticket <id>` is present.
 */
function parseTicketArg(argv: readonly string[]): number | undefined {
  const index = argv.indexOf('--ticket')
  if (index === -1) return undefined
  const raw = argv[index + 1]
  if (raw === undefined || raw.startsWith('-')) {
    throw new Error('--ticket 需要一个数字 id，例如 --ticket 428')
  }
  const id = Number(raw)
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`--ticket 必须是正整数，收到: ${raw}`)
  }
  return id
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

async function main(): Promise<void> {
  const ticketId = parseTicketArg(process.argv)

  const username = requireEnv('BUG_PLATFORM_USERNAME')
  const password = requireEnv('BUG_PLATFORM_PASSWORD')
  requireEnv('DEEPSEEK_API_KEY')

  const baseUrl = process.env['BUG_PLATFORM_BASE_URL']?.trim() || DEFAULT_BASE_URL
  // Optional: set GITLAB_TOKEN in the process env (Windows User env is fine if
  // the shell inherits it). Never log the value.
  const gitlabToken = process.env['GITLAB_TOKEN']?.trim() || null

  const mappingPath = process.env['BUG_PLATFORM_MAPPING_FILE']?.trim() || DEFAULT_MAPPING_FILE
  const statePath = process.env['BUG_PLATFORM_STATE_FILE']?.trim() || DEFAULT_STATE_FILE
  const assetsDir = process.env['BUG_PLATFORM_ASSETS_DIR']?.trim() || DEFAULT_ASSETS_DIR

  const menuIndex = loadMenuMapping(JSON.parse(readFileSync(mappingPath, 'utf8')) as unknown)
  const stateStore = loadState(statePath)

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
    agentRunner: createDefaultAgentRunner(),
  }

  try {
    await client.ensureToken()

    let outcomes: TicketOutcome[]
    if (ticketId !== undefined) {
      // Force path: load detail by id and skip list status whitelist (e.g. 428 转派).
      if (stateStore.isActiveTicket(ticketId)) {
        const record = stateStore.get(ticketId)
        process.stdout.write(
          `跳过 ticket ${ticketId}：本地 phase=${record?.phase} 仍在进行中（见 ${statePath}）\n`,
        )
        return
      }
      process.stdout.write(`强制处理 ticket ${ticketId}（绕过选单白名单）…\n`)
      outcomes = [await runOneTicket(config, ticketId)]
    } else {
      process.stdout.write('按白名单选单跑批（默认最多 1 单）…\n')
      outcomes = await runBatch(config, { maxTickets: 1 })
      if (outcomes.length === 0) {
        process.stdout.write('没有可处理的候选单。\n')
      }
    }

    for (const outcome of outcomes) {
      process.stdout.write(`${formatOutcome(outcome)}\n`)
    }
  } finally {
    saveState(statePath, stateStore)
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
