/**
 * CLI argv parsing for `examples/bug-platform-autofix/run-once.ts`.
 */

/** Env var naming the operator.yaml path when `--config` is omitted. */
export const OPERATOR_CONFIG_ENV = 'BUG_PLATFORM_OPERATOR_FILE'

/** Parsed flags for one run-once invocation. */
export interface RunOnceArgs {
  /**
   * Forced ticket ids (each bypasses list status whitelist).
   * Empty means list-selection batch mode via {@link RunOnceArgs.maxTickets}.
   */
  ticketIds: number[]
  /**
   * Batch size for list selection. Omitted when `--max` is absent so the caller
   * can use `operator.yaml` `run.maxTickets`. Unused when `ticketIds` is non-empty.
   */
  maxTickets?: number
  /**
   * Path from `--config`. Resolution against {@link OPERATOR_CONFIG_ENV} happens
   * in {@link resolveOperatorConfigPath}, not here.
   */
  configPath?: string
  /** Optional comma-separated list status filter for {@link runBatch}. */
  status?: string
  /**
   * When set, run whitelist batches in a loop, sleeping this many seconds
   * between rounds. Incompatible with `--ticket` / `--tickets` and with
   * `--continuous`.
   */
  pollIntervalSeconds?: number
  /**
   * When true, keep pulling batches of {@link RunOnceArgs.maxTickets}: process
   * them serially, then fetch the next batch immediately (no fixed timer).
   * Empty batches wait {@link DEFAULT_EMPTY_BATCH_BACKOFF_SECONDS} before retry.
   * Incompatible with `--ticket` / `--tickets` and with `--poll-interval`.
   */
  continuous?: boolean
  /**
   * When true, a HEAD that does not match `origin/main` is allowed for the
   * global skill clone. Dirty `manifest.yaml` or force skill files still refuse.
   */
  allowStaleGlobalSkills?: boolean
}

/** Default idle wait when `--continuous` sees an empty candidate batch. */
export const DEFAULT_EMPTY_BATCH_BACKOFF_SECONDS = 60

/**
 * Parse `--config`, `--ticket`, `--tickets`, `--max`, `--status`, `--poll-interval`,
 * `--continuous`, and `--allow-stale-global-skills` from `process.argv`-style args.
 * Force paths (`--ticket` / `--tickets`) are mutually exclusive with `--max`,
 * `--poll-interval`, and `--continuous`.
 * @param argv - full argv including node and script path.
 * @returns normalized run-once flags.
 */
export function parseRunOnceArgs(argv: readonly string[]): RunOnceArgs {
  const ticketRaw = flagValue(argv, '--ticket')
  const ticketsRaw = flagValue(argv, '--tickets')
  const maxRaw = flagValue(argv, '--max')
  const configRaw = flagValue(argv, '--config')
  const statusRaw = flagValue(argv, '--status')
  const pollRaw = flagValue(argv, '--poll-interval')
  const continuous = argv.includes('--continuous')
  const allowStaleGlobalSkills = argv.includes('--allow-stale-global-skills')

  if (ticketRaw !== undefined && ticketsRaw !== undefined) {
    throw new Error('不能同时使用 --ticket 与 --tickets：单用 --ticket <id>，多用 --tickets <id,id,…>')
  }

  const ticketIds =
    ticketRaw !== undefined
      ? [parsePositiveInt(ticketRaw, '--ticket', '例如 --ticket 428')]
      : ticketsRaw !== undefined
        ? parseTicketIdList(ticketsRaw)
        : []

  if (ticketIds.length > 0 && maxRaw !== undefined) {
    throw new Error(
      '不能同时使用强制单号（--ticket/--tickets）与 --max：强制列表用前者，白名单跑批用 --max',
    )
  }

  const result: RunOnceArgs = { ticketIds }
  if (maxRaw !== undefined) {
    result.maxTickets = parsePositiveInt(maxRaw, '--max')
  }
  if (configRaw !== undefined) {
    result.configPath = configRaw
  }
  if (statusRaw !== undefined) {
    if (statusRaw.length === 0) {
      throw new Error('--status 需要非空字符串，例如 --status 待确认,验证未通过,转派,转需求')
    }
    if (ticketIds.length > 0) {
      throw new Error('--status 仅用于白名单跑批，不能与 --ticket/--tickets 同用')
    }
    result.status = statusRaw
  }

  if (pollRaw !== undefined && continuous) {
    throw new Error('不能同时使用 --poll-interval 与 --continuous：定时休眠用前者，批完即拉下一批用后者')
  }

  if (pollRaw !== undefined) {
    if (ticketIds.length > 0) {
      throw new Error('--poll-interval 仅用于白名单守护循环，不能与 --ticket/--tickets 同用')
    }
    result.pollIntervalSeconds = parsePositiveInt(
      pollRaw,
      '--poll-interval',
      '例如 --poll-interval 300（秒）',
    )
  }

  if (continuous) {
    if (ticketIds.length > 0) {
      throw new Error('--continuous 仅用于白名单守护循环，不能与 --ticket/--tickets 同用')
    }
    result.continuous = true
  }

  if (allowStaleGlobalSkills) {
    result.allowStaleGlobalSkills = true
  }

  return result
}

/**
 * Resolve operator.yaml: `--config` wins over env {@link OPERATOR_CONFIG_ENV}.
 * @param configPath - parsed `--config` value, or undefined when the flag is omitted.
 * @returns a non-empty path.
 * @throws {Error} when both the flag and env are missing or blank.
 */
export function resolveOperatorConfigPath(configPath: string | undefined): string {
  const fromFlag = configPath?.trim()
  if (fromFlag !== undefined && fromFlag.length > 0) {
    return fromFlag
  }
  const fromEnv = process.env[OPERATOR_CONFIG_ENV]?.trim()
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return fromEnv
  }
  throw new Error('缺少 operator.yaml：请传 --config <path> 或设置 BUG_PLATFORM_OPERATOR_FILE')
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
