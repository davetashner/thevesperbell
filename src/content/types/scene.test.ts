import { describe, expect, it } from 'vitest';
import { gameContentSources } from '../game-content.ts';
import { ContentLoadError, loadContent, type ContentSource } from '../loader.ts';
import { contentChecks, contentTypes } from '../registry.ts';
import { ContentRef } from '../schema.ts';
import { describeContent } from '../testing.ts';
import { sceneBreakableSchema, sceneSchema, type SceneDefInput } from './scene.ts';

const room = {
  id: 'room',
  name: 'Room',
  camera: { position: [0, 5, -5], target: [0, 0, 0] },
  placements: [{ piece: 'floor', at: [0, 0, 0] }],
} satisfies SceneDefInput;

const problems = (value: unknown) =>
  (sceneSchema.safeParse(value).error?.issues ?? []).map(
    (i) => `${i.path.join('.')}: ${i.message}`,
  );

const source = (path: string, json: unknown): ContentSource => ({
  path,
  text: JSON.stringify(json),
});

describe('scene mechanisms (mw-e03.18)', () => {
  const spawn = (id: string, extra: object) => ({ id, at: [0, 0, 0], ...extra });

  it('fills door and switch defaults, and places signal graphs', () => {
    const scene = sceneSchema.parse({
      ...room,
      spawns: [
        spawn('gate', { door: { profile: 'portcullis' } }),
        spawn('lever', { switch: { kind: 'lever' } }),
      ],
      signals: [{ graph: 'gate' }],
    });
    expect(scene.spawns[0]?.door).toEqual({
      profile: new ContentRef('door', 'portcullis'),
      state: 'closed',
      hinge: 'left',
      swing: 'forward',
    });
    expect(scene.spawns[1]?.switch).toEqual({ kind: 'lever', initial: 0 });
    expect(scene.signals).toEqual([
      { graph: new ContentRef('signal-graph', 'gate'), bindings: {}, checkpoints: [] },
    ]);
  });

  it('rejects a spawn that is a door and a switch, a door with its own prompt and a lockless locked door', () => {
    expect(
      problems({
        ...room,
        spawns: [
          spawn('both', {
            door: { profile: 'wooden-door', locked: true },
            switch: { kind: 'lever' },
            interact: { affordances: [{ verb: 'open' }] },
          }),
        ],
      }),
    ).toEqual([
      'spawns.0.switch: spawn "both" cannot be both a door and a switch',
      'spawns.0.interact: spawn "both" is a door: its affordances follow its state, so it declares none',
      'spawns.0.door: spawn "both" starts locked but has no lock',
    ]);
  });

  it('rejects positions on a lever or button, and a start outside the positions', () => {
    expect(
      problems({
        ...room,
        spawns: [
          spawn('lever', { switch: { kind: 'lever', positions: 3 } }),
          spawn('button', { switch: { kind: 'button', initial: 1 } }),
          spawn('crank', { switch: { kind: 'crank', positions: 4, initial: 3 } }),
          spawn('wheel', { switch: { kind: 'wheel', initial: 2 } }),
        ],
      }),
    ).toEqual([
      'spawns.0.switch: spawn "lever" is a lever: only a crank or wheel sets positions',
      'spawns.1.switch: spawn "button" starts in position 1 of 1',
      'spawns.3.switch: spawn "wheel" starts in position 2 of 2',
    ]);
  });

  it('rejects a signal binding to a spawn the scene does not have', () => {
    expect(
      problems({
        ...room,
        spawns: [spawn('gate', {})],
        signals: [{ graph: 'gate', bindings: { 'gate-lever': 'lever', gate: 'gate' } }],
      }),
    ).toEqual([
      'signals.0.bindings.gate-lever: binding "gate-lever" names spawn "lever", which this scene does not have',
    ]);
  });
});

