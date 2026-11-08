// Remote holds (mw-e03.12): hold, levitate and fling liftable objects from a distance, on the real
// deterministic Rapier build.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { box } from '../character/greybox';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import {
  addInteractable,
  addInteractor,
  INTERACTION_COMPONENTS,
  interacted,
} from '../interaction/system';
import { installMechanisms, makeSwitch, SwitchComponent } from '../mechanisms';
import { hypot } from '../math';
import {
  addPhysicsObject,
  installPhysicsObjects,
  PhysicsObjectComponent,
  removePhysicsObject,
  rigidBodiesOf,
} from '../physics/objects';
import { RapierPhysics } from '../physics/rapier';
import type { ColliderHandle } from '../physics/static-colliders';
import { addProperties, registerWorldProperties, setProperty } from '../properties/components';
import { placeEntity, placementOf } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { installStimuli, stimulusSystem } from '../stimulus/stimulus';
import {
  actuateRemotely,
  addAttractor,
  addGravityZone,
  canHoldRemotely,
  gravityScaleOf,
  holdOnTarget,
  holdRemotely,
  HOLD_STALL_SECONDS,
  installRemoteHold,
  releaseHold,
  remoteHolds,
  RemoteHoldReleased,
  removeField,
  setHoldPoint,
  settleRemoteHolds,
  type RemoteHoldReleasedInfo,
} from './remote-hold';
import { ForceResisted, type ForceResistedInfo } from './tether';

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

function rig(installed = true) {
  const physics = new RapierPhysics(RAPIER);
  const world = installStimuli(
    registerWorldProperties(new World<never>({ seed: 9, hz: 60, physics })),
  );
  world.register(...INTERACTION_COMPONENTS);
  installPhysicsObjects(world);
  physics.add(box(v(-60, -1, -60), v(60, 0, 60)));
  world.addSystem(stimulusSystem());
  if (installed) installRemoteHold(world);
  installMechanisms(world);
  const released: RemoteHoldReleasedInfo[] = [];
  const resisted: ForceResistedInfo[] = [];
  world.events.on(RemoteHoldReleased, (e) => released.push(e));
  world.events.on(ForceResisted, (e) => resisted.push(e));
  const holder = world.spawn();
  placeEntity(world, holder, v(0, 0, 0), 0.4);
  addInteractor(world, holder);
  const body = (weight: number, at: Vec3, props: Record<string, unknown> = {}): EntityId => {
    const e = world.spawn();
    addProperties(world, e, { weight, liftable: true, ...props });
    addPhysicsObject(world, e, { shape: { kind: 'sphere', radius: 0.25 }, position: at });
    return e;
  };
  const steps = (n: number): void => {
    for (let i = 0; i < n; i++) world.step();
  };
  const velocityOf = (e: EntityId): Vec3 =>
    rigidBodiesOf(world).motionOf(world.get(e, PhysicsObjectComponent)?.body as ColliderHandle)
      .linvel;
  const at = (e: EntityId): Vec3 => placementOf(world, e) as Vec3;
  return { world, physics, holder, body, steps, velocityOf, at, released, resisted };
}

