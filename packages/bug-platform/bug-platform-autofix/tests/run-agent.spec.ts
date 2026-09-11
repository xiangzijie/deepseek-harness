import { EventEmitter } from 'node:events'
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

function fakeChild(exitCode: number, stderr = '', stdout = '') {
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
})
