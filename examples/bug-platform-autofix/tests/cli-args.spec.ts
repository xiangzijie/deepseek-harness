import { describe, expect, it } from 'vitest'
import { parseRunOnceArgs } from '../src/cli-args.ts'

describe('parseRunOnceArgs', () => {
  it('defaults to empty ticketIds and maxTickets 1 for list batch', () => {
    expect(parseRunOnceArgs(['node', 'run-once.ts'])).toEqual({
      ticketIds: [],
      maxTickets: 1,
    })
  })

  it('parses --max for batch size', () => {
    expect(parseRunOnceArgs(['node', 'run-once.ts', '--max', '5'])).toEqual({
      ticketIds: [],
      maxTickets: 5,
    })
  })

  it('parses --ticket into a one-element ticketIds list', () => {
    expect(parseRunOnceArgs(['node', 'run-once.ts', '--ticket', '428'])).toEqual({
      ticketIds: [428],
      maxTickets: 1,
    })
  })

  it('parses --tickets as comma-separated forced ids', () => {
    expect(parseRunOnceArgs(['node', 'run-once.ts', '--tickets', '428,430,441'])).toEqual({
      ticketIds: [428, 430, 441],
      maxTickets: 1,
    })
  })

  it('deduplicates --tickets while preserving order', () => {
    expect(parseRunOnceArgs(['node', 'run-once.ts', '--tickets', '1,2,1,3'])).toEqual({
      ticketIds: [1, 2, 3],
      maxTickets: 1,
    })
  })

  it('parses --status for list filter', () => {
    expect(parseRunOnceArgs(['node', 'run-once.ts', '--max', '3', '--status', '待确�?验证未通过'])).toEqual({
      ticketIds: [],
      maxTickets: 3,
      status: '待确�?验证未通过',
    })
  })

  it('rejects non-positive --max', () => {
    expect(() => parseRunOnceArgs(['node', 'run-once.ts', '--max', '0'])).toThrow(/--max/)
  })

  it('rejects --ticket together with --max', () => {
    expect(() => parseRunOnceArgs(['node', 'run-once.ts', '--ticket', '1', '--max', '3'])).toThrow(
      /不能同时使用/,
    )
  })

  it('rejects --tickets together with --max', () => {
    expect(() => parseRunOnceArgs(['node', 'run-once.ts', '--tickets', '1,2', '--max', '3'])).toThrow(
      /不能同时使用/,
    )
  })

  it('rejects --ticket together with --tickets', () => {
    expect(() =>
      parseRunOnceArgs(['node', 'run-once.ts', '--ticket', '1', '--tickets', '2,3']),
    ).toThrow(/不能同时使用 --ticket �?--tickets/)
  })

  it('rejects empty --tickets', () => {
    expect(() => parseRunOnceArgs(['node', 'run-once.ts', '--tickets', ''])).toThrow(/--tickets/)
  })
})
