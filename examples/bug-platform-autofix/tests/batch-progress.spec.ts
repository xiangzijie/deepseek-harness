import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BatchProgress,
  DEFAULT_HEARTBEAT_MS,
  type ProgressSnapshot,
} from '../src/batch-progress.ts'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
  vi.useRealTimers()
})

describe('BatchProgress', () => {
  it('prints the full queue on start and writes progress.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-batch-progress-'))
    tempDirs.push(dir)
    const path = join(dir, 'progress.json')
    const lines: string[] = []
    const progress = new BatchProgress({
      path,
      queue: [10, 20, 30],
      writeLine: (line) => {
        lines.push(line)
      },
      now: () => 1_000,
    })
    progress.beginRun('force')

    expect(lines.some(l => l.includes('队列 3 单') && l.includes('10, 20, 30'))).toBe(true)
    const snap = JSON.parse(readFileSync(path, 'utf8')) as ProgressSnapshot
    expect(snap.mode).toBe('force')
    expect(snap.queue).toEqual([10, 20, 30])
    expect(snap.pending).toEqual([10, 20, 30])
    expect(snap.current).toBeNull()
    expect(snap.completed).toEqual([])
    expect(snap.pid).toBe(process.pid)
  })

  it('marks current on startTicket and moves to completed on finishTicket', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-batch-progress-'))
    tempDirs.push(dir)
    const path = join(dir, 'progress.json')
    const lines: string[] = []
    const progress = new BatchProgress({
      path,
      queue: [10, 20],
      writeLine: (line) => {
        lines.push(line)
      },
      now: () => 2_000,
      heartbeatMs: 0,
    })
    progress.beginRun('force')
    progress.startTicket(10)
    expect(lines.some(l => /\[1\/2\].*开始.*#10/.test(l))).toBe(true)
    let snap = JSON.parse(readFileSync(path, 'utf8')) as ProgressSnapshot
    expect(snap.current).toEqual({ ticketId: 10, index: 1, total: 2, startedAt: expect.any(String) })
    expect(snap.pending).toEqual([20])

    progress.finishTicket(10, 'done: MR http://example/mr/1')
    expect(lines.some(l => /\[1\/2\].*结束.*#10/.test(l) && l.includes('done'))).toBe(true)
    snap = JSON.parse(readFileSync(path, 'utf8')) as ProgressSnapshot
    expect(snap.current).toBeNull()
    expect(snap.pending).toEqual([20])
    expect(snap.completed).toEqual([
      { ticketId: 10, index: 1, total: 2, summary: 'done: MR http://example/mr/1' },
    ])
  })

  it('emits heartbeat while a ticket is in progress', () => {
    vi.useFakeTimers()
    const dir = mkdtempSync(join(tmpdir(), 'dsh-batch-progress-'))
    tempDirs.push(dir)
    const path = join(dir, 'progress.json')
    const lines: string[] = []
    let now = 0
    const progress = new BatchProgress({
      path,
      queue: [7],
      writeLine: (line) => {
        lines.push(line)
      },
      now: () => now,
      heartbeatMs: DEFAULT_HEARTBEAT_MS,
    })
    progress.beginRun('force')
    progress.startTicket(7)
    now = 30_000
    vi.advanceTimersByTime(DEFAULT_HEARTBEAT_MS)
    expect(lines.some(l => l.includes('仍在处理 #7') && l.includes('30s'))).toBe(true)
    progress.finishTicket(7, 'failed: x')
    const after = lines.length
    vi.advanceTimersByTime(DEFAULT_HEARTBEAT_MS)
    expect(lines.length).toBe(after)
  })
})
