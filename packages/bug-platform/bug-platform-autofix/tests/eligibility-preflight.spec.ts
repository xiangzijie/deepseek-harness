import { describe, expect, it } from 'vitest'
import { parseEligibilityModelText } from '../src/eligibility-preflight.ts'

describe('parseEligibilityModelText', () => {
  it('parses a bare JSON object', () => {
    expect(
      parseEligibilityModelText('{"need_frontend_fix":false,"reason":"已修复待验证"}'),
    ).toEqual({ ok: true, needFrontendFix: false, reason: '已修复待验证' })
  })

  it('strips one markdown json fence', () => {
    const text = '```json\n{"need_frontend_fix":true,"reason":"按钮无响应"}\n```'
    expect(parseEligibilityModelText(text)).toEqual({
      ok: true,
      needFrontendFix: true,
      reason: '按钮无响应',
    })
  })

  it('rejects illegal enum and missing fields', () => {
    expect(parseEligibilityModelText('{"need_frontend_fix":"maybe","reason":"x"}').ok).toBe(false)
    expect(parseEligibilityModelText('not json').ok).toBe(false)
  })
})
