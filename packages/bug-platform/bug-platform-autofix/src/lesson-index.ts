/**
 * Typed loader and query helpers for lessons `index.yaml`.
 * @module @deepseek-ai/dsh-bug-platform-autofix/lesson-index
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'

/** Lifecycle state of one indexed lesson row. */
export type LessonStatus = 'pending' | 'accepted' | 'optimize'

/** One row from lessons `index.yaml` (metadata only; bodies live in separate `.md` files). */
export interface LessonIndexRow {
  id: string
  status: LessonStatus
  target_menu: string
  symptom: string
  ticketId: number
  mrUrl: string
  updatedAt: string
  optimizeOf?: string
}

/** Parsed lessons index: query surface for inject and dedup without reading markdown bodies. */
export interface LessonIndex {
  lessons: LessonIndexRow[]
}

/** Maximum dedup candidates per menu loaded from the index. */
export const DEDUP_INDEX_CAP = 50

const LESSON_STATUSES: readonly LessonStatus[] = ['pending', 'accepted', 'optimize']

/**
 * Narrow yaml status to a known lesson status.
 * @param value - raw yaml field.
 * @returns true when value is pending, accepted, or optimize.
 */
function isLessonStatus(value: unknown): value is LessonStatus {
  return typeof value === 'string' && (LESSON_STATUSES as readonly string[]).includes(value)
}

/**
 * Parse one yaml lesson row; discard illegal rows without throwing.
 * @param raw - raw yaml array element.
 * @returns validated row or undefined when required fields or enums are invalid.
 */
function parseRow(raw: unknown): LessonIndexRow | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined
  }
  const obj = raw as Record<string, unknown>

  if (typeof obj.id !== 'string' || !obj.id) {
    return undefined
  }
  if (!isLessonStatus(obj.status)) {
    return undefined
  }
  if (typeof obj.target_menu !== 'string' || !obj.target_menu) {
    return undefined
  }
  if (typeof obj.symptom !== 'string' || !obj.symptom) {
    return undefined
  }
  if (typeof obj.updatedAt !== 'string' || !obj.updatedAt) {
    return undefined
  }

  const ticketId = obj.ticketId
  if (typeof ticketId !== 'number' || !Number.isFinite(ticketId)) {
    return undefined
  }

  const mrUrl = typeof obj.mrUrl === 'string' ? obj.mrUrl : ''

  const row: LessonIndexRow = {
    id: obj.id,
    status: obj.status,
    target_menu: obj.target_menu,
    symptom: obj.symptom,
    ticketId,
    mrUrl,
    updatedAt: obj.updatedAt,
  }

  if (obj.optimizeOf !== undefined) {
    if (typeof obj.optimizeOf !== 'string') {
      return undefined
    }
    row.optimizeOf = obj.optimizeOf
  }

  return row
}

/**
 * Sort lesson rows by `updatedAt` descending (newest first).
 * @param rows - rows to sort (not mutated).
 * @returns new array sorted by ISO timestamp.
 */
function sortByUpdatedAtDesc(rows: LessonIndexRow[]): LessonIndexRow[] {
  return [...rows].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
}

/**
 * Load lessons index from `localRoot/index.yaml`.
 * @param localRoot - directory containing `index.yaml` (lessons repo clone root).
 * @returns parsed index; missing file or invalid root yields `{ lessons: [] }`.
 * @throws rethrows non-ENOENT read failures.
 */
export function loadLessonIndex(localRoot: string): LessonIndex {
  const indexPath = join(localRoot, 'index.yaml')
  let rawText: string
  try {
    rawText = readFileSync(indexPath, 'utf8')
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? (err as NodeJS.ErrnoException).code : undefined
    if (code === 'ENOENT') {
      return { lessons: [] }
    }
    throw err
  }

  const parsed = parse(rawText)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { lessons: [] }
  }
  const root = parsed as Record<string, unknown>
  const lessonsRaw = root.lessons
  if (!Array.isArray(lessonsRaw)) {
    return { lessons: [] }
  }

  const lessons: LessonIndexRow[] = []
  for (const item of lessonsRaw) {
    const row = parseRow(item)
    if (row !== undefined) {
      lessons.push(row)
    }
  }
  return { lessons }
}

/**
 * Select accepted lessons for injection into a run.
 * @param index - loaded lesson index.
 * @param menu - exact `target_menu` match.
 * @param injectMax - maximum rows to return.
 * @returns newest accepted rows for the menu, up to `injectMax`.
 */
export function selectAcceptedForInject(
  index: LessonIndex,
  menu: string,
  injectMax: number,
): LessonIndexRow[] {
  const accepted = index.lessons.filter(r => r.status === 'accepted' && r.target_menu === menu)
  return sortByUpdatedAtDesc(accepted).slice(0, injectMax)
}

/**
 * Select dedup candidate rows for a menu from the index (all statuses).
 * @param index - loaded lesson index.
 * @param menu - exact `target_menu` match.
 * @returns up to {@link DEDUP_INDEX_CAP} newest rows for that menu.
 */
export function selectDedupRows(index: LessonIndex, menu: string): LessonIndexRow[] {
  const forMenu = index.lessons.filter(r => r.target_menu === menu)
  return sortByUpdatedAtDesc(forMenu).slice(0, DEDUP_INDEX_CAP)
}

/**
 * Whether the index already references a bug-platform ticket id (any status).
 * @param index - loaded lesson index.
 * @param n - ticket id to look up.
 * @returns true when any row carries this `ticketId`.
 */
export function indexHasTicket(index: LessonIndex, n: number): boolean {
  return index.lessons.some(r => r.ticketId === n)
}
