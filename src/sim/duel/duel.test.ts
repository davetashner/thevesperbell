// First-blood duels (mw-e39.35, mw-e40.11): the first hit ends the bout, nobody loses health, nobody
// dies, the duellist's brain is swapped for the duel behaviour and back.

import type { BehaviourDef, Frozen } from '@content/index';
import { describe, expect, it } from 'vitest';
import { compileBehaviours } from '../ai/behaviour';
import { brainOf, giveBrain, installAi } from '../ai/runtime';
import { DAMAGE_COMPONENTS, giveCombatant, healthOf } from '../combat/damage/components';
import { DamageModel } from '../combat/damage/model';
import { World } from '../core/world';
import { DUEL_GRACE_S, DuelEnded, FirstBloodDuels, type DuelEndedInfo } from './duel';

const behaviour = (id: string): Frozen<BehaviourDef> =>
  ({
    id,
    schemaVersion: 1,
    tuning: {},
    thinkHz: 10,
    inertia: 0.1,
    initial: 'unaware',
    states: {
      unaware: { transitions: [], timeoutFrom: 'entered', postAlert: false, activities: ['wait'] },
    },
    activities: {
      wait: {
        weight: 1,
        interruptible: true,
        retryAfterS: 0,
        considerations: [],
        steps: [{ do: 'wait', seconds: 1 }],
      },
    },
  }) as unknown as Frozen<BehaviourDef>;

function setup() {
  const world = new World<never>({ seed: 5 }).register(...DAMAGE_COMPONENTS);
  installAi(world, { behaviours: compileBehaviours([behaviour('shopkeeper'), behaviour('duel')]) });
  const damage = new DamageModel();
  const duels = new FirstBloodDuels(world, damage, 'duel');
  const player = world.spawn();
  giveCombatant(world, player, { health: 100, player: true });
  const tereza = world.spawn();
  giveCombatant(world, tereza, { health: 60 });
  giveBrain(world, tereza, {
    behaviour: 'shopkeeper',
    traits: { bravery: 0.9 },
    gaits: { sneak: 1, walk: 2, run: 4 },
  });
  const bystander = world.spawn();
  giveCombatant(world, bystander, { health: 10 });
  const ended: DuelEndedInfo[] = [];
  world.events.on(DuelEnded, (e) => ended.push(e));
  return { world, damage, duels, player, tereza, bystander, ended };
}

/** A hit, then a step so the bus delivers its events. */
const hit = (s: ReturnType<typeof setup>, from: number, to: number, slash = 500) => {
  const result = s.damage.apply(s.world, to, { instigator: from, amounts: { slash } });
  s.world.step();
  return result;
};

