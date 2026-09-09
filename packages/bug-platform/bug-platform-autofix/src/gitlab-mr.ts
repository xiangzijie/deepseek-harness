/**
 * Optional GitLab merge-request creation for bug-platform autofix. Callers pass
 * `GITLAB_TOKEN` (or omit it); missing token throws {@link GitlabTokenMissingError}
 * so orchestration can fall back to local commit + awaiting_push.
 *
 * @module @deepseek-ai/dsh-bug-platform-autofix/gitlab-mr
 */

/** Thrown when `createMergeRequest` is called without a GitLab private token. */
export class GitlabTokenMissingError extends Error {
  /**
   * @param message - optional detail; defaults to a stable orchestrator-facing string.
   */
  constructor(message = 'GITLAB_TOKEN is missing') {
    super(message)
    this.name = 'GitlabTokenMissingError'
  }
}

/** Options for {@link createMergeRequest}. */
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

/**
 * `POST /api/v4/projects/:id/merge_requests` with `PRIVATE-TOKEN` and return `web_url`.
 * @param opts - host, project, token, branches, title/description, optional fetch.
 * @returns `{ webUrl }` from the GitLab JSON `web_url` field.
 * @throws {GitlabTokenMissingError} when `token` is missing or empty.
 */
export async function createMergeRequest(
  opts: CreateMergeRequestOptions,
): Promise<{ webUrl: string }> {
  if (!opts.token) {
    throw new GitlabTokenMissingError()
  }

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
