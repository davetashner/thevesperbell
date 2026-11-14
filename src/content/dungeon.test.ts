// mw-e26.1: the dungeon network. The data is docs/design/dungeon.json and the page is
// docs/design/dungeon.md; these tests prove the plan against the real connectivity map, the puzzle
// and fact registries, the class files and the route matrix, so an area that is not on the map, a
// puzzle key that does not exist or an ending fact nobody registered fails here.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import type { CapabilityGroup } from '@content/types/capability';

type Value = string | boolean | string[];
interface Cond {
  fact: string;
  value: Value;
}
interface Dungeon {
  areas: { id: string; region: string; tier: string; intensity: string }[];
  puzzles: { name: string; key: string; scene: string; area: string; tier: string }[];
  macroRoutes: {
    id: string;
    entry: string | null;
    gate: string | null;
    classes: string[];
    status: string;
    nodes: string[];
  }[];
  classRoutes: Record<string, { route: string; capabilities: string[] }[]>;
  criticalPath: { area: string; intensity: string }[];
  shortcuts: { edge: string }[];
  respawn: { id: string; region: string; destination: string; when: Cond[] }[];
  facts: { key: string; status: string; alias?: string }[];
  endings: {
    id: string;
    title: string;
    match: string;
    decides: Cond[];
    modifiers: Cond[];
    levelVariants: { area: string; change: string; when: Cond[] }[];
  }[];
  epilogueOnly: { fact: string }[];
  setPieces: { id: string; area: string }[];
}
interface Matrix {
  mineEntries: { id: string }[];
  obstacles: { id: string; node: string; routes: { how: string }[] }[];
}

const dungeon = JSON.parse(readFileSync('docs/design/dungeon.json', 'utf8')) as Dungeon;
const matrix = JSON.parse(readFileSync('docs/design/route-matrix.json', 'utf8')) as Matrix;
const doc = readFileSync('docs/design/dungeon.md', 'utf8');
const content = loadGameContent();
const maybeWorld = content.all('world')[0];
if (maybeWorld === undefined) throw new Error('connectivity map missing');
const world = maybeWorld;
const nodeIds = new Set(world.nodes.map((n) => n.id));
const facts = new Map(content.all('fact').flatMap((g) => g.facts.map((f) => [f.key, f] as const)));
const registry = new Map(
  (content.all('capability') as CapabilityGroup[]).flatMap((g) =>
    g.capabilities.map((c) => [c.id, c] as const),
  ),
);

type Edge = (typeof world.edges)[number];
/** The edge that lets you step a -> b, or undefined (one-way edges only run from -> to). */
const step = (a: string, b: string): Edge | undefined =>
  world.edges.find(
    (e) => (e.from === a && e.to === b) || (e.from === b && e.to === a && e.kind !== 'one-way'),
  );

