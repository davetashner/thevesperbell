// mw-e10.9 AC-3: a climber whose stamina runs out falls, takes fall damage by the shipped curve and
// makes a landing noise. The real player (installPlayer on the shipped controller profile, with
// combat for its stamina pool), a 10 m ladder, the shipped environmental damage rules and the shipped
// footstep noise tuning, on the sim's fake collision world. The climber is let go at 4 m and at 6 m:
// the damage is the curve's share of max health at the height it actually fell (0 up to the 4 m safe
// drop, then rising), and the landing is one noise from the stealth table's landing curve.
import { describe, expect, it } from 'vitest';
import {
  controllerTuningFor,
  DEFAULT_ENVIRONMENT_DAMAGE_ID,
  loadGameContent,
  PLAYER_CONTROLLER_ID,
  STEALTH_ID,
} from '@content/index';
import { markExercised } from '@content/testing';
import {
  actionButton,
  actionFrame,
  actionVector,
  addProperties,
  CharacterController,
  CharacterImpacted,
  DAMAGE_COMPONENTS,
  DamageApplied,
  DamageModel,
  FakeCollisionWorld,
  fallDamageFraction,
  giveCombatant,
  healthOf,
  HIT_VOLUME_COMPONENTS,
  IDLE_ACTION_FRAME,
  installFootstepNoise,
  installPlayer,
  landingDb,
  LANDING_NOISE,
  loadScene,
  noiseEmitted,
  resolveFall,
  PhysicsColliderComponent,
  PlacementComponent,
  registerSceneComponents,
  registerWorldProperties,
  sceneLedges,
  StaminaComponent,
  staminaOf,
  World,
  type ActionFrame,
  type CharacterImpactInfo,
  type DamageResult,
  type NoiseEvent,
} from '@sim/index';
import { InMemoryColliderSink } from '@sim/physics/static-colliders';
import { testKit } from '@sim/scene/fixtures';

const nth = <T>(items: readonly T[], index: number): T => {
  const item = items[index];
  if (item === undefined) throw new Error(`no item ${String(index)}`);
  return item;
};
const content = loadGameContent();
const profile = content.get('controller', PLAYER_CONTROLLER_ID);
const rules = content.get('environment-damage', DEFAULT_ENVIRONMENT_DAMAGE_ID);
const footsteps = content.get('stealth', STEALTH_ID).noise.footsteps;
const HEALTH = 90;
const LADDER_HEIGHT = 10;

const FORWARD: ActionFrame = actionFrame({
  move: actionVector(0, 1),
  look: actionVector(0, 0),
  buttons: () => actionButton(false, false, false),
});

