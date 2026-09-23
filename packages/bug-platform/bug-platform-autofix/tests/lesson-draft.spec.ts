import { describe, expect, it } from 'vitest'
import {
  parseLessonDedupText,
  shouldSkipLessonDraft,
} from '../src/lesson-draft.ts'
import type { LessonIndex } from '../src/lesson-index.ts'

const emptyIndex: LessonIndex = { lessons: [] }

describe('shouldSkipLessonDraft', () => {
  it('skips when target_menu is empty', () => {
    expect(
      shouldSkipLessonDraft({
        targetMenu: '',
        ticketId: 1,
        changedFiles: ['src/a.vue'],
        index: emptyIndex,
      }).skip,
    ).toBe(true)
  })

  it('skips when there is no reusable code path', () => {
    expect(
      shouldSkipLessonDraft({
        targetMenu: '威胁总览',
        ticketId: 1,
        changedFiles: ['README.md', 'src/i18n/zh.json'],
        index: emptyIndex,
      }).skip,
    ).toBe(true)
  })

  it('skips when the ticketId is already in the index', () => {
    expect(
      shouldSkipLessonDraft({
        targetMenu: '威胁总览',
        ticketId: 9,
        changedFiles: ['src/a.vue'],
        index: {
          lessons: [
            {
              id: 't9',
              status: 'pending',
              target_menu: '威胁总览',
              symptom: 'x',
              ticketId: 9,
              mrUrl: 'u',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
      }).skip,
    ).toBe(true)
  })

  it('continues when a vue/js/ts file changed', () => {
    expect(
      shouldSkipLessonDraft({
        targetMenu: '威胁总览',
        ticketId: 1,
        changedFiles: ['src/views/x.vue'],
        index: emptyIndex,
      }).skip,
    ).toBe(false)
  })

  it('skips when changedFiles is empty', () => {
    expect(
      shouldSkipLessonDraft({
        targetMenu: '威胁总览',
        ticketId: 1,
        changedFiles: [],
        index: emptyIndex,
      }).skip,
    ).toBe(true)
  })
})

describe('parseLessonDedupText', () => {
  it('parses create/skip/optimize and strips one fence', () => {
    expect(parseLessonDedupText('{"action":"skip","reason":"重复"}')).toEqual({
      ok: true,
      action: 'skip',
      existingId: undefined,
      reason: '重复',
    })
    expect(
      parseLessonDedupText('```json\n{"action":"optimize","existing_id":"t2","reason":"补路径"}\n```'),
    ).toEqual({ ok: true, action: 'optimize', existingId: 't2', reason: '补路径' })
    expect(parseLessonDedupText('{"action":"create","reason":"新经验"}')).toEqual({
      ok: true,
      action: 'create',
      existingId: undefined,
      reason: '新经验',
    })
  })

  it('rejects optimize without existing_id and illegal action', () => {
    expect(parseLessonDedupText('{"action":"optimize","reason":"x"}').ok).toBe(false)
    expect(parseLessonDedupText('{"action":"merge","reason":"x"}').ok).toBe(false)
  })

  it('rejects illegal JSON and empty reason', () => {
    expect(parseLessonDedupText('not-json').ok).toBe(false)
    expect(parseLessonDedupText('{"action":"skip","reason":""}').ok).toBe(false)
    expect(parseLessonDedupText('{"action":"skip","reason":"   "}').ok).toBe(false)
    expect(parseLessonDedupText('[]').ok).toBe(false)
  })
})
