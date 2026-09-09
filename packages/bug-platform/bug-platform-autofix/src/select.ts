/**
 * Client-side ticket selection filters for bug-platform autofix batches.
 * @module @deepseek-ai/dsh-bug-platform-autofix/select
 */

import { resolveMenu, type MenuMappingIndex } from './menu-mapping.ts'
import type { TicketStateStore } from './ticket-state.ts'

/** Minimal list-row fields required by {@link selectTickets}. */
export interface SelectableTicket {
  id: number
  assignee_id: number | null
  status: string
  target_menu: string | null
}

/** Default platform statuses accepted when callers omit {@link SelectTicketsOptions.statuses}. */
export const DEFAULT_ELIGIBLE_STATUSES: readonly string[] = ['待确认', '验证未通过']

/** Menu label that is never claimed, even if present in the mapping table. */
export const EXCLUDED_TARGET_MENU = '网络安全数据大屏'

/** Options for {@link selectTickets}. */
export interface SelectTicketsOptions {
  /**
   * Status allow-list. Defaults to {@link DEFAULT_ELIGIBLE_STATUSES}.
   * Use an explicit list (e.g. `['转派']`) to force-select a pilot ticket.
   */
  statuses?: readonly string[]
}

/**
 * Filter list rows to unassigned, status-allowed, mapped, non-active candidates.
 * @param tickets - platform list rows (or compatible summaries).
 * @param index - menu mapping index from {@link loadMenuMapping}.
 * @param store - local idempotency store; active phases are skipped.
 * @param options - optional status allow-list override.
 * @returns tickets that pass every selection rule, in input order.
 */
export function selectTickets(
  tickets: readonly SelectableTicket[],
  index: MenuMappingIndex,
  store: TicketStateStore,
  options?: SelectTicketsOptions,
): SelectableTicket[] {
  const statuses = new Set(options?.statuses ?? DEFAULT_ELIGIBLE_STATUSES)
  return tickets.filter((ticket) => {
    if (ticket.assignee_id !== null) {
      return false
    }
    if (!statuses.has(ticket.status)) {
      return false
    }
    if (ticket.target_menu === null || ticket.target_menu === EXCLUDED_TARGET_MENU) {
      return false
    }
    if (resolveMenu(index, ticket.target_menu) === null) {
      return false
    }
    if (store.isActiveTicket(ticket.id)) {
      return false
    }
    return true
  })
}