describe('scene containers (mw-e18.3)', () => {
  const spawn = (id: string, extra: object) => ({ id, at: [0, 0, 0], ...extra });

  it('takes a loot table, contents (1 unit by default) and a lock, all optional', () => {
    const scene = sceneSchema.parse({
      ...room,
      spawns: [
        spawn('chest', {
          container: {
            loot: 'testbed-supply-crate',
            contents: [{ item: 'healing-draught' }],
            lock: 'testbed-closet',
          },
        }),
        spawn('barrel', { container: {} }),
      ],
    });
    expect(scene.spawns[0]?.container).toEqual({
      loot: new ContentRef('loot-table', 'testbed-supply-crate'),
      contents: [{ item: new ContentRef('item', 'healing-draught'), count: 1 }],
      lock: new ContentRef('lock', 'testbed-closet'),
    });
    expect(scene.spawns[1]?.container).toEqual({ contents: [] });
  });

  it('rejects a container that is also a door, switch, item or creature, declares a prompt or is locked without a lock', () => {
    expect(
      problems({
        ...room,
        spawns: [
          spawn('mimic', {
            container: { locked: true },
            door: { profile: 'wooden-door' },
            switch: { kind: 'lever' },
            item: { id: 'healing-draught' },
            creature: 'forgotten-miner',
            interact: { affordances: [{ verb: 'search' }] },
          }),
        ],
      }),
    ).toEqual([
      'spawns.0.switch: spawn "mimic" cannot be both a door and a switch',
      'spawns.0.interact: spawn "mimic" is a door: its affordances follow its state, so it declares none',
      'spawns.0.door: spawn "mimic" cannot be both a container and a door',
      'spawns.0.switch: spawn "mimic" cannot be both a container and a switch',
      'spawns.0.item: spawn "mimic" cannot be both a container and an item',
      'spawns.0.creature: spawn "mimic" cannot be both a container and a creature',
      'spawns.0.interact: spawn "mimic" is a container: its affordances follow its lock, so it declares none',
      'spawns.0.container: spawn "mimic" starts locked but has no lock',
    ]);
  });

  it('places the testbed’s supply chest, rolling the supply-crate table', () => {
    const content = loadContent(contentTypes, gameContentSources(), contentChecks);
    const chest = content.get('scene', 'testbed').spawns.find((s) => s.id === 'supply-chest');
    expect(chest?.container?.loot?.id).toBe('testbed-supply-crate');
    expect(chest?.container?.lock).toBeUndefined();
  });
});

describe('scene checkpoints (mw-e01.4)', () => {
  it('marks volume nodes of a placed graph as checkpoints, each once', () => {
    const scene = sceneSchema.parse({
      ...room,
      signals: [{ graph: 'gate', checkpoints: ['cp-1'] }],
    });
    expect(scene.signals[0]?.checkpoints).toEqual(['cp-1']);
    expect(
      problems({ ...room, signals: [{ graph: 'gate', checkpoints: ['cp-1', 'cp-2', 'cp-1'] }] }),
    ).toEqual(['signals.0.checkpoints.2: checkpoint "cp-1" is listed twice']);
  });
});

