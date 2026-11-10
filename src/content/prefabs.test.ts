// Puzzle prefabs (mw-e15.4): the data format, the expansion into spawns and a signal graph, and the
// load checks. The behaviour of each shipped prefab is tested in tests/integration/puzzle-prefabs.test.ts.
import { describe, expect, it } from 'vitest';
import { GAME_CONTENT_ROOT, gameContentSources, loadGameContent } from './game-content.ts';
import { ContentLoadError, loadContent, type ContentSource } from './loader.ts';
import { instantiate, prefabComponents } from './prefabs.ts';
import { contentChecks, contentTypes } from './registry.ts';
import { describeContent } from './testing.ts';
import { SPAWN_TEMPLATE_KEYS } from './types/prefab.ts';
import { sceneSpawnSchema } from './types/scene.ts';

const content = loadGameContent();
const SCENE = `${GAME_CONTENT_ROOT}/scene/zz-prefab-test.json`;

const prefabSource = (
  id: string,
  change: (p: Record<string, unknown>) => Record<string, unknown>,
) => {
  const base = gameContentSources().find((s) => s.path.endsWith(`/prefab/${id}.json`));
  if (base === undefined) throw new Error(`no prefab ${id}`);
  const edited = change(JSON.parse(base.text) as Record<string, unknown>);
  return { path: base.path, text: JSON.stringify(edited) };
};

/** A scene of one floor and the given prefab instances, with the sources replacing shipped files. */
function loadWith(
  prefabs: readonly Record<string, unknown>[],
  replace: readonly ContentSource[] = [],
): string[] {
  const scene: ContentSource = {
    path: SCENE,
    text: JSON.stringify({
      id: 'zz-prefab-test',
      name: 'Test',
      camera: { position: [0, 5, 0], target: [0, 0, 1] },
      placements: [{ piece: 'floor', at: [0, 0, 0] }],
      prefabs,
    }),
  };
  const replaced = new Set(replace.map((s) => s.path));
  try {
    loadContent(
      contentTypes,
      [
        ...gameContentSources().filter(
          (s) => !replaced.has(s.path) && !s.path.endsWith('/scene/prefab-gallery.json'),
        ),
        ...replace,
        scene,
      ],
      contentChecks,
    );
  } catch (error) {
    if (!(error instanceof ContentLoadError)) throw error;
    return error.issues.map((i) => `${i.file}#${i.pointer}: ${i.message}`);
  }
  return [];
}

describeContent(
  'prefab',
  'AC-1: expands, at every turn, to spawns of existing components',
  (prefab) => {
    const params = Object.fromEntries(
      Object.entries(prefab.parameters).map(([name, p]) => [
        name,
        (p.default ?? p.example) as number,
      ]),
    );
    for (const yaw of [0, 90, 180, 270]) {
      const result = instantiate(prefab, { id: 'probe', at: [1, 0, 2], yaw, params });
      if (!('instance' in result)) throw new Error(result.problems.join('; '));
      for (const spawn of result.instance.spawns) {
        expect(sceneSpawnSchema.safeParse(spawn).error?.issues ?? []).toEqual([]);
      }
      expect(result.instance.spawns).toHaveLength(prefab.spawns.length);
    }
  },
);

