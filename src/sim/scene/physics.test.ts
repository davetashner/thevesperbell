// A loaded scene's physics (mw-e03.39) on the real deterministic Rapier build: movable props become
// physics objects standing on their spawns, level colliders belong to stone piece entities, and
// unloading leaves no body behind.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { at } from '../geom/vec';
import {
  installPhysicsObjects,
  physicsImpact,
  PhysicsColliderComponent,
  PhysicsObjectComponent,
  type PhysicsImpact,
} from '../physics/objects';
import { RapierPhysics } from '../physics/rapier';
import type { ColliderHandle } from '../physics/static-colliders';
import { hasProperty, readProperty, registerWorldProperties } from '../properties/components';
import { climbabilityOfCollider } from '../climb/surfaces';
import type { MaterialPresets } from '../properties/materials';
import { hashWorld } from '../snapshot';
import { PlacementComponent } from '../stimulus/placement';
import { RecoveryAnchorComponent } from '../carry/recovery';
import { TEST_SCENE, testKit } from './fixtures';
import { loadScene, registerSceneComponents, unloadScene, type LoadedScene } from './loader';
import type { SceneSpec } from './layout';
import {
  addScenePhysics,
  DEFAULT_LEVEL_MATERIAL,
  placementProperties,
  type PropBody,
} from './physics';

const MATERIALS: MaterialPresets = new Map([
  ['stone', { friction: 0.6 }],
  ['wood', { friction: 0.5, impactAbsorb: 0.1, flammable: true }],
  ['iron', { friction: 0.4 }],
]);

const CRATE: PropBody = { size: { x: 0.6, y: 0.6, z: 0.6 }, material: 'wood', weight: 12 };

interface Setup {
  readonly world: World<never>;
  readonly physics: RapierPhysics;
  readonly loaded: LoadedScene;
  readonly impacts: PhysicsImpact[];
}

function setup(props: (id: string) => PropBody | undefined = () => CRATE, level?: string): Setup {
  const physics = new RapierPhysics(RAPIER);
  const world = registerWorldProperties(
    registerSceneComponents(new World<never>({ seed: 5, physics })),
  );
  world.register(PlacementComponent);
  installPhysicsObjects(world);
  const loaded = loadScene(world, TEST_SCENE, testKit, physics);
  addScenePhysics(world, loaded, {
    props,
    materials: MATERIALS,
    ...(level !== undefined && { levelMaterial: level }),
  });
  const impacts: PhysicsImpact[] = [];
  world.events.on(physicsImpact, (impact) => impacts.push(impact));
  return { world, physics, loaded, impacts };
}

const crateOf = ({ loaded }: Setup) => {
  const found = loaded.spawns.find((s) => s.spawn.prop === 'crate');
  if (found === undefined) throw new Error('the test scene has a crate');
  return found.entity;
};

const steps = (world: World<never>, n: number): void => {
  for (let i = 0; i < n; i++) world.step();
};

describe('scene physics (mw-e03.39)', () => {
  it('AC-1: a prop with a body becomes a physics object standing on its spawn, from its material', () => {
    const s = setup();
    const { world, loaded } = s;
    const crate = crateOf(s);
    const object = world.get(crate, PhysicsObjectComponent);
    const spawn = loaded.spawns.find((x) => x.entity === crate)?.spawn;
    expect(object?.position).toEqual({ x: spawn?.position.x, y: 0.3, z: spawn?.position.z });
    expect(object?.rotation).toEqual(spawn?.rotation);
    expect(object?.shape).toEqual({ kind: 'box', halfExtents: { x: 0.3, y: 0.3, z: 0.3 } });
    expect(readProperty(world, crate, 'weight')).toBe(12);
    expect(readProperty(world, crate, 'material')).toBe('wood');
    expect(readProperty(world, crate, 'friction')).toBe(0.5);
    // Markers and props without a body stay ordinary scene entities.
    const marker = loaded.spawns.find((x) => x.spawn.prop === undefined)?.entity ?? 0;
    expect(world.has(marker, PhysicsObjectComponent)).toBe(false);
    steps(world, 60);
    const rested = world.get(crate, PhysicsObjectComponent);
    expect(rested?.position.y).toBeCloseTo(0.3, 2); // on the floor, whose top is at y = 0
  });

  it('AC-1: a prop body may override its material’s flammability; unmovable props stay put', () => {
    const damp = setup(() => ({ ...CRATE, flammable: false }));
    expect(readProperty(damp.world, crateOf(damp), 'flammable')).toBe(false);
    const fixed = setup(() => undefined);
    expect(fixed.world.has(crateOf(fixed), PhysicsObjectComponent)).toBe(false);
  });

  it('AC-2: every solid piece is a stone entity owning its colliders; impacts name it', () => {
    const s = setup((id) => (id === 'crate' ? { ...CRATE, weight: 20 } : undefined));
    const { world, loaded, physics } = s;
    const [floor, doorway, ramp, decal] = loaded.pieces as [number, number, number, number];
    expect(world.get(floor, PhysicsColliderComponent)?.colliders).toEqual([loaded.colliders[0]]);
    expect(world.get(doorway, PhysicsColliderComponent)?.colliders).toEqual(
      loaded.colliders.slice(1, 4),
    );
    expect(world.get(ramp, PhysicsColliderComponent)?.colliders).toEqual([loaded.colliders[4]]);
    expect(world.has(decal, PhysicsColliderComponent)).toBe(false); // no solid part
    expect(readProperty(world, floor, 'material')).toBe(DEFAULT_LEVEL_MATERIAL);
    // Toss the crate up (5 m/s): landing, the impact names the floor entity and its material.
    const crate = crateOf(s);
    const body = world.get(crate, PhysicsObjectComponent)?.body as ColliderHandle;
    physics.applyImpulse(body, { x: 0, y: 100, z: 0 });
    steps(world, 90);
    expect(s.impacts[0]).toMatchObject({
      entity: crate,
      other: floor,
      materials: ['wood', 'stone'],
    });
  });

  it('binds only the colliders a loaded scene still lists', () => {
    const physics = new RapierPhysics(RAPIER);
    const world = registerWorldProperties(
      registerSceneComponents(new World<never>({ seed: 5, physics })),
    );
    world.register(PlacementComponent);
    installPhysicsObjects(world);
    const loaded = loadScene(world, TEST_SCENE, testKit, physics);
    const partial = { ...loaded, colliders: loaded.colliders.slice(0, 2) };
    const { solids } = addScenePhysics(world, partial, {
      props: () => undefined,
      materials: MATERIALS,
    });
    expect(solids).toEqual(loaded.pieces.slice(0, 2)); // the floor and the doorway's first post
    expect(world.get(loaded.pieces[1] ?? 0, PhysicsColliderComponent)?.colliders).toEqual([
      loaded.colliders[1],
    ]);
  });

  it('AC-2: the level material can be another preset', () => {
    const { world, loaded } = setup(undefined, 'iron');
    expect(readProperty(world, loaded.pieces[0] ?? 0, 'material')).toBe('iron');
  });

  it('AC-5: unloading leaves no body behind, and loading is deterministic', () => {
    const a = setup();
    const b = setup();
    steps(a.world, 30);
    steps(b.world, 30);
    expect(hashWorld(a.world)).toBe(hashWorld(b.world));
    unloadScene(a.world, a.loaded, a.physics);
    expect(a.physics.count()).toBe(0);
    a.world.step();
    expect(a.world.query(PhysicsObjectComponent).ids()).toEqual([]);
  });
});

