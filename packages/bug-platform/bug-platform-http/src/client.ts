/**
 * Library HTTP client for the internal bug-platform API (login, list, get,
 * follow-up write, attachment download). Credentials and tokens stay in memory;
 * this module never logs them.
 * @module @deepseek-ai/dsh-bug-platform-http/client
 */

import { writeFile } from 'node:fs/promises'
import type {
  BugPlatformClientOptions,
  BugTicketDetail,
  BugTicketSummary,
  FollowupBody,
  ListTicketsQuery,
} from './types.ts'

/** Default list page size when the caller omits `pageSize`. */
const DEFAULT_PAGE_SIZE = 50

/** Optional JSON body / content-type for authenticated requests. */
interface AuthorizedInit {
  body?: string
  headers?: Record<string, string>
}

/**
 * Stateful bug-platform HTTP client: one login per process session, Bearer auth,
 * and a single re-login + retry on HTTP 401.
 */
export class BugPlatformClient {
  private readonly baseUrl: string
  private readonly username: string
  private readonly password: string
  private readonly fetchImpl: typeof fetch
  private token: string | undefined

  /**
   * @param opts - resolved base URL, username, password, and optional `fetch` inject.
   */
  constructor(opts: BugPlatformClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '')
    this.username = opts.username
    this.password = opts.password
    this.fetchImpl = opts.fetchImpl ?? fetch
  }

  /**
   * Return a cached token, or `POST /api/auth/login` once and cache `data.token`.
   * @returns Bearer token string (without the `Bearer ` prefix).
   */
  async ensureToken(): Promise<string> {
    if (this.token !== undefined) return this.token
    return this.login()
  }

  /**
   * `GET /api/bug-tickets` and return `data.list`.
   * @param query - project, status filter, and optional pagination.
   * @returns ticket summary rows from the platform list payload.
   */
  async listTickets(query: ListTicketsQuery): Promise<BugTicketSummary[]> {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE
    const params = new URLSearchParams({
      project_id: String(query.projectId),
      status: query.status,
      page: String(page),
      pageSize: String(pageSize),
    })
    const data = await this.authorizedJson<{ list: BugTicketSummary[] }>(
      'GET',
      `/api/bug-tickets?${params.toString()}`,
    )
    return data.list
  }

  /**
   * `GET /api/bug-tickets/:id` and return `data`.
   * @param id - ticket id.
   * @returns full ticket detail including follow-ups.
   */
  async getTicket(id: number): Promise<BugTicketDetail> {
    return this.authorizedJson<BugTicketDetail>('GET', `/api/bug-tickets/${id}`)
  }

  /**
   * `POST /api/bug-tickets/:id/followups` with a JSON body.
   * Null change fields leave the corresponding ticket field unchanged.
   * @param id - ticket id.
   * @param body - follow-up content and optional status/assignee/date changes.
   */
  async createFollowup(id: number, body: FollowupBody): Promise<void> {
    await this.authorizedJson<unknown>('POST', `/api/bug-tickets/${id}/followups`, {
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    })
  }

  /**
   * Download a Bearer-authenticated relative upload path into `destPath`.
   * Callers should skip `file_size === 0` before invoking.
   * @param urlPath - origin-relative path (e.g. `/api/uploads/...`).
   * @param destPath - local filesystem path to write response bytes.
   */
  async downloadToFile(urlPath: string, destPath: string): Promise<void> {
    const response = await this.authorizedResponse('GET', urlPath)
    if (!response.ok) {
      throw new Error(`bug-platform-http: ${urlPath} failed with HTTP ${response.status}`)
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    await writeFile(destPath, buffer)
  }

  /** Perform login, store token, and return it. */
  private async login(): Promise<string> {
    const payload = await this.parseSuccess<{ token: unknown }>(
      await this.fetchImpl(`${this.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: this.username, password: this.password }),
      }),
      'login',
    )
    if (typeof payload.token !== 'string' || payload.token.length === 0) {
      throw new Error('bug-platform-http: login response missing data.token')
    }
    this.token = payload.token
    return payload.token
  }

  /**
   * Authenticated JSON request with one 401 → re-login → retry cycle.
   * @param method - HTTP method.
   * @param path - path beginning with `/`, optionally including a query string.
   * @param init - optional JSON body and extra headers.
   */
  private async authorizedJson<T>(
    method: string,
    path: string,
    init?: AuthorizedInit,
  ): Promise<T> {
    return this.parseSuccess<T>(await this.authorizedResponse(method, path, init), path)
  }

  /**
   * Authenticated request with one 401 → re-login → retry cycle.
   * @param method - HTTP method.
   * @param path - path beginning with `/`.
   * @param init - optional body and headers.
   * @returns the final Response (may be non-OK for non-401 errors).
   */
  private async authorizedResponse(
    method: string,
    path: string,
    init?: AuthorizedInit,
  ): Promise<Response> {
    const first = await this.sendAuthorized(method, path, await this.ensureToken(), init)
    if (first.status !== 401) {
      return first
    }
    this.token = undefined
    const retry = await this.sendAuthorized(method, path, await this.login(), init)
    if (retry.status === 401) {
      throw new Error(`bug-platform-http: ${path} still returned 401 after re-login`)
    }
    return retry
  }

  /** Issue one request with `Authorization: Bearer <token>`. */
  private sendAuthorized(
    method: string,
    path: string,
    token: string,
    init?: AuthorizedInit,
  ): Promise<Response> {
    return this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...init?.headers,
      },
      body: init?.body,
    })
  }

  /**
   * Validate HTTP OK + `{ success: true, data }` at the JSON boundary; trust `data` afterward.
   * @param response - raw fetch response.
   * @param label - path or operation name for error messages (never includes secrets).
   */
  private async parseSuccess<T>(response: Response, label: string): Promise<T> {
    if (!response.ok) {
      throw new Error(`bug-platform-http: ${label} failed with HTTP ${response.status}`)
    }
    let body: unknown
    try {
      body = await response.json()
    } catch {
      // Non-JSON body at the wire boundary — surface a stable client error.
      throw new Error(`bug-platform-http: ${label} returned non-JSON body`)
    }
    if (
      typeof body !== 'object'
      || body === null
      || !('success' in body)
      || (body as { success: unknown }).success !== true
      || !('data' in body)
    ) {
      throw new Error(`bug-platform-http: ${label} response missing success:true data`)
    }
    return (body as { data: T }).data
  }
}

/**
 * Construct a {@link BugPlatformClient} from already-resolved options.
 * @param opts - base URL, username, password, optional fetch.
 * @returns a new client instance.
 */
export function createBugPlatformClient(opts: BugPlatformClientOptions): BugPlatformClient {
  return new BugPlatformClient(opts)
}
