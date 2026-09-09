/**
 * Local ticket idempotency state for bug-platform autofix batches.
 * @module @deepseek-ai/dsh-bug-platform-autofix/ticket-state
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** Lifecycle phase recorded for a ticket after claim or repair attempt. */
export type TicketPhase = 'claimed' | 'fixing' | 'awaiting_push' | 'done' | 'failed'

/** One ticket's durable local record. */
export interface TicketRecord {
  ticketId: number
  phase: TicketPhase
  repo: 'custom' | 'ailpha'
  /** Feature branch name, typically `bugfix/<ticketId>`. */
  branch: string
  /** Merge-request URL when one was opened successfully. */
  mrUrl?: string
  /** ISO-8601 timestamp of the last upsert. */
  updatedAt: string
}

/** On-disk JSON document for {@link loadState} / {@link saveState}. */
interface TicketStateFile {
  tickets: TicketRecord[]
}

const ACTIVE_PHASES: ReadonlySet<TicketPhase> = new Set(['claimed', 'fixing', 'awaiting_push'])

/**
 * @param record - local ticket record.
 * @returns true when the ticket is still in an in-progress phase and must be skipped.
 */
export function isActive(record: TicketRecord): boolean {
  return ACTIVE_PHASES.has(record.phase)
}

/**
 * In-memory ticket state keyed by {@link TicketRecord.ticketId}.
 * Mutate via {@link TicketStateStore.upsert}; persist with {@link saveState}.
 */
export class TicketStateStore {
  private readonly byId = new Map<number, TicketRecord>()

  /**
   * @param records - optional seed records (later duplicates win by iteration order).
   */
  constructor(records: Iterable<TicketRecord> = []) {
    for (const record of records) {
      this.byId.set(record.ticketId, record)
    }
  }

  /**
   * @param ticketId - platform ticket id.
   * @returns the stored record, or undefined when absent.
   */
  get(ticketId: number): TicketRecord | undefined {
    return this.byId.get(ticketId)
  }

  /**
   * Insert or replace the record for {@link TicketRecord.ticketId}.
   * @param record - full record to store.
   */
  upsert(record: TicketRecord): void {
    this.byId.set(record.ticketId, record)
  }

  /**
   * @returns a stable snapshot of all records for serialization.
   */
  list(): TicketRecord[] {
    return [...this.byId.values()].sort((a, b) => a.ticketId - b.ticketId)
  }

  /**
   * @param ticketId - platform ticket id.
   * @returns true when a stored record exists and {@link isActive} is true.
   */
  isActiveTicket(ticketId: number): boolean {
    const record = this.byId.get(ticketId)
    return record !== undefined && isActive(record)
  }
}

/**
 * Load state from disk. A missing file yields an empty store.
 * @param path - absolute path to the JSON state file.
 * @returns loaded store.
 * @throws when the file exists but is not a valid ticket-state document.
 */
export function loadState(path: string): TicketStateStore {
  if (!existsSync(path)) {
    return new TicketStateStore()
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch (error) {
    // Re-throw with a stable prefix; keep the original parse error as cause.
    throw new Error(`ticket-state: failed to parse JSON at ${path}`, { cause: error })
  }
  return new TicketStateStore(parseStateFile(parsed))
}

/**
 * Persist the store to disk, creating parent directories when needed.
 * @param path - absolute path to the JSON state file.
 * @param state - store to serialize.
 */
export function saveState(path: string, state: TicketStateStore): void {
  mkdirSync(dirname(path), { recursive: true })
  const body: TicketStateFile = { tickets: state.list() }
  writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`, 'utf8')
}

/**
 * @param raw - parsed JSON root.
 * @returns validated ticket records.
 */
function parseStateFile(raw: unknown): TicketRecord[] {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('ticket-state: root must be a non-array object')
  }
  const tickets = (raw as Record<string, unknown>).tickets
  if (!Array.isArray(tickets)) {
    throw new Error('ticket-state: tickets must be an array')
  }
  return tickets.map((entry, index) => parseRecord(entry, index))
}

/**
 * @param raw - one tickets[] element.
 * @param index - array index for error messages.
 * @returns validated record.
 */
function parseRecord(raw: unknown, index: number): TicketRecord {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`ticket-state: tickets[${index}] must be an object`)
  }
  const row = raw as Record<string, unknown>
  const ticketId = row.ticketId
  if (typeof ticketId !== 'number' || !Number.isInteger(ticketId)) {
    throw new Error(`ticket-state: tickets[${index}].ticketId must be an integer`)
  }
  const phase = row.phase
  if (!isTicketPhase(phase)) {
    throw new Error(`ticket-state: tickets[${index}].phase is invalid`)
  }
  const repo = row.repo
  if (repo !== 'custom' && repo !== 'ailpha') {
    throw new Error(`ticket-state: tickets[${index}].repo must be custom|ailpha`)
  }
  const branch = row.branch
  if (typeof branch !== 'string' || branch.length === 0) {
    throw new Error(`ticket-state: tickets[${index}].branch must be a non-empty string`)
  }
  const updatedAt = row.updatedAt
  if (typeof updatedAt !== 'string' || updatedAt.length === 0) {
    throw new Error(`ticket-state: tickets[${index}].updatedAt must be a non-empty string`)
  }
  const record: TicketRecord = { ticketId, phase, repo, branch, updatedAt }
  if (row.mrUrl !== undefined) {
    if (typeof row.mrUrl !== 'string' || row.mrUrl.length === 0) {
      throw new Error(`ticket-state: tickets[${index}].mrUrl must be a non-empty string when set`)
    }
    record.mrUrl = row.mrUrl
  }
  return record
}

/**
 * @param value - candidate phase string.
 * @returns true when value is a {@link TicketPhase}.
 */
function isTicketPhase(value: unknown): value is TicketPhase {
  return (
    value === 'claimed' ||
    value === 'fixing' ||
    value === 'awaiting_push' ||
    value === 'done' ||
    value === 'failed'
  )
}
