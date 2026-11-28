// mw-e27.13: resting, headless as the game wires it. The testbed's unlit campfire is loaded with the
// real scene, content, fire rules and facts: it refuses a rest until the `light` verb's heat
// ignites it, a night by it passes the clock and heals, and the game's autosave writes exactly one
// save after `rest.completed`. The rules are src/sim/rest/rules.test.ts, the glue
// src/game/rest/rest.test.ts, the browser run e2e/rest.spec.ts.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import { markExercised } from '@content/testing';
import { restKindSpecs } from '@game/rest/rest';
import { GameAutosave } from '@game/save/autosave/index';
import { createGameSaveRegistry } from '@game/save/sections';
import { SaveSlots } from '@game/save/slots/index';
import { MemorySaveStore } from '@game/save/storage/index';
import {
  actionButton,
  actionFrame,
  actionVector,
  DEFAULT_REST_POOLS,
  factDayClock,
  HealthComponent,
  interacted,
  readProperty,
  restCompleted,
  RestRules,
  SceneSpawnComponent,
  type EntityId,
  type RestCompleted,
  type World,
} from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';

const IDLE = actionFrame({
  move: actionVector(0, 0),
  look: actionVector(0, 0),
  buttons: () => actionButton(false, false, false),
});
const content = loadGameContent();

function camp() {
  const game = createGameWorld<unknown>(RAPIER, {
    seed: 1,
    hz: 60,
    scene: 'testbed',
    magic: true,
    minute: 22 * 60,
  });
  const { world, player } = game;
  const sim = world as unknown as World<never>;
  const fire = world
    .query(SceneSpawnComponent)
    .ids()
    .find(
      (entity) => world.get(entity, SceneSpawnComponent)?.id === 'testbed-campfire',
    ) as EntityId;
  const rules = new RestRules(restKindSpecs(content), { pools: DEFAULT_REST_POOLS });
  const rested: RestCompleted[] = [];
  sim.events.on(restCompleted, (e) => rested.push(e));
  const step = (ticks = 1): void => {
    for (let i = 0; i < ticks; i++) world.step([IDLE]);
  };
  return { game, world, sim, player, fire, rules, rested, step };
}

describe('resting at the testbed campfire, headless (mw-e27.13)', () => {
  it('AC-1: the unlit campfire refuses a rest; the light verb heats it until it burns; then the rest goes through', ({
    task,
  }) => {
    markExercised(task, 'scene', 'testbed');
    markExercised(task, 'rest-point', 'campfire');
    const t = camp();
    t.step(2);
    expect(readProperty(t.sim, t.fire, 'burning')).toBe(false);
    const request = { point: t.fire, duration: { kind: 'hours', hours: 8 } } as const;
    expect(t.rules.rest(t.sim, t.player, request)).toMatchObject({ ok: false, reason: 'no-fire' });
    t.world.events.emit(interacted, {
      actor: t.player,
      target: t.fire,
      verb: 'light',
      affordance: 0,
    });
    t.step(5);
    expect(readProperty(t.sim, t.fire, 'burning')).toBe(true);
    const health = t.sim.get(t.player, HealthComponent);
    t.sim.set(t.player, HealthComponent, { max: health?.max ?? 100, current: 1 });
    const clock = factDayClock(t.sim.facts);
    const before = clock.now();
    const out = t.rules.rest(t.sim, t.player, request);
    expect(out).toMatchObject({ ok: true, hours: 8 });
    // 22:00 plus 8 h: 06:00 the next day.
    expect(clock.now()).toEqual({ day: before.day + 1, minute: (before.minute + 8 * 60) % 1440 });
    expect(t.sim.get(t.player, HealthComponent)?.current).toBe(health?.max);
    t.sim.events.flush();
    expect(t.rested).toHaveLength(1);
    expect(t.rested[0]).toMatchObject({ kind: 'campfire', point: 'testbed-campfire', hours: 8 });
  });

  it('AC-6: a completed rest writes exactly one autosave, after rest.completed', async () => {
    const t = camp();
    const slots = new SaveSlots({
      store: new MemorySaveStore(),
      registry: createGameSaveRegistry(),
      build: { gameVersion: '0.2.0', buildSha: 'abc1234', contentHash: 'c0ffee' },
      now: () => 1_790_000_000_000,
    });
    const events: string[] = [];
    const autosave = new GameAutosave({
      world: t.sim,
      slots,
      describe: () => ({ characterName: 'Knight', classId: 'knight', areaId: 'testbed' }),
      timing: { minGapSeconds: 0 },
      publish: (event) => events.push(`${event.type}:${event.trigger.kind}`),
    });
    t.step(2);
    t.world.events.emit(interacted, {
      actor: t.player,
      target: t.fire,
      verb: 'light',
      affordance: 0,
    });
    t.step(5);
    for (let i = 0; i < 3; i++) await autosave.afterStep();
    expect(events).toEqual([]);
    t.rules.rest(t.sim, t.player, { point: t.fire, duration: { kind: 'dawn' } });
    t.step();
    for (let i = 0; i < 4; i++) {
      await autosave.afterStep();
      t.step();
    }
    expect(events).toEqual(['saving:rest', 'saved:rest']);
    autosave.stop();
  });
});
