// Persistence policies for entities (mw-e27.7): what settles when a level loads (wetness, fire) and
// what a rest resets, on plain worlds.
import { describe, expect, it } from 'vitest';
import { defineComponent, type EntityId } from '../core/component';
import { World } from '../core/world';
import { ActorElementsComponent } from '../elements/actors';
import { burntStatesOf } from '../elements/fire';
import { addProperties, readProperty, registerWorldProperties } from '../properties/components';
import type { MaterialPresets } from '../properties/materials';
import { restCompleted } from '../rest/rest';
import { componentPersistence, type PersistenceDeclaration } from './declarations';
import {
  markPersistent,
  registerPersistence,
  WorldPersistence,
  type LevelDeltas,
} from './persistence';
import { applyRestPolicies, installRestPolicies } from './rest';
import { levelDeltasOf, LevelDeltaStore } from './store';

const PRESETS: MaterialPresets = new Map([
  ['wood', { density: 700, friction: 0.5, flammable: true, fuel: 30 }],
  ['charred', { density: 300, friction: 0.8, flammable: false }],
  ['straw', { density: 100, friction: 0.5, flammable: true, fuel: 10 }],
]);
const burnt = burntStatesOf({
  presets: PRESETS,
  burnt: new Map([
    ['wood', 'charred'],
    ['straw', null],
  ]),
});

const newWorld = (): World<never> => {
  const world = registerPersistence(new World<never>({ seed: 2 }));
  registerWorldProperties(world);
  return world;
};

/** An authored prop of `material`, in the state given. */
function prop(world: World<never>, material: string, state: object = {}): EntityId {
  const entity = world.spawn();
  addProperties(world, entity, { material, flammable: true, fuel: 12, ...state });
  return entity;
}

const settling = new WorldPersistence({ settle: { burnt } });

