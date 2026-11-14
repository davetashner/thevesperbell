// The VFX cue bridge (mw-e29.3): the shipped VFX cue sheets run through the real content, the real
// VFX runtime and a world's event bus, plus the bridge's own rules (placement, orientation,
// scaling, de-dupe, cooldowns and the loop lifecycle) against a recording spawner.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadGameContent, vfxCueSheetSchema, type VfxCueSheetDefInput } from '@content/index';
import { markExercised } from '@content/testing';
import {
  addProperties,
  DamageApplied,
  fireExtinguished,
  fireIgnited,
  GuardBroken,
  WallRecoil,
  HitParried,
  registerWorldProperties,
  World,
  type DamageResult,
  type EntityId,
  type Vec3,
} from '@sim/index';
import { VfxSystem, type VfxSpawnOptions } from '../vfx/index.ts';
import { worldCueLookups } from './audio-bridge.ts';
import type { CueReading } from './events.ts';
import { upTo, VfxCueBridge, type VfxCueBridgeOptions, type VfxSpawner } from './vfx-bridge.ts';

const content = loadGameContent();
const combat = content.get('vfx-cue-sheet', 'combat');
const worldSheet = content.get('vfx-cue-sheet', 'world');
// The burning loop is the element-state bridge's now (mw-e03.28); the bridge's own loop lifecycle
// (attach, stopOn, destroy) is still exercised with a fire rule written here.
const fireSheet = vfxCueSheetSchema.parse({
  id: 'fire-loop-test',
  notes: 'A looping flame stopped by its stop events, for the loop lifecycle tests.',
  rules: [
    {
      event: 'fireIgnited',
      layer: 'fire',
      effect: 'vfx-fire-burn-loop',
      stopOn: ['fireExtinguished', 'fireBurntOut'],
    },
  ],
} satisfies VfxCueSheetDefInput);
const DT = 1 / 60;

afterEach(() => {
  vi.restoreAllMocks();
});