describe('scene acoustics (mw-e09.3)', () => {
  const door = { id: 'door', at: [0, 0, 5], door: { profile: 'wooden-door' } };
  const hall = { id: 'hall', min: [-5, 0, -5], max: [5, 3, 5] };
  const closet = { id: 'closet', min: [-1, 0, 5], max: [1, 3, 7] };

  it('takes rooms, portals and partition materials, all defaulting to none', () => {
    const scene = sceneSchema.parse({
      ...room,
      spawns: [door],
      acoustics: {
        rooms: [hall, closet],
        portals: [
          { id: 'closet-door', rooms: ['hall', 'closet'], at: [0, 1, 5], door: 'door' },
          { id: 'gate', rooms: ['hall', 'outside'], at: [0, 1, -5] },
        ],
        partitions: [{ rooms: ['hall', 'closet'], material: 'wood' }],
      },
    });
    expect(scene.acoustics?.portals).toHaveLength(2);
    expect(sceneSchema.parse({ ...room, acoustics: {} }).acoustics).toEqual({
      rooms: [],
      portals: [],
      partitions: [],
    });
    expect(sceneSchema.parse(room).acoustics).toBeUndefined();
  });

  it('rejects reserved, repeated or unknown names, self-joins, empty boxes and non-door doors', () => {
    expect(
      problems({
        ...room,
        spawns: [door, { id: 'crate', at: [1, 0, 1] }],
        acoustics: {
          rooms: [hall, hall, { id: 'outside', min: [0, 0, 0], max: [0, 1, 1] }],
          portals: [
            { id: 'p', rooms: ['hall', 'cellar'], at: [0, 0, 0], door: 'crate' },
            { id: 'p', rooms: ['hall', 'hall'], at: [0, 0, 0] },
          ],
          partitions: [
            { rooms: ['hall', 'yard'], material: 'stone' },
            { rooms: ['yard', 'hall'], material: 'stone' },
          ],
        },
      }),
    ).toEqual([
      'acoustics.rooms.2.id: "outside" is reserved',
      'acoustics.rooms.2.max: max must be above min on every axis',
      'acoustics.rooms.1.id: room id "hall" is used twice',
      'acoustics.portals.0.rooms.1: names room "cellar", which this scene does not have',
      'acoustics.portals.0.door: names door "crate", which no spawn of this scene is',
      'acoustics.portals.1.id: portal id "p" is used twice',
      'acoustics.portals.1.rooms: joins room "hall" to itself',
      'acoustics.partitions.0.rooms.1: names room "yard", which this scene does not have',
      'acoustics.partitions.1.rooms.0: names room "yard", which this scene does not have',
      'acoustics.partitions.1.rooms: this partition is listed twice',
    ]);
  });
});

