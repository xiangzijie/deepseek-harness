/**
 * Injectable headless agent runner for bug-platform autofix.
 * @module @deepseek-ai/dsh-bug-platform-autofix/run-agent
 */

import { spawn } from 'node:child_process'

/** Options passed to an {@link AgentRunner}. */
export interface AgentRunnerOptions {
  /** Product worktree cwd for the agent process. */
  cwd: string
  /** Brief prompt text (ticket context + paths). */
  brief: string
  /** Optional abort signal. */
  signal?: AbortSignal
}

/** Result of one agent invocation. */
export interface AgentRunnerResult {
  /** True when the agent exited successfully and reported a usable fix attempt. */
  ok: boolean
  /** Short summary for follow-up content / local state. */
  summary: string
}

/**
 * Run a headless fix agent in `cwd` with the given brief.
 * @param opts - cwd, brief, optional signal.
 * @returns ok flag and summary text.
 */
export type AgentRunner = (opts: AgentRunnerOptions) => Promise<AgentRunnerResult>

/** Options for {@link createDefaultAgentRunner}. */
export interface DefaultAgentRunnerOptions {
  /** Wall-clock timeout in milliseconds; defaults to 30 minutes. */
  timeoutMs?: number
}

/**
 * Spawn `pnpm dsh --profile headless <brief>` in the product worktree.
 * Phase-1 default; tests inject a fake {@link AgentRunner} instead.
 * @param options - optional timeout.
 * @returns an {@link AgentRunner}.
 */
export function createDefaultAgentRunner(
  options: DefaultAgentRunnerOptions = {},
): AgentRunner {
  const timeoutMs = options.timeoutMs ?? 30 * 60 * 1000
  return opts =>
    new Promise<AgentRunnerResult>((resolve) => {
      const child = spawn(
        'pnpm',
        ['dsh', '--profile', 'headless', opts.brief],
        {
          cwd: opts.cwd,
          env: { ...process.env },
          shell: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          signal: opts.signal,
        },
      )

      let stdout = ''
      let stderr = ''
      child.stdout?.on('data', (chunk: Buffer | string) => {
        stdout += String(chunk)
      })
      child.stderr?.on('data', (chunk: Buffer | string) => {
        stderr += String(chunk)
      })

      const timer = setTimeout(() => {
        child.kill('SIGTERM')
      }, timeoutMs)

      child.on('error', (error) => {
        clearTimeout(timer)
        resolve({ ok: false, summary: `agent spawn failed: ${error.message}` })
      })

      child.on('close', (code) => {
        clearTimeout(timer)
        const tail = (stdout || stderr).trim().slice(-2000)
        if (code === 0) {
          resolve({ ok: true, summary: tail || 'agent exited 0' })
          return
        }
        resolve({
          ok: false,
          summary: tail || `agent exited with code ${code ?? 'unknown'}`,
        })
      })
    })
}
