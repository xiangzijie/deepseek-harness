import { describe, expect, it } from 'vitest'
import {
  assessPreAgentContext,
  autofixStopBriefRules,
  formatAutofixStopFollowup,
  parseSkipAutofixSummary,
} from '../src/autofix-stop.ts'

describe('assessPreAgentContext', () => {
  it('returns null when description is long enough', () => {
    expect(assessPreAgentContext('打开资产核查页后所属区域枚举不对', [])).toBeNull()
  })

  it('returns null when screenshots exist even if description is short', () => {
    expect(assessPreAgentContext('短', ['/tmp/a.png'])).toBeNull()
  })

  it('stops for empty description and no screenshots', () => {
    expect(assessPreAgentContext('', [])).toEqual({
      category: 'insufficient_context',
      reason: expect.stringMatching(/描述为空|无可用截图/),
    })
  })

  it('stops for too-short description and no screenshots', () => {
    expect(assessPreAgentContext('短', [])).toEqual({
      category: 'insufficient_context',
      reason: expect.stringMatching(/过短|无可用截图/),
    })
  })
})

describe('parseSkipAutofixSummary', () => {
  it('parses a SKIP_AUTOFIX line with prose around it', () => {
    expect(
      parseSkipAutofixSummary(
        '看了一下路由。\nSKIP_AUTOFIX|not_frontend|更像接口返回枚举\n完。',
      ),
    ).toEqual({
      category: 'not_frontend',
      reason: '更像接口返回枚举',
    })
  })

  it('returns null for ordinary failure text', () => {
    expect(parseSkipAutofixSummary('agent exited with code 1')).toBeNull()
  })
})

describe('formatAutofixStopFollowup', () => {
  it('includes category and reason for platform followup', () => {
    const text = formatAutofixStopFollowup({
      category: 'insufficient_context',
      reason: '无截图且描述为空',
    })
    expect(text).toMatch(/停止并跳过/)
    expect(text).toContain('insufficient_context')
    expect(text).toContain('无截图且描述为空')
  })
})

describe('autofixStopBriefRules', () => {
  it('mentions SKIP_AUTOFIX marker and stop categories', () => {
    const rules = autofixStopBriefRules()
    expect(rules).toContain('SKIP_AUTOFIX|')
    expect(rules).toContain('insufficient_context')
    expect(rules).toContain('not_frontend')
  })
})
