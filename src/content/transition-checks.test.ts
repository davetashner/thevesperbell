// mw-e01.11: area transitions as scene data. AC-3 (a transition naming a missing spawn fails content
// validation, naming the scene and the spawn) and the shape of the world the shipped scenes make: every
// scene of the walkable chain is reachable from the first and back, every way is two-way, and nobody
// arrives standing in a way out.

import { describe, expect, it } from 'vitest';
import { checkSceneTransitions } from './transition-checks.ts';
import { gameContentSources } from './game-content.ts';
import { loadGameContent } from './game-content.ts';
import { ContentLoadError, loadContent, type ContentSource } from './loader.ts';
import { contentChecks, contentTypes } from './registry.ts';
import type { SceneDef } from './types/scene.ts';

/** Every problem loading the game content with `edit` applied to the scene file `path`. */
function issuesWith(path: string, edit: (scene: Record<string, unknown>) => void): string[] {
  const sources: ContentSource[] = gameContentSources().map((source) => {
    if (!source.path.endsWith(path)) return source;
    const json = JSON.parse(source.text) as Record<string, unknown>;
    edit(json);
    return { ...source, text: JSON.stringify(json) };
  });
  try {
    loadContent(contentTypes, sources, contentChecks);
  } catch (error) {
    if (!(error instanceof ContentLoadError)) throw error;
    return error.issues.map((i) => `${i.file}#${i.pointer}: ${i.message}`);
  }
  return [];
}

const transitionAt = (scene: Record<string, unknown>, index: number): Record<string, unknown> => {
  const found = (scene['transitions'] as Record<string, unknown>[])[index];
  if (found === undefined) throw new Error(`no transition ${String(index)}`);
  return found;
};
const firstTransition = (scene: Record<string, unknown>) => transitionAt(scene, 0);

describe('transition validation (mw-e01.11)', () => {
  it('AC-3: a transition to a spawn the target scene lacks fails, naming both scenes and the spawn', () => {
    const issues = issuesWith('scene/valley-01.json', (scene) => {
      firstTransition(scene)['spawn'] = 'arrive-from-nowhere';
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('/transitions/0/spawn');
    expect(issues[0]).toContain(
      'scene:valley-01 transition "north-gate" arrives at spawn "arrive-from-nowhere", which scene "valley-02"',
    );
  });

  it('AC-3: a transition to a scene that does not exist fails, naming the scene and the missing one', () => {
    const issues = issuesWith('scene/valley-01.json', (scene) => {
      firstTransition(scene)['scene'] = 'atlantis';
    });
    expect(issues.join('\n')).toMatch(/scene:valley-01 references missing .*atlantis/);
  });

  it('rejects an arrival spawn that lies inside a way out of its scene', () => {
    const issues = issuesWith('scene/valley-02.json', (scene) => {
      const spawns = scene['spawns'] as Record<string, unknown>[];
      const arrival = spawns.find((s) => s['id'] === 'arrive-from-valley-01');
      if (arrival !== undefined) arrival['at'] = [0, 0, 1];
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain(
      'arrives at spawn "arrive-from-valley-01" of scene "valley-02", which lies inside that scene\'s transition "south-gate"',
    );
  });

  it('rejects two transitions with one id and a transition back into its own scene', () => {
    const issues = issuesWith('scene/valley-02.json', (scene) => {
      transitionAt(scene, 1)['id'] = 'south-gate';
      transitionAt(scene, 0)['scene'] = 'valley-02';
    });
    expect(issues.join('\n')).toContain('transition id "south-gate" is used twice');
    expect(issues.join('\n')).toContain('leads back into its own scene');
  });
});

describe('checkSceneTransitions on its own (mw-e01.11)', () => {
  it('leaves a transition to a scene that is not there to the loader', () => {
    const scene = loadGameContent().get('scene', 'valley-01');
    expect(
      checkSceneTransitions([{ type: 'scene', file: 'valley-01.json', value: scene }]),
    ).toEqual([]);
  });
});

describe('the walkable world (mw-e01.11)', () => {
  const content = loadGameContent();
  const scenes = content.all('scene') as readonly SceneDef[];
  const byId = new Map(scenes.map((scene) => [scene.id, scene]));
  const edges = scenes.flatMap((scene) =>
    scene.transitions.map((t) => ({ from: scene.id, to: t.scene.id })),
  );
  /** The walkable chain: where the player can go on foot starting from the valley. */
  const START = 'valley-01';
  const reach = (from: string, edgesOf: (id: string) => string[]): Set<string> => {
    const seen = new Set([from]);
    const queue = [from];
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      for (const next of edgesOf(id)) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return seen;
  };
  const out = (id: string) => edges.filter((e) => e.from === id).map((e) => e.to);
  const into = (id: string) => edges.filter((e) => e.to === id).map((e) => e.from);

  /** Ways with no way back yet (none: the lane's inn door, mw-ju8.22, closed the last one). */
  const ONE_WAY = new Set<string>();

  it('every scene of the chain is reachable from valley-01 and valley-01 from each of them', () => {
    const chain = [
      'slice',
      'valley-01',
      'valley-02',
      'valley-03',
      'briar-glen-lane',
      'briar-glen-green',
      'briarwood',
      'moorings-watch',
      'bellwater-priory',
      'deepworks',
      'knot-outer',
      'marsh-store',
      'sleeping-ox',
      'under-the-bridge',
      'wendmouth-harbour',
    ];
    const forward = reach(START, out);
    const back = reach(START, into);
    for (const id of chain) {
      expect(forward.has(id), `${id} is reachable from ${START}`).toBe(true);
      expect(back.has(id), `${START} is reachable from ${id}`).toBe(true);
    }
  });

  it('every way is two-way, except the ones listed as pending', () => {
    const oneWay = edges
      .filter((e) => !edges.some((r) => r.from === e.to && r.to === e.from))
      .map((e) => `${e.from}>${e.to}`);
    expect(oneWay.sort()).toEqual([...ONE_WAY].sort());
  });

  it('every transition arrives at a marker spawn named arrive-from-<its scene>, 1.5 m or more from any way out', () => {
    for (const scene of scenes) {
      for (const t of scene.transitions) {
        const target = byId.get(t.scene.id);
        expect(target, `${scene.id}/${t.id} leads to a scene`).toBeDefined();
        expect(t.spawn).toBe(`arrive-from-${scene.id}`);
        const arrival = target?.spawns.find((s) => s.id === t.spawn);
        expect(arrival, `${t.scene.id} places ${t.spawn}`).toBeDefined();
        expect(arrival?.prop).toBeUndefined();
        for (const other of target?.transitions ?? []) {
          const [x = 0, , z = 0] = arrival?.at ?? [];
          const dx = Math.max(other.min[0] - x, 0, x - other.max[0]);
          const dz = Math.max(other.min[2] - z, 0, z - other.max[2]);
          expect(Math.hypot(dx, dz)).toBeGreaterThanOrEqual(1.5);
        }
      }
    }
  });

  it('no scene still tags a marker area-exit: transitions are the one convention', () => {
    for (const scene of scenes) {
      for (const spawn of scene.spawns) {
        expect(spawn.tags.filter((tag) => tag === 'area-exit' || tag.startsWith('scene:'))).toEqual(
          [],
        );
      }
    }
  });
});
