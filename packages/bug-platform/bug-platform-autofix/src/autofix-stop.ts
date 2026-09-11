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
 * Instruction block injected into the agent brief for stop rules and
 * independent judgment (no new SKIP categories beyond the three above).
 * @returns multi-line brief fragment (no trailing newline required by caller).
 */
export function autofixStopBriefRules(): string {
  return [
    '## 判断准则（必须遵守）',
    '1. 独立判断，不要一味迎合工单或跟进里的说法；叙述与可核验证据冲突时，以证据为准，可停止并写明冲突。',
    '2. 区分事实、预测与主观观点：可核对的代码／截图／接口契约为事实；「可能是后端」「感觉慢」等为预测或观点，不得直接当改码依据。',
    '3. 信息源优先级（高→低）：本仓代码与路由／映射路径 → 本地截图／附件 → 带具体路径／接口／复现步骤的最新跟进 → 较早跟进 → 笼统描述。',
    '4. 下列情形归入现有停止类别（不新增类别）：描述／跟进／截图互相矛盾且无法唯一确定改法；实质是需求／体验偏好而非可验证缺陷；改动面过大或需后端联调；只能靠线上账号／真实数据复现且代码无锚点；环境／部署／权限／网关不在本仓；代码已符合证据、工单过时无需再改；安全敏感或破坏性操作。',
    '',
    '## 停止规则（必须遵守）',
    '1. 描述、截图、跟进不足以定位应改的前端文件或复现路径时：停止，禁止猜测改码。',
    '2. 无法确定是前端问题（更像接口/数据/权限/配置/纯后端）时：停止，禁止改前端。',
    '3. 证据不足或无法在上述优先级下独立确认改法时：停止，禁止为交差猜改。',
    '4. 停止时不得留下半成品 diff；最终回复中必须单独一行：',
    `${SKIP_AUTOFIX_PREFIX}<类别>|<一句话原因>`,
    '类别仅限：insufficient_context | not_frontend | out_of_scope',
    '示例：SKIP_AUTOFIX|not_frontend|统计不一致且跟进指向后端接口字段',
    '示例：SKIP_AUTOFIX|insufficient_context|描述与最新跟进矛盾且截图无法消歧',
    '示例：SKIP_AUTOFIX|out_of_scope|代码已符合最新跟进中的接口约定，无需再改',
  ].join('\n')
}
