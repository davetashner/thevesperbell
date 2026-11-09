// mw-aps: crush and hazard damage now reach every creature with health and a hurtbox (AI creatures
// and training dummies), not only characters, so the kinetic and hazard systems test every awake
// physics object against every creature each tick. Worst case here: 200 awake objects tumbling over
// 100 creatures. The figure is what installEnvironmentDamage adds to a tick: the mean of timed
// World.step() calls with the rules installed minus the mean without, the same arena and kicks.
// Budget: ≤ 0.5 ms added per tick (a quarter of the 2 ms physics-object budget, mw-e03.10 AC-6).
// Run with `pnpm bench`.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, test } from 'vitest';
import {
  DEFAULT_ENVIRONMENT_DAMAGE_ID,
  loadGameContent,
  PLAYER_CONTROLLER_ID,
} from '@content/index';
import {
  addPhysicsObject,
  addProperties,
  DAMAGE_COMPONENTS,
  DamageModel,
  giveCombatant,
  giveHurtboxes,
  HurtboxComponent,
  installEnvironmentDamage,
  installPhysicsObjects,
  installStimuli,
  loadScene,
  placeEntity,
  PhysicsObjectComponent,
  RapierPhysics,
  registerSceneComponents,
  registerWorldProperties,
  World,
  type ColliderHandle,
  type EntityId,
} from '@sim/index';

const BODIES = 200;
const CREATURES = 100;
const BUDGET_MS = 0.5;
const KICK_EVERY = 30;
const WARMUP_TICKS = 300;
const TIMED_TICKS = 100 * KICK_EVERY;

function arena(withRules: boolean) {
  const content = loadGameContent();
  const physics = new RapierPhysics(RAPIER);
  const world = installStimuli(
    registerWorldProperties(registerSceneComponents(new World<never>({ seed: 1, physics }))),
  );
  installPhysicsObjects(world);
  world.register(HurtboxComponent, ...DAMAGE_COMPONENTS);
  const kit = (id: string) => (content.has('kit', id) ? content.get('kit', id) : undefined);
  loadScene(world, content.get('scene', 'testbed'), kit, physics);
  if (withRules) {
    installEnvironmentDamage(world, {
      damage: new DamageModel(),
      tuning: content.get('environment-damage', DEFAULT_ENVIRONMENT_DAMAGE_ID),
      capsule: content.get('controller', PLAYER_CONTROLLER_ID).capsule,
    });
  }
  const bodies: EntityId[] = Array.from({ length: BODIES }, (_, i) => {
    const entity = world.spawn();
    addProperties(world, entity, { material: 'wood', weight: 5 + (i % 7), impactAbsorb: 0.1 });
    addPhysicsObject(world, entity, {
      shape: { kind: 'sphere', radius: 0.2 },
      position: {
        x: -6 + (i % 10) * 1.3,
        y: 1 + Math.floor(i / 100) * 1.5,
        z: 17 + (Math.floor(i / 10) % 10) * 1.3,
      },
    });
    return entity;
  });
  // Creatures walk among the crates, with plenty of health so none dies mid-run.
  for (let i = 0; i < CREATURES; i++) {
    const entity = world.spawn();
    placeEntity(
      world,
      entity,
      { x: -6 + (i % 10) * 1.3, y: 0, z: 17.6 + Math.floor(i / 10) * 1.3 },
      0.4,
    );
    giveHurtboxes(world, entity, {
      boxes: [
        {
          id: 'torso',
          socket: 'root',
          region: 'torso',
          armored: false,
          multiplier: 1,
          shape: {
            kind: 'capsule',
            from: { x: 0, y: 0.3, z: 0 },
            to: { x: 0, y: 1.5, z: 0 },
            radius: 0.35,
          },
        },
      ],
    });
    giveCombatant(world, entity, { health: 1e9 });
  }
  return { world, physics, bodies };
}

/** Mean milliseconds of a timed World.step() over the fixed workload. */
function meanStep(withRules: boolean): number {
  const { world, physics, bodies } = arena(withRules);
  const handles = bodies.map(
    (entity) => world.get(entity, PhysicsObjectComponent)?.body as ColliderHandle,
  );
  const kick = (tick: number): void => {
    handles.forEach((handle, i) => {
      const angle = (i * 2.399963 + tick) % (2 * Math.PI);
      physics.applyImpulse(handle, { x: 8 * Math.cos(angle), y: 25, z: 8 * Math.sin(angle) });
    });
  };
  let total = 0;
  for (let i = 0; i < WARMUP_TICKS + TIMED_TICKS; i++) {
    if (world.tick % KICK_EVERY === 0) kick(world.tick);
    const start = performance.now();
    world.step();
    if (i >= WARMUP_TICKS) total += performance.now() - start;
  }
  return total / TIMED_TICKS;
}

describe('environment damage', () => {
  test('mw-aps: 200 awake objects over 100 creatures cost ≤ 0.5 ms per tick', () => {
    meanStep(true); // JIT warm-up
    const without = meanStep(false);
    const withRules = meanStep(true);
    const added = withRules - without;
    console.info(
      `environment damage ×${String(BODIES)} objects, ×${String(CREATURES)} creatures: ${without.toFixed(4)} ms without, ${withRules.toFixed(4)} ms with, +${added.toFixed(4)} ms per tick`,
    );
    expect(added).toBeLessThanOrEqual(BUDGET_MS);
  }, 120_000);
});