/** Rotates (x, y, z) by unit quaternion q. */
function rotate(q: { x: number; y: number; z: number; w: number }, v: Vec3): Vec3 {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

/** A world with world properties, a real VFX runtime and the shipped sheets on its bus. */
function game() {
  const world = registerWorldProperties(new World({ seed: 1 }));
  const positions = new Map<EntityId, Vec3>();
  const locate = (entity: EntityId) => {
    const position = positions.get(entity);
    return world.isAlive(entity) && position ? { position } : undefined;
  };
  const vfx = new VfxSystem({
    effects: content.all('vfx-effect'),
    anchors: (entity) => locate(entity),
    dev: true,
    warn: () => undefined,
  });
  const spawned: { effect: string; options: VfxSpawnOptions }[] = [];
  const spawner: VfxSpawner = {
    spawn: (effect, options) => {
      spawned.push({ effect, options });
      return vfx.spawn(effect, options);
    },
    stop: (handle) => {
      vfx.stop(handle);
    },
    alive: (handle) => vfx.alive(handle),
    has: (effect) => vfx.has(effect),
  };
  const bridge = new VfxCueBridge({
    sheets: [combat, worldSheet, fireSheet],
    vfx: spawner,
    now: () => world.tick * 1000,
    locate,
    lookups: worldCueLookups(world, content.all('material')),
    dev: false,
  });
  bridge.attach(world.events);
  const spawn = (material: string, at: Vec3 = { x: 0, y: 1, z: 0 }): EntityId => {
    const entity = world.spawn();
    addProperties(world, entity, { material });
    positions.set(entity, at);
    return entity;
  };
  const run = (seconds: number) => {
    for (let t = 0; t < seconds - 1e-9; t += DT) vfx.update(DT, { x: 0, y: 1, z: 3 });
  };
  return { world, vfx, bridge, spawned, spawn, run };
}

/** A resolved hit on `target` from `source` (its weapon), travelling along `direction`. */
function hit(
  target: EntityId,
  source: EntityId,
  direction?: Vec3,
  extra: object = {},
): DamageResult {
  return {
    tick: 1,
    target,
    packet: { instigator: null, source, amounts: { slash: 20 }, tags: [], direction } as never,
    amounts: { slash: 20 },
    total: 20,
    immune: false,
    poiseDamage: 0,
    staminaDamage: 0,
    tags: [],
    healthBefore: 100,
    healthAfter: 80,
    poiseBroken: false,
    died: false,
    ...extra,
  };
}

describe('VFX cue sheets on the game’s events (mw-e29.3)', () => {
  it('AC-1: a metal-on-metal hit spawns the specific sparks (not the generic dust), oriented to the hit normal', ({
    task,
  }) => {
    markExercised(task, 'vfx-cue-sheet', 'combat');
    markExercised(task, 'vfx-effect', 'vfx-impact-sparks');
    const { world, vfx, spawned, spawn, run } = game();
    const knight = spawn('iron', { x: 0, y: 1, z: 0 });
    const sword = spawn('iron');
    world.events.emit(DamageApplied, hit(knight, sword, { x: 0, y: 0, z: -2 }));
    world.events.flush();
    expect(spawned.map((s) => s.effect)).toEqual(['vfx-impact-sparks']);
    const options: VfxSpawnOptions = spawned[0]?.options ?? {};
    // Spawned where the knight is (not following it), turned so the cone's up axis is the normal.
    expect(options.position).toEqual({ x: 0, y: 1, z: 0 });
    expect(options.entity).toBeUndefined();
    expect(options.worldRotation).toBe(true);
    const up = rotate(options.rotation ?? { x: 0, y: 0, z: 0, w: 1 }, { x: 0, y: 1, z: 0 });
    expect(up.x).toBeCloseTo(0, 6);
    expect(up.y).toBeCloseTo(0, 6);
    expect(up.z).toBeCloseTo(1, 6); // back against the blow, out of the struck surface
    expect(options.params?.intensity).toBeCloseTo(0.25 + 0.75 * (15 / 35), 6);
    // The real runtime throws the sparks out along +z.
    run(2 * DT);
    const batch = vfx.batches.find((b) => b.texture === 'vfx-base-soft-circle-01' && b.count > 0);
    expect(batch).toBeDefined();
    let forward = 0;
    for (let p = 0; p < (batch?.count ?? 0); p++) if ((batch?.data[p * 9 + 2] ?? 0) > 0) forward++;
    expect(forward).toBe(batch?.count);
  });

  it('a hit with no material pair of its own throws the generic dust; a parry flashes instead of an impact', ({
    task,
  }) => {
    markExercised(task, 'vfx-effect', 'vfx-impact-dust');
    markExercised(task, 'vfx-effect', 'vfx-parry-flash');
    const { world, spawned, spawn } = game();
    const straw = spawn('straw');
    const sword = spawn('iron');
    world.events.emit(DamageApplied, hit(straw, sword));
    world.step(); // the next tick: de-dupe never merges different ticks
    world.events.emit(DamageApplied, hit(straw, sword, undefined, { tags: ['parried'] }));
    world.events.emit(HitParried, {
      tick: 2,
      entity: straw,
      attacker: sword,
      source: null,
      parriedTicks: 90,
    });
    world.events.flush();
    expect(spawned.map((s) => s.effect)).toEqual(['vfx-impact-dust', 'vfx-parry-flash']);
    // No direction known (no packet direction, no facing): spawned unturned.
    expect(spawned[0]?.options.rotation).toBeUndefined();
  });

  it('mw-e29.4 AC-1: each struck material throws its own impact: bone, wood, stone and flesh', ({
    task,
  }) => {
    for (const effect of [
      'vfx-impact-bone',
      'vfx-impact-splinters',
      'vfx-impact-stone',
      'vfx-impact-ichor',
    ]) {
      markExercised(task, 'vfx-effect', effect);
    }
    const { world, spawned, spawn } = game();
    const sword = spawn('iron');
    const club = spawn('wood'); // steel on stone throws sparks instead (the metal-on-stone rule)
    const seen: Record<string, string | undefined> = {};
    for (const material of ['bone', 'wood', 'stone', 'flesh']) {
      spawned.length = 0;
      world.step(); // a new tick, so de-dupe never merges two materials
      const weapon = material === 'stone' ? club : sword;
      world.events.emit(DamageApplied, hit(spawn(material), weapon, { x: 0, y: 0, z: -1 }));
      world.events.flush();
      seen[material] = spawned[0]?.effect;
      expect(spawned).toHaveLength(1);
    }
    expect(seen).toEqual({
      bone: 'vfx-impact-bone',
      wood: 'vfx-impact-splinters',
      stone: 'vfx-impact-stone',
      flesh: 'vfx-impact-ichor',
    });
  });

  it('mw-e29.4 AC-4: a material with no rule of its own still throws the generic dust', ({
    task,
  }) => {
    markExercised(task, 'vfx-effect', 'vfx-impact-dust');
    const { world, spawned, spawn } = game();
    world.events.emit(DamageApplied, hit(spawn('cloth'), spawn('iron')));
    world.events.flush();
    expect(spawned.map((s) => s.effect)).toEqual(['vfx-impact-dust']);
  });

  it('mw-e29.4: a block on the wooden shield throws chips, a guard break a ring, and a critical a burst over the impact', ({
    task,
  }) => {
    for (const effect of ['vfx-block-wood', 'vfx-guard-break', 'vfx-impact-critical']) {
      markExercised(task, 'vfx-effect', effect);
    }
    const { world, spawned, spawn } = game();
    const knight = spawn('iron');
    const wolf = spawn('flesh');
    world.events.emit(
      DamageApplied,
      hit(knight, wolf, undefined, { tags: ['blocked'], poiseDamage: 20 }),
    );
    world.step();
    world.events.emit(DamageApplied, hit(wolf, knight, undefined, { tags: ['critical'] }));
    world.step();
    world.events.emit(GuardBroken, {
      tick: 3,
      entity: knight,
      instigator: wolf,
      source: null,
      staggerTicks: 60,
    });
    world.events.flush();
    const effects = spawned.map((s) => s.effect);
    expect(effects).toContain('vfx-guard-break');
    expect(effects).toContain('vfx-impact-critical');
    // The critical's burst rides on the accent layer beside the flesh impact.
    expect(effects).toContain('vfx-impact-ichor');
  });

  it('mw-e04.15: a wall recoil throws sparks at the contact, facing back along the wall normal', () => {
    const { world, spawned, spawn } = game();
    const knight = spawn('flesh');
    const point = { x: 2, y: 1.2, z: -4.5 };
    world.events.emit(WallRecoil, {
      tick: 1,
      entity: knight,
      move: 'sword-light-1',
      activeTick: 1,
      point,
      normal: { x: 0, y: 0, z: 1 },
      ticks: 30,
    });
    world.events.flush();
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.effect).toBe('vfx-arrow-deflect-sparks');
    expect(spawned[0]?.options).toMatchObject({ position: point, worldRotation: true });
    // The sparks' up axis turns to the wall's normal (+z): a quarter turn about x from +y.
    expect(spawned[0]?.options.rotation?.x).toBeCloseTo(Math.SQRT1_2, 6);
    expect(spawned[0]?.options.rotation?.w).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it('AC-2: a looping effect attached to an entity stops emitting when it is destroyed, and its particles finish within their lifetime', ({
    task,
  }) => {
    markExercised(task, 'vfx-cue-sheet', 'world');
    markExercised(task, 'vfx-effect', 'vfx-fire-burn-loop');
    const { world, vfx, bridge, spawned, spawn, run } = game();
    const crate = spawn('dry-wood');
    world.events.emit(fireIgnited, { entity: crate });
    world.events.flush();
    expect(spawned).toEqual([{ effect: 'vfx-fire-burn-loop', options: { entity: crate } }]);
    run(1);
    expect(bridge.loops()).toBe(1);
    const burning = vfx.stats().particles;
    expect(burning).toBeGreaterThan(0);
    world.destroy(crate);
    run(DT);
    // Emission has stopped; what is alive finishes (no new particles, none culled at once).
    const after = vfx.stats().particles;
    expect(after).toBeGreaterThan(0);
    let previous = after;
    for (let t = 0; t < 0.8; t += DT) {
      run(DT);
      expect(vfx.stats().particles).toBeLessThanOrEqual(previous);
      previous = vfx.stats().particles;
    }
    const lifeMax = 0.8; // vfx-fire-burn-loop's longest particle
    expect(vfx.stats()).toMatchObject({ particles: 0, effects: 0, dormant: 0 });
    expect(lifeMax).toBeGreaterThan(0);
    expect(bridge.loops()).toBe(0);
  });

  it('mw-e29.12: a burning thing going out exhales a short smoke puff where it stood, once, and it finishes', ({
    task,
  }) => {
    markExercised(task, 'vfx-cue-sheet', 'world');
    markExercised(task, 'vfx-effect', 'vfx-extinguish-puff');
    const { world, vfx, spawned, spawn, run } = game();
    const torch = spawn('dry-wood', { x: 2, y: 1.5, z: -1 });
    world.events.emit(fireExtinguished, { entity: torch, cause: 'water' });
    world.events.flush();
    expect(spawned).toEqual([
      { effect: 'vfx-extinguish-puff', options: { position: { x: 2, y: 1.5, z: -1 } } },
    ]);
    run(0.2);
    expect(vfx.stats().particles).toBeGreaterThan(0);
    run(2);
    expect(vfx.stats()).toMatchObject({ particles: 0, effects: 0 });
  });

  it('a fire loop stops when its entity is extinguished (stopOn), and only that entity’s', () => {
    const { world, vfx, bridge, spawn, run } = game();
    const crate = spawn('dry-wood');
    const barrel = spawn('dry-wood', { x: 2, y: 1, z: 0 });
    world.events.emit(fireIgnited, { entity: crate });
    world.events.emit(fireIgnited, { entity: barrel });
    world.events.flush();
    run(0.5);
    expect(bridge.loops()).toBe(2);
    world.events.emit(fireExtinguished, { entity: crate, cause: 'water' });
    world.events.flush();
    expect(bridge.loops()).toBe(1);
    run(1);
    expect(vfx.stats().effects).toBe(1);
    // An entity without loops is ignored.
    world.events.emit(fireExtinguished, { entity: 99, cause: 'water' });
    world.events.flush();
    expect(bridge.loops()).toBe(1);
  });
});

/** A bridge over `rules` with a recording spawner; `known` effects exist. */
function recorder(
  rules: VfxCueSheetDefInput['rules'],
  options: Partial<VfxCueBridgeOptions> = {},
  known: readonly string[] = ['vfx-a', 'vfx-b', 'vfx-loop'],
) {
  const sheet = vfxCueSheetSchema.parse({ id: 'test', notes: 'Test.', rules });
  let next = 1;
  const alive = new Set<number>();
  const spawned: { effect: string; options: VfxSpawnOptions }[] = [];
  let refuse = false;
  const spawner: VfxSpawner = {
    spawn: (effect, o) => {
      spawned.push({ effect, options: o });
      if (refuse) return null;
      alive.add(next);
      return next++;
    },
    stop: (handle) => alive.delete(handle),
    alive: (handle) => alive.has(handle),
    has: (effect) => known.includes(effect),
  };
  let now = 0;
  const warn = vi.fn();
  const bridge = new VfxCueBridge({
    sheets: [sheet],
    vfx: spawner,
    now: () => now,
    warn,
    dev: false,
    ...options,
  });
  return {
    bridge,
    spawned,
    warn,
    alive,
    tick: (ms: number) => (now += ms),
    refuse: (value: boolean) => (refuse = value),
  };
}

const reading = (extra: Partial<CueReading> = {}): CueReading => ({
  anchors: { target: { entity: 5 } },
  facts: { target: 'bone', total: 20 },
  ...extra,
});

describe('VfxCueBridge rules', () => {
  it('AC-4: in a dev build, rules naming effects that do not exist warn with their rule index and still spawn (the runtime marks them)', () => {
    const { warn, bridge, spawned } = recorder(
      [
        { event: 'DamageApplied', effect: 'vfx-a' },
        { event: 'DamageApplied', layer: 'x', effect: 'vfx-not-yet' },
      ],
      { dev: true },
    );
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      'vfx-cue-sheet "test" rule 1: effect "vfx-not-yet" is not a vfx-effect yet (placeholder: a dev marker shows where it would play)',
    );
    bridge.handle('DamageApplied', reading());
    expect(spawned.map((s) => s.effect)).toEqual(['vfx-a', 'vfx-not-yet']);
  });

  it('in a production build, unknown and unfilled effect ids are skipped quietly', () => {
    const { warn, bridge, spawned } = recorder([
      { event: 'DamageApplied', effect: 'vfx-not-yet' },
      { event: 'DamageApplied', layer: 'x', effect: 'vfx-{region}' },
    ]);
    bridge.handle('DamageApplied', reading());
    expect(spawned).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('places effects: attached to a located entity, at its position, at the anchor’s position, or nowhere', () => {
    const where = new Map<EntityId, Vec3>([[5, { x: 1, y: 2, z: 3 }]]);
    const locate = (e: EntityId) => {
      const position = where.get(e);
      return position && { position };
    };
    const { bridge, spawned } = recorder(
      [
        { event: 'physicsImpact', effect: 'vfx-a' },
        { event: 'physicsImpact', layer: 'still', effect: 'vfx-b', attach: false },
      ],
      { locate },
    );
    const impact = (entity: CueReading['anchors'][string]) =>
      bridge.handle('physicsImpact', { anchors: { entity }, facts: {} });
    impact({ entity: 5 });
    expect(spawned.splice(0)).toEqual([
      { effect: 'vfx-a', options: { entity: 5 } },
      { effect: 'vfx-b', options: { position: { x: 1, y: 2, z: 3 } } },
    ]);
    // Gone (destroyed this tick): falls back to the anchor's own position, else nothing.
    impact({ entity: 6, position: { x: 9, y: 0, z: 0 } });
    impact({ entity: 7 });
    impact({ position: { x: 4, y: 0, z: 0 } });
    impact(undefined);
    expect(spawned.map((s) => s.options)).toEqual([
      { position: { x: 9, y: 0, z: 0 } },
      { position: { x: 9, y: 0, z: 0 } },
      { position: { x: 4, y: 0, z: 0 } },
      { position: { x: 4, y: 0, z: 0 } },
    ]);
  });

  it('without a locator, trusts the entity; a still effect then needs the anchor’s position', () => {
    const { bridge, spawned } = recorder([
      { event: 'physicsImpact', effect: 'vfx-a', socket: 'chest' },
      { event: 'physicsImpact', layer: 'still', effect: 'vfx-b', attach: false },
    ]);
    bridge.handle('physicsImpact', { anchors: { entity: { entity: 5 } }, facts: {} });
    expect(spawned).toEqual([{ effect: 'vfx-a', options: { entity: 5, socket: 'chest' } }]);
  });

  it('orients to a direction when the reading has it, and scales emission by a number fact', () => {
    const { bridge, spawned, tick } = recorder([
      {
        event: 'DamageApplied',
        effect: 'vfx-a',
        orientTo: 'attackerForward',
        scaleBy: { fact: 'total', min: 10, max: 30, floor: 0.2 },
      },
    ]);
    bridge.handle(
      'DamageApplied',
      reading({ directions: { attackerForward: { x: 1, y: 0, z: 0 } } }),
    );
    tick(1000);
    bridge.handle('DamageApplied', reading({ facts: { total: 99 } }));
    tick(1000);
    bridge.handle('DamageApplied', reading({ facts: {} }));
    const [first, second, third] = spawned.map((s) => s.options);
    expect(first?.worldRotation).toBe(true);
    const up = rotate(first?.rotation ?? { x: 0, y: 0, z: 0, w: 1 }, { x: 0, y: 1, z: 0 });
    expect([up.x, up.y, up.z].map((n) => Math.round(n * 1e6) / 1e6 + 0)).toEqual([1, 0, 0]);
    expect(first?.params?.intensity).toBeCloseTo(0.2 + 0.8 * 0.5, 9);
    expect(second?.params?.intensity).toBe(1);
    expect(second?.rotation).toBeUndefined();
    expect(third?.params).toBeUndefined();
  });

  it('de-dupes the same effect on the same anchor within 30 ms, and keeps per-rule cooldowns', () => {
    const { bridge, spawned, tick } = recorder([
      { event: 'DamageApplied', effect: 'vfx-a' },
      { event: 'DamageApplied', layer: 'slow', effect: 'vfx-b', cooldownMs: 500 },
    ]);
    bridge.handle('DamageApplied', reading());
    bridge.handle('DamageApplied', reading()); // the same hit's second packet
    tick(40);
    bridge.handle('DamageApplied', reading());
    bridge.handle('DamageApplied', reading({ anchors: { target: { entity: 6 } } }));
    tick(500);
    bridge.handle('DamageApplied', reading());
    expect(spawned.map((s) => s.effect)).toEqual([
      'vfx-a',
      'vfx-b',
      'vfx-a',
      'vfx-a',
      'vfx-b',
      'vfx-a',
      'vfx-b',
    ]);
  });

  it('prunes old de-dupe and cooldown entries once there are many', () => {
    const { bridge, spawned, tick } = recorder([
      { event: 'physicsImpact', effect: 'vfx-a', cooldownMs: 100 },
    ]);
    for (let i = 0; i < 600; i++) {
      bridge.handle('physicsImpact', {
        anchors: { entity: { position: { x: i, y: 0, z: 0 } } },
        facts: {},
      });
    }
    tick(1000);
    bridge.handle('physicsImpact', {
      anchors: { entity: { position: { x: 0, y: 0, z: 0 } } },
      facts: {},
    });
    expect(spawned).toHaveLength(601);
  });

  it('tracks loops only when they spawned on an entity, and forgets loops that already ended', () => {
    const { bridge, alive, refuse, tick } = recorder([
      { event: 'fireIgnited', effect: 'vfx-loop', stopOn: ['fireExtinguished'] },
      { event: 'fireIgnited', layer: 'glow', effect: 'vfx-b', stopOn: ['fireBurntOut'] },
    ]);
    const ignite = (entity: CueReading['anchors'][string]) =>
      bridge.handle('fireIgnited', { anchors: { entity }, facts: {} });
    ignite({ entity: 3 });
    expect(bridge.loops()).toBe(2);
    alive.clear(); // both ended on their own
    tick(100);
    ignite({ entity: 3 });
    expect(bridge.loops()).toBe(2);
    refuse(true);
    ignite({ entity: 4 }); // refused by the budget: nothing to track
    refuse(false);
    ignite({ position: { x: 0, y: 0, z: 0 } }); // no entity: nothing to stop it on
    expect(bridge.loops()).toBe(2);
    // fireExtinguished stops the loop that names it and keeps the other.
    bridge.handle('fireExtinguished', { anchors: { entity: { entity: 3 } }, facts: {} });
    expect(bridge.loops()).toBe(1);
    bridge.handle('fireBurntOut', { anchors: { entity: { entity: 3 } }, facts: {} });
    expect(bridge.loops()).toBe(0);
    bridge.handle('fireBurntOut', { anchors: { entity: undefined }, facts: {} });
    expect(bridge.loops()).toBe(0);
  });

  it('attaches to rule and stop events, contains a failing read, and detaches', () => {
    const { bridge, spawned, warn } = recorder([
      { event: 'fireIgnited', effect: 'vfx-loop', stopOn: ['fireExtinguished'] },
    ]);
    const world = registerWorldProperties(new World({ seed: 1 }));
    const off = bridge.attach(world.events);
    // fireIgnited's reader looks up the material of an entity that does not exist: no material.
    world.events.emit(fireIgnited, { entity: 7 });
    world.events.emit(fireExtinguished, { entity: 7, cause: 'water' });
    world.events.flush();
    expect(spawned).toHaveLength(1);
    expect(bridge.loops()).toBe(0);
    off();
    world.events.emit(fireIgnited, { entity: 8 });
    world.events.flush();
    expect(spawned).toHaveLength(1);
    // A reader that throws is reported, not thrown into the sim.
    const broken = registerWorldProperties(new World({ seed: 1 }));
    bridge.attach(broken.events);
    broken.events.emit(fireIgnited, null as never);
    broken.events.flush();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^vfx cues: fireIgnited failed/));
  });

  it('warns to the console by default', () => {
    const log = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    recorder([{ event: 'Died', effect: 'vfx-not-yet' }], { warn: undefined as never, dev: true });
    expect(log).toHaveBeenCalledOnce();
  });

  it('upTo turns the up axis onto any direction, straight down included', () => {
    for (const d of [
      { x: 0, y: 1, z: 0 },
      { x: 0, y: -1, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 0, z: -1 },
      { x: 0.6, y: -0.8, z: 0 },
    ]) {
      const up = rotate(upTo(d), { x: 0, y: 1, z: 0 });
      expect(up.x).toBeCloseTo(d.x, 9);
      expect(up.y).toBeCloseTo(d.y, 9);
      expect(up.z).toBeCloseTo(d.z, 9);
    }
  });
});
