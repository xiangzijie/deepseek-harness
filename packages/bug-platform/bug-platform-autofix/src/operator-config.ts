/**
 * Typed loader for console / CLI `operator.yaml`.
 * @module @deepseek-ai/dsh-bug-platform-autofix/operator-config
 */

import { readFileSync } from 'node:fs'
import { parse } from 'yaml'

/** Menu-mapping `repo` values bound to a product worktree. */
export type MappingRepo = 'custom' | 'ailpha' | 'home'

/** One configured local product workspace from operator.yaml. */
export interface OperatorWorkspace {
  /** Stable workspace key for UI and logs. */
  id: string
  /** Absolute path to the git worktree root. */
  localRoot: string
  /** GitLab project id for push/MR against {@link gitlab.host}. */
  gitlabProjectId: number
  /** Sole allowed product baseline branch in this worktree. */
  productBranch: string
  /** Must match menu-mapping.json `repo` for this tree. */
  mappingRepo: MappingRepo
  /** When false, mapping hits for this repo are skipped (home default). */
  autofix: boolean
}

/** Bug platform HTTP endpoints (credentials stay in env). */
export interface OperatorBugPlatformConfig {
  baseUrl: string
  projectId: number
}

/** GitLab host and env var name for the API token. */
export interface OperatorGitlabConfig {
  host: string
  tokenEnv: string
}

/** Global and personal skill roots plus brief injection limits. */
export interface OperatorSkillsConfig {
  globalRepo: string
  globalLocal: string
  personalRoot: string
  forceMaxCount: number
  forceMaxChars: number
}

/** Run-batch tunables from operator.yaml. */
export interface OperatorRunConfig {
  maxTickets: number
  operatorId: string
  lintEnabled: boolean
  buildEnabled: boolean
}

/** Parsed operator.yaml with workspace lookup helpers. */
export interface OperatorConfig {
  harnessRoot: string
  bugPlatform: OperatorBugPlatformConfig
  gitlab: OperatorGitlabConfig
  mappingFile: string
  stateFile: string
  progressFile: string
  assetsDir: string
  workspaces: readonly OperatorWorkspace[]
  skills: OperatorSkillsConfig
  run: OperatorRunConfig
  /**
   * Resolve a workspace by menu-mapping repo key.
   * @param repo - mapping `repo` field (`custom` | `ailpha` | `home`).
   * @returns workspace or undefined when not configured.
   */
  workspaceByMappingRepo(repo: MappingRepo): OperatorWorkspace | undefined
  /**
   * Resolve a workspace by configured `id`.
   * @param id - workspace id from operator.yaml.
   * @returns workspace or undefined when not configured.
   */
  workspaceById(id: string): OperatorWorkspace | undefined
}

const MAPPING_REPOS: readonly MappingRepo[] = ['custom', 'ailpha', 'home']

const DEFAULT_GITLAB_TOKEN_ENV = 'GITLAB_TOKEN'
const DEFAULT_RUN_OPERATOR_ID = 'local'
const DEFAULT_RUN_MAX_TICKETS = 1
const DEFAULT_SKILLS_FORCE_MAX_COUNT = 3
const DEFAULT_SKILLS_FORCE_MAX_CHARS = 8000

/**
 * Read and validate `operator.yaml` from disk.
 * @param configPath - absolute path to the yaml file.
 * @returns parsed config with defaults applied.
 */
