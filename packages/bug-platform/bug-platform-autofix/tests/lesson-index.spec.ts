import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
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
})
