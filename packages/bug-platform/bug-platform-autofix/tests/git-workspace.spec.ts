import { describe, expect, it, vi } from 'vitest'
import {
  assertClean,
  assertProductBranch,
  commitAll,
  createBugfixBranch,
  listChangedFiles,
  pushBranch,
  type RunGit,
} from '../src/git-workspace.ts'

const ROOT = 'D:/fake/dkh-ailpha'

function fakeRunGit(handlers: Record<string, string | (() => string)>): RunGit {
  return async (_cwd, args) => {
    const key = args.join(' ')
    const handler = handlers[key]
    if (handler === undefined) {
      throw new Error(`unexpected git args: ${key}`)
    }
    return typeof handler === 'function' ? handler() : handler
  }
}

describe('assertProductBranch', () => {
  it('accepts the expected product jinan branch', async () => {
    const runGit = fakeRunGit({
      'rev-parse --abbrev-ref HEAD': 'dkh-ailpha-jinan\n',
    })
    await expect(
      assertProductBranch(ROOT, 'dkh-ailpha-jinan', runGit),
    ).resolves.toBeUndefined()
  })

  it('accepts an existing bugfix/<ticketId> branch', async () => {
    const runGit = fakeRunGit({
      'rev-parse --abbrev-ref HEAD': 'bugfix/428\n',
    })
    await expect(
      assertProductBranch(ROOT, 'dkh-ailpha-jinan', runGit),
    ).resolves.toBeUndefined()
  })

  it('hard-fails when HEAD is a different product jinan', async () => {
    const runGit = fakeRunGit({
      'rev-parse --abbrev-ref HEAD': 'dkh-custom-jinan\n',
    })
    await expect(
      assertProductBranch(ROOT, 'dkh-ailpha-jinan', runGit),
    ).rejects.toThrow(/dkh-custom-jinan.*dkh-ailpha-jinan|wrong product|different product/i)
  })

  it('rejects unrelated branches that are not the expected jinan or bugfix', async () => {
    const runGit = fakeRunGit({
      'rev-parse --abbrev-ref HEAD': 'main\n',
    })
    await expect(
      assertProductBranch(ROOT, 'dkh-ailpha-jinan', runGit),
    ).rejects.toThrow(/main|dkh-ailpha-jinan|unexpected branch/i)
  })
})

describe('assertClean', () => {
  it('passes when porcelain status is empty', async () => {
    const runGit = fakeRunGit({
      'status --porcelain': '',
    })
    await expect(assertClean(ROOT, runGit)).resolves.toBeUndefined()
  })

  it('fails when the worktree is dirty', async () => {
    const runGit = fakeRunGit({
      'status --porcelain': ' M src/a.ts\n',
    })
    await expect(assertClean(ROOT, runGit)).rejects.toThrow(/dirty|clean|status/i)
  })
})

describe('createBugfixBranch', () => {
  it('returns bugfix/<id> when already on that branch', async () => {
    const runGit = fakeRunGit({
      'rev-parse --abbrev-ref HEAD': 'bugfix/428\n',
    })
    await expect(createBugfixBranch(ROOT, 428, runGit)).resolves.toBe('bugfix/428')
  })

  it('creates bugfix/<id> from the current HEAD when absent', async () => {
    const calls: string[][] = []
    const runGit: RunGit = async (_cwd, args) => {
      calls.push(args)
      const key = args.join(' ')
      if (key === 'rev-parse --abbrev-ref HEAD') return 'dkh-ailpha-jinan\n'
      if (key === 'branch --list bugfix/428') return ''
      if (key === 'checkout -b bugfix/428') return ''
      throw new Error(`unexpected git args: ${key}`)
    }
    await expect(createBugfixBranch(ROOT, 428, runGit)).resolves.toBe('bugfix/428')
    expect(calls).toContainEqual(['checkout', '-b', 'bugfix/428'])
  })

  it('checks out an existing bugfix/<id> branch when not currently on it', async () => {
    const calls: string[][] = []
    const runGit: RunGit = async (_cwd, args) => {
      calls.push(args)
      const key = args.join(' ')
      if (key === 'rev-parse --abbrev-ref HEAD') return 'dkh-ailpha-jinan\n'
      if (key === 'branch --list bugfix/428') return '  bugfix/428\n'
      if (key === 'checkout bugfix/428') return ''
      throw new Error(`unexpected git args: ${key}`)
    }
    await expect(createBugfixBranch(ROOT, 428, runGit)).resolves.toBe('bugfix/428')
    expect(calls).toContainEqual(['checkout', 'bugfix/428'])
  })
})

describe('commitAll', () => {
  it('stages all changes, commits, and returns the new HEAD sha', async () => {
    const runGit = fakeRunGit({
      'add -A': '',
      'commit -m fix ticket 428': '',
      'rev-parse HEAD': 'abc123deadbeef\n',
    })
    await expect(commitAll(ROOT, 'fix ticket 428', runGit)).resolves.toBe('abc123deadbeef')
  })
})

describe('pushBranch', () => {
  it('pushes the named branch with upstream tracking', async () => {
    const runGit = vi.fn(async (_cwd: string, args: string[]) => {
      expect(args).toEqual(['push', '-u', 'origin', 'bugfix/428'])
      return ''
    })
    await expect(pushBranch(ROOT, 'bugfix/428', runGit)).resolves.toBeUndefined()
    expect(runGit).toHaveBeenCalledOnce()
  })
})

describe('listChangedFiles', () => {
  it('returns paths from porcelain status', async () => {
    const runGit = fakeRunGit({
      'status --porcelain': ' M src/a.ts\n?? src/b.ts\n',
    })
    await expect(listChangedFiles(ROOT, runGit)).resolves.toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('returns an empty list when there are no changes', async () => {
    const runGit = fakeRunGit({
      'status --porcelain': '',
    })
    await expect(listChangedFiles(ROOT, runGit)).resolves.toEqual([])
  })
})
