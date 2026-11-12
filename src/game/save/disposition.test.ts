// Disposition in saves (mw-e12.9 AC-5): a creature's disposition toward the player is part of the
// world section, so a loaded game reads exactly what was saved, including the time it decays from.
import {
  buildFactionTable,
  Dispositions,
  hashWorld,
  installFactions,
  joinFaction,
  World,
} from '@sim/index';
import { describe, expect, it } from 'vitest';
import { createGameSaveRegistry } from './sections';

const build = { gameVersion: '0.1.0', buildSha: 'deadbee', contentHash: 'c0ffee' };
const saveOptions = { build, wallClockSavedAt: 1_790_000_000_000 };
const factions = buildFactionTable([
  {
    id: 'folk',
    towardPlayer: 'friendly',
    towardMembers: 'ally',
    towardOthers: 'neutral',
    relations: [],
  },
]);

function folkWorld() {
  const world = installFactions(new World<never>({ seed: 5 }));
  const entity = world.spawn();
  joinFaction(world, factions, entity, 'folk');
  return { world, entity };
}

describe('disposition save', () => {
  it('AC-5: a creature saved at -37 loads at exactly -37, and decay continues from the save', () => {
    const { world, entity } = folkWorld();
    const config = { factions, rules: new Map() };
    const minutes = { now: 100 };
    const before = new Dispositions(world, {
      ...config,
      now: () => minutes.now,
      defaultsOf: () => ({ baseline: 0, decayPerMinute: 0.5 }),
    });
    before.adjust(entity, -67, 'test'); // seeded 0 -> -67
    minutes.now = 140; // decays by 20 -> -47, then a change of +10 settles it at -37
    before.adjust(entity, 10, 'test');
    expect(before.get(entity)).toBe(-37);

    const bytes = createGameSaveRegistry().write(world, saveOptions);
    const loaded = installFactions(new World<never>({ seed: 99 }));
    expect(createGameSaveRegistry().read(loaded, bytes).ok).toBe(true);

    const after = new Dispositions(loaded, { ...config, now: () => 140 });
    expect(after.get(entity)).toBe(-37);
    expect(hashWorld(loaded)).toBe(hashWorld(world));
    expect(new Dispositions(loaded, { ...config, now: () => 150 }).get(entity)).toBe(-32);
  });

  it('a world with no touched disposition saves without the component', () => {
    const { world } = folkWorld();
    const bytes = createGameSaveRegistry().write(world, saveOptions);
    const loaded = installFactions(new World<never>({ seed: 1 }));
    expect(createGameSaveRegistry().read(loaded, bytes).ok).toBe(true);
    expect(hashWorld(loaded)).toBe(hashWorld(world));
  });
});
