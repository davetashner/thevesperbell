// Physics objects (mw-e03.10) on the real deterministic Rapier build: bodies from world properties,
// impacts, stacking and sleep, property changes, force stimuli, the awake-body budget and
// determinism.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { box } from '../character/greybox';
import type { EntityId } from '../core/component';
import { hypot } from '../math';
import { World } from '../core/world';
import {
  addProperties,
  registerWorldProperties,
  setProperty,
  type WorldPropertyInit,
} from '../properties/components';
import { hashWorld } from '../snapshot';
import { placeEntity, placementOf } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { applyStimulus, installStimuli, stimulusSystem } from '../stimulus/stimulus';
import type { BodyShape } from './bodies';
import {
  addPhysicsObject,
  bindCollider,
  bodyMaterialOf,
  DEFAULT_BODY_BUDGET,
  installPhysicsObjects,
  MAX_RESTITUTION,
  MIN_BODY_MASS,
  physicsBudgetExceeded,
  physicsImpact,
  PhysicsColliderComponent,
  PhysicsObjectComponent,
  removePhysicsObject,
  rigidBodiesOf,
  setPhysicsObjectVelocity,
  teleportPhysicsObject,
  type PhysicsBudgetExceeded,
  type PhysicsImpact,
  type PhysicsObject,
  type PhysicsObjectsOptions,
} from './objects';
import { RapierPhysics } from './rapier';
import { ColliderFanOut, InMemoryColliderSink, type ColliderHandle } from './static-colliders';

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const HALF = 0.25;
const CRATE: BodyShape = { kind: 'box', halfExtents: v(HALF, HALF, HALF) };
const WOOD: WorldPropertyInit = {
  material: 'wood',
  weight: 10,
  friction: 0.5,
  impactAbsorb: 0.1,
  pushable: true,
};
const STONE: WorldPropertyInit = { material: 'stone', friction: 0.6 };

interface Setup {
  readonly world: World<never>;
  readonly physics: RapierPhysics;
  readonly floor: EntityId;
  readonly floorCollider: ColliderHandle;
  readonly impacts: PhysicsImpact[];
  readonly warnings: PhysicsBudgetExceeded[];
}

/** A world with properties, stimuli and physics objects, and a stone floor whose top is at y = 0. */
function setup(options: PhysicsObjectsOptions = {}, bindFloor = true): Setup {
  const physics = new RapierPhysics(RAPIER);
  const world = installStimuli(registerWorldProperties(new World<never>({ seed: 3, physics })));
  world.addSystem(stimulusSystem());
  installPhysicsObjects(world, options);
  const floorCollider = physics.add(box(v(-40, -1, -40), v(40, 0, 40)));
  const floor = world.spawn();
  addProperties(world, floor, STONE);
  if (bindFloor) bindCollider(world, floor, floorCollider);
  const impacts: PhysicsImpact[] = [];
  const warnings: PhysicsBudgetExceeded[] = [];
  world.events.on(physicsImpact, (impact) => impacts.push(impact));
  world.events.on(physicsBudgetExceeded, (warning) => warnings.push(warning));
  return { world, physics, floor, floorCollider, impacts, warnings };
}

/** Spawns an entity with `init` properties and a body at `position`. */
function spawnObject(
  world: World<never>,
  position: Vec3,
  init: WorldPropertyInit = WOOD,
  shape: BodyShape = CRATE,
): EntityId {
  const entity = world.spawn();
  addProperties(world, entity, init);
  addPhysicsObject(world, entity, { shape, position });
  return entity;
}

const objectOf = (world: World<never>, entity: EntityId): PhysicsObject =>
  must(world.get(entity, PhysicsObjectComponent));

/** `value`, which the test knows is there. */
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}

const steps = (world: World<never>, n: number): void => {
  for (let i = 0; i < n; i++) world.step();
};