/** A thief-sized pool climbing a ladder, let go (stamina emptied) once its feet pass `height`. */
function slip(height: number) {
  const world = registerWorldProperties(
    registerSceneComponents(new World<ActionFrame>({ seed: 5 })),
  ).register(PhysicsColliderComponent, PlacementComponent, ...HIT_VOLUME_COMPONENTS);
  world.register(...DAMAGE_COMPONENTS);
  const scene = {
    id: 'ladder-room',
    grid: 1,
    placements: [
      { piece: { id: 'floor' }, at: [0, 0, 0], yaw: 0, scale: [5, 1, 5] },
      // The floor piece stretched up into a 2 × 2 m tower with a ladder's grade.
      {
        piece: { id: 'floor' },
        at: [0, LADDER_HEIGHT, 0],
        yaw: 0,
        scale: [1, LADDER_HEIGHT / 0.2, 1],
      },
    ],
    spawns: [{ id: 'player-start', at: [0, 0, -2], yaw: 0, tags: ['player-start'] }],
  } as const;
  const loaded = loadScene(world, scene, testKit, new InMemoryColliderSink());
  let next = 0;
  for (const part of loaded.layout.parts) {
    if (part.collider === undefined) continue;
    const handle = nth(loaded.colliders, next++);
    world.add(nth(loaded.pieces, part.placement), PhysicsColliderComponent, {
      colliders: [handle],
    });
  }
  addProperties(world, nth(loaded.pieces, 1), { climbable: 'ladder' });
  const collision = new FakeCollisionWorld(
    loaded.layout.parts.flatMap((part) => part.collider ?? []),
  );
  const player = installPlayer(world, {
    spawns: loaded.layout.spawns,
    collision,
    tuning: controllerTuningFor(profile),
    ledges: { index: sceneLedges(loaded) },
    climb: {},
    combat: { moves: new Map() },
  });
  const damage = new DamageModel();
  // The shipped fall rule, as installEnvironmentDamage wires it to every landing (its kinetic and
  // hazard systems need rigid-body physics this room does not have).
  world.events.on(CharacterImpacted, (impact) => {
    resolveFall(world, impact, { damage, fall: rules.fall, surface: () => null });
  });
  giveCombatant(world, player, { health: HEALTH });
  installFootstepNoise(world, { tuning: footsteps });
  const impacts: CharacterImpactInfo[] = [];
  const hits: DamageResult[] = [];
  const noises: NoiseEvent[] = [];
  world.events.on(CharacterImpacted, (impact) => impacts.push(impact));
  world.events.on(DamageApplied, (result) => hits.push(result));
  world.events.on(noiseEmitted, (noise) => noises.push(noise));
  const state = () => world.get(player, CharacterController);
  world.step([IDLE_ACTION_FRAME]);
  let ticks = 0;
  while (state()?.traversal !== 'climb' && ticks++ < 120) world.step([FORWARD]);
  while ((state()?.position.y ?? 0) < height && ticks++ < 1200) world.step([FORWARD]);
  const climbing = state()?.traversal === 'climb';
  const pool = staminaOf(world, player);
  if (pool === undefined) throw new Error('no stamina pool');
  world.set(player, StaminaComponent, { ...pool, current: 0 });
  impacts.length = 0;
  noises.length = 0;
  for (let i = 0; i < 400 && impacts.length === 0; i++) world.step([IDLE_ACTION_FRAME]);
  world.events.flush();
  return { world, player, climbing, impacts, hits, noises, state };
}

describe('falling off a climb (mw-e10.9)', () => {
  it.each([4, 6])(
    'AC-3: out of stamina %d m up, the player falls, takes fall damage by the curve and makes a landing noise',
    (height) => {
      const { world, player, climbing, impacts, hits, noises, state } = slip(height);
      expect(climbing).toBe(true);
      expect(impacts).toHaveLength(1);
      const [impact] = impacts;
      if (impact === undefined) throw new Error('no landing');
      expect(impact.kind).toBe('ground');
      // It dropped from about where its grip gave: height metres (plus the hands' reach on the wall).
      expect(impact.height).toBeGreaterThan(height - 0.5);
      expect(impact.height).toBeLessThan(height + 0.5);
      expect(state()).toMatchObject({ traversal: null, grounded: true });
      // Damage is the curve's share of max health, to the point.
      const share = fallDamageFraction(impact.height, rules.fall);
      if (share === 0) expect(hits).toHaveLength(0);
      else expect(hits).toHaveLength(1);
      expect(healthOf(world, player)?.current).toBeCloseTo(HEALTH - HEALTH * share, 6);
      // One landing noise, the stealth table's level for that fall height, attributed to the player.
      const landings = noises.filter((noise) => noise.kind === LANDING_NOISE);
      expect(landings).toHaveLength(1);
      expect(landings[0]?.source).toBe(player);
      const expected = landingDb(footsteps, impact.height, 0, 0);
      expect(landings[0]?.loudness).toBeCloseTo(expected ?? 0, 0);
      expect(landings[0]?.loudness).toBeGreaterThan(60);
    },
  );

  it('AC-3: a higher fall costs more health than a lower one', ({ task }) => {
    markExercised(task, 'environment-damage', DEFAULT_ENVIRONMENT_DAMAGE_ID);
    const low = slip(4);
    const high = slip(6);
    expect(healthOf(high.world, high.player)?.current).toBeLessThan(
      healthOf(low.world, low.player)?.current ?? 0,
    );
  });
});