describe('scene patrol routines (mw-e11.9)', () => {
  const guard = (routine: unknown, extra: object = {}) => ({
    id: 'guard',
    at: [0, 0, 0],
    creature: 'fixture-guard',
    routine,
    ...extra,
  });
  const yard = {
    ...room,
    waypoints: [
      { id: 'gate', at: [0, 0, 0], dwellS: 2, look: 90, scanArc: 90, idle: 'guard-lean' },
      { id: 'well', at: [4, 0, 0] },
      { id: 'tower', at: [4, 0, 4] },
    ],
    routes: [
      { id: 'yard-loop', kind: 'loop', waypoints: ['gate', 'well', 'tower'] },
      { id: 'yard-walk', kind: 'ping-pong', waypoints: ['gate', 'well', 'tower'] },
      { id: 'gate-post', kind: 'post', waypoints: ['gate'] },
      {
        id: 'yard-wander',
        kind: 'random',
        waypoints: ['gate', 'well'],
        links: [
          { from: 'gate', to: 'well', weight: 3 },
          { from: 'well', to: 'gate' },
        ],
      },
    ],
    spawns: [guard([{ route: 'yard-loop', hours: [6, 18] }, { route: 'gate-post' }])],
  };

  it('takes waypoints, routes of every kind and a windowed routine, filling defaults', () => {
    expect(problems(yard)).toEqual([]);
    const scene = sceneSchema.parse(yard);
    expect(scene.waypoints[0]).toEqual({
      id: 'gate',
      at: [0, 0, 0],
      dwellS: 2,
      look: 90,
      scanArc: 90,
      scanS: 6,
      idle: 'guard-lean',
    });
    expect(scene.routes[3]?.links?.[1]).toEqual({ from: 'well', to: 'gate', weight: 1 });
    expect(scene.spawns[0]?.routine).toEqual([
      { route: 'yard-loop', hours: [6, 18] },
      { route: 'gate-post' },
    ]);
  });

  it('AC-5: a route referencing a nonexistent waypoint id fails validation', () => {
    const broken = {
      ...yard,
      routes: [{ id: 'yard-loop', kind: 'loop', waypoints: ['gate', 'stable', 'tower'] }],
      spawns: [],
    };
    expect(problems(broken)).toEqual([
      'routes.0.waypoints.1: route "yard-loop" names waypoint "stable", which this scene does not have',
    ]);
    // Through the content loader too: the file and path are named.
    const load = () =>
      loadContent(
        contentTypes,
        [...gameContentSources(), source('fixtures/scene/yard.json', broken)],
        contentChecks,
      );
    expect(load).toThrow(ContentLoadError);
    expect(load).toThrow(/fixtures\/scene\/yard\.json[\s\S]*routes\/0\/waypoints\/1/);
  });

  it('rejects repeated names, misshapen posts, ping-pongs and random graphs, and bad routines', () => {
    expect(
      problems({
        ...room,
        waypoints: [
          { id: 'a', at: [0, 0, 0] },
          { id: 'a', at: [1, 0, 0], scanArc: 45 },
          { id: 'b', at: [2, 0, 0] },
        ],
        routes: [
          { id: 'post', kind: 'post', waypoints: ['a', 'b'] },
          { id: 'post', kind: 'ping-pong', waypoints: ['a'] },
          { id: 'loop', kind: 'loop', waypoints: ['a', 'b'], links: [{ from: 'a', to: 'b' }] },
          {
            id: 'wander',
            kind: 'random',
            waypoints: ['a', 'b', 'a'],
            links: [
              { from: 'a', to: 'c' },
              { from: 'd', to: 'a' },
            ],
          },
          { id: 'alone', kind: 'random', waypoints: ['b'] },
        ],
        spawns: [
          guard([{ route: 'loop', hours: [6, 6] }, { route: 'gone' }], { patrol: [[0, 0, 0]] }),
          { id: 'marker', at: [0, 0, 0], routine: [{ route: 'loop' }] },
          guard([], { id: 'idle' }),
        ],
      }),
    ).toEqual([
      'spawns.0.routine.0.hours: the window is empty: from equals to',
      'spawns.2.routine: Too small: expected array to have >=1 items',
      'waypoints.1.scanArc: a scan arc needs a look direction to centre on',
      'spawns.1.routine: spawn "marker" sets routine but spawns no creature',
      'waypoints.1.id: waypoint id "a" is used twice',
      'routes.0.waypoints: route "post" is a post: it holds exactly one waypoint',
      'routes.1.id: route id "post" is used twice',
      'routes.1.waypoints: route "post" is a ping-pong: it needs at least two waypoints',
      'routes.2.links: route "loop" is a loop: only a random route has links',
      'routes.3.waypoints.2: route "wander" lists waypoint "a" twice',
      'routes.3.links.0.to: route "wander" links waypoint "c", which it does not list',
      'routes.3.links.1.from: route "wander" links waypoint "d", which it does not list',
      'routes.3.waypoints.1: route "wander" has no link leaving waypoint "b"',
      'spawns.0.routine: spawn "guard" sets both patrol and routine',
      'spawns.0.routine.1.route: spawn "guard" names route "gone", which this scene does not have',
    ]);
  });
});

describe('scene creature leashes (mw-e01.17)', () => {
  it('takes a radius and an optional post, needs a creature and a positive, on-grid leash', () => {
    const spawns = [
      { id: 'skeleton', at: [2.5, 0, 32.5], creature: 'forgotten-miner', leash: { radius: 25 } },
      {
        id: 'warden',
        at: [0, 0, 0],
        creature: 'forgotten-miner',
        leash: { radius: 8, post: [1, 0, 1] },
      },
    ];
    expect(problems({ ...room, spawns })).toEqual([]);
    expect(sceneSchema.parse({ ...room, spawns }).spawns.map((s) => s.leash)).toEqual([
      { radius: 25 },
      { radius: 8, post: [1, 0, 1] },
    ]);
    expect(
      problems({
        ...room,
        spawns: [
          { id: 'marker', at: [0, 0, 0], leash: { radius: 5 } },
          { id: 'a', at: [0, 0, 0], creature: 'forgotten-miner', leash: { radius: 0 } },
          {
            id: 'b',
            at: [0, 0, 0],
            creature: 'forgotten-miner',
            leash: { radius: 5, post: [0.1, 0, 0] },
          },
        ],
      }),
    ).toEqual([
      'spawns.1.leash.radius: Too small: expected number to be >0',
      'spawns.2.leash.post: must snap to the grid: every coordinate a multiple of 0.25 cells',
      'spawns.0.leash: spawn "marker" sets leash but spawns no creature',
    ]);
  });
});

