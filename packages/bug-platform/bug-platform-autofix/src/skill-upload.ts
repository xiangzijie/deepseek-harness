/**
 * Validate personal skill uploads (Markdown only) and persist accepted bodies
 * under an operator-scoped directory tree.
 *
 * @module @deepseek-ai/dsh-bug-platform-autofix/skill-upload
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { parse } from 'yaml'

/** Copied from {@link ./skill-manifest.ts}; this module stays free of dsh-skill. */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Inputs for {@link validateSkillUpload}. */
export interface ValidateSkillUploadInput {
  /** Client-provided filename (basename or path); must end with `.md` and must not contain `scripts/`. */
  filename: string
  /** Raw upload bytes; must be UTF-8 text without NUL or ZIP magic. */
  bytes: Buffer
  /**
   * When false (default), frontmatter `force: true` is rejected.
   * Personal uploads keep this false; global editors may opt in later.
   */
  allowForce?: boolean
}

/** Successful validation carries the parsed skill name and normalized Markdown text. */
export type SkillUploadOk = {
  ok: true
  name: string
  markdown: string
}

/** Failed validation; `reason` is safe to surface in UI or CLI output. */
export type SkillUploadErr = {
  ok: false
  reason: string
}

/** Discriminated result of {@link validateSkillUpload}. */
export type SkillUploadResult = SkillUploadOk | SkillUploadErr

/** Inputs for {@link writePersonalSkill}. */
export interface WritePersonalSkillInput {
  /** Root directory that contains per-operator subfolders. */
  personalRoot: string
  /** Operator id segment under `personalRoot`. */
  operatorId: string
  /** kebab-case skill name; must match validated frontmatter. */
  name: string
  /** Full SKILL.md text to write. */
  markdown: string
}

/**
 * Validate an uploaded skill file before persisting it as personal Markdown.
 * @param input - filename, bytes, and optional force allowance.
 * @returns ok with `name` and `markdown`, or ok false with a `reason`.
 */
export function validateSkillUpload(input: ValidateSkillUploadInput): SkillUploadResult {
  const allowForce = input.allowForce ?? false
  const normalizedPath = input.filename.replace(/\\/g, '/')
  if (normalizedPath.includes('scripts/')) {
    return { ok: false, reason: '不允许上传 scripts/ 路径下的文件' }
  }
  const base = basename(normalizedPath)
  if (!base.toLowerCase().endsWith('.md')) {
    return { ok: false, reason: '只允许 .md 格式的 Markdown 文件' }
  }
  if (input.bytes.includes(0)) {
    return { ok: false, reason: '上传内容不能包含 NUL 字节' }
  }
  if (input.bytes.length >= 2 && input.bytes[0] === 0x50 && input.bytes[1] === 0x4b) {
    return { ok: false, reason: '不允许 ZIP 或其它二进制包' }
  }
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(input.bytes)
  } catch {
    return { ok: false, reason: '上传内容必须是 UTF-8 文本' }
  }
  const parsed = parseSkillFrontmatter(text)
  if (!parsed.ok) return parsed
  const { data } = parsed
  const nameRaw = data.name
  if (typeof nameRaw !== 'string' || nameRaw.trim() === '') {
    return { ok: false, reason: 'frontmatter 必须包含非空 name' }
  }
  const name = nameRaw.trim()
  if (!SKILL_NAME.test(name)) {
    return { ok: false, reason: 'name 必须是 kebab-case' }
  }
  const descriptionRaw = data.description
  if (typeof descriptionRaw !== 'string' || descriptionRaw.trim() === '') {
    return { ok: false, reason: 'frontmatter 必须包含非空 description' }
  }
  if (isForceTrue(data.force) && !allowForce) {
    return { ok: false, reason: '个人 skill 不能设置 force: true' }
  }
  return { ok: true, name, markdown: text }
}

/**
 * Write a validated personal skill to `personalRoot/operatorId/<name>/SKILL.md`.
 * @param input - root paths, skill name, and Markdown body.
 */
export function writePersonalSkill(input: WritePersonalSkillInput): void {
  const dir = join(input.personalRoot, input.operatorId, input.name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), input.markdown, 'utf8')
}

/**
 * Parse YAML frontmatter from SKILL.md text.
 * @param raw - full file contents.
 * @returns parsed frontmatter map and body start index, or an error result.
 */
function parseSkillFrontmatter(
  raw: string,
): { ok: true; data: Record<string, unknown>; bodyStart: number } | SkillUploadErr {
  const firstLineEnd = raw.indexOf('\n')
  if (firstLineEnd < 0) {
    return { ok: false, reason: '缺少 YAML frontmatter' }
  }
  const firstLine = raw.slice(0, firstLineEnd).replace(/\r$/, '')
  if (firstLine !== '---') {
    return { ok: false, reason: '缺少 YAML frontmatter' }
  }
  const start = firstLineEnd + 1
  const closing = findClosingFrontmatter(raw, start)
  if (closing === undefined) {
    return { ok: false, reason: '缺少 YAML frontmatter 结束标记' }
  }
  let parsed: unknown
  try {
    parsed = parse(raw.slice(start, closing.start))
  } catch {
    return { ok: false, reason: 'frontmatter YAML 无效' }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'frontmatter 必须是对象' }
  }
  return { ok: true, data: parsed as Record<string, unknown>, bodyStart: closing.bodyStart }
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
  return undefined
}

/**
 * Treat YAML booleans and common string forms as forced injection.
 * @param value - frontmatter `force` field.
 * @returns whether the upload requests forced brief injection.
 */
function isForceTrue(value: unknown): boolean {
  if (value === true) return true
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase()
    return lower === 'true' || lower === 'yes'
  }
  return false
}