describe('settling a loaded level', () => {
  it('AC-3: wetness is transient: a soaked prop is dry after loading', () => {
    const world = newWorld();
    const crate = prop(world, 'wood');
    const dry = prop(world, 'wood');
    const baseline = settling.baseline(world, 'room', [['spawn:crate', crate]]);
    addProperties(world, crate, { wetness: 0.9 });
    // Saving leaves it out of the level's deltas, and a load settles the world snapshot's value.
    expect(settling.capture(world, baseline).entities).toEqual([]);
    expect(settling.settle(world, baseline)).toEqual({ dried: 1, burnt: 0 });
    expect(readProperty(world, crate, 'wetness')).toBe(0);
    expect(readProperty(world, dry, 'wetness')).toBe(0);
  });

  it('transient properties settle to what the level authored, not always zero', () => {
    const world = newWorld();
    const ivy = prop(world, 'wood', { wetness: 0.2 });
    const rain = prop(world, 'wood', { wetness: 0.7 });
    const baseline = settling.baseline(world, 'room', [['spawn:ivy', ivy]]);
    addProperties(world, ivy, { wetness: 0.9 });
    expect(settling.settle(world, baseline)).toEqual({ dried: 2, burnt: 0 });
    expect(readProperty(world, ivy, 'wetness')).toBe(0.2);
    expect(readProperty(world, rain, 'wetness')).toBe(0);
    // Settling only takes away: a prop that dried below its authored damp stays as dry as it got.
    addProperties(world, ivy, { wetness: 0.05 });
    expect(settling.settle(world, baseline)).toEqual({ dried: 0, burnt: 0 });
    expect(readProperty(world, ivy, 'wetness')).toBe(0.05);
    addProperties(world, ivy, { wetness: 0.2 });
    // Already as authored: nothing to do.
    expect(settling.settle(world, baseline)).toEqual({ dried: 0, burnt: 0 });
  });

  it('AC-2: a fire burning at save time has burnt out to its burnt state when loaded', () => {
    const world = newWorld();
    const crate = prop(world, 'wood');
    const baseline = settling.baseline(world, 'room', [['spawn:crate', crate]]);
    addProperties(world, crate, { burning: true, fuel: 4, temperature: 400 });
    const report = settling.settle(world, baseline);
    expect(report.burnt).toBe(1);
    expect(readProperty(world, crate, 'burning')).toBe(false);
    expect(readProperty(world, crate, 'material')).toBe('charred');
    expect(readProperty(world, crate, 'flammable')).toBe(false);
  });

  it('a prop that burns away is gone, unless it stays when spent', () => {
    const world = newWorld();
    const hay = prop(world, 'straw');
    const lantern = prop(world, 'straw');
    const persistence = new WorldPersistence({
      settle: { burnt, keepWhenSpent: (_world, entity) => entity === lantern },
    });
    const baseline = persistence.baseline(world, 'room', [
      ['spawn:hay', hay],
      ['spawn:lantern', lantern],
    ]);
    for (const entity of [hay, lantern]) addProperties(world, entity, { burning: true });
    persistence.settle(world, baseline);
    expect(world.isAlive(hay)).toBe(false);
    expect(world.isAlive(lantern)).toBe(true);
    expect(readProperty(world, lantern, 'burning')).toBe(false);
  });

  it('fire the level’s data lit stays lit, and a data-forced actor fire is never settled', () => {
    const world = newWorld();
    world.register(ActorElementsComponent);
    const torch = prop(world, 'wood', { burning: true });
    const ghoul = prop(world, 'wood', { burning: true });
    world.add(ghoul, ActorElementsComponent, {
      resistances: {},
      aflame: true,
      heatInertia: 1,
    } as never);
    const baseline = settling.baseline(world, 'room', [['spawn:torch', torch]]);
    expect(settling.settle(world, baseline)).toEqual({ dried: 0, burnt: 0 });
    expect(readProperty(world, torch, 'burning')).toBe(true);
    expect(readProperty(world, ghoul, 'burning')).toBe(true);
  });

  it('a burning entity the level does not know leaves its fire alone, unless it persists with the level', () => {
    const world = newWorld();
    const sconce = prop(world, 'wood', { burning: true });
    const dropped = prop(world, 'wood', { burning: true });
    markPersistent(world, dropped, 'item', 'room');
    const baseline = settling.baseline(world, 'room', []);
    expect(settling.settle(world, baseline).burnt).toBe(1);
    expect(readProperty(world, sconce, 'burning')).toBe(true);
    expect(readProperty(world, dropped, 'burning')).toBe(false);
    // Without the component registered nothing persists with the level.
    const bare = new World<never>({ seed: 1 });
    registerWorldProperties(bare);
    const torch = prop(bare, 'wood', { burning: true });
    expect(settling.settle(bare, settling.baseline(bare, 'room', [])).burnt).toBe(0);
    expect(readProperty(bare, torch, 'burning')).toBe(true);
  });

  it('an actor’s fire just goes out: it keeps its material', () => {
    const world = newWorld();
    world.register(ActorElementsComponent);
    const skeleton = prop(world, 'wood', { burning: true });
    world.add(skeleton, ActorElementsComponent, {
      resistances: {},
      aflame: false,
      heatInertia: 1,
    } as never);
    const baseline = settling.baseline(world, 'room', []);
    settling.settle(world, baseline); // an actor needs no id: the player has none
    expect(readProperty(world, skeleton, 'burning')).toBe(false);
    expect(readProperty(world, skeleton, 'material')).toBe('wood');
  });

  it('leaves fires alone when no burnt states are configured', () => {
    const world = newWorld();
    const crate = prop(world, 'wood', { burning: true, wetness: 0.4 });
    const plain = new WorldPersistence();
    const baseline = plain.baseline(world, 'room', []); // not authored: dries to the default
    expect(plain.settle(world, baseline)).toEqual({ dried: 1, burnt: 0 });
    expect(readProperty(world, crate, 'burning')).toBe(true);
  });

  it('settles only the entities it is given, and applying a delta settles what it changed', () => {
    const world = newWorld();
    const a = prop(world, 'wood');
    const b = prop(world, 'wood');
    const baseline = settling.baseline(world, 'room', [
      ['spawn:a', a],
      ['spawn:b', b],
    ]);
    for (const entity of [a, b]) addProperties(world, entity, { wetness: 1 });
    expect(settling.settle(world, baseline, [a])).toEqual({ dried: 1, burnt: 0 });
    expect(readProperty(world, b, 'wetness')).toBe(1);
    // A level left with a fire burning loads with it burnt out.
    const deltas: LevelDeltas = {
      level: 'room',
      entities: [
        { id: 'spawn:a', aspects: { properties: { burning: true, fuel: 3 } } },
        { id: 'spawn:gone', aspects: { properties: { fuel: 1 } } },
      ],
      spawned: [],
    };
    const report = settling.apply(world, baseline, deltas);
    expect(report.skipped.map((s) => s.id)).toEqual(['spawn:gone']);
    expect(readProperty(world, a, 'burning')).toBe(false);
    expect(readProperty(world, a, 'material')).toBe('charred');
    expect(readProperty(world, b, 'wetness')).toBe(1);
  });
});

