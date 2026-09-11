import { describe, expect, it, vi } from 'vitest'
import { runPollLoop } from '../src/poll-loop.ts'

describe('runPollLoop', () => {
  it('runs rounds until shouldContinue becomes false; skips sleep when delay is 0', async () => {
    let rounds = 0
    const sleep = vi.fn(async () => undefined)
    await runPollLoop({
      runRound: async () => {
        rounds += 1
        return 2
      },
      sleep,
      delayMsAfterRound: () => 0,
      shouldContinue: () => rounds < 3,
    })
    expect(rounds).toBe(3)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('sleeps when delayMsAfterRound returns a positive delay (e.g. empty batch)', async () => {
    let rounds = 0
    const sleep = vi.fn(async () => undefined)
    await runPollLoop({
      runRound: async () => {
        rounds += 1
        return 0
      },
      sleep,
      delayMsAfterRound: processed => (processed === 0 ? 1000 : 0),
      shouldContinue: () => rounds < 2,
    })
    expect(rounds).toBe(2)
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(sleep).toHaveBeenCalledWith(1000)
  })

  it('continues after round errors when onRoundError is provided', async () => {
    let rounds = 0
    const errors: unknown[] = []
    await runPollLoop({
      runRound: async () => {
        rounds += 1
        if (rounds === 1) throw new Error('transient')
        return 1
      },
      sleep: async () => undefined,
      delayMsAfterRound: () => 0,
      shouldContinue: () => rounds < 2,
      onRoundError: (error) => {
        errors.push(error)
      },
    })
    expect(rounds).toBe(2)
    expect(String(errors[0])).toMatch(/transient/)
  })
})
