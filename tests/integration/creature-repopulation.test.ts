// mw-ju8.29: skeletons come back after the player sleeps. Headless, on the real valley-01 scene and the
// game's own wiring (createGameWorld, the level delta store, the transit carry and the rest module):
// kill a miner, cross out (the carry is the same data a save holds), rest at an inn, cross back in,
// and the scene rebuilds with the miner at its spawn, full health and unaware; without a rest it
// stays dead. The rules are src/sim/creatures/repopulation.test.ts.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { markExercised } from '@content/testing';
import { repopulateOnArrival } from '@game/creatures/repopulation';
import { createGameSaveRegistry } from '@game/save/sections';
import { applyCarriedWorld, captureCarry } from '@game/transit/index';
import {
  BrainComponent,
  CreatureComponent,
  Died,
  factDayClock,
  hashWorld,
  HealthComponent,
  isDead,
  killedDayFact,
  levelDeltasOf,
  persistDroppedItems,
  registerPersistence,
  restUntilMorning,
  sceneAuthoredEntities,
  slainFact,
  WorldItemComponent,
  WorldPersistence,
  worldItemSpawner,
  type EntityId,
} from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';

const LEVEL = 'valley-01';
const MINER = 'skel-valley-01-bend-miner';
const registry = createGameSaveRegistry();
const carryOptions = { registry };

type Game = ReturnType<typeof createGameWorld<never>>;

/** The scene built and entered the way src/main.ts does it, on a world holding `carry`. */
function arrive(seed: number, carry?: ReturnType<typeof captureCarry>): Game {
  const game = createGameWorld<never>(RAPIER, { seed, hz: 60, scene: LEVEL });
  const { world } = game;
  if (carry !== undefined) applyCarriedWorld(world, carry, carryOptions);
  registerPersistence(world);
  repopulateOnArrival(world, LEVEL, game.scene.layout.spawns);
  levelDeltasOf(world).enter(
    world,
    new WorldPersistence({ spawners: [worldItemSpawner(game.items)] }),
    LEVEL,
    sceneAuthoredEntities(world, game.scene),
  );
  persistDroppedItems(world, () => LEVEL);
  world.step();
  return game;
}

const creatureAt = (game: Game, point: string): EntityId | undefined =>
  game.world
    .query(CreatureComponent)
    .ids()
    .find((entity) => game.world.get(entity, CreatureComponent)?.origin.point === point);

const itemsOnGround = (game: Game): string[] =>
  game.world
    .query(WorldItemComponent)
    .ids()
    .map((entity) => {
      const item = game.world.get(entity, WorldItemComponent);
      return `${item?.defId ?? '?'}x${String(item?.count)}`;
    })
    .sort();

/** Kills the creature at `point` the way damage does: no health, then Died (drops, slain facts). */
function kill(game: Game, point: string): void {
  const { world } = game;
  const entity = creatureAt(game, point) ?? expect.fail(point);
  const health = world.get(entity, HealthComponent);
  world.set(entity, HealthComponent, { max: health?.max ?? 1, current: 0 });
  world.events.emit(Died, {
    tick: world.tick,
    target: entity,
    killer: null,
    source: null,
    tags: [],
  });
  for (let i = 0; i < 5; i++) world.step();
}

/** Crossing out: the level's deltas and facts captured as a save or transition holds them. */
function leave(game: Game): ReturnType<typeof captureCarry> {
  const { world } = game;
  const carry = captureCarry(world, game.player, registry);
  // What a page reload passes on is plain JSON.
  return JSON.parse(JSON.stringify(carry)) as ReturnType<typeof captureCarry>;
}

/** The player sleeps at an inn: the clock moves to the next morning and `rest.completed` fires. */
function sleepAtInn(carry: ReturnType<typeof captureCarry>): ReturnType<typeof captureCarry> {
  const inn = createGameWorld<never>(RAPIER, { seed: 99, hz: 60, scene: 'testbed' });
  applyCarriedWorld(inn.world, carry, carryOptions);
  const result = restUntilMorning(inn.world, inn.player, { kind: 'inn', point: 'sleeping-ox' });
  expect(result.ok).toBe(true);
  return JSON.parse(JSON.stringify(captureCarry(inn.world, inn.player, registry))) as ReturnType<
    typeof captureCarry
  >;
}

