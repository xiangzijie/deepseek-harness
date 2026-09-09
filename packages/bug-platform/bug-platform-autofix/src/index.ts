/**
 * `@deepseek-ai/dsh-bug-platform-autofix`: library-first menu mapping, ticket
 * selection, local idempotency, per-worktree Git helpers, and optional GitLab
 * MR creation for internal bug-platform autofix. Cordis `apply` validates
 * Config only; callers import helpers directly.
 *
 * @module @deepseek-ai/dsh-bug-platform-autofix
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

export type { MenuMappingIndex, MenuMappingItem, ResolvedMenu } from './menu-mapping.ts'
export { loadMenuMapping, resolveMenu } from './menu-mapping.ts'

export type { SelectableTicket, SelectTicketsOptions } from './select.ts'
export {
  DEFAULT_ELIGIBLE_STATUSES,
  EXCLUDED_TARGET_MENU,
  selectTickets,
} from './select.ts'

export type { TicketPhase, TicketRecord } from './ticket-state.ts'
export {
  isActive,
  loadState,
  saveState,
  TicketStateStore,
} from './ticket-state.ts'

export type { RunGit, WorkspaceRoots } from './git-workspace.ts'
export {
  assertClean,
  assertProductBranch,
  commitAll,
  createBugfixBranch,
  defaultRunGit,
  listChangedFiles,
  pushBranch,
} from './git-workspace.ts'

export type { CreateMergeRequestOptions } from './gitlab-mr.ts'
export { createMergeRequest, GitlabTokenMissingError } from './gitlab-mr.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'bug-platform-autofix'

/**
 * Empty inject: orchestration constructs clients and loads mapping as a library.
 */
export const inject = []

/** Plugin / library config (all fields defaulted by {@link Config}). */
export interface Config {
  /**
   * Absolute path to `menu-mapping.json`. Empty means the caller supplies
   * parsed JSON to {@link loadMenuMapping} instead of reading from disk here.
   */
  mappingFile?: string
}

export const Config: z<Config> = z.object({
  mappingFile: z.string().default(''),
})

/**
 * Validate resolved Config. Phase-1 orchestration imports mapping helpers as a
 * library; this plugin does not mount a ctx service.
 * @param _ctx - Cordis context; unused until a future optional service mounts.
 * @param _config - plugin config after schemastery defaults.
 */
export function apply(_ctx: Context, _config: Config): void {
  // Config defaults are sufficient; empty mappingFile is intentional for library use.
}
