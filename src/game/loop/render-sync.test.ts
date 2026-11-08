import { defineComponent, World, type EntityId } from '@sim/index';
import { describe, expect, it } from 'vitest';
import { FakeFrames } from './fake-frames';
import { createFrameLoop } from './fixed-step';
import {
  IDENTITY_ROTATION,
  interpolateTransform,
  lerpVec3,
  RenderSync,
  slerpQuat,
  type Quat,
  type SceneBinding,
  type SimView,
  type Transform,
} from './render-sync';

interface Pos {
  x: number;
}
const Position = defineComponent<Pos>('Position');

const readPos = (view: SimView, id: EntityId): Transform | undefined => {
  const p = view.get(id, Position);
  return p === undefined
    ? undefined
    : { position: { x: p.x, y: 0, z: 0 }, rotation: IDENTITY_ROTATION };
};

/** A scene object stand-in recording what render sync did to it. */
interface FakeObject {
  applied: Transform[];
  disposed: number;
}

function fakeBinding(read = readPos): SceneBinding<FakeObject> {
  return {
    object: { applied: [], disposed: 0 },
    read,
    apply: (object, transform) => object.applied.push(transform),
    dispose: (object) => {
      object.disposed++;
    },
  };
}

function world(): World {
  return new World({ seed: 7 }).register(Position);
}

const lastX = (object: FakeObject): number | undefined => object.applied.at(-1)?.position.x;

describe('RenderSync', () => {
  it('AC-5: an entity destroyed in the sim has its scene object disposed in the same frame', () => {
    const w = world();
    const doomed = w.spawn();
    w.add(doomed, Position, { x: 0 });
    let destroyAt = -1;
    w.addSystem({
      name: 'reaper',
      run: ({ tick, world: self }) => {
        if (tick === destroyAt) self.destroy(doomed);
      },
    });
    const sync = new RenderSync(w);
    const binding = fakeBinding();
    sync.bind(doomed, binding);

    const frames = new FakeFrames();
    const disposedInFrame: number[] = [];
    let frameNo = 0;
    const loop = createFrameLoop({
      sim: w,
      hz: w.clock.hz,
      now: frames.now,
      scheduler: frames,
      visibility: frames,
      onStep: () => {
        sync.capture();
      },
      render: ({ alpha }) => {
        frameNo++;
        sync.render(alpha);
        if (binding.object.disposed > 0 && disposedInFrame.length === 0)
          disposedInFrame.push(frameNo);
      },
    });
    loop.start();
    frames.frame(1000 / 60); // frame 1: tick 0
    destroyAt = 1;
    frames.frame(1000 / 60); // frame 2: tick 1 destroys the entity
    expect(w.isAlive(doomed)).toBe(false);
    expect(binding.object.disposed).toBe(1);
    expect(disposedInFrame).toEqual([2]);
    expect(sync.has(doomed)).toBe(false);
    frames.frame(1000 / 60);
    expect(binding.object.disposed).toBe(1); // exactly once
  });

  it('objectOf gives the bound scene object, or undefined for an unbound entity', () => {
    const w = world();
    const entity = w.spawn();
    w.add(entity, Position, { x: 0 });
    const sync = new RenderSync(w);
    const binding = fakeBinding();
    sync.bind(entity, binding);
    expect(sync.objectOf(entity)).toBe(binding.object);
    expect(sync.objectOf(w.spawn())).toBeUndefined();
  });

  it('interpolates between the previous and latest sim step by alpha', () => {
    const w = world();
    const id = w.spawn();
    w.add(id, Position, { x: 0 });
    const sync = new RenderSync(w);
    const binding = fakeBinding();
    sync.bind(id, binding);
    expect(lastX(binding.object)).toBe(0); // placed at once on bind

    w.set(id, Position, { x: 10 });
    sync.capture();
    sync.render(0.25);
    expect(lastX(binding.object)).toBeCloseTo(2.5, 10);
    sync.render(0);
    expect(lastX(binding.object)).toBe(0);

    w.set(id, Position, { x: 20 });
    sync.capture();
    sync.render(0.5);
    expect(lastX(binding.object)).toBeCloseTo(15, 10);
  });

  it('leaves an object without a transform alone, then snaps to its first transform', () => {
    const w = world();
    const id = w.spawn();
    const sync = new RenderSync(w);
    const binding = fakeBinding();
    sync.bind(id, binding);
    sync.render(0.5);
    expect(binding.object.applied).toEqual([]);

    w.add(id, Position, { x: 4 });
    sync.capture();
    sync.render(0.5);
    expect(lastX(binding.object)).toBe(4); // no previous: no interpolation from nowhere
  });

  it('skips dead entities during capture and disposes them on render', () => {
    const w = world();
    const id = w.spawn();
    w.add(id, Position, { x: 1 });
    const sync = new RenderSync(w);
    let reads = 0;
    const binding = fakeBinding((view, entity) => {
      reads++;
      return readPos(view, entity);
    });
    sync.bind(id, binding);
    w.destroy(id);
    sync.capture();
    expect(reads).toBe(1);
    sync.render(0);
    expect(binding.object.disposed).toBe(1);
    expect(sync.size).toBe(0);
  });

  it('refuses to bind an entity that is not alive', () => {
    const sync = new RenderSync(world());
    expect(() => {
      sync.bind(99, fakeBinding());
    }).toThrow(/entity 99/);
  });

  it('rebinding disposes the old object; unbind and dispose free objects', () => {
    const w = world();
    const a = w.spawn();
    const b = w.spawn();
    const sync = new RenderSync(w);
    const first = fakeBinding();
    const second = fakeBinding();
    const third = fakeBinding();
    sync.bind(a, first);
    sync.bind(a, second);
    expect(first.object.disposed).toBe(1);
    expect(sync.size).toBe(1);
    expect(sync.unbind(a)).toBe(true);
    expect(sync.unbind(a)).toBe(false);
    expect(second.object.disposed).toBe(1);
    sync.bind(a, fakeBinding());
    sync.bind(b, third);
    sync.dispose();
    expect(sync.size).toBe(0);
    expect(third.object.disposed).toBe(1);
  });
});

