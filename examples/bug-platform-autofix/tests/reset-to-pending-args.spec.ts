import { describe, expect, it } from 'vitest'
import { parseResetToPendingArgs } from '../src/reset-to-pending-args.ts'

describe('parseResetToPendingArgs', () => {
  it('defaults to empty ticketIds and no note', () => {
    expect(parseResetToPendingArgs(['node', 'reset-to-pending.ts'])).toEqual({
      ticketIds: [],
    })
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
