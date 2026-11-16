// mw-e40.14 AC-1 (mw-e40.29): the pool frozen by a cold stimulus is walked to the Gilded Tern's hull
// ladder. The geometry is the harbour scene's own: the pool floor at y -6, the water surface at y -2.5,
// the hull's pool-side wall at x 30 and the hull ladder's footprint, with the game's real water
// material and the player's controller on Rapier. Without the cold the player sinks to the pool floor.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { loadGameContent, materialPresets } from '@content/index';
import {
  applyStimulus,
  box,
  CharacterController,
  characterControllerSystem,
  createVolume,
  ElementRuleSet,
  elementFieldSystem,
  elementRulesSystem,
  fireRules,
  freezeRules,
  installElementField,
  installIce,
  installLiquids,
  installPhysicsObjects,
  installStimuli,
  liquidRules,
  RapierCollisionWorld,
  RapierPhysics,
  registerWorldProperties,
  spawnCharacter,
  stimulusSystem,
  World,
  type CharacterInput,
} from '@sim/index';
import { playerTuning } from '@tools/replay/character-scenarios';

const content = loadGameContent();
const presets = materialPresets(content.all('material'));
const scene = content.get('scene', 'wendmouth-harbour');
const HZ = 60;
const v = (x: number, y: number, z: number) => ({ x, y, z });

const ladder = scene.placements.find(
  (p) => p.properties?.climbable === 'ladder' && p.at[0] === 29.75,
);
const iceWalk = scene.spawns.find((s) => s.id === 'pool-ice-walk');
const pool = scene.spawns.find((s) => s.id === 'harbour-pool-c');
if (ladder === undefined || iceWalk === undefined || pool === undefined) {
  throw new Error('the hull ladder, the ice-walk marker and the pool are in the harbour scene');
}
const FLOOR = pool.at[1];
const SURFACE = FLOOR + (pool.liquid?.depth ?? 0);
/** The hull's pool-side face: the ladder is hung on it. */
const HULL_FACE_X = ladder.at[0] + 0.25;
const LADDER_Z = ladder.at[2];

const EAST: CharacterInput = {
  actions: {
    move: { x: 0, y: 1 },
    jump: { pressed: false, held: false },
    sprint: { pressed: false, held: false },
    crouch: { pressed: false, held: false },
  },
  cameraYaw: -Math.PI / 2,
};
const STAND: CharacterInput = { ...EAST, actions: { ...EAST.actions, move: { x: 0, y: 0 } } };

function run(sweepCold: boolean) {
  const physics = new RapierPhysics(RAPIER);
  physics.add(box(v(10, FLOOR - 1, 105), v(40, FLOOR, 135))); // the pool floor
  physics.add(box(v(HULL_FACE_X, FLOOR, 106), v(40, 2, 146))); // the hull
  const world = new World<CharacterInput>({ seed: 11, hz: HZ, physics }).register(
    CharacterController,
  );
  registerWorldProperties(world);
  installStimuli(world);
  installElementField(world, { maxChunks: 16 });
  installLiquids(world);
  installIce(world);
  installPhysicsObjects(world);
  createVolume(world, presets, {
    min: v(10, FLOOR, 105),
    max: v(HULL_FACE_X, SURFACE, 135),
    layers: [{ liquid: 'water', depth: SURFACE - FLOOR }],
  });
  world
    .addSystem(stimulusSystem())
    .addSystem(
      elementRulesSystem(
        new ElementRuleSet([
          ...fireRules({ presets, burnt: new Map() }),
          ...freezeRules(),
          ...liquidRules({ presets }),
        ]),
      ),
    )
    .addSystem(elementFieldSystem())
    .addSystem(
      characterControllerSystem<CharacterInput>({
        collision: new RapierCollisionWorld(physics),
        tuning: playerTuning(),
        input: (inputs) => inputs[0],
      }),
    );
  if (sweepCold) {
    for (let x = 11; x <= HULL_FACE_X; x += 1) {
      applyStimulus(world, {
        shape: { kind: 'box', center: v(x, SURFACE, LADDER_Z), halfExtents: v(0.6, 1, 3.2) },
        element: 'cold',
        intensity: 60,
      });
    }
  }
  for (let tick = 0; tick < 5 * HZ; tick++) world.step([STAND]);
  const player = spawnCharacter(world, v(20, SURFACE + 0.1, LADDER_Z));
  for (let tick = 0; tick < 12 * HZ; tick++) world.step([EAST]);
  const end = world.get(player, CharacterController);
  if (end === undefined) throw new Error('no character');
  return end;
}

describe('walking the frozen pool to the Gilded Tern hull ladder (mw-e40.14 AC-1)', () => {
  it('AC-1: the ladder spans the ice, and the ice-walk marker is at its foot', () => {
    expect(ladder.at[1]).toBeLessThanOrEqual(FLOOR);
    expect(ladder.at[1] + (ladder.scale?.[1] ?? 0)).toBeGreaterThanOrEqual(2);
    expect(Math.abs(iceWalk.at[2] - LADDER_Z)).toBeLessThan(1);
    expect(HULL_FACE_X - iceWalk.at[0]).toBeLessThan(2);
  });

  it('AC-1: with the pool frozen the player walks across the ice and stands at the ladder foot', () => {
    const end = run(true);
    expect(end.position.x).toBeGreaterThan(HULL_FACE_X - 1.2);
    expect(end.position.y).toBeGreaterThan(SURFACE - 0.5);
    expect(end.grounded).toBe(true);
  });

  it('without the cold the pool is open water and the player sinks to its floor', () => {
    const end = run(false);
    expect(end.position.y).toBeLessThan(SURFACE - 1);
  });
});
