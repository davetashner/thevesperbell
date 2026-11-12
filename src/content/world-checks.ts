// Load-time checks of the world connectivity map (mw-e24.1) that need other content: built edges'
// transitions exist and lead where the edge says, route capabilities are declared, time gates name
// clock phases, `classesHint` matches what the class files grant, and a shortcut has an unlock.
// Graph analysis (reachability, loops, critical path) lives in src/tools/world.

import type { ContentCheck, ContentIssue, LoadedEntry } from './loader.ts';
import { capabilityIds } from './types/capability.ts';
import type { ClassDef } from './types/class.ts';
import type { GameConfig } from './types/game.ts';
import type { WorldMap } from './types/world.ts';
import { TRANSITION_REF } from './types/world.ts';
import type { SceneDef } from './types/scene.ts';

/** The classes whose MVP capabilities include any of `routes` (class ids, sorted by the class list). */
export function classesWithRoute(
  classes: readonly { readonly id: string; readonly mvpCapabilities: readonly string[] }[],
  routes: readonly string[],
): string[] {
  return classes
    .filter((c) => routes.some((r) => c.mvpCapabilities.includes(r)))
    .map((c) => c.id)
    .sort();
}

/** The content check for the world map. */
export const checkWorld: ContentCheck = (entries: readonly LoadedEntry[]) => {
  const scenes = new Map<string, SceneDef>();
  const classes: ClassDef[] = [];
  const phases = new Set<string>();
  for (const { type, value } of entries) {
    if (type === 'scene') scenes.set(value.id, value as SceneDef);
    if (type === 'class') classes.push(value as ClassDef);
    if (type === 'game') {
      for (const p of (value as GameConfig).clock.phases) phases.add(p.id);
    }
  }
  const capabilities = capabilityIds(entries);
  const issues: ContentIssue[] = [];
  for (const { type, file, value } of entries) {
    if (type !== 'world') continue;
    const world = value as WorldMap;
    const nodes = new Map(world.nodes.map((n) => [n.id, n]));
    world.edges.forEach((edge, i) => {
      const at = (field: string): string => `/edges/${String(i)}/${field}`;
      const problem = (pointer: string, message: string): void => {
        issues.push({ file, pointer, message: `edge "${edge.id}" ${message}` });
      };
      edge.routes.forEach((id, r) => {
        if (!capabilities.has(id)) {
          problem(`${at('routes')}/${String(r)}`, `names unknown capability "${id}"`);
        }
      });
      edge.time?.forEach((id, t) => {
        if (!phases.has(id)) {
          problem(`${at('time')}/${String(t)}`, `names unknown clock phase "${id}"`);
        }
      });
      const expected = classesWithRoute(classes, edge.routes);
      const actual = [...edge.classesHint].sort();
      if (expected.join() !== actual.join()) {
        problem(
          at('classesHint'),
          `lists classes [${actual.join(', ')}] but the class files grant a route to [${expected.join(', ')}]`,
        );
      }
      if (edge.kind === 'shortcut' && edge.unlock === undefined) {
        problem(at('unlock'), 'is a shortcut and needs an unlock condition');
      }
      const ends = [nodes.get(edge.from), nodes.get(edge.to)];
      edge.transitions.forEach((t, k) => {
        const [, sceneId = '', transitionId = ''] = TRANSITION_REF.exec(t) ?? [];
        const transition = scenes.get(sceneId)?.transitions.find((x) => x.id === transitionId);
        const pointer = `${at('transitions')}/${String(k)}`;
        if (transition === undefined) {
          problem(pointer, `names transition "${t}", which no scene has`);
          return;
        }
        const target = transition.scene.id;
        const joins =
          ends.some((n) => n?.scene?.id === sceneId) && ends.some((n) => n?.scene?.id === target);
        if (!joins) {
          problem(
            pointer,
            `transition "${t}" leads scene "${sceneId}" to "${target}", but the edge joins "${edge.from}" and "${edge.to}" whose scenes are ${ends.map((n) => n?.scene?.id ?? 'unbuilt').join(' and ')}`,
          );
        }
      });
    });
  }
  return issues;
};
