import { describe, expect, it } from 'vitest';
import { ARCHER_BOW_ID, loadGameContent } from '@content/index';
import { markExercised } from '@content/testing';
import {
  ActionRejected,
  ArrowComponent,
  ArrowRestComponent,
  box,
  DAMAGE_COMPONENTS,
  FakeCollisionWorld,
  fireArrow,
  giveBow,
  HIT_VOLUME_COMPONENTS,
  installBow,
  PlacementComponent,
  ProjectileComponent,
  World,
  type ActionFrame,
  type Vec3,
} from '@sim/index';
import { ActionSampler } from '../input';
import { RenderSync, type SceneBinding } from '../loop/render-sync';
import {
  arrowReadout,
  bindArrows,
  pointAlong,
  readArrowTransform,
  readWobbledArrowTransform,
} from './arrows-view';
import { frameDataView, sandboxFrameData } from './frame-data';
import {
  prepareTestbedCombat,
  startTestbedCombat,
  TESTBED_BOW_BUTTONS,
  TESTBED_QUIVER,
} from './testbed-combat';

const content = loadGameContent();

/** Rotates +z by unit quaternion `q`. */
function rotateZ(q: { x: number; y: number; z: number; w: number }): Vec3 {
  const { x, y, z, w } = q;
  return {
    x: 2 * (x * z + w * y),
    y: 2 * (y * z - w * x),
    z: 1 - 2 * (x * x + y * y),
  };
}

const headless = (): SceneBinding<object> => ({
  object: {},
  read: readArrowTransform,
  apply: () => undefined,
  dispose: () => undefined,
});

/**
 * A combat world with the arrow system over a 4 m-away wall (startTestbedCombat with a collision
 * world) and one archer carrying the shortbow, out, aiming along +z from 1.5 m up.
 */
function range(quiver = TESTBED_QUIVER) {
  const combat = prepareTestbedCombat(content);
  const world = new World<ActionFrame>({ seed: 1 }).register(
    ...HIT_VOLUME_COMPONENTS,
    ...DAMAGE_COMPONENTS,
    PlacementComponent,
  );
  const wall = new FakeCollisionWorld([box({ x: -2, y: 0, z: 4 }, { x: 2, y: 3, z: 4.2 })]);
  startTestbedCombat(world, combat, [], undefined, wall);
  installBow(world, {
    bows: combat.bow.bows,
    arrows: combat.bow.arrows,
    buttons: TESTBED_BOW_BUTTONS,
    aim: () => ({ origin: { x: 0, y: 1.5, z: 0 }, direction: { x: 0, y: 0, z: 1 } }),
  });
  const archer = world.spawn();
  giveBow(world, archer, { bow: ARCHER_BOW_ID, quiver, equipped: true });
  const sampler = new ActionSampler();
  const step = (down: readonly string[] = [], up: readonly string[] = []) => {
    for (const code of down) sampler.down(code);
    for (const code of up) sampler.up(code);
    world.step(sampler.sampleCommands(world.tick));
  };
  const sync = new RenderSync(world);
  const w: World<never> = world;
  return { combat, world: w, archer, step, sync };
}

