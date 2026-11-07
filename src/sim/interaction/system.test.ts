import { describe, expect, it } from 'vitest';
import { initialCharacterState } from '../character/controller';
import { box } from '../character/greybox';
import { CharacterController } from '../character/system';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import { cos, sin } from '../math';
import { actionButton, actionFrame, actionVector, type ActionFrame } from '../input/action-frame';
import { PhysicsColliderComponent, PhysicsObjectComponent } from '../physics/objects';
import { PlayerLook } from '../player/player';
import { addProperties, registerWorldProperties } from '../properties/components';
import { FakeSightWorld } from '../sight/fake-sight-world';
import { hashWorld } from '../snapshot';
import { placeEntity, PlacementComponent } from '../stimulus/placement';
import type { InteractableSpec, InteractorKit } from './affordance';
import {
  addAffordanceGate,
  addInteractable,
  addInteractor,
  addSceneInteractables,
  affordancesOf,
  holdTicks,
  interactableOf,
  interactRemotely,
  InteractableComponent,
  interacted,
  InteractionFocusComponent,
  interactionPrompt,
  InteractorComponent,
  installInteraction,
  physicsBodiesOf,
  playerView,
  type Interaction,
  type InteractionOptions,
} from './system';

const DEG = Math.PI / 180;
const UP = actionButton(false, false, false);

/** A frame with Interact in the given state. */
function frame(pressed: boolean, held: boolean, released = false): ActionFrame {
  const zero = actionVector(0, 0);
  return actionFrame({
    move: zero,
    look: zero,
    buttons: (action) => (action === 'interact' ? actionButton(pressed, held, released) : UP),
  });
}
const IDLE = frame(false, false);
const PRESS = frame(true, true);
const HOLD = frame(false, true);
const RELEASE = frame(false, false, true);
const TAP = frame(true, false, true);

interface Setup {
  readonly world: World<ActionFrame>;
  readonly actor: EntityId;
  readonly events: Interaction[];
}

/** A world with a player-like actor at the origin, feet on y = 0, facing −z. */
function setup(
  options: InteractionOptions<ActionFrame> = {},
  kit: Partial<InteractorKit> = {},
): Setup {
  const world = registerWorldProperties(new World<ActionFrame>({ seed: 1 }));
  world.register(CharacterController, PlayerLook, PlacementComponent);
  installInteraction(world, options);
  const actor = world.spawn();
  world.add(actor, CharacterController, initialCharacterState({ x: 0, y: 0, z: 0 }));
  world.add(actor, PlayerLook, { yaw: 0, pitch: 0 });
  addInteractor(world, actor, kit);
  const events: Interaction[] = [];
  world.events.on(interacted, (event) => events.push(event));
  return { world, actor, events };
}

/** An interactable `d` m away at `deg` degrees right of −z, at reach height (1 m). */
function place(
  world: World<ActionFrame>,
  d: number,
  deg: number,
  spec: InteractableSpec = { affordances: [{ verb: 'pull' }] },
): EntityId {
  const entity = world.spawn();
  const origin = { x: d * sin(deg * DEG), y: 0, z: -d * cos(deg * DEG) };
  addInteractable(world, entity, spec, origin);
  return entity;
}

const focusOf = (world: World<ActionFrame>, actor: EntityId) =>
  world.get(actor, InteractionFocusComponent);

function steps(world: World<ActionFrame>, input: ActionFrame, ticks: number): void {
  for (let i = 0; i < ticks; i++) world.step([input]);
}

