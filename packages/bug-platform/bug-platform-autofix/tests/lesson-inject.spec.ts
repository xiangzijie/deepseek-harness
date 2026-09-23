import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

/** Injected read failure for default readFile I/O tests. */
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

import { loadLessonIndex } from '../src/lesson-index.ts'
import {
  DEFAULT_LESSON_BODY_CHARS,
  loadAcceptedLessonBodies,
} from '../src/lesson-inject.ts'

describe('loadAcceptedLessonBodies', () => {
  afterEach(() => {
    readInject.err = undefined
  })

  it('reads only the newest injectMax accepted bodies for the menu', () => {
    const dir = mkdtempSync(join(tmpdir(), 'linj-'))
    mkdirSync(join(dir, 'accepted'), { recursive: true })
    mkdirSync(join(dir, 'pending'), { recursive: true })
    writeFileSync(
      join(dir, 'index.yaml'),
      `lessons:
  - { id: t1, status: accepted, target_menu: M, symptom: s1, ticketId: 1, mrUrl: u, updatedAt: '2026-01-01T00:00:00.000Z' }
  - { id: t2, status: accepted, target_menu: M, symptom: s2, ticketId: 2, mrUrl: u, updatedAt: '2026-01-02T00:00:00.000Z' }
  - { id: t3, status: accepted, target_menu: M, symptom: s3, ticketId: 3, mrUrl: u, updatedAt: '2026-01-03T00:00:00.000Z' }
  - { id: t4, status: accepted, target_menu: M, symptom: s4, ticketId: 4, mrUrl: u, updatedAt: '2026-01-04T00:00:00.000Z' }
  - { id: t5, status: accepted, target_menu: OTHER, symptom: s5, ticketId: 5, mrUrl: u, updatedAt: '2026-01-05T00:00:00.000Z' }
  - { id: t6, status: pending, target_menu: M, symptom: s6, ticketId: 6, mrUrl: u, updatedAt: '2026-01-06T00:00:00.000Z' }
`,
    )
    for (const id of ['t1', 't2', 't3', 't4', 't5', 't6']) {
      writeFileSync(join(dir, 'accepted', `${id}.md`), `body-${id}`)
    }
    writeFileSync(join(dir, 'pending', 't6.md'), 'pending-body')
    const readPaths: string[] = []
    const bodies = loadAcceptedLessonBodies({
      localRoot: dir,
      index: loadLessonIndex(dir),
      targetMenu: 'M',
      injectMax: 3,
      readFile: (p) => {
        readPaths.push(p)
        return readFileSync(p, 'utf8')
      },
    })
    expect(bodies.map(b => b.id)).toEqual(['t4', 't3', 't2'])
    expect(readPaths.some(p => p.endsWith('t1.md'))).toBe(false)
    expect(readPaths.some(p => p.endsWith('t5.md'))).toBe(false)
    expect(readPaths.some(p => p.includes('pending'))).toBe(false)
  })

  it('truncates bodies longer than DEFAULT_LESSON_BODY_CHARS with a fixed suffix', () => {
    const dir = mkdtempSync(join(tmpdir(), 'linj-trunc-'))
    mkdirSync(join(dir, 'accepted'), { recursive: true })
    writeFileSync(
      join(dir, 'index.yaml'),
      `lessons:
  - { id: long, status: accepted, target_menu: M, symptom: sym, ticketId: 1, mrUrl: u, updatedAt: '2026-01-01T00:00:00.000Z' }
`,
    )
    const raw = 'x'.repeat(DEFAULT_LESSON_BODY_CHARS + 10)
    writeFileSync(join(dir, 'accepted', 'long.md'), raw)
    const bodies = loadAcceptedLessonBodies({
      localRoot: dir,
      index: loadLessonIndex(dir),
      targetMenu: 'M',
      injectMax: 1,
    })
    expect(bodies).toHaveLength(1)
    expect(bodies[0]?.body).toBe(`${'x'.repeat(DEFAULT_LESSON_BODY_CHARS)}…(已截断)`)
    expect(bodies[0]?.symptom).toBe('sym')
  })

  it('skips missing accepted files without throwing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'linj-miss-'))
    mkdirSync(join(dir, 'accepted'), { recursive: true })
    writeFileSync(
      join(dir, 'index.yaml'),
      `lessons:
  - { id: hit, status: accepted, target_menu: M, symptom: ok, ticketId: 1, mrUrl: u, updatedAt: '2026-01-02T00:00:00.000Z' }
  - { id: gone, status: accepted, target_menu: M, symptom: miss, ticketId: 2, mrUrl: u, updatedAt: '2026-01-01T00:00:00.000Z' }
`,
    )
    writeFileSync(join(dir, 'accepted', 'hit.md'), 'present')
    const bodies = loadAcceptedLessonBodies({
      localRoot: dir,
      index: loadLessonIndex(dir),
      targetMenu: 'M',
      injectMax: 2,
    })
    expect(bodies.map(b => b.id)).toEqual(['hit'])
    expect(bodies[0]?.body).toBe('present')
  })

  it('returns empty when the menu does not match and does not read accepted files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'linj-menu-'))
    mkdirSync(join(dir, 'accepted'), { recursive: true })
    writeFileSync(
      join(dir, 'index.yaml'),
      `lessons:
  - { id: t1, status: accepted, target_menu: M, symptom: s, ticketId: 1, mrUrl: u, updatedAt: '2026-01-01T00:00:00.000Z' }
`,
    )
    writeFileSync(join(dir, 'accepted', 't1.md'), 'body')
    let readCalls = 0
    const bodies = loadAcceptedLessonBodies({
      localRoot: dir,
      index: loadLessonIndex(dir),
      targetMenu: 'OTHER',
      injectMax: 3,
      readFile: (p) => {
        readCalls += 1
        return readFileSync(p, 'utf8')
      },
    })
    expect(bodies).toEqual([])
    expect(readCalls).toBe(0)
  })

  it('rethrows inject readFile failures that are not ENOENT', () => {
    const dir = mkdtempSync(join(tmpdir(), 'linj-throw-'))
    writeFileSync(
      join(dir, 'index.yaml'),
      `lessons:
  - { id: t1, status: accepted, target_menu: M, symptom: s, ticketId: 1, mrUrl: u, updatedAt: '2026-01-01T00:00:00.000Z' }
`,
    )
    expect(() =>
      loadAcceptedLessonBodies({
        localRoot: dir,
        index: loadLessonIndex(dir),
        targetMenu: 'M',
        injectMax: 1,
        readFile: () => {
          throw new Error('read failed')
        },
      }),
    ).toThrow('read failed')
  })

  it('rethrows non-ENOENT read failures from the default readFile', () => {
    const dir = mkdtempSync(join(tmpdir(), 'linj-io-'))
    mkdirSync(join(dir, 'accepted'), { recursive: true })
    writeFileSync(
      join(dir, 'index.yaml'),
      `lessons:
  - { id: t1, status: accepted, target_menu: M, symptom: s, ticketId: 1, mrUrl: u, updatedAt: '2026-01-01T00:00:00.000Z' }
`,
    )
    writeFileSync(join(dir, 'accepted', 't1.md'), 'body')
    readInject.err = Object.assign(new Error('EACCES'), { code: 'EACCES' })
    expect(() =>
      loadAcceptedLessonBodies({
        localRoot: dir,
        index: loadLessonIndex(dir),
        targetMenu: 'M',
        injectMax: 1,
      }),
    ).toThrow('EACCES')
  })
})
