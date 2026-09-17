import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

const spawnMock = vi.fn()

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}))

const {
  createDefaultAgentRunner,
  resolveHarnessTsxImport,
  resolveHarnessTsxTsconfig,
} = await import('../src/run-agent.ts')

function fakeChild(exitCode: number | null, stderr = '', stdout = '') {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    kill: ReturnType<typeof vi.fn>
  }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn()
  queueMicrotask(() => {
    if (stdout !== '') child.stdout.emit('data', stdout)
    if (stderr !== '') child.stderr.emit('data', stderr)
    child.emit('close', exitCode)
  })
  return child
}

describe('createDefaultAgentRunner', () => {
  afterEach(() => {
    spawnMock.mockReset()
  })

  it('spawns harness apps/cli with absolute tsx, harness TSX_TSCONFIG_PATH, product cwd', async () => {
    const harnessRoot = process.cwd()
    const productCwd = 'D:/CODE/COMPANY/dkh-bugFix-project/dkh-custom'
    const expectedTsx = resolveHarnessTsxImport(harnessRoot)
    const expectedTsconfig = resolveHarnessTsxTsconfig(harnessRoot)
    spawnMock.mockReturnValue(fakeChild(0, '', 'ok'))

    const runner = createDefaultAgentRunner({ harnessRoot })
    const result = await runner({ cwd: productCwd, brief: 'fix ticket 428' })

    expect(result.ok).toBe(true)
    expect(spawnMock).toHaveBeenCalledTimes(1)
    const [command, args, options] = spawnMock.mock.calls[0] as [
      string,
      string[],
      { cwd: string; shell?: boolean; env?: NodeJS.ProcessEnv },
    ]
    expect(command).toBe(process.execPath)
    expect(args[0]).toBe('--import')
    expect(args[1]).toBe(expectedTsx)
    expect(args[1]).toMatch(/^file:/)
    expect(args.slice(2)).toEqual([
      join(harnessRoot, 'apps/cli/src/bin.ts'),
      '--profile',
      'headless',
      'fix ticket 428',
    ])
    expect(options.cwd).toBe(productCwd)
    expect(options.shell).toBe(false)
    expect(options.env?.['TSX_TSCONFIG_PATH']).toBe(expectedTsconfig)
  })

  it('passes --patch overlay before the brief when skillPatch is set', async () => {
    const harnessRoot = process.cwd()
    spawnMock.mockReturnValue(fakeChild(0, '', 'ok'))

    const runner = createDefaultAgentRunner({
      harnessRoot,
      skillPatch: {
        globalSkillsDir: 'D:/g/skills',
        personalRoot: 'D:/p/local',
      },
    })
    const result = await runner({ cwd: 'D:/product', brief: 'fix ticket 428' })

    expect(result.ok).toBe(true)
    const args = spawnMock.mock.calls[0]?.[1] as string[]
    const patchIdx = args.indexOf('--patch')
    const briefIdx = args.indexOf('fix ticket 428')
    expect(patchIdx).toBeGreaterThan(-1)
    expect(briefIdx).toBeGreaterThan(patchIdx)
    expect(args.slice(patchIdx - 2, briefIdx + 1)).toEqual([
      '--profile',
      'headless',
      '--patch',
      args[patchIdx + 1],
      'fix ticket 428',
    ])
    const overlayPath = args[patchIdx + 1]
    expect(overlayPath).toEqual(expect.any(String))
    const overlay = readFileSync(overlayPath as string, 'utf8')
    expect(overlay).toContain('customSkillDirs')
    expect(overlay).toContain('D:/g/skills')
    expect(overlay).toContain('insert:')
    expect(overlay).toContain('autofix-personal-skills')
    expect(overlay).toContain('D:/p/local')
  })

  it('resolveHarnessTsxImport points into harness node_modules, not product cwd', () => {
    const href = resolveHarnessTsxImport(process.cwd())
    const fromHarness = createRequire(join(process.cwd(), 'package.json')).resolve('tsx/esm')
    expect(href).toBe(pathToFileURL(fromHarness).href)
    expect(href.includes('dkh-custom')).toBe(false)
  })

  it('resolveHarnessTsxTsconfig is the harness root tsconfig.json', () => {
    expect(resolveHarnessTsxTsconfig('D:/harness')).toBe(join('D:/harness', 'tsconfig.json'))
  })

  it('returns a non-empty summary when the agent exits non-zero with empty pipes', async () => {
    spawnMock.mockReturnValue(fakeChild(1))
    const runner = createDefaultAgentRunner({
      harnessRoot: process.cwd(),
    })
    const result = await runner({ cwd: 'D:/product', brief: 'x' })
    expect(result.ok).toBe(false)
    expect(result.summary.length).toBeGreaterThan(0)
  })

  it('includes stderr in the summary', async () => {
    spawnMock.mockReturnValue(fakeChild(1, 'boom', ''))
    const runner = createDefaultAgentRunner({ harnessRoot: process.cwd() })
    const result = await runner({ cwd: 'D:/product', brief: 'x' })
    expect(result.ok).toBe(false)
    expect(result.summary).toContain('boom')
  })

  it('uses a fallback summary when exit 0 produces empty pipes', async () => {
    spawnMock.mockReturnValue(fakeChild(0))
    const runner = createDefaultAgentRunner({ harnessRoot: process.cwd() })
    const result = await runner({ cwd: 'D:/product', brief: 'x' })
    expect(result.ok).toBe(true)
    expect(result.summary).toBe('agent exited 0')
  })

  it('uses unknown when the process close code is null', async () => {
    spawnMock.mockReturnValue(fakeChild(null))
    const runner = createDefaultAgentRunner({ harnessRoot: process.cwd() })
    const result = await runner({ cwd: 'D:/product', brief: 'x' })
    expect(result.ok).toBe(false)
    expect(result.summary).toContain('unknown')
  })

  it('reports spawn errors', async () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
      kill: ReturnType<typeof vi.fn>
    }
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.kill = vi.fn()
    spawnMock.mockReturnValue(child)
    const runner = createDefaultAgentRunner({ harnessRoot: process.cwd() })
    const pending = runner({ cwd: 'D:/product', brief: 'x' })
    queueMicrotask(() => child.emit('error', new Error('spawn ENOENT')))
    const result = await pending
    expect(result.ok).toBe(false)
    expect(result.summary).toContain('spawn ENOENT')
  })

  it('kills the child when timeoutMs elapses', async () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
      kill: ReturnType<typeof vi.fn>
    }
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.kill = vi.fn()
    spawnMock.mockReturnValue(child)
    const runner = createDefaultAgentRunner({
      harnessRoot: process.cwd(),
      timeoutMs: 20,
    })
    const pending = runner({ cwd: 'D:/product', brief: 'x' })
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    child.emit('close', 1)
    const result = await pending
    expect(result.ok).toBe(false)
  })
})
