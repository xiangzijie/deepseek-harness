/**
 * CLI argv parsing for `reset-to-pending.ts`.
 */

/** Parsed flags for one reset-to-pending invocation. */
export interface ResetToPendingArgs {
  /**
   * Explicit ticket ids. Empty means pick `phase=failed` from local state.
   */
  ticketIds: number[]
  /**
   * Path from `--config`. Omitted flag leaves this undefined; the caller
   * resolves `--config` vs env `BUG_PLATFORM_OPERATOR_FILE`.
   */
  configPath?: string
  /** Follow-up note body (default applied by the caller when omitted). */
  note?: string
}

/**
 * Parse `--config`, `--tickets`, and `--note` from `process.argv`-style args.
 * @param argv - full argv including node and script path.
 * @returns normalized reset flags.
 */
export function parseResetToPendingArgs(argv: readonly string[]): ResetToPendingArgs {
  const ticketsRaw = flagValue(argv, '--tickets')
  const noteRaw = flagValue(argv, '--note')
  const configRaw = flagValue(argv, '--config')

  const ticketIds = ticketsRaw !== undefined ? parseTicketIdList(ticketsRaw) : []

  const result: ResetToPendingArgs = { ticketIds }
  if (configRaw !== undefined) {
    result.configPath = configRaw
  }
  if (noteRaw !== undefined) {
    if (noteRaw.length === 0) {
      throw new Error('--note 需要非空字符串')
    }
    result.note = noteRaw
  }
  return result
}

/**
 * @param raw - comma-separated positive integers (spaces allowed around commas).
 * @returns deduplicated ids in first-seen order.
 */
function parseTicketIdList(raw: string): number[] {
  const parts = raw.split(',').map(part => part.trim()).filter(part => part.length > 0)
  if (parts.length === 0) {
    throw new Error('--tickets 需要至少一个正整数 id，例如 --tickets 428,430,441')
  }
  const ids: number[] = []
  const seen = new Set<number>()
  for (const part of parts) {
    const id = parsePositiveInt(part, '--tickets', '例如 --tickets 428,430,441')
    if (seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

/**
 * @param argv - argv slice.
 * @param flag - flag name including leading dashes.
 * @returns the following token, or undefined when the flag is absent.
 */
function flagValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag)
  if (index === -1) return undefined
  const raw = argv[index + 1]
  if (raw === undefined || raw.startsWith('-')) {
    throw new Error(`${flag} 需要一个参数`)
  }
  return raw
}

/**
 * @param raw - token after a flag.
 * @param flag - flag name for errors.
 * @param hint - optional extra hint text.
 * @returns a positive integer.
 */
function parsePositiveInt(raw: string, flag: string, hint?: string): number {
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) {
    const extra = hint === undefined ? '' : `，${hint}`
    throw new Error(`${flag} 必须是正整数，收到: ${raw}${extra}`)
  }
  return value
}
