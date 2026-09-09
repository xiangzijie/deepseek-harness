import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as BugPlatformHttp from '../src/index.ts'

describe('bug-platform-http plugin', () => {
  it('exports an empty inject list and default base URL', () => {
    expect(BugPlatformHttp.inject).toEqual([])
    expect(BugPlatformHttp.name).toBe('bug-platform-http')
    expect(BugPlatformHttp.DEFAULT_BASE_URL).toBe('http://10.20.183.62:8080')
  })

  it('accepts fully defaulted Config in apply', () => {
    const config = BugPlatformHttp.Config({})
    expect(() => BugPlatformHttp.apply(new Context(), config)).not.toThrow()
    expect(config.baseUrl).toBe(BugPlatformHttp.DEFAULT_BASE_URL)
    expect(config.usernameEnv).toBe(BugPlatformHttp.DEFAULT_USERNAME_ENV)
    expect(config.passwordEnv).toBe(BugPlatformHttp.DEFAULT_PASSWORD_ENV)
  })

  it('rejects empty string fields after defaulting', () => {
    const ctx = new Context()
    expect(() => BugPlatformHttp.apply(ctx, BugPlatformHttp.Config({ baseUrl: '' }))).toThrow(/baseUrl/)
    expect(() => BugPlatformHttp.apply(ctx, BugPlatformHttp.Config({ usernameEnv: '' }))).toThrow(/usernameEnv/)
    expect(() => BugPlatformHttp.apply(ctx, BugPlatformHttp.Config({ passwordEnv: '' }))).toThrow(/passwordEnv/)
  })
})
