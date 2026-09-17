/**
 * Load the gitignored harness-root `.env` into `process.env`.
 * Keys present in the file win over already-set process variables.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseEnv } from 'node:util'

/**
 * Apply `<dir>/.env` onto `process.env` when the file exists.
 * Missing file is a no-op (ambient env still works).
 * @param dir - directory that may contain `.env` (typically harness root).
 * @returns absolute path loaded, or `null` when absent.
 */
export function loadRepoEnv(dir: string): string | null {
  const path = join(dir, '.env')
  if (!existsSync(path)) return null
  const values = parseEnv(readFileSync(path, 'utf8')) as Record<string, string>
  for (const [name, value] of Object.entries(values)) {
    process.env[name] = value
  }
  return path
}
