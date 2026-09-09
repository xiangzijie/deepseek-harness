import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  isActive,
  loadState,
  saveState,
  type TicketRecord,
  TicketStateStore,
} from '../src/ticket-state.ts'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function tempStatePath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-ticket-state-'))
  tempDirs.push(dir)
  return join(dir, 'state.json')
}

function sampleRecord(overrides: Partial<TicketRecord> = {}): TicketRecord {
  return {
    ticketId: 428,
    phase: 'claimed',
    repo: 'custom',
    branch: 'bugfix/428',
    updatedAt: '2026-09-09T10:00:00.000Z',
    ...overrides,
  }
}

describe('isActive', () => {
  it('treats claimed, fixing, and awaiting_push as active', () => {
    expect(isActive(sampleRecord({ phase: 'claimed' }))).toBe(true)
    expect(isActive(sampleRecord({ phase: 'fixing' }))).toBe(true)
    expect(isActive(sampleRecord({ phase: 'awaiting_push' }))).toBe(true)
  })

  it('treats done and failed as inactive', () => {
    expect(isActive(sampleRecord({ phase: 'done' }))).toBe(false)
    expect(isActive(sampleRecord({ phase: 'failed' }))).toBe(false)
  })
})

describe('TicketStateStore load/save/get/upsert', () => {
  it('loadState returns an empty store when the file is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-ticket-state-'))
    tempDirs.push(dir)
    const store = loadState(join(dir, 'missing-state.json'))
    expect(store).toBeInstanceOf(TicketStateStore)
    expect(store.get(1)).toBeUndefined()
  })

  it('round-trips records through saveState and loadState', () => {
    const path = tempStatePath()
    const store = new TicketStateStore()
    const record = sampleRecord({ mrUrl: 'https://gitlab.example/mr/1' })
    store.upsert(record)
    saveState(path, store)

    const loaded = loadState(path)
    expect(loaded.get(428)).toEqual(record)
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { tickets: TicketRecord[] }
    expect(raw.tickets).toHaveLength(1)
    expect(raw.tickets[0]?.ticketId).toBe(428)
  })

  it('upsert replaces an existing ticketId', () => {
    const store = new TicketStateStore([sampleRecord({ phase: 'claimed' })])
    store.upsert(sampleRecord({ phase: 'fixing', updatedAt: '2026-09-09T11:00:00.000Z' }))
    expect(store.get(428)?.phase).toBe('fixing')
    expect(store.get(428)?.updatedAt).toBe('2026-09-09T11:00:00.000Z')
  })

  it('rejects invalid on-disk JSON', () => {
    const path = tempStatePath()
    writeFileSync(path, '{"tickets":"nope"}', 'utf8')
    expect(() => loadState(path)).toThrow(/ticket-state/)
  })
})
