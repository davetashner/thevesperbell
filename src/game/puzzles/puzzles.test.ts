import { describe, expect, it } from 'vitest';
import { loadGameContent, puzzleSchema } from '@content/index';
import {
  addProperties,
  capabilityUsed,
  registerSceneComponents,
  registerWorldProperties,
  setProperty,
  spawnSceneSpawn,
  World,
  type EntityId,
  type SceneSpawnPlacement,
} from '@sim/index';
import { PuzzleWatch, puzzleDefs, sceneHost, startPuzzles } from './index';

const content = loadGameContent();

describe('puzzles in the game (mw-e15.3)', () => {
  it('turns the content puzzles of a scene into runtime definitions', () => {
    const defs = puzzleDefs(content, 'brazier-hall');
    expect(defs.map((def) => def.id)).toEqual(['brazier-hall']);
    expect(defs[0]).toMatchObject({
      repeatable: false,
      discovery: { volume: { kind: 'box' } },
      solutions: [
        { id: 'carry-flame', capabilities: [] },
        { id: 'fire-from-range', capabilities: ['spell.ember'] },
      ],
      outputs: {
        solvedFact: 'brazier-hall.solved',
        signals: ['brazier-hall/vault-latch'],
        rewards: ['brazier-hall-vault'],
      },
    });
    expect(defs[0]?.entities).toContainEqual({ id: 'torch-barrel', critical: true });
    expect(puzzleDefs(content, 'mechanism-room')).toEqual([]);
    // A puzzle with no discovery rule carries none.
    expect(puzzleDefs(content, 'testbed')[0]).not.toHaveProperty('discovery');
  });

  function world() {
    const w = registerWorldProperties(new World<never>({ seed: 1, hz: 10 }));
    registerSceneComponents(w);
    w.facts.declare('brazier-hall.solved', { type: 'bool', default: false });
    w.facts.declare('brazier-hall.vault-open', { type: 'bool', default: false });
    return w;
  }

  it('starts nothing for a scene without puzzles', () => {
    const w = world();
    expect(startPuzzles(w, content, 'mechanism-room')).toBeUndefined();
    expect(w.entityCount).toBe(0);
  });

  it('runs the scene’s puzzles and reports an undeclared solve', () => {
    const w = world();
    const braziers = ['brazier-west', 'brazier-north', 'brazier-east'].map((id) => {
      const entity = spawnSceneSpawn(w, 'brazier-hall', {
        id,
        tags: ['brazier'],
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
      } as never);
      addProperties(w, entity, { burning: false });
      return entity;
    });
    const player = w.spawn();
    const lines: string[] = [];
    // The shipped puzzle has a route for anyone, so nothing is undeclared there; a stand-in that
    // declares only Ember shows the report.
    const stub = {
      all: () => [
        {
          ...content.all('puzzle').find((p) => p.id === 'brazier-hall'),
          solutions: [{ id: 'ember', name: 'Ember', capabilities: ['spell.ember'], steps: [] }],
        },
      ],
    };
    const runtime = startPuzzles(w, stub as never, 'brazier-hall', {
      player,
      report: (line) => lines.push(line),
    });
    expect(runtime?.ids).toEqual(['brazier-hall']);
    const watch = new PuzzleWatch(runtime as never);
    const first = watch.changed();
    expect(first).toContain('"state":"dormant"');
    expect(watch.changed()).toBeUndefined(); // unchanged since
    w.events.emit(capabilityUsed, { actor: player, capability: 'spell.mage-hand', tick: 0 });
    for (const entity of braziers) setProperty(w, entity, 'burning', true);
    for (let i = 0; i < 15; i++) w.step();
    expect(watch.readout()[0]).toMatchObject({ state: 'solved', attribution: 'undeclared' });
    expect(watch.changed()).toContain('"attribution":"undeclared"');
    expect(lines).toEqual([
      expect.stringMatching(
        /puzzle brazier-hall solved at tick \d+ by an undeclared route \(capabilities used: spell\.mage-hand\)/,
      ),
    ]);
  });

  it('says "none" for an undeclared solve with no capabilities used', () => {
    const w = world();
    const entity = spawnSceneSpawn(w, 'brazier-hall', {
      id: 'brazier-west',
      tags: ['brazier'],
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    } as never);
    addProperties(w, entity, { burning: false });
    const lines: string[] = [];
    const stub = {
      all: () => [
        {
          ...content.all('puzzle').find((p) => p.id === 'brazier-hall'),
          solutions: [{ id: 'ember', name: 'Ember', capabilities: ['spell.ember'], steps: [] }],
        },
      ],
    };
    startPuzzles(w, stub as never, 'brazier-hall', { report: (line) => lines.push(line) });
    setProperty(w, entity, 'burning', true);
    for (let i = 0; i < 15; i++) w.step();
    expect(lines[0]).toContain('capabilities used: none');
  });
});

