// mw-8551: scheduled people walk. A person whose window ends walks to the nearest way out of the
// scene on the navmesh and is gone there; one whose window opens comes in by one and walks to their
// spot. The clock ticking does this; a jump of it (time set, rest) still moves people at once, and
// a person in a conversation or in the way of nothing is never teleported in front of the player.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { markExercised } from '@content/testing';
import {
  beginConversing,
  CreatureComponent,
  endConversing,
  errandOf,
  MINUTE_FACT,
  PlacementComponent,
  type World,
} from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';

const must = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('expected a value');
  return value;
};
const hm = (h: number, m = 0): number => h * 60 + m;

function load(scene: string, minute: number) {
  const game = createGameWorld<unknown>(RAPIER, { seed: 1, hz: 60, scene, minute });
  const world = game.world as unknown as World<never>;
  const person = (point: string) =>
    world
      .query(CreatureComponent)
      .ids()
      .find((e) => world.get(e, CreatureComponent)?.origin.point === point);
  const where = (entity: number) => world.get(entity, PlacementComponent);
  /** Ticks the game clock one minute at a time, as it does when time goes by. */
  const tickTo = (minute: number): void => {
    const now = world.facts.get(MINUTE_FACT) as number;
    for (let m = now + 1; m <= minute; m++) {
      world.facts.set(MINUTE_FACT, m);
      game.world.step();
    }
  };
  const steps = (n: number): void => {
    for (let i = 0; i < n; i++) game.world.step();
  };
  return { game, world, person, where, tickTo, steps };
}

describe('scheduled people walk (mw-8551)', () => {
  it('AC-3: a keeper whose window ends walks off the lane to a way out and is gone there', ({
    task,
  }) => {
    markExercised(task, 'scene', 'briar-glen-lane');
    markExercised(task, 'creature', 'npc-oswin');
    const t = load('briar-glen-lane', hm(19, 58));
    const oswin = t.person('npc-oswin');
    expect(oswin).toBeDefined();
    const home = t.where(must(oswin));
    t.tickTo(hm(20));
    // Still in the world, on his way, and the counter shut at once.
    expect(t.person('npc-oswin')).toBe(oswin);
    const errand = errandOf(t.world, oswin as never);
    expect(errand?.leave).toBe(true);
    t.steps(30);
    const moved = t.where(must(oswin));
    expect(
      Math.hypot((moved?.x ?? 0) - (home?.x ?? 0), (moved?.z ?? 0) - (home?.z ?? 0)),
    ).toBeGreaterThan(0.2);
    // He walks until he reaches it, then he is gone.
    for (let i = 0; i < 60 * 90 && t.person('npc-oswin') !== undefined; i++) t.steps(1);
    expect(t.person('npc-oswin')).toBeUndefined();
  });

  it('AC-3: a keeper whose window opens comes in at a way in and walks to the counter', () => {
    const t = load('briar-glen-lane', hm(4, 58));
    expect(t.person('npc-hollis')).toBeUndefined();
    t.tickTo(hm(5));
    const hollis = t.person('npc-hollis');
    expect(hollis).toBeDefined();
    const arrival = errandOf(t.world, hollis as never);
    expect(arrival?.leave).toBe(false);
    const spot = arrival?.goal as { x: number; z: number };
    const far = () =>
      Math.hypot(
        (t.where(must(hollis))?.x ?? 0) - spot.x,
        (t.where(must(hollis))?.z ?? 0) - spot.z,
      );
    const start = far();
    expect(start).toBeGreaterThan(2);
    for (let i = 0; i < 60 * 90 && errandOf(t.world, hollis as never) !== undefined; i++)
      t.steps(1);
    expect(errandOf(t.world, hollis as never)).toBeUndefined();
    expect(far()).toBeLessThan(1);
  });

  it('AC-3: a jump of the clock still moves people at once, nobody walks', () => {
    const t = load('briar-glen-lane', hm(19, 30));
    t.world.facts.set(MINUTE_FACT, hm(20, 30));
    t.game.world.step();
    expect(t.person('npc-oswin')).toBeUndefined();
    t.world.facts.set(MINUTE_FACT, hm(5, 30));
    t.game.world.step();
    const hollis = t.person('npc-hollis');
    expect(hollis).toBeDefined();
    expect(errandOf(t.world, hollis as never)).toBeUndefined();
  });

  it('AC-3: a keeper who sets off and is then talked to stands until the talk is over, then goes on', () => {
    const t = load('briar-glen-lane', hm(19, 58));
    const oswin = must(t.person('npc-oswin'));
    t.tickTo(hm(20));
    t.steps(10);
    beginConversing(t.world, oswin, t.game.player);
    const held = t.where(oswin);
    t.steps(120);
    expect(t.where(oswin)).toEqual(held);
    expect(t.person('npc-oswin')).toBe(oswin);
    endConversing(t.world, oswin);
    t.steps(60);
    expect(t.where(oswin)).not.toEqual(held);
  });
});
