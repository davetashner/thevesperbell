// Hiding in wardrobes, barrels and haystacks (mw-e03.23): getting in and out, concealment, ejection
// by fire, breakage and water, blocked exits, input while inside, and everything that must never trap
// or strand the player.
import { describe, expect, it } from 'vitest';
import { initialCharacterState, SKIN } from '../character/controller';
import { FakeCollisionWorld } from '../character/fake-collision-world';
import { box } from '../character/greybox';
import { CharacterController } from '../character/system';
import { Died } from '../combat/damage/events';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import { breakableBroken } from '../breakables/events';
import { fireIgnited } from '../elements/fire';
import { holdOf } from '../carry/state';
import { CarryLedgerComponent } from '../carry/state';
import {
  actionButton,
  actionFrame,
  actionVector,
  type ActionFrame,
  type ButtonAction,
} from '../input/action-frame';
import {
  addInteractable,
  addInteractor,
  affordancesOf,
  installInteraction,
  interacted,
  interactionPrompt,
  InteractionFocusComponent,
} from '../interaction/system';
import { liquidEntered } from '../liquids/volumes';
import { noiseEmitted, type NoiseEvent } from '../noise/events';
import { PhysicsObjectComponent } from '../physics/objects';
import { PlayerLook } from '../player/player';
import { addProperties, registerWorldProperties } from '../properties/components';
import { registerSceneComponents } from '../scene/loader';
import { placementOf, placeEntity } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { installStimuli, pendingStimuli } from '../stimulus/stimulus';
import {
  addSceneHidingSpots,
  Hiding,
  hidingOf,
  hidingSpotOf,
  hiddenFrame,
  installHiding,
  makeHidingSpot,
  settleHidden,
  PEEK_PITCH_ARC,
  PEEK_YAW_ARC,
  type HidingSpotSpec,
} from './hiding';
import {
  concealmentOf,
  HiddenComponent,
  hiddenOf,
  hidingEjected,
  hidingEntered,
  hidingLeft,
  hidingRefused,
  HidingSpotComponent,
  HIDE_ENTER_NOISE,
  HIDE_EXIT_NOISE,
  insidePoint,
  isHidden,
  isOccupied,
  occupantsOf,
  peekOf,
  spotOf,
  spotPoint,
  type HidingEjected,
  type HidingEntered,
  type HidingLeft,
  type HidingRefused,
} from './state';

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const IDLE = frameOf({});

type Spec = Partial<Record<ButtonAction, 'press' | 'hold'>>;

function frameOf(spec: Spec, look = actionVector(0, 0), move = actionVector(0, 0)): ActionFrame {
  return actionFrame({
    move,
    look,
    buttons: (action) => {
      const s = spec[action];
      return actionButton(s === 'press', s === 'press' || s === 'hold', false);
    },
  });
}

interface Setup {
  readonly world: World<ActionFrame>;
  readonly sim: World<never>;
  readonly hiding: Hiding;
  readonly player: EntityId;
  readonly spot: EntityId;
  readonly noises: NoiseEvent[];
  readonly entered: HidingEntered[];
  readonly left: HidingLeft[];
  readonly ejected: HidingEjected[];
  readonly refused: HidingRefused[];
}

/** A spot at (0, 0, 0) opening towards −z, a player standing 2 m in front of it. */
function setup(
  options: {
    spot?: Partial<HidingSpotSpec>;
    collision?: FakeCollisionWorld;
    player?: boolean;
  } = {},
): Setup {
  const world = installStimuli(
    registerWorldProperties(registerSceneComponents(new World<ActionFrame>({ seed: 3 }))),
  );
  world.register(CharacterController, PlayerLook);
  const sim = world as unknown as World<never>;
  installInteraction(world);
  const { hiding } = installHiding(world, {
    ...(options.collision !== undefined && { collision: options.collision }),
  });
  const player = world.spawn();
  world.add(player, CharacterController, {
    ...initialCharacterState(v(0, 0, -2)),
    grounded: true,
  });
  world.add(player, PlayerLook, { yaw: 0, pitch: 0 });
  addInteractor(sim, player);
  const spot = world.spawn();
  makeHidingSpot(sim, spot, { origin: v(0, 0, 0), yaw: 0, ...options.spot });
  world.step([IDLE]);
  const noises: NoiseEvent[] = [];
  const entered: HidingEntered[] = [];
  const left: HidingLeft[] = [];
  const ejected: HidingEjected[] = [];
  const refused: HidingRefused[] = [];
  world.events.on(noiseEmitted, (e) => noises.push(e));
  world.events.on(hidingEntered, (e) => entered.push(e));
  world.events.on(hidingLeft, (e) => left.push(e));
  world.events.on(hidingEjected, (e) => ejected.push(e));
  world.events.on(hidingRefused, (e) => refused.push(e));
  return { world, sim, hiding, player, spot, noises, entered, left, ejected, refused };
}

/** Where `entity` stands on the floor: its feet less the skin it hovers on. */
const floorOf = (s: Setup, entity = s.player): Vec3 => {
  const { x, y, z } = feetOf(s, entity);
  return v(x, Number((y - SKIN).toFixed(9)), z);
};

/** Delivers the events emitted outside a step. */
const flush = (s: Setup): void => {
  s.world.events.flush();
};

const feetOf = (s: Setup, entity = s.player): Vec3 => {
  const state = s.world.get(entity, CharacterController);
  if (state === undefined) throw new Error('no controller');
  return state.position;
};

