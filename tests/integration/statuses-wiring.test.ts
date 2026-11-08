// mw-e06.24: statuses in the running game's wiring (createGameWorld with magic, as src/main.ts
// installs it). The game passes the loaded status content to the spell pipeline, so stack and break
// rules apply, and the player's and creatures' speed read through `modifiedStat`.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { markExercised } from '@content/testing';
import { ActionSampler } from '@game/input/index';
import {
  addProperties,
  applyStatus,
  CharacterController,
  modifiedStat,
  setProperty,
  spellStatusesOf,
  StatusEnded,
  statusMoveScale,
  type EntityId,
  type StatusEndedInfo,
} from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';
import type { ActionFrame } from '@sim/input/index';

function game() {
  const g = createGameWorld<ActionFrame>(RAPIER, { seed: 1, hz: 60, magic: true });
  const sampler = new ActionSampler();
  const step = (n = 1): void => {
    for (let i = 0; i < n; i++) g.world.step(sampler.sampleCommands(g.world.tick));
  };
  const magic = g.magic;
  if (magic === undefined) throw new Error('the game world has magic');
  const statuses = magic.pipeline.statuses;
  const apply = (target: EntityId, status: string, source: EntityId, seconds = 30, stacks = 1) =>
    applyStatus(g.world, statuses(status), { target, status, source, seconds, stacks });
  const walked = (ticks: number): number => {
    const from = g.world.get(g.player, CharacterController)?.position;
    sampler.down('KeyW');
    step(ticks);
    sampler.up('KeyW');
    const to = g.world.get(g.player, CharacterController)?.position;
    if (from === undefined || to === undefined) throw new Error('no player');
    return Math.hypot(to.x - from.x, to.z - from.z);
  };
  return { ...g, sampler, step, statuses, apply, walked };
}

describe('statuses in the running game (mw-e06.24)', () => {
  it('AC-1: a slowed player moves at modifiedStat of its speed; stacks follow the definition', ({
    task,
  }) => {
    markExercised(task, 'status', 'slowed');
    markExercised(task, 'status', 'rooted');
    const g = game();
    g.step(20); // settle on the floor
    const free = g.walked(30);
    g.step(30); // slow to a stop
    expect(free).toBeGreaterThan(1);

    for (let i = 0; i < 5; i++) g.apply(g.player, 'slowed', g.player);
    // The loaded definition caps the stacks at 3 (a lookup-less pipeline would add up to 99).
    expect(spellStatusesOf(g.world, g.player).map((e) => e.stacks)).toEqual([3]);
    const scale = modifiedStat(g.world, g.statuses, g.player, 'moveSpeed', 1);
    expect(scale).toBeCloseTo(0.75 ** 3);
    expect(statusMoveScale(g.world, g.statuses, g.player)).toBe(scale);
    const slowed = g.walked(30);
    expect(slowed).toBeLessThan(free * 0.7);
    expect(slowed).toBeGreaterThan(0);
  });

  it('AC-2: a rooted player cannot walk, and rooted ends when its source burns', ({ task }) => {
    markExercised(task, 'status', 'rooted');
    const g = game();
    const ended: StatusEndedInfo[] = [];
    g.world.events.on(StatusEnded, (e) => ended.push(e));
    const vine = g.world.spawn();
    addProperties(g.world, vine, { burning: false });
    g.step(20);
    g.apply(g.player, 'rooted', vine);
    g.step(2);
    expect(g.walked(30)).toBeLessThan(0.05);
    expect(spellStatusesOf(g.world, g.player).map((e) => e.status)).toEqual(['rooted']);

    setProperty(g.world, vine, 'burning', true);
    g.step(2);
    expect(spellStatusesOf(g.world, g.player)).toEqual([]);
    expect(ended).toMatchObject([{ status: 'rooted', reason: 'broken' }]);
    g.step(30);
    expect(g.walked(30)).toBeGreaterThan(1);
  });
});