describe('interaction system (mw-e02.5)', () => {
  it('AC-1: focuses the 1.0 m / 30° interactable over the 2.0 m one ahead, identically every run', () => {
    const run = () => {
      const { world, actor } = setup();
      const ahead = place(world, 2, 0);
      const near = place(world, 1, 30);
      world.step([IDLE]);
      return { world, focus: focusOf(world, actor), ahead, near };
    };
    const first = run();
    const second = run();
    expect(first.focus?.target).toBe(first.near);
    expect(first.focus?.score).toBeCloseTo(1 - 1 / 2.5 + cos(30 * DEG), 6);
    expect(second.focus).toEqual(first.focus);
    expect(hashWorld(second.world)).toBe(hashWorld(first.world));
  });

  it('AC-2: an interactable behind a wall within range is not selected', () => {
    const wall = box({ x: -2, y: 0, z: -1.2 }, { x: 2, y: 3, z: -1 });
    const sight = new FakeSightWorld([wall]);
    const { world, actor } = setup({ sight });
    place(world, 2, 0);
    world.step([PRESS]);
    expect(focusOf(world, actor)).toEqual({ target: null, score: 0, hold: null });
    expect(interactionPrompt(world, actor)).toBeUndefined();

    // Without the wall it is.
    sight.remove(1);
    world.step([IDLE]);
    expect(focusOf(world, actor)?.target).not.toBeNull();
  });

  it("AC-2: the object's own colliders never block it", () => {
    const sight = new FakeSightWorld();
    const crate = sight.add(box({ x: -0.3, y: 0.7, z: -2.3 }, { x: 0.3, y: 1.3, z: -1.7 }));
    const blocked = setup({ sight });
    const target = place(blocked.world, 2, 0);
    blocked.world.step([IDLE]);
    expect(focusOf(blocked.world, blocked.actor)?.target).toBeNull();

    const own = setup({
      sight,
      bodiesOf: (_world, entity) => (entity === target ? [crate] : []),
    });
    place(own.world, 2, 0);
    own.world.step([IDLE]);
    expect(focusOf(own.world, own.actor)?.target).toBe(target);
  });

  it('reaches an object whose focus point is the reach point itself', () => {
    const sight = new FakeSightWorld([box({ x: -1, y: 0, z: -1 }, { x: 1, y: 2, z: 1 })]);
    const { world, actor } = setup({ sight });
    const here = world.spawn();
    addInteractable(
      world,
      here,
      { affordances: [{ verb: 'use' }], anchor: [0, 1, 0] },
      {
        x: 0,
        y: 0,
        z: 0,
      },
    );
    world.step([IDLE]);
    expect(focusOf(world, actor)?.target).toBe(here);
  });

  it('AC-3: keeps focus on A while a new candidate B scores within 10%', () => {
    const { world, actor } = setup();
    const a = place(world, 1, 0); // score 1.6
    world.step([IDLE]);
    expect(focusOf(world, actor)?.target).toBe(a);

    const b = place(world, 0.9, 0); // score 1.64: 2.5% better
    world.step([IDLE]);
    expect(focusOf(world, actor)?.target).toBe(a);
    steps(world, IDLE, 10);
    expect(focusOf(world, actor)?.target).toBe(a);

    // A challenger more than 10% better takes focus.
    placeEntity(world, b, { x: 0, y: 1, z: -0.2 }, 0); // score 1.92: 20% better
    world.step([IDLE]);
    expect(focusOf(world, actor)?.target).toBe(b);
  });

  it('AC-4: a locked door shows its unavailable affordance with the reason; Interact does nothing', () => {
    const door: InteractableSpec = {
      affordances: [
        { verb: 'unlock', requires: [{ item: 'iron-key' }], reason: 'Locked — needs Iron Key' },
        { verb: 'pick-lock', hold: 2, requires: [{ capability: 'lockpicking' }] },
      ],
    };
    const { world, actor, events } = setup();
    const target = place(world, 1.5, 0, door);
    world.step([IDLE]);
    const prompt = interactionPrompt(world, actor);
    expect(prompt).toMatchObject({
      target,
      verb: 'unlock',
      label: 'Unlock',
      available: false,
      reason: 'Locked — needs Iron Key',
      hold: 0,
      progress: 0,
    });
    expect(prompt?.options).toEqual([
      { verb: 'unlock', label: 'Unlock', available: false, reason: 'Locked — needs Iron Key' },
      { verb: 'pick-lock', label: 'Pick lock', available: false, reason: 'Needs Lockpicking' },
    ]);
    world.step([PRESS]);
    steps(world, HOLD, 150);
    world.step([RELEASE]);
    expect(events).toEqual([]);
    expect(focusOf(world, actor)?.hold).toBeNull();

    // With the key it unlocks on press; a thief picks the lock instead (a 2 s hold).
    const keyed = setup({}, { items: ['iron-key'] });
    const keyedDoor = place(keyed.world, 1.5, 0, door);
    keyed.world.step([PRESS]);
    expect(keyed.events).toEqual([
      { actor: keyed.actor, target: keyedDoor, verb: 'unlock', affordance: 0 },
    ]);
    const thief = setup({}, { capabilities: ['lockpicking'] });
    place(thief.world, 1.5, 0, door);
    thief.world.step([IDLE]);
    expect(interactionPrompt(thief.world, thief.actor)).toMatchObject({
      verb: 'pick-lock',
      available: true,
      reason: '',
      hold: 2,
    });
    thief.world.step([PRESS]);
    steps(thief.world, HOLD, 119);
    expect(thief.events.map((e) => e.verb)).toEqual(['pick-lock']);
  });

  it('gates affordances on world state through added gates, in order, until they are removed', () => {
    const { world, actor, events } = setup();
    const target = place(world, 1.5, 0, { affordances: [{ verb: 'unlock' }, { verb: 'search' }] });
    const offA = addAffordanceGate(world, (_w, who, what, affordance) =>
      who === actor && what === target && affordance.verb === 'unlock' ? 'Locked.' : undefined,
    );
    const offB = addAffordanceGate(world, () => 'Busy.');
    world.step([IDLE]);
    expect(interactionPrompt(world, actor)?.options).toEqual([
      { verb: 'unlock', label: 'Unlock', available: false, reason: 'Locked.' },
      { verb: 'search', label: 'Search', available: false, reason: 'Busy.' },
    ]);
    world.step([PRESS]);
    expect(events).toEqual([]);
    offB();
    offB(); // removing twice is harmless
    expect(interactionPrompt(world, actor)).toMatchObject({ verb: 'search', available: true });
    world.step([IDLE]);
    world.step([PRESS]);
    expect(events.map((e) => e.verb)).toEqual(['search']);
    offA();
    expect(interactionPrompt(world, actor)).toMatchObject({ verb: 'unlock', available: true });
  });

  it('AC-5: releasing a 1.0 s hold at 0.8 s cancels it and fires nothing', () => {
    const { world, actor, events } = setup();
    place(world, 1, 0, { affordances: [{ verb: 'search', hold: 1 }] });
    world.step([IDLE]);
    world.step([PRESS]); // tick 1 of 60
    steps(world, HOLD, 47); // 48 ticks = 0.8 s
    expect(interactionPrompt(world, actor)?.progress).toBeCloseTo(0.8, 12);
    world.step([RELEASE]);
    expect(events).toEqual([]);
    expect(focusOf(world, actor)?.hold).toBeNull();
    expect(interactionPrompt(world, actor)?.progress).toBe(0);
    steps(world, IDLE, 30);
    expect(events).toEqual([]);

    // Held the full second, it fires once, on the 60th tick.
    world.step([PRESS]);
    steps(world, HOLD, 58);
    expect(events).toEqual([]);
    world.step([HOLD]);
    expect(events.map((e) => e.verb)).toEqual(['search']);
    steps(world, HOLD, 60);
    expect(events).toHaveLength(1);
  });

  it('cancels a hold on a tap, or when focus moves', () => {
    const { world, actor, events } = setup();
    const target = place(world, 1, 0, { affordances: [{ verb: 'search', hold: 1 }] });
    world.step([TAP]);
    expect(focusOf(world, actor)?.hold).toBeNull();
    world.step([PRESS]);
    expect(focusOf(world, actor)?.hold).toEqual({ target, affordance: 0, ticks: 1 });
    world.destroy(target);
    world.step([HOLD]);
    expect(focusOf(world, actor)).toEqual({ target: null, score: 0, hold: null });
    expect(events).toEqual([]);
  });

  it('fires an instant (or one-tick) affordance on press, once', () => {
    const { world, actor, events } = setup();
    const lever = place(world, 1, 0, { affordances: [{ verb: 'pull', hold: 0.01 }] });
    world.step([PRESS]);
    steps(world, HOLD, 5);
    expect(events).toEqual([{ actor, target: lever, verb: 'pull', affordance: 0 }]);
    expect(holdTicks({ hold: 1 }, 60)).toBe(60);
    expect(holdTicks({ hold: 0 }, 60)).toBe(0);
  });

  it('offers property-derived affordances after declared ones, never for hidden objects', () => {
    const { world, actor, events } = setup();
    const crate = world.spawn();
    addProperties(world, crate, { liftable: true, pushable: true, container: false });
    placeEntity(world, crate, { x: 0, y: 1, z: -1 }, 0.3);
    world.step([IDLE]);
    expect(interactionPrompt(world, actor)).toMatchObject({ target: crate, verb: 'pick-up' });
    expect(affordancesOf(world, crate).map((a) => a.verb)).toEqual(['pick-up', 'push']);
    world.step([PRESS]);
    expect(events).toEqual([{ actor, target: crate, verb: 'pick-up', affordance: 0 }]);

    // A declared verb replaces the derived one (here: gated).
    world.add(
      crate,
      InteractableComponent,
      interactableOf({
        affordances: [{ verb: 'pick-up', requires: [{ capability: 'strength' }] }],
      }),
    );
    expect(affordancesOf(world, crate).map((a) => a.verb)).toEqual(['pick-up', 'push']);
    world.step([IDLE]);
    expect(interactionPrompt(world, actor)).toMatchObject({ verb: 'push', available: true });

    addProperties(world, crate, { hidden: true });
    world.step([IDLE]);
    expect(focusOf(world, actor)?.target).toBeNull();
  });

  it('skips candidates without a placement, and the actor itself', () => {
    const { world, actor } = setup();
    const floating = world.spawn();
    addProperties(world, floating, { liftable: true });
    addProperties(world, actor, { liftable: true });
    placeEntity(world, actor, { x: 0, y: 1, z: 0 });
    world.step([IDLE]);
    expect(focusOf(world, actor)?.target).toBeNull();
  });

  it('does nothing without interactors, and focuses nothing for an actor with no view', () => {
    const world = registerWorldProperties(new World<ActionFrame>({ seed: 1 }));
    world.register(CharacterController, PlayerLook, PlacementComponent);
    installInteraction(world);
    place(world, 1, 0);
    world.step([PRESS]);
    const blind = world.spawn();
    addInteractor(world, blind, { capabilities: ['lockpicking'] });
    world.step([PRESS]);
    expect(world.get(blind, InteractionFocusComponent)).toEqual({
      target: null,
      score: 0,
      hold: null,
    });
    expect(playerView(world, blind)).toBeUndefined();
  });

  it('takes the view and the Interact button from options', () => {
    const { world, actor, events } = setup({
      view: () => ({ origin: { x: 0, y: 1, z: 0 }, yaw: Math.PI }), // facing +z
      input: () => actionButton(true, true, false),
      settings: { range: 4 },
    });
    const behind = place(world, 3, 180);
    world.step([]);
    expect(events).toEqual([{ actor, target: behind, verb: 'pull', affordance: 0 }]);
  });

  it('uses a per-object range', () => {
    const { world, actor } = setup();
    const far = place(world, 3, 0, { affordances: [{ verb: 'talk' }], range: 3.5 });
    world.step([IDLE]);
    expect(focusOf(world, actor)?.target).toBe(far);
  });

  it('has no prompt without a focus, for a destroyed focus, or for an object with no affordances', () => {
    const { world, actor } = setup();
    expect(interactionPrompt(world, actor)).toBeUndefined();
    const bare = place(world, 1, 0, { affordances: [] });
    world.step([IDLE]);
    expect(focusOf(world, actor)?.target).toBe(bare);
    expect(interactionPrompt(world, actor)).toBeUndefined();
    place(world, 0.5, 0, { affordances: [{ verb: 'read', requires: [{ item: 'lens' }] }] });
    world.step([IDLE]);
    world.remove(actor, InteractorComponent); // a focus without a kit reads as carrying nothing
    expect(interactionPrompt(world, actor)).toMatchObject({ verb: 'read', reason: 'Needs Lens' });
    world.destroy(focusOf(world, actor)?.target ?? 0);
    expect(interactionPrompt(world, actor)).toBeUndefined();
    expect(interactionPrompt(world, world.spawn())).toBeUndefined();
  });

  it('validates interactables and adds the ones scene spawns declare', () => {
    expect(() => interactableOf({ affordances: [], range: 0 })).toThrow(/range/);
    expect(() => interactableOf({ affordances: [], range: Number.NaN })).toThrow(/range/);
    expect(interactableOf({ affordances: [{ verb: 'use' }] })).toEqual({
      affordances: [{ verb: 'use', label: 'Use', hold: 0, requires: [], reason: '' }],
      range: null,
    });
    const { world } = setup();
    const lever = world.spawn();
    const marker = world.spawn();
    const added = addSceneInteractables(world, [
      {
        entity: lever,
        spawn: {
          position: { x: 1, y: 0, z: 2 },
          interact: { affordances: [{ verb: 'pull' }], anchor: [0, 0.5, 0], radius: 0.2, range: 2 },
        },
      },
      { entity: marker, spawn: { position: { x: 0, y: 0, z: 0 }, interact: undefined } },
    ]);
    expect(added).toEqual([lever]);
    expect(world.get(lever, PlacementComponent)).toEqual({ x: 1, y: 0.5, z: 2, radius: 0.2 });
    expect(world.get(lever, InteractableComponent)?.range).toBe(2);
    expect(world.has(marker, InteractableComponent)).toBe(false);
    const plain = world.spawn();
    addInteractable(world, plain, { affordances: [{ verb: 'use' }] }, { x: 0, y: 0, z: 0 });
    expect(world.get(plain, PlacementComponent)).toEqual({ x: 0, y: 1, z: 0, radius: 0 });
  });

  it("reads an entity's own physics colliders for the reach test", () => {
    const world = new World({ seed: 1 }).register(PhysicsObjectComponent, PhysicsColliderComponent);
    const crate = world.spawn();
    const wall = world.spawn();
    const both = world.spawn();
    const pose = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
    const body = (handle: number) => ({
      body: handle,
      shape: { kind: 'sphere' as const, radius: 0.3 },
      ...pose,
      sleeping: false,
      awakeSince: 0,
    });
    world.add(crate, PhysicsObjectComponent, body(7));
    world.add(wall, PhysicsColliderComponent, { colliders: [3, 4] });
    world.add(both, PhysicsObjectComponent, body(8));
    world.add(both, PhysicsColliderComponent, { colliders: [9] });
    expect(physicsBodiesOf(world, crate)).toEqual([7]);
    expect(physicsBodiesOf(world, wall)).toEqual([3, 4]);
    expect(physicsBodiesOf(world, both)).toEqual([8, 9]);
    expect(physicsBodiesOf(world, world.spawn())).toEqual([]);
  });
});