/** A second actor with a controller, grounded, standing at `at`. */
function actor(s: Setup, at = v(3, 0, 3)): EntityId {
  const other = s.world.spawn();
  s.world.add(other, CharacterController, { ...initialCharacterState(at), grounded: true });
  s.world.step([IDLE]);
  return other;
}

describe('hiding spots (mw-e03.23)', () => {
  it('AC-1: a spot with capacity 1 flags the player hidden with its concealment, and a second actor cannot enter', () => {
    const s = setup({ spot: { capacity: 1, concealment: 0.8 } });
    expect(s.hiding.enter(s.sim, s.player, s.spot)).toEqual({ ok: true });
    expect(hiddenOf(s.sim, s.player)).toMatchObject({ spot: s.spot, concealment: 0.8 });
    expect(isHidden(s.sim, s.player)).toBe(true);
    expect(concealmentOf(s.sim, s.player)).toBe(0.8);
    expect(isOccupied(s.sim, s.spot)).toBe(true);
    expect(occupantsOf(s.sim, s.spot)).toEqual([s.player]);
    flush(s);
    expect(s.entered).toMatchObject([{ actor: s.player, spot: s.spot, concealment: 0.8 }]);
    const other = actor(s);
    expect(s.hiding.enter(s.sim, other, s.spot)).toEqual({ ok: false, reason: 'full' });
    expect(isHidden(s.sim, other)).toBe(false);
    flush(s);
    expect(s.refused).toMatchObject([{ actor: other, action: 'enter', reason: 'full' }]);
    expect(occupantsOf(s.sim, s.spot)).toEqual([s.player]);
  });

  it('AC-1: a spot with room takes a second actor', () => {
    const s = setup({ spot: { capacity: 2 } });
    const other = actor(s);
    s.hiding.enter(s.sim, s.player, s.spot);
    expect(s.hiding.enter(s.sim, other, s.spot).ok).toBe(true);
    s.world.step([IDLE]); // the player's look is held; the other has none to hold
    expect(occupantsOf(s.sim, s.spot)).toEqual([s.player, other]);
  });

  it('the player is moved inside, stopped, and turned to the opening', () => {
    const s = setup({ spot: { inside: v(0.1, 0, 0.2), yaw: 0 } });
    s.world.set(s.player, PlayerLook, { yaw: 2, pitch: 0.4 });
    s.world.step([IDLE]);
    s.hiding.enter(s.sim, s.player, s.spot);
    const state = s.world.get(s.player, CharacterController);
    expect(floorOf(s)).toEqual(insidePoint(spotOf(s.sim, s.spot) as never));
    expect(state?.velocity).toEqual(v(0, 0, 0));
    expect(s.world.get(s.player, PlayerLook)).toEqual({ yaw: 0, pitch: 0 });
  });

  it('getting in and out makes the spot’s noise', () => {
    const s = setup({ spot: { enterDb: 33, exitDb: 21 } });
    s.hiding.enter(s.sim, s.player, s.spot);
    s.hiding.leave(s.sim, s.player);
    flush(s);
    const [inNoise, outNoise] = s.noises;
    expect(inNoise).toMatchObject({
      kind: HIDE_ENTER_NOISE,
      loudness: 33,
      entity: s.spot,
      source: s.player,
    });
    expect(outNoise).toMatchObject({ kind: HIDE_EXIT_NOISE, loudness: 21, source: s.player });
  });

  it('refuses when already hidden, burning, hands full or busy', () => {
    const s = setup({ spot: { capacity: 3 } });
    const second = s.world.spawn();
    makeHidingSpot(s.sim, second, { origin: v(5, 0, 0) });
    s.world.step([IDLE]);
    s.hiding.enter(s.sim, s.player, s.spot);
    expect(s.hiding.enter(s.sim, s.player, second)).toEqual({
      ok: false,
      reason: 'already-hidden',
    });

    const burning = s.world.spawn();
    makeHidingSpot(s.sim, burning, { origin: v(8, 0, 0) });
    addProperties(s.sim, burning, { burning: true });
    s.world.step([IDLE]);
    const other = actor(s);
    expect(s.hiding.enter(s.sim, other, burning)).toEqual({ ok: false, reason: 'burning' });

    const climber = actor(s);
    s.world.set(climber, CharacterController, {
      ...initialCharacterState(v(3, 0, 3)),
      grounded: true,
      traversal: 'climb',
    });
    expect(s.hiding.enter(s.sim, climber, second)).toEqual({ ok: false, reason: 'busy' });
    const falling = actor(s);
    s.world.set(falling, CharacterController, initialCharacterState(v(3, 0, 3)));
    expect(s.hiding.enter(s.sim, falling, second)).toEqual({ ok: false, reason: 'busy' });

    const notASpot = s.world.spawn();
    expect(s.hiding.enter(s.sim, other, notASpot)).toEqual({ ok: false, reason: 'not-a-spot' });
  });

  it('the rules need nothing but spots: no controllers, looks, placements or properties', () => {
    const world = new World<never>({ seed: 1 });
    const { hiding } = installHiding(world);
    const spot = world.spawn();
    makeHidingSpot(world, spot, { origin: v(0, 0, 0) });
    const guard = world.spawn();
    world.step([]);
    expect(hiding.enter(world, guard, spot).ok).toBe(true);
    world.step([]);
    expect(hiding.leave(world, guard).ok).toBe(true);
    hiding.enter(world, guard, spot);
    expect(hiding.eject(world, spot, 'broken')).toEqual([guard]);
    expect(isHidden(world, guard)).toBe(false);
  });

  it('other verbs on a spot are left to whoever owns them', () => {
    const s = setup();
    addProperties(s.sim, s.spot, { container: true });
    s.world.step([IDLE]);
    s.world.set(s.player, InteractionFocusComponent, { target: s.spot, score: 1, hold: null });
    expect(
      interactionPrompt(s.sim, s.player)?.options.find((o) => o.verb === 'search'),
    ).toMatchObject({ available: true });
  });

  it('Leave on something that is not a spot reads "Nowhere to hide"', () => {
    const s = setup();
    const door = s.world.spawn();
    addInteractable(
      s.sim,
      door,
      { affordances: [{ verb: 'leave' }], anchor: [0, 0, 0], radius: 0.5 },
      v(0, 0, -2),
    );
    s.world.step([IDLE]);
    s.world.set(s.player, InteractionFocusComponent, { target: door, score: 1, hold: null });
    expect(interactionPrompt(s.sim, s.player)).toMatchObject({
      verb: 'leave',
      available: false,
      reason: 'Nowhere to hide',
    });
  });

  it('exits as near as each other are tried in the order they are listed', () => {
    const s = setup({ spot: { exits: [v(0.7, 0, 0.5), v(-0.7, 0, 0.5)] } });
    s.hiding.enter(s.sim, s.player, s.spot);
    s.hiding.ejectActor(s.sim, s.player, 'broken');
    expect(floorOf(s)).toEqual(spotPoint(spotOf(s.sim, s.spot) as never, v(0.7, 0, 0.5)));
  });

  it('hands full: an actor carrying something cannot get in', () => {
    const s = setup();
    const crate = s.world.spawn();
    s.world.register(CarryLedgerComponent);
    const ledger = s.world.spawn();
    s.world.add(ledger, CarryLedgerComponent, {
      holds: [
        {
          actor: s.player,
          target: crate,
          mode: 'hand',
          since: 0,
          speedScale: 0.85,
          noJump: false,
          charge: -1,
          burning: 0,
        },
      ],
    });
    s.world.step([IDLE]);
    expect(holdOf(s.sim, s.player)).toBeDefined();
    expect(s.hiding.enter(s.sim, s.player, s.spot)).toEqual({ ok: false, reason: 'hands-full' });
  });

  it('an actor with no controller hides by flag and placement', () => {
    const s = setup();
    const guard = s.world.spawn();
    placeEntity(s.sim, guard, v(4, 0, 4), 0.3);
    s.world.step([IDLE]);
    expect(s.hiding.enter(s.sim, guard, s.spot).ok).toBe(true);
    expect(placementOf(s.sim, guard)).toMatchObject({ x: 0, z: 0 });
    expect(hiddenOf(s.sim, guard)?.from).toEqual(v(4, 0, 4));
    s.world.step([IDLE]);
    expect(s.hiding.leave(s.sim, guard).ok).toBe(true);
    const bare = s.world.spawn();
    s.world.step([IDLE]);
    expect(s.hiding.enter(s.sim, bare, s.spot).ok).toBe(true);
    expect(hiddenOf(s.sim, bare)?.from).toEqual(v(0, 0, 0));
  });

  it('leave steps to the first free exit, with noise, and frees the place', () => {
    const s = setup();
    s.hiding.enter(s.sim, s.player, s.spot);
    expect(s.hiding.leave(s.sim, s.player)).toEqual({ ok: true });
    expect(isHidden(s.sim, s.player)).toBe(false);
    expect(isOccupied(s.sim, s.spot)).toBe(false);
    // The default exit is 0.9 m out of an opening that faces −z.
    expect(floorOf(s)).toEqual(v(0, 0, -0.9));
    flush(s);
    expect(s.left).toMatchObject([{ actor: s.player, spot: s.spot, to: v(0, 0, -0.9) }]);
    expect(hiddenOf(s.sim, s.player)).toBeUndefined();
  });

  it('leave when not hiding is refused', () => {
    const s = setup();
    expect(s.hiding.leave(s.sim, s.player)).toEqual({ ok: false, reason: 'not-inside' });
  });

  it('an exit that is blocked is skipped for the next free one', () => {
    const wall = new FakeCollisionWorld([box(v(-0.3, 0, -1.3), v(0.3, 2, -0.5))]);
    const s = setup({
      collision: wall,
      spot: { exits: [v(0, 0, 0.9), v(1, 0, 0.9)] },
    });
    s.hiding.enter(s.sim, s.player, s.spot);
    expect(s.hiding.leave(s.sim, s.player).ok).toBe(true);
    expect(floorOf(s)).toEqual(v(1, 0, -0.9));
  });

  it('AC-4: with every exit blocked, leaving is refused with "Blocked" and the player stays hidden', () => {
    const wall = new FakeCollisionWorld([box(v(-3, 0, -3), v(3, 2, -0.5))]);
    const s = setup({ collision: wall });
    s.hiding.enter(s.sim, s.player, s.spot);
    s.world.step([frameOf({})]);
    expect(s.hiding.leave(s.sim, s.player)).toEqual({ ok: false, reason: 'blocked' });
    expect(isHidden(s.sim, s.player)).toBe(true);
    flush(s);
    expect(s.refused).toMatchObject([{ actor: s.player, action: 'leave', reason: 'blocked' }]);
    // The prompt reads the reason and offers nothing to press.
    s.world.step([IDLE]);
    s.world.set(s.player, InteractionFocusComponent, { target: s.spot, score: 1, hold: null });
    expect(interactionPrompt(s.sim, s.player)).toMatchObject({
      verb: 'leave',
      label: 'Leave',
      available: false,
      reason: 'Blocked',
    });
    // Pressing Interact does nothing, and nothing traps or frees them by accident.
    for (let i = 0; i < 5; i++) s.world.step([frameOf({ interact: 'press' })]);
    expect(isHidden(s.sim, s.player)).toBe(true);
  });

  it('a spot whose exits are free prompts Leave to the occupant and Hide to everyone else', () => {
    const s = setup();
    const prompt = () => interactionPrompt(s.sim, s.player);
    s.world.set(s.player, InteractionFocusComponent, { target: s.spot, score: 1, hold: null });
    expect(prompt()).toMatchObject({ verb: 'hide', label: 'Hide', available: true });
    s.hiding.enter(s.sim, s.player, s.spot);
    s.world.step([IDLE]);
    s.world.set(s.player, InteractionFocusComponent, { target: s.spot, score: 1, hold: null });
    expect(prompt()).toMatchObject({ verb: 'leave', label: 'Leave', available: true });
  });

  it('a full spot reads "Occupied" to anyone outside', () => {
    const s = setup();
    const other = actor(s);
    addInteractor(s.sim, other);
    s.world.step([IDLE]);
    s.hiding.enter(s.sim, s.player, s.spot);
    s.world.step([IDLE]);
    s.world.set(other, InteractionFocusComponent, { target: s.spot, score: 1, hold: null });
    expect(interactionPrompt(s.sim, other)).toMatchObject({
      verb: 'leave',
      available: false,
      reason: 'Occupied',
    });
    const room = setup({ spot: { capacity: 2 } });
    const third = actor(room);
    addInteractor(room.sim, third);
    room.world.step([IDLE]);
    room.world.set(third, InteractionFocusComponent, { target: room.spot, score: 1, hold: null });
    expect(
      interactionPrompt(room.sim, third)?.options.find((o) => o.verb === 'leave'),
    ).toMatchObject({ available: false, reason: 'Not hiding' });
  });

  it('Hide on something with no hiding spot reads "Nowhere to hide"', () => {
    const s = setup();
    const hay = s.world.spawn();
    addProperties(s.sim, hay, { hideable: true });
    placeEntity(s.sim, hay, v(1, 0, -2), 0.5);
    s.world.step([IDLE]);
    s.world.set(s.player, InteractionFocusComponent, { target: hay, score: 1, hold: null });
    expect(interactionPrompt(s.sim, s.player)).toMatchObject({
      verb: 'hide',
      available: false,
      reason: 'Nowhere to hide',
    });
    expect(affordancesOf(s.sim, hay).map((a) => a.verb)).toEqual(['hide']);
    // Interacting with it does nothing.
    s.world.events.emit(interacted, { actor: s.player, target: hay, verb: 'hide', affordance: 0 });
    s.world.step([IDLE]);
    expect(isHidden(s.sim, s.player)).toBe(false);
  });

  it('Interact on a spot hides, Interact inside leaves (through the interaction system)', () => {
    const s = setup();
    s.world.set(s.player, InteractionFocusComponent, { target: s.spot, score: 1, hold: null });
    s.world.events.emit(interacted, {
      actor: s.player,
      target: s.spot,
      verb: 'hide',
      affordance: 1,
    });
    s.world.step([IDLE]);
    expect(isHidden(s.sim, s.player)).toBe(true);
    s.world.events.emit(interacted, {
      actor: s.player,
      target: s.spot,
      verb: 'leave',
      affordance: 0,
    });
    s.world.step([IDLE]);
    expect(isHidden(s.sim, s.player)).toBe(false);
    // Other verbs are not ours.
    s.world.events.emit(interacted, {
      actor: s.player,
      target: s.spot,
      verb: 'use',
      affordance: 0,
    });
    s.world.step([IDLE]);
    expect(isHidden(s.sim, s.player)).toBe(false);
  });

  it('a spot being used cannot be lifted or pushed (the gate)', () => {
    const s = setup();
    addProperties(s.sim, s.spot, { liftable: true, pushable: true });
    s.world.step([IDLE]);
    const options = () =>
      interactionPrompt(s.sim, s.player)?.options.filter((o) =>
        ['pick-up', 'push'].includes(o.verb),
      );
    s.world.set(s.player, InteractionFocusComponent, { target: s.spot, score: 1, hold: null });
    expect(options()).toMatchObject([{ available: true }, { available: true }]);
    const other = actor(s);
    s.hiding.enter(s.sim, other, s.spot);
    s.world.step([IDLE]);
    s.world.set(s.player, InteractionFocusComponent, { target: s.spot, score: 1, hold: null });
    expect(options()).toMatchObject([
      { available: false, reason: 'Occupied' },
      { available: false, reason: 'Occupied' },
    ]);
  });
});

