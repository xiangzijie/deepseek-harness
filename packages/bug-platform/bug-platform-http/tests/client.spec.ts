import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BugPlatformClient, createBugPlatformClient } from '../src/client.ts'
import type { FollowupBody } from '../src/types.ts'

const BASE = 'http://10.20.183.62:8080'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

function loginOk(token = 'tok-1', userId = 68): Response {
  return jsonResponse({ success: true, data: { token, user: { id: userId, username: 'alice' } } })
}

function listOk(list: unknown[]): Response {
  return jsonResponse({ success: true, data: { list, total: list.length } })
}

function detailOk(data: unknown): Response {
  return jsonResponse({ success: true, data })
}

function client(fetchImpl: typeof fetch): BugPlatformClient {
  return createBugPlatformClient({
    baseUrl: BASE,
    username: 'alice',
    password: 's3cret',
    fetchImpl,
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('BugPlatformClient.ensureToken', () => {
  it('POSTs /api/auth/login and returns data.token', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(`${BASE}/api/auth/login`)
      expect(init?.method).toBe('POST')
      expect(init?.headers).toEqual(expect.objectContaining({ 'content-type': 'application/json' }))
      expect(JSON.parse(String(init?.body))).toEqual({ username: 'alice', password: 's3cret' })
      return loginOk('session-token')
    })

    const c = client(fetchImpl)
    await expect(c.ensureToken()).resolves.toBe('session-token')
    expect(c.getLoggedInUserId()).toBe(68)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('reuses a cached token without a second login', async () => {
    const fetchImpl = vi.fn(async () => loginOk('cached'))
    const c = client(fetchImpl)
    await expect(c.ensureToken()).resolves.toBe('cached')
    await expect(c.ensureToken()).resolves.toBe('cached')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('throws when login payload is not success:true with a token string', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: false, message: 'bad creds' }))
    await expect(client(fetchImpl).ensureToken()).rejects.toThrow(/login/i)
  })
})

describe('BugPlatformClient.listTickets', () => {
  it('GETs /api/bug-tickets with query and returns data.list', async () => {
    const summary = {
      id: 428,
      project_id: 47,
      target_menu: '资产核查',
      description: 'body',
      screenshots: [],
      assignee_id: null,
      status: '待确认',
    }
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/auth/login')) return loginOk()
      const parsed = new URL(url)
      expect(parsed.pathname).toBe('/api/bug-tickets')
      expect(parsed.searchParams.get('project_id')).toBe('47')
      expect(parsed.searchParams.get('status')).toBe('待确认,验证未通过')
      expect(parsed.searchParams.get('page')).toBe('2')
      expect(parsed.searchParams.get('pageSize')).toBe('20')
      expect(init?.method).toBe('GET')
      expect(init?.headers).toEqual(expect.objectContaining({ Authorization: 'Bearer tok-1' }))
      return listOk([summary])
    })

    const list = await client(fetchImpl).listTickets({
      projectId: 47,
      status: '待确认,验证未通过',
      page: 2,
      pageSize: 20,
    })
    expect(list).toEqual([summary])
  })

  it('defaults page and pageSize when omitted', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/auth/login')) return loginOk()
      const parsed = new URL(url)
      expect(parsed.searchParams.get('page')).toBe('1')
      expect(parsed.searchParams.get('pageSize')).toBe('50')
      return listOk([])
    })

    await expect(
      client(fetchImpl).listTickets({ projectId: 47, status: '待确认' }),
    ).resolves.toEqual([])
  })
})

describe('BugPlatformClient.getTicket', () => {
  it('GETs /api/bug-tickets/:id and returns data', async () => {
    const detail = {
      id: 428,
      project_id: 47,
      target_menu: '资产核查',
      description: 'full',
      screenshots: [{ url: '/api/uploads/a.png', file_size: 12 }],
      assignee_id: null,
      status: '转派',
      followups: [
        {
          content: 'note',
          created_at: '2026-09-01T00:00:00Z',
          creator_name: 'bob',
          attachments: [],
        },
      ],
    }
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/auth/login')) return loginOk()
      expect(url).toBe(`${BASE}/api/bug-tickets/428`)
      expect(init?.headers).toEqual(expect.objectContaining({ Authorization: 'Bearer tok-1' }))
      return detailOk(detail)
    })

    await expect(client(fetchImpl).getTicket(428)).resolves.toEqual(detail)
  })
})

