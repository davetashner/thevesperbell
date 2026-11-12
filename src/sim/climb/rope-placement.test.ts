import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import {
  addInteractable,
  addInteractor,
  INTERACTION_COMPONENTS,
  interactRemotely,
  InteractionFocusComponent,
  interactionPrompt,
  interacted,
} from '../interaction/system';
import { addInventory, InventoryRules, inventoryOf } from '../inventory/inventory';
import { registerWorldProperties } from '../properties/components';
import { PlacementComponent } from '../stimulus/placement';
import type { LoadedScene } from '../scene/loader';
import { placedRopes, ropeAt, sceneRopeAnchors, ROPE_ANCHOR_TAG } from './rope-anchors';
import { installRopePlacement } from './rope-placement';
import { ClimbRopeComponent } from './ropes';

const ROPE_ITEM = 'climbing-rope';

/** What level content gives a rope anchor: Tie rope (needs the item) and Untie rope. */
const HOOK = {
  affordances: [
    { verb: 'climb', label: 'Tie rope', requires: [{ item: ROPE_ITEM }], reason: 'Needs a rope' },
    { verb: 'release', label: 'Untie rope' },
  ],
  radius: 0.5,
} as const;

function setup(carried = 1, material = true) {
  const world = registerWorldProperties(new World<never>({ seed: 1 }));
  world.register(ClimbRopeComponent, PlacementComponent, ...INTERACTION_COMPONENTS);
  const player = world.spawn();
  addInventory(world, player);
  const inventory = new InventoryRules([
    {
      id: ROPE_ITEM,
      category: 'tool',
      stackable: true,
      maxStack: 5,
      flags: { unique: false, questItem: false },
    },
  ]);
  if (carried > 0) inventory.add(world, player, ROPE_ITEM, carried);
  const hook = world.spawn();
  const position = { x: 3.75, y: 5, z: 2.25 };
  sceneRopeAnchors(world, {
    spawns: [{ entity: hook, spawn: { id: 'rafter-hook', position, tags: [ROPE_ANCHOR_TAG] } }],
  } as unknown as LoadedScene);
  addInteractable(world, hook, HOOK, position);
  const kit = () => {
    addInteractor(world, player, { items: carried > 0 ? [ROPE_ITEM] : [] });
  };
  kit();
  world.add(player, InteractionFocusComponent, { target: hook, score: 1, hold: null });
  const stop = installRopePlacement(world, {
    inventory,
    item: ROPE_ITEM,
    length: 6,
    ...(material && { properties: { material: 'rope' } }),
  });
  const held = () =>
    (inventoryOf(world, player)?.items ?? []).reduce((total, item) => total + item.count, 0);
  const tick = () => {
    world.step([]);
  };
  return { world, player, hook, inventory, stop, held, tick };
}