const distance = (a: Vec3, b: Vec3): number => hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe('physics objects (mw-e03.10)', () => {
  it('AC-1: a 10 kg crate dropped 2 m onto stone rests within 2 s after one impact of 196 J ± 5%', () => {
    const { world, physics, floor, impacts } = setup();
    const crate = spawnObject(world, v(0, 2 + HALF, 0));
    steps(world, 120); // 2 s at 60 Hz
    expect(impacts).toHaveLength(1);
    const [impact] = impacts as [PhysicsImpact];
    const expected = 10 * 9.81 * 2; // m g h = 196.2 J
    expect(Math.abs(impact.energy - expected) / expected).toBeLessThan(0.05);
    expect(impact).toMatchObject({ entity: crate, other: floor, materials: ['wood', 'stone'] });
    expect(impact.normal.y).toBeCloseTo(-1); // from the crate down into the floor
    expect(impact.impulse).toBeCloseTo(10 * impact.speed);
    expect(impact.position.y).toBeLessThan(0.5);
    const motion = physics.motionOf(objectOf(world, crate).body as ColliderHandle);
    expect(hypot(motion.linvel.x, motion.linvel.y, motion.linvel.z)).toBeLessThan(0.01);
    expect(objectOf(world, crate).sleeping).toBe(true);
    expect(objectOf(world, crate).position.y).toBeCloseTo(HALF, 2);
  });

  it('AC-2: a stack of 5 crates stays within 1 cm over 10 s and every body falls asleep', () => {
    const { world } = setup();
    const crates = [0, 1, 2, 3, 4].map((i) => spawnObject(world, v(0, HALF + 2 * HALF * i, 0)));
    const start = crates.map((c) => objectOf(world, c).position);
    let moved = 0;
    for (let tick = 0; tick < 600; tick++) {
      world.step();
      crates.forEach((c, i) => {
        moved = Math.max(moved, distance(objectOf(world, c).position, must(start[i])));
      });
    }
    expect(moved).toBeLessThan(0.01);
    expect(crates.map((c) => objectOf(world, c).sleeping)).toEqual([true, true, true, true, true]);
  });

  it('AC-3: a weight change committed during a tick is the body mass on the next tick', () => {
    const { world, physics } = setup();
    const cloth = spawnObject(world, v(0, HALF, 0), { material: 'cloth', weight: 2 });
    const body = objectOf(world, cloth).body as ColliderHandle;
    world.addSystem({
      name: 'soak',
      run: ({ tick }) => {
        if (tick === 5) setProperty(world, cloth, 'weight', 6); // soaked cloth is heavier
      },
    });
    steps(world, 6); // ticks 0–5: the change is committed during tick 5
    expect(physics.motionOf(body).mass).toBeCloseTo(2, 4);
    world.step(); // tick 6
    expect(physics.motionOf(body).mass).toBeCloseTo(6, 4);
  });

  it('AC-4: the same scene and inputs over 3,000 ticks give identical physics state hashes', () => {
    const run = (): string[] => {
      const { world } = setup();
      [0, 1, 2].forEach((i) => spawnObject(world, v(2, HALF + 2 * HALF * i, 0)));
      const thrown = world.spawn();
      addProperties(world, thrown, { ...WOOD, weight: 3 });
      addPhysicsObject(world, thrown, {
        shape: { kind: 'sphere', radius: 0.2 },
        position: v(-3, 1.5, 0.1),
        velocity: v(6, 1, 0),
      });
      const hashes: string[] = [];
      for (let tick = 0; tick < 3000; tick++) {
        if (tick === 900) {
          applyStimulus(world, {
            shape: { kind: 'sphere', center: v(2, 0.5, -1), radius: 3 },
            element: 'force',
            intensity: 40,
          });
        }
        world.step();
        if (tick % 500 === 499) hashes.push(hashWorld(world));
      }
      return hashes;
    };
    const first = run();
    expect(new Set(first).size).toBeGreaterThan(1);
    expect(run()).toEqual(first);
  });

  it('AC-4: a run restored from a snapshot mid-way ends with the same hash as one never stopped', () => {
    const build = () => {
      const s = setup();
      [0, 1].forEach((i) => spawnObject(s.world, v(0, 3 + i, 0)));
      return s;
    };
    const straight = build();
    steps(straight.world, 400);
    const stopped = build();
    steps(stopped.world, 150);
    const snapshot = stopped.world.snapshot();
    const resumed = build(); // same setup code; its state is then replaced by the snapshot
    resumed.world.restore(snapshot);
    steps(resumed.world, 250);
    expect(hashWorld(resumed.world)).toBe(hashWorld(straight.world));
    expect(stopped.impacts.length).toBeGreaterThan(0); // the snapshot came after contacts started
  });

  it('AC-5: over budget, the oldest distant resting bodies are forced to sleep with a warning', () => {
    const focus = v(0, 0, 0);
    const { world, physics, warnings } = setup({ focus: () => focus });
    const near = spawnObject(world, v(1, HALF, 0)); // oldest, but near the focus
    world.step();
    const at = (i: number) => v(-15 + (i % 20) * 1.5, HALF, -20 + Math.floor(i / 20) * 1.5);
    const others = Array.from({ length: DEFAULT_BODY_BUDGET - 1 }, (_, i) =>
      spawnObject(world, at(i)),
    );
    world.step();
    expect(warnings).toEqual([]); // exactly at budget
    const newcomer = spawnObject(world, v(3, 3, 3)); // a new body wakes: 301 awake
    world.step();
    const farthest = must(
      [...others].sort(
        (a, b) =>
          distance(objectOf(world, b).position, focus) -
          distance(objectOf(world, a).position, focus),
      )[0],
    );
    expect(warnings).toEqual([
      { tick: 2, active: DEFAULT_BODY_BUDGET + 1, budget: DEFAULT_BODY_BUDGET, slept: [farthest] },
    ]);
    expect(objectOf(world, farthest).sleeping).toBe(true);
    expect(physics.motionOf(objectOf(world, farthest).body as ColliderHandle).sleeping).toBe(true);
    expect(objectOf(world, near).sleeping).toBe(false);
    expect(objectOf(world, newcomer).sleeping).toBe(false);
  });

  it('AC-5: when nothing is resting and distant, it warns once a second and sleeps nothing', () => {
    const { world, warnings } = setup({ budget: 1, focus: () => v(0, 0, 0) });
    spawnObject(world, v(0, 40, 0)); // both fall for over a second: never resting
    spawnObject(world, v(20, 40, 0));
    steps(world, 61);
    expect(warnings.map((w) => [w.tick, w.slept])).toEqual([
      [0, []],
      [60, []],
    ]);
  });

  it('AC-5: without a focus every resting body is distant; ties go to the lower entity id', () => {
    const { world, warnings } = setup({ budget: 1 });
    const a = spawnObject(world, v(0, HALF, 0));
    spawnObject(world, v(2, HALF, 0));
    steps(world, 2);
    expect(warnings.at(-1)?.slept).toEqual([a]);
    expect(objectOf(world, a).sleeping).toBe(true);
  });

  it('wakes a sleeping body when a force stimulus pushes it, and keeps its placement in step', () => {
    const { world, impacts } = setup();
    const crate = spawnObject(world, v(0, HALF, 0));
    const wall = world.spawn(); // pushable but not a physics object: the impulse goes nowhere
    addProperties(world, wall, { pushable: true, weight: 50 });
    placeEntity(world, wall, v(-2, 1, 0), 1);
    steps(world, 240);
    const asleep = objectOf(world, crate);
    expect(asleep.sleeping).toBe(true);
    applyStimulus(world, {
      shape: { kind: 'sphere', center: v(-1, HALF, 0), radius: 3 },
      element: 'force',
      intensity: 60,
    });
    steps(world, 2);
    const moving = objectOf(world, crate);
    expect(moving.sleeping).toBe(false);
    expect(moving.awakeSince).toBe(240); // the stimulus resolved and woke it during tick 240
    expect(moving.position.x).toBeGreaterThan(asleep.position.x);
    expect(placementOf(world, crate)).toMatchObject({ ...moving.position });
    expect(placementOf(world, crate)?.radius).toBeCloseTo(hypot(HALF, HALF, HALF));
    expect(impacts).toEqual([]); // sliding along the floor starts no new contact
  });

  it('reports impacts between two objects with the reduced mass, and against unbound geometry', () => {
    const { world, impacts } = setup({}, false);
    const bottom = spawnObject(world, v(0, HALF, 0));
    const top = spawnObject(world, v(0, 2.5, 0), { material: 'iron', weight: 30 });
    spawnObject(world, v(5, 2, 0));
    steps(world, 90);
    const between = impacts.find((i) => i.other === bottom || i.entity === bottom);
    expect(between).toBeDefined();
    const hit = must(between);
    const reduced = (10 * 30) / (10 + 30);
    expect(hit.impulse).toBeCloseTo(reduced * hit.speed);
    expect(new Set([hit.entity, hit.other])).toEqual(new Set([bottom, top]));
    expect([...hit.materials].sort()).toEqual(['iron', 'wood']);
    const ground = impacts.find((i) => i.other === null);
    expect(ground?.materials[1]).toBe('generic');
  });

  it('ignores contacts of bodies added straight to the port, which are no physics objects', () => {
    const { physics, world, impacts } = setup();
    physics.addBody({ shape: CRATE, position: v(0, 2, 0), mass: 1, friction: 0.5, restitution: 0 });
    steps(world, 60);
    expect(impacts).toEqual([]);
  });

  it('measures a moving platform as a kinematic side of an impact', () => {
    const { world, physics, impacts } = setup();
    physics.add({ ...box(v(-1, 0, -1), v(1, 0.2, 1)), velocity: v(0, 2, 0) });
    spawnObject(world, v(0, 2, 0));
    steps(world, 30);
    expect(impacts.some((i) => i.other === null && i.speed > 2)).toBe(true);
  });

  it('keeps bodies and bound colliders in step with friction, bounciness and weight changes', () => {
    const { world, physics, floor, floorCollider } = setup();
    const crate = spawnObject(world, v(0, HALF, 0));
    const lighter = world.spawn(); // has weight but no body: ignored
    addProperties(world, lighter, { weight: 4, temperature: 20 });
    const body = objectOf(world, crate).body as ColliderHandle;
    const frictionOf = (handle: ColliderHandle) => {
      const rows = (physics.snapshot().data as { colliders: number[][] }).colliders;
      const row = rows.find(([h]) => h === handle) ?? [];
      return physics.rapierWorld.getCollider(row[1] ?? -1).friction();
    };
    world.addSystem({
      name: 'change',
      run: ({ tick }) => {
        if (tick !== 0) return;
        setProperty(world, crate, 'friction', 0.1);
        setProperty(world, crate, 'impactAbsorb', 1);
        setProperty(world, floor, 'friction', 0.05); // the floor freezes over
        setProperty(world, lighter, 'weight', 5);
        setProperty(world, lighter, 'temperature', 30);
      },
    });
    addProperties(world, floor, { weight: 100 });
    world.step();
    setProperty(world, floor, 'weight', 200); // a bound collider has no mass to change
    world.step();
    expect(frictionOf(body)).toBeCloseTo(0.1);
    expect(frictionOf(floorCollider)).toBeCloseTo(0.05);
    expect(bodyMaterialOf(world, crate)).toEqual({ friction: 0.1, restitution: 0 });
    expect(bodyMaterialOf(world, lighter).restitution).toBe(MAX_RESTITUTION);
  });

  it('gives a weightless object the minimum mass and accepts rotation and capsule shapes', () => {
    const { world, physics } = setup();
    const feather = spawnObject(
      world,
      v(0, 1, 0),
      { weight: 0 },
      { kind: 'capsule', halfHeight: 0.3, radius: 0.1 },
    );
    const turned = world.spawn();
    addProperties(world, turned, WOOD);
    const s = Math.SQRT1_2;
    addPhysicsObject(world, turned, {
      shape: CRATE,
      position: v(3, 1, 0),
      rotation: { x: 0, y: s, z: 0, w: s },
    });
    expect(physics.motionOf(objectOf(world, feather).body as ColliderHandle).mass).toBeCloseTo(
      MIN_BODY_MASS,
    );
    expect(objectOf(world, turned).rotation).toEqual({ x: 0, y: s, z: 0, w: s });
    expect(placementOf(world, feather)?.radius).toBeCloseTo(0.4);
  });

  it('removes a physics object from the physics world', () => {
    const { world, physics } = setup();
    const crate = spawnObject(world, v(0, 1, 0));
    const colliders = physics.count();
    removePhysicsObject(world, crate);
    expect(physics.count()).toBe(colliders - 1);
    expect(world.has(crate, PhysicsObjectComponent)).toBe(false);
    expect(() => {
      removePhysicsObject(world, crate);
    }).toThrow(`entity ${String(crate)} is not a physics object`);
    world.step();
  });

  it('refuses a second body for one entity, and worlds without rigid-body physics', () => {
    const { world } = setup();
    const crate = spawnObject(world, v(0, 1, 0));
    expect(() => {
      spawnAgain(world, crate);
    }).toThrow(`entity ${String(crate)} already is a physics object`);
    const bare = new World<never>({ seed: 1 });
    expect(() => rigidBodiesOf(bare)).toThrow('this world has no rigid-body physics');
    expect(() => installPhysicsObjects(bare)).toThrow('this world has no rigid-body physics');
  });
});

