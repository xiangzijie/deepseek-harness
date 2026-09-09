import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as BugPlatformHttpInvariant from '../src/invariant.ts'

describe('bug-platform-http invariant companion', () => {
  it('registers its explained empty runtime invariant', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = await ctx.plugin(BugPlatformHttpInvariant)

    expect(() => {
      ctx.invariants.register('@deepseek-ai/dsh-bug-platform-http', () => {})
    }).toThrow(/already registered/)
    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
