/**
 * Load `manifest.yaml` from a global skill clone and collect forced skill bodies
 * for one workspace. Forced skills are injected into the agent brief; they are
 * not discovered through a skill tool.
 *
 * @module @deepseek-ai/dsh-bug-platform-autofix/skill-manifest
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'

/** Copied from dsh `isSkillName`; this package does not depend on `@deepseek-ai/dsh-skill`. */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** One forced skill body destined for the agent brief. */
export interface ForcedSkill {
  /** kebab-case name from `manifest.yaml`. */
  name: string
  /** Markdown after the closing frontmatter `---`. */
  body: string
}

/** Inputs for {@link resolveForcedSkills}. */
export interface ResolveForcedSkillsOptions {
  /** Local clone root that contains `manifest.yaml` and `skills/`. */
  globalLocal: string
  /** Current ticket workspace id (`workspaces[].id`). */
  workspaceId: string
  /** Ids of workspaces with `autofix: true`; empty `workspaceIds` expand to this list. */
  autofixWorkspaceIds: readonly string[]
  /** Maximum number of forced skills for this workspace; exceeding throws. */
  forceMaxCount: number
  /** Maximum combined body character count; exceeding throws. */
  forceMaxChars: number
}

/**
 * Collect enabled, forced skill bodies that apply to `workspaceId`.
 * @param options - clone root, workspace ids, and injection limits.
 * @returns forced skills in manifest order.
 * @throws {Error} when the manifest is missing or invalid, a `skills[].name` is
 *   not kebab-case, a forced SKILL.md is missing, count exceeds `forceMaxCount`,
 *   combined body length exceeds `forceMaxChars`, or a forced skill sets
 *   `disable-model-invocation: true`.
 */
export function resolveForcedSkills(options: ResolveForcedSkillsOptions): ForcedSkill[] {
  const { globalLocal, workspaceId, autofixWorkspaceIds, forceMaxCount, forceMaxChars } = options
  const entries = loadManifest(globalLocal)
  const forcedNames: string[] = []
  for (const entry of entries) {
    if (entry.enabled !== true || entry.force !== true) continue
    if (!appliesToWorkspace(entry.workspaceIds, workspaceId, autofixWorkspaceIds)) continue
    forcedNames.push(entry.name)
  }

  if (forcedNames.length > forceMaxCount) {
    throw new Error(`强制 skill 数量超过 forceMaxCount=${forceMaxCount}`)
  }

  const resolved: ForcedSkill[] = []
  let totalChars = 0
  for (const name of forcedNames) {
    const raw = readSkillMarkdown(globalLocal, name)
    const parsed = parseSkillMarkdown(raw, name)
    if (parsed.data['disable-model-invocation'] === true) {
      throw new Error(`强制 skill 禁止 disable-model-invocation: ${name}`)
    }
    totalChars += parsed.body.length
    resolved.push({ name, body: parsed.body })
  }

  if (totalChars > forceMaxChars) {
    throw new Error(`强制 skill 正文合计超过 forceMaxChars=${forceMaxChars}`)
  }
  return resolved
}

/** One validated `manifest.yaml` skill row. */
export interface ManifestSkillEntry {
  /** kebab-case name from `manifest.yaml`. */
  name: string
  /** When false, the skill is neither catalogued nor forced. */
  enabled: boolean
  /** When true, the skill body is injected into the agent brief. */
  force: boolean
  /** Empty means every `autofix: true` workspace id. */
  workspaceIds: readonly string[]
}

/**
 * Read and validate `globalLocal/manifest.yaml`.
 * @param globalLocal - clone root.
 * @returns skill rows in file order.
 * @throws {Error} when the file is missing, the document is invalid, or a
 *   `skills[].name` is empty or not kebab-case
 *   (`/^[a-z0-9]+(?:-[a-z0-9]+)*$/`), so `path.join(..., name)` cannot leave `skills/`.
 */
