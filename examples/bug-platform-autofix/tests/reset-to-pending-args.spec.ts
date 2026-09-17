import { describe, expect, it } from 'vitest'
import { parseResetToPendingArgs } from '../src/reset-to-pending-args.ts'

describe('parseResetToPendingArgs', () => {
  it('defaults to empty ticketIds and no note', () => {
    const args = parseResetToPendingArgs(['node', 'reset-to-pending.ts'])
    expect(args).toEqual({
      ticketIds: [],
    })
    expect(args.configPath).toBeUndefined()
  })

  it('parses --config', () => {
    expect(
      parseResetToPendingArgs(['node', 'reset-to-pending.ts', '--config', 'D:/op.yaml']).configPath,
    ).toBe('D:/op.yaml')
  })

  it('rejects --config without a path', () => {
    expect(() => parseResetToPendingArgs(['node', 'reset-to-pending.ts', '--config'])).toThrow(
      /--config/,
    )
  })

  it('parses --tickets and --note', () => {
    expect(
      parseResetToPendingArgs([
        'node',
        'reset-to-pending.ts',
        '--tickets',
        '428,430',
        '--note',
        '自定义说明',
      ]),
    ).toEqual({
      ticketIds: [428, 430],
      note: '自定义说明',
    })
  })

  it('rejects empty --note', () => {
    expect(() =>
      parseResetToPendingArgs(['node', 'reset-to-pending.ts', '--note', '']),
    ).toThrow(/--note/)
  })

  it('rejects empty --tickets list', () => {
    expect(() =>
      parseResetToPendingArgs(['node', 'reset-to-pending.ts', '--tickets', ', ,']),
    ).toThrow(/--tickets/)
  })
})
