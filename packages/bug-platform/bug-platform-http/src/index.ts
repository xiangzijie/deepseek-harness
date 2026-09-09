/**
 * `@deepseek-ai/dsh-bug-platform-http`: library-first HTTP access to the internal
 * bug-platform API. Export {@link BugPlatformClient} for callers that already
 * resolved username/password/baseUrl; Cordis `apply` only validates Config.
 *
 * @module @deepseek-ai/dsh-bug-platform-http
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-credentials'
import z from '@deepseek-ai/schemastery'

export { BugPlatformClient, createBugPlatformClient } from './client.ts'
export type {
  BugAttachment,
  BugFollowup,
  BugPlatformClientOptions,
  BugScreenshot,
  BugTicketDetail,
  BugTicketSummary,
  FollowupBody,
  ListTicketsQuery,
} from './types.ts'

/** Default bug-platform API origin for internal deployments. */
export const DEFAULT_BASE_URL = 'http://10.20.183.62:8080'

/** Default env var naming the bug-platform username credential reference. */
export const DEFAULT_USERNAME_ENV = 'BUG_PLATFORM_USERNAME'

/** Default env var naming the bug-platform password credential reference. */
export const DEFAULT_PASSWORD_ENV = 'BUG_PLATFORM_PASSWORD'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'bug-platform-http'

/**
 * Empty inject: callers construct {@link BugPlatformClient} with resolved
 * credentials (env/factory). Cordis credentials wiring stays optional for later.
 */
export const inject = []

/** Plugin / library config (all fields defaulted by {@link Config}). */
export interface Config {
  /** Bug-platform API origin, without a trailing slash requirement. */
  baseUrl?: string
  /** Credential-ref env name for the login username. */
  usernameEnv?: string
  /** Credential-ref env name for the login password. */
  passwordEnv?: string
}

export const Config: z<Config> = z.object({
  baseUrl: z.string().default(DEFAULT_BASE_URL),
  usernameEnv: z.string().role('credential-ref').default(DEFAULT_USERNAME_ENV),
  passwordEnv: z.string().role('credential-ref').default(DEFAULT_PASSWORD_ENV),
})

/** Complete config after schemastery applies every field default. */
type ResolvedConfig = Required<Config>

/** A non-empty string config field must survive defaulting. */
function assertNonEmpty(field: string, value: string): void {
  if (value.length === 0) {
    throw new Error(`bug-platform-http: ${field} must be a non-empty string`)
  }
}

/**
 * Validate resolved Config. Autofix (and other callers) construct
 * {@link BugPlatformClient} from env/factory; this plugin does not mount a ctx service.
 * @param _ctx - Cordis context; unused until a future optional service mounts.
 * @param config - plugin config after schemastery defaults.
 */
export function apply(_ctx: Context, config: Config): void {
  const resolved = config as ResolvedConfig
  assertNonEmpty('baseUrl', resolved.baseUrl)
  assertNonEmpty('usernameEnv', resolved.usernameEnv)
  assertNonEmpty('passwordEnv', resolved.passwordEnv)
}
