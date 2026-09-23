import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadOperatorConfig } from '../src/operator-config.ts'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const operatorExamplePath = join(repoRoot, 'examples/bug-platform-autofix/operator.example.yaml')

/** Write a temporary operator.yaml and return its absolute path. */
function writeYaml(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'operator-'))
  const path = join(dir, 'operator.yaml')
  writeFileSync(path, body)
  return path
}

/** Minimal valid operator.yaml skeleton for negative workspace cases. */
function minimalYaml(workspacesBlock: string): string {
  return `
harnessRoot: 'D:/h'
bugPlatform: { baseUrl: 'http://x', projectId: 1 }
gitlab: { host: 'http://g', tokenEnv: GITLAB_TOKEN }
mappingFile: 'D:/m'
stateFile: 'D:/s'
progressFile: 'D:/p'
assetsDir: 'D:/a'
workspaces:
${workspacesBlock}
skills:
  { globalRepo: 'git@x:y.git', globalLocal: 'D:/g', personalRoot: 'D:/p' }
run: {}
`
}

describe('loadOperatorConfig', () => {
  it('throws when the file is missing', () => {
    expect(() => loadOperatorConfig(join(tmpdir(), 'no-such-operator.yaml'))).toThrow(
      /operator.yaml 不存在/,
    )
  })

  it('loads workspaces and skill roots', () => {
    const path = writeYaml(`
harnessRoot: 'D:/h'
bugPlatform:
  baseUrl: 'http://example.invalid'
  projectId: 47
gitlab:
  host: 'http://gitlab.example'
  tokenEnv: GITLAB_TOKEN
mappingFile: 'D:/map.json'
stateFile: 'D:/state.json'
progressFile: 'D:/progress.json'
assetsDir: 'D:/assets'
workspaces:
  - id: custom
    localRoot: 'D:/custom'
    gitlabProjectId: 8325
    productBranch: 'dkh-custom-jinan'
    mappingRepo: custom
  - id: home
    localRoot: 'D:/home'
    gitlabProjectId: 8325
    productBranch: 'dkh-home-jinan'
    mappingRepo: home
    autofix: false
skills:
  globalRepo: 'git@gitlab.example:jgts/autofix-skills.git'
  globalLocal: 'D:/autofix-skills'
  personalRoot: 'D:/personal-skills'
  forceMaxCount: 3
  forceMaxChars: 8000
run:
  maxTickets: 1
  operatorId: local
  lintEnabled: false
  buildEnabled: false
`)
    const cfg = loadOperatorConfig(path)
    expect(cfg.workspaces).toHaveLength(2)
    expect(cfg.workspaceByMappingRepo('custom')?.localRoot).toBe('D:/custom')
    expect(cfg.workspaceByMappingRepo('home')?.autofix).toBe(false)
    expect(cfg.workspaceByMappingRepo('custom')?.autofix).toBe(true)
    expect(cfg.skills.forceMaxCount).toBe(3)
    expect(cfg.run.operatorId).toBe('local')
  })

  it('rejects duplicate workspace id and unknown mappingRepo', () => {
    const path = writeYaml(`
harnessRoot: 'D:/h'
bugPlatform: { baseUrl: 'http://x', projectId: 1 }
gitlab: { host: 'http://g', tokenEnv: GITLAB_TOKEN }
mappingFile: 'D:/m'
stateFile: 'D:/s'
progressFile: 'D:/p'
assetsDir: 'D:/a'
workspaces:
  - { id: a, localRoot: 'D:/a', gitlabProjectId: 1, productBranch: 'b', mappingRepo: nope }
skills:
  { globalRepo: 'git@x:y.git', globalLocal: 'D:/g', personalRoot: 'D:/p' }
run: {}
`)
    expect(() => loadOperatorConfig(path)).toThrow(/mappingRepo/)
  })

  it('rejects duplicate workspace id', () => {
    const path = writeYaml(minimalYaml(`
  - { id: dup, localRoot: 'D:/a', gitlabProjectId: 1, productBranch: 'b', mappingRepo: custom }
  - { id: dup, localRoot: 'D:/b', gitlabProjectId: 1, productBranch: 'c', mappingRepo: ailpha }
`))
    expect(() => loadOperatorConfig(path)).toThrow(/workspaces\[\]\.id/)
  })

  it('applies defaults when optional fields are omitted', () => {
    const path = writeYaml(`
harnessRoot: 'D:/h'
bugPlatform: { baseUrl: 'http://x', projectId: 1 }
gitlab: { host: 'http://g' }
mappingFile: 'D:/m'
stateFile: 'D:/s'
progressFile: 'D:/p'
assetsDir: 'D:/a'
workspaces:
  - { id: ws1, localRoot: 'D:/w', gitlabProjectId: 1, productBranch: 'b', mappingRepo: custom }
skills:
  { globalRepo: 'git@x:y.git', globalLocal: 'D:/g', personalRoot: 'D:/p' }
run: {}
`)
    const cfg = loadOperatorConfig(path)
    expect(cfg.gitlab.tokenEnv).toBe('GITLAB_TOKEN')
    expect(cfg.skills.forceMaxCount).toBe(3)
    expect(cfg.skills.forceMaxChars).toBe(8000)
    expect(cfg.run.maxTickets).toBe(1)
    expect(cfg.run.operatorId).toBe('local')
    expect(cfg.run.lintEnabled).toBe(false)
    expect(cfg.run.buildEnabled).toBe(false)
    expect(cfg.workspaces[0]?.autofix).toBe(true)
  })

  it('omits lessons when the section is absent', () => {
    const path = writeYaml(`
harnessRoot: 'D:/h'
bugPlatform: { baseUrl: 'http://x', projectId: 1 }
gitlab: { host: 'http://g' }
mappingFile: 'D:/m'
stateFile: 'D:/s'
progressFile: 'D:/p'
assetsDir: 'D:/a'
workspaces:
  - { id: ws1, localRoot: 'D:/w', gitlabProjectId: 1, productBranch: 'b', mappingRepo: custom }
skills:
  { globalRepo: 'git@x:y.git', globalLocal: 'D:/g', personalRoot: 'D:/p' }
run: {}
`)
    expect(loadOperatorConfig(path).lessons).toBeUndefined()
  })

  it('loads lessons with explicit injectMax from yaml', () => {
    const path = writeYaml(`${minimalYaml(`
  - { id: ws1, localRoot: 'D:/w', gitlabProjectId: 1, productBranch: 'b', mappingRepo: custom }
`)}lessons:
  repo: 'git@x:y.git'
  local: 'D:/l'
  injectMax: 5
`)
    expect(loadOperatorConfig(path).lessons?.injectMax).toBe(5)
  })

  it('loads lessons with injectMax default 3', () => {
    const path = writeYaml(`
harnessRoot: 'D:/h'
bugPlatform: { baseUrl: 'http://x', projectId: 1 }
gitlab: { host: 'http://g' }
mappingFile: 'D:/m'
stateFile: 'D:/s'
progressFile: 'D:/p'
assetsDir: 'D:/a'
workspaces:
  - { id: ws1, localRoot: 'D:/w', gitlabProjectId: 1, productBranch: 'b', mappingRepo: custom }
skills:
  { globalRepo: 'git@x:y.git', globalLocal: 'D:/g', personalRoot: 'D:/p' }
run: {}
lessons:
  repo: 'git@gitlab.example:jgts/autofix-lessons.git'
  local: 'D:/autofix-lessons'
`)
    expect(loadOperatorConfig(path).lessons).toEqual({
      repo: 'git@gitlab.example:jgts/autofix-lessons.git',
      local: 'D:/autofix-lessons',
      injectMax: 3,
    })
  })

  it('rejects lessons missing local', () => {
    const path = writeYaml(`
harnessRoot: 'D:/h'
bugPlatform: { baseUrl: 'http://x', projectId: 1 }
gitlab: { host: 'http://g' }
mappingFile: 'D:/m'
stateFile: 'D:/s'
progressFile: 'D:/p'
assetsDir: 'D:/a'
workspaces:
  - { id: ws1, localRoot: 'D:/w', gitlabProjectId: 1, productBranch: 'b', mappingRepo: custom }
skills:
  { globalRepo: 'git@x:y.git', globalLocal: 'D:/g', personalRoot: 'D:/p' }
run: {}
lessons:
  repo: 'git@x:y.git'
`)
    expect(() => loadOperatorConfig(path)).toThrow(/lessons\.local/)
  })

  it('rejects duplicate mappingRepo', () => {
    const path = writeYaml(minimalYaml(`
  - { id: a, localRoot: 'D:/a', gitlabProjectId: 1, productBranch: 'b', mappingRepo: custom }
  - { id: b, localRoot: 'D:/b', gitlabProjectId: 1, productBranch: 'c', mappingRepo: custom }
`))
    expect(() => loadOperatorConfig(path)).toThrow(/mappingRepo/)
  })

  it('resolves workspaceById', () => {
    const path = writeYaml(minimalYaml(`
  - { id: my-custom, localRoot: 'D:/custom', gitlabProjectId: 1, productBranch: 'b', mappingRepo: custom }
`))
    const cfg = loadOperatorConfig(path)
    expect(cfg.workspaceById('my-custom')?.localRoot).toBe('D:/custom')
    expect(cfg.workspaceById('missing')).toBeUndefined()
  })

  it('loads operator.example.yaml with three workspaces', () => {
    const cfg = loadOperatorConfig(operatorExamplePath)
    expect(cfg.workspaces).toHaveLength(3)
    expect(cfg.workspaceById('home')?.autofix).toBe(false)
    expect(cfg.workspaceByMappingRepo('ailpha')?.productBranch).toBe('dkh-ailpha-jinan')
    expect(cfg.lessons?.local).toContain('autofix-lessons')
  })
})