describe('ejection (mw-e03.23)', () => {
  it('AC-2: a spot that ignites throws the player out to the nearest free exit that tick, with heat', () => {
    const s = setup({
      spot: { exits: [v(0, 0, 0.9), v(0.7, 0, 0.2), v(-1.5, 0, 0)] },
    });
    s.hiding.enter(s.sim, s.player, s.spot);
    const tick = s.world.tick;
    s.world.events.emit(fireIgnited, { entity: s.spot });
    s.world.step([IDLE]);
    expect(isHidden(s.sim, s.player)).toBe(false);
    expect(isOccupied(s.sim, s.spot)).toBe(false);
    // Nearest to where they sat (the origin): (0.7, 0, 0.2) in the frame is right of the opening, out 0.2.
    const out = spotPoint(spotOf(s.sim, s.spot) as never, v(0.7, 0, 0.2));
    expect(floorOf(s)).toEqual(out);
    expect(s.ejected).toMatchObject([
      { actor: s.player, spot: s.spot, cause: 'burning', to: out, free: true, heat: 60 },
    ]);
    expect(s.ejected[0]?.tick).toBeGreaterThanOrEqual(tick);
    const heat = pendingStimuli(s.sim).filter((p) => p.stimulus.element === 'heat');
    expect(heat).toHaveLength(1);
    expect(heat[0]?.stimulus).toMatchObject({
      shape: { kind: 'contact', target: s.player },
      intensity: 60,
      source: s.spot,
    });
  });

  it('AC-2: a spot that breaks throws the player out on that tick, without heat unless it burns', () => {
    const s = setup();
    s.hiding.enter(s.sim, s.player, s.spot);
    s.world.events.emit(breakableBroken, {
      tick: 0,
      entity: s.spot,
      profile: 'x',
      material: 'wood',
      cause: 'impact',
      by: 'collision',
      source: null,
      position: v(0, 0, 0),
      cleared: { min: v(0, 0, 0), max: v(1, 1, 1) },
      debris: [],
      spilled: [],
      reveals: null,
      loudness: 70,
    });
    s.world.step([IDLE]);
    expect(isHidden(s.sim, s.player)).toBe(false);
    expect(s.ejected).toMatchObject([{ cause: 'broken', heat: 0 }]);
    expect(pendingStimuli(s.sim)).toHaveLength(0);
  });

  it('AC-2: a burning spot that breaks still heats whoever is inside', () => {
    const s = setup();
    s.hiding.enter(s.sim, s.player, s.spot);
    addProperties(s.sim, s.spot, { burning: true });
    s.world.step([IDLE]);
    s.hiding.ejectActor(s.sim, s.player, 'broken');
    flush(s);
    expect(s.ejected[0]?.heat).toBe(60);
  });

  it('a spot that goes under, and an occupant that goes under, throw the occupant out', () => {
    const s = setup();
    s.hiding.enter(s.sim, s.player, s.spot);
    s.world.events.emit(liquidEntered, { entity: s.spot, volume: 99 });
    s.world.step([IDLE]);
    expect(s.ejected).toMatchObject([{ cause: 'submerged' }]);
    s.hiding.enter(s.sim, s.player, s.spot);
    s.world.events.emit(liquidEntered, { entity: s.player, volume: 99 });
    s.world.step([IDLE]);
    expect(s.ejected).toHaveLength(2);
    // Anything else going under is nothing to us.
    s.world.events.emit(liquidEntered, { entity: s.world.spawn(), volume: 99 });
    s.world.step([IDLE]);
    expect(s.ejected).toHaveLength(2);
  });

  it('when every exit is blocked ejection still gets them out, by the nearest, saying it was not free', () => {
    const wall = new FakeCollisionWorld([box(v(-3, 0, -3), v(3, 2, -0.5))]);
    const s = setup({ collision: wall });
    s.hiding.enter(s.sim, s.player, s.spot);
    s.world.events.emit(fireIgnited, { entity: s.spot });
    s.world.step([IDLE]);
    expect(isHidden(s.sim, s.player)).toBe(false);
    expect(s.ejected).toMatchObject([{ free: false, to: v(0, 0, -0.9) }]);
  });

  it('death inside lets the dead go and keeps the others hidden', () => {
    const s = setup({ spot: { capacity: 2 } });
    const other = actor(s);
    s.hiding.enter(s.sim, s.player, s.spot);
    s.hiding.enter(s.sim, other, s.spot);
    s.world.events.emit(Died, {
      tick: 1,
      target: s.player,
      killer: null,
      source: null,
      tags: [],
    });
    s.world.step([IDLE]);
    expect(isHidden(s.sim, s.player)).toBe(false);
    expect(isHidden(s.sim, other)).toBe(true);
    expect(s.ejected).toMatchObject([{ actor: s.player, cause: 'died' }]);
    expect(occupantsOf(s.sim, s.spot)).toEqual([other]);
    // The living are not hurt by a death elsewhere.
    s.world.events.emit(Died, {
      tick: 2,
      target: s.world.spawn(),
      killer: null,
      source: null,
      tags: [],
    });
    s.world.step([IDLE]);
    expect(isHidden(s.sim, other)).toBe(true);
  });

  it('ejecting an empty or unknown spot does nothing', () => {
    const s = setup();
    expect(s.hiding.eject(s.sim, s.spot, 'broken')).toEqual([]);
    expect(s.hiding.eject(s.sim, s.world.spawn(), 'broken')).toEqual([]);
    s.hiding.ejectActor(s.sim, s.player, 'died');
    expect(s.ejected).toEqual([]);
  });

  it('a spot that vanishes while occupied puts the occupant back where they were', () => {
    const s = setup();
    s.hiding.enter(s.sim, s.player, s.spot);
    s.world.destroy(s.spot);
    s.world.step([IDLE]);
    s.world.step([IDLE]);
    expect(isHidden(s.sim, s.player)).toBe(false);
    expect(feetOf(s)).toEqual(v(0, 0, -2));
    expect(s.ejected).toMatchObject([{ cause: 'gone', to: v(0, 0, -2) }]);
  });

  it('leave on a hidden actor whose spot is gone puts them back and says so', () => {
    const s = setup();
    const ghost = s.world.spawn();
    s.world.add(s.player, HiddenComponent, {
      spot: ghost,
      concealment: 1,
      since: 0,
      from: v(7, 0, 7),
    });
    expect(s.hiding.leave(s.sim, s.player)).toEqual({ ok: true });
    expect(feetOf(s)).toEqual(v(7, 0, 7));
    flush(s);
    expect(s.ejected).toMatchObject([{ cause: 'gone' }]);
  });

  it('a save never stores a hide: settleHidden puts the player at an exit', () => {
    const s = setup();
    s.hiding.enter(s.sim, s.player, s.spot);
    settleHidden(s.sim);
    expect(isHidden(s.sim, s.player)).toBe(false);
    expect(floorOf(s)).toEqual(v(0, 0, -0.9));
    // Nothing hides: nothing to do. Nor in a world without hiding.
    settleHidden(s.sim);
    settleHidden(new World<never>({ seed: 1 }));
    expect(hidingOf(s.sim)).toBe(s.hiding);
    const bare = new Hiding();
    bare.settleAll(new World<never>({ seed: 1 }));
  });
});