export function loadOperatorConfig(configPath: string): OperatorConfig {
  let rawText: string
  try {
    rawText = readFileSync(configPath, 'utf8')
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? (err as NodeJS.ErrnoException).code : undefined
    if (code === 'ENOENT') {
      throw new Error(`operator.yaml 不存在: ${configPath}`)
    }
    throw err
  }

  const parsed = parse(rawText)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('operator-config: root must be a non-array object')
  }
  const root = parsed as Record<string, unknown>

  const harnessRoot = requireString(root.harnessRoot, 'harnessRoot')
  const bugPlatform = parseBugPlatform(root.bugPlatform)
  const gitlab = parseGitlab(root.gitlab)
  const mappingFile = requireString(root.mappingFile, 'mappingFile')
  const stateFile = requireString(root.stateFile, 'stateFile')
  const progressFile = requireString(root.progressFile, 'progressFile')
  const assetsDir = requireString(root.assetsDir, 'assetsDir')
  const workspaces = parseWorkspaces(root.workspaces)
  const skills = parseSkills(root.skills)
  const run = parseRun(root.run)

  const byMappingRepo = new Map<MappingRepo, OperatorWorkspace>()
  const byId = new Map<string, OperatorWorkspace>()
  for (const ws of workspaces) {
    byMappingRepo.set(ws.mappingRepo, ws)
    byId.set(ws.id, ws)
  }

  return {
    harnessRoot,
    bugPlatform,
    gitlab,
    mappingFile,
    stateFile,
    progressFile,
    assetsDir,
    workspaces,
    skills,
    run,
    workspaceByMappingRepo(repo: MappingRepo): OperatorWorkspace | undefined {
      return byMappingRepo.get(repo)
    },
    workspaceById(id: string): OperatorWorkspace | undefined {
      return byId.get(id)
    },
  }
}

/**
 * Parse bugPlatform section.
 * @param value - raw yaml value.
 * @returns validated bug platform config.
 */
function parseBugPlatform(value: unknown): OperatorBugPlatformConfig {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('operator-config: bugPlatform must be an object')
  }
  const obj = value as Record<string, unknown>
  return {
    baseUrl: requireString(obj.baseUrl, 'bugPlatform.baseUrl'),
    projectId: requireNumber(obj.projectId, 'bugPlatform.projectId'),
  }
}

/**
 * Parse gitlab section with token env default.
 * @param value - raw yaml value.
 * @returns validated gitlab config.
 */
function parseGitlab(value: unknown): OperatorGitlabConfig {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('operator-config: gitlab must be an object')
  }
  const obj = value as Record<string, unknown>
  const tokenEnvRaw = obj.tokenEnv
  const tokenEnv =
    tokenEnvRaw === undefined
      ? DEFAULT_GITLAB_TOKEN_ENV
      : requireString(tokenEnvRaw, 'gitlab.tokenEnv')
  return {
    host: requireString(obj.host, 'gitlab.host'),
    tokenEnv,
  }
}

/**
 * Parse skills section with force-injection defaults.
 * @param value - raw yaml value.
 * @returns validated skills config.
 */
function parseSkills(value: unknown): OperatorSkillsConfig {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('operator-config: skills must be an object')
  }
  const obj = value as Record<string, unknown>
  return {
    globalRepo: requireString(obj.globalRepo, 'skills.globalRepo'),
    globalLocal: requireString(obj.globalLocal, 'skills.globalLocal'),
    personalRoot: requireString(obj.personalRoot, 'skills.personalRoot'),
    forceMaxCount: optionalNumber(obj.forceMaxCount, DEFAULT_SKILLS_FORCE_MAX_COUNT, 'skills.forceMaxCount'),
    forceMaxChars: optionalNumber(obj.forceMaxChars, DEFAULT_SKILLS_FORCE_MAX_CHARS, 'skills.forceMaxChars'),
  }
}

/**
 * Parse run section with batch defaults.
 * @param value - raw yaml value.
 * @returns validated run config.
 */
function parseRun(value: unknown): OperatorRunConfig {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('operator-config: run must be an object')
  }
  const obj = value as Record<string, unknown>
  return {
    maxTickets: optionalNumber(obj.maxTickets, DEFAULT_RUN_MAX_TICKETS, 'run.maxTickets'),
    operatorId: optionalString(obj.operatorId, DEFAULT_RUN_OPERATOR_ID, 'run.operatorId'),
    lintEnabled: optionalBoolean(obj.lintEnabled, false, 'run.lintEnabled'),
    buildEnabled: optionalBoolean(obj.buildEnabled, false, 'run.buildEnabled'),
  }
}

