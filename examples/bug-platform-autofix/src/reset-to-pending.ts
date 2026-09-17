/**
 * Ops entry: batch-reset bug tickets to 待确认 with a follow-up note.
 * Does not run the autofix agent. Credentials from env only; paths from operator.yaml.
 */

import { fileURLToPath } from 'node:url'
import { BugPlatformClient } from '@deepseek-ai/dsh-bug-platform-http'
import { loadOperatorConfig, loadState, saveState } from '@deepseek-ai/dsh-bug-platform-autofix'
import { resolveOperatorConfigPath } from './cli-args.ts'
import { loadRepoEnv } from './load-repo-env.ts'
import { parseResetToPendingArgs } from './reset-to-pending-args.ts'
import {
  DEFAULT_RESET_NOTE,
  resetTicketsToPending,
  resolveResetTicketIds,
} from './reset-to-pending-core.ts'

/** deepseek-harness worktree root (parent of `examples/`). */
const HARNESS_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
loadRepoEnv(HARNESS_ROOT)

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
 * Bug platform base URL: env `BUG_PLATFORM_BASE_URL` overrides yaml.
 * @param fromYaml - `bugPlatform.baseUrl` from operator.yaml.
 * @returns a non-empty URL.
 */
function resolveBugPlatformBaseUrl(fromYaml: string): string {
  const fromEnv = process.env['BUG_PLATFORM_BASE_URL']?.trim()
  return fromEnv !== undefined && fromEnv.length > 0 ? fromEnv : fromYaml
}

async function main(): Promise<void> {
  const args = parseResetToPendingArgs(process.argv)
  const note = args.note ?? DEFAULT_RESET_NOTE
  const cfg = loadOperatorConfig(resolveOperatorConfigPath(args.configPath))
  const statePath = cfg.stateFile
  const store = loadState(statePath)
  const ids = resolveResetTicketIds(args.ticketIds, store)

  const client = new BugPlatformClient({
    baseUrl: resolveBugPlatformBaseUrl(cfg.bugPlatform.baseUrl),
    username: requireEnv('BUG_PLATFORM_USERNAME'),
    password: requireEnv('BUG_PLATFORM_PASSWORD'),
  })
  await client.ensureToken()

  console.log(`将重置 ${ids.length} 张单 → 待确认；说明: ${note}`)
  console.log(`ids: ${ids.join(', ')}`)

  const result = await resetTicketsToPending({
    ids,
    client,
    store,
    note,
    persist: () => {
      saveState(statePath, store)
    },
  })

  console.log(`成功 ${result.ok.length}: ${result.ok.join(', ') || '(无)'}`)
  if (result.failed.length > 0) {
    console.error(`失败 ${result.failed.length}:`)
    for (const row of result.failed) {
      console.error(`  #${row.id}: ${row.error}`)
    }
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