describe('inside a spot (mw-e03.23)', () => {
  const MOVE = actionVector(0, 1);

  it('movement, attacks, casts and everything but look and Interact are cut', () => {
    const s = setup();
    s.hiding.enter(s.sim, s.player, s.spot);
    const seen: ActionFrame[] = [];
    s.world.addSystem({
      name: 'probe',
      run: ({ inputs }) => {
        for (const input of inputs) seen.push(input);
      },
    });
    const everything: Spec = {
      jump: 'press',
      sprint: 'hold',
      crouch: 'hold',
      dodge: 'press',
      primaryAttack: 'press',
      secondaryAttack: 'press',
      cast: 'press',
      kick: 'press',
      drop: 'press',
      throw: 'press',
      ability1: 'press',
      interact: 'press',
      inventory: 'press',
      pause: 'press',
    };
    s.world.step([frameOf(everything, actionVector(3, -2), MOVE)]);
    const [got] = seen;
    expect(got?.move).toEqual(actionVector(0, 0));
    expect(got?.look).toEqual(actionVector(3, -2));
    for (const action of Object.keys(everything) as ButtonAction[]) {
      const kept = ['interact', 'inventory', 'pause'].includes(action);
      expect(got?.[action].pressed, action).toBe(kept);
    }
    // Other inputs (debug commands) are not touched.
    s.world.step([{ kind: 'debug' } as never]);
    expect(seen.at(-1)).toEqual({ kind: 'debug' });
  });

  it('a player outside, and a world with nobody hidden, see their frames untouched', () => {
    const s = setup();
    const seen: ActionFrame[] = [];
    s.world.addSystem({
      name: 'probe',
      run: ({ inputs }) => {
        for (const input of inputs) seen.push(input);
      },
    });
    const run = frameOf({ jump: 'press' }, actionVector(0, 0), MOVE);
    s.world.step([run]);
    expect(seen[0]).toBe(run);
    // Only whoever has a look (the player) is cut: a guard hiding does not stop the player's input.
    const guard = s.world.spawn();
    s.hiding.enter(s.sim, guard, s.spot);
    s.world.step([run]);
    expect(seen[1]).toBe(run);
  });

  it('hiddenFrame keeps the frozen frame shape', () => {
    const frame = hiddenFrame(frameOf({ jump: 'press' }, actionVector(1, 1), MOVE));
    expect(frame.kind).toBe('input.actions');
    expect(Object.isFrozen(frame)).toBe(true);
  });

  it('the player is held where they sit: no gravity, no depenetration, no drift', () => {
    const wall = new FakeCollisionWorld([box(v(-2, -1, -2), v(2, 0, 2))]);
    const s = setup({ collision: wall });
    s.hiding.enter(s.sim, s.player, s.spot);
    const at = feetOf(s);
    for (let i = 0; i < 20; i++)
      s.world.step([frameOf({ jump: 'hold' }, actionVector(0, 0), MOVE)]);
    expect(feetOf(s)).toEqual(at);
  });

  it('the look is held to the opening’s arc, and pitch to its limits', () => {
    const s = setup();
    s.hiding.enter(s.sim, s.player, s.spot);
    s.world.set(s.player, PlayerLook, { yaw: 3, pitch: 1.5 });
    s.world.step([IDLE]);
    const look = s.world.get(s.player, PlayerLook);
    expect(look?.pitch).toBe(PEEK_PITCH_ARC);
    expect(Math.abs((look?.yaw ?? 0) - 0)).toBeCloseTo(PEEK_YAW_ARC, 9);
    s.world.set(s.player, PlayerLook, { yaw: -0.5, pitch: -2 });
    s.world.step([IDLE]);
    expect(s.world.get(s.player, PlayerLook)).toEqual({ yaw: -0.5, pitch: -PEEK_PITCH_ARC });
    s.world.set(s.player, PlayerLook, { yaw: 5, pitch: 0 }); // wraps: 5 rad is −1.28
    s.world.step([IDLE]);
    expect(Math.abs(s.world.get(s.player, PlayerLook)?.yaw ?? 0)).toBeLessThanOrEqual(
      PEEK_YAW_ARC + 1e-9,
    );
    s.world.set(s.player, PlayerLook, { yaw: -5, pitch: 0 });
    s.world.step([IDLE]);
    expect(Math.abs(s.world.get(s.player, PlayerLook)?.yaw ?? 0)).toBeLessThanOrEqual(
      PEEK_YAW_ARC + 1e-9,
    );
  });

  it('a spot that does not allow peeking fixes the look on the opening', () => {
    const s = setup({ spot: { peek: false } });
    s.hiding.enter(s.sim, s.player, s.spot);
    s.world.set(s.player, PlayerLook, { yaw: 1, pitch: 0 });
    s.world.step([IDLE]);
    expect(s.world.get(s.player, PlayerLook)?.yaw).toBe(0);
    expect(peekOf(s.sim, s.player)).toMatchObject({ peek: false, yaw: 0 });
  });

  it('the peek view is the spot’s eye, and nothing for someone who is not hiding', () => {
    const s = setup({ spot: { eye: v(0, 1.4, 0.3) } });
    expect(peekOf(s.sim, s.player)).toBeUndefined();
    s.hiding.enter(s.sim, s.player, s.spot);
    expect(peekOf(s.sim, s.player)).toEqual({ eye: v(0, 1.4, -0.3), yaw: 0, peek: true });
    // A world without hiding answers nothing.
    const bare = new World<never>({ seed: 1 });
    expect(peekOf(bare, 1)).toBeUndefined();
    expect(isHidden(bare, 1)).toBe(false);
    expect(isOccupied(bare, 1)).toBe(false);
    expect(concealmentOf(bare, 1)).toBe(0);
  });

  it('only the occupied spot can be focused from inside (focus filter)', () => {
    const s = setup();
    s.hiding.enter(s.sim, s.player, s.spot);
    const lever = s.world.spawn();
    addProperties(s.sim, lever, { liftable: true });
    placeEntity(s.sim, lever, v(0, 0.5, -0.3), 0.5);
    s.world.step([IDLE]);
    s.world.step([IDLE]);
    const focus = s.world.get(s.player, InteractionFocusComponent);
    expect(focus?.target === lever).toBe(false);
  });

  it('Interact inside gets the player out; Interact held does not bounce them back in', () => {
    const s = setup();
    s.hiding.enter(s.sim, s.player, s.spot);
    // The spot is the focus: the sim's own interaction system does the rest.
    const press = frameOf({ interact: 'press' });
    const hold = frameOf({ interact: 'hold' });
    for (let i = 0; i < 4; i++) s.world.step([IDLE]);
    expect(interactionPrompt(s.sim, s.player)).toMatchObject({ verb: 'leave' });
    s.world.step([press]);
    expect(isHidden(s.sim, s.player)).toBe(false);
    for (let i = 0; i < 10; i++) s.world.step([hold]);
    expect(isHidden(s.sim, s.player)).toBe(false);
  });
});

