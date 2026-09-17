import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { inspectWorkspace } from '../src/workspace-health.ts'

const GITLAB_HOST = 'http://gitlab.example'
const PROJECT_ID = 8325
const PRODUCT_BRANCH = 'dkh-custom-jinan'

describe('inspectWorkspace', () => {
  it('reports missing directory', async () => {
    const report = await inspectWorkspace({
      localRoot: join(tmpdir(), 'no-ws'),
      productBranch: PRODUCT_BRANCH,
      gitlabHost: GITLAB_HOST,
      gitlabProjectId: PROJECT_ID,
      runGit: async () => '',
    })
    expect(report.ok).toBe(false)
    expect(report.reasons.join('\n')).toMatch(/目录不存在/)
  })

  it('rejects origin that does not contain the gitlab host', async () => {
    const report = await inspectWorkspace({
      localRoot: 'D:/exists-not-used',
      productBranch: PRODUCT_BRANCH,
      gitlabHost: GITLAB_HOST,
      gitlabProjectId: PROJECT_ID,
      directoryExists: true,
      isGit: true,
      runGit: async (_cwd, args) => {
        if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'dkh-custom-jinan\n'
        if (args[0] === 'status') return ''
        if (args[0] === 'remote') return 'git@other.example:foo/bar.git\n'
        return ''
      },
    })
    expect(report.ok).toBe(false)
    expect(report.reasons.join('\n')).toMatch(/origin/)
  })

  it('reports missing .git', async () => {
    const report = await inspectWorkspace({
      localRoot: 'D:/exists-not-used',
      productBranch: PRODUCT_BRANCH,
      gitlabHost: GITLAB_HOST,
      gitlabProjectId: PROJECT_ID,
      directoryExists: true,
      isGit: false,
      runGit: async () => '',
    })
    expect(report.ok).toBe(false)
    expect(report.reasons.join('\n')).toMatch(/\.git|不是 git/)
  })

  it('rejects HEAD that is neither productBranch nor bugfix/<digits>', async () => {
    const report = await inspectWorkspace({
      localRoot: 'D:/exists-not-used',
      productBranch: PRODUCT_BRANCH,
      gitlabHost: GITLAB_HOST,
      gitlabProjectId: PROJECT_ID,
      directoryExists: true,
      isGit: true,
      runGit: async (_cwd, args) => {
        if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'main\n'
        if (args[0] === 'status') return ''
        if (args[0] === 'remote') return 'git@gitlab.example:foo/bar.git\n'
        return ''
      },
    })
    expect(report.ok).toBe(false)
    expect(report.reasons.join('\n')).toMatch(/HEAD|main|dkh-custom-jinan/)
  })

  it('rejects a dirty worktree', async () => {
    const report = await inspectWorkspace({
      localRoot: 'D:/exists-not-used',
      productBranch: PRODUCT_BRANCH,
      gitlabHost: GITLAB_HOST,
      gitlabProjectId: PROJECT_ID,
      directoryExists: true,
      isGit: true,
      runGit: async (_cwd, args) => {
        if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'dkh-custom-jinan\n'
        if (args[0] === 'status') return ' M src/a.ts\n'
        if (args[0] === 'remote') return 'git@gitlab.example:foo/bar.git\n'
        return ''
      },
    })
    expect(report.ok).toBe(false)
    expect(report.reasons.join('\n')).toMatch(/未提交|dirty|变更/)
  })

  it('accepts ssh origin whose hostname matches gitlab.host', async () => {
    const report = await inspectWorkspace({
      localRoot: 'D:/exists-not-used',
      productBranch: PRODUCT_BRANCH,
      gitlabHost: GITLAB_HOST,
      gitlabProjectId: PROJECT_ID,
      directoryExists: true,
      isGit: true,
      runGit: async (_cwd, args) => {
        if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'bugfix/428\n'
        if (args[0] === 'status') return ''
        if (args[0] === 'remote') return 'git@gitlab.example:group/repo.git\n'
        return ''
      },
    })
    expect(report.ok).toBe(true)
    expect(report.reasons).toEqual([])
  })

  it('accepts https origin with a username whose hostname matches gitlab.host', async () => {
    const report = await inspectWorkspace({
      localRoot: 'D:/exists-not-used',
      productBranch: PRODUCT_BRANCH,
      gitlabHost: GITLAB_HOST,
      gitlabProjectId: PROJECT_ID,
      directoryExists: true,
      isGit: true,
      runGit: async (_cwd, args) => {
        if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'dkh-custom-jinan\n'
        if (args[0] === 'status') return ''
        if (args[0] === 'remote') return 'https://user@gitlab.example/group/repo.git\n'
        return ''
      },
    })
    expect(report.ok).toBe(true)
    expect(report.reasons).toEqual([])
  })

  it('accepts ssh:// origin whose hostname matches gitlab.host', async () => {
    const report = await inspectWorkspace({
      localRoot: 'D:/exists-not-used',
      productBranch: PRODUCT_BRANCH,
      gitlabHost: GITLAB_HOST,
      gitlabProjectId: PROJECT_ID,
      directoryExists: true,
      isGit: true,
      runGit: async (_cwd, args) => {
        if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'dkh-custom-jinan\n'
        if (args[0] === 'status') return ''
        if (args[0] === 'remote') return 'ssh://git@gitlab.example/group/repo.git\n'
        return ''
      },
    })
    expect(report.ok).toBe(true)
    expect(report.reasons).toEqual([])
  })

  it('rejects an unparseable origin URL', async () => {
    const report = await inspectWorkspace({
      localRoot: 'D:/exists-not-used',
      productBranch: PRODUCT_BRANCH,
      gitlabHost: GITLAB_HOST,
      gitlabProjectId: PROJECT_ID,
      directoryExists: true,
      isGit: true,
      runGit: async (_cwd, args) => {
        if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'dkh-custom-jinan\n'
        if (args[0] === 'status') return ''
        if (args[0] === 'remote') return 'not-a-remote\n'
        return ''
      },
    })
    expect(report.ok).toBe(false)
    expect(report.reasons.join('\n')).toMatch(/origin/)
  })

  it('rejects an empty origin URL', async () => {
    const report = await inspectWorkspace({
      localRoot: 'D:/exists-not-used',
      productBranch: PRODUCT_BRANCH,
      gitlabHost: GITLAB_HOST,
      gitlabProjectId: PROJECT_ID,
      directoryExists: true,
      isGit: true,
      runGit: async (_cwd, args) => {
        if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'dkh-custom-jinan\n'
        if (args[0] === 'status') return ''
        if (args[0] === 'remote') return '\n'
        return ''
      },
    })
    expect(report.ok).toBe(false)
    expect(report.reasons.join('\n')).toMatch(/origin/)
  })

  it('matches origin against a gitlab.host that has no URI scheme', async () => {
    const report = await inspectWorkspace({
      localRoot: 'D:/exists-not-used',
      productBranch: PRODUCT_BRANCH,
      gitlabHost: 'gitlab.example',
      gitlabProjectId: PROJECT_ID,
      directoryExists: true,
      isGit: true,
      runGit: async (_cwd, args) => {
        if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'dkh-custom-jinan\n'
        if (args[0] === 'status') return ''
        if (args[0] === 'remote') return 'https://gitlab.example/group/repo.git\n'
        return ''
      },
    })
    expect(report.ok).toBe(true)
  })

  it('records git command failures as reasons', async () => {
    const report = await inspectWorkspace({
      localRoot: 'D:/exists-not-used',
      productBranch: PRODUCT_BRANCH,
      gitlabHost: GITLAB_HOST,
      gitlabProjectId: PROJECT_ID,
      directoryExists: true,
      isGit: true,
      runGit: async (_cwd, args) => {
        if (args[0] === 'rev-parse') throw new Error('head boom')
        if (args[0] === 'status') throw 'status boom'
        if (args[0] === 'remote') throw new Error('origin boom')
        return ''
      },
    })
    expect(report.ok).toBe(false)
    expect(report.reasons.join('\n')).toMatch(/HEAD/)
    expect(report.reasons.join('\n')).toMatch(/status/)
    expect(report.reasons.join('\n')).toMatch(/origin/)
  })

  it('reports missing .git on a real directory without test hooks', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ws-'))
    const report = await inspectWorkspace({
      localRoot: dir,
      productBranch: PRODUCT_BRANCH,
      gitlabHost: GITLAB_HOST,
      gitlabProjectId: PROJECT_ID,
      runGit: async () => '',
    })
    expect(report.ok).toBe(false)
    expect(report.reasons.join('\n')).toMatch(/\.git|不是 git/)
  })

  it('rejects an invalid gitlab.host URL', async () => {
    const report = await inspectWorkspace({
      localRoot: 'D:/exists-not-used',
      productBranch: PRODUCT_BRANCH,
      gitlabHost: 'http://[',
      gitlabProjectId: PROJECT_ID,
      directoryExists: true,
      isGit: true,
      runGit: async (_cwd, args) => {
        if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'dkh-custom-jinan\n'
        if (args[0] === 'status') return ''
        if (args[0] === 'remote') return 'git@gitlab.example:foo/bar.git\n'
        return ''
      },
    })
    expect(report.ok).toBe(false)
    expect(report.reasons.join('\n')).toMatch(/origin/)
  })

  it('rejects a blank gitlab.host', async () => {
    const report = await inspectWorkspace({
      localRoot: 'D:/exists-not-used',
      productBranch: PRODUCT_BRANCH,
      gitlabHost: '   ',
      gitlabProjectId: PROJECT_ID,
      directoryExists: true,
      isGit: true,
      runGit: async (_cwd, args) => {
        if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'dkh-custom-jinan\n'
        if (args[0] === 'status') return ''
        if (args[0] === 'remote') return 'git@gitlab.example:foo/bar.git\n'
        return ''
      },
    })
    expect(report.ok).toBe(false)
    expect(report.reasons.join('\n')).toMatch(/origin/)
  })
})
