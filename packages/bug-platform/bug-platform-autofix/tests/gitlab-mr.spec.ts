import { describe, expect, it, vi } from 'vitest'
import {
  addMergeRequestNote,
  createMergeRequest,
  ensureMergeRequest,
  GitlabTokenMissingError,
} from '../src/gitlab-mr.ts'

const HOST = 'http://gitlab.info.dbappsecurity.com.cn'
const PROJECT_ID = 8325

describe('createMergeRequest', () => {
  it('throws GitlabTokenMissingError when token is missing', async () => {
    const fetchImpl = vi.fn()
    await expect(
      createMergeRequest({
        host: HOST,
        projectId: PROJECT_ID,
        token: undefined,
        sourceBranch: 'bugfix/428',
        targetBranch: 'dkh-custom-jinan',
        title: 'fix #428',
        description: 'auto',
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(GitlabTokenMissingError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('throws GitlabTokenMissingError when token is null or empty', async () => {
    await expect(
      createMergeRequest({
        host: HOST,
        projectId: PROJECT_ID,
        token: null,
        sourceBranch: 'bugfix/428',
        targetBranch: 'dkh-custom-jinan',
        title: 'fix #428',
        description: 'auto',
      }),
    ).rejects.toBeInstanceOf(GitlabTokenMissingError)

    await expect(
      createMergeRequest({
        host: HOST,
        projectId: PROJECT_ID,
        token: '',
        sourceBranch: 'bugfix/428',
        targetBranch: 'dkh-custom-jinan',
        title: 'fix #428',
        description: 'auto',
      }),
    ).rejects.toBeInstanceOf(GitlabTokenMissingError)
  })

  it('POSTs merge_requests with PRIVATE-TOKEN and returns web_url', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(
        `${HOST}/api/v4/projects/${PROJECT_ID}/merge_requests`,
      )
      expect(init?.method).toBe('POST')
      expect(init?.headers).toEqual(
        expect.objectContaining({
          'PRIVATE-TOKEN': 'glpat-test',
          'content-type': 'application/json',
        }),
      )
      expect(JSON.parse(String(init?.body))).toEqual({
        source_branch: 'bugfix/428',
        target_branch: 'dkh-custom-jinan',
        title: 'fix #428',
        description: 'auto fix',
      })
      return new Response(
        JSON.stringify({
          web_url: `${HOST}/jgts/bigdata-web-frontend/-/merge_requests/99`,
        }),
        {
          status: 201,
          headers: { 'content-type': 'application/json' },
        },
      )
    })

    await expect(
      createMergeRequest({
        host: HOST,
        projectId: PROJECT_ID,
        token: 'glpat-test',
        sourceBranch: 'bugfix/428',
        targetBranch: 'dkh-custom-jinan',
        title: 'fix #428',
        description: 'auto fix',
        fetchImpl,
      }),
    ).resolves.toEqual({
      webUrl: `${HOST}/jgts/bigdata-web-frontend/-/merge_requests/99`,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('throws when the GitLab API responds with a non-OK status', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ message: 'denied' }), { status: 403 }),
    )
    await expect(
      createMergeRequest({
        host: HOST,
        projectId: PROJECT_ID,
        token: 'glpat-test',
        sourceBranch: 'bugfix/428',
        targetBranch: 'dkh-custom-jinan',
        title: 'fix #428',
        description: 'auto',
        fetchImpl,
      }),
    ).rejects.toThrow(/403|merge_request|GitLab/i)
  })
})

describe('ensureMergeRequest', () => {
  it('returns created MR on first POST success', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          iid: 8,
          web_url: `${HOST}/jgts/bigdata-web-frontend/-/merge_requests/8`,
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      ),
    )

    await expect(
      ensureMergeRequest({
        host: HOST,
        projectId: PROJECT_ID,
        token: 'glpat-test',
        sourceBranch: 'bugfix/325',
        targetBranch: 'dkh-custom-jinan',
        title: 'fix #325',
        description: 'first',
        fetchImpl,
      }),
    ).resolves.toEqual({
      webUrl: `${HOST}/jgts/bigdata-web-frontend/-/merge_requests/8`,
      iid: 8,
      created: true,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('on conflict looks up existing MR by source_branch instead of failing', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ message: ['Already exists'] }), { status: 409 })
      }
      expect(url).toContain(`projects/${PROJECT_ID}/merge_requests`)
      expect(url).toContain('source_branch=bugfix%2F325')
      return new Response(
        JSON.stringify([
          {
            iid: 8,
            web_url: `${HOST}/jgts/bigdata-web-frontend/-/merge_requests/8`,
            source_branch: 'bugfix/325',
          },
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })

    await expect(
      ensureMergeRequest({
        host: HOST,
        projectId: PROJECT_ID,
        token: 'glpat-test',
        sourceBranch: 'bugfix/325',
        targetBranch: 'dkh-custom-jinan',
        title: 'fix #325',
        description: 'second',
        fetchImpl,
      }),
    ).resolves.toEqual({
      webUrl: `${HOST}/jgts/bigdata-web-frontend/-/merge_requests/8`,
      iid: 8,
      created: false,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})

describe('addMergeRequestNote', () => {
  it('POSTs a note on the merge request iid', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(
        `${HOST}/api/v4/projects/${PROJECT_ID}/merge_requests/8/notes`,
      )
      expect(init?.method).toBe('POST')
      expect(JSON.parse(String(init?.body))).toEqual({ body: 'commit: abc\nround 2' })
      return new Response(JSON.stringify({ id: 1 }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      })
    })

    await expect(
      addMergeRequestNote({
        host: HOST,
        projectId: PROJECT_ID,
        token: 'glpat-test',
        mergeRequestIid: 8,
        body: 'commit: abc\nround 2',
        fetchImpl,
      }),
    ).resolves.toBeUndefined()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
