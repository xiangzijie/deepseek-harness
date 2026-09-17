/**
 * Injectable headless agent runner for bug-platform autofix.
 * @module @deepseek-ai/dsh-bug-platform-autofix/run-agent
 */

import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  renderHeadlessSkillPatch,
  resolvePersonalSkillPluginPath,
} from './headless-skill-patch.ts'

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
  /**
   * Absolute path to the deepseek-harness repo root (the worktree that defines
   * `pnpm dsh` / `apps/cli/src/bin.ts`). Required: the agent must not look up
   * `dsh` inside the product worktree.
   */
  harnessRoot: string
  /** Wall-clock timeout in milliseconds; defaults to 30 minutes. */
  timeoutMs?: number
  /**
   * When set, each spawn writes a `--patch` overlay that sets skill-filesystem
   * `customSkillDirs` to `globalSkillsDir` and inserts the rank-50 personal
   * provider at `personalRoot`. Directories need not exist. `personalRoot` is
   * already operator-scoped (`join(personalRoot, operatorId)`) at the caller.
   */
  skillPatch?: {
    /** Global clone `skills/` directory. */
    globalSkillsDir: string
    /** Operator-scoped personal skill directory. */
    personalRoot: string
  }
}

/**
 * Resolve `tsx/esm` from the harness root as a `file:` URL.
 * Node resolves bare `--import tsx/esm` against process cwd; when the agent
 * runs with product-worktree cwd that lookup fails, so callers must pass this
 * absolute specifier instead.
 * @param harnessRoot - absolute deepseek-harness repo root.
 * @returns `file:` URL to the harness-installed `tsx/esm` entry.
 */
export function resolveHarnessTsxImport(harnessRoot: string): string {
  const requireFromHarness = createRequire(join(harnessRoot, 'package.json'))
  return pathToFileURL(requireFromHarness.resolve('tsx/esm')).href
}

/**
 * Absolute path to the harness root `tsconfig.json` used for source-plane
 * `paths` resolution while the agent process cwd is the product worktree.
 * @param harnessRoot - absolute deepseek-harness repo root.
 * @returns absolute tsconfig path for `TSX_TSCONFIG_PATH`.
 */
export function resolveHarnessTsxTsconfig(harnessRoot: string): string {
  return join(harnessRoot, 'tsconfig.json')
}

/**
 * Spawn harness `dsh --profile headless [--patch <overlay.yml>] <brief>` with
 * `cwd` set to the product worktree so FS tools edit the mapped repo. Uses
 * `node --import <absolute tsx> apps/cli/src/bin.ts` under
 * {@link DefaultAgentRunnerOptions.harnessRoot} and sets `TSX_TSCONFIG_PATH`
 * to the harness `tsconfig.json` so workspace packages resolve to `src/` even
 * when cwd is not the harness root. The `--patch` overlay is written per call
 * under `os.tmpdir()` when {@link DefaultAgentRunnerOptions.skillPatch} is set.
 * @param options - harness root, optional timeout, and optional skill overlay.
 * @returns an {@link AgentRunner}.
 */
export function createDefaultAgentRunner(
  options: DefaultAgentRunnerOptions,
): AgentRunner {
  const timeoutMs = options.timeoutMs ?? 30 * 60 * 1000
  const binEntry = join(options.harnessRoot, 'apps/cli/src/bin.ts')
  const tsxImport = resolveHarnessTsxImport(options.harnessRoot)
  const tsxTsconfig = resolveHarnessTsxTsconfig(options.harnessRoot)
  return opts =>
    new Promise<AgentRunnerResult>((resolve) => {
      const child = spawn(
        process.execPath,
        buildHeadlessArgv(options, binEntry, tsxImport, opts.brief),
        {
          cwd: opts.cwd,
          env: {
            ...process.env,
            TSX_TSCONFIG_PATH: tsxTsconfig,
          },
          // Keep pipes reliable on Windows; do not shell-wrap.
          shell: false,
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
        const combined = `${stdout}${stderr}`.trim()
        const tail = combined.slice(-2000)
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

/**
 * Build `node --import <tsx> <bin> --profile headless [--patch <overlay>] <brief>`.
 * Overlay path is unique per call so concurrent runners cannot clobber YAML.
 * @param options - runner options (skill overlay is optional).
 * @param binEntry - absolute `apps/cli/src/bin.ts`.
 * @param tsxImport - absolute `file:` tsx specifier.
 * @param brief - positional brief after launcher flags.
 * @returns spawn argv for `process.execPath`.
 */
function buildHeadlessArgv(
  options: DefaultAgentRunnerOptions,
  binEntry: string,
  tsxImport: string,
  brief: string,
): string[] {
  const argv = ['--import', tsxImport, binEntry, '--profile', 'headless']
  if (options.skillPatch !== undefined) {
    const overlayPath = join(
      tmpdir(),
      `dsh-autofix-skill-${process.pid}-${randomBytes(4).toString('hex')}.yml`,
    )
    writeFileSync(
      overlayPath,
      renderHeadlessSkillPatch({
        globalSkillsDir: options.skillPatch.globalSkillsDir,
        personalRoot: options.skillPatch.personalRoot,
        personalPluginPath: resolvePersonalSkillPluginPath(options.harnessRoot),
      }),
    )
    argv.push('--patch', overlayPath)
  }
  argv.push(brief)
  return argv
}
