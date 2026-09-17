import { describe, expect, it, vi } from 'vitest'
import { TicketStateStore, type TicketRecord } from '@deepseek-ai/dsh-bug-platform-autofix'
import {
  DEFAULT_RESET_NOTE,
  RESET_TARGET_STATUS,
  resetTicketsToPending,
  resolveResetTicketIds,
} from '../src/reset-to-pending-core.ts'

function sample(overrides: Partial<TicketRecord> = {}): TicketRecord {
  return {
    ticketId: 1,
    phase: 'failed',
    repo: 'custom',
    branch: 'bugfix/1',
    updatedAt: '2026-09-11T00:00:00.000Z',
    ...overrides,
  }
}

describe('resolveResetTicketIds', () => {
  it('prefers explicit --tickets over local failed rows', () => {
    const store = new TicketStateStore([sample({ ticketId: 10, phase: 'failed' })])
    expect(resolveResetTicketIds([428, 430], store)).toEqual([428, 430])
  })

  it('collects phase=failed ids when no explicit list', () => {
    const store = new TicketStateStore([
      sample({ ticketId: 2, phase: 'failed' }),
      sample({ ticketId: 3, phase: 'done' }),
      sample({ ticketId: 1, phase: 'failed' }),
    ])
    expect(resolveResetTicketIds([], store)).toEqual([1, 2])
  })

  it('throws when neither explicit ids nor failed rows exist', () => {
    const store = new TicketStateStore([sample({ phase: 'done' })])
    expect(() => resolveResetTicketIds([], store)).toThrow(/没有可重置/)
  })
})

describe('resetTicketsToPending', () => {
  it('writes 待确认 followups, removes local rows, and continues after errors', async () => {
    const store = new TicketStateStore([
      sample({ ticketId: 1 }),
      sample({ ticketId: 2 }),
      sample({ ticketId: 3 }),
    ])
    const calls: Array<{ id: number; body: unknown }> = []
    const persist = vi.fn()
    const client = {
      createFollowup: async (id: number, body: unknown) => {
        calls.push({ id, body })
        if (id === 2) throw new Error('boom')
      },
    }

    const result = await resetTicketsToPending({
      ids: [1, 2, 3],
      client,
      store,
      note: DEFAULT_RESET_NOTE,
      persist,
    })

    expect(calls).toEqual([
      {
        id: 1,
        body: {
          content: DEFAULT_RESET_NOTE,
          status_change: RESET_TARGET_STATUS,
          assignee_change: null,
        },
      },
      {
        id: 2,
        body: {
          content: DEFAULT_RESET_NOTE,
          status_change: RESET_TARGET_STATUS,
          assignee_change: null,
        },
      },
      {
        id: 3,
        body: {
          content: DEFAULT_RESET_NOTE,
          status_change: RESET_TARGET_STATUS,
          assignee_change: null,
        },
      },
    ])
    expect(result.ok).toEqual([1, 3])
    expect(result.failed).toEqual([{ id: 2, error: 'boom' }])
    expect(store.get(1)).toBeUndefined()
    expect(store.get(2)?.phase).toBe('failed')
    expect(store.get(3)).toBeUndefined()
    expect(persist).toHaveBeenCalledTimes(2)
  })
})