describe('scene creature carries (mw-e01.5)', () => {
  it('lists items a placed creature carries, a unit by default; needs a creature, an item and at least one entry', () => {
    const spawns = [
      {
        id: 'skeleton',
        at: [2.5, 0, 32.5],
        creature: 'forgotten-miner',
        carries: [{ item: 'rusted-gallery-key' }, { item: 'gold', count: 5 }],
      },
    ];
    expect(problems({ ...room, spawns })).toEqual([]);
    const carries = sceneSchema.parse({ ...room, spawns }).spawns[0]?.carries;
    expect(carries?.map(({ item, count }) => ({ item: item.id, count }))).toEqual([
      { item: 'rusted-gallery-key', count: 1 },
      { item: 'gold', count: 5 },
    ]);
    expect(
      problems({
        ...room,
        spawns: [
          { id: 'marker', at: [0, 0, 0], carries: [{ item: 'gold' }] },
          { id: 'a', at: [0, 0, 0], creature: 'forgotten-miner', carries: [] },
          {
            id: 'b',
            at: [0, 0, 0],
            creature: 'forgotten-miner',
            carries: [{ item: 'gold', count: 0 }],
          },
        ],
      }),
    ).toEqual([
      'spawns.1.carries: Too small: expected array to have >=1 items',
      'spawns.2.carries.0.count: Too small: expected number to be >=1',
      'spawns.0.carries: spawn "marker" sets carries but spawns no creature',
    ]);
  });
});

