/**
 * Pre-agent context checks and agent SKIP_AUTOFIX summary parsing for
 * bug-platform autofix stop / skip decisions.
 * @module @deepseek-ai/dsh-bug-platform-autofix/autofix-stop
 */

/** Structured stop categories the agent may report (and pre-agent may use). */
export type AutofixStopCategory =
  | 'insufficient_context'
  | 'not_frontend'
  | 'out_of_scope'

/** One parsed or constructed autofix stop. */
export interface AutofixStop {
  /** Stop category. */
  category: AutofixStopCategory
  /** Human-readable reason for the platform followup. */
  reason: string
}

/** Minimum trimmed description length before we treat text as usable alone. */
export const MIN_DESCRIPTION_CHARS = 8

/**
 * Line the headless agent must emit when stopping without code changes.
 * Example: `SKIP_AUTOFIX|not_frontend|现象像接口返回字段错误`
 */
export const SKIP_AUTOFIX_PREFIX = 'SKIP_AUTOFIX|'

/**
 * Pre-agent gate: insufficient ticket context (no usable description and no
 * local screenshots). Returns null when the agent may still attempt a fix.
 * @param description - ticket description (may be null).
 * @param screenshotPaths - successfully downloaded local asset paths.
 * @returns stop decision or null.
 */
export function assessPreAgentContext(
  description: string | null | undefined,
  screenshotPaths: readonly string[],
): AutofixStop | null {
  const text = description?.trim() ?? ''
  if (text.length >= MIN_DESCRIPTION_CHARS) return null
  if (screenshotPaths.length > 0) return null
  return {
    category: 'insufficient_context',
    reason:
      text.length === 0
        ? '问题描述为空，且无可用截图/附件，无法定位前端修改点'
        : `问题描述过短（${text.length} 字，阈值 ${MIN_DESCRIPTION_CHARS}），且无可用截图/附件，无法定位前端修改点`,
  }
}

/**
 * Parse an agent summary for a SKIP_AUTOFIX line. Searches the whole summary
 * so models may put prose before the marker.
 * @param summary - agent result summary / stdout excerpt.
 * @returns parsed stop, or null when the summary is not a structured skip.
 */
export function parseSkipAutofixSummary(summary: string): AutofixStop | null {
  const match = summary.match(/SKIP_AUTOFIX\|(insufficient_context|not_frontend|out_of_scope)\|([^\r\n]+)/)
  if (match === null) return null
  const category = match[1] as AutofixStopCategory
  const reason = match[2]?.trim() ?? ''
  if (reason.length === 0) return null
  return { category, reason }
}

/**
 * Format platform followup / outcome text for a stop.
 * @param stop - category + reason.
 * @returns Chinese followup body (status stays 处理中).
 */
export function formatAutofixStopFollowup(stop: AutofixStop): string {
  return (
    '自动修复已停止并跳过继续改码。\n' +
    `类别：${stop.category}\n` +
    `原因：${stop.reason}`
  )
}

/**
 * Instruction block injected into the agent brief for stop rules.
 * @returns multi-line brief fragment (no trailing newline required by caller).
 */
export function autofixStopBriefRules(): string {
  return [
    '## 停止规则（必须遵守）',
    '1. 描述、截图、跟进不足以定位应改的前端文件或复现路径时：停止，禁止猜测改码。',
    '2. 无法确定是前端问题（更像接口/数据/权限/配置/纯后端）时：停止，禁止改前端。',
    '3. 停止时不得留下半成品 diff；最终回复中必须单独一行：',
    `${SKIP_AUTOFIX_PREFIX}<类别>|<一句话原因>`,
    '类别仅限：insufficient_context | not_frontend | out_of_scope',
    '示例：SKIP_AUTOFIX|not_frontend|统计不一致且跟进指向后端接口字段',
  ].join('\n')
}