describe('interactRemotely (mw-e08.10)', () => {
  it('fires the primary usable affordance exactly as a direct interaction does', () => {
    const { world, actor, events } = setup();
    const lever = place(world, 12, 0, {
      affordances: [{ verb: 'unlock', requires: [{ item: 'key' }] }, { verb: 'pull' }],
    });
    expect(interactRemotely(world, actor, lever)).toEqual({
      actor,
      target: lever,
      verb: 'pull',
      affordance: 1,
    });
    world.step([IDLE]);
    expect(events).toEqual([{ actor, target: lever, verb: 'pull', affordance: 1 }]);
  });

  it('the actor kit and the gates still apply', () => {
    const { world, actor, events } = setup({}, { items: ['key'] });
    const door = place(world, 5, 0, {
      affordances: [{ verb: 'unlock', requires: [{ item: 'key' }] }],
    });
    addAffordanceGate(world, () => 'jammed');
    expect(interactRemotely(world, actor, door)).toBeUndefined();
    world.step([IDLE]);
    expect(events).toEqual([]);
  });

  it('does nothing for a hidden object, and an actor with no kit has the empty one', () => {
    const { world, events } = setup();
    const stranger = world.spawn();
    const lever = place(world, 5, 0);
    expect(interactRemotely(world, stranger, lever)?.verb).toBe('pull');
    addProperties(world, lever, { hidden: true });
    expect(interactRemotely(world, stranger, lever)).toBeUndefined();
    world.step([IDLE]);
    expect(events).toHaveLength(1);
  });
});
