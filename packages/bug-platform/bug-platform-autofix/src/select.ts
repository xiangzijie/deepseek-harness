/**
 * Client-side ticket selection filters for bug-platform autofix batches.
 * @module @deepseek-ai/dsh-bug-platform-autofix/select
 */

import { resolveMenu, type MenuMappingIndex } from './menu-mapping.ts'
import type { OperatorWorkspace } from './operator-config.ts'
import type { TicketStateStore } from './ticket-state.ts'

/** Minimal list-row fields required by {@link selectTickets}. */
export interface SelectableTicket {
  id: number
  assignee_id: number | null
  status: string
  target_menu: string | null
}

/** Default platform statuses accepted when callers omit {@link SelectTicketsOptions.statuses}. */
export const DEFAULT_ELIGIBLE_STATUSES: readonly string[] = [
  '待确认',
  '验证未通过',
  '转派',
  '转需求',
]

/** Menu labels that are never claimed, even if present in the mapping table. */
export const EXCLUDED_TARGET_MENUS: readonly string[] = [
  '网络安全数据大屏',
  '网络安全指挥大屏',
]

/** Historical alias for the first excluded menu label. */
export const EXCLUDED_TARGET_MENU: string = '网络安全数据大屏'

/**
 * Whether `targetMenu` is in the hard-excluded dashboard allow-deny list.
 * @param targetMenu - ticket `target_menu` (may be null).
 * @returns true when autofix must skip without claiming.
 */
export function isExcludedTargetMenu(targetMenu: string | null | undefined): boolean {
  if (targetMenu === null || targetMenu === undefined) return false
  return (EXCLUDED_TARGET_MENUS as readonly string[]).includes(targetMenu)
}

/** Options for {@link selectTickets}. */
export interface SelectTicketsOptions {
  /**
   * Status allow-list. Defaults to {@link DEFAULT_ELIGIBLE_STATUSES}.
   * Use an explicit list (e.g. `['处理中']`) to force-select atypical statuses.
   */
  statuses?: readonly string[]
  /**
   * In addition to `assignee_id == null`, also keep tickets whose assignee is
   * one of these user ids (e.g. the logged-in autofix operator after a claim
   * auto-assigned them).
   */
  alsoAssignedTo?: readonly number[]
  /**
   * When set, drop tickets whose `resolveMenu` hit maps to a workspace with
   * `autofix: false`. Omitted keeps mapped custom/ailpha (tests / callers that
   * have not loaded operator workspaces).
   */
  workspaces?: readonly Pick<OperatorWorkspace, 'mappingRepo' | 'autofix'>[]
}

/**
 * Filter list rows to unassigned (or self-assigned), status-allowed, mapped, non-active candidates.
 * @param tickets - platform list rows (or compatible summaries).
 * @param index - menu mapping index from {@link loadMenuMapping}.
 * @param store - local idempotency store; active and pre-claim `skipped` phases are skipped.
 * @param options - optional status allow-list, self-assignee ids, and workspaces.
 * @returns tickets that pass every selection rule, in input order.
 */
export function selectTickets(
  tickets: readonly SelectableTicket[],
  index: MenuMappingIndex,
  store: TicketStateStore,
  options?: SelectTicketsOptions,
): SelectableTicket[] {
  const statuses = new Set(options?.statuses ?? DEFAULT_ELIGIBLE_STATUSES)
  const alsoAssignedTo = new Set(options?.alsoAssignedTo ?? [])
  return tickets.filter((ticket) => {
    if (ticket.assignee_id !== null && !alsoAssignedTo.has(ticket.assignee_id)) {
      return false
    }
    if (!statuses.has(ticket.status)) {
      return false
    }
    if (ticket.target_menu === null || isExcludedTargetMenu(ticket.target_menu)) {
      return false
    }
    const resolved = resolveMenu(index, ticket.target_menu)
    if (resolved === null) {
      return false
    }
    if (options?.workspaces !== undefined) {
      const workspace = options.workspaces.find(ws => ws.mappingRepo === resolved.repo)
      if (workspace !== undefined && workspace.autofix === false) {
        return false
      }
    }
    if (store.isActiveTicket(ticket.id)) {
      return false
    }
    if (store.get(ticket.id)?.phase === 'skipped') {
      return false
    }
    return true
  })
}