describe('destroying a physics object (mw-e03.41)', () => {
  /** Drops a crate, lets it fall for a while, gets rid of it with `discard`, then runs on. */
  function run(discard: (world: World<never>, crate: EntityId) => void, midStep = false): string {
    const { world, physics } = setup();
    const crate = spawnObject(world, v(0, 2, 0));
    spawnObject(world, v(1, 1, 0)); // a neighbour that stays
    const colliders = physics.count();
    steps(world, 20);
    if (midStep) {
      world.addSystem({
        name: 'discard',
        run: ({ tick }) => {
          if (tick === 20) discard(world, crate);
        },
      });
    } else {
      discard(world, crate);
    }
    steps(world, midStep ? 1 : 0);
    expect(physics.count()).toBe(colliders - 1);
    expect(world.isAlive(crate)).toBe(false);
    steps(world, 40);
    return hashWorld(world);
  }

  it('AC-1: destroying the entity takes its body out of the physics world, between or during steps', () => {
    const destroy = (world: World<never>, crate: EntityId): void => {
      world.destroy(crate);
    };
    const { world, physics } = setup();
    const crate = spawnObject(world, v(0, 1, 0));
    const colliders = physics.count();
    world.destroy(crate);
    expect(physics.count()).toBe(colliders - 1);
    world.step(); // the physics world steps without the removed body
    expect(run(destroy)).not.toBe('');
    expect(run(destroy, true)).not.toBe('');
  });

  it('AC-2: the state hash is deterministic and matches removing the body by hand first', () => {
    const destroy = (world: World<never>, crate: EntityId): void => {
      world.destroy(crate);
    };
    const removeThenDestroy = (world: World<never>, crate: EntityId): void => {
      removePhysicsObject(world, crate);
      world.destroy(crate);
    };
    expect(run(destroy)).toBe(run(destroy));
    expect(run(destroy)).toBe(run(removeThenDestroy));
    expect(run(destroy, true)).toBe(run(removeThenDestroy, true));
  });
});

