import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as BugPlatformAutofix from '../src/index.ts'

describe('bug-platform-autofix plugin', () => {
  it('exports an empty inject list and mapping helpers', () => {
    expect(BugPlatformAutofix.inject).toEqual([])
    expect(BugPlatformAutofix.name).toBe('bug-platform-autofix')
    expect(typeof BugPlatformAutofix.loadMenuMapping).toBe('function')
    expect(typeof BugPlatformAutofix.resolveMenu).toBe('function')
  })

  it('accepts fully defaulted Config in apply', () => {
    const config = BugPlatformAutofix.Config({})
    expect(() => BugPlatformAutofix.apply(new Context(), config)).not.toThrow()
    expect(config.mappingFile).toBe('')
  })
})