describe('arrows on screen (mw-e05.21)', () => {
  it('pointAlong turns +z onto any direction, straight back included', () => {
    const directions: Vec3[] = [
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: -1, z: 0 },
      { x: 0.6, y: 0, z: -0.8 },
      { x: 0, y: 0, z: -1 },
    ];
    for (const d of directions) {
      const turned = rotateZ(pointAlong(d));
      expect(turned.x).toBeCloseTo(d.x, 9);
      expect(turned.y).toBeCloseTo(d.y, 9);
      expect(turned.z).toBeCloseTo(d.z, 9);
    }
  });

  it('shafts follow arrows in flight and at rest, and the readout follows them', ({ task }) => {
    markExercised(task, 'arrow', 'standard');
    const { world, combat, sync, step } = range();
    // Nothing loosed: nothing bound, nothing to report.
    expect(bindArrows(world, sync, headless)).toBe(0);
    expect(arrowReadout(world, (e) => sync.has(e))).toEqual({
      flying: 0,
      stuck: 0,
      dropped: 0,
      intact: 0,
      latest: null,
    });
    const arrow = fireArrow(world, combat.bow.arrows, {
      arrow: 'standard',
      origin: { x: 0, y: 1.5, z: 0 },
      velocity: { x: 0, y: 0, z: 60 },
    });
    expect(readArrowTransform(world, arrow)).toEqual({
      position: { x: 0, y: 1.5, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    });
    expect(arrowReadout(world, () => false).latest).toMatchObject({
      entity: arrow,
      state: 'flying',
      in: null,
      drawn: false,
      onScreen: false,
    });
    expect(bindArrows(world, sync, headless)).toBe(1);
    expect(bindArrows(world, sync, headless)).toBe(0); // bound once
    for (let i = 0; i < 10; i++) step();
    // Stuck in the (soft by default) wall, tip on its face, still pointing along +z.
    expect(world.get(arrow, ArrowRestComponent)?.state).toBe('stuck');
    const rest = readArrowTransform(world, arrow);
    expect(rest?.position.z).toBeCloseTo(4, 6);
    expect(rotateZ(rest?.rotation ?? { x: 0, y: 0, z: 0, w: 0 }).z).toBeCloseTo(1, 3); // dipped by gravity
    expect(bindArrows(world, sync, headless)).toBe(0);
    const readout = arrowReadout(
      world,
      (e) => sync.has(e),
      () => ({ x: 0, y: 0, z: 0.5 }),
    );
    expect(readout).toMatchObject({ flying: 0, stuck: 1, dropped: 0 });
    expect(readout.latest).toMatchObject({
      entity: arrow,
      arrow: 'standard',
      state: 'stuck',
      in: null,
      drawn: true,
      onScreen: true,
    });
    expect(readout.latest?.position.z).toBeCloseTo(4, 3);
    // Off screen, or behind the camera.
    const away = arrowReadout(
      world,
      () => true,
      () => ({ x: 1.5, y: 0, z: 0.5 }),
    );
    expect(away.latest?.onScreen).toBe(false);
    // A later arrow in the air is the latest; a dropped one is counted as dropped.
    const next = fireArrow(world, combat.bow.arrows, {
      arrow: 'standard',
      origin: { x: 0, y: 1.5, z: 0 },
      velocity: { x: 0, y: 0, z: 60 },
    });
    const dropped = world.spawn();
    world.add(dropped, ArrowRestComponent, {
      arrow: 'blunt',
      shooter: null,
      state: 'dropped',
      position: { x: 1, y: 0, z: 1 },
      direction: { x: 1, y: 0, z: 0 },
      in: null,
      tick: 0,
      intact: true,
    });
    const both = arrowReadout(world, () => true);
    expect(both).toMatchObject({ flying: 1, stuck: 1, dropped: 1 });
    // Only the dropped arrow was added whole; the one that stuck from flight need not be.
    expect(both.intact).toBeGreaterThanOrEqual(1);
    // A broken arrow lies there too but is not counted whole.
    const broken = world.spawn();
    world.add(broken, ArrowRestComponent, {
      arrow: 'blunt',
      shooter: null,
      state: 'dropped',
      position: { x: 2, y: 0, z: 1 },
      direction: { x: 1, y: 0, z: 0 },
      in: null,
      tick: 0,
      intact: false,
    });
    const after = arrowReadout(world, () => true);
    expect(after.dropped).toBe(both.dropped + 1);
    expect(after.intact).toBe(both.intact);
    expect(both.latest?.entity).toBe(dropped);
    expect(both.latest?.entity).toBeGreaterThan(next);
    // Anything else has no arrow transform.
    expect(readArrowTransform(world, world.spawn())).toBeUndefined();
    expect(world.has(next, ArrowComponent)).toBe(true);
  });

  it('a world without the arrow system binds and reports nothing', () => {
    const world = new World<never>({ seed: 1 });
    const sync = new RenderSync(world);
    expect(bindArrows(world, sync, headless)).toBe(0);
    expect(arrowReadout(world, () => true).latest).toBeNull();
  });

  it('AC-4: with the selected type empty, fire shows 0 for it in the overlay and no arrow renders', ({
    task,
  }) => {
    markExercised(task, 'bow', ARCHER_BOW_ID);
    const { world, combat, archer, step, sync } = range([
      { arrow: 'standard', count: 0 },
      { arrow: 'broadhead', count: 1 },
    ]);
    const rejected: string[] = [];
    world.events.on(ActionRejected, (event) => rejected.push(event.reason));
    const arrowsCell = () =>
      frameDataView(sandboxFrameData(world, { moves: combat.moves, player: archer })).rows[0]
        ?.arrows;
    expect(arrowsCell()).toBe('standard 0');
    step(['Mouse0']);
    for (let i = 0; i < 20; i++) step();
    step([], ['Mouse0']);
    expect(rejected).toEqual(['ammo']);
    expect(arrowsCell()).toBe('standard 0');
    expect(bindArrows(world, sync, headless)).toBe(0);
    expect(sync.size).toBe(0);
    // The other type still shoots: 2 cycles to it, and a 20-tick draw looses one.
    step(['Digit2']);
    step([], ['Digit2']);
    expect(arrowsCell()).toBe('broadhead 1');
    step(['Mouse0']);
    for (let i = 0; i < 19; i++) step();
    expect(arrowsCell()).toBe('broadhead 0 · draw 19');
    step([], ['Mouse0']);
    expect(bindArrows(world, sync, headless)).toBe(1);
    expect(arrowsCell()).toBe('broadhead 0');
    // Put away, the overlay says so.
    step(['Digit4']);
    expect(arrowsCell()).toBe('broadhead 0 (away)');
  });
});

