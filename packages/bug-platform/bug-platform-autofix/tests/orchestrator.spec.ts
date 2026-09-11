import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type {
  BugAttachment,
  BugTicketDetail,
  FollowupBody,
} from '@deepseek-ai/dsh-bug-platform-http'
import { loadMenuMapping } from '../src/menu-mapping.ts'
import { runBatch, runOneTicket, type OrchestratorConfig } from '../src/orchestrator.ts'
import { TicketStateStore } from '../src/ticket-state.ts'
import type { AgentRunner } from '../src/run-agent.ts'
import type { RunGit } from '../src/git-workspace.ts'

const CUSTOM_ROOT = 'D:/fake/dkh-custom'
const AILPHA_ROOT = 'D:/fake/dkh-ailpha'
const HOME_ROOT = 'D:/fake/dkh-home'

const mappingJson = {
  systems: {
    demo: {
      items: [
        {
          target_menu: '资产核查',
          menu_path: '/a/assets',
          menu_code: 'asset',
          repo: 'custom',
          branch: 'dkh-custom-jinan',
          routeHint: '/assets/assetVerification',
          filePath: 'src/views/assetVerification/index.vue',
          file_exists: true,
        },
        {
          target_menu: '首页配置',
          menu_path: '/home',
          menu_code: 'home',
          repo: 'home',
          branch: 'dkh-home-jinan',
          routeHint: null,
          filePath: null,
          file_exists: true,
        },
      ],
    },
  },
}

function detail(partial: Partial<BugTicketDetail> & Pick<BugTicketDetail, 'id' | 'target_menu'>): BugTicketDetail {
  return {
    project_id: 47,
    description: '复现步骤：打开资产核查',
    screenshots: [],
    assignee_id: null,
    status: '待确认',
    followups: [],
    issue_type: '缺陷',
    importance: '高',
    target_platform: 'web',
    ...partial,
  }
}

function fakeClient(handlers: {
  getTicket?: (id: number) => Promise<BugTicketDetail>
  listTickets?: () => Promise<BugTicketDetail[]>
  createFollowup?: (id: number, body: FollowupBody) => Promise<void>
  downloadToFile?: (urlPath: string, destPath: string) => Promise<void>
}) {
  const followups: Array<{ id: number; body: FollowupBody }> = []
  const downloads: Array<{ urlPath: string; destPath: string }> = []
  const order: string[] = []

  return {
    order,
    followups,
    downloads,
    client: {
      async ensureToken() {
        order.push('ensureToken')
        return 'tok'
      },
      async getTicket(id: number) {
        order.push(`getTicket:${id}`)
        if (handlers.getTicket) return handlers.getTicket(id)
        throw new Error(`unexpected getTicket ${id}`)
      },
      async listTickets() {
        order.push('listTickets')
        return handlers.listTickets ? handlers.listTickets() : []
      },
      async createFollowup(id: number, body: FollowupBody) {
        order.push(`followup:${id}:${body.status_change ?? 'null'}`)
        followups.push({ id, body })
        if (handlers.createFollowup) await handlers.createFollowup(id, body)
      },
      async downloadToFile(urlPath: string, destPath: string) {
        order.push(`download:${urlPath}`)
        downloads.push({ urlPath, destPath })
        if (handlers.downloadToFile) await handlers.downloadToFile(urlPath, destPath)
        else {
          mkdirSync(join(destPath, '..'), { recursive: true })
          writeFileSync(destPath, 'img')
        }
      },
    },
  }
}

function baseConfig(
  overrides: Partial<OrchestratorConfig> & Pick<OrchestratorConfig, 'client' | 'agentRunner'>,
): OrchestratorConfig {
  const assetsDir = mkdtempSync(join(tmpdir(), 'dsh-bugfix-assets-'))
  return {
    menuIndex: loadMenuMapping(mappingJson),
    stateStore: new TicketStateStore(),
    workspaceRoots: {
      custom: CUSTOM_ROOT,
      ailpha: AILPHA_ROOT,
      home: HOME_ROOT,
    },
    productBranches: {
      custom: 'dkh-custom-jinan',
      ailpha: 'dkh-ailpha-jinan',
      home: 'dkh-home-jinan',
    },
    gitlab: {
      host: 'http://gitlab.example.com',
      projectId: 8325,
      token: 'gl-token',
    },
    assetsDir,
    lintEnabled: false,
    buildEnabled: false,
    ...overrides,
  }
}