describe('tying and untying ropes through Interact (mw-e10.9)', () => {
  it('AC-4: Interact at the hook ties a rope from the pack; Interact again unties it and gives it back', () => {
    const { world, player, hook, held, tick } = setup();
    expect(interactionPrompt(world, player)).toMatchObject({
      verb: 'climb',
      label: 'Tie rope',
      available: true,
    });
    expect(interactRemotely(world, player, hook)).toMatchObject({ verb: 'climb' });
    tick();
    const rope = ropeAt(world, hook);
    expect(rope).toBeDefined();
    expect(world.get(rope ?? hook, ClimbRopeComponent)).toEqual({
      anchor: { x: 3.75, y: 5, z: 2.25 },
      length: 6,
    });
    expect(held()).toBe(0);
    // Now the primary is Untie: Tie says why not.
    expect(interactionPrompt(world, player)).toMatchObject({
      verb: 'release',
      label: 'Untie rope',
    });
    const options = interactionPrompt(world, player)?.options;
    expect(options?.[0]).toMatchObject({ available: false, reason: 'A rope is already tied here' });
    expect(interactRemotely(world, player, hook)).toMatchObject({ verb: 'release' });
    tick();
    expect(ropeAt(world, hook)).toBeUndefined();
    expect(placedRopes(world)).toEqual([]);
    expect(held()).toBe(1);
    expect(world.isAlive(rope ?? hook)).toBe(false);
    // Free again: Untie says there is no rope.
    const again = interactionPrompt(world, player)?.options;
    expect(again?.[1]).toMatchObject({ available: false, reason: 'No rope tied here' });
  });

  it('without a rope item, Tie rope is greyed with its reason and nothing is tied', () => {
    const { world, player, hook, tick } = setup(0);
    expect(interactionPrompt(world, player)).toMatchObject({
      verb: 'climb',
      available: false,
      reason: 'Needs a rope',
    });
    expect(interactRemotely(world, player, hook)).toBeUndefined();
    tick();
    expect(ropeAt(world, hook)).toBeUndefined();
  });

  it('a pack that lost its rope since the prompt ties nothing, and other interactions are left alone', () => {
    const { world, player, hook, inventory, held, tick } = setup();
    inventory.remove(world, player, { defId: ROPE_ITEM, count: 1 });
    // The kit still says it carries one (a stale prompt): the pack decides.
    expect(interactRemotely(world, player, hook)).toMatchObject({ verb: 'climb' });
    tick();
    expect(ropeAt(world, hook)).toBeUndefined();
    expect(held()).toBe(0);
    // A climb on something that is no anchor (a ladder prompt) and an untie on a free hook do nothing.
    const ladder = world.spawn();
    addInteractable(world, ladder, { affordances: [{ verb: 'climb' }] }, { x: 0, y: 0, z: 0 });
    expect(interactRemotely(world, player, ladder)).toMatchObject({ verb: 'climb' });
    // Any other verb on the hook (a lever's press) is none of the rope's business.
    world.events.emit(interacted, { actor: player, target: hook, verb: 'press', affordance: 0 });
    // An untie on the free hook: nothing hangs there, so nothing is given back.
    world.events.emit(interacted, { actor: player, target: hook, verb: 'release', affordance: 1 });
    tick();
    expect(ropeAt(world, hook)).toBeUndefined();
  });

  it('a tied hook cannot be tied again by a stale interaction', () => {
    const { world, player, hook, held, tick } = setup(2);
    expect(interactRemotely(world, player, hook)).toMatchObject({ verb: 'climb' });
    tick();
    const rope = ropeAt(world, hook);
    // A second climb event arriving while the rope hangs spends nothing.
    world.events.emit(interacted, { actor: player, target: hook, verb: 'climb', affordance: 0 });
    tick();
    expect(ropeAt(world, hook)).toBe(rope);
    expect(held()).toBe(1);
  });

  it('a rope tied without a material still hangs and climbs as rope', () => {
    const { world, player, hook, tick } = setup(1, false);
    expect(interactRemotely(world, player, hook)).toMatchObject({ verb: 'climb' });
    tick();
    const rope = ropeAt(world, hook);
    expect(rope).toBeDefined();
    expect(world.get(rope ?? hook, ClimbRopeComponent)?.length).toBe(6);
  });

  it('stopping it leaves the Interact verb as it found it', () => {
    const { world, player, hook, stop, held, tick } = setup();
    stop();
    expect(interactionPrompt(world, player)?.options[0]).toMatchObject({ available: true });
    expect(interactRemotely(world, player, hook)).toMatchObject({ verb: 'climb' });
    tick();
    expect(ropeAt(world, hook)).toBeUndefined();
    expect(held()).toBe(1);
  });

  it('a world with no anchors ignores every interaction', () => {
    const world = registerWorldProperties(new World<never>({ seed: 1 }));
    world.register(PlacementComponent, ...INTERACTION_COMPONENTS);
    const player = world.spawn();
    addInventory(world, player);
    addInteractor(world, player);
    const lever = world.spawn();
    addInteractable(world, lever, { affordances: [{ verb: 'climb' }] }, { x: 0, y: 0, z: 0 });
    world.add(player, InteractionFocusComponent, { target: lever, score: 1, hold: null });
    installRopePlacement(world, {
      inventory: new InventoryRules([]),
      item: ROPE_ITEM,
      length: 6,
    });
    expect(interactionPrompt(world, player)).toMatchObject({ available: true });
    expect(interactRemotely(world, player, lever)).toMatchObject({ verb: 'climb' });
    world.step([]);
    expect(placedRopes(world)).toEqual([]);
  });
});