const Herb = defineComponent<{ readonly picked: boolean }>('test.herb');
const Lid = defineComponent<{ readonly open: boolean }>('test.lid');
const herb = componentPersistence('herb', Herb, {
  policy: 'rest-reset',
  pick: ({ picked }) => ({ picked }),
  restore: (world, entity, _value, delta) => {
    world.set(entity, Herb, delta);
  },
});
const lid = componentPersistence('lid', Lid, {
  pick: ({ open }) => ({ open }),
  restore: (world, entity, _value, delta) => {
    world.set(entity, Lid, delta);
  },
});
const scratch: PersistenceDeclaration<number, number> = {
  key: 'scratch',
  policy: 'transient',
  capture: () => 5,
  diff: (baseline, current) => (baseline === current ? undefined : current),
  apply: () => true,
};
const policied = new WorldPersistence({ declarations: [herb, lid, scratch] });

function meadow() {
  const world = newWorld();
  world.register(Herb, Lid);
  const plant = world.spawn();
  world.add(plant, Herb, { picked: false });
  const chest = world.spawn();
  world.add(chest, Lid, { open: false });
  const authored: [string, EntityId][] = [
    ['spawn:herb', plant],
    ['spawn:chest', chest],
  ];
  return { world, plant, chest, authored };
}

describe('declaration policies', () => {
  it('a transient declaration is never captured', () => {
    const { world, plant, authored } = meadow();
    const baseline = policied.baseline(world, 'meadow', authored);
    expect(baseline.states.get('spawn:herb')).toEqual({ herb: { picked: false } });
    world.set(plant, Herb, { picked: true });
    expect(policied.capture(world, baseline).entities).toEqual([
      { id: 'spawn:herb', aspects: { herb: { picked: true } } },
    ]);
  });

  it('a level that is not loaded forgets its rest-reset state on rest, and keeps the rest', () => {
    const world = newWorld();
    const store = levelDeltasOf(world);
    const rested = (): LevelDeltas => ({
      level: 'meadow',
      entities: [
        { id: 'spawn:herb', aspects: { herb: { picked: true } } },
        { id: 'spawn:mixed', aspects: { herb: { picked: true }, lid: { open: true } } },
        { id: 'spawn:gone', destroyed: true },
        { id: 'spawn:chest', aspects: { lid: { open: true } } },
      ],
      spawned: [],
    });
    expect(policied.resetOnRest(rested()).entities).toEqual([
      { id: 'spawn:mixed', aspects: { lid: { open: true } } },
      { id: 'spawn:gone', destroyed: true },
      { id: 'spawn:chest', aspects: { lid: { open: true } } },
    ]);
    const nothing: LevelDeltas = {
      level: 'x',
      entities: [{ id: 'a', aspects: { lid: {} } }],
      spawned: [],
    };
    expect(policied.resetOnRest(nothing)).toBe(nothing);
    expect(settling.resetOnRest(rested())).toEqual(rested()); // no rest-reset declaration

    // Through the store: enter a level, leave it, rest elsewhere, come back.
    const { world: w, plant, chest, authored } = meadow();
    const levels = levelDeltasOf(w);
    levels.enter(w, policied, 'meadow', authored);
    w.set(plant, Herb, { picked: true });
    w.set(chest, Lid, { open: true });
    levels.leave(w);
    expect(levels.rest(w)).toEqual({ stored: ['meadow'], live: 0 });
    expect(levels.deltas('meadow')?.entities).toEqual([
      { id: 'spawn:chest', aspects: { lid: { open: true } } },
    ]);
    expect(levels.rest(w)).toEqual({ stored: [], live: 0 });
    expect(store.rest(world)).toEqual({ stored: [], live: 0 });
  });

  it('AC-4: the chest looted in a loaded level stays looted through ten rests; the herb regrows', () => {
    const { world, plant, chest, authored } = meadow();
    const levels = levelDeltasOf(world);
    levels.enter(world, policied, 'meadow', authored);
    world.set(plant, Herb, { picked: true });
    world.set(chest, Lid, { open: true });
    expect(levels.rest(world)).toEqual({ stored: [], live: 1 });
    expect(world.get(plant, Herb)).toEqual({ picked: false });
    for (let rest = 0; rest < 9; rest++) levels.rest(world);
    expect(world.get(chest, Lid)).toEqual({ open: true });
    // A destroyed or unchanged entity is left alone.
    world.destroy(plant);
    expect(levels.rest(world).live).toBe(0);
  });

  it('rests apply to facts and levels together, on rest.completed only', () => {
    const { world, plant, authored } = meadow();
    world.facts.declare('camp.lit', { type: 'bool', default: false, persistence: 'reset-on-rest' });
    world.facts.set('camp.lit', true);
    levelDeltasOf(world).enter(world, policied, 'meadow', authored);
    world.set(plant, Herb, { picked: true });
    const seen: unknown[] = [];
    const stop = installRestPolicies(world, (resets) => seen.push(resets));
    world.events.flush();
    expect(world.facts.get('camp.lit')).toBe(true);
    world.events.emit(restCompleted, {
      tick: 0,
      actor: plant,
      kind: 'inn',
      hours: 8,
      point: 'sleeping-ox',
      wakes: { day: 2, minute: 360 },
    });
    world.events.flush();
    expect(seen).toEqual([{ facts: ['camp.lit'], levels: [], live: 1 }]);
    expect(world.facts.get('camp.lit')).toBe(false);
    stop();
    world.facts.set('camp.lit', true);
    world.events.emit(restCompleted, {
      tick: 0,
      actor: plant,
      kind: 'inn',
      hours: 8,
      point: 'sleeping-ox',
      wakes: { day: 3, minute: 360 },
    });
    world.events.flush();
    expect(world.facts.get('camp.lit')).toBe(true);
    expect(applyRestPolicies(world).facts).toEqual(['camp.lit']);
    installRestPolicies(world); // without a listener it still resets
  });
});

