// mw-e04.38: the knight's light attack reaches low creatures. Its first swing is a descending diagonal
// slash (socket track knight-sword-arc-light-1) that crosses the centre line already low and ends
// about 0.4 m above the ground, so a 0.9 m fixture hound 1.2 m in front is hit as well as a 1.8 m
// fixture-guard, with no auto-aim: the swing is the same for every target. Through the game's own
// testbed wiring (createGameWorld, the ActionSampler), headless.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { loadDevContent } from '@content/dev-content';
import { markExercised } from '@content/testing';
import { ActionSampler } from '@game/input/index';
import {
  ActionStarted,
  CharacterController,
  DamageApplied,
  PlayerLook,
  type ActionStartInfo,
  type DamageResult,
  type EntityId,
} from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';

const content = loadDevContent();

/** The knight faces −x (look yaw π/2), away from the testbed's dummies. */
const FACING_YAW = Math.PI / 2;

/** Spawns `creature` `ahead` m in front of the knight, swings once with `button`, returns the hits. */
function swing(creature: string, ahead: number, button: string, ticks = 60, aside = 0) {
  const game = createGameWorld<unknown>(RAPIER, { seed: 1, hz: 60, content, magic: true });
  const { world, player } = game;
  const look = world.get(player, PlayerLook) ?? expect.fail('no look');
  world.set(player, PlayerLook, { ...look, yaw: FACING_YAW });
  const sampler = new ActionSampler();
  const started: ActionStartInfo[] = [];
  const hits: DamageResult[] = [];
  world.events.on(ActionStarted, (e) => {
    if (e.entity === player) started.push(e);
  });
  world.events.on(DamageApplied, (e) => hits.push(e));
  const step = (codes: readonly string[] = []) => {
    for (const code of codes) sampler.down(code);
    world.step(sampler.sampleCommands(world.tick));
    for (const code of codes) sampler.up(code);
  };
  for (let i = 0; i < 20; i++) step(); // settle on the floor, turned
  const feet = world.get(player, CharacterController)?.position ?? expect.fail('no player');
  const spawner =
    game.creatures.spawners.get(creature) ?? expect.fail(`no spawner for ${creature}`);
  const target: EntityId = spawner(world, { x: feet.x - ahead, y: feet.y, z: feet.z + aside }, {});
  for (let i = 0; i < 10; i++) step();
  step([button]);
  for (let i = 0; i < ticks; i++) step();
  return { started: started.map((e) => e.move), hit: hits.some((h) => h.target === target) };
}

const LIGHT = 'Mouse0';
const HEAVY = 'Digit1';

describe('the knight’s light swing against low creatures (mw-e04.38)', () => {
  it('AC-1: the light attack hits a 0.9 m fixture-hound 1.2 m in front of the knight', ({
    task,
  }) => {
    markExercised(task, 'move', 'sword-light-1');
    markExercised(task, 'creature', 'fixture-hound');
    const result = swing('fixture-hound', 1.2, LIGHT);
    expect(result.started[0]).toBe('sword-light-1');
    expect(result.hit).toBe(true);
  });

  it('AC-2: the same swing still hits a 1.8 m fixture-guard at the same distance', ({ task }) => {
    markExercised(task, 'creature', 'fixture-guard');
    const result = swing('fixture-guard', 1.2, LIGHT);
    expect(result.started[0]).toBe('sword-light-1');
    expect(result.hit).toBe(true);
  });

  it('AC-2: a guard 1.2 m ahead and 0.55 m to either side is still hit (the blade keeps its reach)', () => {
    expect(swing('fixture-guard', 1.2, LIGHT, 60, 0.55).hit).toBe(true);
    expect(swing('fixture-guard', 1.2, LIGHT, 60, -0.55).hit).toBe(true);
  });

  it('AC-3: a target outside the swing’s reach is still missed, low or tall', () => {
    expect(swing('fixture-hound', 2.6, LIGHT).hit).toBe(false);
    expect(swing('fixture-guard', 2.6, LIGHT).hit).toBe(false);
  });

  it('AC-4: the heavy chain is unchanged', () => {
    // The heavy swing (its own track) behaves as before this fix: it hits the hound and the guard.
    expect(swing('fixture-hound', 1.2, HEAVY, 90).hit).toBe(true);
    expect(swing('fixture-guard', 1.2, HEAVY, 90).hit).toBe(true);
  });
});
