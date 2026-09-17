import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { assertGlobalSkillsRunnable } from '../src/skill-sync.ts'

describe('assertGlobalSkillsRunnable', () => {
  it('refuses dirty force files', async () => {
    await expect(
      assertGlobalSkillsRunnable({
        globalLocal: 'D:/g',
        forceNames: ['fix-frontend-ticket'],
        allowStaleRevision: false,
        directoryExists: true,
        runGit: async (_cwd, args) => {
          if (args.join(' ') === 'status --porcelain') {
            return ' M skills/fix-frontend-ticket/SKILL.md\n'
          }
          return 'abc\n'
        },
      }),
    ).rejects.toThrow(/未合入的强制/)
  })

  it('allows clean HEAD matching origin/main', async () => {
    await expect(
      assertGlobalSkillsRunnable({
        globalLocal: 'D:/g',
        forceNames: ['fix-frontend-ticket'],
        allowStaleRevision: false,
        protectedBranch: 'main',
        directoryExists: true,
        runGit: async (_cwd, args) => {
          if (args.join(' ') === 'status --porcelain') return ''
          if (args[0] === 'rev-parse') return 'abc\n'
          return ''
        },
      }),
    ).resolves.toBeUndefined()
  })

  it('refuses stale HEAD versus origin/main', async () => {
    await expect(
      assertGlobalSkillsRunnable({
        globalLocal: 'D:/g',
        forceNames: ['fix-frontend-ticket'],
        allowStaleRevision: false,
        directoryExists: true,
        runGit: async (_cwd, args) => {
          if (args.join(' ') === 'status --porcelain') return ''
          if (args.join(' ') === 'rev-parse HEAD') return 'abc\n'
          if (args.join(' ') === 'rev-parse origin/main') return 'def\n'
          return ''
        },
      }),
    ).rejects.toThrow(/同步全局 skill/)
  })

  it('allows stale HEAD when allowStaleRevision is true if force files are clean', async () => {
    await expect(
      assertGlobalSkillsRunnable({
        globalLocal: 'D:/g',
        forceNames: ['fix-frontend-ticket'],
        allowStaleRevision: true,
        protectedBranch: 'main',
        directoryExists: true,
        runGit: async (_cwd, args) => {
          if (args.join(' ') === 'status --porcelain') return ' M README.md\n'
          if (args.join(' ') === 'rev-parse HEAD') return 'abc\n'
          if (args.join(' ') === 'rev-parse origin/main') return 'def\n'
          return ''
        },
      }),
    ).resolves.toBeUndefined()
  })

  it('refuses dirty manifest.yaml even when allowStaleRevision is true', async () => {
    await expect(
      assertGlobalSkillsRunnable({
        globalLocal: 'D:/g',
        forceNames: ['fix-frontend-ticket'],
        allowStaleRevision: true,
        directoryExists: true,
        runGit: async (_cwd, args) => {
          if (args.join(' ') === 'status --porcelain') return ' M manifest.yaml\n'
          return 'abc\n'
        },
      }),
    ).rejects.toThrow(/未合入的强制/)
  })

  it('refuses a dirty flat force skill path even when allowStaleRevision is true', async () => {
    await expect(
      assertGlobalSkillsRunnable({
        globalLocal: 'D:/g',
        forceNames: ['fix-frontend-ticket'],
        allowStaleRevision: true,
        directoryExists: true,
        runGit: async (_cwd, args) => {
          if (args.join(' ') === 'status --porcelain') return ' M skills/fix-frontend-ticket.md\n'
          return 'abc\n'
        },
      }),
    ).rejects.toThrow(/未合入的强制/)
  })

  it('refuses a renamed force skill path', async () => {
    await expect(
      assertGlobalSkillsRunnable({
        globalLocal: 'D:/g',
        forceNames: ['fix-frontend-ticket'],
        allowStaleRevision: true,
        directoryExists: true,
        runGit: async (_cwd, args) => {
          if (args.join(' ') === 'status --porcelain') {
            return 'R  skills/old.md -> skills/fix-frontend-ticket/SKILL.md\n'
          }
          return 'abc\n'
        },
      }),
    ).rejects.toThrow(/未合入的强制/)
  })

  it('fails when the globalLocal directory is missing and force names are present', async () => {
    await expect(
      assertGlobalSkillsRunnable({
        globalLocal: join(tmpdir(), 'missing-autofix-global-skills'),
        forceNames: ['fix-frontend-ticket'],
        allowStaleRevision: false,
        runGit: async () => '',
      }),
    ).rejects.toThrow()
  })

  it('skips when the globalLocal directory is missing and force names are empty', async () => {
    await expect(
      assertGlobalSkillsRunnable({
        globalLocal: join(tmpdir(), 'missing-autofix-global-skills'),
        forceNames: [],
        allowStaleRevision: false,
        runGit: async () => {
          throw new Error('runGit must not run when force names are empty')
        },
      }),
    ).resolves.toBeUndefined()
  })
})
