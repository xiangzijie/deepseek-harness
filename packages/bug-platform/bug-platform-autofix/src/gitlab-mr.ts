/**
 * Optional GitLab merge-request helpers for bug-platform autofix. Callers pass
 * `GITLAB_TOKEN` (or omit it); missing token throws {@link GitlabTokenMissingError}
 * so orchestration can fall back to local commit + awaiting_push.
 *
 * @module @deepseek-ai/dsh-bug-platform-autofix/gitlab-mr
 */

/** Thrown when a GitLab helper is called without a private token. */
export class GitlabTokenMissingError extends Error {
  /**
   * @param message - optional detail; defaults to a stable orchestrator-facing string.
   */
  constructor(message = 'GITLAB_TOKEN is missing') {
    super(message)
    this.name = 'GitlabTokenMissingError'
  }
}

/** Options for {@link createMergeRequest} / {@link ensureMergeRequest}. */
export type CreateMergeRequestOptions = {
  /** GitLab origin, e.g. `http://gitlab.info.dbappsecurity.com.cn`. */
  host: string
  /** Numeric project id (same remote for all three worktrees). */
  projectId: number
  /** Private token from env; `undefined` / `null` / `""` → {@link GitlabTokenMissingError}. */
  token: string | undefined | null
  /** Source branch, typically `bugfix/<ticketId>`. */
  sourceBranch: string
  /** Target product jinan for this worktree. */
  targetBranch: string
  /** MR title. */
  title: string
  /** MR description body. */
  description: string
  /** Injectable `fetch` for tests; defaults to global `fetch`. */
  fetchImpl?: typeof fetch
}

/** Result of {@link ensureMergeRequest}. */
export type EnsuredMergeRequest = {
  /** Browser URL of the merge request. */
  webUrl: string
  /** Project-local MR iid (used for notes). */
  iid: number
  /** True when this call created the MR; false when an existing one was reused. */
  created: boolean
}

/** Options for {@link addMergeRequestNote}. */
export type AddMergeRequestNoteOptions = {
  host: string
  projectId: number
  token: string | undefined | null
  /** Project-local merge request iid. */
  mergeRequestIid: number
  /** Note markdown / plain text body. */
  body: string
  fetchImpl?: typeof fetch
}

/**
 * `POST /api/v4/projects/:id/merge_requests` with `PRIVATE-TOKEN` and return `web_url`.
 * Prefer {@link ensureMergeRequest} when the source branch may already have an MR.
 * @param opts - host, project, token, branches, title/description, optional fetch.
 * @returns `{ webUrl }` from the GitLab JSON `web_url` field.
 * @throws {GitlabTokenMissingError} when `token` is missing or empty.
 */
export async function createMergeRequest(
  opts: CreateMergeRequestOptions,
): Promise<{ webUrl: string }> {
  requireToken(opts.token)

  const host = opts.host.replace(/\/+$/, '')
  const fetchImpl = opts.fetchImpl ?? fetch
  const url = `${host}/api/v4/projects/${opts.projectId}/merge_requests`
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'PRIVATE-TOKEN': opts.token,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      source_branch: opts.sourceBranch,
      target_branch: opts.targetBranch,
      title: opts.title,
      description: opts.description,
    }),
  })

  if (!response.ok) {
    throw new Error(
      `GitLab create merge_request failed with HTTP ${response.status}`,
    )
  }

  const body = (await response.json()) as { web_url?: unknown }
  if (typeof body.web_url !== 'string' || body.web_url.length === 0) {
    throw new Error('GitLab create merge_request response missing web_url')
  }
  return { webUrl: body.web_url }
}

/**
 * Create an MR, or reuse the existing one for the same `source_branch` when create
 * returns a conflict (typical on a second autofix pass for the same ticket).
 * @param opts - same as {@link createMergeRequest}.
 * @returns web URL, iid, and whether this call created the MR.
 * @throws {GitlabTokenMissingError} when `token` is missing or empty.
 */
