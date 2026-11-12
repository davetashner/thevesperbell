/* eslint-disable @typescript-eslint/no-non-null-assertion -- fixtures index content known to exist */
import { describe, expect, it } from 'vitest';
import { loadGameContent, worldSchema, type WorldMapInput } from '@content/index';
import { describeContent } from '@content/testing';
import {
  BASE_CLASSES,
  REQUIRED_LOOPS,
  buildEnv,
  conditionFacts,
  isCycle,
  isProduced,
  producedFacts,
  reachable,
  shortestPath,
  validateWorld,
  type WorldEnv,
} from './validate';

const content = loadGameContent();
const env = buildEnv(content);

type EdgeInput = WorldMapInput['edges'][number];
const node = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  area: 'town' as const,
  epic: 'e24' as const,
  notes: 'n',
  ...extra,
});
const edge = (id: string, from: string, to: string, extra: Partial<EdgeInput> = {}): EdgeInput => ({
  id,
  from,
  to,
  kind: 'path',
  notes: 'n',
  bead: 'mw-e24.2',
  ...extra,
});
const fixture = (over: Partial<WorldMapInput> = {}) =>
  worldSchema.parse({
    id: 'connectivity',
    name: 'fixture',
    notes: 'n',
    townSpawn: 'a',
    mainQuest: ['a', 'c'],
    nodes: [node('a'), node('b'), node('c'), node('w', { area: 'wendmouth', optional: true })],
    edges: [edge('ab', 'a', 'b'), edge('bc', 'b', 'c'), edge('cw', 'c', 'w')],
    ...over,
  });
const CAP = { id: 'x', mvpCapabilities: [] as string[] };
const envOf = (caps: Record<string, string[]>, produced: string[] = []): WorldEnv => ({
  classes: BASE_CLASSES.map((id) => ({ id, mvpCapabilities: caps[id] ?? CAP.mvpCapabilities })),
  produced: new Set(produced),
});

describe('the shipped world map', () => {
  const [world] = content.all('world');
  const report = validateWorld(world!, env, content);

  it('AC-1: has no validation errors, so every node is reachable from the town spawn', () => {
    expect(report.errors).toEqual([]);
    const reached = reachable(world!, world!.townSpawn, (e) =>
      BASE_CLASSES.every((id) => {
        const caps = env.classes.find((c) => c.id === id)!.mvpCapabilities;
        return e.routes.length === 0 || e.routes.some((r) => caps.includes(r));
      }),
    );
    expect(reached.size).toBe(world!.nodes.length);
  });

  it('AC-3: contains every loop of bible 3.1, each a single cycle', () => {
    expect(world!.loops.map((l) => l.id).sort()).toEqual([...REQUIRED_LOOPS].sort());
    for (const loop of world!.loops) expect(isCycle(world!, loop.edges)).toBe(true);
  });

  it('AC-3: links the quay, Kestrel Lock and Wendmouth by towpath and barge', () => {
    const ids = new Map(world!.edges.map((e) => [e.id, e]));
    expect(ids.get('barge-quay-lock')?.travel).toBe('barge');
    expect(ids.get('barge-lock-wharf')?.travel).toBe('barge');
    expect(ids.get('towpath-lock-wharf')?.travel).toBe('foot');
    expect(ids.get('towpath-lock-wharf')?.unlock).toBeUndefined();
  });

  it('AC-3: gives every class an ability-gated shortcut', () => {
    for (const id of BASE_CLASSES) {
      expect(
        world!.edges.some(
          (e) => e.kind !== 'path' && e.classesHint.includes(id) && e.routes.length > 0,
        ),
      ).toBe(true);
    }
  });

  it('AC-5: the critical path avoids Wendmouth, optional nodes and barge edges', () => {
    const optional = new Set(world!.nodes.filter((n) => n.optional).map((n) => n.id));
    expect(report.criticalPath.length).toBeGreaterThan(world!.mainQuest.length);
    for (const id of report.criticalPath) expect(optional.has(id)).toBe(false);
    expect(
      world!.nodes.filter((n) => n.area === 'wendmouth').every((n) => optional.has(n.id)),
    ).toBe(true);
  });

  it('AC-2: every shortcut has an unlock; unproduced facts are warnings, not errors', () => {
    for (const e of world!.edges.filter((x) => x.kind === 'shortcut'))
      expect(e.unlock).toBeDefined();
    expect(report.warnings.some((w) => w.startsWith('AC-2'))).toBe(true);
  });

  it('records which nodes and edges are built', () => {
    expect(report.built.nodes).toBeGreaterThanOrEqual(10);
    expect(report.built.edges).toBeGreaterThanOrEqual(7);
    expect(report.planned.edges).toBe(world!.edges.length - report.built.edges);
    expect(report.warnings.filter((w) => w.includes('names no bead'))).toEqual([]);
  });
});

