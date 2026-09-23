import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

/** Optional injected read failure for {@link loadLessonIndex} I/O tests. */
const readInject = vi.hoisted(() => ({ err: undefined as unknown }))

vi.mock('node:fs', async (importOriginal) => {
  const mod = await importOriginal<typeof import('node:fs')>()
  return {
    ...mod,
    readFileSync: (...args: Parameters<typeof mod.readFileSync>) => {
      if (readInject.err !== undefined) {
        throw readInject.err
      }
      return mod.readFileSync(...args)
    },
  }
})

import {
  DEDUP_INDEX_CAP,
  indexHasTicket,
  loadLessonIndex,
  selectAcceptedForInject,
  selectDedupRows,
} from '../src/lesson-index.ts'

function writeIndex(yaml: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'lessons-'))
  writeFileSync(join(dir, 'index.yaml'), yaml)
  return dir
}

const rows = `
lessons:
  - { id: t1, status: accepted, target_menu: 威胁总览, symptom: A, ticketId: 1, mrUrl: 'http://mr/1', updatedAt: '2026-09-21T00:00:00.000Z' }
  - { id: t2, status: accepted, target_menu: 威胁总览, symptom: B, ticketId: 2, mrUrl: 'http://mr/2', updatedAt: '2026-09-23T00:00:00.000Z' }
  - { id: t3, status: pending, target_menu: 威胁总览, symptom: C, ticketId: 3, mrUrl: 'http://mr/3', updatedAt: '2026-09-24T00:00:00.000Z' }
  - { id: t4, status: accepted, target_menu: 资产核查, symptom: D, ticketId: 4, mrUrl: 'http://mr/4', updatedAt: '2026-09-25T00:00:00.000Z' }
`