describe('puzzle prefabs (mw-e15.4)', () => {
  it('ships 15 prefabs', () => {
    expect(content.all('prefab').map((p) => p.id)).toEqual([
      'beam-sensor',
      'beam-source',
      'bell',
      'brazier',
      'counterweight-lift',
      'crystal-receiver',
      'lens-stand',
      'rotatable-mirror',
      'rotatable-statue',
      'rune-tile-sequence',
      'scale-plate-pair',
      'sliding-block',
      'timed-door',
      'water-basin',
      'weighted-crate-set',
    ]);
  });

  it('AC-1: every shipped prefab passes the schema and uses only fields a scene spawn has', () => {
    expect(loadWith([])).toEqual([]);
    for (const prefab of content.all('prefab')) {
      for (const spawn of prefab.spawns) {
        for (const key of Object.keys(spawn)) {
          expect(['local', ...SPAWN_TEMPLATE_KEYS], `${prefab.id}.${spawn.local}.${key}`).toContain(
            key,
          );
        }
      }
      expect(prefabComponents(prefab).length + prefab.spawns.length).toBeGreaterThan(0);
    }
  });

  it('AC-1: a prefab naming a component no scene spawn has fails, naming it', () => {
    const issues = loadWith(
      [],
      [
        prefabSource('bell', (p) => ({
          ...p,
          spawns: [{ local: 'bell', at: [0, 0, 0], clockwork: { gears: 3 } }],
        })),
      ],
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('prefab/bell.json#/spawns/0/clockwork');
    expect(issues[0]).toContain('built only from existing world components');
  });

  it('AC-1: a prefab whose spawn or graph is invalid, or names missing content, fails the check', () => {
    const bad = (change: (p: Record<string, unknown>) => Record<string, unknown>) =>
      loadWith([], [prefabSource('timed-door', change)]).join('\n');
    expect(
      bad((p) => ({
        ...p,
        spawns: [{ local: 'door', door: { profile: 'no-such-door' } }, { local: 'button' }],
      })),
    ).toContain('references missing door:no-such-door');
    expect(
      bad((p) => ({
        ...p,
        spawns: [
          { local: 'door', at: [0, 0, 0.1], door: { profile: 'portcullis' } },
          { local: 'button', switch: { kind: 'button' } },
        ],
      })),
    ).toContain('must snap to the grid');
    expect(
      bad((p) => ({
        ...p,
        graph: {
          nodes: [
            { id: 'press', kind: 'button', entity: 'button' },
            { id: 'open', kind: 'timer', seconds: 2 },
          ],
          wires: [{ from: 'press', to: 'nowhere' }],
        },
      })),
    ).toContain('signal graph');
    expect(
      bad((p) => ({
        ...p,
        parameters: {
          openSeconds: { type: 'number', description: 'x', default: 500, max: 10 },
          profile: {
            type: 'enum',
            description: 'x',
            values: ['portcullis', 'sliding-door'],
            default: 'portcullis',
          },
        },
      })),
    ).toContain('parameter "openSeconds"');
  });

  it('AC-1: the schema rejects a prefab with dangling names', () => {
    const issues = (change: (p: Record<string, unknown>) => Record<string, unknown>) =>
      loadWith([], [prefabSource('timed-door', change)]).join('\n');
    expect(
      issues((p) => ({ ...p, outputs: [{ name: 'x', description: 'x', node: 'ghost' }] })),
    ).toContain('names node "ghost"');
    expect(
      issues((p) => ({ ...p, outputs: [{ name: 'x', description: 'x', spawn: 'ghost' }] })),
    ).toContain('names spawn "ghost"');
    expect(issues((p) => ({ ...p, outputs: [{ name: 'x', description: 'x' }] }))).toContain(
      'needs exactly one of node and spawn',
    );
    expect(
      issues((p) => ({
        ...p,
        outputs: [{ name: 'x', description: 'x', node: 'open', property: 'weight' }],
      })),
    ).toContain('names a property but no spawn');
    expect(
      issues((p) => ({ ...p, inputs: [{ name: 'x', description: 'x', spawn: 'ghost' }] })),
    ).toContain('names spawn "ghost"');
    expect(
      issues((p) => ({
        ...p,
        spawns: [
          { local: 'door', door: { profile: 'portcullis' } },
          { local: 'door', door: { profile: 'portcullis' } },
        ],
      })),
    ).toContain('spawn "door" is used twice');
    expect(
      issues((p) => ({
        ...p,
        graph: {
          nodes: [{ id: 'a', kind: 'receiver', receiver: 'door', entity: 'ghost' }],
          wires: [],
        },
      })),
    ).toContain('binds "ghost"');
    expect(
      issues((p) => ({
        ...p,
        spawns: [{ local: 'door', door: { profile: '$missing' } }, { local: 'button' }],
      })),
    ).toContain('refers to parameter "missing"');
  });

  it('AC-1: parameter declarations are checked', () => {
    const issues = (parameters: unknown) =>
      loadWith([], [prefabSource('timed-door', (p) => ({ ...p, parameters }))]).join('\n');
    expect(issues({ a: { type: 'number', description: 'x' } })).toContain('needs an example');
    expect(
      issues({ a: { type: 'number', description: 'x', default: 1, min: 5, max: 2 } }),
    ).toContain('min above its max');
    expect(issues({ a: { type: 'number', description: 'x', example: 'many' } })).toContain(
      'needs a number default or example',
    );
    expect(issues({ a: { type: 'boolean', description: 'x', example: 3 } })).toContain(
      'needs a boolean default or example',
    );
    expect(
      issues({ a: { type: 'enum', description: 'x', values: ['p', 'q'], default: 'z' } }),
    ).toContain('outside its values');
  });

  it('AC-4: a mirror instance without its step angle gets the default; the prefab is turned and moved by the instance', () => {
    const mirror = content.get('prefab', 'rotatable-mirror');
    const expanded = instantiate(mirror, { id: 'm', at: [4, 0, 2], yaw: 90, params: {} });
    if (!('instance' in expanded)) throw new Error('expected an expansion');
    const [spawn] = expanded.instance.spawns;
    expect(spawn).toMatchObject({
      id: 'm-mirror',
      at: [4, 0, 2],
      yaw: 90,
      push: { rotateStep: 45 },
      optic: { normal: [-1, 0, 0] },
    });
    expect(loadWith([{ id: 'm', prefab: 'rotatable-mirror', at: [0, 0, 0] }])).toEqual([]);
  });

  it('AC-4: a required parameter with no default fails to load, naming the instance and the parameter', () => {
    const issues = loadWith([{ id: 'pair', prefab: 'scale-plate-pair', at: [0, 0, 0] }]);
    expect(issues).toEqual([
      `${SCENE}#/prefabs/0: scene:zz-prefab-test prefab instance "pair": missing required parameter "minWeight" of prefab "scale-plate-pair" (a number, no default): Lightest weight that turns a plate on.`,
    ]);
    expect(
      loadWith([
        { id: 'pair', prefab: 'scale-plate-pair', at: [0, 0, 0], params: { minWeight: 20 } },
      ]),
    ).toEqual([]);
  });

  it('AC-4: an unknown parameter, a bad value, a bad yaw and an unknown prefab fail clearly', () => {
    const issues = loadWith([
      { id: 'a', prefab: 'rotatable-mirror', at: [0, 0, 0], params: { stepAngel: 45 } },
      { id: 'b', prefab: 'rotatable-mirror', at: [0, 0, 0], params: { stepAngle: 400 } },
      { id: 'c', prefab: 'rotatable-mirror', at: [0, 0, 0], params: { stepAngle: 'wide' } },
      { id: 'd', prefab: 'sliding-block', at: [0, 0, 0], params: { cell: 1 }, yaw: 90 },
      { id: 'e', prefab: 'no-such-prefab', at: [0, 0, 0] },
      { id: 'f', prefab: 'brazier', at: [0, 0, 0], params: { unlit: 'yes' } },
      { id: 'g', prefab: 'bell', at: [0, 0, 0], params: { mode: 'sometimes' } },
      { id: 'h', prefab: 'brazier', at: [0, 0, 0], params: { nothing: 1 } },
    ]).join('\n');
    expect(issues).toContain('has no parameter "stepAngel"; its parameters: stepAngle');
    expect(issues).toContain(
      'parameter "stepAngle" of prefab "rotatable-mirror" must be at most 180',
    );
    expect(issues).toContain('must be a number');
    expect(issues).toContain('there is no prefab "no-such-prefab"');
    expect(issues).toContain('"unlit" of prefab "brazier" must be true or false');
    expect(issues).toContain('must be one of momentary, latching');
    expect(issues).toContain('prefab "brazier" has no parameter "nothing"');
    expect(issues).not.toContain('instance "d"');
  });

  it('a whole-number parameter and a bad yaw are checked', () => {
    const prefab = content.get('prefab', 'brazier');
    const integer = {
      ...prefab,
      parameters: { n: { type: 'integer' as const, description: 'n', min: 1, default: 2 } },
    };
    const result = (params: Record<string, number>) =>
      instantiate(integer, { id: 'p', at: [0, 0, 0], yaw: 0, params });
    expect('problems' in result({ n: 1.5 }) && result({ n: 1.5 })).toMatchObject({
      problems: [expect.stringContaining('whole number')],
    });
    expect(result({ n: 0 })).toMatchObject({ problems: [expect.stringContaining('at least 1')] });
    expect(result({})).toHaveProperty('instance');
    expect(instantiate(prefab, { id: 'p', at: [0, 0, 0], yaw: 45, params: {} })).toMatchObject({
      problems: ['yaw 45 is not 0, 90, 180 or 270'],
    });
  });

  it('turns only what is a vector: anything else is left for the spawn schema to reject', () => {
    const bell = content.get('prefab', 'bell');
    const result = instantiate(
      {
        ...bell,
        spawns: [
          { local: 'x', optic: { normal: 'sideways' }, liquid: { size: 'large' }, plate: 3 },
        ],
      },
      { id: 'v', at: [0, 0, 0], yaw: 90, params: {} },
    );
    if (!('instance' in result)) throw new Error('expected an expansion');
    expect(result.instance.spawns[0]).toMatchObject({
      optic: { normal: 'sideways' },
      liquid: { size: 'large' },
      plate: 3,
    });
  });

  it('a spawn template may turn on its own, and a required enum is named when missing', () => {
    const bell = content.get('prefab', 'bell');
    const turned = instantiate(
      { ...bell, spawns: [{ local: 'x', yaw: 90 }] },
      { id: 't', at: [0, 0, 0], yaw: 180, params: {} },
    );
    if (!('instance' in turned)) throw new Error('expected an expansion');
    expect(turned.instance.spawns[0]).toMatchObject({ yaw: 270 });
    const required = instantiate(
      {
        ...bell,
        parameters: {
          side: { type: 'enum', description: 'Which side', values: ['left', 'right'] },
        },
      },
      { id: 't', at: [0, 0, 0], yaw: 0, params: {} },
    );
    expect(required).toMatchObject({
      problems: [expect.stringContaining('(one of left, right, no default)')],
    });
    expect(
      loadWith([{ id: 'c', prefab: 'weighted-crate-set', at: [0, 0, 0], params: { kg: 3 } }]).join(
        '\n',
      ),
    ).toContain('(it takes none)');
  });

  it('expansion prefixes spawn ids, binds the graph, turns vectors and swaps footprints with the yaw', () => {
    const basin = content.get('prefab', 'water-basin');
    const result = instantiate(basin, { id: 'b', at: [2, 0, 3], yaw: 90, params: {} });
    if (!('instance' in result)) throw new Error('expected an expansion');
    const { spawns, graph, bindings } = result.instance;
    expect(spawns.map((s) => s.id)).toEqual(['b-basin', 'b-plate', 'b-valve']);
    expect(bindings).toEqual({ basin: 'b-basin', plate: 'b-plate', valve: 'b-valve' });
    expect(graph).toMatchObject({ id: 'b' });
    expect(spawns[0]).toMatchObject({ liquid: { size: [2, 1, 2] } });
    expect(spawns[2]).toMatchObject({ at: [2, 0, 1.5] });
    const lift = instantiate(content.get('prefab', 'counterweight-lift'), {
      id: 'l',
      at: [0, 0, 0],
      yaw: 90,
      params: {},
    });
    if (!('instance' in lift)) throw new Error('expected an expansion');
    expect(lift.instance.spawns[0]).toMatchObject({ plate: { width: 1.5, depth: 1.5 } });
    const wide = instantiate(
      {
        ...basin,
        spawns: [{ local: 'x', liquid: { size: [4, 1, 2] }, plate: { width: 3 } }],
      },
      { id: 'w', at: [0, 0, 0], yaw: 270, params: {} },
    );
    if (!('instance' in wide)) throw new Error('expected an expansion');
    expect(wide.instance.spawns[0]).toMatchObject({
      liquid: { size: [2, 1, 4] },
      plate: { depth: 3 },
    });
    const statue = instantiate(content.get('prefab', 'beam-source'), {
      id: 's',
      at: [0, 0, 0],
      yaw: 180,
      params: {},
    });
    if (!('instance' in statue)) throw new Error('expected an expansion');
    expect(statue.instance.spawns[0]).toMatchObject({ beamEmitter: { direction: [0, 0, -1] } });
    const rail = instantiate(
      { ...basin, spawns: [{ local: 'x', at: 'sideways', push: { axis: [1, 0] } }] },
      { id: 'r', at: [0, 0, 0], yaw: 90, params: {} },
    );
    expect(rail).toMatchObject({ problems: [expect.stringContaining('not three numbers')] });
    const railed = instantiate(
      { ...basin, spawns: [{ local: 'x', push: { axis: [1, 0] } }] },
      { id: 'r', at: [0, 0, 0], yaw: 90, params: {} },
    );
    if (!('instance' in railed)) throw new Error('expected an expansion');
    expect(railed.instance.spawns[0]).toMatchObject({ push: { axis: [0, -1] } });
  });

  it('a scene with prefabs loads as its expansion: spawns, one graph per instance, no prefabs field', () => {
    const gallery = content.get('scene', 'prefab-gallery');
    expect(gallery).not.toHaveProperty('prefabs');
    const ids = new Set(gallery.spawns.map((s) => s.id));
    expect(ids.has('mirror-demo-mirror')).toBe(true);
    expect(gallery.signals.map((s) => s.graph.id)).toContain('statue-demo');
    expect(content.has('signal-graph', 'statue-demo')).toBe(true);
    expect(content.has('signal-graph', 'mirror-demo')).toBe(false);
  });

  it('two instances of one prefab are independent; a clash with an existing id is reported', () => {
    expect(
      loadWith([
        { id: 'one', prefab: 'bell', at: [0, 0, 0] },
        { id: 'two', prefab: 'bell', at: [3, 0, 0] },
      ]),
    ).toEqual([]);
    const clash = loadWith([
      { id: 'one', prefab: 'bell', at: [0, 0, 0] },
      { id: 'one', prefab: 'bell', at: [3, 0, 0] },
    ]).join('\n');
    expect(clash).toContain('used twice');
  });

  it('a signal graph of the prefab that cannot be built is reported with the instance', () => {
    const issues = loadWith(
      [{ id: 'door-1', prefab: 'timed-door', at: [0, 0, 0] }],
      [
        prefabSource('timed-door', (p) => ({
          ...p,
          graph: {
            nodes: [{ id: 'open', kind: 'timer', seconds: -2 }],
            wires: [],
          },
        })),
      ],
    ).join('\n');
    expect(issues).toContain('prefab instance "door-1": its signal graph is invalid');
  });

  it('an expanded scene that breaks a scene rule is reported against the expanded scene', () => {
    const issues = loadWith([{ id: 'one', prefab: 'bell', at: [0, 0, 0] }]);
    expect(issues).toEqual([]);
    const bad = loadWith(
      [{ id: 'one', prefab: 'bell', at: [0, 0, 0] }],
      [
        prefabSource('bell', (p) => ({
          ...p,
          spawns: [
            { local: 'bell', at: [0, 2, 0], impactSwitch: { variant: 'bell' } },
            {
              local: 'dup',
              at: [0, 2, 0],
              tags: [],
              door: { profile: 'portcullis' },
              switch: { kind: 'lever' },
            },
          ],
          graph: undefined,
          outputs: [{ name: 'bell', description: 'x', spawn: 'bell' }],
        })),
      ],
    ).join('\n');
    expect(bad).toContain('cannot be both a door and a switch');
  });
});
