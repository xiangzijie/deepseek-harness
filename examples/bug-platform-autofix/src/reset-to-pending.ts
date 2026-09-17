/**
 * Ops entry: batch-reset bug tickets to 待确认 with a follow-up note.
 * Does not run the autofix agent. Credentials from env only.
 */

import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BugPlatformClient,
  DEFAULT_BASE_URL,
} from '@deepseek-ai/dsh-bug-platform-http'
import { loadState, saveState } from '@deepseek-ai/dsh-bug-platform-autofix'
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

/** Local product worktrees + mapping/state home (operator machine defaults). */
const PROJECT_ROOT = 'D:/CODE/COMPANY/dkh-bugFix-project'
const DEFAULT_STATE_FILE = join(PROJECT_ROOT, '.dsh-bugfix', 'state.json')

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

async function main(): Promise<void> {
  const args = parseResetToPendingArgs(process.argv)
  const note = args.note ?? DEFAULT_RESET_NOTE
  const statePath = process.env.BUG_PLATFORM_STATE_FILE ?? DEFAULT_STATE_FILE
  const store = loadState(statePath)
  const ids = resolveResetTicketIds(args.ticketIds, store)

  const client = new BugPlatformClient({
    baseUrl: process.env.BUG_PLATFORM_BASE_URL ?? DEFAULT_BASE_URL,
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
