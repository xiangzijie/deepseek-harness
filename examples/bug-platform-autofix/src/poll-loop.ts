/**
 * Serial poll / continuous batch loop for bug-platform autofix daemon mode.
 */

/** Dependencies for {@link runPollLoop} (injectable for tests). */
export interface PollLoopDeps {
  /**
   * One batch round (claim/fix/save belongs to the caller).
   * @returns claimed (non-skipped) count for this round (0 = empty or all skipped).
   */
  runRound: () => Promise<number>
  /** Sleep between rounds; tests inject a no-op or fake clock. */
  sleep: (ms: number) => Promise<void>
  /**
   * Delay after a round. Return 0 to start the next round immediately
   * (typical when the previous round claimed tickets).
   * @param processed - claimed count from the round that just finished.
   */
  delayMsAfterRound: (processed: number) => number
  /** Return false to stop after the current round finishes (SIGINT). */
  shouldContinue: () => boolean
  /** Called when a round throws; loop continues unless the handler rethrows. */
  onRoundError?: (error: unknown) => void
  /** Optional hook after a successful round (logging). */
  onRoundComplete?: (processed: number) => void
}

/**
 * Repeat `runRound` until `shouldContinue` is false.
 * After each round, sleeps `delayMsAfterRound(processed)` ms (0 = immediate next batch).
 * Round errors go to `onRoundError` and do not abort unless that handler throws.
 * @param deps - injectable round/sleep/stop hooks.
 */
export async function runPollLoop(deps: PollLoopDeps): Promise<void> {
  while (deps.shouldContinue()) {
    let processed = 0
    try {
      processed = await deps.runRound()
      deps.onRoundComplete?.(processed)
    } catch (error) {
      if (deps.onRoundError === undefined) {
        throw error
      }
      deps.onRoundError(error)
    }
    if (!deps.shouldContinue()) break
    const delayMs = deps.delayMsAfterRound(processed)
    if (!Number.isInteger(delayMs) || delayMs < 0) {
      throw new Error(`delayMsAfterRound 必须返回非负整数，收到: ${delayMs}`)
    }
    if (delayMs > 0) {
      await deps.sleep(delayMs)
    }
  }
}