describe('first-blood duels', () => {
  it('AC-1: starting a duel swaps the duellist to the duel behaviour, keeping traits and gaits', () => {
    const s = setup();
    expect(s.duels.active).toBeUndefined();
    expect(s.duels.start(s.player, s.tereza)).toBe(true);
    expect(s.duels.active).toEqual({ player: s.player, duellist: s.tereza });
    const brain = brainOf(s.world, s.tereza);
    expect(brain?.behaviour).toBe('duel');
    expect(brain?.traits).toEqual({ bravery: 0.9 });
    expect(brain?.gaits).toEqual({ sneak: 1, walk: 2, run: 4 });
  });

  it('AC-1: one duel at a time; no brain or a dead duellist cannot duel', () => {
    const s = setup();
    expect(s.duels.start(s.player, s.bystander)).toBe(false);
    expect(s.duels.start(s.player, s.tereza)).toBe(true);
    expect(s.duels.start(s.player, s.tereza)).toBe(false);
    const dead = setup();
    dead.damage.apply(dead.world, dead.tereza, { amounts: { slash: 1000 } });
    expect(dead.duels.start(dead.player, dead.tereza)).toBe(false);
    expect(dead.duels.active).toBeUndefined();
  });

  it('AC-2: the player landing the first hit wins, with no damage, and she gets her old brain back', () => {
    const s = setup();
    s.duels.start(s.player, s.tereza);
    const result = hit(s, s.player, s.tereza);
    expect(result?.healthAfter).toBe(60);
    expect(result?.tags).toContain('duel');
    expect(healthOf(s.world, s.tereza)?.current).toBe(60);
    expect(s.ended).toMatchObject([{ player: s.player, duellist: s.tereza, victor: 'player' }]);
    expect(s.duels.active).toBeUndefined();
    const brain = brainOf(s.world, s.tereza);
    expect(brain?.behaviour).toBe('shopkeeper');
    expect(brain?.traits).toEqual({ bravery: 0.9 });
    expect(brain?.gaits).toEqual({ sneak: 1, walk: 2, run: 4 });
  });

  it('AC-3: the duellist landing the first hit wins, and the player loses no health', () => {
    const s = setup();
    s.duels.start(s.player, s.tereza);
    hit(s, s.tereza, s.player);
    expect(healthOf(s.world, s.player)?.current).toBe(100);
    expect(s.ended.map((e) => e.victor)).toEqual(['duellist']);
  });

  it('AC-4: a swing in flight stays harmless for the grace period, then hits count again', () => {
    const s = setup();
    s.duels.start(s.player, s.tereza);
    hit(s, s.player, s.tereza);
    hit(s, s.tereza, s.player);
    expect(healthOf(s.world, s.player)?.current).toBe(100);
    expect(s.ended).toHaveLength(1);
    for (let i = 0; i < Math.round(DUEL_GRACE_S * s.world.clock.hz) + 1; i++) s.world.step();
    hit(s, s.tereza, s.player, 30);
    expect(healthOf(s.world, s.player)?.current).toBe(70);
    expect(s.ended).toHaveLength(1);
  });

  it('AC-5: hits from or to anyone else are untouched and do not end the duel', () => {
    const s = setup();
    s.duels.start(s.player, s.tereza);
    hit(s, s.player, s.bystander, 4);
    hit(s, s.bystander, s.tereza, 4);
    hit(s, s.bystander, s.player, 4);
    hit(s, s.player, s.player, 4);
    s.damage.apply(s.world, s.tereza, { amounts: { slash: 4 } });
    s.world.step();
    expect(healthOf(s.world, s.bystander)?.current).toBe(6);
    expect(healthOf(s.world, s.tereza)?.current).toBe(52);
    expect(healthOf(s.world, s.player)?.current).toBe(92);
    expect(s.ended).toEqual([]);
    expect(s.duels.active).toBeDefined();
  });

  it('AC-6: outside a duel nothing is zeroed', () => {
    const s = setup();
    expect(hit(s, s.player, s.tereza, 10)?.healthAfter).toBe(50);
    expect(hit(s, s.player, s.tereza, 10)?.healthAfter).toBe(40);
  });

  it('AC-7: abandoning ends it with no victor; with none running it does nothing', () => {
    const s = setup();
    expect(s.duels.abandon()).toBe(false);
    s.duels.start(s.player, s.tereza);
    expect(s.duels.abandon()).toBe(true);
    s.world.step();
    expect(s.ended.map((e) => e.victor)).toEqual(['none']);
    expect(brainOf(s.world, s.tereza)?.behaviour).toBe('shopkeeper');
  });

  it('AC-7: a duellist who is gone abandons the duel on update; a live one does not', () => {
    const s = setup();
    s.duels.update();
    s.duels.start(s.player, s.tereza);
    s.duels.update();
    expect(s.duels.active).toBeDefined();
    s.world.destroy(s.tereza);
    s.world.step();
    s.duels.update();
    expect(s.duels.active).toBeUndefined();
    s.world.step();
    expect(s.ended.map((e) => e.victor)).toEqual(['none']);
  });
});
