/**
 * Serial poll loop for bug-platform autofix daemon mode (phase-2 item 1).
 */

/** Dependencies for {@link runPollLoop} (injectable for tests). */
export interface PollLoopDeps {
  /** One batch round (claim/fix/save belongs to the caller). */
  runRound: () => Promise<void>
  /** Sleep between rounds; tests inject a no-op or fake clock. */
  sleep: (ms: number) => Promise<void>
  /** Return false to stop after the current round finishes (SIGINT). */
  shouldContinue: () => boolean
  /** Called when a round throws; loop continues unless the handler rethrows. */
  onRoundError?: (error: unknown) => void
  /** Optional hook after a successful round (logging). */
  onRoundComplete?: () => void
}

/**
 * Run `runRound` then sleep `intervalMs`, repeating until `shouldContinue` is false.
 * Errors in a round are reported via `onRoundError` and do not abort the loop
 * unless that handler throws.
 * @param intervalMs - delay after each round (including empty batches).
 * @param deps - injectable round/sleep/stop hooks.
 */
export async function runPollLoop(intervalMs: number, deps: PollLoopDeps): Promise<void> {
  if (!Number.isInteger(intervalMs) || intervalMs <= 0) {
    throw new Error(`poll intervalMs 必须是正整数，收到: ${intervalMs}`)
  }
  while (deps.shouldContinue()) {
    try {
      await deps.runRound()
      deps.onRoundComplete?.()
    } catch (error) {
      if (deps.onRoundError === undefined) {
        throw error
      }
      deps.onRoundError(error)
    }
    if (!deps.shouldContinue()) break
    await deps.sleep(intervalMs)
  }
}
