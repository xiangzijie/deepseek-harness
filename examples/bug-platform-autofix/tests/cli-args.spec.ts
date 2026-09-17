import { afterEach, describe, expect, it } from 'vitest'
import { parseRunOnceArgs, resolveOperatorConfigPath } from '../src/cli-args.ts'

describe('parseRunOnceArgs', () => {
  it('defaults to empty ticketIds and omits maxTickets and configPath', () => {
    expect(parseRunOnceArgs(['node', 'run-once.ts'])).toEqual({
      ticketIds: [],
    })
    expect(parseRunOnceArgs(['node', 'run-once.ts']).configPath).toBeUndefined()
    expect(parseRunOnceArgs(['node', 'run-once.ts']).maxTickets).toBeUndefined()
  })

  it('parses --config', () => {
    expect(parseRunOnceArgs(['node', 'run-once.ts', '--config', 'D:/op.yaml', '--max', '1']).configPath)
      .toBe('D:/op.yaml')
  })

  it('rejects --config without a path', () => {
    expect(() => parseRunOnceArgs(['node', 'run-once.ts', '--config'])).toThrow(/--config/)
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
    })
  })

  it('parses --tickets as comma-separated forced ids', () => {
    expect(parseRunOnceArgs(['node', 'run-once.ts', '--tickets', '428,430,441'])).toEqual({
      ticketIds: [428, 430, 441],
    })
  })

  it('deduplicates --tickets while preserving order', () => {
    expect(parseRunOnceArgs(['node', 'run-once.ts', '--tickets', '1,2,1,3'])).toEqual({
      ticketIds: [1, 2, 3],
    })
  })

  it('parses --status for list filter', () => {
    expect(parseRunOnceArgs(['node', 'run-once.ts', '--max', '3', '--status', '待确认,验证未通过'])).toEqual({
      ticketIds: [],
      maxTickets: 3,
      status: '待确认,验证未通过',
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
    ).toThrow(/不能同时使用 --ticket 与 --tickets/)
  })

  it('parses --poll-interval seconds for daemon mode', () => {
    expect(parseRunOnceArgs(['node', 'run-once.ts', '--poll-interval', '300', '--max', '1'])).toEqual({
      ticketIds: [],
      maxTickets: 1,
      pollIntervalSeconds: 300,
    })
  })

  it('parses --continuous for immediate next-batch mode', () => {
    expect(parseRunOnceArgs(['node', 'run-once.ts', '--max', '20', '--continuous'])).toEqual({
      ticketIds: [],
      maxTickets: 20,
      continuous: true,
    })
  })

  it('parses --allow-stale-global-skills', () => {
    expect(
      parseRunOnceArgs(['node', 'run-once.ts', '--max', '1', '--allow-stale-global-skills']),
    ).toEqual({
      ticketIds: [],
      maxTickets: 1,
      allowStaleGlobalSkills: true,
    })
  })

  it('rejects --poll-interval together with --continuous', () => {
    expect(() =>
      parseRunOnceArgs(['node', 'run-once.ts', '--poll-interval', '60', '--continuous']),
    ).toThrow(/不能同时使用 --poll-interval 与 --continuous/)
  })

  it('rejects --poll-interval with --ticket', () => {
    expect(() =>
      parseRunOnceArgs(['node', 'run-once.ts', '--poll-interval', '60', '--ticket', '428']),
    ).toThrow(/--poll-interval/)
  })

  it('rejects --continuous with --ticket', () => {
    expect(() =>
      parseRunOnceArgs(['node', 'run-once.ts', '--continuous', '--ticket', '428']),
    ).toThrow(/--continuous/)
  })

  it('rejects non-positive --poll-interval', () => {
    expect(() => parseRunOnceArgs(['node', 'run-once.ts', '--poll-interval', '0'])).toThrow(
      /--poll-interval/,
    )
  })
})

describe('resolveOperatorConfigPath', () => {
  const original = process.env.BUG_PLATFORM_OPERATOR_FILE

  afterEach(() => {
    if (original === undefined) {
      delete process.env.BUG_PLATFORM_OPERATOR_FILE
    } else {
      process.env.BUG_PLATFORM_OPERATOR_FILE = original
    }
  })

  it('uses env when the flag is omitted', () => {
    process.env.BUG_PLATFORM_OPERATOR_FILE = 'D:/from-env.yaml'
    expect(resolveOperatorConfigPath(undefined)).toBe('D:/from-env.yaml')
  })

  it('prefers --config over env', () => {
    process.env.BUG_PLATFORM_OPERATOR_FILE = 'D:/from-env.yaml'
    expect(resolveOperatorConfigPath('D:/from-flag.yaml')).toBe('D:/from-flag.yaml')
  })

  it('throws when both flag and env are missing', () => {
    delete process.env.BUG_PLATFORM_OPERATOR_FILE
    expect(() => resolveOperatorConfigPath(undefined)).toThrow(
      /缺少 operator.yaml：请传 --config <path> 或设置 BUG_PLATFORM_OPERATOR_FILE/,
    )
  })
})