/**
 * Parse and deduplicate workspaces array.
 * @param value - raw yaml value.
 * @returns validated workspace list.
 */
function parseWorkspaces(value: unknown): OperatorWorkspace[] {
  if (!Array.isArray(value)) {
    throw new Error('operator-config: workspaces must be an array')
  }
  if (value.length === 0) {
    throw new Error('operator-config: workspaces must not be empty')
  }

  const seenIds = new Set<string>()
  const seenMappingRepos = new Set<MappingRepo>()
  const workspaces: OperatorWorkspace[] = []

  for (const entry of value) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('operator-config: each workspaces[] entry must be an object')
    }
    const obj = entry as Record<string, unknown>
    const id = requireString(obj.id, 'workspaces[].id')
    if (seenIds.has(id)) {
      throw new Error(`operator-config: duplicate workspaces[].id: ${id}`)
    }
    seenIds.add(id)

    const mappingRepo = parseMappingRepo(obj.mappingRepo)
    if (seenMappingRepos.has(mappingRepo)) {
      throw new Error(`operator-config: duplicate workspaces[].mappingRepo: ${mappingRepo}`)
    }
    seenMappingRepos.add(mappingRepo)

    const autofixRaw = obj.autofix
    const autofix =
      autofixRaw === undefined ? true : requireBoolean(autofixRaw, 'workspaces[].autofix')

    workspaces.push({
      id,
      localRoot: requireString(obj.localRoot, 'workspaces[].localRoot'),
      gitlabProjectId: requireNumber(obj.gitlabProjectId, 'workspaces[].gitlabProjectId'),
      productBranch: requireString(obj.productBranch, 'workspaces[].productBranch'),
      mappingRepo,
      autofix,
    })
  }

  return workspaces
}

/**
 * Validate mappingRepo enum.
 * @param value - raw yaml value.
 * @returns mapping repo literal.
 */
function parseMappingRepo(value: unknown): MappingRepo {
  if (typeof value !== 'string' || !MAPPING_REPOS.includes(value as MappingRepo)) {
    throw new Error(
      `operator-config: workspaces[].mappingRepo must be one of ${MAPPING_REPOS.join(', ')}`,
    )
  }
  return value as MappingRepo
}

/**
 * Require a non-empty string field.
 * @param value - raw value.
 * @param field - diagnostic field name.
 * @returns trimmed string (yaml scalars only; no trim for paths).
 */
function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`operator-config: ${field} must be a non-empty string`)
  }
  return value
}

/**
 * Require a finite number field.
 * @param value - raw value.
 * @param field - diagnostic field name.
 * @returns number.
 */
function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`operator-config: ${field} must be a finite number`)
  }
  return value
}

/**
 * Require a boolean field.
 * @param value - raw value.
 * @param field - diagnostic field name.
 * @returns boolean.
 */
function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`operator-config: ${field} must be a boolean`)
  }
  return value
}

/**
 * Optional number with default when absent.
 * @param value - raw value.
 * @param defaultValue - default when undefined.
 * @param field - diagnostic field name.
 * @returns number.
 */
function optionalNumber(value: unknown, defaultValue: number, field: string): number {
  if (value === undefined) {
    return defaultValue
  }
  return requireNumber(value, field)
}

/**
 * Optional string with default when absent.
 * @param value - raw value.
 * @param defaultValue - default when undefined.
 * @param field - diagnostic field name.
 * @returns string.
 */
function optionalString(value: unknown, defaultValue: string, field: string): string {
  if (value === undefined) {
    return defaultValue
  }
  return requireString(value, field)
}

/**
 * Optional boolean with default when absent.
 * @param value - raw value.
 * @param defaultValue - default when undefined.
 * @param field - diagnostic field name.
 * @returns boolean.
 */
function optionalBoolean(value: unknown, defaultValue: boolean, field: string): boolean {
  if (value === undefined) {
    return defaultValue
  }
  return requireBoolean(value, field)
}
