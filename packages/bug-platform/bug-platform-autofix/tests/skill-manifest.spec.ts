import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveForcedSkills } from '../src/skill-manifest.ts'

/**
 * Write a temporary global skill clone (manifest + skill files).
 * @param manifest - manifest.yaml body.
 * @param files - paths relative to the clone root mapped to file contents.
 * @returns absolute clone root.
 */
function writeGlobalLocal(manifest: string, files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'skills-'))
  writeFileSync(join(dir, 'manifest.yaml'), manifest)
  for (const [rel, body] of Object.entries(files)) {
    const full = join(dir, rel)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, body)
  }
  return dir
}

const FIX_FRONTEND_BODY = '---\nname: fix-frontend-ticket\ndescription: x\n---\n# Body\nDo this.\n'

describe('resolveForcedSkills', () => {
  it('collects force bodies for a workspace', () => {
    const dir = mkdtempSync(join(tmpdir(), 'skills-'))
    mkdirSync(join(dir, 'skills/fix-frontend-ticket'), { recursive: true })
    writeFileSync(join(dir, 'manifest.yaml'), `
skills:
  - name: fix-frontend-ticket
    enabled: true
    force: true
    workspaceIds: []
  - name: gitlab-mr-hygiene
    enabled: true
    force: false
    workspaceIds: [custom]
`)
    writeFileSync(
      join(dir, 'skills/fix-frontend-ticket/SKILL.md'),
      '---\nname: fix-frontend-ticket\ndescription: x\n---\n# Body\nDo this.\n',
    )
    const resolved = resolveForcedSkills({
      globalLocal: dir,
      workspaceId: 'custom',
      autofixWorkspaceIds: ['custom', 'ailpha'],
      forceMaxCount: 3,
      forceMaxChars: 8000,
    })
    expect(resolved.map(s => s.name)).toEqual(['fix-frontend-ticket'])
    expect(resolved[0]?.body).toContain('Do this.')
  })

  it('fails when force count exceeds forceMaxCount', () => {
    const dir = writeGlobalLocal(
      `
skills:
  - name: one
    enabled: true
    force: true
    workspaceIds: []
  - name: two
    enabled: true
    force: true
    workspaceIds: []
`,
      {
        'skills/one/SKILL.md': '---\nname: one\ndescription: x\n---\nA\n',
        'skills/two/SKILL.md': '---\nname: two\ndescription: x\n---\nB\n',
      },
    )
    expect(() =>
      resolveForcedSkills({
        globalLocal: dir,
        workspaceId: 'custom',
        autofixWorkspaceIds: ['custom', 'ailpha'],
        forceMaxCount: 1,
        forceMaxChars: 8000,
      }),
    ).toThrow(/forceMaxCount/)
  })

  it('rejects disable-model-invocation on a forced skill', () => {
    const dir = writeGlobalLocal(
      `
skills:
  - name: blocked
    enabled: true
    force: true
    workspaceIds: []
`,
      {
        'skills/blocked/SKILL.md':
          '---\nname: blocked\ndescription: x\ndisable-model-invocation: true\n---\nDo not.\n',
      },
    )
    expect(() =>
      resolveForcedSkills({
        globalLocal: dir,
        workspaceId: 'custom',
        autofixWorkspaceIds: ['custom'],
        forceMaxCount: 3,
        forceMaxChars: 8000,
      }),
    ).toThrow(/disable-model-invocation/)
  })

  it('fails when forced body chars exceed forceMaxChars', () => {
    const dir = writeGlobalLocal(
      `
skills:
  - name: long
    enabled: true
    force: true
    workspaceIds: []
`,
      {
        'skills/long/SKILL.md': '---\nname: long\ndescription: x\n---\n' + 'x'.repeat(50),
      },
    )
    expect(() =>
      resolveForcedSkills({
        globalLocal: dir,
        workspaceId: 'custom',
        autofixWorkspaceIds: ['custom'],
        forceMaxCount: 3,
        forceMaxChars: 10,
      }),
    ).toThrow(/forceMaxChars/)
  })

  it('skips enabled:false even when force is true', () => {
    const dir = writeGlobalLocal(
      `
skills:
  - name: off
    enabled: false
    force: true
    workspaceIds: []
  - name: on
    enabled: true
    force: true
    workspaceIds: []
`,
      {
        'skills/on/SKILL.md': FIX_FRONTEND_BODY.replaceAll('fix-frontend-ticket', 'on'),
      },
    )
    const resolved = resolveForcedSkills({
      globalLocal: dir,
      workspaceId: 'custom',
      autofixWorkspaceIds: ['custom'],
      forceMaxCount: 3,
      forceMaxChars: 8000,
    })
    expect(resolved.map(s => s.name)).toEqual(['on'])
  })

  it('reads a flat skills/<name>.md when the directory bundle is absent', () => {
    const dir = writeGlobalLocal(
      `
skills:
  - name: flat-force
    enabled: true
    force: true
    workspaceIds: []
`,
      {
        'skills/flat-force.md': '---\nname: flat-force\ndescription: x\n---\nFlat body.\n',
      },
    )
    const resolved = resolveForcedSkills({
      globalLocal: dir,
      workspaceId: 'custom',
      autofixWorkspaceIds: ['custom'],
      forceMaxCount: 3,
      forceMaxChars: 8000,
    })
    expect(resolved).toHaveLength(1)
    expect(resolved[0]?.body).toContain('Flat body.')
  })

  it('excludes force skills whose workspaceIds do not include this workspace', () => {
    const dir = writeGlobalLocal(
      `
skills:
  - name: ailpha-only
    enabled: true
    force: true
    workspaceIds: [ailpha]
`,
      {
        'skills/ailpha-only/SKILL.md': '---\nname: ailpha-only\ndescription: x\n---\nNope.\n',
      },
    )
    const resolved = resolveForcedSkills({
      globalLocal: dir,
      workspaceId: 'custom',
      autofixWorkspaceIds: ['custom', 'ailpha'],
      forceMaxCount: 3,
      forceMaxChars: 8000,
    })
    expect(resolved).toEqual([])
  })

  it('throws when manifest.yaml is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'skills-'))
    expect(() =>
      resolveForcedSkills({
        globalLocal: dir,
        workspaceId: 'custom',
        autofixWorkspaceIds: ['custom'],
        forceMaxCount: 3,
        forceMaxChars: 8000,
      }),
    ).toThrow(/manifest.yaml 不存在/)
  })

  it('throws when a forced skill file is missing', () => {
    const dir = writeGlobalLocal(
      `
skills:
  - name: missing-body
    enabled: true
    force: true
    workspaceIds: []
`,
      {},
    )
    expect(() =>
      resolveForcedSkills({
        globalLocal: dir,
        workspaceId: 'custom',
        autofixWorkspaceIds: ['custom'],
        forceMaxCount: 3,
        forceMaxChars: 8000,
      }),
    ).toThrow(/缺少 SKILL.md/)
  })

  it('throws when forced skill frontmatter is missing', () => {
    const dir = writeGlobalLocal(
      `
skills:
  - name: no-fm
    enabled: true
    force: true
    workspaceIds: []
`,
      { 'skills/no-fm.md': 'no frontmatter here\n' },
    )
    expect(() =>
      resolveForcedSkills({
        globalLocal: dir,
        workspaceId: 'custom',
        autofixWorkspaceIds: ['custom'],
        forceMaxCount: 3,
        forceMaxChars: 8000,
      }),
    ).toThrow(/frontmatter/)
  })

  it('throws on invalid manifest structure', () => {
    const dir = writeGlobalLocal('[]\n', {})
    expect(() =>
      resolveForcedSkills({
        globalLocal: dir,
        workspaceId: 'custom',
        autofixWorkspaceIds: ['custom'],
        forceMaxCount: 3,
        forceMaxChars: 8000,
      }),
    ).toThrow(/root must be a non-array object/)

    const dir2 = writeGlobalLocal('skills: {}\n', {})
    expect(() =>
      resolveForcedSkills({
        globalLocal: dir2,
        workspaceId: 'custom',
        autofixWorkspaceIds: ['custom'],
        forceMaxCount: 3,
        forceMaxChars: 8000,
      }),
    ).toThrow(/skills must be an array/)

    const dir3 = writeGlobalLocal('skills: [force]\n', {})
    expect(() =>
      resolveForcedSkills({
        globalLocal: dir3,
        workspaceId: 'custom',
        autofixWorkspaceIds: ['custom'],
        forceMaxCount: 3,
        forceMaxChars: 8000,
      }),
    ).toThrow(/each skills\[\] entry must be an object/)

    const dir4 = writeGlobalLocal(
      `
skills:
  - name: ''
    enabled: true
    force: true
`,
      {},
    )
    expect(() =>
      resolveForcedSkills({
        globalLocal: dir4,
        workspaceId: 'custom',
        autofixWorkspaceIds: ['custom'],
        forceMaxCount: 3,
        forceMaxChars: 8000,
      }),
    ).toThrow(/skills\[\]\.name/)

    const dir5 = writeGlobalLocal(
      `
skills:
  - name: bad-ids
    enabled: true
    force: true
    workspaceIds: custom
`,
      {},
    )
    expect(() =>
      resolveForcedSkills({
        globalLocal: dir5,
        workspaceId: 'custom',
        autofixWorkspaceIds: ['custom'],
        forceMaxCount: 3,
        forceMaxChars: 8000,
      }),
    ).toThrow(/workspaceIds/)

    const dir6 = writeGlobalLocal(
      `
skills:
  - name: numeric-ids
    enabled: true
    force: true
    workspaceIds: [1]
`,
      {},
    )
    expect(() =>
      resolveForcedSkills({
        globalLocal: dir6,
        workspaceId: 'custom',
        autofixWorkspaceIds: ['custom'],
        forceMaxCount: 3,
        forceMaxChars: 8000,
      }),
    ).toThrow(/workspaceIds/)
  })

  it('throws when forced frontmatter is not an object or has no closing fence', () => {
    const dir = writeGlobalLocal(
      `
skills:
  - name: list-fm
    enabled: true
    force: true
    workspaceIds: []
`,
      { 'skills/list-fm.md': '---\n- a\n---\nbody\n' },
    )
    expect(() =>
      resolveForcedSkills({
        globalLocal: dir,
        workspaceId: 'custom',
        autofixWorkspaceIds: ['custom'],
        forceMaxCount: 3,
        forceMaxChars: 8000,
      }),
    ).toThrow(/frontmatter 必须是对象/)

    const dir2 = writeGlobalLocal(
      `
skills:
  - name: open-fm
    enabled: true
    force: true
    workspaceIds: []
`,
      { 'skills/open-fm.md': '---\nname: open-fm\ndescription: x\n' },
    )
    expect(() =>
      resolveForcedSkills({
        globalLocal: dir2,
        workspaceId: 'custom',
        autofixWorkspaceIds: ['custom'],
        forceMaxCount: 3,
        forceMaxChars: 8000,
      }),
    ).toThrow(/frontmatter/)

    const dir3 = writeGlobalLocal(
      `
skills:
  - name: one-line
    enabled: true
    force: true
    workspaceIds: []
`,
      { 'skills/one-line.md': 'no-newline' },
    )
    expect(() =>
      resolveForcedSkills({
        globalLocal: dir3,
        workspaceId: 'custom',
        autofixWorkspaceIds: ['custom'],
        forceMaxCount: 3,
        forceMaxChars: 8000,
      }),
    ).toThrow(/frontmatter/)
  })

  it('treats omitted workspaceIds as all autofix workspaces', () => {
    const dir = writeGlobalLocal(
      `
skills:
  - name: implicit-all
    enabled: true
    force: true
`,
      {
        'skills/implicit-all.md': '---\nname: implicit-all\ndescription: x\n---\nAll.\n',
      },
    )
    const resolved = resolveForcedSkills({
      globalLocal: dir,
      workspaceId: 'custom',
      autofixWorkspaceIds: ['custom'],
      forceMaxCount: 3,
      forceMaxChars: 8000,
    })
    expect(resolved.map(s => s.name)).toEqual(['implicit-all'])
  })

  it('accepts a closing frontmatter fence with no trailing newline', () => {
    const dir = writeGlobalLocal(
      `
skills:
  - name: eof
    enabled: true
    force: true
    workspaceIds: ~
`,
      { 'skills/eof.md': '---\nname: eof\ndescription: x\n---' },
    )
    const resolved = resolveForcedSkills({
      globalLocal: dir,
      workspaceId: 'custom',
      autofixWorkspaceIds: ['custom'],
      forceMaxCount: 3,
      forceMaxChars: 8000,
    })
    expect(resolved).toHaveLength(1)
    expect(resolved[0]?.body).toBe('')
  })
})