describe('scene schema (mw-e00.21)', () => {
  it('fills defaults: 1 m grid, no yaw, unit scale, no spawns', () => {
    expect(sceneSchema.parse(room)).toEqual({
      ...room,
      description: '',
      grid: 1,
      placements: [
        { piece: new ContentRef('kit', 'floor'), at: [0, 0, 0], yaw: 0, scale: [1, 1, 1] },
      ],
      spawns: [],
      signals: [],
      waypoints: [],
      routes: [],
      regions: [],
      transitions: [],
    });
  });

  it('AC-3: rejects positions off the snap grid, yaws that are not quarter turns and bad scales', () => {
    expect(problems({ ...room, placements: [{ piece: 'floor', at: [0.1, 0, 0] }] })).toEqual([
      'placements.0.at: must snap to the grid: every coordinate a multiple of 0.25 cells',
    ]);
    expect(problems({ ...room, placements: [{ piece: 'floor', at: [0, 0, 0], yaw: 45 }] })).toEqual(
      [expect.stringMatching(/^placements\.0\.yaw: /)],
    );
    expect(
      problems({ ...room, placements: [{ piece: 'floor', at: [0, 0, 0], scale: [1, 0, 1] }] }),
    ).toEqual([expect.stringMatching(/^placements\.0\.scale\.1: Too small/)]);
    expect(problems({ ...room, placements: [] })).toEqual([
      expect.stringMatching(/^placements: Too small/),
    ]);
  });

  it('mw-e17.7: an item spawn names an item and a count of 1 by default, within the unit guard', () => {
    const loot = { id: 'loot', at: [0, 0, 0], item: { id: 'healing-draught' } };
    expect(sceneSchema.parse({ ...room, spawns: [loot] }).spawns[0]?.item).toEqual({
      id: new ContentRef('item', 'healing-draught'),
      count: 1,
    });
    expect(problems({ ...room, spawns: [{ ...loot, item: { id: 'gold', count: 0 } }] })).toEqual([
      expect.stringMatching(/^spawns\.0\.item\.count: Too small/),
    ]);
    expect(
      problems({ ...room, spawns: [{ ...loot, item: { id: 'gold', count: 10_000 } }] }),
    ).toEqual([expect.stringMatching(/^spawns\.0\.item\.count: Too big/)]);
  });

  it('AC-3: rejects two spawns with the same id', () => {
    const spawn = { id: 'player-start', at: [0, 0, 0] };
    expect(problems({ ...room, spawns: [spawn, spawn] })).toEqual([
      'spawns.1.id: spawn id "player-start" is used twice in this scene',
    ]);
  });

  it('mw-e12.4: a creature spawn takes a faction override and a patrol; a marker takes neither', () => {
    const den = {
      id: 'den',
      at: [1, 0, 1],
      creature: 'fixture-hound',
      faction: 'unaligned',
      patrol: [
        [1, 0, 1],
        [3, 0, 1],
      ],
    };
    expect(problems({ ...room, spawns: [den] })).toEqual([]);
    const marker = { id: 'marker', at: [0, 0, 0], faction: 'unaligned', patrol: [[0, 0, 0]] };
    expect(problems({ ...room, spawns: [marker] })).toEqual([
      'spawns.0.faction: spawn "marker" sets faction but spawns no creature',
      'spawns.0.patrol: spawn "marker" sets patrol but spawns no creature',
    ]);
    expect(problems({ ...room, spawns: [{ ...den, patrol: [] }] })).toEqual([
      expect.stringMatching(/^spawns\.0\.patrol: Too small/),
    ]);
  });

  it('mw-e03.22 AC-5: a level file with a climbable grade not in the enum fails validation', () => {
    const scene = (climbable: unknown) => ({
      ...room,
      placements: [{ piece: 'wall', at: [0, 0, 0], properties: { climbable } }],
    });
    expect(problems(scene('ivy'))).toEqual([]);
    expect(problems(scene('vertical'))).toEqual([
      expect.stringMatching(/^placements\.0\.properties\.climbable: /),
    ]);
    expect(problems(scene(2))).toEqual([
      expect.stringMatching(/^placements\.0\.properties\.climbable: /),
    ]);
    // Through the content loader too: the file and path are named.
    const load = () =>
      loadContent(
        contentTypes,
        [...gameContentSources(), source('fixtures/scene/room.json', scene('slippery'))],
        contentChecks,
      );
    expect(load).toThrow(ContentLoadError);
    expect(load).toThrow(/fixtures\/scene\/room\.json[\s\S]*placements\/0\/properties\/climbable/);
  });

  it('mw-e03.22: placements take world properties and ledge overrides', () => {
    const parsed = sceneSchema.parse({
      ...room,
      placements: [
        {
          piece: 'wall',
          at: [0, 0, 0],
          properties: { material: 'wood', climbable: 'ladder' },
          ledges: [{ ledge: false }, { side: '+z', part: 0, ledge: true }],
        },
      ],
    });
    expect(parsed.placements[0]).toMatchObject({
      properties: { material: new ContentRef('material', 'wood'), climbable: 'ladder' },
      ledges: [{ ledge: false }, { side: '+z', part: 0, ledge: true }],
    });
    expect(
      problems({
        ...room,
        placements: [{ piece: 'wall', at: [0, 0, 0], ledges: [{ side: 'north', ledge: false }] }],
      }),
    ).toEqual([expect.stringMatching(/^placements\.0\.ledges\.0\.side: /)]);
    expect(
      problems({
        ...room,
        placements: [{ piece: 'wall', at: [0, 0, 0], ledges: [{ part: -1, ledge: true }] }],
      }),
    ).toEqual([expect.stringMatching(/^placements\.0\.ledges\.0\.part: /)]);
  });

  it('mw-e03.37: spawns take world properties; scenes take light data, validated', () => {
    const parsed = sceneSchema.parse({
      ...room,
      spawns: [{ id: 'torch', at: [0, 1.5, 0], properties: { burning: true, fuel: 3600 } }],
      light: {
        ambient: 0.05,
        ambientZones: [{ id: 'alcove', min: [0, 0, 0], max: [1, 2, 1], level: 0 }],
        directional: [{ id: 'moon', direction: [0, -1, 1], level: 0.3, reach: 30 }],
      },
    });
    expect(parsed.spawns[0]?.properties).toEqual({ burning: true, fuel: 3600 });
    expect(parsed.light?.directional[0]?.id).toBe('moon');
    expect(sceneSchema.parse({ ...room, light: {} }).light).toEqual({
      ambientZones: [],
      directional: [],
    });
    const zone = { id: 'z', min: [0, 0, 0], max: [1, 1, 1], level: 0.5 };
    const moon = { id: 'moon', direction: [0, -1, 0], level: 0.5, reach: 10 };
    expect(problems({ ...room, light: { ambient: 1.5 } })).toEqual([
      expect.stringMatching(/^light\.ambient: /),
    ]);
    expect(problems({ ...room, light: { ambientZones: [{ ...zone, max: [1, 0, 1] }] } })).toEqual([
      'light.ambientZones.0.max: max must be above min on every axis',
    ]);
    expect(
      problems({ ...room, light: { directional: [{ ...moon, direction: [0, 0, 0] }] } }),
    ).toEqual(['light.directional.0.direction: direction must not be zero']);
    expect(problems({ ...room, light: { directional: [{ ...moon, reach: 0 }] } })).toEqual([
      expect.stringMatching(/^light\.directional\.0\.reach: /),
    ]);
  });

  it('AC-3: a scene using a kit piece or prop that does not exist fails to load, naming it', () => {
    const broken = {
      ...room,
      placements: [{ piece: 'trapdoor', at: [0, 0, 0] }],
      spawns: [{ id: 'thing', at: [0, 0, 0], prop: 'barrel' }],
    };
    const load = () =>
      loadContent(
        contentTypes,
        [...gameContentSources(), source('fixtures/scene/room.json', broken)],
        contentChecks,
      );
    expect(load).toThrow(ContentLoadError);
    expect(load).toThrow(/scene:room references missing kit:trapdoor/);
    expect(load).toThrow(/scene:room references missing testprop:barrel/);
  });
});