describe('policies and fact-gated (dormant) entities, mw-e27.8', () => {
  const deltaFor = (aspects: Record<string, unknown>): LevelDeltas => ({
    level: 'meadow',
    entities: [{ id: 'spawn:variant', aspects }],
    spawned: [],
  });

  it('a rest-reset aspect carried for a dormant spawn is reset on rest, the rest is kept', () => {
    const { world } = meadow();
    const baseline = policied.baseline(world, 'meadow', [], ['spawn:variant']);
    policied.apply(
      world,
      baseline,
      deltaFor({ herb: { picked: true }, lid: { open: true }, scratch: 5 }),
    );
    expect([...baseline.carried.keys()]).toEqual(['spawn:variant']);
    expect(policied.restLive(world, baseline)).toBe(0);
    expect(baseline.carried.get('spawn:variant')?.aspects).toEqual({
      lid: { open: true },
      scratch: 5,
    });
    // Nothing left to reset: untouched. An entry with only rest-reset state disappears.
    expect(policied.restLive(world, baseline)).toBe(0);
    policied.apply(world, baseline, {
      level: 'meadow',
      entities: [{ id: 'spawn:variant', aspects: { herb: { picked: true } } }],
      spawned: [],
    });
    policied.restLive(world, baseline);
    expect(baseline.carried.size).toBe(0);
  });

  it('a variant that wakes with carried state gets it applied (transient aspects skipped) and its authored wetness recorded', () => {
    const { world } = meadow();
    const baseline = policied.baseline(world, 'meadow', [], ['spawn:variant']);
    policied.apply(world, baseline, deltaFor({ lid: { open: true }, scratch: 5 }));
    const variant = world.spawn();
    world.add(variant, Lid, { open: false });
    addProperties(world, variant, { material: 'wood', wetness: 0.9 });
    const report = policied.activate(world, baseline, [['spawn:variant', variant]]);
    expect(report.skipped).toEqual([]);
    expect(world.get(variant, Lid)).toEqual({ open: true });
    expect(readProperty(world, variant, 'wetness')).toBe(0.9); // authored damp is kept
    expect(baseline.transient.get('spawn:variant')).toEqual({ wetness: 0.9 });
    // Retiring it again forgets its authored transients and keeps what it changed.
    policied.retire(world, baseline, ['spawn:variant']);
    expect(baseline.transient.has('spawn:variant')).toBe(false);
    expect(baseline.carried.get('spawn:variant')?.aspects).toEqual({ lid: { open: true } });
  });

  it('stored deltas of a level with a dormant spawn rest and settle through the store', () => {
    const { world, authored } = meadow();
    const levels = levelDeltasOf(world);
    levels.enter(world, policied, 'meadow', authored, ['spawn:variant']);
    expect(levels.rest(world)).toEqual({ stored: [], live: 0 });
  });
});

describe('rest-reset that cannot apply', () => {
  it('counts only the aspects that went back', () => {
    const { world, plant, authored } = meadow();
    const stubborn: PersistenceDeclaration<{ picked: boolean }, { picked: boolean }> = {
      ...herb,
      apply: () => false,
    };
    const persistence = new WorldPersistence({ declarations: [stubborn] });
    const baseline = persistence.baseline(world, 'meadow', authored);
    world.set(plant, Herb, { picked: true });
    expect(persistence.restLive(world, baseline)).toBe(0);
  });
});

describe('level store settling', () => {
  it('settles the loaded level, and nothing when none is loaded', () => {
    const world = newWorld();
    const store = new LevelDeltaStore();
    expect(store.settle(world)).toBeUndefined();
    const crate = prop(world, 'wood');
    store.enter(world, settling, 'room', [['spawn:crate', crate]]);
    addProperties(world, crate, { burning: true, wetness: 1 });
    expect(store.settle(world)).toEqual({ dried: 1, burnt: 1 });
    expect(readProperty(world, crate, 'material')).toBe('charred');
  });
});