describe('bound colliders', () => {
  it('an entity owns several colliders: impacts name it on each, and friction reaches them all', () => {
    const { world, physics, impacts } = setup({}, false);
    const pillar = world.spawn();
    addProperties(world, pillar, STONE);
    const left = physics.add(box(v(-3, 0, -1), v(-1, 1, 1)));
    const right = physics.add(box(v(1, 0, -1), v(3, 1, 1)));
    bindCollider(world, pillar, left);
    bindCollider(world, pillar, right);
    expect(world.get(pillar, PhysicsColliderComponent)).toEqual({ colliders: [left, right] });
    spawnObject(world, v(-2, 3, 0));
    spawnObject(world, v(2, 3, 0));
    steps(world, 90);
    expect(impacts.filter((i) => i.other === pillar)).toHaveLength(2);
    setProperty(world, pillar, 'friction', 0.05);
    world.step(); // the change event reaches the colliders
    const frictions = [left, right].map((handle) => {
      const rows = (physics.snapshot().data as { colliders: number[][] }).colliders;
      const row = rows.find(([h]) => h === handle) ?? [];
      return physics.rapierWorld.getCollider(row[1] ?? -1).friction();
    });
    expect(frictions.map((f) => Math.round(f * 100) / 100)).toEqual([0.05, 0.05]);
    world.destroy(pillar); // the pillar owns its colliders: they go with it (mw-e03.42)
    expect(physics.count()).toBe(3);
    expect([physics.has(left), physics.has(right)]).toEqual([false, false]);
  });
});

