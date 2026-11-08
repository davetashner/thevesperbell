import { describe, expect, it } from 'vitest';
import { World } from '../../core/world';
import { IDENTITY_POSE, type Pose } from '../../geom';
import { PlacementComponent, placeEntity } from '../../stimulus/placement';
import type { Vec3 } from '../../stimulus/shapes';
import {
  closeHitboxes,
  giveHitboxes,
  giveHurtboxes,
  HIT_REGIONS,
  HIT_VOLUME_COMPONENTS,
  HitboxComponent,
  HurtboxComponent,
  hurtboxSet,
  liveHitboxes,
  openHitbox,
  ROOT_SOCKET,
  setHurtboxFacing,
  setSocketPose,
  socketPose,
  type HitboxSpec,
  type Hurtbox,
} from './components';
import { hurtboxShapes } from './system';

const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const at = (position: Vec3): Pose => ({ position, rotation: IDENTITY_POSE.rotation });

const head: Hurtbox = {
  id: 'head',
  socket: 'neck',
  region: 'head',
  armored: false,
  multiplier: 1.5,
  shape: { kind: 'sphere', center: v3(0, 0.2, 0), radius: 0.15 },
};
const chest: Hurtbox = {
  id: 'chest',
  socket: ROOT_SOCKET,
  region: 'torso',
  armored: true,
  multiplier: 1,
  shape: { kind: 'box', center: v3(0, 1.2, 0), halfExtents: v3(0.3, 0.3, 0.2) },
};
const spec: HitboxSpec = {
  id: 'jab',
  shape: { kind: 'capsule', from: v3(0, 0, 0), to: v3(0, 0, 1), radius: 0.1 },
  track: { id: 't', keys: [IDENTITY_POSE] },
  activeTicks: 2,
  aim: v3(0, 0, 1),
  friendlyFire: false,
};

function world() {
  return new World<never>({ seed: 1 }).register(...HIT_VOLUME_COMPONENTS, PlacementComponent);
}

