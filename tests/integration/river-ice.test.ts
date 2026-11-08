// mw-e03.7 AC-6: a greybox river (two banks, a 6 m water volume between them, a bed 2 m down) with the
// game's real water material and the player's controller on Rapier. A cold stimulus swept across the
// river freezes its surface into ice colliders the bot walks over; without it the bot drops into the
// channel. The same run twice reproduces the same state hashes, which cover Rapier and the ice cells.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { loadGameContent, materialPresets, PLAYER_CONTROLLER_ID } from '@content/index';
import { markExercised } from '@content/testing';
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
  hashWorld,
  installElementField,
  installIce,
  installLiquids,
  installPhysicsObjects,
  installStimuli,
  liquidRules,
  LiquidIceComponent,
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
const HZ = 60;
const v = (x: number, y: number, z: number) => ({ x, y, z });

/** Walking east (+x) at a run's pace, or standing still. */
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

function greyboxRiver(sweepCold: boolean) {
  const physics = new RapierPhysics(RAPIER);
  physics.add(box(v(-12, -1, -4), v(0, 0, 4))); // west bank, top at y 0
  physics.add(box(v(6, -1, -4), v(18, 0, 4))); // east bank
  physics.add(box(v(0, -3, -4), v(6, -2, 4))); // the bed, 2 m down
  physics.add(box(v(-0.2, -3, -4), v(0, 0, 4)));
  const world = new World<CharacterInput>({ seed: 11, hz: HZ, physics }).register(
    CharacterController,
  );
  registerWorldProperties(world);
  installStimuli(world);
  installElementField(world, { maxChunks: 16 });
  installLiquids(world);
  installIce(world);
  installPhysicsObjects(world);
  const volume = createVolume(world, presets, {
    min: v(0, -2, -3),
    max: v(6, 0, 3),
    layers: [{ liquid: 'water', depth: 2 }],
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
  const player = spawnCharacter(world, v(-3, 0, 0));
  if (sweepCold) {
    // The sweep: a cold box passes over the river from the west bank to the east.
    for (let x = 0.5; x <= 5.5; x += 1) {
      applyStimulus(world, {
        shape: { kind: 'box', center: v(x, 0, 0), halfExtents: v(0.6, 1, 3.2) },
        element: 'cold',
        intensity: 60,
      });
    }
  }
  return { world, volume, player };
}

/** Waits `wait` seconds, walks east for `walk` seconds; returns the hashes every second and the end state. */
function run(sweepCold: boolean, wait = 5, walk = 4) {
  const { world, volume, player } = greyboxRiver(sweepCold);
  const hashes: string[] = [];
  for (let tick = 0; tick < (wait + walk) * HZ; tick++) {
    world.step([tick < wait * HZ ? STAND : EAST]);
    if (tick % HZ === 0) hashes.push(hashWorld(world));
  }
  const end = world.get(player, CharacterController);
  if (end === undefined) throw new Error('no character');
  return { hashes, end, ice: world.get(volume, LiquidIceComponent) };
}

describe('crossing a frozen river (mw-e03.7)', () => {
  it('AC-6: a cold stimulus swept across the river lets the bot walk to the far bank', ({
    task,
  }) => {
    markExercised(task, 'controller', PLAYER_CONTROLLER_ID);
    const { end, ice } = run(true);
    expect(ice?.cells.some((cell) => cell.solid >= 0.1)).toBe(true);
    expect(end.position.x).toBeGreaterThan(7);
    expect(end.position.y).toBeGreaterThan(-0.2);
    expect(end.grounded).toBe(true);
  });

  it('without the cold the bot drops into the channel and cannot cross', () => {
    const { end } = run(false);
    expect(end.position.y).toBeLessThan(-1);
    expect(end.position.x).toBeLessThan(6);
  });

  it('AC-6: the same run again reproduces the same state hashes, ice colliders included', () => {
    const a = run(true);
    const b = run(true);
    expect(b.hashes).toEqual(a.hashes);
    expect(new Set(a.hashes).size).toBeGreaterThan(5);
    expect(b.end).toEqual(a.end);
  });
});