describe('bound colliders go with their entity (mw-e03.42)', () => {
  it('AC-1: destroying the owner during a step removes its colliders at the end of that tick', () => {
    const { world, physics, floor, floorCollider } = setup();
    world.addSystem({
      name: 'burn',
      run: ({ world: w }) => {
        w.destroy(floor);
      },
    });
    world.step();
    expect(physics.has(floorCollider)).toBe(false);
    expect(physics.count()).toBe(0);
  });

  it('removing the component removes them; a collider already gone is skipped', () => {
    const { world, physics, floor, floorCollider } = setup();
    const extra = physics.add(box(v(5, 0, 5), v(6, 1, 6)));
    bindCollider(world, floor, extra);
    physics.remove(floorCollider); // taken out by someone else first
    expect(() => {
      world.remove(floor, PhysicsColliderComponent);
    }).not.toThrow();
    expect(physics.count()).toBe(0);
  });

  it('removes them from the given level collider sink (physics and light together)', () => {
    const physics = new RapierPhysics(RAPIER);
    const light = new InMemoryColliderSink();
    const level = new ColliderFanOut(physics, light);
    const world = registerWorldProperties(new World<never>({ seed: 3, physics }));
    installPhysicsObjects(world, { levelColliders: level });
    const wall = world.spawn();
    addProperties(world, wall, STONE);
    bindCollider(world, wall, level.add(box(v(0, 0, 0), v(1, 2, 1))));
    world.destroy(wall);
    expect([physics.count(), light.count(), level.count()]).toEqual([0, 0, 0]);
  });
});