describe('scene placement properties (mw-e03.22)', () => {
  it('a placement’s properties override the level material; a non-solid piece gets only its own', () => {
    const physics = new RapierPhysics(RAPIER);
    const world = registerWorldProperties(
      registerSceneComponents(new World<never>({ seed: 5, physics })),
    );
    world.register(PlacementComponent);
    installPhysicsObjects(world);
    const [floor, doorway, ramp, decal] = TEST_SCENE.placements;
    const scene = {
      ...TEST_SCENE,
      placements: [
        floor,
        { ...doorway, properties: { climbable: 'ivy', material: { id: 'wood' } } },
        { ...ramp, properties: { climbable: undefined } },
        { ...decal, properties: { climbable: 'ladder' } },
      ],
    } as SceneSpec;
    const loaded = loadScene(world, scene, testKit, physics);
    addScenePhysics(world, loaded, { props: () => undefined, materials: MATERIALS });
    const floorEntity = at(loaded.pieces, 0);
    const doorwayEntity = at(loaded.pieces, 1);
    const rampEntity = at(loaded.pieces, 2);
    const decalEntity = at(loaded.pieces, 3);
    expect(readProperty(world, floorEntity, 'material')).toBe('stone');
    expect(readProperty(world, doorwayEntity, 'material')).toBe('wood');
    expect(readProperty(world, doorwayEntity, 'climbable')).toBe('ivy');
    expect(readProperty(world, doorwayEntity, 'flammable')).toBe(true);
    expect(readProperty(world, rampEntity, 'material')).toBe('stone');
    expect(hasProperty(world, decalEntity, 'material')).toBe(false);
    expect(readProperty(world, decalEntity, 'climbable')).toBe('ladder');
    // A collision query's collider names its piece, and so its climbing grade.
    const doorwayCollider = world.get(doorwayEntity, PhysicsColliderComponent)?.colliders[0];
    expect(doorwayCollider).toBeDefined();
    expect(climbabilityOfCollider(world, doorwayCollider ?? -1)).toBe('ivy');
  });

  it('a piece without solid parts and without properties gets none', () => {
    const physics = new RapierPhysics(RAPIER);
    const world = registerWorldProperties(
      registerSceneComponents(new World<never>({ seed: 5, physics })),
    );
    world.register(PlacementComponent);
    installPhysicsObjects(world);
    const loaded = loadScene(world, TEST_SCENE, testKit, physics);
    addScenePhysics(world, loaded, { props: () => undefined, materials: MATERIALS });
    expect(hasProperty(world, at(loaded.pieces, 3), 'material')).toBe(false);
    expect(placementProperties(undefined)).toEqual({});
  });

  it('mw-e17.14: a prop spawn with a recovery anchor gets it, in metres, and one without gets none', () => {
    const physics = new RapierPhysics(RAPIER);
    const world = registerWorldProperties(
      registerSceneComponents(new World<never>({ seed: 5, physics })),
    );
    world.register(PlacementComponent);
    installPhysicsObjects(world);
    const scene: SceneSpec = {
      ...TEST_SCENE,
      grid: 2,
      spawns: [
        {
          id: 'statue',
          at: [1, 0, 2],
          yaw: 0,
          prop: { id: 'crate' },
          tags: [],
          recovery: [3, 0, 1],
        },
        { id: 'plain', at: [2, 0, 2], yaw: 0, prop: { id: 'crate' }, tags: [] },
      ],
    };
    const loaded = loadScene(world, scene, testKit, physics);
    addScenePhysics(world, loaded, { props: () => CRATE, materials: MATERIALS });
    const [statue, plain] = loaded.spawns.map((s) => s.entity);
    expect(world.get(statue ?? -1, RecoveryAnchorComponent)).toEqual({ at: { x: 6, y: 0, z: 2 } });
    expect(world.has(plain ?? -1, RecoveryAnchorComponent)).toBe(false);
  });
});