export function loadManifest(globalLocal: string): ManifestSkillEntry[] {
  const manifestPath = join(globalLocal, 'manifest.yaml')
  let rawText: string
  try {
    rawText = readFileSync(manifestPath, 'utf8')
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? (err as NodeJS.ErrnoException).code : undefined
    if (code === 'ENOENT') {
      throw new Error(`manifest.yaml 不存在: ${manifestPath}`)
    }
    /* v8 ignore next -- Non-ENOENT readFileSync failures need a host I/O fault. */
    throw err
  }

  const parsed = parse(rawText)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('skill-manifest: root must be a non-array object')
  }
  const skills = (parsed as Record<string, unknown>).skills
  if (!Array.isArray(skills)) {
    throw new Error('skill-manifest: skills must be an array')
  }

  const entries: ManifestSkillEntry[] = []
  for (const raw of skills) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('skill-manifest: each skills[] entry must be an object')
    }
    const obj = raw as Record<string, unknown>
    const name = obj.name
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('skill-manifest: skills[].name must be a non-empty string')
    }
    if (!SKILL_NAME.test(name)) {
      throw new Error(`skill-manifest: skills[].name must be kebab-case: ${name}`)
    }
    entries.push({
      name,
      enabled: obj.enabled === true,
      force: obj.force === true,
      workspaceIds: parseWorkspaceIds(obj.workspaceIds),
    })
  }
  return entries
}

/**
 * Normalize `workspaceIds`; omitted or empty means every autofix workspace.
 * @param value - raw yaml value.
 * @returns string ids.
 */
function parseWorkspaceIds(value: unknown): readonly string[] {
  if (value === undefined || value === null) {
    return []
  }
  if (!Array.isArray(value) || value.some(id => typeof id !== 'string')) {
    throw new Error('skill-manifest: skills[].workspaceIds must be a string array')
  }
  return value as string[]
}

/**
 * @param workspaceIds - empty means all autofix ids.
 * @param workspaceId - current workspace.
 * @param autofixWorkspaceIds - ids with `autofix: true`.
 * @returns whether this skill applies to the current workspace.
 */
function appliesToWorkspace(
  workspaceIds: readonly string[],
  workspaceId: string,
  autofixWorkspaceIds: readonly string[],
): boolean {
  if (workspaceIds.length === 0) {
    return autofixWorkspaceIds.includes(workspaceId)
  }
  return workspaceIds.includes(workspaceId)
}

/**
 * Read `skills/<name>/SKILL.md` or, if absent, `skills/<name>.md` (one level).
 * @param globalLocal - clone root.
 * @param name - skill name.
 * @returns file text.
 */
function readSkillMarkdown(globalLocal: string, name: string): string {
  const bundled = join(globalLocal, 'skills', name, 'SKILL.md')
  const flat = join(globalLocal, 'skills', `${name}.md`)
  if (existsSync(bundled)) {
    return readFileSync(bundled, 'utf8')
  }
  if (existsSync(flat)) {
    return readFileSync(flat, 'utf8')
  }
  throw new Error(`强制 skill 缺少 SKILL.md: ${name}`)
}

/**
 * Split YAML frontmatter from the Markdown body.
 * @param raw - SKILL.md text.
 * @param name - skill name for diagnostics.
 * @returns parsed frontmatter object and body after the closing `---`.
 */
function parseSkillMarkdown(
  raw: string,
  name: string,
): { data: Record<string, unknown>; body: string } {
  const firstLineEnd = raw.indexOf('\n')
  if (firstLineEnd < 0) {
    throw new Error(`强制 skill 缺少 YAML frontmatter: ${name}`)
  }
  const firstLine = raw.slice(0, firstLineEnd).replace(/\r$/, '')
  if (firstLine !== '---') {
    throw new Error(`强制 skill 缺少 YAML frontmatter: ${name}`)
  }
  const start = firstLineEnd + 1
  const closing = findClosingFrontmatter(raw, start)
  if (closing === undefined) {
    throw new Error(`强制 skill 缺少 YAML frontmatter: ${name}`)
  }
  const parsed = parse(raw.slice(start, closing.start)) as unknown
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`强制 skill frontmatter 必须是对象: ${name}`)
  }
  return { data: parsed as Record<string, unknown>, body: raw.slice(closing.bodyStart) }
}

/**
 * Find the closing `---` line after frontmatter YAML.
 * @param raw - full file text.
 * @param start - index after the opening `---\n`.
 * @returns slice bounds, or undefined when no closing fence exists.
 */
function findClosingFrontmatter(
  raw: string,
  start: number,
): { start: number; bodyStart: number } | undefined {
  let lineStart = start
  while (lineStart <= raw.length) {
    const nextNewline = raw.indexOf('\n', lineStart)
    const lineEnd = nextNewline < 0 ? raw.length : nextNewline
    const line = raw.slice(lineStart, lineEnd).replace(/\r$/, '')
    if (line === '---') {
      const bodyStart = nextNewline < 0 ? raw.length : nextNewline + 1
      return { start: lineStart, bodyStart }
    }
    if (nextNewline < 0) return undefined
    lineStart = nextNewline + 1
  }
  /* v8 ignore next -- the loop always returns on EOF; this satisfies noImplicitReturns. */
  return undefined
}