describe('BugPlatformClient.createFollowup', () => {
  it('POSTs /api/bug-tickets/:id/followups with JSON body including nulls', async () => {
    const body: FollowupBody = {
      content: '自动修复开始',
      attachments: null,
      status_change: '处理中',
      issue_type_change: null,
      assignee_change: null,
      plan_solve_date_change: null,
    }
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/auth/login')) return loginOk()
      expect(url).toBe(`${BASE}/api/bug-tickets/428/followups`)
      expect(init?.method).toBe('POST')
      expect(init?.headers).toEqual(
        expect.objectContaining({
          Authorization: 'Bearer tok-1',
          'content-type': 'application/json',
        }),
      )
      expect(JSON.parse(String(init?.body))).toEqual(body)
      return jsonResponse({ success: true, data: {} })
    })

    await expect(client(fetchImpl).createFollowup(428, body)).resolves.toBeUndefined()
  })

  it('re-logins once and retries createFollowup after 401', async () => {
    const calls: string[] = []
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (url.endsWith('/api/auth/login')) {
        return loginOk(calls.filter(c => c.includes('/login')).length === 1 ? 'tok-old' : 'tok-new')
      }
      if (url.endsWith('/api/bug-tickets/3/followups')) {
        const auth = (init?.headers as Record<string, string> | undefined)?.Authorization
        if (auth === 'Bearer tok-old') {
          return new Response('unauthorized', { status: 401 })
        }
        expect(auth).toBe('Bearer tok-new')
        expect(JSON.parse(String(init?.body))).toEqual({
          content: 'retry',
          status_change: null,
        })
        return jsonResponse({ success: true, data: null })
      }
      throw new Error(`unexpected ${url}`)
    })

    await client(fetchImpl).createFollowup(3, { content: 'retry', status_change: null })
    expect(calls.filter(c => c.includes('/login'))).toHaveLength(2)
    expect(calls.filter(c => c.includes('/followups'))).toHaveLength(2)
  })
})

describe('BugPlatformClient.downloadToFile', () => {
  it('GETs baseUrl+relative path with Bearer and writes response bytes', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    const dir = await mkdtemp(join(tmpdir(), 'bug-platform-dl-'))
    const dest = join(dir, 'shot.png')
    try {
      const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.endsWith('/api/auth/login')) return loginOk()
        expect(url).toBe(`${BASE}/api/uploads/a.png`)
        expect(init?.method).toBe('GET')
        expect(init?.headers).toEqual(expect.objectContaining({ Authorization: 'Bearer tok-1' }))
        return new Response(bytes, { status: 200, headers: { 'content-type': 'image/png' } })
      })

      await client(fetchImpl).downloadToFile('/api/uploads/a.png', dest)
      await expect(readFile(dest)).resolves.toEqual(bytes)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('re-logins once and retries download after 401', async () => {
    const bytes = Buffer.from('png-bytes')
    const dir = await mkdtemp(join(tmpdir(), 'bug-platform-dl-'))
    const dest = join(dir, 'b.png')
    try {
      const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.endsWith('/api/auth/login')) {
          const n = fetchImpl.mock.calls.filter(([u]) => String(u).endsWith('/api/auth/login')).length
          return loginOk(n === 1 ? 'tok-old' : 'tok-new')
        }
        if (url === `${BASE}/api/uploads/b.png`) {
          const auth = (init?.headers as Record<string, string> | undefined)?.Authorization
          if (auth === 'Bearer tok-old') {
            return new Response('unauthorized', { status: 401 })
          }
          expect(auth).toBe('Bearer tok-new')
          return new Response(bytes, { status: 200 })
        }
        throw new Error(`unexpected ${url}`)
      })

      await client(fetchImpl).downloadToFile('/api/uploads/b.png', dest)
      await expect(readFile(dest)).resolves.toEqual(bytes)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('throws on non-OK download HTTP status', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bug-platform-dl-'))
    const dest = join(dir, 'missing.png')
    try {
      const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith('/api/auth/login')) return loginOk()
        return new Response('gone', { status: 404 })
      })
      await expect(client(fetchImpl).downloadToFile('/api/uploads/missing.png', dest)).rejects.toThrow(
        /404/,
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('BugPlatformClient 401 refresh', () => {
  it('re-logins once and retries the failed request once', async () => {
    const calls: string[] = []
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (url.endsWith('/api/auth/login')) {
        const body = JSON.parse(String(init?.body)) as { username: string }
        // First login → tok-old; refresh after 401 → tok-new
        return loginOk(body.username === 'alice' && calls.filter(c => c.includes('/login')).length === 1
          ? 'tok-old'
          : 'tok-new')
      }
      if (url.endsWith('/api/bug-tickets/7')) {
        const auth = (init?.headers as Record<string, string> | undefined)?.Authorization
        if (auth === 'Bearer tok-old') {
          return new Response('unauthorized', { status: 401 })
        }
        expect(auth).toBe('Bearer tok-new')
        return detailOk({
          id: 7,
          project_id: 47,
          target_menu: 'x',
          description: 'd',
          screenshots: [],
          assignee_id: null,
          status: '待确认',
          followups: [],
        })
      }
      throw new Error(`unexpected ${url}`)
    })

    const result = await client(fetchImpl).getTicket(7)
    expect(result.id).toBe(7)
    expect(calls.filter(c => c.includes('/login'))).toHaveLength(2)
    expect(calls.filter(c => c.includes('/api/bug-tickets/7'))).toHaveLength(2)
  })

  it('throws when the retried request still fails', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/auth/login')) return loginOk('t')
      return new Response('still unauthorized', { status: 401 })
    })

    await expect(client(fetchImpl).getTicket(9)).rejects.toThrow(/401/)
  })
})