/** Nodes reachable from `start` over every edge not in `banned`. */
function reach(start: string, banned: ReadonlySet<string> = new Set()): Set<string> {
  const seen = new Set([start]);
  const queue = [start];
  for (let at = queue.shift(); at !== undefined; at = queue.shift()) {
    for (const e of world.edges) {
      if (banned.has(e.id)) continue;
      const next = e.from === at ? e.to : e.to === at && e.kind !== 'one-way' ? e.from : undefined;
      if (next === undefined || seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

/** The edge ids a node walk uses. */
function edgesOf(nodes: string[]): string[] {
  return nodes.slice(1).map((n, i) => {
    const e = step(nodes[i] ?? '', n);
    expect(e, `no edge ${nodes[i] ?? ''} -> ${n}`).toBeDefined();
    return e?.id ?? '';
  });
}

const routeEdges = new Map(dungeon.macroRoutes.map((r) => [r.id, edgesOf(r.nodes)] as const));

describe('docs/design/dungeon.json', () => {
  it('AC-1: places each of the six puzzles in a named area with its real puzzle key', () => {
    expect(dungeon.puzzles.map((p) => p.name).sort()).toEqual(
      ['Chimes', 'Dark Crossing', 'Frozen Channel', 'Scales', 'Sunbeam', 'Watchers'].sort(),
    );
    expect(Object.fromEntries(dungeon.puzzles.map((p) => [p.name, p.area]))).toEqual({
      Sunbeam: 'priory-crypt-stair',
      'Frozen Channel': 'lower-deepworks',
      Scales: 'knot-outer-ring',
      Watchers: 'priory-choir',
      'Dark Crossing': 'ossuary-galleries',
      Chimes: 'chapel-of-echoes',
    });
    for (const p of dungeon.puzzles) {
      const def = content.all('puzzle').find((x) => x.id === p.key);
      expect(def, `puzzle ${p.key}`).toBeDefined();
      expect(def?.scene.id, `${p.key} scene`).toBe(p.scene);
      expect(
        content.all('scene').some((s) => s.id === p.scene),
        `scene ${p.scene}`,
      ).toBe(true);
      expect(nodeIds.has(p.area), `area ${p.area}`).toBe(true);
      expect(doc, p.key).toContain(`\`${p.key}\``);
    }
  });

  it('AC-1: the critical puzzles sit where the route matrix puts their obstacle', () => {
    const critical = dungeon.puzzles.filter((p) => p.tier === 'critical');
    expect(critical.map((p) => p.key).sort()).toEqual(['chimes', 'dark-crossing', 'scales-room']);
    for (const p of critical) {
      const o = matrix.obstacles.find((x) => x.routes.some((r) => r.how.includes(p.key)));
      expect(o?.node, `${p.key} obstacle`).toBe(p.area);
    }
  });

  it('AC-2: every area of the Deepworks, priory and Knot is on the map and reachable', () => {
    const reached = reach(world.townSpawn);
    const planned = new Set(dungeon.areas.map((a) => a.id));
    expect(planned.size).toBe(dungeon.areas.length);
    for (const n of world.nodes.filter((x) => ['deepworks', 'priory', 'knot'].includes(x.area))) {
      expect(planned, `${n.id} is in the dungeon plan`).toContain(n.id);
    }
    for (const a of dungeon.areas) {
      expect(nodeIds.has(a.id), a.id).toBe(true);
      expect(reached, `${a.id} reachable from ${world.townSpawn}`).toContain(a.id);
      expect(['critical', 'optional', 'approach']).toContain(a.tier);
      expect(doc, a.id).toContain(`\`${a.id}\``);
    }
    const critical = dungeon.areas.filter((a) => a.tier === 'critical').map((a) => a.id);
    expect(critical.sort()).toEqual(
      world.mainQuest.filter((id) => dungeon.areas.some((a) => a.id === id)).sort(),
    );
  });

  it('AC-2: the Cradle is reached by at least two edge-disjoint macro-routes', () => {
    const open = dungeon.macroRoutes.filter((r) => r.gate === null);
    for (const r of dungeon.macroRoutes) {
      expect(r.nodes[0], r.id).toBe(world.townSpawn);
      expect(r.nodes.at(-1), r.id).toBe('the-cradle');
      expect(doc, r.id).toContain(`\`${r.id}\``);
      expect(r.nodes.every((n) => nodeIds.has(n))).toBe(true);
      if (r.gate !== null) {
        const gated = (routeEdges.get(r.id) ?? []).map((id) =>
          world.edges.find((e) => e.id === id),
        );
        expect(
          gated.some((e) => JSON.stringify(e?.unlock ?? null).includes(r.gate ?? '')),
          `${r.id} gate`,
        ).toBe(true);
      }
    }
    const pairs = open.flatMap((a, i) =>
      open.slice(i + 1).map((b) => {
        const used = new Set(routeEdges.get(a.id));
        return (routeEdges.get(b.id) ?? []).every((e) => !used.has(e));
      }),
    );
    expect(open.length).toBeGreaterThanOrEqual(2);
    expect(pairs.some(Boolean), 'two routes share no edge').toBe(true);
    // The map agrees: cut every edge of the front-gate route and the Cradle is still reachable.
    expect(reach(world.townSpawn, new Set(routeEdges.get('front-gate'))).has('the-cradle')).toBe(
      true,
    );
  });

  it('AC-2: the mine entries and the class routes line up with the route matrix', () => {
    const entries = new Set(matrix.mineEntries.map((e) => e.id));
    for (const r of dungeon.macroRoutes) {
      if (r.entry !== null && ['front-gate', 'supply-tunnel', 'weeping-adit'].includes(r.id))
        expect(entries, r.id).toContain(r.entry);
    }
    for (const cls of ['knight', 'archer', 'sorcerer', 'thief']) {
      const routes = dungeon.classRoutes[cls] ?? [];
      expect(routes.length, cls).toBeGreaterThanOrEqual(3);
      const file = content.all('class').find((c) => c.id === cls);
      for (const r of routes) {
        expect(
          dungeon.macroRoutes
            .find((m) => m.id === r.route)
            ?.classes.some((c) => c === 'any' || c === cls),
          `${cls} may take ${r.route}`,
        ).toBe(true);
        for (const id of r.capabilities) {
          const cap = registry.get(id);
          expect(cap, id).toBeDefined();
          expect(
            file?.mvpCapabilities.includes(id) === true || cap?.classAffinity === cls,
            `${cls} holds ${id}`,
          ).toBe(true);
        }
      }
    }
  });

  it('AC-2: every listed shortcut is a real edge', () => {
    for (const s of dungeon.shortcuts) {
      expect(
        world.edges.some((e) => e.id === s.edge),
        s.edge,
      ).toBe(true);
      expect(doc, s.edge).toContain(`\`${s.edge}\``);
    }
  });

  it('AC-3: each ending lists the world facts and the level variants it changes', () => {
    expect(dungeon.endings.map((e) => e.title)).toEqual([
      'Vespers Rung',
      'The Last Warden',
      "The Hireling's Silence",
      'The Long Vespers',
    ]);
    const known = new Map(dungeon.facts.map((f) => [f.key, f] as const));
    const check = (c: Cond, at: string): void => {
      const f = known.get(c.fact);
      expect(f, `${at}: ${c.fact} is not in the facts list`).toBeDefined();
      const reg = facts.get(c.fact);
      if (f?.status === 'registered') {
        expect(reg, `${at}: ${c.fact} is not a registered fact`).toBeDefined();
        const values = reg?.type === 'enum' ? reg.values : [true, false];
        for (const v of Array.isArray(c.value) ? c.value : [c.value])
          expect(values, `${at}: ${c.fact}=${String(v)}`).toContain(v);
      }
    };
    for (const e of dungeon.endings) {
      expect(doc, e.title).toContain(e.title);
      expect(['all', 'any']).toContain(e.match);
      expect(e.decides.length, `${e.id} decides`).toBeGreaterThanOrEqual(2);
      expect(e.levelVariants.length, `${e.id} variants`).toBeGreaterThanOrEqual(3);
      for (const c of [...e.decides, ...e.modifiers]) check(c, e.id);
      for (const v of e.levelVariants) {
        expect(nodeIds.has(v.area), `${e.id} area ${v.area}`).toBe(true);
        expect(v.change.length).toBeGreaterThan(10);
        for (const c of v.when) check(c, `${e.id}/${v.area}`);
      }
    }
  });

  it('AC-3: the facts the main quest names are all in the table, harbour facts only add slides', () => {
    const keys = dungeon.facts.map((f) => f.key);
    for (const k of [
      'horn.fate',
      'abbot.fate',
      'vane.fate',
      'knot.breach-sealed',
      'tansy.saved',
      'clatter.restored',
      'goblins.standing',
      'wendmouth.visited',
      'crate.intercepted',
      'tern.sailed',
      'bell-tongue.destroyed',
    ])
      expect(keys, k).toContain(k);
    expect(dungeon.facts.find((f) => f.key === 'knot.breach-sealed')?.alias).toBe('breach.sealed');
    const harbour = dungeon.epilogueOnly.map((e) => e.fact);
    expect(harbour.sort()).toEqual(['crate.intercepted', 'tern.sailed', 'wendmouth.visited']);
    for (const e of dungeon.endings)
      for (const c of e.decides)
        expect(harbour, `${e.id} decided by ${c.fact}`).not.toContain(c.fact);
    for (const f of dungeon.facts) expect(doc, f.key).toContain(`\`${f.key}\``);
  });

  it('AC-4: no two combat-heavy areas on the critical path without a quiet area between', () => {
    const path = dungeon.criticalPath;
    const intensity = new Map(dungeon.areas.map((a) => [a.id, a.intensity]));
    expect(path.length).toBeGreaterThanOrEqual(10);
    expect(path.some((p) => p.intensity === 'heavy')).toBe(true);
    path.slice(1).forEach((p, i) => {
      const prev = path[i]?.area ?? '';
      expect(step(prev, p.area), `${prev} -> ${p.area} are adjacent`).toBeDefined();
    });
    for (const p of path) {
      expect(['quiet', 'light', 'heavy']).toContain(p.intensity);
      // The chart may soften an area on a revisit, but never rate a first visit differently.
      if (path.findIndex((q) => q.area === p.area) === path.indexOf(p))
        expect(p.intensity, p.area).toBe(intensity.get(p.area));
    }
    let sinceHeavy: string | undefined;
    let quietSince = true;
    for (const p of path) {
      if (p.intensity === 'quiet') quietSince = true;
      if (p.intensity !== 'heavy') continue;
      if (sinceHeavy !== undefined) expect(quietSince, `${sinceHeavy} .. ${p.area}`).toBe(true);
      sinceHeavy = p.area;
      quietSince = false;
    }
    for (const id of world.mainQuest.filter((n) => intensity.has(n)))
      expect(
        path.map((p) => p.area),
        id,
      ).toContain(id);
  });

  it('AC-5: the Fold respawn rules cover every Knot, Deepworks and priory death', () => {
    const regions = new Set(dungeon.respawn.map((r) => r.region));
    for (const r of ['knot', 'deepworks', 'priory']) expect(regions, r).toContain(r);
    for (const r of dungeon.respawn) {
      expect(nodeIds.has(r.destination), r.id).toBe(true);
      for (const c of r.when) expect(facts.has(c.fact), `${r.id}: ${c.fact}`).toBe(true);
    }
    expect(dungeon.respawn.find((r) => r.id === 'knot-horn-alive')?.destination).toBe('the-fold');
    const fold = world.edges.filter((e) => e.from === 'the-fold' || e.to === 'the-fold');
    expect(fold.map((e) => e.id)).toEqual(['horns-hall-fold']);
  });

  it('lists the five set pieces in named areas', () => {
    expect(dungeon.setPieces.map((s) => s.id).sort()).toEqual(
      ['climb', 'cradle', 'horns-hall', 'sour-bell', 'vespers'].sort(),
    );
    for (const s of dungeon.setPieces) expect(nodeIds.has(s.area), s.id).toBe(true);
  });
});
