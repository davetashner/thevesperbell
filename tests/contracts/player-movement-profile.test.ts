// mw-e02.10: the shipped player (src/content/data/controller/player.json) publishes the movement
// profiles the bead documents. The sim's unit tests pin the rules with fixture numbers; this re-checks
// them through installPlayer and the ActionFrame against the data file, so a retune that moves a
// multiplier fails here. Content may import the sim only as types, so this check lives outside src/.
import { describe, expect, it } from 'vitest';
import { controllerTuningFor, loadGameContent, PLAYER_CONTROLLER_ID } from '@content/index';
import {
  actionButton,
  actionFrame,
  actionVector,
  box,
  CharacterEncumbrance,
  DEFAULT_FOOTSTEP_SURFACES,
  DEFAULT_STEALTH_TUNING,
  FakeCollisionWorld,
  installPlayer,
  movementProfileOf,
  World,
  type ActionFrame,
  type ButtonAction,
  type SceneSpawnPlacement,
} from '@sim/index';

const tuning = controllerTuningFor(loadGameContent().get('controller', PLAYER_CONTROLLER_ID));

const START: SceneSpawnPlacement = {
  id: 'player-start',
  position: { x: 0, y: 0, z: 0 },
  yaw: 180,
  rotation: { x: 0, y: 1, z: 0, w: 0 },
  prop: undefined,
  tags: ['player-start'],
};

const frame = (move: [number, number], held: ButtonAction[] = []): ActionFrame =>
  actionFrame({
    move: actionVector(move[0], move[1]),
    look: actionVector(0, 0),
    buttons: (action) => actionButton(false, held.includes(action), false),
  });

function player() {
  const world = new World<ActionFrame>({ seed: 3 }).register(CharacterEncumbrance);
  const id = installPlayer(world, {
    spawns: [START],
    collision: new FakeCollisionWorld([box({ x: -50, y: -1, z: -50 }, { x: 50, y: 0, z: 50 })]),
    tuning,
  });
  const hold = (f: ActionFrame, ticks: number) => {
    for (let i = 0; i < ticks; i++) world.step([f]);
    const profile = movementProfileOf(world, id);
    if (profile === undefined) throw new Error('no movement profile');
    return profile;
  };
  return { world, id, hold };
}

describe('the shipped player’s movement profiles (mw-e02.10)', () => {
  it('states the sim’s default stealth tuning', () => {
    expect(tuning.stealth).toEqual({
      ...DEFAULT_STEALTH_TUNING,
      surfaces: DEFAULT_FOOTSTEP_SURFACES,
    });
  });

  it('AC-1: crouch-walking at the crouch speed is 0.15 noise at the crouch capsule’s height', () => {
    const { hold } = player();
    expect(hold(frame([0, 1], ['crouch']), 30)).toMatchObject({
      stance: 'crouched',
      gait: 'walk',
      noise: 0.15,
      silhouetteHeight: tuning.capsule.crouchHeight,
    });
  });

  it('AC-2: sprint held while crouched stands the player into stand-sprint', () => {
    const { hold } = player();
    hold(frame([0, 1], ['crouch']), 30);
    expect(hold(frame([0, 1], ['crouch', 'sprint']), 1)).toMatchObject({
      stance: 'standing',
      gait: 'sprint',
      noise: 1,
      silhouetteHeight: tuning.capsule.height,
    });
  });

  it('AC-3: a 1.5 encumbrance from armor makes walking 0.45 noise; sprinting clamps at 1.0', () => {
    const { world, id, hold } = player();
    world.add(id, CharacterEncumbrance, { noise: 1.5 });
    expect(hold(frame([0, 0.4]), 30).noise).toBeCloseTo(0.45, 12);
    expect(hold(frame([0, 1], ['sprint']), 40).noise).toBe(1);
  });

  it('the slow-walk action is the quietest moving gait', () => {
    const { hold } = player();
    expect(hold(frame([0, 1], ['slowWalk']), 30)).toMatchObject({ gait: 'slowWalk', noise: 0.08 });
  });
});
