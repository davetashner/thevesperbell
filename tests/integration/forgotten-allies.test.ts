// The Forgotten are one faction: their swings and arrows do not hurt each other, while the player's
// attacks and the world's damage still hurt them (mw-qfx).
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { loadDevContent } from '@content/dev-content';
import {
  creatureEntities,
  CreatureComponent,
  DamageApplied,
  DamageModel,
  factionOf,
  healthOf,
  type EntityId,
  World,
} from '@sim/index';
import { alliedByFaction } from '../../src/game/combat/testbed-combat';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';

const content = loadDevContent();
const game = (scene: string) =>
  createGameWorld<unknown>(RAPIER, { seed: 1, hz: 60, scene, content });

const creatureId = (world: World<never>, entity: EntityId) =>
  world.get(entity, CreatureComponent)?.origin.creature;

describe('the Forgotten are allies (mw-qfx)', () => {
  it('AC-1: every Forgotten creature belongs to the forgotten faction, and the player to none', () => {
    const { world, player } = game('valley-02');
    const forgotten = creatureEntities(world).filter((e) =>
      (creatureId(world, e) ?? '').startsWith('forgotten-'),
    );
    expect(forgotten.length).toBeGreaterThan(1);
    for (const e of forgotten) expect(factionOf(world, e)).toBe('forgotten');
    expect(factionOf(world, player)).toBeUndefined();
  });

  it('AC-2: the ally rule spares a Forgotten from another Forgotten, but not the player or the world', () => {
    const { world, player } = game('valley-02');
    const [a, b] = creatureEntities(world).filter((e) => factionOf(world, e) === 'forgotten');
    if (a === undefined || b === undefined) throw new Error('need two Forgotten');
    expect(alliedByFaction(world, a, b)).toBe(true);
    expect(alliedByFaction(world, player, a)).toBe(false);
    expect(alliedByFaction(world, a, player)).toBe(false);
    // A world without factions installed has no allies (player melee and arrows are unaffected).
    expect(alliedByFaction(new World<never>({ seed: 1 }), a, b)).toBe(false);
  });

  it('AC-5: fire (world damage, no ally rule) still hurts a Forgotten creature', () => {
    const { world } = game('valley-02');
    const target = creatureEntities(world).find((e) => factionOf(world, e) === 'forgotten');
    if (target === undefined) throw new Error('no Forgotten');
    const before = healthOf(world, target)?.current ?? 0;
    new DamageModel().apply(world, target, { amounts: { fire: 20 } });
    expect(healthOf(world, target)?.current ?? 0).toBeLessThan(before);
  });

  it('AC-6: valley-02 with an idle player for 3 minutes: no Forgotten damages another', () => {
    const { world } = game('valley-02');
    const friendly: string[] = [];
    world.events.on(DamageApplied, (e) => {
      const from = e.packet.instigator;
      if (from === null) return;
      if (factionOf(world, from) === 'forgotten' && factionOf(world, e.target) === 'forgotten')
        friendly.push(`${String(from)}->${String(e.target)}@${String(e.tick)}`);
    });
    for (let i = 0; i < 60 * 180; i++) world.step();
    expect(friendly).toEqual([]);
  }, 120_000);
});
