/**
 * Menu-mapping loader and target_menu resolver for bug-platform autofix.
 * @module @deepseek-ai/dsh-bug-platform-autofix/menu-mapping
 */

/** One resolved, autofix-eligible menu hit. */
export interface ResolvedMenu {
  /** Exact bug/platform `target_menu` string that matched. */
  targetMenu: string
  /** Product worktree key; only `custom` or `ailpha` are autofix-eligible. */
  repo: 'custom' | 'ailpha'
  /** Product jinan branch bound to {@link ResolvedMenu.repo}. */
  branch: string
  /** Hash route hint from the mapping, or null when absent. */
  routeHint: string | null
  /** Preferred page file path relative to the product worktree, or null. */
  filePath: string | null
  /** Hierarchical menu path used for disambiguation and agent brief. */
  menuPath: string
}

/** Opaque index built by {@link loadMenuMapping}. */
export interface MenuMappingIndex {
  /** All items flattened from `systems.*.items[]`. */
  readonly items: readonly MenuMappingItem[]
}

/** One raw menu-mapping item after structural validation. */
export interface MenuMappingItem {
  targetMenu: string
  menuCode: string
  menuPath: string
  repo: string | null
  branch: string | null
  routeHint: string | null
  filePath: string | null
  fileExists: boolean | null
}

/** Autofix-eligible product repos from the mapping table. */
type FixableRepo = 'custom' | 'ailpha'

/**
 * Parse a `menu-mapping.json` document into an index.
 * @param json - parsed JSON root (must be an object with `systems`).
 * @returns opaque index for {@link resolveMenu}.
 */
export function loadMenuMapping(json: unknown): MenuMappingIndex {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('menu-mapping: root must be a non-array object')
  }
  const root = json as Record<string, unknown>
  const systems = root.systems
  if (systems === null || typeof systems !== 'object' || Array.isArray(systems)) {
    throw new Error('menu-mapping: systems must be a non-array object')
  }

  const items: MenuMappingItem[] = []
  for (const system of Object.values(systems as Record<string, unknown>)) {
    if (system === null || typeof system !== 'object' || Array.isArray(system)) {
      throw new Error('menu-mapping: each systems.* entry must be an object')
    }
    const entry = system as Record<string, unknown>
    const rawItems = entry.items
    if (!Array.isArray(rawItems)) {
      throw new Error('menu-mapping: systems.*.items must be an array')
    }
    for (const raw of rawItems) {
      items.push(parseItem(raw))
    }
  }

  return { items }
}

/**
 * Resolve an exact `target_menu` to an autofix-eligible custom/ailpha hit.
 * Prefers `file_exists === true`, then `custom` over `ailpha`, then stable
 * `menu_path` / `menu_code` order for remaining ties.
 * @param index - index from {@link loadMenuMapping}.
 * @param targetMenu - exact menu name from the bug ticket.
 * @returns resolved menu, or null when unmapped / home / ineligible.
 */
export function resolveMenu(index: MenuMappingIndex, targetMenu: string): ResolvedMenu | null {
  const hits = index.items.filter(item => item.targetMenu === targetMenu)
  const fixable = hits.filter(isFixableCandidate)
  if (fixable.length === 0) {
    return null
  }

  const withFile = fixable.filter(item => item.fileExists === true)
  const pool = withFile.length > 0 ? withFile : fixable
  const custom = pool.filter(item => item.repo === 'custom')
  const preferred = custom.length > 0 ? custom : pool
  const chosen = preferred.slice().sort(compareHits)[0]
  if (chosen === undefined) {
    return null
  }

  return {
    targetMenu: chosen.targetMenu,
    repo: chosen.repo,
    branch: chosen.branch,
    routeHint: chosen.routeHint,
    filePath: chosen.filePath,
    menuPath: chosen.menuPath,
  }
}

/** Candidate that already passed the custom|ailpha filter with a usable branch. */
interface FixableCandidate {
  targetMenu: string
  menuCode: string
  menuPath: string
  repo: FixableRepo
  branch: string
  routeHint: string | null
  filePath: string | null
  fileExists: boolean | null
}

/**
 * @param item - raw mapping item.
 * @returns true when the item is autofix-eligible (custom|ailpha with a branch).
 */
function isFixableCandidate(item: MenuMappingItem): item is MenuMappingItem & FixableCandidate {
  return (item.repo === 'custom' || item.repo === 'ailpha') && typeof item.branch === 'string' && item.branch.length > 0
}

/**
 * Stable tie-break: shorter menu_path first, then menu_code.
 * @param a - left candidate.
 * @param b - right candidate.
 * @returns sort comparator result.
 */
function compareHits(a: FixableCandidate, b: FixableCandidate): number {
  const byPath = a.menuPath.localeCompare(b.menuPath)
  if (byPath !== 0) {
    return byPath
  }
  return a.menuCode.localeCompare(b.menuCode)
}

/**
 * @param raw - one `systems.*.items[]` element.
 * @returns normalized mapping item.
 */
function parseItem(raw: unknown): MenuMappingItem {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('menu-mapping: each items[] entry must be an object')
  }
  const item = raw as Record<string, unknown>
  return {
    targetMenu: requireString(item, 'target_menu'),
    menuCode: optionalString(item.menu_code) ?? '',
    menuPath: optionalString(item.menu_path) ?? '',
    repo: optionalString(item.repo),
    branch: optionalString(item.branch),
    routeHint: optionalString(item.routeHint),
    filePath: optionalString(item.filePath),
    fileExists: optionalBoolean(item.file_exists),
  }
}

/**
 * @param item - mapping item object.
 * @param key - required string field name.
 * @returns non-empty trimmed string value.
 */
function requireString(item: Record<string, unknown>, key: string): string {
  const value = item[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`menu-mapping: items[].${key} must be a non-empty string`)
  }
  return value
}

/**
 * @param value - raw JSON field.
 * @returns string or null (null/undefined/empty → null).
 */
function optionalString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value !== 'string') {
    throw new Error('menu-mapping: expected string or null field')
  }
  return value.length === 0 ? null : value
}

/**
 * @param value - raw `file_exists` field.
 * @returns boolean, or null when absent.
 */
function optionalBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value !== 'boolean') {
    throw new Error('menu-mapping: file_exists must be boolean or null')
  }
  return value
}
