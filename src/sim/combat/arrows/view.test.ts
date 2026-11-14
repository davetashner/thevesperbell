// What "in view" means to the arrow cap, with no camera (mw-e05.7 AC-3): the player's position and
// look direction only, so a replay with a different (or no) camera removes the same arrows.
import { describe, expect, it } from 'vitest';
import { initialCharacterState } from '../../character/controller';
import { CharacterController } from '../../character/system';
import { World } from '../../core/world';
import { PlayerLook } from '../../player/player';
import type { Vec3 } from '../../stimulus/shapes';
import { DEFAULT_PLAYER_VIEW, playerViewRule } from './view';

const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

function playerAt(position: Vec3, yaw: number): World<never> {
  const world = new World<never>({ seed: 1 });
  world.register(CharacterController, PlayerLook);
  const player = world.spawn();
  world.add(player, CharacterController, initialCharacterState(position));
  world.add(player, PlayerLook, { yaw, pitch: 0 });
  return world;
}

describe('player view stand-in (mw-e05.7)', () => {
  it('AC-3: arrows near the player are in view all round; far ones only along the look direction', () => {
    const world = playerAt(v3(0, 0, 0), 0); // looking down -z
    const inView = playerViewRule();
    expect(inView(world, v3(0, 1, 0))).toBe(true); // at its feet
    expect(inView(world, v3(0, 0, 5.9))).toBe(true); // behind, but near
    expect(inView(world, v3(0, 0, 20))).toBe(false); // behind, far
    expect(inView(world, v3(0, 0, -20))).toBe(true); // ahead
    expect(inView(world, v3(15, 0, -10))).toBe(true); // ahead and to the side, inside 60 degrees
    expect(inView(world, v3(20, 0, 5))).toBe(false); // off to the side and behind
    expect(inView(world, v3(0, 0, -41))).toBe(false); // ahead, beyond far
  });

  it('turns with the look yaw, so the same arrow is in view or not by where the player faces', () => {
    const point = v3(0, 0, -20);
    expect(playerViewRule()(playerAt(v3(0, 0, 0), 0), point)).toBe(true);
    expect(playerViewRule()(playerAt(v3(0, 0, 0), Math.PI), point)).toBe(false);
  });

  it('is exactly the same for the same sim state, however it is asked (no camera, no clock)', () => {
    const a = playerAt(v3(3, 0, 4), 0.7);
    const b = playerAt(v3(3, 0, 4), 0.7);
    const points = [v3(0, 0, 0), v3(10, 2, -9), v3(-30, 0, 12), v3(3, 0, 4)];
    const rule = playerViewRule({ near: 8, far: 30, halfAngle: 1 });
    expect(points.map((p) => rule(a, p))).toEqual(points.map((p) => rule(b, p)));
    expect(DEFAULT_PLAYER_VIEW.near).toBe(6);
  });

  it('a point exactly at the player is in view, and with no player nothing is', () => {
    const world = playerAt(v3(1, 0, 1), 0);
    expect(playerViewRule({ near: 0 })(world, v3(1, 0, 1))).toBe(true);
    const flatAbove = v3(1, 10, 1); // straight above: no horizontal direction, counts as ahead
    expect(playerViewRule({ near: 1 })(world, flatAbove)).toBe(true);
    const bare = new World<never>({ seed: 1 });
    expect(playerViewRule()(bare, v3(0, 0, 0))).toBe(false);
    bare.register(CharacterController, PlayerLook);
    expect(playerViewRule()(bare, v3(0, 0, 0))).toBe(false);
    const half = new World<never>({ seed: 1 });
    half.register(CharacterController, PlayerLook);
    const body = half.spawn();
    half.add(body, PlayerLook, { yaw: 0, pitch: 0 });
    expect(playerViewRule()(half, v3(0, 0, 0))).toBe(false);
  });
});