describeContent(
  'scene',
  'AC-3: passes the scene schema and every kit piece and prop it uses exists',
  (scene, content) => {
    expect(scene.placements.length).toBeGreaterThan(0);
    for (const placement of scene.placements) {
      expect(content.has('kit', placement.piece.id)).toBe(true);
    }
    for (const spawn of scene.spawns) {
      if (spawn.prop !== undefined) expect(content.has('testprop', spawn.prop.id)).toBe(true);
    }
  },
);

describe('scene content', () => {
  it('ships the default testbed scene, the kit gallery, the combat sandbox, the lighting room, the weak-wall room, the mechanism room, the slice, the perf baseline, the valley spike scenes, the Marsh store, the Briar Glen shop lane, the Sleeping Ox, the Bridgeward College and the skeleton pen', () => {
    expect(
      loadContent(contentTypes, gameContentSources(), contentChecks)
        .all('scene')
        .map((s) => s.id),
    ).toEqual([
      'briar-glen-lane',
      'bridgeward-college',
      'combat-sandbox',
      'kit-gallery',
      'lighting-room',
      'marsh-store',
      'mechanism-room',
      'perf-baseline',
      'skeleton-pen',
      'sleeping-ox',
      'slice',
      'testbed',
      'under-the-bridge',
      'valley-01',
      'valley-02',
      'valley-03',
      'weak-wall-room',
    ]);
  });

  it('mw-e32.1: the perf baseline has 64 pushable crates, agitator markers and more lamps than the renderer draws', () => {
    const scene = loadContent(contentTypes, gameContentSources(), contentChecks).get(
      'scene',
      'perf-baseline',
    );
    const crates = scene.spawns.filter((s) => s.prop?.id === 'crate');
    expect(crates).toHaveLength(64);
    expect(crates.every((s) => s.properties?.pushable === true)).toBe(true);
    expect(scene.spawns.filter((s) => s.tags.includes('perf-agitator'))).toHaveLength(9);
    expect(scene.spawns.filter((s) => s.properties?.lightEmitter !== undefined)).toHaveLength(8);
    expect(scene.spawns.some((s) => s.tags.includes('player-start'))).toBe(false); // fixed camera
  });

  it('mw-e03.18: the mechanism room places a prefab of every door kind and wires its switches', () => {
    const scene = loadContent(contentTypes, gameContentSources(), contentChecks).get(
      'scene',
      'mechanism-room',
    );
    const doors = scene.spawns.flatMap((s) => (s.door === undefined ? [] : [s.door.profile.id]));
    expect(doors).toEqual(['portcullis', 'wooden-door', 'iron-door', 'sliding-door', 'trapdoor']);
    const switches = scene.spawns.flatMap((s) => (s.switch === undefined ? [] : [s.switch.kind]));
    expect(switches).toEqual(['lever', 'button', 'crank']);
    expect(scene.signals.map((s) => s.graph.id)).toEqual(['mechanism-room']);
  });

  it('mw-e03.11: the weak-wall room’s middle wall is a cracked old wall that reveals the passage', () => {
    const scene = loadContent(contentTypes, gameContentSources(), contentChecks).get(
      'scene',
      'weak-wall-room',
    );
    const breakables = scene.placements.filter((p) => p.breakable !== undefined);
    expect(breakables).toHaveLength(1);
    expect(breakables[0]?.breakable?.profile.id).toBe('old-wall');
    expect(breakables[0]?.breakable?.reveals).toBe('weak-wall-passage');
    expect(breakables[0]?.properties?.hp).toBe(100);
    const crate = scene.spawns.find((s) => s.id === 'loot-crate');
    expect(crate?.breakable?.contents?.map((prop) => prop.id)).toEqual(['plank']);
  });

  it('mw-e03.11: rejects a breakable naming no profile or an unknown key', () => {
    expect(sceneBreakableSchema.safeParse({}).success).toBe(false);
    expect(sceneBreakableSchema.safeParse({ profile: 'old-wall', hp: 3 }).success).toBe(false);
  });
});