describeContent(
  'world',
  'AC-1: the map loads, its built edges exist and class hints match',
  (entry) => {
    expect(entry.id).toBe('connectivity');
    expect(entry.edges.length).toBeGreaterThan(0);
  },
);

describe('AC-1: reachability', () => {
  it('passes a connected map', () => {
    expect(validateWorld(fixture(), envOf({})).errors.filter((e) => /^AC-[15]/.test(e))).toEqual(
      [],
    );
  });

  it('fails naming a node only a class-gated edge reaches', () => {
    const world = fixture({
      edges: [
        edge('ab', 'a', 'b'),
        edge('bc', 'b', 'c', { routes: ['arrow.rope'], classesHint: ['archer'] }),
        edge('cw', 'c', 'w'),
      ],
    });
    const errors = validateWorld(world, envOf({ archer: ['arrow.rope'] })).errors;
    expect(errors.some((e) => e.startsWith('AC-1') && e.includes('"c"'))).toBe(true);
  });

  it('opens an edge when every class has one of its routes', () => {
    const world = fixture({
      edges: [
        edge('ab', 'a', 'b'),
        edge('bc', 'b', 'c', { routes: ['verb.climb.ledge'] }),
        edge('cw', 'c', 'w'),
      ],
    });
    const all = envOf(Object.fromEntries(BASE_CLASSES.map((id) => [id, ['verb.climb.ledge']])));
    expect(validateWorld(world, all).errors.filter((e) => e.startsWith('AC-1'))).toEqual([]);
  });

  it('only walks a one-way edge from to to', () => {
    const world = fixture({
      edges: [
        edge('ab', 'a', 'b'),
        edge('cb', 'c', 'b', { kind: 'one-way' }),
        edge('cw', 'c', 'w'),
      ],
    });
    expect(reachable(world, 'a', () => true).has('c')).toBe(false);
    expect(reachable(world, 'c', () => true).has('b')).toBe(true);
    expect(
      shortestPath(
        world,
        'a',
        'c',
        () => true,
        () => true,
      ),
    ).toBeUndefined();
    expect(
      shortestPath(
        world,
        'c',
        'a',
        () => true,
        () => true,
      ),
    ).toEqual(['c', 'b', 'a']);
  });
});

describe('AC-2: shortcut unlock facts', () => {
  const shortcut = (unlock?: object) =>
    fixture({
      edges: [
        edge('ab', 'a', 'b'),
        edge('bc', 'b', 'c', { kind: 'shortcut', ...(unlock === undefined ? {} : { unlock }) }),
        edge('cw', 'c', 'w'),
      ],
    });

  it('warns about a fact no placed content produces', () => {
    const report = validateWorld(
      shortcut({ all: [{ fact: 'a.b' }, { not: { fact: 'c.d' } }] }),
      envOf({}),
    );
    expect(report.warnings.filter((w) => w.startsWith('AC-2')).length).toBe(2);
    expect(report.errors.filter((e) => e.startsWith('AC-2'))).toEqual([]);
  });

  it('is silent when the fact is produced', () => {
    const report = validateWorld(shortcut({ fact: 'a.b' }), envOf({}, ['a.b']));
    expect(report.warnings.filter((w) => w.startsWith('AC-2'))).toEqual([]);
  });

  it('fails a shortcut with no unlock at all', () => {
    expect(validateWorld(shortcut(), envOf({})).errors).toContain(
      'AC-2: shortcut "bc" has no unlock condition',
    );
  });

  it('finds the facts of any, sustained and count conditions', () => {
    expect(
      conditionFacts({ any: [{ fact: 'x.y' }, { sustained: { fact: 'z.w' }, seconds: 1 }] }),
    ).toEqual(['x.y', 'z.w']);
    expect(conditionFacts({ count: 'entity:*/*.looted', gte: 1 })).toEqual([]);
    expect(conditionFacts(undefined)).toEqual([]);
  });

  it('finds the producers: placed signal graphs, puzzles and respawn rules', () => {
    const produced = producedFacts(content);
    expect(produced.has('slice.complete')).toBe(true);
    expect(produced.has(content.all('puzzle')[0]!.outputs.solvedFact)).toBe(true);
    expect(produced.has('world.glen-well.rung-pulled')).toBe(false);
    const sceneId = content.all('scene')[0]!.id;
    const spawn = content.all('scene')[0]!.spawns[0]!.id;
    expect(isProduced(`entity:${sceneId}/${spawn}.opened`, new Set(), content)).toBe(true);
    expect(isProduced(`entity:nowhere/${spawn}.opened`, new Set(), content)).toBe(false);
    expect(isProduced(`entity:${sceneId}/${spawn}.opened`, new Set())).toBe(false);
    expect(isProduced('plain.fact', new Set())).toBe(false);
  });
});