/** Shared fake git for the custom worktree happy path through claim + branch. */
function cleanCustomGit(handlers: Record<string, string | (() => string)> = {}): RunGit {
  return async (_cwd, args) => {
    const key = args.join(' ')
    if (handlers[key] !== undefined) {
      const h = handlers[key]
      return typeof h === 'function' ? h() : h
    }
    if (key === 'rev-parse --abbrev-ref HEAD') return 'dkh-custom-jinan\n'
    if (key === 'status --porcelain') return ''
    if (key.startsWith('branch --list ')) return ''
    if (key.startsWith('checkout -b ')) return ''
    if (key === 'add -A') return ''
    if (key.startsWith('commit ')) return ''
    if (key === 'rev-parse HEAD') return 'abc123deadbeef\n'
    if (key.startsWith('push ')) return ''
    throw new Error(`unexpected ${key}`)
  }
}

describe('runOneTicket state machine', () => {
  it('resolves menu mapping before followup 处理中', async () => {
    const ticket = detail({ id: 428, target_menu: '资产核查' })
    const { client, order, followups } = fakeClient({})
    const agentRunner: AgentRunner = async () => ({ ok: true, summary: 'fixed' })
    let porcelainCalls = 0
    const runGit = cleanCustomGit({
      'status --porcelain': () => {
        porcelainCalls += 1
        return porcelainCalls === 1 ? '' : ' M src/views/assetVerification/index.vue\n'
      },
    })
    const ensureMr = vi.fn(async () => ({
      webUrl: 'http://gitlab.example.com/mr/1',
      iid: 1,
      created: true,
    }))
    const addMrNote = vi.fn(async () => undefined)

    const outcome = await runOneTicket(
      baseConfig({ client, agentRunner, runGit, ensureMr, addMrNote }),
      ticket,
    )

    expect(outcome).toEqual({ kind: 'done', mrUrl: 'http://gitlab.example.com/mr/1' })
    expect(order.indexOf('followup:428:处理中')).toBeGreaterThanOrEqual(0)
    expect(followups[0]?.body.status_change).toBe('处理中')
    expect(followups[0]?.body.assignee_change).toBeNull()
    expect(followups.at(-1)?.body.status_change).toBe('处理中')
    expect(followups.at(-1)?.body.content).toContain('http://gitlab.example.com/mr/1')
    expect(followups.at(-1)?.body.content).toMatch(/自动修复完成|MR/)
    expect(addMrNote).toHaveBeenCalledWith(
      expect.objectContaining({
        mergeRequestIid: 1,
        body: expect.stringMatching(/commit:|abc123deadbeef|fixed/),
      }),
    )
  })

  it('on re-fix with existing MR: push, reuse MR, add platform followup + MR note', async () => {
    const ticket = detail({ id: 325, target_menu: '资产核查' })
    const { client, followups } = fakeClient({})
    const agentRunner: AgentRunner = async () => ({ ok: true, summary: 'second pass fix' })
    let porcelainCalls = 0
    const runGit = cleanCustomGit({
      'status --porcelain': () => {
        porcelainCalls += 1
        return porcelainCalls === 1 ? '' : ' M src/views/assetVerification/index.vue\n'
      },
      'rev-parse HEAD': '99d9ce66578ff777ee06c4d7ce716220178ef328\n',
      'branch --list bugfix/325': '  bugfix/325\n',
      'checkout bugfix/325': '',
    })
    const ensureMr = vi.fn(async () => ({
      webUrl: 'http://gitlab.example.com/mr/8',
      iid: 8,
      created: false,
    }))
    const addMrNote = vi.fn(async () => undefined)
    const store = new TicketStateStore([
      {
        ticketId: 325,
        phase: 'done',
        repo: 'custom',
        branch: 'bugfix/325',
        mrUrl: 'http://gitlab.example.com/mr/8',
        updatedAt: '2026-09-10T00:00:00.000Z',
      },
    ])

    const outcome = await runOneTicket(
      baseConfig({
        client,
        agentRunner,
        runGit,
        ensureMr,
        addMrNote,
        stateStore: store,
      }),
      ticket,
    )

    expect(outcome).toEqual({ kind: 'done', mrUrl: 'http://gitlab.example.com/mr/8' })
    expect(ensureMr).toHaveBeenCalledTimes(1)
    expect(addMrNote).toHaveBeenCalledWith(
      expect.objectContaining({
        mergeRequestIid: 8,
        body: expect.stringMatching(/99d9ce66578ff777ee06c4d7ce716220178ef328|second pass fix/),
      }),
    )
    const successFollowups = followups.filter(
      f =>
        f.body.status_change === '处理中' &&
        typeof f.body.content === 'string' &&
        f.body.content.includes('http://gitlab.example.com/mr/8'),
    )
    expect(successFollowups.length).toBeGreaterThanOrEqual(1)
    expect(successFollowups.at(-1)?.body.content).toMatch(/重新处理|99d9ce66578ff777ee06c4d7ce716220178ef328|second pass fix/)
    expect(followups.some(f => f.body.content.includes('重新处理开始'))).toBe(true)
    expect(followups.every(f => f.body.status_change !== '现场验证')).toBe(true)
    expect(store.get(325)?.phase).toBe('done')
    expect(store.get(325)?.mrUrl).toBe('http://gitlab.example.com/mr/8')
  })

  it('skips unmapped tickets with optional followup and does not claim', async () => {
    const ticket = detail({ id: 99, target_menu: '不存在的菜单' })
    const { client, followups, order } = fakeClient({})
    const agentRunner = vi.fn(async () => ({ ok: true, summary: 'nope' }))

    const outcome = await runOneTicket(baseConfig({ client, agentRunner }), ticket)

    expect(outcome.kind).toBe('skipped')
    expect(followups).toHaveLength(1)
    expect(followups[0]?.body.status_change == null || followups[0]?.body.status_change === '').toBe(true)
    expect(followups[0]?.body.content).toMatch(/无菜单映射|映射/)
    expect(order.some(s => s.includes('处理中'))).toBe(false)
    expect(agentRunner).not.toHaveBeenCalled()
  })

  it('skips home-mapped tickets without claiming 处理中', async () => {
    const ticket = detail({ id: 100, target_menu: '首页配置' })
    const { client, followups } = fakeClient({})
    const agentRunner = vi.fn(async () => ({ ok: true, summary: 'nope' }))

    const outcome = await runOneTicket(baseConfig({ client, agentRunner }), ticket)

    expect(outcome.kind).toBe('skipped')
    expect(followups[0]?.body.status_change == null || followups[0]?.body.status_change === '').toBe(true)
    expect(followups[0]?.body.content).toMatch(/home/i)
    expect(agentRunner).not.toHaveBeenCalled()
  })

  it('skips 网络安全数据大屏 even when mapped and force-loaded', async () => {
    const menuIndex = loadMenuMapping({
      systems: {
        dash: {
          items: [
            {
              target_menu: '网络安全数据大屏',
              menu_path: '/dash',
              menu_code: 'dash',
              repo: 'custom',
              branch: 'dkh-custom-jinan',
              routeHint: '/dash',
              filePath: 'src/views/dash/index.vue',
              file_exists: true,
            },
          ],
        },
      },
    })
    const ticket = detail({ id: 501, target_menu: '网络安全数据大屏' })
    const { client, followups, order } = fakeClient({})
    const agentRunner = vi.fn(async () => ({ ok: true, summary: 'nope' }))

    const outcome = await runOneTicket(
      baseConfig({ client, agentRunner, menuIndex }),
      ticket,
    )

    expect(outcome).toEqual({
      kind: 'skipped',
      reason: expect.stringMatching(/网络安全数据大屏/),
    })
    expect(followups[0]?.body.status_change == null || followups[0]?.body.status_change === '').toBe(true)
    expect(order.some(s => s.includes('处理中'))).toBe(false)
    expect(agentRunner).not.toHaveBeenCalled()
  })

  it('skips 网络安全指挥大屏 even when mapped and force-loaded', async () => {
    const menuIndex = loadMenuMapping({
      systems: {
        dash: {
          items: [
            {
              target_menu: '网络安全指挥大屏',
              menu_path: '/cmd-dash',
              menu_code: 'cmd-dash',
              repo: 'custom',
              branch: 'dkh-custom-jinan',
              routeHint: '/cmd-dash',
              filePath: 'src/views/cmdDash/index.vue',
              file_exists: true,
            },
          ],
        },
      },
    })
    const ticket = detail({ id: 502, target_menu: '网络安全指挥大屏' })
    const { client, followups, order } = fakeClient({})
    const agentRunner = vi.fn(async () => ({ ok: true, summary: 'nope' }))

    const outcome = await runOneTicket(
      baseConfig({ client, agentRunner, menuIndex }),
      ticket,
    )

    expect(outcome).toEqual({
      kind: 'skipped',
      reason: expect.stringMatching(/网络安全指挥大屏/),
    })
    expect(followups[0]?.body.status_change == null || followups[0]?.body.status_change === '').toBe(true)
    expect(order.some(s => s.includes('处理中'))).toBe(false)
    expect(agentRunner).not.toHaveBeenCalled()
  })

  it('on git/MR failure after local commit stays 处理中 with awaiting_push phase', async () => {
    const ticket = detail({ id: 428, target_menu: '资产核查' })
    const { client, followups } = fakeClient({})
    const agentRunner: AgentRunner = async () => ({ ok: true, summary: 'fixed' })
    let porcelainCalls = 0
    const runGit = cleanCustomGit({
      'status --porcelain': () => {
        porcelainCalls += 1
        return porcelainCalls === 1 ? '' : ' M src/views/assetVerification/index.vue\n'
      },
      'rev-parse HEAD': 'commitsha1\n',
      'push -u origin bugfix/428': () => {
        throw new Error('push denied')
      },
    })
    const ensureMr = vi.fn()
    const store = new TicketStateStore()

    const outcome = await runOneTicket(
      baseConfig({ client, agentRunner, runGit, ensureMr, stateStore: store }),
      ticket,
    )

    expect(outcome).toMatchObject({ kind: 'awaiting_push', branch: 'bugfix/428' })
    expect(ensureMr).not.toHaveBeenCalled()
    expect(followups.at(-1)?.body.status_change).toBe('处理中')
    expect(followups.at(-1)?.body.content).toMatch(/待人工推送|awaiting|人工/)
    expect(store.get(428)?.phase).toBe('awaiting_push')
    expect(followups.every(f => f.body.status_change !== '现场验证')).toBe(true)
  })

  it('never checks out a wrong product jinan when HEAD is mismatched', async () => {
    const ticket = detail({ id: 428, target_menu: '资产核查' })
    const { client, followups } = fakeClient({})
    const agentRunner = vi.fn(async () => ({ ok: true, summary: 'fixed' }))
    const gitCalls: string[] = []
    const runGit: RunGit = async (_cwd, args) => {
      const key = args.join(' ')
      gitCalls.push(key)
      if (key === 'rev-parse --abbrev-ref HEAD') return 'dkh-ailpha-jinan\n'
      if (key === 'status --porcelain') return ''
      throw new Error(`should not reach: ${key}`)
    }
    const store = new TicketStateStore()

    const outcome = await runOneTicket(
      baseConfig({ client, agentRunner, runGit, stateStore: store }),
      ticket,
    )

    expect(outcome.kind).toBe('failed')
    expect(gitCalls.some(c => c.includes('checkout') && c.includes('dkh-custom-jinan'))).toBe(false)
    expect(gitCalls.some(c => c.startsWith('checkout'))).toBe(false)
    expect(agentRunner).not.toHaveBeenCalled()
    expect(followups.at(-1)?.body.status_change).toBe('处理中')
    expect(store.get(428)?.phase).toBe('failed')
  })

  it('stops before agent when description is empty and there are no screenshots', async () => {
    const ticket = detail({
      id: 900,
      target_menu: '资产核查',
      description: '',
      screenshots: [],
    })
    const { client, followups } = fakeClient({})
    const agentRunner = vi.fn(async () => ({ ok: true, summary: 'should-not-run' }))
    const store = new TicketStateStore()

    const outcome = await runOneTicket(
      baseConfig({ client, agentRunner, runGit: cleanCustomGit(), stateStore: store }),
      ticket,
    )

    expect(outcome.kind).toBe('failed')
    expect(String((outcome as { reason: string }).reason)).toMatch(/停止并跳过|insufficient_context/)
    expect(agentRunner).not.toHaveBeenCalled()
    expect(followups.at(-1)?.body.status_change).toBe('处理中')
    expect(followups.at(-1)?.body.content).toMatch(/停止并跳过/)
    expect(followups.at(-1)?.body.content).toContain('insufficient_context')
    expect(store.get(900)?.phase).toBe('failed')
  })

  it('writes stop followup when agent reports SKIP_AUTOFIX|not_frontend', async () => {
    const ticket = detail({ id: 901, target_menu: '资产核查' })
    const { client, followups } = fakeClient({})
    const agentRunner: AgentRunner = async () => ({
      ok: false,
      summary: 'SKIP_AUTOFIX|not_frontend|更像后端接口枚举不一致',
    })
    const store = new TicketStateStore()

    const outcome = await runOneTicket(
      baseConfig({ client, agentRunner, runGit: cleanCustomGit(), stateStore: store }),
      ticket,
    )

    expect(outcome.kind).toBe('failed')
    expect(followups.at(-1)?.body.content).toMatch(/not_frontend/)
    expect(followups.at(-1)?.body.content).toContain('更像后端接口枚举不一致')
    expect(followups.at(-1)?.body.status_change).toBe('处理中')
    expect(store.get(901)?.phase).toBe('failed')
  })

  it('on agent failure or no diff stays 处理中 with phase failed', async () => {
    const ticket = detail({ id: 428, target_menu: '资产核查' })
    const { client, followups } = fakeClient({})
    const agentRunner: AgentRunner = async () => ({ ok: false, summary: '像后端接口问题' })
    const store = new TicketStateStore()

    const outcome = await runOneTicket(
      baseConfig({ client, agentRunner, runGit: cleanCustomGit(), stateStore: store }),
      ticket,
    )

    expect(outcome).toMatchObject({ kind: 'failed' })
    expect(followups.at(-1)?.body.status_change).toBe('处理中')
    expect(followups.at(-1)?.body.content).toContain('像后端接口问题')
    expect(store.get(428)?.phase).toBe('failed')
  })

  it('skips zero-size attachments and downloads the rest before agent', async () => {
    const zero: BugAttachment = { url: '/api/uploads/zero.png', file_size: 0 }
    const okShot: BugAttachment = { url: '/api/uploads/shot.png', file_size: 12, name: 'shot.png' }
    const ticket = detail({
      id: 428,
      target_menu: '资产核查',
      screenshots: [zero, okShot],
      followups: [
        {
          content: '补充',
          created_at: '2026-01-01T00:00:00Z',
          attachments: [{ url: '/api/uploads/note.png', file_size: 8, name: 'note.png' }],
        },
      ],
    })
    const { client, downloads, order } = fakeClient({})
    const agentRunner = vi.fn(async (_opts: { cwd: string; brief: string }) => ({
      ok: false,
      summary: 'stop-after-download',
    }))

    await runOneTicket(baseConfig({ client, agentRunner, runGit: cleanCustomGit() }), ticket)

    expect(downloads.map(d => d.urlPath)).toEqual([
      '/api/uploads/shot.png',
      '/api/uploads/note.png',
    ])
    const claimIdx = order.indexOf('followup:428:处理中')
    const firstDownload = order.findIndex(s => s.startsWith('download:'))
    expect(firstDownload).toBeGreaterThan(claimIdx)
    const agentCall = agentRunner.mock.calls[0]?.[0]
    expect(agentCall?.brief).toContain('shot.png')
    expect(agentCall?.cwd).toBe(CUSTOM_ROOT)
  })

  it('does not run lint when lintEnabled defaults to false', async () => {
    const ticket = detail({ id: 428, target_menu: '资产核查' })
    const { client } = fakeClient({})
    const lintRunner = vi.fn()
    const agentRunner: AgentRunner = async () => ({ ok: false, summary: 'no fix' })

    await runOneTicket(
      baseConfig({
        client,
        agentRunner,
        runGit: cleanCustomGit(),
        lintEnabled: false,
        lintRunner,
      }),
      ticket,
    )
    expect(lintRunner).not.toHaveBeenCalled()
  })

  it('accepts a preloaded detail for --ticket force path', async () => {
    const ticket = detail({ id: 428, target_menu: '资产核查', status: '转派' })
    const getTicket = vi.fn()
    const { client } = fakeClient({ getTicket })
    const agentRunner: AgentRunner = async () => ({ ok: false, summary: 'force-path-stop' })

    await runOneTicket(baseConfig({ client, agentRunner, runGit: cleanCustomGit() }), ticket)
    expect(getTicket).not.toHaveBeenCalled()
  })
})

describe('runBatch', () => {
  it('processes at most maxTickets candidates after ensureToken', async () => {
    const rows = [
      detail({ id: 1, target_menu: '资产核查', status: '待确认' }),
      detail({ id: 2, target_menu: '资产核查', status: '待确认' }),
    ]
    const { client, order } = fakeClient({
      listTickets: async () => rows,
      getTicket: async id => rows.find(r => r.id === id)!,
    })
    const agentRunner: AgentRunner = async () => ({ ok: false, summary: 'batch-stop' })

    const outcomes = await runBatch(
      baseConfig({ client, agentRunner, runGit: cleanCustomGit() }),
      { maxTickets: 1 },
    )
    expect(outcomes).toHaveLength(1)
    expect(order[0]).toBe('ensureToken')
    expect(order.filter(s => s.startsWith('getTicket:'))).toHaveLength(1)
  })
})
