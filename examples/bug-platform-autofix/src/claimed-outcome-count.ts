import type { TicketOutcome } from '@deepseek-ai/dsh-bug-platform-autofix'

/**
 * Count outcomes that occupied a maxTickets slot (not pre-claim skips).
 * Used by `--continuous` empty-batch backoff: only skipped outcomes → 0 → backoff.
 * @param outcomes - batch ticket outcomes from {@link runBatch} / one round.
 * @returns number of non-`skipped` outcomes (claimed including later failed/done).
 */
export function claimedOutcomeCount(outcomes: readonly TicketOutcome[]): number {
  return outcomes.filter(o => o.kind !== 'skipped').length
}
