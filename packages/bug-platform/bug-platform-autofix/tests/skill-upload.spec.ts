import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { validateSkillUpload, writePersonalSkill } from '../src/skill-upload.ts'

describe('validateSkillUpload', () => {
  it('accepts a markdown skill body', () => {
    const result = validateSkillUpload({
      filename: 'SKILL.md',
      bytes: Buffer.from('---\nname: my-skill\ndescription: d\n---\n# Hi\n'),
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.name).toBe('my-skill')
  })

  it('rejects zip and scripts paths', () => {
    expect(validateSkillUpload({ filename: 'x.zip', bytes: Buffer.from('PK') }).ok).toBe(false)
    expect(validateSkillUpload({ filename: 'scripts/run.sh', bytes: Buffer.from('echo') }).ok).toBe(
      false,
    )
    expect(validateSkillUpload({ filename: 'SKILL.html', bytes: Buffer.from('<p>') }).ok).toBe(false)
  })

  it('rejects personal force attempts', () => {
    expect(
      validateSkillUpload({
        filename: 'SKILL.md',
        bytes: Buffer.from('---\nname: x\ndescription: d\nforce: true\n---\n'),
        allowForce: false,
      }).ok,
    ).toBe(false)
  })
})

describe('writePersonalSkill', () => {
  it('writes personalRoot/operatorId/<name>/SKILL.md', () => {
    const personalRoot = mkdtempSync(join(tmpdir(), 'personal-upload-'))
    const markdown = '---\nname: my-skill\ndescription: d\n---\n# Hi\n'
    writePersonalSkill({
      personalRoot,
      operatorId: 'operator-1',
      name: 'my-skill',
      markdown,
    })
    expect(readFileSync(join(personalRoot, 'operator-1', 'my-skill', 'SKILL.md'), 'utf8')).toBe(markdown)
  })
})
