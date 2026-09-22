import { describe, expect, it } from 'vitest'
import type { TicketOutcome } from '@deepseek-ai/dsh-bug-platform-autofix'
import { claimedOutcomeCount } from '../src/claimed-outcome-count.ts'

describe('claimedOutcomeCount', () => {
  it('returns 0 for an empty outcomes list (empty queue)', () => {
    expect(claimedOutcomeCount([])).toBe(0)
  })

  it('excludes pre-claim skips so continuous empty-batch backoff can trigger', () => {
    const outcomes: TicketOutcome[] = [
      { kind: 'skipped', reason: '无需改前端' },
      { kind: 'skipped', reason: '描述过短' },
    ]
    expect(claimedOutcomeCount(outcomes)).toBe(0)
  })

  it('counts claimed outcomes including later failed/done', () => {
    const outcomes: TicketOutcome[] = [
      { kind: 'skipped', reason: '无需改前端' },
      { kind: 'done', mrUrl: 'https://example/mr/1' },
      { kind: 'failed', reason: 'agent error' },
      { kind: 'awaiting_push', branch: 'bugfix/1', commitSha: 'abc' },
    ]
    expect(claimedOutcomeCount(outcomes)).toBe(3)
  })
})