describe('interpolation', () => {
  const quarterTurnY: Quat = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };

  it('lerps positions', () => {
    expect(lerpVec3({ x: 0, y: 2, z: -4 }, { x: 10, y: 4, z: 4 }, 0.5)).toEqual({
      x: 5,
      y: 3,
      z: 0,
    });
  });

  it('slerps rotations at constant angular speed', () => {
    const half = slerpQuat(IDENTITY_ROTATION, quarterTurnY, 0.5);
    const eighth = Math.PI / 8;
    expect(half.y).toBeCloseTo(Math.sin(eighth), 10);
    expect(half.w).toBeCloseTo(Math.cos(eighth), 10);
    expect(slerpQuat(IDENTITY_ROTATION, quarterTurnY, 0)).toMatchObject({ y: 0, w: 1 });
  });

  it('takes the short way round when the quaternions are in opposite hemispheres', () => {
    const negated: Quat = { x: -0, y: -Math.SQRT1_2, z: -0, w: -Math.SQRT1_2 };
    const a = slerpQuat(IDENTITY_ROTATION, negated, 0.5);
    const b = slerpQuat(IDENTITY_ROTATION, quarterTurnY, 0.5);
    // Same rotation (q ≡ -q): equal up to sign.
    const s = Math.sign(a.w * b.w);
    expect(a.y * s).toBeCloseTo(b.y, 10);
    expect(a.w * s).toBeCloseTo(b.w, 10);
  });

  it('falls back to normalised lerp for nearly equal rotations', () => {
    const tiny: Quat = { x: 0, y: 0.001, z: 0, w: Math.sqrt(1 - 0.001 ** 2) };
    const mid = slerpQuat(IDENTITY_ROTATION, tiny, 0.5);
    expect(Math.hypot(mid.x, mid.y, mid.z, mid.w)).toBeCloseTo(1, 12);
    expect(mid.y).toBeCloseTo(0.0005, 6);
  });

  it('interpolates whole transforms', () => {
    const t = interpolateTransform(
      { position: { x: 0, y: 0, z: 0 }, rotation: IDENTITY_ROTATION },
      { position: { x: 2, y: 0, z: 0 }, rotation: IDENTITY_ROTATION },
      0.5,
    );
    expect(t.position.x).toBe(1);
    expect(t.rotation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });
});
