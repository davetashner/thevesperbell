import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { loadGameContent } from '@content/index';
import {
  applyStimulus,
  BreakableComponent,
  InMemoryColliderSink,
  PhysicsColliderComponent,
  PhysicsObjectComponent,
  RapierPhysics,
  readProperty,
  registerSceneComponents,
  SceneLayoutError,
  sceneMembers,
  World,
  type ColliderHandle,
  type EntityId,
  type SceneLayout,
  type SceneSpawnPlacement,
  type Vec3,
} from '@sim/index';
import { describe, expect, it } from 'vitest';
import { RenderSync, type SceneBinding, type Transform } from '../loop/render-sync';
import { installGamePhysics } from '../physics-objects';
import {
  DEFAULT_SCENE,
  readPhysicsObjectTransform,
  readSceneTransform,
  readWorldFrame,
  SceneLoader,
  UnknownSceneError,
  type SceneTransformReader,
} from './scene-loader';
import { resolveSceneRequest } from './scene-request';

/** A stand-in render object: what it was built from, where it was put, whether it was disposed. */
interface FakeObject {
  readonly kind: 'static' | 'spawn';
  readonly label: string;
  transform?: Transform;
  disposed: boolean;
}

function setup() {
  const content = loadGameContent();
  const world = registerSceneComponents(new World({ seed: 3 }));
  const sync = new RenderSync(world);
  const colliders = new InMemoryColliderSink();
  const built: FakeObject[] = [];
  const binding = (object: FakeObject): SceneBinding<FakeObject> => ({
    object,
    read: readSceneTransform,
    apply(target, transform) {
      target.transform = transform;
    },
    dispose(target) {
      target.disposed = true;
    },
  });
  const loader = new SceneLoader({
    world,
    sync,
    colliders,
    content,
    binding,
    objects: {
      staticGeometry(layout: SceneLayout) {
        const object: FakeObject = { kind: 'static', label: layout.id, disposed: false };
        built.push(object);
        return object;
      },
      spawn(spawn: SceneSpawnPlacement) {
        const object: FakeObject = { kind: 'spawn', label: spawn.id, disposed: false };
        built.push(object);
        return object;
      },
    },
  });
  return { content, world, sync, colliders, built, loader };
}

