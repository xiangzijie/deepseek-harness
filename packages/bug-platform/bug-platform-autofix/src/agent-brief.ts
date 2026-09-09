/**
 * Build the headless-agent brief string for one bug-platform ticket.
 * @module @deepseek-ai/dsh-bug-platform-autofix/agent-brief
 */

import type { BugTicketDetail } from '@deepseek-ai/dsh-bug-platform-http'
import type { ResolvedMenu } from './menu-mapping.ts'

/** Inputs for {@link buildAgentBrief}. */
export interface AgentBriefInput {
  /** Ticket detail from the platform (or force-loaded for `--ticket`). */
  detail: BugTicketDetail
  /** Menu mapping hit that already passed claim eligibility. */
  resolved: ResolvedMenu
  /** Absolute product worktree root for this ticket. */
  localRoot: string
  /** Product routes entry relative to {@link AgentBriefInput.localRoot}. */
  routesFile: string
  /** Local screenshot/attachment paths that downloaded successfully. */
  screenshotPaths: readonly string[]
  /** Remote urls skipped (`file_size === 0`) or failed to download. */
  missingAssets?: readonly string[]
}

/**
 * Assemble the model-facing brief for `pnpm dsh --profile headless`.
 * @param input - ticket detail, resolved menu, worktree paths, and assets.
 * @returns a single prompt string.
 */
export function buildAgentBrief(input: AgentBriefInput): string {
  const { detail, resolved, localRoot, routesFile, screenshotPaths, missingAssets } = input
  const followups = [...detail.followups].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  )
  const followupLines =
    followups.length === 0
      ? ['(无跟进)']
      : followups.map((f, i) => {
        const latest = i === followups.length - 1 ? ' [最新，以本条为准]' : ''
        const status = f.status_change ? ` status_change=${f.status_change}` : ''
        const author = f.creator_name ? ` by ${f.creator_name}` : ''
        return `- ${f.created_at}${author}${status}${latest}: ${f.content}`
      })

  const lines = [
    `修复 bug 平台工单 #${detail.id}（project_id=${detail.project_id}）。`,
    `只在本工作区修改代码：${localRoot}`,
    `映射 repo=${resolved.repo} branch=${resolved.branch} menu_path=${resolved.menuPath}`,
    `target_menu=${detail.target_menu ?? '(null)'}`,
    `target_platform=${detail.target_platform ?? '(null)'}`,
    `issue_type=${detail.issue_type ?? '(null)'} importance=${detail.importance ?? '(null)'}`,
    `优先打开 filePath=${resolved.filePath ?? '(none)'}；routeHint=${resolved.routeHint ?? '(none)'}`,
    `需要时再读路由入口：${routesFile}`,
    '只改映射路径与路由指向的模块；像纯后端/纯数据问题则停止改代码并说明原因。',
    '',
    '## description',
    detail.description,
    '',
    '## followups（按 created_at 升序）',
    ...followupLines,
    '',
    '## 本地截图/附件',
    screenshotPaths.length === 0 ? '(无)' : screenshotPaths.map(p => `- ${p}`).join('\n'),
  ]

  if (missingAssets !== undefined && missingAssets.length > 0) {
    lines.push('', '## 缺失附件（已跳过）', ...missingAssets.map(u => `- ${u}`))
  }

  return lines.join('\n')
}