describe('a spot a physics body carries (mw-e03.23)', () => {
  function barrel() {
    const s = setup();
    const body = s.world.spawn();
    s.world.register(PhysicsObjectComponent);
    s.world.add(body, PhysicsObjectComponent, {
      body: 1,
      shape: { kind: 'box', halfExtents: v(0.3, 0.4, 0.3) },
      position: v(0, 0.4, 0),
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      sleeping: false,
      awakeSince: 0,
    });
    s.world.step([IDLE]);
    makeHidingSpot(s.sim, body, { origin: v(0, 0, 0), yaw: 0 });
    s.world.step([IDLE]);
    return { s, body };
  }

  const moveTo = (
    s: Setup,
    body: EntityId,
    position: Vec3,
    rotation = { x: 0, y: 0, z: 0, w: 1 },
  ) => {
    const object = s.world.get(body, PhysicsObjectComponent);
    if (object === undefined) throw new Error('no body');
    s.world.set(body, PhysicsObjectComponent, { ...object, position, rotation });
  };

  it('knocked along the floor it takes its occupant with it, and its exits follow', () => {
    const { s, body } = barrel();
    s.hiding.enter(s.sim, s.player, body);
    moveTo(s, body, v(2, 0.4, 1));
    s.world.step([IDLE]);
    expect(floorOf(s)).toEqual(v(2, 0, 1));
    expect(spotOf(s.sim, body)?.origin).toEqual(v(2, 0, 1));
    s.world.step([IDLE]); // still: nothing moves
    expect(floorOf(s)).toEqual(v(2, 0, 1));
    expect(s.hiding.leave(s.sim, s.player).ok).toBe(true);
    expect(feetOf(s).x).toBeCloseTo(2, 9);
    expect(feetOf(s).z).toBeCloseTo(0.1, 9);
  });

  it('a spot made before its body existed starts following from the first tick it has one', () => {
    const s = setup();
    s.world.register(PhysicsObjectComponent);
    const late = s.world.spawn();
    makeHidingSpot(s.sim, late, { origin: v(5, 0, 5) });
    s.world.step([IDLE]);
    s.world.add(late, PhysicsObjectComponent, {
      body: 1,
      shape: { kind: 'box', halfExtents: v(0.3, 0.4, 0.3) },
      position: v(5, 0.4, 5),
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      sleeping: false,
      awakeSince: 0,
    });
    s.world.step([IDLE]);
    expect(spotOf(s.sim, late)?.origin).toEqual(v(5, 0, 5));
  });

  it('an empty barrel that moved is where its body is when someone gets in', () => {
    const { s, body } = barrel();
    moveTo(s, body, v(-3, 0.4, 0));
    s.world.step([IDLE]);
    s.hiding.enter(s.sim, s.player, body);
    expect(floorOf(s)).toEqual(v(-3, 0, 0));
  });

  it('tipped over, it throws the occupant out', () => {
    const { s, body } = barrel();
    s.hiding.enter(s.sim, s.player, body);
    const half = Math.SQRT1_2;
    moveTo(s, body, v(0, 0.3, 0), { x: half, y: 0, z: 0, w: half });
    s.world.step([IDLE]);
    expect(isHidden(s.sim, s.player)).toBe(false);
    expect(s.ejected).toMatchObject([{ cause: 'toppled' }]);
  });
});

