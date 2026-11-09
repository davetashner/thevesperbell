// Load-time checks of fact-gated spawns and variant groups (mw-e27.8).
//
// Errors (`checkVariants`, part of every content load): a spawn with `spawnIf`, `despawnIf` or
// `variant` can come and go while its scene is loaded, which the game supports for props (with or
// without a physics body) and markers, interactions, breakables and creatures. A gate on a spawn of
// any other kind (a door, a container…) would leave half of it behind, so it is rejected, naming the
// feature.
//
// Warnings (`variantWarnings`, printed by `pnpm content:coverage`): a variant group in which no variant
// is the default (has no `when`) spawns nothing while none of its conditions holds; the warning lists
// that uncovered case. It is a warning because "nothing" is sometimes the design.

import type { ContentCheck, ContentIssue, Frozen } from './loader.ts';
import type { SceneDef } from './types/scene.ts';

/** Spawn fields a gated spawn cannot have (they are only set up when the scene loads). */
const LOAD_ONLY_FIELDS = [
  'item',
  'recovery',
  'questCritical',
  'targetable',
  'carries',
  'repopulate',
  'presence',
  'door',
  'switch',
  'plate',
  'rope',
  'bridge',
  'suspendedFrom',
  'lightSource',
  'impactSwitch',
  'beamEmitter',
  'optic',
  'lightReceiver',
  'container',
  'bulky',
  'hiding',
] as const;

type SpawnDef = SceneDef['spawns'][number];

const isGated = (spawn: Frozen<SpawnDef>): boolean =>
  spawn.spawnIf !== undefined || spawn.despawnIf !== undefined || spawn.variant !== undefined;

/** The content check for gated spawns: only kinds that can be added and removed live. */
export const checkVariants: ContentCheck = (entries) => {
  const issues: ContentIssue[] = [];
  for (const { type, file, value } of entries) {
    if (type !== 'scene') continue;
    const scene = value as Frozen<SceneDef>;
    scene.spawns.forEach((spawn, index) => {
      if (!isGated(spawn)) return;
      const unsupported: string[] = LOAD_ONLY_FIELDS.filter((field) => spawn[field] !== undefined);
      for (const what of unsupported) {
        issues.push({
          file,
          pointer: `/spawns/${String(index)}`,
          message: `scene:${scene.id} spawn "${spawn.id}" has a spawn/despawn gate but also ${what}, which is only set up when the scene loads`,
        });
      }
    });
  }
  return issues;
};

/** The condition as text for a warning. */
const text = (condition: unknown): string => JSON.stringify(condition);

/** Warnings about variant groups that leave a case uncovered, one line each (AC-3). */
export function variantWarnings(scenes: Iterable<Frozen<SceneDef>>): string[] {
  const warnings: string[] = [];
  for (const scene of scenes) {
    const groups = new Map<string, Frozen<SpawnDef>[]>();
    for (const spawn of scene.spawns) {
      if (spawn.variant === undefined) continue;
      const members = groups.get(spawn.variant.group) ?? [];
      members.push(spawn);
      groups.set(spawn.variant.group, members);
    }
    for (const [group, members] of groups) {
      if (members.some((spawn) => spawn.variant?.when === undefined)) continue;
      const conditions = members.map((spawn) => text(spawn.variant?.when)).join(' | ');
      warnings.push(
        `scene:${scene.id} variant group "${group}" has no default variant: nothing spawns when none of its conditions holds (uncovered: not any of ${conditions})`,
      );
    }
  }
  return warnings;
}
