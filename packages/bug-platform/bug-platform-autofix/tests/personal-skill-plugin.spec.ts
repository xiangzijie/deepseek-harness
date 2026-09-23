import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { SkillCandidate } from '@deepseek-ai/dsh-skill'
import {
  apply,
  Config,
  createPersonalSkillProvider,
  inject,
  name,
} from '../src/personal-skill-plugin.ts'

/**
 * Narrow `SkillProvider.list` to a candidate array (the union also allows observations).
 * @param listed - provider list result.
 * @returns skill candidates.
 */
function asSkillCandidates(listed: readonly SkillCandidate[] | object): readonly SkillCandidate[] {
  if (!Array.isArray(listed)) {
    throw new Error('expected SkillCandidate[]')
  }
  return listed
}

/**
 * Write a one-level personal skill tree under a fresh temp directory.
 * @param files - relative paths mapped to file contents.
 * @returns absolute personal root.
 */
function writePersonalRoot(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'personal-skills-'))
  for (const [rel, body] of Object.entries(files)) {
    const full = join(dir, rel)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, body)
  }
  return dir
}

describe('createPersonalSkillProvider', () => {
  it('lists kebab-case directory skills at rank 50 with source custom', async () => {
    const root = writePersonalRoot({
      'foo/SKILL.md': '---\nname: foo\ndescription: personal foo\n---\nDo foo.\n',
    })
    const provider = createPersonalSkillProvider(root)
    const listed = await provider.list({})
    expect(provider.name).toBe('autofix-personal')
    expect(listed).toEqual([
      expect.objectContaining({
        name: 'foo',
        rank: 50,
        source: 'custom',
        provider: 'autofix-personal',
        description: 'personal foo',
      }),
    ])
  })

  it('omits disable-model-invocation: true entries from list', async () => {
    const root = writePersonalRoot({
      'foo/SKILL.md': '---\nname: foo\ndescription: visible\n---\nOk.\n',
      'hidden/SKILL.md':
        '---\nname: hidden\ndescription: secret\ndisable-model-invocation: true\n---\nNo.\n',
    })
    const listed = asSkillCandidates(await createPersonalSkillProvider(root).list({}))
    expect(listed.map(skill => skill.name)).toEqual(['foo'])
  })

  it('returns an empty list when the personal root is missing', async () => {
    const listed = await createPersonalSkillProvider(
      join(tmpdir(), 'missing-personal-skills-root'),
    ).list({})
    expect(listed).toEqual([])
  })

  it('returns an empty list when root is a file, not a directory', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'personal-file-')), 'not-a-dir')
    writeFileSync(file, 'x')
    expect(await createPersonalSkillProvider(file).list({})).toEqual([])
  })

  it('lists a flat kebab-case markdown file and loads get()', async () => {
    const root = writePersonalRoot({
      'bar.md': '---\nname: bar\ndescription: flat bar\n---\nFlat body.\n',
    })
    const provider = createPersonalSkillProvider(root)
    const listed = asSkillCandidates(await provider.list({}))
    expect(listed.map(skill => skill.name)).toEqual(['bar'])
    const first = listed[0]
    if (first === undefined) throw new Error('expected listed skill')
    const loaded = await provider.get(first, {})
    expect(loaded?.content).toContain('Flat body.')
    expect(loaded?.source).toBe('custom')
  })

  it('skips non-kebab names, non-markdown files, and invalid frontmatter', async () => {
    const root = writePersonalRoot({
      'NotKebab/SKILL.md': '---\nname: not-kebab\ndescription: x\n---\nNo.\n',
      'notes.txt': '---\nname: notes\ndescription: x\n---\nNo.\n',
      'foo_bar.md': '---\nname: foo-bar\ndescription: x\n---\nNo.\n',
      'broken.md': 'no frontmatter\n',
      'empty-name.md': '---\nname: \ndescription: x\n---\nNo.\n',
      'no-desc.md': '---\nname: no-desc\n---\nNo.\n',
      'bad-name.md': '---\nname: NotValid\ndescription: x\n---\nNo.\n',
      'array-fm.md': '---\n- just\n- a list\n---\nNo.\n',
      'unclosed.md': '---\nname: unclosed\ndescription: x\n',
      'one-line.md': '---',
      'invalid-yaml.md': '---\nname: [unterminated\n---\nNo.\n',
      'null-fm.md': '---\n---\nNo.\n',
      'scalar-fm.md': '---\njust-a-string\n---\nNo.\n',
    })
    mkdirSync(join(root, 'empty-dir'), { recursive: true })
    expect(await createPersonalSkillProvider(root).list({})).toEqual([])
  })

  it('lists a skill whose closing frontmatter fence is at EOF', async () => {
    const root = writePersonalRoot({
      'eof.md': '---\nname: eof\ndescription: x\n---',
    })
    const listed = asSkillCandidates(await createPersonalSkillProvider(root).list({}))
    expect(listed.map(skill => skill.name)).toEqual(['eof'])
  })

  it('returns undefined from get() when the locator file is gone', async () => {
    const provider = createPersonalSkillProvider(join(tmpdir(), 'gone'))
    const loaded = await provider.get({
      name: 'gone',
      description: 'x',
      invocation: { modelInvocable: true, userInvocable: true },
      provider: 'autofix-personal',
      source: 'custom',
      rank: 50,
      locator: { path: join(tmpdir(), 'missing-skill.md'), directory: tmpdir() },
    }, {})
    expect(loaded).toBeUndefined()
  })
})

describe('plugin metadata', () => {
  it('exports name, inject, and Config.root', () => {
    expect(name).toBe('autofix-personal-skills')
    expect(inject).toEqual(['skills'])
    expect(Config({ root: 'D:/p/local' }).root).toBe('D:/p/local')
  })
})

describe('apply', () => {
  it('registers the personal provider on ctx.skills', () => {
    const registerProvider = vi.fn()
    apply(
      { skills: { registerProvider } } as never,
      { root: join(tmpdir(), 'personal') },
    )
    expect(registerProvider).toHaveBeenCalledTimes(1)
    const factory = registerProvider.mock.calls[0]?.[0] as () => { name: string }
    expect(factory().name).toBe('autofix-personal')
  })
})