describe('placing hiding spots (mw-e03.23)', () => {
  it('hidingSpotOf validates and defaults', () => {
    const spot = hidingSpotOf({ origin: v(1, 0, 2) });
    expect(spot).toMatchObject({
      capacity: 1,
      concealment: 1,
      peek: true,
      enterDb: 30,
      exitDb: 24,
      yaw: 0,
      occupants: [],
      follow: null,
    });
    expect(spot.exits).toEqual([v(0, 0, 0.9)]);
    expect(spot.eye).toEqual(v(0, 1.5, 0.2));
    expect(() => hidingSpotOf({ origin: v(0, 0, 0), capacity: 0 })).toThrow('capacity');
    expect(() => hidingSpotOf({ origin: v(0, 0, 0), capacity: 1.5 })).toThrow('capacity');
    expect(() => hidingSpotOf({ origin: v(0, 0, 0), concealment: 2 })).toThrow('concealment');
    expect(() => hidingSpotOf({ origin: v(0, 0, 0), concealment: Number.NaN })).toThrow(
      'concealment',
    );
    expect(() => hidingSpotOf({ origin: v(0, 0, 0), exits: [] })).toThrow('exit');
  });

  it('spotPoint turns offsets with the yaw: right of the opening, and out of it', () => {
    const at = { origin: v(1, 0.5, 1), yaw: Math.PI / 2 };
    // Yaw 90° faces −x: out is −x, and right of the opening is −z.
    const out = spotPoint(at, v(0, 0, 1));
    expect(out.x).toBeCloseTo(0, 9);
    expect(out.z).toBeCloseTo(1, 9);
    const right = spotPoint(at, v(1, 0, 0));
    expect(right.x).toBeCloseTo(1, 9);
    expect(right.z).toBeCloseTo(0, 9);
    expect(spotPoint(at, v(0, 2, 0)).y).toBe(2.5);
  });

  it('scene spawns that declare hiding become spots, in scene order', () => {
    const world = installStimuli(
      registerWorldProperties(registerSceneComponents(new World<never>({ seed: 1 }))),
    );
    const sim: World<never> = world;
    installInteraction(world);
    world.register(HidingSpotComponent);
    const a = world.spawn();
    const b = world.spawn();
    const c = world.spawn();
    const made = addSceneHidingSpots(
      sim,
      [
        { entity: a, spawn: { position: v(1, 0, 1), yaw: 90 } },
        {
          entity: b,
          spawn: {
            position: v(2, 0, 2),
            yaw: 180,
            hiding: {
              capacity: 2,
              concealment: 0.5,
              peek: false,
              enterDb: 40,
              exitDb: 30,
              inside: [0, 0, 0.1],
              eye: [0, 1.2, 0.3],
              exits: [[0, 0, 1]],
            },
          },
        },
        { entity: c, spawn: { position: v(3, 0, 3), yaw: 0, hiding: {} } },
      ],
      (spawn) => spawn.yaw / 100,
    );
    world.step([]);
    expect(made).toEqual([b, c]);
    expect(spotOf(sim, a)).toBeUndefined();
    expect(spotOf(sim, b)).toMatchObject({
      capacity: 2,
      concealment: 0.5,
      peek: false,
      enterDb: 40,
      exitDb: 30,
      yaw: 1.8,
      inside: v(0, 0, 0.1),
      eye: v(0, 1.2, 0.3),
      exits: [v(0, 0, 1)],
    });
    expect(spotOf(sim, c)).toMatchObject({ capacity: 1, yaw: 0 });
    expect(affordancesOf(sim, b).map((x) => x.verb)).toEqual(['leave', 'hide']);
  });

  it('a spot made where interaction is not installed has no prompt', () => {
    const world = registerSceneComponents(new World<never>({ seed: 1 }));
    world.register(HidingSpotComponent);
    const spot = world.spawn();
    makeHidingSpot(world, spot, { origin: v(0, 0, 0) });
    world.step([]);
    expect(spotOf(world, spot)).toBeDefined();
  });

  it('uninstalling stops every rule', () => {
    const world = registerWorldProperties(
      registerSceneComponents(new World<ActionFrame>({ seed: 1 })),
    );
    world.register(CharacterController, PlayerLook);
    const installed = installHiding(world);
    const sim: World<never> = world;
    const spot = world.spawn();
    makeHidingSpot(sim, spot, { origin: v(0, 0, 0) });
    const player = world.spawn();
    world.add(player, CharacterController, {
      ...initialCharacterState(v(0, 0, -2)),
      grounded: true,
    });
    world.step([IDLE]);
    installed.hiding.enter(sim, player, spot);
    installed.uninstall();
    expect(hidingOf(sim)).toBeUndefined();
    world.events.emit(fireIgnited, { entity: spot });
    world.events.emit(breakableBroken, { entity: spot } as never);
    world.events.emit(liquidEntered, { entity: spot, volume: 1 });
    world.events.emit(Died, { target: player } as never);
    world.events.emit(interacted, { actor: player, target: spot, verb: 'leave', affordance: 0 });
    world.step([IDLE]);
    expect(isHidden(sim, player)).toBe(true);
    expect(world.get(player, HiddenComponent)).toBeDefined();
  });
});
