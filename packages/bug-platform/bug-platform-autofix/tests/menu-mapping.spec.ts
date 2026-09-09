import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadMenuMapping, resolveMenu } from '../src/menu-mapping.ts'

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/menu-mapping-sample.json')
const sampleJson = JSON.parse(readFileSync(fixturePath, 'utf8')) as unknown

describe('loadMenuMapping / resolveMenu', () => {
  const index = loadMenuMapping(sampleJson)

  it('resolves 支撑单位 to custom with filePath and branch', () => {
    expect(resolveMenu(index, '支撑单位')).toEqual({
      targetMenu: '支撑单位',
      repo: 'custom',
      branch: 'dkh-custom-jinan',
      routeHint: '/networkSecurity/technicalUnitJinan',
      filePath: 'src/views/networkSecurityIndustry/index.vue',
      menuPath: '产业数据/支撑单位',
    })
  })

  it('resolves an ailpha-only menu', () => {
    expect(resolveMenu(index, '流量监测')).toEqual({
      targetMenu: '流量监测',
      repo: 'ailpha',
      branch: 'dkh-ailpha-jinan',
      routeHint: '/analysis/threat',
      filePath: 'src/views/analysis/threat/index.vue',
      menuPath: '研判分析/流量监测',
    })
  })

  it('returns null for unknown target_menu', () => {
    expect(resolveMenu(index, 'unknown')).toBeNull()
  })

  it('returns null when repo is null (unmapped)', () => {
    expect(resolveMenu(index, '研判分析')).toBeNull()
  })

  it('returns null when repo is home', () => {
    expect(resolveMenu(index, '首页概览')).toBeNull()
  })

  it('prefers custom over ailpha when both match the same target_menu', () => {
    const resolved = resolveMenu(index, '双仓菜单')
    expect(resolved).not.toBeNull()
    expect(resolved?.repo).toBe('custom')
    expect(resolved?.filePath).toBe('src/views/dual/custom.vue')
    expect(resolved?.branch).toBe('dkh-custom-jinan')
  })

  it('prefers file_exists===true over missing-file custom when choosing among hits', () => {
    const resolved = resolveMenu(index, '仅无文件标记')
    expect(resolved).toEqual({
      targetMenu: '仅无文件标记',
      repo: 'ailpha',
      branch: 'dkh-ailpha-jinan',
      routeHint: '/missing-ailpha',
      filePath: 'src/views/missing/ailpha.vue',
      menuPath: '研判分析/仅无文件标记',
    })
  })

  it('rejects non-object mapping roots', () => {
    expect(() => loadMenuMapping(null)).toThrow(/menu-mapping/)
    expect(() => loadMenuMapping([])).toThrow(/menu-mapping/)
  })
})
