import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  renderHeadlessSkillPatch,
  resolvePersonalSkillPluginPath,
} from '../src/headless-skill-patch.ts'

describe('renderHeadlessSkillPatch', () => {
  it('writes skill-filesystem customSkillDirs and inserts personal plugin', () => {
    const yaml = renderHeadlessSkillPatch({
      globalSkillsDir: 'D:/g/skills',
      personalRoot: 'D:/p/local',
      personalPluginPath: 'D:/h/packages/bug-platform/bug-platform-autofix/src/personal-skill-plugin.ts',
    })
    expect(yaml).toContain('customSkillDirs')
    expect(yaml).toContain('D:/g/skills')
    expect(yaml).toContain('insert:')
    expect(yaml).toContain('autofix-personal-skills')
    expect(yaml).toContain('D:/p/local')
    expect(yaml.endsWith('\n')).toBe(true)
  })
})

describe('resolvePersonalSkillPluginPath', () => {
  it('returns a file URL so Windows ESM does not treat D: as a protocol', () => {
    const href = resolvePersonalSkillPluginPath('D:/h')
    const expected = pathToFileURL(
      join('D:/h', 'packages/bug-platform/bug-platform-autofix/src/personal-skill-plugin.ts'),
    ).href
    expect(href).toBe(expected)
    expect(href.startsWith('file:')).toBe(true)
  })
})