describe('AC-3: loops and class shortcuts', () => {
  it('fails for a missing required loop, a non-cycle and absent Wendmouth links', () => {
    const world = fixture({
      loops: [{ id: 'bad', name: 'bad', edges: ['ab', 'bc'] }],
      edges: [
        edge('ab', 'a', 'b'),
        edge('bc', 'b', 'c'),
        edge('cw', 'c', 'w', { travel: 'foot', unlock: { fact: 'a.b' } }),
      ],
    });
    const errors = validateWorld(world, envOf({})).errors;
    expect(
      errors.some((e) => e.includes('loop "forest-watchtower-priory"') && e.includes('missing')),
    ).toBe(true);
    expect(errors).toContain(
      'AC-3: loop "bad" is not a single cycle (each node needs exactly two of its edges)',
    );
    expect(errors).toContain('AC-3: no barge edge reaches Wendmouth');
    expect(errors).toContain('AC-3: no always-open towpath edge reaches Wendmouth');
    expect(errors).toContain('AC-3: class "knight" has no ability-gated shortcut');
  });

  it('recognises cycles', () => {
    const world = fixture({
      edges: [
        edge('ab', 'a', 'b'),
        edge('bc', 'b', 'c'),
        edge('ca', 'c', 'a'),
        edge('cw', 'c', 'w'),
      ],
    });
    expect(isCycle(world, ['ab', 'bc', 'ca'])).toBe(true);
    expect(isCycle(world, ['ab', 'bc'])).toBe(false);
    expect(isCycle(world, ['ab', 'missing'])).toBe(false);
  });
});

describe('AC-5: the critical path never needs Wendmouth or the barge', () => {
  it('fails when the only way to a waypoint is a barge edge', () => {
    const world = fixture({
      edges: [
        edge('ab', 'a', 'b'),
        edge('bc', 'b', 'c', { travel: 'barge' }),
        edge('cw', 'c', 'w'),
      ],
    });
    const report = validateWorld(world, envOf({}));
    expect(report.errors.some((e) => e.startsWith('AC-5') && e.includes('"a" to "c"'))).toBe(true);
    expect(report.criticalPath).toEqual([]);
  });

  it('fails when the only way runs through an optional node, or a waypoint is optional', () => {
    const world = fixture({
      mainQuest: ['a', 'w'],
      nodes: [
        node('a'),
        node('b', { optional: true }),
        node('c'),
        node('w', { area: 'wendmouth', optional: true }),
      ],
      edges: [edge('ab', 'a', 'b'), edge('bc', 'b', 'c'), edge('cw', 'c', 'w')],
    });
    const errors = validateWorld(world, envOf({})).errors.filter((e) => e.startsWith('AC-5'));
    expect(errors.some((e) => e.includes('waypoint "w" is optional'))).toBe(true);
    expect(errors.some((e) => e.includes('cannot get from'))).toBe(true);
  });

  it('computes the path through the waypoints', () => {
    const report = validateWorld(fixture({ mainQuest: ['a', 'b', 'c'] }), envOf({}));
    expect(report.criticalPath).toEqual(['a', 'b', 'c']);
  });

  it('warns about a planned edge that names no bead', () => {
    const noBead = { ...edge('ab', 'a', 'b') } as Partial<EdgeInput>;
    delete noBead.bead;
    const world = fixture({
      edges: [noBead as EdgeInput, edge('bc', 'b', 'c'), edge('cw', 'c', 'w')],
    });
    expect(validateWorld(world, envOf({})).warnings).toContain(
      'edge "ab" is planned but names no bead that builds it',
    );
  });
});

describe('AC-4: unknown references fail naming the edge and the node', () => {
  it('rejects an edge to an unknown node', () => {
    const result = worldSchema.safeParse({
      ...fixture(),
      nodes: [node('a'), node('b')],
      edges: [edge('ab', 'a', 'b'), edge('bz', 'b', 'zzz')],
      mainQuest: ['a', 'b'],
      townSpawn: 'a',
    });
    expect(result.success).toBe(false);
    const messages = result.error?.issues.map((i) => i.message) ?? [];
    expect(messages).toContain('edge "bz" references unknown node "zzz"');
  });

  it('rejects unknown spawn, waypoint, loop edge, duplicates and self-loops', () => {
    const base = { ...fixture(), nodes: [node('a'), node('a'), node('c')] };
    const result = worldSchema.safeParse({
      ...base,
      townSpawn: 'nope',
      mainQuest: ['a', 'nope2'],
      edges: [edge('e', 'a', 'a'), edge('e', 'a', 'c')],
      loops: [
        { id: 'l', name: 'l', edges: ['e', 'ghost'] },
        { id: 'l', name: 'l', edges: ['e', 'e'] },
      ],
    });
    const messages = (result.error?.issues ?? []).map((i) => i.message).join('\n');
    for (const needle of [
      'node "a" is listed twice',
      'edge "e" is listed twice',
      'leads from "a" to itself',
      'townSpawn references unknown node "nope"',
      'mainQuest references unknown node "nope2"',
      'unknown edge "ghost"',
      'loop "l" is listed twice',
    ]) {
      expect(messages).toContain(needle);
    }
  });
});