describe('lesson-index', () => {
  afterEach(() => {
    readInject.err = undefined
  })

  it('selects newest accepted rows for the exact menu only', () => {
    const dir = writeIndex(rows)
    const index = loadLessonIndex(dir)
    const hit = selectAcceptedForInject(index, '威胁总览', 1)
    expect(hit.map(r => r.id)).toEqual(['t2'])
    expect(selectAcceptedForInject(index, '不存在', 3)).toEqual([])
  })

  it('caps dedup rows at DEDUP_INDEX_CAP newest for that menu', () => {
    expect(DEDUP_INDEX_CAP).toBe(50)
    const dir = writeIndex(rows)
    const index = loadLessonIndex(dir)
    const dedup = selectDedupRows(index, '威胁总览')
    expect(dedup.map(r => r.id)).toEqual(['t3', 't2', 't1'])
  })

  it('detects any status for a ticketId', () => {
    const dir = writeIndex(rows)
    expect(indexHasTicket(loadLessonIndex(dir), 3)).toBe(true)
    expect(indexHasTicket(loadLessonIndex(dir), 99)).toBe(false)
  })

  it('returns empty index when index.yaml is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lessons-miss-'))
    mkdirSync(dir, { recursive: true })
    expect(loadLessonIndex(dir).lessons).toEqual([])
  })

  it('keeps valid rows when optimizeOf is null or non-string', () => {
    const yaml = `
lessons:
  - id: null-opt
    status: accepted
    target_menu: 威胁总览
    symptom: X
    ticketId: 10
    mrUrl: 'http://mr/10'
    updatedAt: '2026-09-21T00:00:00.000Z'
    optimizeOf: null
`
    const index = loadLessonIndex(writeIndex(yaml))
    const row = index.lessons.find(r => r.id === 'null-opt')
    expect(row).toBeDefined()
    expect(row?.optimizeOf).toBeUndefined()
  })

  it('sets optimizeOf when present as a non-empty string', () => {
    const yaml = `
lessons:
  - id: opt-row
    status: optimize
    target_menu: 威胁总览
    symptom: Y
    ticketId: 11
    mrUrl: 'http://mr/11'
    updatedAt: '2026-09-22T00:00:00.000Z'
    optimizeOf: t2
`
    const row = loadLessonIndex(writeIndex(yaml)).lessons.find(r => r.id === 'opt-row')
    expect(row?.optimizeOf).toBe('t2')
  })

  it('drops illegal rows and keeps only valid ones in a mixed index', () => {
    const yaml = `
lessons:
  - { id: good, status: accepted, target_menu: 威胁总览, symptom: ok, ticketId: 1, updatedAt: '2026-09-01T00:00:00.000Z' }
  - { status: accepted, target_menu: 威胁总览, symptom: x, ticketId: 2, updatedAt: '2026-09-01T00:00:00.000Z' }
  - { id: no-status, target_menu: 威胁总览, symptom: x, ticketId: 3, updatedAt: '2026-09-01T00:00:00.000Z' }
  - { id: bad-status, status: unknown, target_menu: 威胁总览, symptom: x, ticketId: 4, updatedAt: '2026-09-01T00:00:00.000Z' }
  - { id: no-menu, status: accepted, symptom: x, ticketId: 5, updatedAt: '2026-09-01T00:00:00.000Z' }
  - { id: no-symptom, status: accepted, target_menu: 威胁总览, ticketId: 6, updatedAt: '2026-09-01T00:00:00.000Z' }
  - { id: no-ticket, status: accepted, target_menu: 威胁总览, symptom: x, updatedAt: '2026-09-01T00:00:00.000Z' }
  - { id: no-updated, status: accepted, target_menu: 威胁总览, symptom: x, ticketId: 7 }
`
    const ids = loadLessonIndex(writeIndex(yaml)).lessons.map(r => r.id)
    expect(ids).toEqual(['good'])
  })

  it('returns empty index when lessons is null or root is an array', () => {
    expect(loadLessonIndex(writeIndex('lessons: null')).lessons).toEqual([])
    const dir = mkdtempSync(join(tmpdir(), 'lessons-root-arr-'))
    writeFileSync(join(dir, 'index.yaml'), '- id: x\n')
    expect(loadLessonIndex(dir).lessons).toEqual([])
  })

  it('returns empty index on yaml parse failure without throwing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lessons-bad-yaml-'))
    writeFileSync(join(dir, 'index.yaml'), 'not: [')
    expect(loadLessonIndex(dir).lessons).toEqual([])
  })

  it('returns empty inject selection when injectMax is negative', () => {
    const dir = writeIndex(rows)
    const index = loadLessonIndex(dir)
    expect(selectAcceptedForInject(index, '威胁总览', -1)).toEqual([])
  })

  it('sorts older rows after newer by updatedAt in inject selection', () => {
    const yaml = `
lessons:
  - { id: older, status: accepted, target_menu: M, symptom: s, ticketId: 1, updatedAt: '2020-01-01T00:00:00.000Z' }
  - { id: newer, status: accepted, target_menu: M, symptom: s, ticketId: 2, updatedAt: '2030-01-01T00:00:00.000Z' }
`
    const ids = selectAcceptedForInject(loadLessonIndex(writeIndex(yaml)), 'M', 2).map(r => r.id)
    expect(ids).toEqual(['newer', 'older'])
  })

  it('sorts correctly when index file lists rows newest-first', () => {
    const yaml = `
lessons:
  - { id: newer, status: accepted, target_menu: M, symptom: s, ticketId: 2, updatedAt: '2030-01-01T00:00:00.000Z' }
  - { id: older, status: accepted, target_menu: M, symptom: s, ticketId: 1, updatedAt: '2020-01-01T00:00:00.000Z' }
`
    const ids = selectAcceptedForInject(loadLessonIndex(writeIndex(yaml)), 'M', 2).map(r => r.id)
    expect(ids).toEqual(['newer', 'older'])
  })

  it('caps dedup at DEDUP_INDEX_CAP with newest ids first when over cap', () => {
    const lines = ['lessons:']
    for (let i = 0; i < 51; i++) {
      const hour = String(i).padStart(2, '0')
      lines.push(
        `  - { id: r${i}, status: accepted, target_menu: 威胁总览, symptom: s, ticketId: ${i}, updatedAt: '2026-09-01T${hour}:00:00.000Z' }`,
      )
    }
    const index = loadLessonIndex(writeIndex(lines.join('\n')))
    const dedup = selectDedupRows(index, '威胁总览')
    expect(dedup).toHaveLength(DEDUP_INDEX_CAP)
    expect(dedup[0]?.id).toBe('r50')
  })

  it('skips non-object lesson entries and defaults missing mrUrl', () => {
    const yaml = `
lessons:
  - null
  - [nested, array]
  - plain-scalar
  - { id: no-mr, status: accepted, target_menu: 威胁总览, symptom: s, ticketId: 1, updatedAt: '2026-09-01T00:00:00.000Z' }
`
    const row = loadLessonIndex(writeIndex(yaml)).lessons.find(r => r.id === 'no-mr')
    expect(row?.mrUrl).toBe('')
  })

  it('orders equal updatedAt as stable tie in dedup selection', () => {
    const yaml = `
lessons:
  - { id: tie-a, status: accepted, target_menu: 威胁总览, symptom: s, ticketId: 1, updatedAt: '2026-09-10T00:00:00.000Z' }
  - { id: tie-b, status: accepted, target_menu: 威胁总览, symptom: s, ticketId: 2, updatedAt: '2026-09-10T00:00:00.000Z' }
`
    const ids = selectDedupRows(loadLessonIndex(writeIndex(yaml)), '威胁总览').map(r => r.id)
    expect(ids).toHaveLength(2)
    expect(new Set(ids)).toEqual(new Set(['tie-a', 'tie-b']))
  })

  it('rethrows non-ENOENT read failures', () => {
    const denied = Object.assign(new Error('permission denied'), { code: 'EACCES' as const })
    readInject.err = denied
    expect(() => loadLessonIndex('/any-root')).toThrow(denied)
  })

  it('rethrows when read failure is not a Node err object', () => {
    readInject.err = 'read-failed'
    expect(() => loadLessonIndex('/any-root')).toThrow('read-failed')
  })
})
