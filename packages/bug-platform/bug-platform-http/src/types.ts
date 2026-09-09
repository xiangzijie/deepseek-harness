/**
 * Bug-platform HTTP response types used by autofix orchestration.
 * @module @deepseek-ai/dsh-bug-platform-http/types
 */

/** Screenshot or attachment metadata returned on a ticket or follow-up. */
export interface BugAttachment {
  /** Absolute or origin-relative download path (Bearer-authenticated). */
  url: string
  /** Byte size when the platform reports it; `0` means skip download. */
  file_size?: number
  /** Optional display name from the platform. */
  name?: string
}

/** Screenshot entry on a ticket (`screenshots[]`). */
export type BugScreenshot = BugAttachment

/** One follow-up row on a ticket detail payload. */
export interface BugFollowup {
  /** Human-readable note body. */
  content: string
  /** ISO-8601 creation time; sort ascending before injecting into briefs. */
  created_at: string
  /** Display name of the author when present. */
  creator_name?: string
  /** New status when this follow-up changed status; otherwise null/omitted. */
  status_change?: string | null
  /** Issue-type change when recorded. */
  issue_type_change?: string | null
  /** Assignee change when recorded (`null` means leave assignee unchanged on write). */
  assignee_change?: number | null
  /** Attachments attached to this follow-up. */
  attachments?: BugAttachment[]
}

/**
 * List-row fields used when selecting tickets.
 * Extra platform keys may be present; callers should read only documented fields.
 */
export interface BugTicketSummary {
  id: number
  project_id: number
  /** Menu label used for workspace mapping; may be null. */
  target_menu: string | null
  description: string
  screenshots: BugScreenshot[]
  /** Unassigned tickets have `null`. */
  assignee_id: number | null
  status: string
  target_platform?: string | null
  issue_type?: string | null
  importance?: string | null
}

/** Detail payload from `GET /api/bug-tickets/:id`. */
export interface BugTicketDetail extends BugTicketSummary {
  followups: BugFollowup[]
}

/** Constructor options for {@link BugPlatformClient}. */
export interface BugPlatformClientOptions {
  /** API origin without requiring a trailing slash (e.g. `http://10.20.183.62:8080`). */
  baseUrl: string
  /** Login username (already resolved from env/credentials). */
  username: string
  /** Login password (already resolved from env/credentials). */
  password: string
  /** Injected `fetch` for tests; defaults to global `fetch`. */
  fetchImpl?: typeof fetch
}

/** Query for {@link BugPlatformClient.listTickets}. */
export interface ListTicketsQuery {
  projectId: number
  /** Comma-separated status filter, e.g. `待确认,验证未通过`. */
  status: string
  /** 1-based page index; defaults to `1`. */
  page?: number
  /** Page size; defaults to `50`. */
  pageSize?: number
}
