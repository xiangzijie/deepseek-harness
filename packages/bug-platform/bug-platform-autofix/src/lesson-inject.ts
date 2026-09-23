/**
 * Load accepted lesson markdown bodies for injection into agent briefs.
 * @module @deepseek-ai/dsh-bug-platform-autofix/lesson-inject
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { selectAcceptedForInject, type LessonIndex } from './lesson-index.ts'

/** Maximum characters per injected lesson body before truncation. */
export const DEFAULT_LESSON_BODY_CHARS = 1200

/** One accepted lesson body selected for injection. */
export interface AcceptedLessonBody {
  /** Index row id (matches `accepted/<id>.md`). */
  id: string
  /** Symptom summary from the index row. */
  symptom: string
  /** Markdown body, possibly truncated. */
  body: string
}

/** Options for {@link loadAcceptedLessonBodies}. */
export interface LoadAcceptedLessonBodiesOptions {
  /** Lessons repo clone root (`accepted/` lives here). */
  localRoot: string
  /** Parsed lessons index (metadata only). */
  index: LessonIndex
  /** Exact `target_menu` to inject for. */
  targetMenu: string
  /** Maximum accepted rows to load. */
  injectMax: number
  /** Optional file reader (for tests); defaults to utf8 `readFileSync`. */
  readFile?: (path: string) => string
}

/**
 * Read accepted markdown bodies for the newest inject hits on one menu.
 * @param opts - clone root, index, menu filter, and inject cap.
 * @returns bodies in index selection order (newest first); missing files are skipped.
 * @throws rethrows non-ENOENT read failures from any reader.
 */
export function loadAcceptedLessonBodies(opts: LoadAcceptedLessonBodiesOptions): AcceptedLessonBody[] {
  const { localRoot, index, targetMenu, injectMax } = opts
  const readFile = opts.readFile ?? ((path: string) => readFileSync(path, 'utf8'))
  const rows = selectAcceptedForInject(index, targetMenu, injectMax)
  const bodies: AcceptedLessonBody[] = []

  for (const row of rows) {
    const path = join(localRoot, 'accepted', `${row.id}.md`)
    let raw: string
    try {
      raw = readFile(path)
    } catch (err) {
      const code = err && typeof err === 'object' && 'code' in err ? (err as NodeJS.ErrnoException).code : undefined
      if (code === 'ENOENT') {
        continue
      }
      throw err
    }

    let body = raw
    if (body.length > DEFAULT_LESSON_BODY_CHARS) {
      body = body.slice(0, DEFAULT_LESSON_BODY_CHARS) + '…(已截断)'
    }

    bodies.push({ id: row.id, symptom: row.symptom, body })
  }

  return bodies
}