describe('creature projectiles on screen (mw-ju8.19)', () => {
  it('a creature’s projectile attack gets a shaft pointing along its flight, without the bow system', () => {
    const world = new World<never>({ seed: 1 }).register(ProjectileComponent);
    const sync = new RenderSync(world);
    const other = world.spawn(); // not a projectile: nothing to draw
    const shot = world.spawn();
    world.add(shot, ProjectileComponent, {
      attacker: other,
      attack: 'forgotten-archer-shot',
      position: { x: 1, y: 1.35, z: 2 },
      direction: { x: 0, y: 0, z: -1 },
      travelled: 0.5,
    });
    expect(readArrowTransform(world, other)).toBeUndefined();
    expect(readArrowTransform(world, shot)).toEqual({
      position: { x: 1, y: 1.35, z: 2 },
      rotation: pointAlong({ x: 0, y: 0, z: -1 }),
    });
    expect(bindArrows(world, sync, headless)).toBe(1);
    expect(bindArrows(world, sync, headless)).toBe(0); // bound once
    expect(sync.has(shot)).toBe(true);
    // A world with neither arrows nor projectiles binds and reads nothing.
    const bare = new World<never>({ seed: 1 });
    expect(bindArrows(bare, new RenderSync(bare), headless)).toBe(0);
    expect(readArrowTransform(bare, bare.spawn())).toBeUndefined();
  });
});

describe('stuck arrow wobble on screen (mw-e29.11)', () => {
  it('AC-2: the quiver turns the shaft about its tip and leaves a still arrow untouched', () => {
    const world = new World<never>({ seed: 1 }).register(ArrowComponent, ArrowRestComponent);
    const arrow = world.spawn();
    world.add(arrow, ArrowRestComponent, {
      arrow: 'standard',
      shooter: null,
      state: 'stuck',
      position: { x: 1, y: 2, z: 3 },
      direction: { x: 0, y: 0, z: 1 },
      in: null,
      tick: 0,
      intact: true,
    });
    const still = readWobbledArrowTransform(world, arrow, () => 0);
    expect(still).toEqual(readArrowTransform(world, arrow));
    const quivering = readWobbledArrowTransform(world, arrow, () => 0.1);
    expect(quivering?.position).toEqual({ x: 1, y: 2, z: 3 });
    // The tip stays put and the shaft's far end swings to the side by about sin(0.1) of its length.
    const tail = rotateZ(quivering?.rotation ?? { x: 0, y: 0, z: 0, w: 1 });
    expect(Math.hypot(tail.x, tail.y)).toBeCloseTo(Math.sin(0.1), 6);
    expect(readWobbledArrowTransform(world, world.spawn(), () => 0.1)).toBeUndefined();
  });
});