describe('scene loader glue (mw-e00.21)', () => {
  it('lists the scenes in the content and defaults to the testbed', () => {
    const { loader } = setup();
    expect(loader.available()).toEqual([
      'briar-glen-lane',
      'bridgeward-college',
      'combat-sandbox',
      'kit-gallery',
      'lighting-room',
      'marsh-store',
      'mechanism-room',
      'perf-baseline',
      'skeleton-pen',
      'sleeping-ox',
      'slice',
      'testbed',
      'valley-01',
      'valley-02',
      'valley-03',
      'weak-wall-room',
    ]);
    expect(loader.available()).toContain(DEFAULT_SCENE);
    expect(loader.current).toBeUndefined();
  });

  it('loads a scene into the sim, the collider sink and the renderer', () => {
    const { world, sync, colliders, built, loader } = setup();
    const loaded = loader.load('testbed');
    expect(loader.current).toBe(loaded);
    expect(sceneMembers(world, 'testbed').length).toBeGreaterThan(30);
    expect(colliders.count()).toBeGreaterThan(30);
    // One merged static object on the root, one per spawn; all bound and placed.
    expect(built.map((o) => `${o.kind}:${o.label}`)).toEqual([
      'static:testbed',
      'spawn:player-start',
      'spawn:training-dummy',
      'spawn:loose-crate',
      'spawn:room-lever',
      'spawn:closet-door',
      'spawn:arena-plank',
      'spawn:dummy-left',
      'spawn:dummy-centre',
      'spawn:dummy-right',
      'spawn:supply-chest',
    ]);
    expect(sync.size).toBe(11);
    expect(built[0]?.transform?.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(built[1]?.transform?.position).toEqual({ x: 0, y: 0, z: -1 });
  });

  it('AC-2: unloading leaves zero scene entities, zero colliders and zero render objects', () => {
    const { world, sync, colliders, built, loader } = setup();
    loader.load('testbed');
    loader.unload();
    expect(sceneMembers(world)).toEqual([]);
    expect(world.entityCount).toBe(0);
    expect(colliders.count()).toBe(0);
    expect(sync.size).toBe(0);
    expect(built.every((o) => o.disposed)).toBe(true);
    expect(loader.current).toBeUndefined();
    loader.unload(); // idempotent
  });

  it('AC-2: every shipped scene loads and unloads without leaving anything behind', () => {
    const { world, sync, colliders, loader } = setup();
    for (const id of loader.available()) {
      loader.load(id);
      expect(colliders.count()).toBeGreaterThan(0);
    }
    loader.unload();
    expect(world.entityCount).toBe(0);
    expect(colliders.count()).toBe(0);
    expect(sync.size).toBe(0);
  });

  it('switching scenes unloads the previous one first', () => {
    const { world, colliders, loader } = setup();
    loader.load('testbed');
    const gallery = loader.load('kit-gallery');
    expect(sceneMembers(world, 'testbed')).toEqual([]);
    expect(sceneMembers(world)).toHaveLength(1 + gallery.pieces.length + gallery.spawns.length);
    expect(colliders.count()).toBe(gallery.colliders.length);
  });

  it('AC-4: an unknown scene throws, listing the available scenes, and keeps the current one', () => {
    const { loader } = setup();
    const current = loader.load('testbed');
    expect(() => loader.load('does-not-exist')).toThrow(UnknownSceneError);
    expect(() => loader.load('does-not-exist')).toThrow(
      'unknown scene "does-not-exist"; available scenes: briar-glen-lane, bridgeward-college, combat-sandbox, kit-gallery, lighting-room, marsh-store, mechanism-room, perf-baseline, skeleton-pen, sleeping-ox, slice, testbed, valley-01, valley-02, valley-03, weak-wall-room',
    );
    expect(loader.current).toBe(current);
  });

  it('refuses a scene whose kit piece is missing from the content, loading nothing', () => {
    const content = loadGameContent();
    const world = registerSceneComponents(new World({ seed: 3 }));
    const sync = new RenderSync(world);
    const colliders = new InMemoryColliderSink();
    const loader = new SceneLoader({
      world,
      sync,
      colliders,
      content: {
        all: (type) => content.all(type),
        get: (type, id) => content.get(type, id),
        has: (type, id) => (type === 'kit' && id === 'wall' ? false : content.has(type, id)),
      },
      binding: () => {
        throw new Error('nothing should be bound');
      },
      objects: {
        staticGeometry: () => {
          throw new Error('nothing should be built');
        },
        spawn: () => {
          throw new Error('nothing should be built');
        },
      },
    });
    expect(() => loader.load('testbed')).toThrow(SceneLayoutError);
    expect(() => loader.load('testbed')).toThrow(/unknown kit piece "wall"/);
    expect(world.entityCount).toBe(0);
    expect(colliders.count()).toBe(0);
    expect(loader.current).toBeUndefined();
  });

  it('AC-4: resolves ?scene= against the available scenes', () => {
    const available = ['kit-gallery', 'testbed'];
    expect(resolveSceneRequest('', available)).toEqual({ kind: 'scene', id: 'testbed' });
    expect(resolveSceneRequest('?scene=', available)).toEqual({ kind: 'scene', id: 'testbed' });
    expect(resolveSceneRequest('?scene=kit-gallery&perf', available)).toEqual({
      kind: 'scene',
      id: 'kit-gallery',
    });
    expect(resolveSceneRequest('?scene=does-not-exist', available)).toEqual({
      kind: 'unknown',
      requested: 'does-not-exist',
      available,
    });
    expect(resolveSceneRequest('', ['kit-gallery'], 'testbed')).toEqual({
      kind: 'unknown',
      requested: 'testbed',
      available: ['kit-gallery'],
    });
  });
});

describe('scene loader physics (mw-e03.39)', () => {
  interface Drawn {
    readonly label: string;
    readonly size?: Vec3;
    transform?: Transform;
  }

  function physicsSetup(options: { levelMaterial?: string; noBody?: boolean } = {}) {
    const content = loadGameContent();
    const physics = new RapierPhysics(RAPIER);
    const world = installGamePhysics(registerSceneComponents(new World({ seed: 3, physics })));
    const sync = new RenderSync(world);
    const drawn = new Map<string, Drawn>();
    const reads = new Map<string, SceneTransformReader>();
    const make = (label: string, size?: Vec3): Drawn => {
      const object: Drawn = size === undefined ? { label } : { label, size };
      drawn.set(label, object);
      return object;
    };
    const loader = new SceneLoader({
      world,
      sync,
      colliders: physics,
      content,
      objects: {
        staticGeometry: (layout) => make(layout.id),
        spawn: (spawn) => make(spawn.id),
        ...(options.noBody !== true && { body: (spawn, size) => make(`body:${spawn.id}`, size) }),
      },
      binding: (object, read) => {
        reads.set(object.label, read);
        return {
          object,
          read,
          apply(target, transform) {
            target.transform = transform;
          },
          dispose: () => undefined,
        };
      },
      physics: options.levelMaterial === undefined ? {} : { levelMaterial: options.levelMaterial },
    });
    const loaded = loader.load('testbed');
    const entityOf = (id: string): EntityId =>
      loaded.spawns.find((s) => s.spawn.id === id)?.entity ?? -1;
    return { world, physics, sync, drawn, reads, loader, loaded, entityOf };
  }

  it('AC-1: movable props become physics objects; markers and level pieces do not', () => {
    const { world, drawn, reads, loaded, entityOf } = physicsSetup();
    const crate = entityOf('loose-crate');
    expect(world.get(crate, PhysicsObjectComponent)?.shape).toEqual({
      kind: 'box',
      halfExtents: { x: 0.35, y: 0.35, z: 0.35 },
    });
    expect(world.has(entityOf('arena-plank'), PhysicsObjectComponent)).toBe(true);
    expect(world.has(entityOf('player-start'), PhysicsObjectComponent)).toBe(false);
    expect(drawn.get('body:loose-crate')?.size).toEqual({ x: 0.7, y: 0.7, z: 0.7 });
    expect(reads.get('body:loose-crate')).toBe(readPhysicsObjectTransform);
    expect(reads.get('player-start')).toBe(readSceneTransform);
    expect(reads.get('testbed')).toBe(readSceneTransform);
    // Level pieces are stone entities owning their colliders.
    const floor = loaded.pieces[0] ?? -1;
    expect(readProperty(world as World<never>, floor, 'material')).toBe('stone');
    expect(world.has(floor, PhysicsColliderComponent)).toBe(true);
    expect(readPhysicsObjectTransform(world, floor)).toBeUndefined();
  });

  it('AC-3: render objects follow the sim pose, interpolated between the last two ticks', () => {
    const { world, physics, sync, drawn, entityOf } = physicsSetup();
    const crate = entityOf('loose-crate');
    const body = world.get(crate, PhysicsObjectComponent)?.body as ColliderHandle;
    const object = drawn.get('body:loose-crate');
    expect(object?.transform?.position.y).toBeCloseTo(0.35); // the body's centre, on the floor
    physics.applyImpulse(body, { x: 0, y: 60, z: 0 }); // toss it up at 5 m/s
    world.step();
    sync.capture();
    world.step();
    sync.capture();
    const pose = (): Vec3 =>
      world.get(crate, PhysicsObjectComponent)?.position ?? { x: 0, y: 0, z: 0 };
    const latest = pose();
    sync.render(0);
    const previous = object?.transform?.position.y ?? NaN;
    expect(previous).toBeLessThan(latest.y);
    sync.render(0.5);
    expect(object?.transform?.position.y).toBeCloseTo((previous + latest.y) / 2, 6);
    expect(pose()).toEqual(latest); // drawing never moves the sim
  });

  it('AC-5: unloading removes every body and collider; a level material can be chosen', () => {
    const { world, physics, loader, loaded } = physicsSetup({ levelMaterial: 'wood' });
    expect(readProperty(world as World<never>, loaded.pieces[0] ?? -1, 'material')).toBe('wood');
    loader.unload();
    expect(physics.count()).toBe(0);
    expect(world.query(PhysicsObjectComponent).ids()).toEqual([]);
  });

  it('draws movable props with the spawn object when the renderer has no body builder', () => {
    const { drawn, reads } = physicsSetup({ noBody: true });
    expect(drawn.has('loose-crate')).toBe(true);
    expect(reads.get('loose-crate')).toBe(readPhysicsObjectTransform);
  });
});

describe('scene loader breakables (mw-e03.11)', () => {
  interface Drawn {
    readonly label: string;
    readonly crack?: boolean;
    disposed: boolean;
  }

  function breakSetup(options: { physics?: boolean; pieces?: boolean } = {}) {
    const content = loadGameContent();
    const physics = new RapierPhysics(RAPIER);
    const world = registerSceneComponents(new World({ seed: 3, physics }));
    if (options.physics !== false) installGamePhysics(world);
    const sync = new RenderSync(world);
    const drawn = new Map<string, Drawn>();
    const reads = new Map<string, SceneTransformReader>();
    const make = (label: string, crack?: boolean): Drawn => {
      const object: Drawn =
        crack === undefined ? { label, disposed: false } : { label, crack, disposed: false };
      drawn.set(label, object);
      return object;
    };
    const loader = new SceneLoader({
      world,
      sync,
      colliders: physics,
      content,
      objects: {
        staticGeometry: (layout) => make(layout.id),
        spawn: (spawn) => make(spawn.id),
        ...(options.pieces !== false && {
          piece: (piece, parts, crack) =>
            make(`piece:${String(piece.placement)}:${String(parts.length)}`, crack),
        }),
      },
      binding: (object, read) => {
        reads.set(object.label, read);
        return {
          object,
          read,
          apply: () => undefined,
          dispose(target) {
            target.disposed = true;
          },
        };
      },
      ...(options.physics !== false && { physics: {} }),
    });
    const loaded = loader.load('weak-wall-room');
    const wall = loaded.pieces[6] ?? -1;
    return { world, sync, drawn, reads, loaded, wall };
  }

  it('makes the weak wall breakable and draws it on its own, cracked, in the world frame', () => {
    const { world, drawn, reads, loaded, wall } = breakSetup();
    const sim = world as World<never>;
    expect(sim.get(wall, BreakableComponent)).toMatchObject({
      profile: 'old-wall',
      reveals: 'weak-wall-passage',
      resistances: { blunt: 0.2, slash: 0.9, pierce: 1, force: 0.2 },
    });
    expect(readProperty(sim, wall, 'hp')).toBe(100);
    const crate = loaded.spawns.find((s) => s.spawn.id === 'loot-crate')?.entity ?? -1;
    expect(sim.get(crate, BreakableComponent)?.contents).toEqual(['plank']);
    expect(drawn.get('piece:6:1')).toEqual({ label: 'piece:6:1', crack: true, disposed: false });
    expect(reads.get('piece:6:1')).toBe(readWorldFrame);
    expect(readWorldFrame(world, wall)).toEqual({
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    });
  });

  it('a heavy blow takes the wall off the screen the frame the sim breaks it', () => {
    const { world, sync, drawn, wall } = breakSetup();
    const sim = world as World<never>;
    applyStimulus(sim, {
      shape: { kind: 'contact', target: wall },
      element: 'blunt',
      intensity: 150,
    });
    world.step();
    expect(world.isAlive(wall)).toBe(false);
    expect(readWorldFrame(world, wall)).toBeUndefined();
    sync.render(0);
    expect(drawn.get('piece:6:1')?.disposed).toBe(true);
  });

  it('without physics nothing is breakable, and without a piece builder breakable pieces are not drawn', () => {
    const bare = breakSetup({ physics: false });
    expect(bare.world.isRegistered(BreakableComponent)).toBe(false);
    expect(bare.drawn.get('piece:6:1')?.crack).toBe(true);
    const plain = breakSetup({ pieces: false });
    expect(plain.sync.has(plain.wall)).toBe(false);
    expect([...plain.drawn.keys()].some((label) => label.startsWith('piece:'))).toBe(false);
  });
});
