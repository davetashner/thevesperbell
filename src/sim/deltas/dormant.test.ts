// mw-e27.8 AC-4: entities of fact-gated spawns that are not spawned now keep their deltas; when they
// spawn again the deltas are applied, so what happened to them is still true.
import { describe, expect, it } from 'vitest';
import { defineComponent } from '../core/component';
import { World } from '../core/world';
import { InMemoryColliderSink } from '../physics/static-colliders';
import { testKit } from '../scene/fixtures';
import { loadScene, registerSceneComponents } from '../scene/loader';
import { componentPersistence } from './declarations';
import { sceneDormantEntities, WorldPersistence } from './persistence';
import { LevelDeltaStore } from './store';

interface Hits {
  readonly n: number;
}
const HitsComponent = defineComponent<Hits>('test.hits');
const hits = componentPersistence<Hits, Hits>('hits', HitsComponent, {
  pick: (value) => ({ n: value.n }),
  restore: (world, entity, _value, delta) => {
    world.add(entity, HitsComponent, { n: delta.n });
  },
});
const persistence = new WorldPersistence({ declarations: [hits] });

const LEVEL = 'dormant-room';

function setup() {
  const world = new World<never>({ seed: 1 }).register(HitsComponent);
  const store = new LevelDeltaStore();
  const spawn = (n = 0) => {
    const entity = world.spawn();
    world.add(entity, HitsComponent, { n });
    return entity;
  };
  return { world, store, spawn };
}

describe('dormant level entities (mw-e27.8)', () => {
  it('AC-4: a despawned entity keeps its delta, and a respawn applies it again', () => {
    const { world, store, spawn } = setup();
    const door = spawn();
    store.enter(world, persistence, LEVEL, [['spawn:door', door]]);
    world.add(door, HitsComponent, { n: 3 });
    // The fact gate closes: the entity goes, its changes are kept.
    store.retire(world, ['spawn:door', 'spawn:never-there']);
    world.destroy(door);
    expect(store.capture(world)[0]?.entities).toEqual([
      { id: 'spawn:door', aspects: { hits: { n: 3 } } },
    ]);
    // It opens again: a fresh entity gets the kept delta.
    const back = spawn();
    const report = store.activate(world, [['spawn:door', back]]);
    expect(report.applied).toBe(1);
    expect(world.get(back, HitsComponent)).toEqual({ n: 3 });
    expect(store.capture(world)[0]?.entities).toEqual([
      { id: 'spawn:door', aspects: { hits: { n: 3 } } },
    ]);
  });

  it('a destroyed entity stays destroyed when it spawns again; an unchanged one keeps no delta', () => {
    const { world, store, spawn } = setup();
    const broken = spawn();
    const plain = spawn();
    store.enter(world, persistence, LEVEL, [
      ['spawn:broken', broken],
      ['spawn:plain', plain],
    ]);
    world.destroy(broken);
    store.retire(world, ['spawn:broken', 'spawn:plain']);
    world.destroy(plain);
    expect(store.capture(world)[0]?.entities).toEqual([{ id: 'spawn:broken', destroyed: true }]);
    const again = spawn();
    const again2 = spawn();
    store.activate(world, [
      ['spawn:broken', again],
      ['spawn:plain', again2],
    ]);
    expect(world.isAlive(again)).toBe(false);
    expect(world.isAlive(again2)).toBe(true);
  });

  it('deltas stored for a dormant entity survive a level visit that does not spawn it', () => {
    const first = setup();
    const door = first.spawn();
    first.store.enter(first.world, persistence, LEVEL, [['spawn:door', door]]);
    first.world.add(door, HitsComponent, { n: 2 });
    const saved = first.store.leave(first.world);

    // Next visit: the gate is closed, so there is no entity; the delta is neither lost nor an error.
    const second = setup();
    second.store.restore([saved]);
    const warnings: string[] = [];
    const quiet = new WorldPersistence({ declarations: [hits], warn: (m) => warnings.push(m) });
    const entered = second.store.enter(second.world, quiet, LEVEL, [], ['spawn:door']);
    expect(entered.report?.skipped).toEqual([]);
    expect(warnings).toEqual([]);
    expect(second.store.capture(second.world)[0]?.entities).toEqual(saved.entities);

    // Then the gate opens.
    const back = second.spawn();
    second.store.activate(second.world, [['spawn:door', back]]);
    expect(second.world.get(back, HitsComponent)).toEqual({ n: 2 });
  });

  it('carried deltas are listed after live ones, in id order; an id the level has twice is refused', () => {
    const { world, store, spawn } = setup();
    const a = spawn();
    const b = spawn();
    const live = spawn();
    store.enter(world, persistence, LEVEL, [
      ['spawn:b', b],
      ['spawn:a', a],
      ['spawn:live', live],
    ]);
    for (const e of [a, b, live]) world.add(e, HitsComponent, { n: 1 });
    store.retire(world, ['spawn:b', 'spawn:a']);
    expect(store.capture(world)[0]?.entities.map((e) => e.id)).toEqual([
      'spawn:live',
      'spawn:a',
      'spawn:b',
    ]);
    expect(() => store.activate(world, [['spawn:live', spawn()]])).toThrow(RangeError);
  });

  it('an entity the declarations do not cover can still join the level', () => {
    const { world, store, spawn } = setup();
    store.enter(world, persistence, LEVEL, [['spawn:a', spawn()]]);
    const bare = world.spawn();
    expect(store.activate(world, [['spawn:bare', bare]]).applied).toBe(0);
    expect(store.capture(world)[0]?.entities).toEqual([]);
  });

  it('retire and activate need a loaded level', () => {
    const { world, store } = setup();
    expect(() => {
      store.retire(world, []);
    }).toThrow('no level is loaded');
    expect(() => store.activate(world, [])).toThrow('no level is loaded');
  });
});

describe('sceneDormantEntities', () => {
  it('names the spawn, and the creature of a creature spawn, of every spawn the gates left out', () => {
    const world = registerSceneComponents(new World<never>({ seed: 1 }));
    const gate = { spawnIf: { fact: 'open' } };
    const loaded = loadScene(
      world,
      {
        id: 'dormant-scene',
        grid: 1,
        placements: [],
        spawns: [
          { id: 'here', at: [0, 0, 0], yaw: 0, tags: [] },
          { id: 'prop', at: [1, 0, 0], yaw: 0, tags: [], ...gate },
          { id: 'npc', at: [2, 0, 0], yaw: 0, tags: [], creature: { id: 'hollis' }, ...gate },
        ],
      },
      testKit,
      new InMemoryColliderSink(),
    );
    expect(sceneDormantEntities(loaded)).toEqual(['spawn:prop', 'spawn:npc', 'creature:npc']);
  });
});
