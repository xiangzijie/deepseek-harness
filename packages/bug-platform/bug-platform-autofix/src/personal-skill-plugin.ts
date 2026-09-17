/**
 * Rank-50 personal skill provider for bug-platform autofix.
 * Lower rank than in-repo skill-filesystem roots (100/200), so operator-scoped
 * personal skills win duplicate names. Global skills stay on customSkillDirs.
 *
 * @module @deepseek-ai/dsh-bug-platform-autofix/personal-skill-plugin
 */

import { readdir, readFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import { parse as parseYaml } from 'yaml'
import {
  isSkillName,
  type SkillCandidate,
  type SkillDefinition,
  type SkillProvider,
} from '@deepseek-ai/dsh-skill'

/** Wins in-repo project-dsh (100) and project-agents (200) on duplicate names. */
const PERSONAL_SKILL_RANK = 50
const PROVIDER_NAME = 'autofix-personal'
const DEFAULT_INVOCATION = { modelInvocable: true, userInvocable: true } as const

interface PersonalLocator {
  path: string
  directory: string
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'autofix-personal-skills'
/** Requires `ctx.skills` from `@deepseek-ai/dsh-skill`. */
export const inject = ['skills']

/** Personal skill root scanned one level deep. */
export interface Config {
  /** Absolute operator-scoped directory (`personalRoot/operatorId`). */
  root: string
}

export const Config: Schema<Config> = z.object({
  root: z.string(),
})

/**
 * Build the rank-50 personal filesystem provider for one root.
 * A missing root is a legal empty catalog.
 * @param root - operator-scoped personal skill directory.
 * @returns a {@link SkillProvider} named `autofix-personal`.
 */
export function createPersonalSkillProvider(root: string): SkillProvider {
  const provider: SkillProvider = {
    name: PROVIDER_NAME,
    async list(): Promise<SkillCandidate[]> {
      const entries = await listRootEntries(root)
      const candidates: SkillCandidate[] = []
      for (const entry of entries) {
        const parsed = await parsePersonalSkillFile(entry.locator.path)
        if (parsed === undefined || parsed.disableModelInvocation) continue
        candidates.push({
          name: parsed.name,
          description: parsed.description,
          invocation: DEFAULT_INVOCATION,
          provider: PROVIDER_NAME,
          source: 'custom',
          rank: PERSONAL_SKILL_RANK,
          locator: entry.locator,
          resourceBase: { kind: 'directory', path: entry.locator.directory },
          path: entry.locator.path,
        })
      }
      return candidates
    },
    async get(candidate): Promise<SkillDefinition | undefined> {
      const locator = candidate.locator as PersonalLocator
      const parsed = await parsePersonalSkillFile(locator.path)
      if (parsed === undefined) return undefined
      return {
        name: parsed.name,
        description: parsed.description,
        invocation: DEFAULT_INVOCATION,
        provider: PROVIDER_NAME,
        source: 'custom',
        resourceBase: { kind: 'directory', path: locator.directory },
        path: locator.path,
        content: parsed.content,
      }
    },
  }
  return provider
}

/**
 * Register the personal provider on `ctx.skills`.
 * @param ctx - Cordis context with `skills` injected.
 * @param config - resolved {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.skills.registerProvider(() => createPersonalSkillProvider(config.root))
}

interface RootSkillEntry {
  locator: PersonalLocator
}

interface ParsedPersonalSkill {
  name: string
  description: string
  content: string
  disableModelInvocation: boolean
}

/**
 * List one-level kebab-case `name/SKILL.md` and `name.md` entries.
 * @param root - personal skill directory.
 * @returns locators; missing or non-directory roots yield `[]`.
 */
async function listRootEntries(root: string): Promise<RootSkillEntry[]> {
  let dirents
  try {
    dirents = await readdir(root, { withFileTypes: true })
  } catch {
    // Missing, non-directory, and unreadable roots are an empty personal catalog.
    return []
  }

  const entries: RootSkillEntry[] = []
  for (const dirent of dirents) {
    const locator = locatorForDirent(root, dirent)
    if (locator !== undefined) entries.push({ locator })
  }
  return entries
}

/**
 * Map one directory or flat Markdown child to a skill locator.
 * @param root - personal skill directory.
 * @param dirent - one-level child of `root`.
 * @returns locator, or `undefined` when the name is not kebab-case.
 */
function locatorForDirent(
  root: string,
  dirent: { name: string; isDirectory(): boolean; isFile(): boolean },
): PersonalLocator | undefined {
  if (dirent.isDirectory()) {
    if (!isSkillName(dirent.name)) return undefined
    const directory = join(root, dirent.name)
    return { path: join(directory, 'SKILL.md'), directory }
  }
  if (dirent.isFile() && extname(dirent.name) === '.md') {
    const skillName = basename(dirent.name, '.md')
    if (!isSkillName(skillName)) return undefined
    return { path: join(root, dirent.name), directory: root }
  }
  return undefined
}

/**
 * Parse YAML frontmatter from a personal skill file.
 * @param path - absolute SKILL.md or flat `.md` path.
 * @returns parsed fields, or `undefined` when the file is missing or invalid.
 */
async function parsePersonalSkillFile(path: string): Promise<ParsedPersonalSkill | undefined> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    // A missing or unreadable SKILL.md is skipped during discovery and get().
    return undefined
  }

  const parsed = parseFrontmatter(raw)
  if (parsed === undefined) return undefined
  const name = stringField(parsed.data, 'name')
  const description = stringField(parsed.data, 'description')
  if (name === undefined || description === undefined || !isSkillName(name)) {
    return undefined
  }
  return {
    name,
    description,
    content: parsed.body.trim(),
    disableModelInvocation: parsed.data['disable-model-invocation'] === true,
  }
}

/**
 * Split YAML frontmatter from a Markdown body.
 * @param raw - file text.
 * @returns frontmatter object and body, or `undefined` when fences are missing.
 */
function parseFrontmatter(raw: string): { data: Record<string, unknown>; body: string } | undefined {
  const firstLineEnd = raw.indexOf('\n')
  if (firstLineEnd < 0) return undefined
  const firstLine = raw.slice(0, firstLineEnd).replace(/\r$/, '')
  if (firstLine !== '---') return undefined
  const start = firstLineEnd + 1
  const closing = findClosingFrontmatter(raw, start)
  if (closing === undefined) return undefined
  let parsed: unknown
  try {
    parsed = parseYaml(raw.slice(start, closing.start))
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return undefined
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
      return { start: lineStart, bodyStart: nextNewline < 0 ? raw.length : nextNewline + 1 }
    }
    if (nextNewline < 0) return undefined
    lineStart = nextNewline + 1
  }
}

/**
 * Read a required non-empty string frontmatter field.
 * @param data - parsed frontmatter object.
 * @param key - field name.
 * @returns the string, or `undefined` when missing or empty.
 */
function stringField(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
