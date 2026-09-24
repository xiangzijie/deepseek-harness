/**
 * `@deepseek-ai/dsh-bug-platform-autofix`: library-first menu mapping, ticket
 * selection, local idempotency, per-worktree Git helpers, origin health checks,
 * optional GitLab MR creation, a progress-file run lock, and the §3 orchestrator
 * (`runOneTicket` / `runBatch`) for internal bug-platform autofix. Cordis `apply`
 * validates Config only; callers import helpers directly.
 *
 * @module @deepseek-ai/dsh-bug-platform-autofix
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

export type { MenuMappingIndex, MenuMappingItem, ResolvedMenu } from './menu-mapping.ts'
export { loadMenuMapping, resolveMenu } from './menu-mapping.ts'

export type {
  MappingRepo,
  OperatorBugPlatformConfig,
  OperatorConfig,
  OperatorGitlabConfig,
  OperatorLessonsConfig,
  OperatorRunConfig,
  OperatorSkillsConfig,
  OperatorWorkspace,
} from './operator-config.ts'
export { loadOperatorConfig } from './operator-config.ts'

export type { AcquireRunLockOptions, RunLockInfo } from './run-lock.ts'
export { acquireRunLock, readRunLock, runLockPath } from './run-lock.ts'

export type {
  AutofixWorkspacesHealth,
  InspectAutofixWorkspacesOptions,
  InspectWorkspaceOptions,
  WorkspaceHealthReport,
} from './workspace-health.ts'
export { inspectAutofixWorkspaces, inspectWorkspace } from './workspace-health.ts'

export type { SelectableTicket, SelectTicketsOptions } from './select.ts'
export {
  DEFAULT_ELIGIBLE_STATUSES,
  EXCLUDED_TARGET_MENU,
  EXCLUDED_TARGET_MENUS,
  isExcludedTargetMenu,
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

export type {
  AddMergeRequestNoteOptions,
  CreateMergeRequestOptions,
  EnsuredMergeRequest,
} from './gitlab-mr.ts'
export {
  addMergeRequestNote,
  createMergeRequest,
  ensureMergeRequest,
  GitlabTokenMissingError,
} from './gitlab-mr.ts'

export type { AgentBriefForcedSkill, AgentBriefInput } from './agent-brief.ts'
export { buildAgentBrief } from './agent-brief.ts'

export type { ForcedSkill, ManifestSkillEntry, ResolveForcedSkillsOptions } from './skill-manifest.ts'
export { loadManifest, resolveForcedSkills } from './skill-manifest.ts'

export type { AssertGlobalSkillsRunnableOptions } from './skill-sync.ts'
export { assertGlobalSkillsRunnable } from './skill-sync.ts'

export type {
  SkillUploadErr,
  SkillUploadOk,
  SkillUploadResult,
  ValidateSkillUploadInput,
  WritePersonalSkillInput,
} from './skill-upload.ts'
export { validateSkillUpload, writePersonalSkill } from './skill-upload.ts'

export type { AutofixStop, AutofixStopCategory } from './autofix-stop.ts'
export {
  assessPreAgentContext,
  autofixStopBriefRules,
  formatAutofixStopFollowup,
  MIN_DESCRIPTION_CHARS,
  parseSkipAutofixSummary,
  SKIP_AUTOFIX_PREFIX,
} from './autofix-stop.ts'

export type {
  AgentRunner,
  AgentRunnerOptions,
  AgentRunnerResult,
  DefaultAgentRunnerOptions,
} from './run-agent.ts'
export { createDefaultAgentRunner, resolveHarnessTsxImport, resolveHarnessTsxTsconfig } from './run-agent.ts'

export type { HeadlessSkillPatchInput } from './headless-skill-patch.ts'
export { renderHeadlessSkillPatch, resolvePersonalSkillPluginPath } from './headless-skill-patch.ts'

export type {
  LintRunner,
  OrchestratorClient,
  OrchestratorConfig,
  OrchestratorGitlabConfig,
  ProductBranches,
  RunBatchOptions,
  TicketOutcome,
} from './orchestrator.ts'
export { runBatch, runOneTicket } from './orchestrator.ts'

export type {
  EligibilityParseErr,
  EligibilityParseOk,
  EligibilityPreflightOptions,
  NeedFrontendFix,
} from './eligibility-preflight.ts'
export {
  DEFAULT_ELIGIBILITY_MODEL,
  ELIGIBILITY_SYSTEM_PROMPT,
  assessNeedFrontendFix,
  buildEligibilityUserPayload,
  parseEligibilityModelText,
} from './eligibility-preflight.ts'

export type {
  VisionPreflightErr,
  VisionPreflightOk,
  VisionPreflightOptions,
} from './vision-preflight.ts'
export {
  DEFAULT_MAX_BYTES_PER_IMAGE,
  DEFAULT_MAX_VISION_IMAGES,
  DEFAULT_VISION_BASE_URL,
  DEFAULT_VISION_MODEL,
  describeScreenshots,
  fileToDataUrl,
  mediaTypeForPath,
} from './vision-preflight.ts'

export type { LessonIndex, LessonIndexRow, LessonStatus } from './lesson-index.ts'
export {
  indexHasTicket,
  loadLessonIndex,
  selectAcceptedForInject,
  selectDedupRows,
} from './lesson-index.ts'

export type { AcceptedLessonBody, LoadAcceptedLessonBodiesOptions } from './lesson-inject.ts'
export { loadAcceptedLessonBodies } from './lesson-inject.ts'

export type { LessonSyncErr, LessonSyncOk, LessonSyncResult } from './lesson-sync.ts'
export { commitAndPushLessons, lessonsWorkingTreeDirty, pullLessonsFf } from './lesson-sync.ts'

export type {
  ApplyLessonDedupActionInput,
  AssessLessonDedupInput,
  LessonDedupOptions,
  LessonDedupParseResult,
  LessonDraftAfterDoneInput,
  LessonDraftAfterDoneResult,
  ShouldSkipLessonDraftInput,
  ShouldSkipLessonDraftResult,
} from './lesson-draft.ts'
export {
  applyLessonDedupAction,
  assessLessonDedup,
  parseLessonDedupText,
  shouldSkipLessonDraft,
  tryDraftLessonAfterDone,
} from './lesson-draft.ts'

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