describe('BugPlatformClient secrets', () => {
  it('never logs the password or token', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})

    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/auth/login')) return loginOk('super-secret-token')
      return listOk([])
    })

    await client(fetchImpl).listTickets({ projectId: 47, status: '待确认' })

    const all = [...log.mock.calls, ...info.mock.calls, ...warn.mock.calls, ...error.mock.calls, ...debug.mock.calls]
      .flat()
      .map(String)
      .join('\n')
    expect(all).not.toContain('s3cret')
    expect(all).not.toContain('super-secret-token')
  })
})

describe('BugPlatformClient errors', () => {
  it('throws on non-OK HTTP for authenticated calls after refresh is exhausted', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/auth/login')) return loginOk()
      return new Response('boom', { status: 500, statusText: 'Internal Server Error' })
    })
    await expect(client(fetchImpl).listTickets({ projectId: 1, status: 'x' })).rejects.toThrow(/500/)
  })

  it('throws when success is false on list', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/auth/login')) return loginOk()
      return jsonResponse({ success: false, message: 'nope' })
    })
    await expect(client(fetchImpl).listTickets({ projectId: 1, status: 'x' })).rejects.toThrow()
  })

  it('throws when login data.token is missing', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true, data: {} }))
    await expect(client(fetchImpl).ensureToken()).rejects.toThrow(/data\.token/)
  })

  it('throws when the body is not JSON', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/auth/login')) return loginOk()
      return new Response('not-json', { status: 200, headers: { 'content-type': 'text/plain' } })
    })
    await expect(client(fetchImpl).getTicket(1)).rejects.toThrow(/non-JSON/)
  })

  it('uses global fetch when fetchImpl is omitted', async () => {
    const fetchImpl = vi.fn(async () => loginOk('from-global'))
    vi.stubGlobal('fetch', fetchImpl)
    const c = new BugPlatformClient({
      baseUrl: BASE,
      username: 'alice',
      password: 's3cret',
    })
    await expect(c.ensureToken()).resolves.toBe('from-global')
    expect(fetchImpl).toHaveBeenCalled()
  })

  it('strips a trailing slash from baseUrl', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(`${BASE}/api/auth/login`)
      return loginOk()
    })
    const c = new BugPlatformClient({
      baseUrl: `${BASE}/`,
      username: 'alice',
      password: 's3cret',
      fetchImpl,
    })
    await c.ensureToken()
  })
})
