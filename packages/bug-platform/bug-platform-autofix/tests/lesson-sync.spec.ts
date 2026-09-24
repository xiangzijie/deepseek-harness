import { describe, expect, it, vi } from 'vitest'
import { commitAndPushLessons, lessonsWorkingTreeDirty, pullLessonsFf } from '../src/lesson-sync.ts'

describe('pullLessonsFf', () => {
  it('uses fetch + ff-only and returns ok false on throw', async () => {
    const runGit = vi.fn().mockResolvedValueOnce('').mockResolvedValueOnce('')
    await expect(pullLessonsFf({ localRoot: 'D:/L', runGit })).resolves.toEqual({ ok: true })
    expect(runGit).toHaveBeenNthCalledWith(1, 'D:/L', ['fetch', 'origin'])
    expect(runGit).toHaveBeenNthCalledWith(2, 'D:/L', ['pull', '--ff-only', 'origin', 'main'])

    const failing = vi.fn().mockRejectedValue(new Error('not a git repo'))
    await expect(pullLessonsFf({ localRoot: 'D:/L', runGit: failing })).resolves.toEqual({
      ok: false,
      error: 'not a git repo',
    })
  })

  it('returns ok false when fetch throws', async () => {
    const runGit = vi.fn().mockRejectedValue(new Error('offline'))
    await expect(pullLessonsFf({ localRoot: 'D:/L', runGit })).resolves.toEqual({
      ok: false,
      error: 'offline',
    })
  })

  it('maps non-Error rejections to String(error)', async () => {
    const runGit = vi.fn().mockRejectedValue('plain failure')
    await expect(pullLessonsFf({ localRoot: 'D:/L', runGit })).resolves.toEqual({
      ok: false,
      error: 'plain failure',
    })
  })
})

describe('commitAndPushLessons', () => {
  it('returns ok false when push throws', async () => {
    const runGit = vi
      .fn()
      .mockResolvedValueOnce('') // add
      .mockResolvedValueOnce('') // commit
      .mockRejectedValueOnce(new Error('protected'))
    const out = await commitAndPushLessons({
      localRoot: 'D:/L',
      message: 'docs: lesson t10',
      runGit,
    })
    expect(out.ok).toBe(false)
    expect(out.error).toContain('protected')
  })

  it('adds, commits, pushes origin main and returns ok true on success', async () => {
    const runGit = vi.fn().mockResolvedValue('')
    await expect(
      commitAndPushLessons({
        localRoot: 'D:/L',
        message: 'docs: lesson t10',
        runGit,
      }),
    ).resolves.toEqual({ ok: true })
    expect(runGit).toHaveBeenNthCalledWith(1, 'D:/L', ['add', '-A'])
    expect(runGit).toHaveBeenNthCalledWith(2, 'D:/L', ['commit', '-m', 'docs: lesson t10'])
    expect(runGit).toHaveBeenNthCalledWith(3, 'D:/L', ['push', 'origin', 'main'])
  })

  it('returns ok false when add throws', async () => {
    const runGit = vi.fn().mockRejectedValue(new Error('add failed'))
    await expect(
      commitAndPushLessons({ localRoot: 'D:/L', message: 'm', runGit }),
    ).resolves.toEqual({ ok: false, error: 'add failed' })
  })

  it('returns ok false when commit throws', async () => {
    const runGit = vi.fn().mockResolvedValueOnce('').mockRejectedValueOnce(new Error('nothing to commit'))
    await expect(
      commitAndPushLessons({ localRoot: 'D:/L', message: 'm', runGit }),
    ).resolves.toEqual({ ok: false, error: 'nothing to commit' })
  })

  it('maps non-Error rejections to String(error)', async () => {
    const runGit = vi.fn().mockRejectedValue(404)
    await expect(
      commitAndPushLessons({ localRoot: 'D:/L', message: 'm', runGit }),
    ).resolves.toEqual({ ok: false, error: '404' })
  })
})

describe('lessonsWorkingTreeDirty', () => {
  it('is true when porcelain is non-empty', async () => {
    const dirty = vi.fn().mockResolvedValue(' M index.yaml\n')
    const clean = vi.fn().mockResolvedValue('')
    expect(await lessonsWorkingTreeDirty({ localRoot: 'D:/L', runGit: dirty })).toBe(true)
    expect(await lessonsWorkingTreeDirty({ localRoot: 'D:/L', runGit: clean })).toBe(false)
  })

  it('treats whitespace-only porcelain as clean', async () => {
    const runGit = vi.fn().mockResolvedValue('   \n  \n')
    expect(await lessonsWorkingTreeDirty({ localRoot: 'D:/L', runGit })).toBe(false)
  })

  it('returns true when status --porcelain throws', async () => {
    const runGit = vi.fn().mockRejectedValue(new Error('not a git repo'))
    expect(await lessonsWorkingTreeDirty({ localRoot: 'D:/L', runGit })).toBe(true)
  })
})
