import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as BugPlatformAutofix from '../src/index.ts'

describe('bug-platform-autofix plugin', () => {
  it('exports an empty inject list and selection helpers', () => {
    expect(BugPlatformAutofix.inject).toEqual([])
    expect(BugPlatformAutofix.name).toBe('bug-platform-autofix')
    expect(typeof BugPlatformAutofix.loadMenuMapping).toBe('function')
    expect(typeof BugPlatformAutofix.resolveMenu).toBe('function')
    expect(typeof BugPlatformAutofix.selectTickets).toBe('function')
    expect(typeof BugPlatformAutofix.loadState).toBe('function')
    expect(typeof BugPlatformAutofix.saveState).toBe('function')
    expect(typeof BugPlatformAutofix.isActive).toBe('function')
    expect(BugPlatformAutofix.TicketStateStore).toBeTypeOf('function')
  })

  it('accepts fully defaulted Config in apply', () => {
    const config = BugPlatformAutofix.Config({})
    expect(() => BugPlatformAutofix.apply(new Context(), config)).not.toThrow()
    expect(config.mappingFile).toBe('')
  })
})