export async function ensureMergeRequest(
  opts: CreateMergeRequestOptions,
): Promise<EnsuredMergeRequest> {
  const token = opts.token
  requireToken(token)

  const host = opts.host.replace(/\/+$/, '')
  const fetchImpl = opts.fetchImpl ?? fetch
  const createUrl = `${host}/api/v4/projects/${opts.projectId}/merge_requests`
  const createResponse = await fetchImpl(createUrl, {
    method: 'POST',
    headers: {
      'PRIVATE-TOKEN': token,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      source_branch: opts.sourceBranch,
      target_branch: opts.targetBranch,
      title: opts.title,
      description: opts.description,
    }),
  })

  if (createResponse.ok) {
    return { ...(await parseMrIdentity(createResponse)), created: true }
  }

  if (!isConflictStatus(createResponse.status)) {
    throw new Error(
      `GitLab create merge_request failed with HTTP ${createResponse.status}`,
    )
  }

  const existing = await findMergeRequestBySourceBranch({
    host,
    projectId: opts.projectId,
    token,
    sourceBranch: opts.sourceBranch,
    fetchImpl,
  })
  if (existing === null) {
    throw new Error(
      `GitLab create merge_request conflicted (HTTP ${createResponse.status}) but no MR found for source_branch=${opts.sourceBranch}`,
    )
  }
  return { ...existing, created: false }
}

/**
 * `POST .../merge_requests/:iid/notes` so each autofix push leaves a discussion comment.
 * @param opts - host, project, token, iid, note body, optional fetch.
 * @throws {GitlabTokenMissingError} when `token` is missing or empty.
 */
export async function addMergeRequestNote(
  opts: AddMergeRequestNoteOptions,
): Promise<void> {
  const token = opts.token
  requireToken(token)

  const host = opts.host.replace(/\/+$/, '')
  const fetchImpl = opts.fetchImpl ?? fetch
  const url =
    `${host}/api/v4/projects/${opts.projectId}/merge_requests/${opts.mergeRequestIid}/notes`
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'PRIVATE-TOKEN': token,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ body: opts.body }),
  })

  if (!response.ok) {
    throw new Error(
      `GitLab add merge_request note failed with HTTP ${response.status}`,
    )
  }
}

/**
 * @param token - GitLab private token candidate.
 * @throws {GitlabTokenMissingError} when missing or empty.
 */
function requireToken(token: string | undefined | null): asserts token is string {
  if (!token) {
    throw new GitlabTokenMissingError()
  }
}

/**
 * @param status - HTTP status from create MR.
 * @returns true for conflict-style responses that usually mean the MR already exists.
 */
function isConflictStatus(status: number): boolean {
  return status === 409
}

/**
 * @param response - successful create/list MR response.
 * @returns webUrl + iid.
 */
async function parseMrIdentity(
  response: Response,
): Promise<{ webUrl: string; iid: number }> {
  const body = (await response.json()) as { web_url?: unknown; iid?: unknown }
  if (typeof body.web_url !== 'string' || body.web_url.length === 0) {
    throw new Error('GitLab merge_request response missing web_url')
  }
  if (typeof body.iid !== 'number' || !Number.isInteger(body.iid)) {
    throw new Error('GitLab merge_request response missing iid')
  }
  return { webUrl: body.web_url, iid: body.iid }
}

/**
 * Look up an open (or any) MR for a source branch.
 * @param opts - host, project, token, source branch, fetch.
 * @returns identity or null when none match.
 */
async function findMergeRequestBySourceBranch(opts: {
  host: string
  projectId: number
  token: string
  sourceBranch: string
  fetchImpl: typeof fetch
}): Promise<{ webUrl: string; iid: number } | null> {
  const params = new URLSearchParams({
    source_branch: opts.sourceBranch,
    state: 'opened',
    per_page: '20',
  })
  const url =
    `${opts.host}/api/v4/projects/${opts.projectId}/merge_requests?${params.toString()}`
  const response = await opts.fetchImpl(url, {
    method: 'GET',
    headers: { 'PRIVATE-TOKEN': opts.token },
  })
  if (!response.ok) {
    throw new Error(
      `GitLab list merge_requests failed with HTTP ${response.status}`,
    )
  }
  const body = (await response.json()) as unknown
  if (!Array.isArray(body) || body.length === 0) {
    return null
  }
  const first = body[0] as { web_url?: unknown; iid?: unknown }
  if (typeof first.web_url !== 'string' || first.web_url.length === 0) {
    throw new Error('GitLab list merge_requests entry missing web_url')
  }
  if (typeof first.iid !== 'number' || !Number.isInteger(first.iid)) {
    throw new Error('GitLab list merge_requests entry missing iid')
  }
  return { webUrl: first.web_url, iid: first.iid }
}
