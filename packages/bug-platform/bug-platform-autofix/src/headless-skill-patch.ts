/**
 * Headless `dsh --patch` overlay that injects global customSkillDirs and a
 * rank-50 personal skill provider. A patch replaces the target row's entire
 * `config` (not a deep merge), so the skill-filesystem entry only writes
 * `customSkillDirs`; other keys stay schemastery defaults.
 *
 * @module @deepseek-ai/dsh-bug-platform-autofix/headless-skill-patch
 */

import { join } from 'node:path'
import { stringify } from 'yaml'

/** Inputs for {@link renderHeadlessSkillPatch}. */
export interface HeadlessSkillPatchInput {
  /** Global clone `skills/` directory for skill-filesystem `customSkillDirs`. */
  globalSkillsDir: string
  /** Operator-scoped personal root (`personalRoot/operatorId`). */
  personalRoot: string
  /** Cordis plugin module path for the personal provider row. */
  personalPluginPath: string
}

/**
 * Render a loader patch list for `dsh --profile headless --patch`.
 * @param input - global dir, personal root, and personal plugin module path.
 * @returns YAML overlay text ending in a newline.
 */
export function renderHeadlessSkillPatch(input: HeadlessSkillPatchInput): string {
  const yaml = stringify([
    {
      id: 'skill-filesystem',
      config: {
        customSkillDirs: [input.globalSkillsDir],
      },
    },
    {
      insert: [
        {
          id: 'autofix-personal-skills',
          name: input.personalPluginPath,
          config: {
            root: input.personalRoot,
          },
        },
      ],
    },
  ])
  return `${yaml.trimEnd()}\n`
}

/**
 * Absolute source-plane path of the personal skill plugin.
 * Headless spawn uses tsx ESM; a `.ts` path loads without a prior `lib/` build
 * of this extra export. Built consumers may import
 * `@deepseek-ai/dsh-bug-platform-autofix/personal-skill-plugin` instead.
 * @param harnessRoot - absolute deepseek-harness repo root.
 * @returns absolute `personal-skill-plugin.ts` path.
 */
export function resolvePersonalSkillPluginPath(harnessRoot: string): string {
  return join(
    harnessRoot,
    'packages/bug-platform/bug-platform-autofix/src/personal-skill-plugin.ts',
  )
}