describe('hit-volume components (mw-e04.2)', () => {
  it('regions are listed highest priority first', () => {
    expect(HIT_REGIONS).toEqual(['weakpoint', 'head', 'torso', 'limb']);
  });

  it('hurtboxSet validates and freezes; facing defaults to +z', () => {
    const set = hurtboxSet({ boxes: [head, chest], sockets: { neck: at(v3(0, 1.5, 0)) } });
    expect(set.facing).toEqual(v3(0, 0, 1));
    expect(
      Object.isFrozen(set) && Object.isFrozen(set.boxes) && Object.isFrozen(set.boxes[0]),
    ).toBe(true);
    expect(hurtboxSet({ boxes: [], facing: v3(2, 5, 0) }).facing).toEqual(v3(1, 0, 0));
  });

  it('hurtboxSet rejects bad data', () => {
    const bad =
      (boxes: readonly Hurtbox[], extra: object = {}) =>
      () =>
        hurtboxSet({ boxes, sockets: { neck: at(v3(0, 1, 0)) }, ...extra });
    expect(bad([chest, chest])).toThrow(/unique/);
    expect(bad([{ ...chest, id: '' }])).toThrow(/unique/);
    expect(bad([{ ...chest, socket: 'tail' }])).toThrow(/unknown socket "tail"/);
    expect(bad([{ ...chest, region: 'wing' as Hurtbox['region'] }])).toThrow(/unknown region/);
    expect(bad([{ ...chest, multiplier: -1 }])).toThrow(/multiplier/);
    expect(bad([{ ...chest, multiplier: Number.NaN }])).toThrow(/multiplier/);
    expect(bad([{ ...head, shape: { ...head.shape, radius: 0 } } as Hurtbox])).toThrow(/radius/);
    expect(
      bad([{ ...head, shape: { kind: 'sphere', center: v3(Number.NaN, 0, 0), radius: 1 } }]),
    ).toThrow(/finite/);
    expect(
      bad([
        { ...head, shape: { kind: 'capsule', from: v3(0, 0, 0), to: v3(0, 1, 0), radius: -1 } },
      ]),
    ).toThrow(/radius/);
    expect(
      bad([{ ...chest, shape: { kind: 'box', center: v3(0, 0, 0), halfExtents: v3(1, 0, 1) } }]),
    ).toThrow(/half extents/);
    expect(bad([{ ...chest, armor: -1 }])).toThrow(/armor/);
    expect(bad([{ ...chest, armor: Number.NaN }])).toThrow(/armor/);
    expect(
      bad([{ ...chest, underlying: { region: 'weakpoint' as never, multiplier: 1 } }]),
    ).toThrow(/underlying region/);
    expect(bad([{ ...chest, underlying: { region: 'torso', multiplier: -1 } }])).toThrow(
      /underlying multiplier/,
    );
    expect(bad([], { sockets: { root: IDENTITY_POSE } })).toThrow(/implicit/);
    expect(bad([], { sockets: { neck: at(v3(Infinity, 0, 0)) } })).toThrow(/finite/);
    expect(bad([], { facing: v3(0, 1, 0) })).toThrow(/horizontal/);
  });

  it('giveHurtboxes adds then replaces; sockets carry their shapes; facing turns them', () => {
    const w = world();
    const e = w.spawn();
    placeEntity(w, e, v3(10, 0, 0));
    giveHurtboxes(w, e, { boxes: [chest] });
    giveHurtboxes(w, e, { boxes: [head, chest], sockets: { neck: at(v3(0, 1.5, 0.1)) } });
    const [placedHead, placedChest] = hurtboxShapes(w, e).map((p) => p.shape);
    expect(placedHead).toMatchObject({ kind: 'sphere', center: v3(10, 1.7, 0.1) });
    expect(placedChest).toMatchObject({ kind: 'box', center: v3(10, 1.2, 0) });

    setSocketPose(w, e, 'neck', at(v3(0, 1.5, 0.3)));
    expect(hurtboxShapes(w, e)[0]?.shape).toMatchObject({ center: v3(10, 1.7, 0.3) });
    setHurtboxFacing(w, e, v3(0, 0, -3));
    const turned = hurtboxShapes(w, e)[0]?.shape;
    expect(turned?.kind === 'sphere' && turned.center.z).toBeCloseTo(-0.3, 12);

    expect(socketPose(w.get(e, HurtboxComponent) ?? hurtboxSet({ boxes: [] }), ROOT_SOCKET)).toBe(
      IDENTITY_POSE,
    );
    expect(() => {
      setSocketPose(w, e, 'tail', IDENTITY_POSE);
    }).toThrow(/unknown socket/);
    expect(() => {
      setSocketPose(w, e, 'neck', at(v3(Number.NaN, 0, 0)));
    }).toThrow(/finite/);
    const other = w.spawn();
    expect(() => {
      setHurtboxFacing(w, other, v3(1, 0, 0));
    }).toThrow(/no hurtboxes/);
    // Hurtboxes without a placement are nowhere.
    giveHurtboxes(w, other, { boxes: [chest] });
    expect(hurtboxShapes(w, other)).toEqual([]);
  });

  it('openHitbox validates, adds the component when missing, and replaces a spent hitbox', () => {
    const w = world();
    const e = w.spawn();
    expect(liveHitboxes(w, e)).toEqual([]);
    openHitbox(w, e, spec);
    expect(w.has(e, HitboxComponent)).toBe(true);
    const [live] = liveHitboxes(w, e);
    expect(live).toMatchObject({ id: 'jab', elapsed: 0, pose: null, sweptFrom: null, hit: [] });
    expect(() => {
      openHitbox(w, e, spec);
    }).toThrow(/already open/);
    expect(() => {
      openHitbox(w, e, { ...spec, id: '' });
    }).toThrow(/empty/);
    expect(() => {
      openHitbox(w, e, { ...spec, id: 'x', activeTicks: 0 });
    }).toThrow(/activeTicks/);
    expect(() => {
      openHitbox(w, e, { ...spec, id: 'x', activeTicks: 1.5 });
    }).toThrow(/activeTicks/);
    expect(() => {
      openHitbox(w, e, { ...spec, id: 'x', track: { id: 't', keys: [] } });
    }).toThrow(/no keys/);
    expect(() => {
      openHitbox(w, e, { ...spec, id: 'x', track: { id: 't', keys: [at(v3(0, Number.NaN, 0))] } });
    }).toThrow(/track key 0/);
    expect(() => {
      openHitbox(w, e, {
        ...spec,
        id: 'x',
        shape: { ...spec.shape, radius: 0 } as HitboxSpec['shape'],
      });
    }).toThrow(/radius/);
    expect(() => {
      openHitbox(w, e, { ...spec, id: 'x', aim: v3(0, -1, 0) });
    }).toThrow(/horizontal/);

    // Spent (its window swept): the same id opens afresh.
    if (live === undefined) throw new Error('not opened');
    const spent = { live: [{ ...live, elapsed: 2 }] };
    w.set(e, HitboxComponent, spent);
    openHitbox(w, e, spec);
    expect(liveHitboxes(w, e).map((h) => h.elapsed)).toEqual([0]);
  });

  it('giveHitboxes is idempotent', () => {
    const w = world();
    const e = w.spawn();
    giveHitboxes(w, e);
    openHitbox(w, e, spec);
    giveHitboxes(w, e);
    expect(liveHitboxes(w, e)).toHaveLength(1);
    expect(closeHitboxes(w, e)).toBe(1);
  });
});
