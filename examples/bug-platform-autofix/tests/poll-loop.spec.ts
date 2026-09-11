import { describe, expect, it, vi } from 'vitest'
import { runPollLoop } from '../src/poll-loop.ts'

describe('runPollLoop', () => {
  it('runs rounds until shouldContinue becomes false, sleeping between them', async () => {
    let rounds = 0
    const sleep = vi.fn(async () => undefined)
    await runPollLoop(1000, {
      runRound: async () => {
        rounds += 1
      },
      sleep,
      shouldContinue: () => rounds < 3,
    })
    expect(rounds).toBe(3)
    expect(sleep).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(1000)
  })

  it('continues after round errors when onRoundError is provided', async () => {
    let rounds = 0
    const errors: unknown[] = []
    await runPollLoop(10, {
      runRound: async () => {
        rounds += 1
        if (rounds === 1) throw new Error('transient')
      },
      sleep: async () => undefined,
      shouldContinue: () => rounds < 2,
      onRoundError: (error) => {
        errors.push(error)
      },
    })
    expect(rounds).toBe(2)
    expect(String(errors[0])).toMatch(/transient/)
  })

  it('rejects non-positive interval', async () => {
    await expect(
      runPollLoop(0, {
        runRound: async () => undefined,
        sleep: async () => undefined,
        shouldContinue: () => false,
      }),
    ).rejects.toThrow(/intervalMs/)
  })
})
