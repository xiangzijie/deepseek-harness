import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { acquireRunLock, readRunLock, runLockPath } from '../src/run-lock.ts'

const { failNextUnlink } = vi.hoisted(() => ({ failNextUnlink: { value: false } }))
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    unlinkSync(path: Parameters<typeof actual.unlinkSync>[0]): void {
      if (failNextUnlink.value) {
        failNextUnlink.value = false
        throw Object.assign(new Error('simulated EACCES on unlink'), { code: 'EACCES' })
      }
      actual.unlinkSync(path)
    },
  }
})

afterEach(() => {
  failNextUnlink.value = false
  vi.restoreAllMocks()
})

/** Force `process.kill(pid, 0)` to throw a given errno. */
function mockKillErrno(code: string): void {
  vi.spyOn(process, 'kill').mockImplementation(() => {
    const error = new Error(code) as NodeJS.ErrnoException
    error.code = code
    throw error
  })
}

describe('acquireRunLock', () => {
  it('throws when another live pid holds the lock', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lock-'))
    const path = join(dir, 'run.lock')
    writeFileSync(path, JSON.stringify({ pid: process.pid, startedAt: 't', configPath: 'x' }))
    expect(() => acquireRunLock(path, {
      pid: process.pid + 1,
      startedAt: 't2',
      configPath: 'x',
      progressFile: 'D:/progress.json',
    })).toThrow(`已有跑批（pid=${process.pid}），progressFile=D:/progress.json`)
  })

  it('replaces a stale lock whose pid is dead', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lock-'))
    const path = join(dir, 'run.lock')
    writeFileSync(path, JSON.stringify({ pid: 1, startedAt: 't', configPath: 'x' }))
    const release = acquireRunLock(path, { pid: process.pid, startedAt: 'now', configPath: 'x' })
    expect(readRunLock(path)?.pid).toBe(process.pid)
    release()
    expect(readRunLock(path)).toBeUndefined()
  })

  it('cites dirname(lock)/progress.json when progressFile is omitted', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lock-'))
    const path = join(dir, 'run.lock')
    writeFileSync(path, JSON.stringify({ pid: process.pid, startedAt: 't', configPath: 'x' }))
    expect(() => acquireRunLock(path, { pid: process.pid + 1, startedAt: 't2', configPath: 'x' }))
      .toThrow(`已有跑批（pid=${process.pid}），progressFile=${join(dir, 'progress.json')}`)
  })

  it('creates a lock when none exists and double-release is inert', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lock-'))
    const path = join(dir, 'nested', 'run.lock')
    expect(readRunLock(path)).toBeUndefined()
    const release = acquireRunLock(path, { pid: process.pid, startedAt: 'now', configPath: 'x' })
    expect(readRunLock(path)).toEqual({ pid: process.pid, startedAt: 'now', configPath: 'x' })
    release()
    release()
    expect(readRunLock(path)).toBeUndefined()
  })

  it('replaces unreadable or invalid lock documents', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lock-'))
    const path = join(dir, 'run.lock')
    for (const body of [
      'not-json',
      '[]',
      'null',
      '1',
      '"x"',
      '{"pid":"1","startedAt":"t","configPath":"x"}',
      '{"pid":1.5,"startedAt":"t","configPath":"x"}',
      '{"pid":1,"startedAt":1,"configPath":"x"}',
      '{"pid":1,"startedAt":"t","configPath":2}',
      '{"pid":1}',
    ]) {
      writeFileSync(path, body)
      const release = acquireRunLock(path, { pid: process.pid, startedAt: 'now', configPath: 'x' })
      expect(readRunLock(path)?.pid).toBe(process.pid)
      release()
    }
  })

  it('does not delete a lock that no longer belongs to the releaser', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lock-'))
    const path = join(dir, 'run.lock')
    const release = acquireRunLock(path, { pid: process.pid, startedAt: 'now', configPath: 'x' })
    writeFileSync(path, JSON.stringify({ pid: 1, startedAt: 't', configPath: 'stolen' }))
    release()
    expect(readRunLock(path)).toEqual({ pid: 1, startedAt: 't', configPath: 'stolen' })
  })

  it('treats EPERM as a live holder and does not steal', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lock-'))
    const path = join(dir, 'run.lock')
    writeFileSync(path, JSON.stringify({ pid: 999_001, startedAt: 't', configPath: 'x' }))
    mockKillErrno('EPERM')
    expect(() => acquireRunLock(path, {
      pid: process.pid,
      startedAt: 't2',
      configPath: 'x',
      progressFile: 'D:/progress.json',
    })).toThrow('已有跑批（pid=999001），progressFile=D:/progress.json')
  })

  it('rethrows unexpected kill errno', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lock-'))
    const path = join(dir, 'run.lock')
    writeFileSync(path, JSON.stringify({ pid: 999_002, startedAt: 't', configPath: 'x' }))
    mockKillErrno('EINVAL')
    expect(() => acquireRunLock(path, { pid: process.pid, startedAt: 't2', configPath: 'x' }))
      .toThrow(/EINVAL/)
  })

  it('rethrows unlink failures other than ENOENT', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lock-'))
    const path = join(dir, 'run.lock')
    const release = acquireRunLock(path, { pid: process.pid, startedAt: 'now', configPath: 'x' })
    failNextUnlink.value = true
    expect(() => release()).toThrow(/EACCES/)
  })
})

describe('runLockPath', () => {
  it('places run.lock beside progress.json', () => {
    expect(runLockPath(join('D:', 'runs', 'progress.json'))).toBe(join('D:', 'runs', 'run.lock'))
  })
})
