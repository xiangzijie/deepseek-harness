import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadMenuMapping } from '../src/menu-mapping.ts'
import { selectTickets, type SelectableTicket } from '../src/select.ts'
import { TicketStateStore, type TicketRecord } from '../src/ticket-state.ts'

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/menu-mapping-sample.json')
const index = loadMenuMapping(JSON.parse(readFileSync(fixturePath, 'utf8')) as unknown)

function ticket(overrides: Partial<SelectableTicket> & Pick<SelectableTicket, 'id'>): SelectableTicket {
  return {
    assignee_id: null,
    status: '待确认',
    target_menu: '支撑单位',
    ...overrides,
  }
}

function activeRecord(ticketId: number, phase: TicketRecord['phase'] = 'claimed'): TicketRecord {
  return {
    ticketId,
    phase,
    repo: 'custom',
    branch: `bugfix/${ticketId}`,
    updatedAt: '2026-09-09T10:00:00.000Z',
  }
}

describe('selectTickets', () => {
  it('keeps unassigned tickets in default statuses with a resolvable menu', () => {
    const selected = selectTickets(
      [
        ticket({ id: 1, target_menu: '支撑单位' }),
        ticket({ id: 2, target_menu: '流量监测', status: '验证未通过' }),
        ticket({ id: 3, target_menu: '支撑单位', status: '转派' }),
        ticket({ id: 4, target_menu: '支撑单位', status: '转需求' }),
      ],
      index,
      new TicketStateStore(),
    )
    expect(selected.map(t => t.id)).toEqual([1, 2, 3, 4])
  })

  it('drops assigned tickets', () => {
    const selected = selectTickets(
      [ticket({ id: 1, assignee_id: 9 })],
      index,
      new TicketStateStore(),
    )
    expect(selected).toEqual([])
  })

  it('keeps tickets assigned to alsoAssignedTo ids', () => {
    const selected = selectTickets(
      [
        ticket({ id: 1, assignee_id: 68 }),
        ticket({ id: 2, assignee_id: 9 }),
        ticket({ id: 3, assignee_id: null }),
      ],
      index,
      new TicketStateStore(),
      { alsoAssignedTo: [68] },
    )
    expect(selected.map(t => t.id)).toEqual([1, 3])
  })

  it('drops tickets outside the status allow-list', () => {
    const selected = selectTickets(
      [ticket({ id: 1, status: '处理中' })],
      index,
      new TicketStateStore(),
    )
    expect(selected).toEqual([])
  })

  it('honors an explicit status allow-list', () => {
    const selected = selectTickets(
      [ticket({ id: 428, status: '转派', target_menu: '支撑单位' })],
      index,
      new TicketStateStore(),
      { statuses: ['转派'] },
    )
    expect(selected.map(t => t.id)).toEqual([428])
  })

  it('excludes 网络安全数据大屏 and 网络安全指挥大屏 even when mapped', () => {
    const dashIndex = loadMenuMapping({
      systems: {
        dash: {
          items: [
            {
              target_menu: '网络安全数据大屏',
              menu_code: 'Dash',
              menu_path: '大屏/网络安全数据大屏',
              repo: 'custom',
              branch: 'dkh-custom-jinan',
              routeHint: '/dash',
              filePath: 'src/views/dash/index.vue',
              file_exists: true,
            },
            {
              target_menu: '网络安全指挥大屏',
              menu_code: 'CmdDash',
              menu_path: '大屏/网络安全指挥大屏',
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
    const selected = selectTickets(
      [
        ticket({ id: 1, target_menu: '网络安全数据大屏' }),
        ticket({ id: 2, target_menu: '网络安全指挥大屏' }),
      ],
      dashIndex,
      new TicketStateStore(),
    )
    expect(selected).toEqual([])
  })

  it('drops tickets whose target_menu does not resolve', () => {
    const selected = selectTickets(
      [
        ticket({ id: 1, target_menu: '研判分析' }),
        ticket({ id: 2, target_menu: '首页概览' }),
        ticket({ id: 3, target_menu: null }),
      ],
      index,
      new TicketStateStore(),
    )
    expect(selected).toEqual([])
  })

  it('skips tickets that are active or pre-claim skipped in the local state store', () => {
    const store = new TicketStateStore([
      activeRecord(10, 'claimed'),
      activeRecord(11, 'fixing'),
      activeRecord(12, 'awaiting_push'),
      activeRecord(13, 'done'),
      activeRecord(14, 'failed'),
      activeRecord(16, 'skipped'),
    ])
    const selected = selectTickets(
      [
        ticket({ id: 10 }),
        ticket({ id: 11 }),
        ticket({ id: 12 }),
        ticket({ id: 13 }),
        ticket({ id: 14 }),
        ticket({ id: 15 }),
        ticket({ id: 16 }),
      ],
      index,
      store,
    )
    expect(selected.map(t => t.id)).toEqual([13, 14, 15])
  })
})
