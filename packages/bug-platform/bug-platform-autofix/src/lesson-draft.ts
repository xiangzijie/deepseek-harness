/**
 * Cheap pre-checks and dedup JSON parsing for lesson drafting after a successful fix.
 * @module @deepseek-ai/dsh-bug-platform-autofix/lesson-draft
 */

import { indexHasTicket, type LessonIndex } from './lesson-index.ts'

/** Dedup model decision: create a pending lesson, skip as duplicate, or propose optimize. */
export type LessonDedupAction = 'create' | 'skip' | 'optimize'

/** Parsed dedup JSON when validation succeeds. */
export type LessonDedupParseOk = {
  ok: true
  action: LessonDedupAction
  existingId: string | undefined
  reason: string
}

/** Parsed dedup JSON when validation fails. */
export type LessonDedupParseErr = { ok: false }

/** Result of {@link parseLessonDedupText}. */
export type LessonDedupParseResult = LessonDedupParseOk | LessonDedupParseErr

/** Inputs for {@link shouldSkipLessonDraft}. */
export interface ShouldSkipLessonDraftInput {
  /** Bug platform menu label for the ticket. */
  targetMenu: string
  /** Bug platform ticket id. */
  ticketId: number
  /** Product repo paths changed on the fix branch. */
  changedFiles: readonly string[]
  /** Loaded lessons index for ticket dedup. */
  index: LessonIndex
}

/** Outcome of {@link shouldSkipLessonDraft}. */
export interface ShouldSkipLessonDraftResult {
  /** When true, do not call the dedup model or write draft files this round. */
  skip: boolean
  /** Optional short reason for logging (not model-visible). */
  reason?: string
}

const REUSABLE_CODE_PATH = /\.(vue|jsx?|tsx?|css|scss)$/i

const FENCE = /^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/i

const DEDUP_ACTIONS: readonly LessonDedupAction[] = ['create', 'skip', 'optimize']

/**
 * Whether a changed path looks like frontend code worth drafting a lesson from.
 * @param path - repo-relative path from the fix diff.
 * @returns true when the extension matches vue/js/ts/css/scss.
 */
function isReusableCodePath(path: string): boolean {
  return REUSABLE_CODE_PATH.test(path)
}

/**
 * Cheap gates before lesson dedup HTTP: menu, index ticket, diff shape.
 * @param input - menu, ticket id, changed paths, and lessons index.
 * @returns skip true when drafting should not run this round.
 */
export function shouldSkipLessonDraft(input: ShouldSkipLessonDraftInput): ShouldSkipLessonDraftResult {
  if (input.targetMenu.trim().length === 0) {
    return { skip: true, reason: 'target_menu 为空' }
  }
  if (indexHasTicket(input.index, input.ticketId)) {
    return { skip: true, reason: 'ticketId 已在经验索引' }
  }
  if (input.changedFiles.length === 0) {
    return { skip: true, reason: '无有效 diff' }
  }
  const hasReusable = input.changedFiles.some(isReusableCodePath)
  if (!hasReusable) {
    return { skip: true, reason: '变更路径无前端代码' }
  }
  return { skip: false }
}

/**
 * Narrow parsed action field to a known dedup action.
 * @param value - raw JSON field.
 * @returns action when valid, otherwise undefined.
 */
function isLessonDedupAction(value: unknown): value is LessonDedupAction {
  return typeof value === 'string' && (DEDUP_ACTIONS as readonly string[]).includes(value)
}

/**
 * Parse assistant dedup JSON after optional single markdown fence removal.
 * @param raw - assistant message text.
 * @returns validated create/skip/optimize decision, or ok false.
 */
export function parseLessonDedupText(raw: string): LessonDedupParseResult {
  const trimmed = raw.trim()
  const fenced = trimmed.match(FENCE)
  const body = (fenced?.[1] ?? trimmed).trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(body) as unknown
  } catch {
    return { ok: false }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false }
  }
  const rec = parsed as Record<string, unknown>
  const actionRaw = rec.action
  if (!isLessonDedupAction(actionRaw)) {
    return { ok: false }
  }
  const reasonRaw = rec.reason
  if (typeof reasonRaw !== 'string' || reasonRaw.trim().length === 0) {
    return { ok: false }
  }
  const reason = reasonRaw.trim()

  if (actionRaw === 'optimize') {
    const existingIdRaw = rec.existing_id
    if (typeof existingIdRaw !== 'string' || existingIdRaw.trim().length === 0) {
      return { ok: false }
    }
    return { ok: true, action: 'optimize', existingId: existingIdRaw.trim(), reason }
  }

  return { ok: true, action: actionRaw, existingId: undefined, reason }
}