describe('launching a physics object (mw-e02.17)', () => {
  it('gives the body exactly the velocity asked for, whatever its mass or current motion', () => {
    const { world, physics } = setup();
    const crate = spawnObject(world, v(0, 3, 0));
    world.step();
    setPhysicsObjectVelocity(world, crate, v(3, 4, 12));
    const { linvel } = physics.motionOf(objectOf(world, crate).body as ColliderHandle);
    expect(linvel.x).toBeCloseTo(3, 4);
    expect(linvel.y).toBeCloseTo(4, 4);
    expect(linvel.z).toBeCloseTo(12, 4);
    expect(() => {
      setPhysicsObjectVelocity(world, world.spawn(), v(1, 0, 0));
    }).toThrow(Error);
  });
});

describe('teleporting a physics object (mw-e33.17)', () => {
  it('moves the body, stops and wakes it, and its pose and placement follow at once', () => {
    const { world, physics } = setup();
    const crate = spawnObject(world, v(0, 3, 0));
    steps(world, 120);
    const rested = objectOf(world, crate);
    const to = v(4, 2, -1);
    teleportPhysicsObject(world, crate, to);
    const moved = objectOf(world, crate);
    expect(moved).toMatchObject({ position: to, sleeping: false, rotation: rested.rotation });
    expect(moved.awakeSince).toBe(rested.sleeping ? world.tick : rested.awakeSince);
    expect(placementOf(world, crate)).toMatchObject(to);
    expect(physics.motionOf(moved.body as ColliderHandle)).toMatchObject({
      position: to,
      linvel: v(0, 0, 0),
      angvel: v(0, 0, 0),
      sleeping: false,
    });
  });

  it('a sleeping body wakes with a fresh awake-since tick', () => {
    const { world, physics } = setup();
    const crate = spawnObject(world, v(0, HALF, 0));
    world.step();
    physics.sleep(objectOf(world, crate).body as ColliderHandle);
    world.set(crate, PhysicsObjectComponent, { ...objectOf(world, crate), sleeping: true });
    steps(world, 3);
    teleportPhysicsObject(world, crate, v(1, 1, 1));
    expect(objectOf(world, crate)).toMatchObject({ sleeping: false, awakeSince: world.tick });
  });

  it('turns the body to a given rotation (mw-e27.3: a saved pose)', () => {
    const { world, physics } = setup();
    const crate = spawnObject(world, v(0, HALF, 0));
    const rotation = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };
    teleportPhysicsObject(world, crate, v(2, HALF, 0), rotation);
    expect(objectOf(world, crate)).toMatchObject({ position: v(2, HALF, 0), rotation });
    expect(physics.poseOf(objectOf(world, crate).body as ColliderHandle).rotation.y).toBeCloseTo(
      Math.SQRT1_2,
      6,
    );
  });

  it('refuses an entity that is not a physics object, and a non-finite position', () => {
    const { world, floor } = setup();
    expect(() => {
      teleportPhysicsObject(world, floor, v(0, 0, 0));
    }).toThrow(/not a physics object/);
    const crate = spawnObject(world, v(0, 3, 0));
    expect(() => {
      teleportPhysicsObject(world, crate, v(0, NaN, 0));
    }).toThrow(RangeError);
  });
});

function spawnAgain(world: World<never>, entity: EntityId): void {
  addPhysicsObject(world, entity, { shape: CRATE, position: v(0, 3, 0) });
}
