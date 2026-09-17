import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadRepoEnv } from '../src/load-repo-env.ts'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
  delete process.env.BUG_PLATFORM_AUTOFIX_ENV_TEST
  delete process.env.BUG_PLATFORM_AUTOFIX_ENV_ONLY
})

describe('loadRepoEnv', () => {
  it('returns null when .env is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-load-repo-env-'))
    tempDirs.push(dir)
    expect(loadRepoEnv(dir)).toBeNull()
  })

  it('loads .env and lets file values win over ambient process.env', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-load-repo-env-'))
    tempDirs.push(dir)
    process.env.BUG_PLATFORM_AUTOFIX_ENV_TEST = 'ambient'
    writeFileSync(
      join(dir, '.env'),
      'BUG_PLATFORM_AUTOFIX_ENV_TEST=fromfile\nBUG_PLATFORM_AUTOFIX_ENV_ONLY=onlyfile\n',
      'utf8',
    )
    expect(loadRepoEnv(dir)).toBe(join(dir, '.env'))
    expect(process.env.BUG_PLATFORM_AUTOFIX_ENV_TEST).toBe('fromfile')
    expect(process.env.BUG_PLATFORM_AUTOFIX_ENV_ONLY).toBe('onlyfile')
  })
})