describe('remote holds (mw-e03.12)', () => {
  it('AC-1: a 30 kg object under strength 50 tracks its target within 0.5 s; 80 kg is overweight', () => {
    const r = rig();
    r.steps(1);
    const crate = r.body(30, v(0, 0.25, -2));
    const target = v(2, 3, -4);
    r.steps(1);
    expect(holdRemotely(r.world, r.holder, crate, target, 50)).toEqual({ ok: true });
    const start = hypot(2, 2.75, -2);
    let settled = -1;
    for (let i = 1; i <= 60; i++) {
      r.steps(1);
      const p = r.at(crate);
      const err = hypot(p.x - target.x, p.y - target.y, p.z - target.z);
      if (settled < 0 && err < 0.02 * start) settled = i / 60;
      if (settled >= 0) expect(err).toBeLessThan(0.05 * start); // stays settled
    }
    expect(settled).toBeGreaterThan(0);
    expect(settled).toBeLessThanOrEqual(0.5);
    // It then hangs there against gravity.
    r.steps(60);
    expect(r.at(crate).y).toBeCloseTo(3, 1);

    const heavy = r.body(80, v(5, 0.25, 0));
    expect(holdRemotely(r.world, r.holder, heavy, target, 50)).toEqual({
      ok: false,
      reason: 'overweight',
    });
    expect(holdOnTarget(r.world, heavy)).toBeUndefined();
    r.world.events.flush();
    expect(r.resisted).toMatchObject([{ target: heavy, weight: 80, limit: 50, spell: null }]);
  });

  it('refuses what cannot be held: no body, not liftable', () => {
    const r = rig();
    const ghost = r.world.spawn();
    expect(canHoldRemotely(r.world, ghost, 50)).toEqual({ ok: false, reason: 'no-body' });
    const bolted = r.body(5, v(0, 1, 0), { liftable: false });
    expect(holdRemotely(r.world, r.holder, bolted, v(0, 2, 0), 50)).toEqual({
      ok: false,
      reason: 'not-liftable',
    });
    expect(remoteHolds(r.world)).toEqual([]);
  });

  it('AC-2: a hold blocked by a wall for more than 1.0 s breaks and the object drops', () => {
    const r = rig();
    r.physics.add(box(v(-3, 0, -6), v(3, 4, -5.5))); // a wall between the crate and its target
    r.steps(1);
    const crate = r.body(10, v(0, 1, -2));
    r.steps(1);
    holdRemotely(r.world, r.holder, crate, v(0, 1, -12), 50);
    r.steps(Math.round(HOLD_STALL_SECONDS * 60) - 20);
    expect(holdOnTarget(r.world, crate)).toBeDefined(); // still gripping before the second is up
    r.steps(90);
    expect(r.released).toMatchObject([{ target: crate, reason: 'obstructed' }]);
    expect(r.at(crate).z).toBeGreaterThan(-5.5); // never got through
    r.steps(60);
    expect(r.at(crate).y).toBeCloseTo(0.25, 1); // dropped to the floor
  });

  it('a hold that reaches its point is never obstructed, and a moved point is followed', () => {
    const r = rig();
    r.steps(1);
    const crate = r.body(10, v(0, 0.25, -2));
    r.steps(1);
    holdRemotely(r.world, r.holder, crate, v(0, 2, -2), 50);
    r.steps(180);
    expect(r.released).toEqual([]);
    expect(setHoldPoint(r.world, crate, v(3, 2, -2))).toBe(true);
    r.steps(60);
    expect(r.at(crate).x).toBeCloseTo(3, 1);
    expect(setHoldPoint(r.world, r.holder, v(0, 0, 0))).toBe(false);
    // Several holds are steered independently, each keeping its own point.
    const second = r.body(10, v(-3, 0.25, -2));
    holdRemotely(r.world, r.holder, second, v(-3, 2, -2), 50);
    setHoldPoint(r.world, second, v(-3, 4, -2));
    r.steps(90);
    expect(r.at(second).y).toBeCloseTo(4, 1);
    expect(r.at(crate).x).toBeCloseTo(3, 1);
  });

  it('holds on a heavier body: overload breaks it; a lost holder or body breaks it', () => {
    const r = rig();
    r.steps(1);
    const crate = r.body(30, v(0, 2, -2));
    holdRemotely(r.world, r.holder, crate, v(0, 2, -2), 50);
    r.steps(2);
    setProperty(r.world, crate, 'weight', 60);
    r.steps(1);
    expect(r.released.map((e) => e.reason)).toEqual(['overload']);
    const a = r.body(10, v(2, 2, -2));
    holdRemotely(r.world, r.holder, a, v(2, 2, -2), 50);
    r.world.destroy(r.holder);
    r.steps(1);
    const b = r.body(10, v(-2, 2, -2));
    const other = r.world.spawn();
    holdRemotely(r.world, other, b, v(-2, 2, -2), 50);
    removePhysicsObject(r.world, b);
    r.steps(2);
    expect(r.released.map((e) => e.reason)).toEqual(['overload', 'lost', 'lost']);
  });

  it('a new hold on the same target replaces the old one', () => {
    const r = rig();
    r.steps(1);
    const crate = r.body(10, v(0, 2, -2));
    holdRemotely(r.world, r.holder, crate, v(0, 2, -2), 50);
    const other = r.world.spawn();
    holdRemotely(r.world, other, crate, v(1, 2, -2), 50);
    r.world.events.flush();
    expect(r.released.map((e) => e.reason)).toEqual(['replaced']);
    expect(remoteHolds(r.world)).toHaveLength(1);
    expect(holdOnTarget(r.world, crate)?.holder).toBe(other);
  });

  it('AC-3: a point attractor accelerates loose liftable objects by S/mass and ignores the rest', () => {
    const r = rig();
    r.steps(1);
    // Equal distance either side of the point, so only the mass differs.
    const light = r.body(10, v(-2, 10, 0));
    const heavy = r.body(20, v(2, 10, 0));
    const fixed = r.body(10, v(0, 10, 3), { liftable: false });
    const far = r.body(10, v(-40, 10, 0));
    const held = r.body(10, v(0, 10, -3));
    r.steps(1);
    holdRemotely(r.world, r.holder, held, v(0, 10, -3), 50);
    addAttractor(r.world, { point: v(0, 10, 0), radius: 12, strength: 600 });
    const all = [light, heavy, fixed, far];
    const before = all.map((e) => r.velocityOf(e).x);
    const gained = (e: EntityId, i: number): number => r.velocityOf(e).x - (before[i] ?? NaN);
    r.steps(1);
    const [dl, dh, df, dfar] = all.map(gained);
    // dv = S / m · dt: 600 / 10 / 60 = 1 m/s towards +x for the light one, half that (towards -x) for the heavy.
    expect(dl).toBeCloseTo(1, 2);
    expect(dh).toBeCloseTo(-0.5, 2);
    expect(df).toBeCloseTo(0, 6); // not liftable
    expect(dfar).toBeCloseTo(0, 6); // out of radius
    expect(r.at(held).z).toBeCloseTo(-3, 0); // a held object follows its hold, not the attractor
  });

  it('an attractor on its own point and an expired one do nothing; fields can be removed', () => {
    const r = rig();
    r.steps(1);
    const crate = r.body(10, v(0, 10, 0));
    const id = addAttractor(r.world, {
      point: v(0, 10, 0),
      radius: 5,
      strength: 600,
      seconds: 0.5,
    });
    const keep = addAttractor(r.world, { point: v(0, 10, 0), radius: 5, strength: 600 });
    const g = addGravityZone(r.world, { min: v(-9, 0, -9), max: v(9, 20, 9), scale: 1 });
    r.steps(1);
    expect(r.velocityOf(crate).x).toBeCloseTo(0, 6); // zero distance: no direction
    r.steps(40);
    expect(removeField(r.world, id)).toBe(false); // already expired
    expect(removeField(r.world, keep)).toBe(true);
    expect(removeField(r.world, g)).toBe(true);
    expect(removeField(r.world, 999)).toBe(false);
  });

  it('a gravity zone scales gravity for liftable objects only; zero floats, two doubles', () => {
    const r = rig();
    r.steps(1);
    const floater = r.body(10, v(0, 10, 0));
    const faller = r.body(10, v(20, 10, 0));
    const plain = r.body(10, v(0, 10, 5), { liftable: false });
    const heavier = r.body(10, v(0, 10, -5));
    addGravityZone(r.world, { min: v(-10, 0, -3), max: v(10, 30, 3), scale: 0, seconds: 1 });
    addGravityZone(r.world, { min: v(-10, 0, -8), max: v(10, 30, -4), scale: 2 });
    r.steps(30);
    expect(Math.abs(r.velocityOf(floater).y)).toBeLessThan(0.01);
    expect(r.velocityOf(faller).y).toBeCloseTo(-9.81 * 0.5, 0);
    expect(r.velocityOf(plain).y).toBeCloseTo(-9.81 * 0.5, 0);
    expect(r.velocityOf(heavier).y).toBeCloseTo(-9.81, 0);
    r.steps(60); // the zone ends after 1 s and the floater begins to fall
    expect(r.velocityOf(floater).y).toBeLessThan(-1);
  });

  it('gravityScaleOf reads the gravity a thing feels: held 0, zones add to 1, others and bare worlds 1 (mw-e03.19)', () => {
    const r = rig();
    r.steps(1);
    const loose = r.body(10, v(0, 10, 0));
    const fixed = r.body(10, v(0, 10, 5), { liftable: false });
    const held = r.body(10, v(10, 10, 0));
    const far = r.body(10, v(20, 10, 0));
    const marker = r.world.spawn();
    expect(gravityScaleOf(r.world, loose)).toBe(1);
    addGravityZone(r.world, { min: v(-3, 0, -3), max: v(3, 30, 8), scale: 0 });
    addGravityZone(r.world, { min: v(-3, 0, -3), max: v(3, 30, 3), scale: 3 });
    expect(gravityScaleOf(r.world, loose)).toBe(2); // 1 + (0 − 1) + (3 − 1)
    expect(gravityScaleOf(r.world, far)).toBe(1); // outside every zone
    expect(gravityScaleOf(r.world, fixed)).toBe(1); // zones act on liftable objects only
    expect(gravityScaleOf(r.world, marker)).toBe(1); // not a body
    holdRemotely(r.world, r.holder, held, v(10, 10, 0), 50);
    expect(gravityScaleOf(r.world, held)).toBe(0);
    expect(gravityScaleOf(rig(false).world, loose)).toBe(1); // remote holds not installed
  });

  it('AC-5: a hold released with velocity v leaves at v within 1%', () => {
    const r = rig();
    r.steps(1);
    const crate = r.body(30, v(0, 2, -2));
    holdRemotely(r.world, r.holder, crate, v(0, 2, -2), 50);
    r.steps(30);
    const throwV = v(6, 3, -8);
    expect(releaseHold(r.world, crate, throwV)).toBe(true);
    const out = r.velocityOf(crate);
    for (const k of ['x', 'y', 'z'] as const) {
      expect(Math.abs(out[k] - throwV[k])).toBeLessThanOrEqual(0.01 * Math.abs(throwV[k]));
    }
    expect(holdOnTarget(r.world, crate)).toBeUndefined();
    expect(releaseHold(r.world, crate)).toBe(false);
    r.world.events.flush();
    expect(r.released.at(-1)?.reason).toBe('released');
  });

  it('a plain release keeps the velocity it has and the object falls', () => {
    const r = rig();
    r.steps(1);
    const crate = r.body(30, v(0, 2, -2));
    holdRemotely(r.world, r.holder, crate, v(0, 2, -2), 50);
    r.steps(30);
    expect(releaseHold(r.world, crate)).toBe(true);
    r.steps(60);
    expect(r.at(crate).y).toBeCloseTo(0.25, 1);
  });

  it('settling for a save lets go of every hold where it is', () => {
    const r = rig();
    r.steps(1);
    const a = r.body(10, v(0, 2, -2));
    const b = r.body(10, v(2, 2, -2));
    holdRemotely(r.world, r.holder, a, v(0, 2, -2), 50);
    holdRemotely(r.world, r.holder, b, v(2, 2, -2), 50);
    settleRemoteHolds(r.world);
    expect(remoteHolds(r.world)).toEqual([]);
    r.world.events.flush();
    expect(r.released.map((e) => e.reason)).toEqual(['saved', 'saved']);
    // Not installed: nothing to settle, no holds, no fields to remove, and starting one is an error.
    const bare = rig(false);
    settleRemoteHolds(bare.world);
    expect(remoteHolds(bare.world)).toEqual([]);
    expect(removeField(bare.world, 1)).toBe(false);
    expect(releaseHold(bare.world, bare.holder)).toBe(false);
    expect(setHoldPoint(bare.world, bare.holder, v(0, 0, 0))).toBe(false);
    const crate = bare.body(10, v(0, 2, 0));
    expect(() => holdRemotely(bare.world, bare.holder, crate, v(0, 2, 0), 50)).toThrow(/install/);
    expect(() =>
      addGravityZone(bare.world, { min: v(0, 0, 0), max: v(1, 1, 1), scale: 0 }),
    ).toThrow(/install/);
    expect(() => addAttractor(bare.world, { point: v(0, 0, 0), radius: 1, strength: 1 })).toThrow(
      /install/,
    );
  });

  it('AC-4: a remoteActuatable lever in range toggles exactly as when interacted with; one without the flag does not', () => {
    const r = rig();
    const lever = (flagged: boolean, origin: Vec3): EntityId => {
      const e = r.world.spawn();
      addProperties(r.world, e, flagged ? { remoteActuatable: true } : {});
      addInteractable(r.world, e, { affordances: [{ verb: 'pull' }] }, origin);
      makeSwitch(r.world, e, 'lever');
      return e;
    };
    const flagged = lever(true, v(0, 0, -6));
    const plain = lever(false, v(0, 0, -6));
    const far = lever(true, v(0, 0, -40));
    const hand = lever(true, v(2, 0, -6)); // the control: pulled by hand through the same door
    r.steps(1);
    const position = (e: EntityId): number | undefined => r.world.get(e, SwitchComponent)?.position;
    expect(actuateRemotely(r.world, r.holder, flagged, 10)).toMatchObject({
      ok: true,
      interaction: { actor: r.holder, target: flagged, verb: 'pull' },
    });
    r.world.events.flush();
    expect(position(flagged)).toBe(1);
    // By hand: the interact event the interaction system fires for the control lever.
    r.world.events.emit(interacted, { actor: r.holder, target: hand, verb: 'pull', affordance: 0 });
    r.world.events.flush();
    expect(position(hand)).toBe(1);
    expect(position(flagged)).toBe(position(hand));
    // Without the flag, or out of range, or nothing usable: refused and nothing moves.
    expect(actuateRemotely(r.world, r.holder, plain, 10)).toEqual({
      ok: false,
      reason: 'not-actuatable',
    });
    expect(actuateRemotely(r.world, r.holder, far, 10)).toEqual({
      ok: false,
      reason: 'out-of-range',
    });
    const ghost = r.world.spawn();
    addProperties(r.world, ghost, { remoteActuatable: true });
    expect(actuateRemotely(r.world, r.holder, ghost, 10)).toEqual({
      ok: false,
      reason: 'out-of-range', // no placement
    });
    const inert = r.world.spawn();
    addProperties(r.world, inert, { remoteActuatable: true });
    placeEntity(r.world, inert, v(0, 0, -3), 0.2);
    expect(actuateRemotely(r.world, r.holder, inert, 10)).toEqual({
      ok: false,
      reason: 'unusable',
    });
    r.world.events.flush();
    expect(position(plain)).toBe(0);
    expect(position(far)).toBe(0);
  });
});
