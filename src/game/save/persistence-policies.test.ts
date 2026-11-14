// Persistence policies through the save (mw-e27.7): transient state is not saved, what was burning
// has burnt out and a timer that ran out while the game was away has fired by the time it loads.
import { factSchema, type GameEntry } from '@content/index';
import {
  addProperties,
  burntStatesOf,
  declareFacts,
  levelDeltasOf,
  readProperty,
  registerPersistence,
  registerWorldProperties,
  World,
  WorldPersistence,
  type EntityId,
  type MaterialPresets,
} from '@sim/index';
import { describe, expect, it } from 'vitest';
import { decodeSave, encodeSave } from './format';
import { createGameSaveRegistry } from './sections';
import { WORLD_FACTS_SECTION_ID } from './world-facts';

const build = { gameVersion: '0.1.0', buildSha: 'deadbee', contentHash: 'c0ffee' };
const options = { build, wallClockSavedAt: 1_790_000_000_000 };

const PRESETS: MaterialPresets = new Map([
  ['wood', { density: 700, friction: 0.5, flammable: true, fuel: 30 }],
  ['charred', { density: 300, friction: 0.8, flammable: false }],
]);
const persistence = new WorldPersistence({
  settle: { burnt: burntStatesOf({ presets: PRESETS, burnt: new Map([['wood', 'charred']]) }) },
});

const facts = factSchema.parse({
  id: 'policies',
  name: 'Policies',
  notes: 'Test registry for mw-e27.7.',
  facts: [
    {
      key: 'entity:*.looted',
      type: 'bool',
      default: false,
      description: 'Looted.',
      owner: 'loot',
      persistence: 'permanent',
    },
    {
      key: 'alarm.raised',
      type: 'bool',
      default: false,
      description: 'The alarm is up.',
      owner: 'test',
      persistence: 'transient',
    },
    {
      key: 'camp.restocked',
      type: 'bool',
      default: false,
      description: 'The camp restocked.',
      owner: 'test',
      persistence: 'reset-after',
      resetAfter: 72_000,
    },
    {
      key: 'barn.state',
      type: 'enum',
      values: ['standing', 'burning', 'burnt'],
      default: 'standing',
      description: 'The barn.',
      owner: 'test',
      persistence: 'decays-to',
      decaysTo: { from: ['burning'], to: 'burnt' },
    },
  ],
}) as unknown as GameEntry<'fact'>;

/** A world with one authored crate in the level "room": the same ids every time. */
function room(): { world: World<never>; crate: EntityId } {
  const world = registerPersistence(new World<never>({ seed: 7 }));
  registerWorldProperties(world);
  declareFacts(world.facts, [facts], { mode: 'throw' });
  const crate = world.spawn();
  addProperties(world, crate, { material: 'wood', flammable: true, fuel: 20 });
  levelDeltasOf(world).enter(world, persistence, 'room', [['spawn:crate', crate]]);
  return { world, crate };
}

