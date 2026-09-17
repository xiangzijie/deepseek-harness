import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadOperatorConfig } from '../src/operator-config.ts'

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
})