// Each test runs whole valley worlds through kills and rests: about 1.5 s locally, but past
// vitest's 5 s default under the CI coverage run.
describe('creature repopulation over the valley (mw-ju8.29)', { timeout: 60_000 }, () => {
  it('AC-6: a killed miner stays dead without a rest, and is back at its spawn, fresh and unaware, after one', ({
    task,
  }) => {
    markExercised(task, 'scene', LEVEL);
    const first = arrive(5);
    const spawn = first.scene.layout.spawns.find((s) => s.id === MINER) ?? expect.fail(MINER);
    expect(spawn.repopulate).toEqual({ afterDays: 1 });
    kill(first, MINER);
    expect(isDead(first.world, creatureAt(first, MINER) ?? -1)).toBe(true);
    expect(first.world.facts.get(slainFact(LEVEL, MINER))).toBe(true);
    expect(first.world.facts.get(killedDayFact(LEVEL, MINER))).toBe(1);
    const leftOnGround = itemsOnGround(first);
    const carry = leave(first);

    // Walk back without sleeping: it is still dead.
    const noRest = arrive(6, carry);
    expect(noRest.world.facts.get(slainFact(LEVEL, MINER))).toBe(true);
    const corpse = creatureAt(noRest, MINER);
    expect(corpse === undefined || isDead(noRest.world, corpse)).toBe(true);

    // Sleep, then walk back: it stands at its spawn with full health, unaware.
    const rested = arrive(7, sleepAtInn(carry));
    expect(factDayClock(rested.world.facts).now().day).toBe(2);
    const entity = creatureAt(rested, MINER) ?? expect.fail('the miner did not return');
    const health = rested.world.get(entity, HealthComponent);
    expect(health?.current).toBe(health?.max);
    expect(rested.world.get(entity, BrainComponent)?.state).toBe('unaware');
    expect(rested.world.facts.get(slainFact(LEVEL, MINER))).toBe(false);
    // The rest of the clear is untouched: only the miner was killed, so only it was repopulated.
    expect(rested.sceneCreatures.entities.length).toBeGreaterThan(5);

    // AC-5: what the first life dropped is still on the ground, not duplicated, not removed.
    expect(itemsOnGround(rested)).toEqual(leftOnGround);
  });

  it('AC-1: the same kills and rest give the same world, hash for hash', () => {
    const run = () => {
      const first = arrive(5);
      kill(first, MINER);
      const game = arrive(7, sleepAtInn(leave(first)));
      return hashWorld(game.world);
    };
    expect(run()).toBe(run());
  });

  it('AC-2: a save made after the kill and before the rest repopulates on the next arrival, and not before', () => {
    const first = arrive(5);
    kill(first, MINER);
    // The saved sections are plain data: the same bytes load whenever the player comes back; before
    // a rest the miner is still slain.
    const saved = JSON.stringify(leave(first));
    const load = () => JSON.parse(saved) as ReturnType<typeof captureCarry>;
    expect(arrive(8, load()).world.facts.get(slainFact(LEVEL, MINER))).toBe(true);
    const back = arrive(9, sleepAtInn(load()));
    expect(back.world.facts.get(slainFact(LEVEL, MINER))).toBe(false);
    const alive = creatureAt(back, MINER);
    expect(alive !== undefined && !isDead(back.world, alive)).toBe(true);
  });

  it('AC-4: the brute at the bridge never comes back, whatever is slept', () => {
    const game = createGameWorld<never>(RAPIER, { seed: 5, hz: 60, scene: 'valley-03' });
    registerPersistence(game.world);
    levelDeltasOf(game.world).enter(
      game.world,
      new WorldPersistence({ spawners: [worldItemSpawner(game.items)] }),
      'valley-03',
      sceneAuthoredEntities(game.world, game.scene),
    );
    const brute = 'skel-valley-03-gate-brute';
    kill(game, brute);
    let carry = leave(game);
    for (let night = 0; night < 5; night++) carry = sleepAtInn(carry);
    const back = createGameWorld<never>(RAPIER, { seed: 6, hz: 60, scene: 'valley-03' });
    applyCarriedWorld(back.world, carry, carryOptions);
    registerPersistence(back.world);
    expect(repopulateOnArrival(back.world, 'valley-03', back.scene.layout.spawns)).toEqual([]);
    expect(back.world.facts.get(slainFact('valley-03', brute))).toBe(true);
  });
});
