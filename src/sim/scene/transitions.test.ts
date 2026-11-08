import { describe, expect, it } from 'vitest';
import { TEST_SCENE, testKit } from './fixtures';
import { layoutScene } from './layout';
import { CharacterController, initialCharacterState } from '../character';
import { World } from '../core/world';
import type { SceneLayout } from './layout';
import { areaTransition, inTransition, installSceneTransitions } from './transitions';

const box = { min: { x: -1, y: 0, z: 10 }, max: { x: 1, y: 3, z: 12 } };
const layout = {
  id: 'a',
  transitions: [{ id: 'gate', ...box, scene: 'b', spawn: 'arrive-from-a', follow: true }],
} as unknown as SceneLayout;

function setup(start: { x: number; y: number; z: number }) {
  const world = new World<never>({ seed: 1 });
  world.register(CharacterController);
  const player = world.spawn();
  world.add(player, CharacterController, initialCharacterState(start));
  const seen: unknown[] = [];
  world.events.on(areaTransition, (t) => {
    seen.push(t);
  });
  installSceneTransitions(world, layout, player);
  const move = (z: number) => {
    world.set(player, CharacterController, initialCharacterState({ x: 0, y: 0.5, z }));
    world.step();
  };
  return { world, seen, move };
}

describe('scene transitions system (mw-e01.11)', () => {
  it('tests the volume inclusively', () => {
    expect(
      inTransition(
        { id: 'g', ...box, scene: 'b', spawn: 's', follow: false },
        { x: 1, y: 3, z: 12 },
      ),
    ).toBe(true);
    expect(
      inTransition(
        { id: 'g', ...box, scene: 'b', spawn: 's', follow: false },
        { x: 1.1, y: 1, z: 11 },
      ),
    ).toBe(false);
  });

  it('fires once on entering, again only after leaving and re-entering', () => {
    const { seen, move } = setup({ x: 0, y: 0.5, z: 0 });
    move(0);
    move(11);
    move(11.5);
    expect(seen).toEqual([
      expect.objectContaining({
        from: 'a',
        transition: 'gate',
        scene: 'b',
        spawn: 'arrive-from-a',
        follow: true,
        // Carried objects are set down outside this volume (mw-e17.14).
        volume: { min: box.min, max: box.max },
      }),
    ]);
    move(0);
    move(11);
    expect(seen).toHaveLength(2);
  });

  it('does not fire for a player who starts inside', () => {
    const { seen, move } = setup({ x: 0, y: 0.5, z: 11 });
    move(11);
    move(11);
    expect(seen).toEqual([]);
  });

  it('adds nothing for a scene without transitions', () => {
    const world = new World<never>({ seed: 1 });
    installSceneTransitions(world, { id: 'x', transitions: [] } as unknown as SceneLayout, 1);
    expect(() => {
      world.step();
    }).not.toThrow();
  });

  it('lays transitions out in metres, with the grid applied', () => {
    const laid = layoutScene(
      {
        ...TEST_SCENE,
        grid: 2,
        transitions: [
          {
            id: 'gate',
            min: [0, 0, 1],
            max: [1, 1, 2],
            scene: { id: 'b' },
            spawn: 's',
            follow: false,
          },
        ],
      },
      testKit,
    );
    expect(laid.transitions).toEqual([
      {
        id: 'gate',
        min: { x: 0, y: 0, z: 2 },
        max: { x: 2, y: 2, z: 4 },
        scene: 'b',
        spawn: 's',
        follow: false,
      },
    ]);
    expect(layoutScene(TEST_SCENE, testKit).transitions).toEqual([]);
  });

  it('does nothing for a player with no controller state', () => {
    const world = new World<never>({ seed: 1 });
    world.register(CharacterController);
    const player = world.spawn();
    installSceneTransitions(world, layout, player);
    world.step();
    expect(world.events).toBeDefined();
  });
});
