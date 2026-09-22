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

  it('rejects illegal need_frontend_fix and non-JSON text', () => {
    expect(parseEligibilityModelText('{"need_frontend_fix":"maybe","reason":"x"}').ok).toBe(false)
    expect(parseEligibilityModelText('not json').ok).toBe(false)
  })

  it('rejects missing reason', () => {
    expect(parseEligibilityModelText('{"need_frontend_fix":true}').ok).toBe(false)
  })

  it('rejects blank reason', () => {
    expect(parseEligibilityModelText('{"need_frontend_fix":false,"reason":"   "}').ok).toBe(false)
  })

  it('parses uncertain need_frontend_fix', () => {
    expect(
      parseEligibilityModelText('{"need_frontend_fix":"uncertain","reason":"需人工判断"}'),
    ).toEqual({
      ok: true,
      needFrontendFix: 'uncertain',
      reason: '需人工判断',
    })
  })

  it('rejects JSON root that is not a plain object', () => {
    expect(parseEligibilityModelText('null').ok).toBe(false)
    expect(parseEligibilityModelText('[{"need_frontend_fix":true,"reason":"x"}]').ok).toBe(false)
  })
})