describe('scene environment and regions (mw-ju8.1)', () => {
  it('AC-1: an environment fills the backdrop defaults and accepts sky, fog and regions', () => {
    const scene = sceneSchema.parse({
      ...room,
      environment: {
        sky: '#6A5A86',
        fog: { color: '#8a7a94', near: 10, far: 100 },
        backdrop: { image: 'backdrop-valley-01/far-mountains-castle.png' },
      },
      regions: [{ id: 'river', min: [0, -6, 0], max: [4, -2, 4], tags: ['water'] }],
    });
    expect(scene.environment?.backdrop).toEqual({
      image: 'backdrop-valley-01/far-mountains-castle.png',
      bearing: 0,
      arc: 100,
      radius: 150,
      centreY: 25,
      follow: 1,
    });
    expect(scene.regions[0]?.tags).toEqual(['water']);
    expect(sceneSchema.parse(room).regions).toEqual([]);
    expect(sceneSchema.parse(room).environment).toBeUndefined();
  });

  it('AC-1: rejects a bad colour, fog that ends before it starts and a backdrop outside the camera', () => {
    expect(problems({ ...room, environment: { sky: 'blue' } })).toEqual([
      'environment.sky: must be a #RRGGBB colour',
    ]);
    expect(
      problems({ ...room, environment: { fog: { color: '#aaaaaa', near: 50, far: 20 } } }),
    ).toEqual(['environment.fog.far: far must be beyond near']);
    expect(
      problems({ ...room, environment: { backdrop: { image: 'a/b.png', radius: 400 } } }),
    ).toHaveLength(1);
    expect(problems({ ...room, environment: { backdrop: { image: '../secret.txt' } } })).toEqual([
      'environment.backdrop.image: must be a relative image path such as backdrop-valley-01/far-mountains-castle.png',
    ]);
  });

  it('AC-1: rejects duplicate region ids and a region whose max is not above its min', () => {
    const region = { id: 'river', min: [0, 0, 0], max: [1, 1, 1] };
    expect(problems({ ...room, regions: [region, region] })).toEqual([
      'regions.1.id: region id "river" is used twice in this scene',
    ]);
    expect(problems({ ...room, regions: [{ ...region, max: [1, 0, 1] }] })).toEqual([
      'regions.0.max: max must be above min on every axis',
    ]);
  });
});
