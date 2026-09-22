/**
 * Parse the eligibility chat completion into a structured decision.
 * Strips at most one markdown fence, then JSON.parse.
 * @module @deepseek-ai/dsh-bug-platform-autofix/eligibility-preflight
 */

export type NeedFrontendFix = true | false | 'uncertain'

export type EligibilityParseOk = {
  ok: true
  needFrontendFix: NeedFrontendFix
  reason: string
}

export type EligibilityParseErr = { ok: false; error: string }

const FENCE = /^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/i

/**
 * Parse assistant eligibility text after optional markdown fence removal.
 * @param raw - assistant message text.
 * @returns parsed decision, or ok false when not a valid object.
 */
export function parseEligibilityModelText(raw: string): EligibilityParseOk | EligibilityParseErr {
  const trimmed = raw.trim()
  const fenced = trimmed.match(FENCE)
  const body = (fenced?.[1] ?? trimmed).trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(body) as unknown
  } catch {
    return { ok: false, error: 'eligibility 响应不是 JSON' }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'eligibility 响应根必须是对象' }
  }
  const rec = parsed as Record<string, unknown>
  const flag = rec.need_frontend_fix
  const reason = rec.reason
  if (flag !== true && flag !== false && flag !== 'uncertain') {
    return { ok: false, error: 'need_frontend_fix 非法' }
  }
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    return { ok: false, error: 'reason 必须是非空字符串' }
  }
  return { ok: true, needFrontendFix: flag, reason: reason.trim() }
}