describe('puzzle recovery policies in the game (mw-e15.7)', () => {
  it('carries a respawn policy through, and builds a reset from the scene’s authored doors and switches', () => {
    const [hall] = puzzleDefs(content, 'brazier-hall');
    expect(hall?.recovery).toEqual([{ kind: 'respawn', entity: 'torch-barrel', seconds: 10 }]);
    const puzzle = puzzleSchema.parse({
      id: 'mechanism-reset',
      name: 'Reset the mechanism room',
      notes: 'A synthetic puzzle for the reset mapping.',
      scene: 'mechanism-room',
      entities: [
        { id: 'north-lever', role: 'lever' },
        { id: 'north-gate', role: 'gate' },
        { id: 'south-door', role: 'locked door' },
        { id: 'floor-crank', role: 'crank' },
        { id: 'east-button', role: 'button' },
      ],
      goal: {
        entities: { entity: 'north-gate' },
        where: [{ test: 'element', element: 'fire' }],
        match: 'all',
      },
      solutions: [{ id: 'a', name: 'A', steps: [{ do: 'wait', seconds: 1 }] }],
      policy: { recovery: [{ kind: 'reset', trigger: 'north-lever', fact: 'a.resets' }] },
      outputs: { solvedFact: 'a.solved' },
    });
    const stub = {
      all: (type: string) =>
        type === 'puzzle' ? [puzzle] : (content.all as (t: string) => unknown[])(type),
    } as unknown as Parameters<typeof puzzleDefs>[0];
    const [def] = puzzleDefs(stub, 'mechanism-room');
    const [policy] = def?.recovery ?? [];
    const sorted =
      policy?.kind === 'reset'
        ? {
            ...policy,
            mechanisms: [...policy.mechanisms].sort((a, b) => a.spawn.localeCompare(b.spawn)),
          }
        : policy;
    expect([sorted]).toEqual([
      {
        kind: 'reset',
        trigger: 'north-lever',
        fact: 'a.resets',
        mechanisms: [
          { spawn: 'east-button', switch: { position: 0 } },
          { spawn: 'floor-crank', switch: { position: 0 } },
          { spawn: 'north-gate', door: { open: false, jammed: false, locked: false } },
          { spawn: 'north-lever', switch: { position: 0 } },
          { spawn: 'south-door', door: { open: false, jammed: false, locked: true } },
        ],
      },
    ]);
  });
});

describe('the scene host of a puzzle respawner (mw-e15.7)', () => {
  const placement = (id: string, prop?: string) =>
    ({
      id,
      prop,
      position: { x: 1, y: 2, z: 3 },
      yaw: 0,
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      tags: [],
    }) as unknown as SceneSpawnPlacement;

  function host(authored: SceneSpawnPlacement[], loaded = true) {
    const w = registerWorldProperties(new World<never>({ seed: 1, hz: 10 }));
    registerSceneComponents(w);
    const made: EntityId[] = [];
    const bound: EntityId[] = [];
    const removed: string[] = [];
    const loader = {
      current: loaded ? { id: 'room', authoredSpawns: authored } : undefined,
      addSpawn: () => w.spawn(),
      addSpawnToSim: () => {
        const entity = w.spawn();
        made.push(entity);
        return entity;
      },
      bindSpawn: (_spawn: SceneSpawnPlacement, entity: EntityId) => bound.push(entity),
      removeSpawn: (id: string) => {
        removed.push(id);
        return true;
      },
    };
    return { w, made, bound, removed, host: sceneHost(w, loader as never, content) };
  }

  it('says what a fresh copy occupies, for a movable prop only', () => {
    const { host: h } = host([
      placement('barrel', 'barrel'),
      placement('marker'),
      placement('lever', 'lever'),
    ]);
    const spot = h.footprint('barrel');
    expect(spot?.centre).toMatchObject({ x: 1, z: 3 });
    expect(spot?.centre.y).toBeGreaterThan(2);
    expect(spot?.halfExtents.x).toBeGreaterThan(0);
    expect(h.footprint('marker')).toBeUndefined();
    expect(h.footprint('lever')).toBeUndefined();
    expect(h.footprint('nothing')).toBeUndefined();
  });

  it('adds a copy in the sim at once and binds its render object on flush, if it still lives', () => {
    const s = host([placement('barrel', 'barrel')]);
    s.host.spawn('barrel');
    s.host.spawn('barrel');
    expect(s.made).toHaveLength(2);
    expect(s.bound).toEqual([]);
    s.w.destroy(s.made[1] as EntityId);
    s.host.flush();
    expect(s.bound).toEqual([s.made[0]]);
    s.host.flush();
    expect(s.bound).toHaveLength(1);
    s.host.remove('barrel');
    expect(s.removed).toEqual(['barrel']);
  });

  it('adds nothing for an unknown spawn or without a loaded scene', () => {
    const s = host([placement('barrel', 'barrel')]);
    s.host.spawn('nothing');
    expect(s.made).toEqual([]);
    const none = host([placement('barrel', 'barrel')], false);
    none.host.spawn('barrel');
    expect(none.made).toEqual([]);
  });
});