describe('persistence policies in saves', () => {
  it('AC-3: wetness is not saved: a soaked crate loads dry', () => {
    const { world, crate } = room();
    addProperties(world, crate, { wetness: 0.8 });
    const registry = createGameSaveRegistry();
    const bytes = registry.write(world, options);

    const loaded = room();
    addProperties(loaded.world, loaded.crate, { wetness: 0.3 });
    const result = registry.read(loaded.world, bytes);
    expect(result.ok).toBe(true);
    expect(readProperty(loaded.world, loaded.crate, 'wetness')).toBe(0);
  });

  it('AC-2: a crate burning at save time is burnt, not burning, when loaded', () => {
    const { world, crate } = room();
    addProperties(world, crate, { burning: true, fuel: 6, temperature: 450 });
    const registry = createGameSaveRegistry();
    const bytes = registry.write(world, options);

    const loaded = room();
    expect(registry.read(loaded.world, bytes).ok).toBe(true);
    expect(readProperty(loaded.world, loaded.crate, 'burning')).toBe(false);
    expect(readProperty(loaded.world, loaded.crate, 'material')).toBe('charred');
    expect(readProperty(loaded.world, loaded.crate, 'flammable')).toBe(false);
  });

  it('a save without level deltas settles the loaded level too', () => {
    const { world, crate } = room();
    addProperties(world, crate, { burning: true });
    const registry = createGameSaveRegistry();
    const decoded = decodeSave(registry.write(world, options));
    if (!decoded.ok) throw decoded.error;
    const sections = Object.fromEntries(
      Object.entries(decoded.envelope.sections).filter(([id]) => id !== 'level-deltas'),
    );
    const bytes = encodeSave({ ...decoded.envelope, sections });

    const loaded = room();
    expect(registry.read(loaded.world, bytes).ok).toBe(true);
    expect(readProperty(loaded.world, loaded.crate, 'material')).toBe('charred');
  });

  it('facts: transient ones are not written; decays-to and permanent ones keep their rules', () => {
    const { world } = room();
    world.facts.set('alarm.raised', true);
    world.facts.set('barn.state', 'burning');
    world.facts.set('entity:room/chest-1.looted', true);
    const registry = createGameSaveRegistry();
    const bytes = registry.write(world, options);
    const decoded = decodeSave(bytes);
    if (!decoded.ok) throw decoded.error;
    expect(decoded.envelope.sections[WORLD_FACTS_SECTION_ID]?.data).toEqual({
      facts: { 'barn.state': 'burning', 'entity:room/chest-1.looted': true },
    });

    const loaded = room();
    expect(registry.read(loaded.world, bytes).ok).toBe(true);
    expect(loaded.world.facts.get('alarm.raised')).toBe(false);
    expect(loaded.world.facts.get('barn.state')).toBe('burnt');
    expect(loaded.world.facts.get('entity:room/chest-1.looted')).toBe(true);
  });

  it('AC-1: a reset-after fact whose time passed by the time the game loads is its default', () => {
    const registry = createGameSaveRegistry();
    const saveAfter = (ticks: number): Uint8Array => {
      const { world } = room();
      world.facts.set('camp.restocked', true);
      for (let tick = 0; tick < ticks; tick++) world.step();
      return registry.write(world, options);
    };
    const sooner = room();
    expect(registry.read(sooner.world, saveAfter(71_999)).ok).toBe(true);
    expect(sooner.world.facts.get('camp.restocked')).toBe(true);
    expect(sooner.world.facts.has('camp.restocked.written-at')).toBe(true);

    const later = room();
    expect(registry.read(later.world, saveAfter(72_000)).ok).toBe(true);
    expect(later.world.facts.get('camp.restocked')).toBe(false);
    expect(later.world.facts.has('camp.restocked.written-at')).toBe(false);
  });

  it('an older save holding facts a policy now keeps out still loads (compatibility)', () => {
    const registry = createGameSaveRegistry();
    const { world } = room();
    const decoded = decodeSave(registry.write(world, options));
    if (!decoded.ok) throw decoded.error;
    // Saved by a build that knew nothing of policies: the transient fact is in it, with no timer.
    const old = encodeSave({
      ...decoded.envelope,
      sections: {
        ...decoded.envelope.sections,
        [WORLD_FACTS_SECTION_ID]: {
          version: 1,
          data: {
            facts: { 'alarm.raised': true, 'camp.restocked': true, 'entity:room/c.looted': true },
          },
        },
      },
    });
    const loaded = room();
    const result = registry.read(loaded.world, old);
    expect(result.ok).toBe(true);
    expect(loaded.world.facts.get('alarm.raised')).toBe(false);
    expect(loaded.world.facts.get('camp.restocked')).toBe(true); // no timer saved: it starts now
    expect(loaded.world.facts.get('entity:room/c.looted')).toBe(true);
  });
});
