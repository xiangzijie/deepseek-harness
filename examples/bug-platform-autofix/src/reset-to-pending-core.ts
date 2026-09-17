/**
 * Pure helpers for batch-resetting bug-platform tickets to 待确认.
 */

import type { FollowupBody } from '@deepseek-ai/dsh-bug-platform-http'
import type { TicketStateStore } from '@deepseek-ai/dsh-bug-platform-autofix'

/** Platform status written by this ops tool. */
export const RESET_TARGET_STATUS = '待确认'

/** Default follow-up when the operator omits `--note`. */
export const DEFAULT_RESET_NOTE =
  '因工作区未就绪误领，已改回待确认，可重新自动修复'

/** Minimal client surface used by {@link resetTicketsToPending}. */
export interface ResetFollowupClient {
  /**
   * @param id - ticket id.
   * @param body - follow-up payload.
   */
  createFollowup(id: number, body: FollowupBody): Promise<void>
}

/** One failed id in a batch reset. */
export interface ResetFailure {
  id: number
  error: string
}

/** Aggregate result of {@link resetTicketsToPending}. */
export interface ResetBatchResult {
  ok: number[]
  failed: ResetFailure[]
}

/**
 * Resolve which tickets to reset.
 * Explicit `--tickets` wins; otherwise all local `phase=failed` ids.
 * @param explicitIds - ids from CLI (may be empty).
 * @param store - local idempotency store.
 * @returns ticket ids in a stable order.
 * @throws when neither explicit ids nor failed local records exist.
 */
export function resolveResetTicketIds(
  explicitIds: readonly number[],
  store: TicketStateStore,
): number[] {
  if (explicitIds.length > 0) {
    return [...explicitIds]
  }
  const fromFailed = store
    .list()
    .filter(record => record.phase === 'failed')
    .map(record => record.ticketId)
  if (fromFailed.length === 0) {
    throw new Error(
      '没有可重置的单号：请传 --tickets <id,id,…>，或确保 state.json 中有 phase=failed 的记录',
    )
  }
  return fromFailed
}

/**
 * Serially write 待确认 follow-ups and drop matching local state rows on success.
 * @param options - ids, client, store, and note body.
 * @returns per-id success / failure lists.
 */
export async function resetTicketsToPending(options: {
  ids: readonly number[]
  client: ResetFollowupClient
  store: TicketStateStore
  note: string
  /** Called after each successful follow-up so a crash mid-batch keeps prior removes. */
  persist?: () => void
}): Promise<ResetBatchResult> {
  const ok: number[] = []
  const failed: ResetFailure[] = []
  for (const id of options.ids) {
    try {
      await options.client.createFollowup(id, {
        content: options.note,
        status_change: RESET_TARGET_STATUS,
        assignee_change: null,
      })
      options.store.remove(id)
      options.persist?.()
      ok.push(id)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failed.push({ id, error: message })
    }
  }
  return { ok, failed }
}
