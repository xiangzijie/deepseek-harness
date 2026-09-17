/**
 * Terminal + on-disk progress for a serial autofix ticket queue.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** Default heartbeat interval while a ticket is in flight. */
export const DEFAULT_HEARTBEAT_MS = 30_000

/** One finished ticket in {@link ProgressSnapshot.completed}. */
export interface ProgressCompletedEntry {
  ticketId: number
  index: number
  total: number
  summary: string
}

/** In-flight ticket pointer. */
export interface ProgressCurrent {
  ticketId: number
  index: number
  total: number
  /** ISO-8601 start time. */
  startedAt: string
}

/** On-disk JSON document for operators to `type` / poll. */
export interface ProgressSnapshot {
  runId: string
  mode: string
  queue: number[]
  pending: number[]
  current: ProgressCurrent | null
  completed: ProgressCompletedEntry[]
  updatedAt: string
}

/** Injectable deps for tests. */
export interface BatchProgressOptions {
  /** Absolute path to `progress.json`. */
  path: string
  /** Full ticket id queue for this run/round. */
  queue: readonly number[]
  /** Line sink (defaults to stdout). */
  writeLine?: (line: string) => void
  /** Clock in ms (defaults to Date.now). */
  now?: () => number
  /**
   * Heartbeat period while `current` is set.
   * `0` or negative disables the timer.
   */
  heartbeatMs?: number
}

/**
 * Tracks queue / current / completed for one serial run, printing lines and
 * rewriting {@link BatchProgressOptions.path}.
 */
export class BatchProgress {
  private readonly path: string
  private readonly queue: number[]
  private readonly writeLine: (line: string) => void
  private readonly now: () => number
  private readonly heartbeatMs: number
  private mode = 'unknown'
  private runId = ''
  private pending: number[] = []
  private current: ProgressCurrent | null = null
  private completed: ProgressCompletedEntry[] = []
  private startedAtMs = 0
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined

  /**
   * @param options - path, queue, and optional sinks.
   */
  constructor(options: BatchProgressOptions) {
    this.path = options.path
    this.queue = [...options.queue]
    this.writeLine = options.writeLine ?? ((line) => {
      process.stdout.write(`${line}\n`)
    })
    this.now = options.now ?? (() => Date.now())
    this.heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS
  }

  /**
   * Print the queue and persist the initial snapshot.
   * @param mode - short label (`force` / `whitelist` / …).
   */
  beginRun(mode: string): void {
    this.mode = mode
    this.runId = `${mode}-${this.now()}`
    this.pending = [...this.queue]
    this.current = null
    this.completed = []
    this.writeLine(
      this.queue.length === 0
        ? '队列 0 单（空）'
        : `队列 ${this.queue.length} 单: ${this.queue.join(', ')}`,
    )
    this.persist()
  }

  /**
   * Mark a ticket as in flight (must be next pending head or still in pending).
   * @param ticketId - platform ticket id.
   */
  startTicket(ticketId: number): void {
    const total = this.queue.length
    const index = this.queue.indexOf(ticketId) + 1
    this.pending = this.pending.filter(id => id !== ticketId)
    this.startedAtMs = this.now()
    this.current = {
      ticketId,
      index: index > 0 ? index : this.completed.length + 1,
      total,
      startedAt: new Date(this.startedAtMs).toISOString(),
    }
    this.writeLine(
      `[${this.current.index}/${total}] 开始 #${ticketId}` +
        (this.pending.length > 0 ? `；待处理: ${this.pending.join(', ')}` : '；待处理: (无)'),
    )
    this.persist()
    this.startHeartbeat()
  }

  /**
   * Clear current, append completed, stop heartbeat.
   * @param ticketId - platform ticket id (must match current when set).
   * @param summary - one-line outcome text.
   */
  finishTicket(ticketId: number, summary: string): void {
    this.stopHeartbeat()
    const total = this.queue.length
    const index =
      this.current?.ticketId === ticketId
        ? this.current.index
        : this.queue.indexOf(ticketId) + 1
    this.completed.push({
      ticketId,
      index: index > 0 ? index : this.completed.length + 1,
      total,
      summary,
    })
    this.current = null
    this.writeLine(`[${index > 0 ? index : '?'}/${total}] 结束 #${ticketId} → ${summary}`)
    this.persist()
  }

  /** Stop heartbeat if still running (e.g. process shutdown mid-ticket). */
  dispose(): void {
    this.stopHeartbeat()
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    if (this.heartbeatMs <= 0) return
    this.heartbeatTimer = setInterval(() => {
      if (this.current === null) return
      const elapsedSec = Math.max(0, Math.floor((this.now() - this.startedAtMs) / 1000))
      this.writeLine(
        `仍在处理 #${this.current.ticketId}（已进行 ${elapsedSec}s）；待处理: ${
          this.pending.length > 0 ? this.pending.join(', ') : '(无)'
        }`,
      )
    }, this.heartbeatMs)
    // Allow the process to exit naturally while the timer is armed.
    if (typeof this.heartbeatTimer === 'object' && 'unref' in this.heartbeatTimer) {
      this.heartbeatTimer.unref()
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer === undefined) return
    clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = undefined
  }

  private persist(): void {
    const snapshot: ProgressSnapshot = {
      runId: this.runId,
      mode: this.mode,
      queue: [...this.queue],
      pending: [...this.pending],
      current: this.current,
      completed: [...this.completed],
      updatedAt: new Date(this.now()).toISOString(),
    }
    mkdirSync(dirname(this.path), { recursive: true })
    writeFileSync(this.path, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
  }
}
