import { describe, expect, it, vi } from 'vitest';
import { loadGameContent, type GameContent } from '@content/index';
import {
  addInteractable,
  addInteractor,
  addInventory,
  ClimbRopeComponent,
  INTERACTION_COMPONENTS,
  interactRemotely,
  InteractionFocusComponent,
  InventoryRules,
  PlacementComponent,
  registerWorldProperties,
  ROPE_ANCHOR_TAG,
  ropeAt,
  RopeAnchorComponent,
  World,
  type LoadedScene,
} from '@sim/index';
import { hasRopeAnchors, ropeItemOf, startRopes } from './ropes';

const content = loadGameContent();

const scene = (...tags: string[][]) =>
  ({
    spawns: tags.map((t, n) => ({
      entity: n + 100,
      spawn: { id: `s${String(n)}`, position: { x: 1, y: 5, z: 2 }, tags: t },
    })),
  }) as unknown as LoadedScene;

describe('ropes in the game (mw-e10.9)', () => {
  it('reads the climbing rope from content: the tool with a rope block', () => {
    expect(ropeItemOf(content)).toEqual({ id: 'climbing-rope', length: 6 });
    // Content without one has none to offer.
    const none = { all: () => [{ id: 'x', category: 'misc' }] } as unknown as GameContent;
    expect(ropeItemOf(none)).toBeUndefined();
    const plainTool = { all: () => [{ id: 'x', category: 'tool' }] } as unknown as GameContent;
    expect(ropeItemOf(plainTool)).toBeUndefined();
  });

  it('knows whether a scene has rope anchors', () => {
    expect(hasRopeAnchors(scene(['a'], [ROPE_ANCHOR_TAG]))).toBe(true);
    expect(hasRopeAnchors(scene(['a'], []))).toBe(false);
    expect(hasRopeAnchors(scene())).toBe(false);
  });

  it('a scene without anchors changes nothing in its world', () => {
    const world = new World<never>({ seed: 1 });
    const navigation = { syncRopes: vi.fn() };
    expect(startRopes(world, content, scene(['a']), new InventoryRules([]), navigation)).toEqual(
      [],
    );
    world.step();
    expect(navigation.syncRopes).not.toHaveBeenCalled();
    // Lazily registered: nothing of the rope rules exists in this world, so no hash moves.
    expect(world.isRegistered(RopeAnchorComponent)).toBe(false);
    // Nor does a game whose content has no rope.
    const none = { all: () => [] } as unknown as GameContent;
    expect(
      startRopes(world, none, scene([ROPE_ANCHOR_TAG]), new InventoryRules([]), navigation),
    ).toEqual([]);
  });

  it('the level’s hook ties the content’s rope from the pack and the navmesh is told every tick', () => {
    const world = registerWorldProperties(new World<never>({ seed: 1 }));
    world.register(ClimbRopeComponent, PlacementComponent, ...INTERACTION_COMPONENTS);
    const player = world.spawn();
    addInventory(world, player);
    const rope = content.get('item', 'climbing-rope');
    const inventory = new InventoryRules([
      {
        id: rope.id,
        category: 'tool',
        stackable: true,
        maxStack: 5,
        flags: { unique: false, questItem: false },
      },
    ]);
    inventory.add(world, player, rope.id, 1);
    const hook = world.spawn();
    const loaded = {
      spawns: [
        {
          entity: hook,
          spawn: { id: 'hook', position: { x: 3, y: 5, z: 2 }, tags: [ROPE_ANCHOR_TAG] },
        },
      ],
    } as unknown as LoadedScene;
    const navigation = { syncRopes: vi.fn() };
    expect(startRopes(world, content, loaded, inventory, navigation)).toEqual([hook]);
    addInteractable(
      world,
      hook,
      { affordances: [{ verb: 'climb', requires: [{ item: rope.id }] }, { verb: 'release' }] },
      { x: 3, y: 5, z: 2 },
    );
    addInteractor(world, player, { items: [rope.id] });
    world.add(player, InteractionFocusComponent, { target: hook, score: 1, hold: null });
    expect(interactRemotely(world, player, hook)).toMatchObject({ verb: 'climb' });
    world.step();
    world.step();
    expect(navigation.syncRopes).toHaveBeenCalledTimes(2);
    expect(navigation.syncRopes).toHaveBeenCalledWith(world);
    const tied = ropeAt(world, hook);
    expect(tied).toBeDefined();
    // The rope is the content's: 6 m, made of rope.
    expect(world.get(tied ?? hook, ClimbRopeComponent)?.length).toBe(6);
  });
});
