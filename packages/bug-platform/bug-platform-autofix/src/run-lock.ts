/**
 * Exclusive run mutex for one `progress.json` directory.
 * The lock file is `dirname(progressFile)/run.lock`, not `progress.json` itself.
 * @module @deepseek-ai/dsh-bug-platform-autofix/run-lock
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Durable lock document stored at {@link runLockPath}. */
export interface RunLockInfo {
  pid: number
  startedAt: string
  configPath: string
}

/**
 * Fields written to `run.lock` plus the operator-facing `progress.json` path
 * cited when a live holder blocks acquire.
 */
export interface AcquireRunLockOptions extends RunLockInfo {
  /**
   * Absolute path to `progress.json`. Cited in live-holder errors; omitted from
   * the lock JSON. When omitted, the error cites `dirname(lockPath)/progress.json`.
   */
  progressFile?: string
}

/**
 * @param progressFile - absolute path to `progress.json`.
 * @returns `dirname(progressFile)/run.lock`.
 */
export function runLockPath(progressFile: string): string {
  return join(dirname(progressFile), 'run.lock')
}

/**
 * Read the lock document when it exists and is well-formed.
 * @param path - absolute path to `run.lock`.
 * @returns the lock object, or `undefined` when the file is missing, unreadable, or invalid.
 */
export function readRunLock(path: string): RunLockInfo | undefined {
  if (!existsSync(path)) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')) as unknown
  } catch {
    // Unreadable or non-JSON lock is treated as absent so a live acquirer can replace it.
    return undefined
  }
  return parseRunLock(parsed)
}

/**
 * Acquire exclusive ownership of `path`. A live holder pid throws; a dead pid is replaced.
 * @param path - absolute path to `run.lock`.
 * @param info - pid / timestamps written to disk, plus optional `progressFile` for errors.
 * @returns a function that deletes this process's lock file.
 * @throws when another live pid already holds the lock.
 */
export function acquireRunLock(path: string, info: AcquireRunLockOptions): () => void {
  mkdirSync(dirname(path), { recursive: true })
  const existing = readRunLock(path)
  if (existing !== undefined && isPidAlive(existing.pid)) {
    const progressFile = info.progressFile ?? join(dirname(path), 'progress.json')
    throw new Error(`已有跑批（pid=${existing.pid}），progressFile=${progressFile}`)
  }
  const record: RunLockInfo = {
    pid: info.pid,
    startedAt: info.startedAt,
    configPath: info.configPath,
  }
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  return () => {
    releaseRunLock(path, info.pid)
  }
}

/**
 * @param raw - parsed JSON root.
 * @returns a lock record, or undefined when required fields are missing or mistyped.
 */
function parseRunLock(raw: unknown): RunLockInfo | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const rec = raw as Record<string, unknown>
  if (typeof rec.pid !== 'number' || !Number.isInteger(rec.pid)) return undefined
  if (typeof rec.startedAt !== 'string' || typeof rec.configPath !== 'string') return undefined
  return { pid: rec.pid, startedAt: rec.startedAt, configPath: rec.configPath }
}

/**
 * Probe whether `pid` still exists. `ESRCH` is dead; `EPERM` is live and must not be stolen.
 * @param pid - process id from the lock file.
 * @returns true when the process is treated as live.
 */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ESRCH') return false
    /* v8 ignore start -- EPERM means the pid exists but cannot be signalled; other errno values are unexpected. */
    if (code === 'EPERM') return true
    throw error
    /* v8 ignore stop */
  }
}

/**
 * Delete the lock file when it still belongs to `pid`.
 * @param path - absolute path to `run.lock`.
 * @param pid - pid that acquired the lock.
 */
function releaseRunLock(path: string, pid: number): void {
  const current = readRunLock(path)
  if (current !== undefined && current.pid !== pid) return
  try {
    unlinkSync(path)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      // Lock file already gone (prior release or a crash leftover cleaned elsewhere).
      return
    }
    /* v8 ignore start -- unlink failures other than ENOENT must surface. */
    throw error
    /* v8 ignore stop */
  }
}
