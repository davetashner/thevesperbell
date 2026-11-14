// The bow (mw-e05.3): draw, aim and release through the player, driven by ActionFrames the way the
// game drives it, plus the bow system on its own for the edges the player never reaches.
import type {
  ArrowEntry,
  ControllerTuning,
  Frozen,
  MoveTable,
  RuntimeBow,
  RuntimeMotion,
  RuntimeMove,
  RuntimeShield,
} from '@content/index';
import { describe, expect, it } from 'vitest';
import { FakeCollisionWorld } from '../../character/fake-collision-world';
import { box } from '../../character/greybox';
import { CharacterController } from '../../character/system';
import { World } from '../../core/world';
import {
  actionButton,
  actionFrame,
  actionVector,
  IDLE_ACTION_FRAME,
  type ActionFrame,
  type ButtonAction,
} from '../../input/action-frame';
import { installPlayer, lookAim, PlayerLook, ViewAnchor } from '../../player/player';
import { registerWorldProperties } from '../../properties/components';
import type { SceneSpawnPlacement } from '../../scene/layout';
import { PlacementComponent } from '../../stimulus/placement';
import { ActionRejected, type ActionRejection } from '../actions';
import { ArrowComponent } from '../arrows/components';
import { ArrowFired, type ArrowFiredInfo } from '../arrows/events';
import { arrowLookup, installArrows } from '../arrows/system';
import { DAMAGE_COMPONENTS } from '../damage/components';
import { DamageModel } from '../damage/model';
import { HIT_VOLUME_COMPONENTS } from '../hits/components';
import { StaminaComponent, staminaOf } from '../stamina';
import {
  ACTION_TIMELINE_COMPONENTS,
  ActionInputComponent,
  giveActionInput,
  giveActionTimeline,
} from '../timeline/components';
import { ActionStarted, type ActionStartInfo } from '../timeline/events';
import { interruptAction } from '../timeline/timeline';
import {
  BowComponent,
  giveBow,
  QuiverComponent,
  quiverCount,
  addArrows,
  returnArrow,
  takeArrow,
  type QuiverSlot,
} from './components';
import {
  ArrowSelected,
  BowDrawEnded,
  BowDrawStarted,
  BowEquipped,
  type ArrowSelectInfo,
  type BowDrawEndInfo,
} from './events';
import {
  bowLocomotionScale,
  bowLookup,
  drawFraction,
  installBow,
  isDrawing,
  launchSpeed,
  type BowAim,
  type BowButtons,
} from './system';

const SHORTBOW: RuntimeBow = Object.freeze({
  id: 'shortbow',
  fullDrawTicks: 48,
  minDrawTicks: 12,
  maxLaunchSpeed: 60,
  minLaunchFraction: 0.3,
  drawStaminaCost: 6,
  holdTicks: 120,
  holdDrainPerSecond: 8,
  walkScale: 0.5,
});
const BOWS = bowLookup([SHORTBOW]);

function arrowDef(id: string): ArrowEntry {
  return {
    id,
    schemaVersion: 1,
    name: id,
    massGrams: 25,
    dragK: 0,
    damage: {
      amounts: { pierce: 25 },
      poiseDamage: 15,
      staminaDamage: 0,
      impulse: { x: 0, y: 0, z: 0 },
      impactForce: 0,
      tags: [],
    },
    penetration: 20,
    onImpact: 'stick',
    retrievable: true,
    payload: [],
    cues: { trailVfx: 'vfx-arrow-trail-standard', flightSfx: 'sfx-arrow-flyby' },
    tags: [],
  };
}
const ARROWS = arrowLookup([arrowDef('standard'), arrowDef('blunt'), arrowDef('broadhead')]);

const TUNING: Frozen<ControllerTuning> = {
  capsule: { radius: 0.35, height: 1.8, crouchHeight: 1.0 },
  speeds: { run: 5, sprint: 7.5, crouch: 2.2 },
  accelTime: 0.15,
  decelTime: 0.1,
  airControl: 0.3,
  gravity: 25,
  maxFallSpeed: 40,
  jumpApex: 1.2,
  coyoteMs: 120,
  jumpBufferMs: 150,
  stepHeight: 0.35,
  slopeLimit: 45,
};

/** A player start at the origin facing −z (scene yaw 180): look yaw 0. */
const START: SceneSpawnPlacement = {
  id: 'player-start',
  position: { x: 0, y: 0, z: 0 },
  yaw: 180,
  rotation: { x: 0, y: 1, z: 0, w: 0 },
  prop: undefined,
  tags: ['player-start'],
};

const WOOD: RuntimeShield = {
  id: 'wood-shield',
  kind: 'shield',
  absorption: { slash: 85 },
  stability: 60,
  raiseTicks: 6,
  arcDegrees: 120,
  moveSpeedScale: 0.5,
};

function move(
  id: string,
  verb: 'dodge' | 'attack',
  frames: [number, number, number],
  motion: RuntimeMotion | null = null,
): RuntimeMove {
  const [startup, active, recovery] = frames;
  return {
    id,
    verb,
    startup,
    active,
    recovery,
    totalTicks: startup + active + recovery,
    activeFrom: startup,
    recoveryFrom: startup + active,
    staminaCost: 0,
    cancelWindows: [],
    damage: null,
    hitbox: null,
    parryable: false,
    blockable: false,
    unblockable: false,
    interruptible: false,
    hyperarmor: null,
    iframes: null,
    telegraphTick: 0,
    hitStop: null,
    chainNext: null,
    charge: null,
    motion,
    presentation: { anim: `anim-${id}` },
  };
}

const MOVES: MoveTable = new Map(
  [
    move('dodge-roll', 'dodge', [2, 13, 21], { distance: 3, direction: 'input' }),
    move('backstep', 'dodge', [2, 6, 16], { distance: 1.2, direction: 'backward' }),
    move('sword-light-1', 'attack', [12, 4, 18]),
  ].map((m) => [m.id, m]),
);

const QUIVER: readonly QuiverSlot[] = [
  { arrow: 'standard', count: 5 },
  { arrow: 'blunt', count: 0 },
  { arrow: 'broadhead', count: 2 },
];

/** A frame with `pressed` buttons pressed (and held), `held` held and `released` let go. */
function frame(
  pressed: readonly ButtonAction[] = [],
  held: readonly ButtonAction[] = [],
  move: [number, number] = [0, 0],
  released: readonly ButtonAction[] = [],
): ActionFrame {
  return actionFrame({
    move: actionVector(move[0], move[1]),
    look: actionVector(0, 0),
    buttons: (b) =>
      actionButton(
        pressed.includes(b),
        pressed.includes(b) || held.includes(b),
        released.includes(b),
      ),
  });
}

const FIRE: ButtonAction = 'primaryAttack';
const PRESS_FIRE = frame([FIRE]);
const HOLD_FIRE = frame([], [FIRE]);
const LET_GO = frame([], [], [0, 0], [FIRE]);

interface ArcherOptions {
  readonly quiver?: readonly QuiverSlot[];
  readonly equipped?: boolean;
  readonly melee?: boolean;
  readonly buttons?: BowButtons;
}

/** The player with a bow, a dodge and (optionally) sword and shield, on a floor, arrows flying. */
function archer(options: ArcherOptions = {}) {
  const collision = new FakeCollisionWorld([
    box({ x: -50, y: -1, z: -50 }, { x: 50, y: 0, z: 50 }),
  ]);
  const world = registerWorldProperties(new World<ActionFrame>({ seed: 3 })).register(
    ...HIT_VOLUME_COMPONENTS,
    ...DAMAGE_COMPONENTS,
    PlacementComponent,
  );
  const player = installPlayer(world, {
    spawns: [START],
    collision,
    tuning: TUNING,
    combat: {
      moves: MOVES,
      ...(options.melee === true && { melee: { shield: WOOD } }),
      bow: {
        bows: BOWS,
        arrows: ARROWS,
        ...(options.buttons !== undefined && { buttons: options.buttons }),
        loadout: {
          bow: 'shortbow',
          quiver: options.quiver ?? QUIVER,
          equipped: options.equipped ?? true,
        },
      },
    },
  });
  installArrows(world, { arrows: ARROWS, damage: new DamageModel() });
  world.step([IDLE_ACTION_FRAME]); // settle onto the floor
  const fired: ArrowFiredInfo[] = [];
  const ended: BowDrawEndInfo[] = [];
  const rejected: ActionRejection[] = [];
  const started: ActionStartInfo[] = [];
  world.events.on(ArrowFired, (e) => fired.push(e));
  world.events.on(BowDrawEnded, (e) => ended.push(e));
  world.events.on(ActionRejected, (e) => rejected.push(e));
  world.events.on(ActionStarted, (e) => started.push(e));
  const run = (ticks: number, input: ActionFrame = IDLE_ACTION_FRAME) => {
    for (let i = 0; i < ticks; i++) world.step([input]);
  };
  /** Presses fire, holds it for `ticks` more ticks and lets go on the last. */
  const shoot = (ticks: number) => {
    run(1, PRESS_FIRE);
    run(ticks - 1, HOLD_FIRE);
    run(1, LET_GO);
  };
  const count = (arrow = 'standard') => quiverCount(world, player, arrow);
  const stamina = () => staminaOf(world, player)?.current;
  const setStamina = (current: number, regenResumesAt?: number) => {
    const pool = staminaOf(world, player);
    if (pool === undefined) throw new Error('no pool');
    world.set(player, StaminaComponent, {
      ...pool,
      current,
      ...(regenResumesAt !== undefined && { regenResumesAt }),
    });
  };
  const bow = () => world.get(player, BowComponent);
  const speed = () => {
    const v = world.get(player, CharacterController)?.velocity ?? { x: 0, z: 0 };
    return Math.sqrt(v.x ** 2 + v.z ** 2);
  };
  return {
    world,
    player,
    fired,
    ended,
    rejected,
    started,
    run,
    shoot,
    count,
    stamina,
    setStamina,
    bow,
    speed,
  };
}

const speedOf = (v: { x: number; y: number; z: number }) =>
  Math.sqrt(v.x ** 2 + v.y ** 2 + v.z ** 2);

describe('the bow: draw and release (mw-e05.3)', () => {
  it('AC-1: a draw held 24 ticks looses an arrow at 65% of full launch speed (30% + 0.5 × 70%)', () => {
    const a = archer();
    a.shoot(24);
    expect(a.fired).toHaveLength(1);
    const [shot] = a.fired;
    expect(speedOf(shot?.velocity ?? { x: 0, y: 0, z: 0 })).toBeCloseTo(0.65 * 60, 9);
    expect(shot).toMatchObject({ arrow: 'standard', shooter: a.player });
    expect(a.ended).toEqual([
      expect.objectContaining({
        reason: 'fired',
        ticks: 24,
        fraction: 0.5,
        projectile: shot?.entity,
      }),
    ]);
    expect(a.ended[0]?.speed).toBeCloseTo(39, 9);
    expect(a.count()).toBe(4);
    expect(a.world.has(shot?.entity ?? -1, ArrowComponent)).toBe(true);
  });

  it('a full draw (48 ticks or more) looses at the full 60 m/s', () => {
    const a = archer();
    a.shoot(60);
    expect(speedOf(a.fired[0]?.velocity ?? { x: 0, y: 0, z: 0 })).toBeCloseTo(60, 9);
    expect(a.ended[0]?.fraction).toBe(1);
    expect(launchSpeed(SHORTBOW, 0)).toBeCloseTo(18, 9);
    expect(drawFraction(SHORTBOW, 96)).toBe(1);
  });

  it('AC-2: a draw held 8 ticks spawns no arrow and leaves the quiver as it was', () => {
    const a = archer();
    a.shoot(8);
    expect(a.fired).toEqual([]);
    expect(a.count()).toBe(5);
    expect(a.ended).toEqual([expect.objectContaining({ reason: 'early', ticks: 8 })]);
    expect(a.world.query(ArrowComponent).ids()).toEqual([]);
  });

  it('a tap within one tick cancels on the next', () => {
    const a = archer();
    a.run(1, tap());
    a.run(1);
    expect(a.ended).toEqual([expect.objectContaining({ reason: 'early', ticks: 1 })]);
    expect(a.count()).toBe(5);
  });

  it('drawing takes the arrow from the quiver, costs 6 stamina and emits BowDrawStarted', () => {
    const a = archer();
    const starts: unknown[] = [];
    a.world.events.on(BowDrawStarted, (e) => starts.push(e));
    a.run(1, PRESS_FIRE);
    expect(a.count()).toBe(4);
    expect(a.stamina()).toBe(94);
    expect(starts).toEqual([{ tick: a.world.tick - 1, entity: a.player, arrow: 'standard' }]);
    expect(isDrawing(a.world, a.player)).toBe(true);
    expect(a.bow()?.draw).toMatchObject({ arrow: 'standard', ticks: 0 });
  });

  it('AC-3: past 120 ticks at full draw stamina drains 8/s, and at 0 the draw collapses, arrow returned', () => {
    const a = archer();
    a.run(1, PRESS_FIRE);
    a.run(48 + 120, HOLD_FIRE); // full draw held 120 ticks: regen has refilled the pool
    expect(a.stamina()).toBe(100);
    a.run(60, HOLD_FIRE);
    expect(a.stamina()).toBe(92);
    expect(a.ended).toEqual([]);
    a.setStamina(0.2); // 1.5 ticks of drain
    a.run(1, HOLD_FIRE);
    expect(a.ended).toEqual([]);
    a.run(1, HOLD_FIRE);
    expect(a.stamina()).toBe(0);
    expect(a.ended).toEqual([expect.objectContaining({ reason: 'collapsed', fraction: 1 })]);
    expect(a.count()).toBe(5);
    a.run(1, LET_GO);
    expect(a.fired).toEqual([]);
  });

  it('AC-4: with none of the selected type, fire starts no draw and is rejected for ammo', () => {
    const a = archer({ quiver: [{ arrow: 'standard', count: 0 }] });
    a.run(1, PRESS_FIRE);
    expect(a.bow()?.draw).toBeNull();
    expect(a.stamina()).toBe(100);
    expect(a.rejected).toEqual([
      { entity: a.player, action: 'bow', reason: 'ammo', tick: a.world.tick - 1 },
    ]);
  });

  it('AC-5: a dodge cancels the draw, returns the arrow and still rolls', () => {
    const a = archer();
    a.run(1, PRESS_FIRE);
    a.run(20, HOLD_FIRE);
    expect(a.count()).toBe(4);
    a.run(1, frame(['dodge'], [FIRE], [0, 1]));
    expect(a.ended).toEqual([expect.objectContaining({ reason: 'interrupted', ticks: 21 })]);
    expect(a.count()).toBe(5);
    expect(a.started.map((e) => e.move)).toEqual(['dodge-roll']);
    a.run(1, HOLD_FIRE); // still holding: no new draw without a new press
    expect(a.bow()?.draw).toBeNull();
    expect(a.fired).toEqual([]);
  });

  it('mw-e02.33: with the hands on a ledge or a wall fire draws nothing, and a draw in progress ends', () => {
    const a = archer();
    /** Puts the player in `mode` for the next tick (the controller hands it back after). */
    const traverse = (mode: 'hang' | 'climb') => {
      const state = a.world.get(a.player, CharacterController);
      if (state === undefined) throw new Error('no player');
      a.world.set(a.player, CharacterController, { ...state, traversal: mode });
    };
    const before = a.stamina();
    traverse('hang');
    a.run(1, PRESS_FIRE);
    expect(a.rejected).toEqual([expect.objectContaining({ action: 'bow', reason: 'traversal' })]);
    expect(a.bow()?.draw).toBeNull();
    expect(a.count()).toBe(5);
    expect(a.stamina()).toBe(before);
    a.run(1, PRESS_FIRE);
    a.run(10, HOLD_FIRE);
    traverse('climb');
    a.run(1, HOLD_FIRE);
    expect(a.ended).toEqual([expect.objectContaining({ reason: 'interrupted', ticks: 11 })]);
    expect(a.count()).toBe(5);
  });

  it('raising the shield cancels the draw; fire mid-move or behind the shield is refused as busy', () => {
    const a = archer({ melee: true });
    a.run(1, PRESS_FIRE);
    a.run(5, HOLD_FIRE);
    a.run(1, frame(['secondaryAttack'], [FIRE]));
    expect(a.ended).toEqual([expect.objectContaining({ reason: 'interrupted' })]);
    expect(a.count()).toBe(5);
    a.run(1, frame([FIRE], ['secondaryAttack']));
    expect(a.rejected.map((r) => r.reason)).toEqual(['busy']);
    a.run(1);
    a.run(1, frame(['dodge'], [], [0, 1]));
    a.run(1, PRESS_FIRE);
    expect(a.rejected.map((r) => r.reason)).toEqual(['busy', 'busy']);
    expect(a.bow()?.draw).toBeNull();
  });

  it('a hit reaction (an interrupt lock) cancels the draw', () => {
    const a = archer();
    a.run(1, PRESS_FIRE);
    interruptAction(a.world, a.player, 10);
    a.run(1, HOLD_FIRE);
    expect(a.ended).toEqual([expect.objectContaining({ reason: 'interrupted' })]);
  });

  it('with no stamina the draw is refused by the stamina rule', () => {
    const a = archer();
    a.setStamina(0, a.world.tick + 100);
    a.run(1, PRESS_FIRE);
    expect(a.bow()?.draw).toBeNull();
    expect(a.count()).toBe(5);
    expect(a.rejected).toEqual([expect.objectContaining({ action: 'bow', reason: 'stamina' })]);
  });

  it('a tick without input interrupts the draw', () => {
    const a = archer();
    a.run(1, PRESS_FIRE);
    a.world.step([]);
    expect(a.ended).toEqual([expect.objectContaining({ reason: 'interrupted' })]);
    expect(a.count()).toBe(5);
  });

  it('while drawn the archer walks at half speed and cannot sprint', () => {
    const a = archer();
    a.run(30, frame([], ['sprint'], [0, 1]));
    expect(a.speed()).toBeCloseTo(7.5, 9);
    a.run(1, frame([FIRE], ['sprint'], [0, 1]));
    a.run(30, frame([], [FIRE, 'sprint'], [0, 1]));
    expect(a.speed()).toBeCloseTo(2.5, 9);
    expect(bowLocomotionScale(a.world, a.player, BOWS)).toBe(0.5);
  });
});

/** A press and release inside one tick. */
function tap(): ActionFrame {
  return actionFrame({
    move: actionVector(0, 0),
    look: actionVector(0, 0),
    buttons: (b) => actionButton(b === FIRE, false, b === FIRE),
  });
}

describe('the bow: equipping and the quiver (mw-e05.3)', () => {
  it('the toggle takes the bow out and puts it away, stowing and restoring the light attack', () => {
    const a = archer({ melee: true, equipped: false });
    const equips: unknown[] = [];
    a.world.events.on(BowEquipped, (e) => equips.push(e));
    expect(a.world.get(a.player, ActionInputComponent)?.bindings).toEqual({
      primaryAttack: 'sword-light-1',
    });
    a.run(1, PRESS_FIRE); // bow away: the sword swings
    expect(a.started.map((e) => e.move)).toEqual(['sword-light-1']);
    a.run(60);
    a.run(1, frame(['ability4']));
    expect(a.bow()).toMatchObject({ equipped: true, stowed: 'sword-light-1' });
    expect(a.world.get(a.player, ActionInputComponent)?.bindings).toEqual({});
    a.run(1, PRESS_FIRE); // bow out: fire draws, the sword stays put
    expect(a.started.map((e) => e.move)).toEqual(['sword-light-1']);
    expect(a.bow()?.draw).not.toBeNull();
    a.run(1, frame(['ability4'], [FIRE])); // put away mid-draw
    expect(a.ended).toEqual([expect.objectContaining({ reason: 'stowed' })]);
    expect(a.count()).toBe(5);
    expect(a.bow()).toMatchObject({ equipped: false, draw: null, stowed: null });
    expect(a.world.get(a.player, ActionInputComponent)?.bindings).toEqual({
      primaryAttack: 'sword-light-1',
    });
    expect(equips).toEqual([
      expect.objectContaining({ equipped: true }),
      expect.objectContaining({ equipped: false }),
    ]);
  });

  it('without a light attack, putting the bow away binds none', () => {
    const a = archer({ equipped: true });
    expect(a.bow()?.stowed).toBeNull();
    a.run(1, frame(['ability4']));
    expect(a.world.get(a.player, ActionInputComponent)?.bindings).toEqual({});
  });

  it('with the bow away fire and cycle do nothing', () => {
    const a = archer({ equipped: false });
    a.run(1, frame([FIRE, 'ability3']));
    expect(a.bow()).toMatchObject({ draw: null, selected: 'standard' });
  });

  it('cycle steps through the quiver’s types in order, wrapping, but not mid-draw', () => {
    const a = archer();
    const selected: ArrowSelectInfo[] = [];
    a.world.events.on(ArrowSelected, (e) => selected.push(e));
    const cycle = frame(['ability3']);
    a.run(1, cycle);
    expect(a.bow()?.selected).toBe('blunt');
    a.run(1, cycle);
    expect(a.bow()?.selected).toBe('broadhead');
    a.run(1, PRESS_FIRE);
    a.run(1, frame(['ability3'], [FIRE]));
    expect(a.bow()?.selected).toBe('broadhead');
    a.run(20, HOLD_FIRE);
    a.run(1, LET_GO);
    expect(a.fired.map((f) => f.arrow)).toEqual(['broadhead']);
    expect(a.count('broadhead')).toBe(1);
    a.run(1, cycle);
    expect(a.bow()?.selected).toBe('standard');
    expect(selected.map((s) => [s.arrow, s.count])).toEqual([
      ['blunt', 0],
      ['broadhead', 2],
      ['standard', 5],
    ]);
  });

  it('the player’s bow can take other buttons', () => {
    const a = archer({ buttons: { fire: 'ability1', cycle: 'ability2', toggle: 'interact' } });
    a.run(1, frame(['ability2']));
    expect(a.bow()?.selected).toBe('blunt');
    a.run(1, frame(['interact']));
    expect(a.bow()?.equipped).toBe(false);
  });

  it('a bow without a quiver has nothing to cycle', () => {
    const a = archer();
    a.world.remove(a.player, QuiverComponent);
    a.run(1, frame(['ability3']));
    expect(a.bow()?.selected).toBe('standard');
  });

  it('a one-type quiver has nothing to cycle to', () => {
    const a = archer({ quiver: [{ arrow: 'standard', count: 1 }] });
    a.run(1, frame(['ability3']));
    expect(a.bow()?.selected).toBe('standard');
  });

  it('giveBow validates the quiver', () => {
    const world = new World<never>({ seed: 1 }).register(BowComponent, QuiverComponent);
    const e = world.spawn();
    const give = (quiver: readonly QuiverSlot[], selected?: string) => () => {
      giveBow(world, e, { bow: 'shortbow', quiver, ...(selected !== undefined && { selected }) });
    };
    expect(give([])).toThrow('at least one arrow type');
    expect(give([{ arrow: 'standard', count: -1 }])).toThrow('whole number');
    expect(give([{ arrow: 'standard', count: 1.5 }])).toThrow('whole number');
    expect(
      give([
        { arrow: 'standard', count: 1 },
        { arrow: 'standard', count: 1 },
      ]),
    ).toThrow('twice');
    expect(give([{ arrow: 'standard', count: 1 }], 'fire')).toThrow('no "fire" slot');
    give([{ arrow: 'standard', count: 1 }], 'standard')();
    expect(world.get(e, BowComponent)).toEqual({
      bow: 'shortbow',
      equipped: false,
      selected: 'standard',
      draw: null,
      stowed: null,
    });
  });

  it('an archer without an action input can still take its bow out', () => {
    const world = new World<never>({ seed: 1 }).register(BowComponent, QuiverComponent);
    const e = world.spawn();
    giveBow(world, e, { bow: 'shortbow', quiver: QUIVER, equipped: true });
    expect(world.get(e, BowComponent)?.equipped).toBe(true);
  });

  it('taking and returning arrows respects the slots', () => {
    const world = new World<never>({ seed: 1 }).register(BowComponent, QuiverComponent);
    const e = world.spawn();
    expect(quiverCount(world, e, 'standard')).toBe(0);
    expect(takeArrow(world, e, 'standard')).toBe(false);
    returnArrow(world, e, 'standard'); // no quiver: nothing
    giveBow(world, e, { bow: 'shortbow', quiver: QUIVER });
    expect(takeArrow(world, e, 'blunt')).toBe(false);
    expect(takeArrow(world, e, 'standard')).toBe(true);
    expect(quiverCount(world, e, 'standard')).toBe(4);
    returnArrow(world, e, 'fire'); // no such slot: nothing
    returnArrow(world, e, 'standard');
    expect(world.get(e, QuiverComponent)?.slots).toEqual(QUIVER);
    expect(quiverCount(world, e, 'fire')).toBe(0);
  });

  it('mw-e05.7: arrows taken back go into their slot, adding the slot when the quiver has none', () => {
    const world = new World<never>({ seed: 1 }).register(BowComponent, QuiverComponent);
    const e = world.spawn();
    expect(addArrows(world, e, 'standard', 3)).toBe(false); // no quiver: nothing
    giveBow(world, e, { bow: 'shortbow', quiver: QUIVER });
    expect(addArrows(world, e, 'standard', 3)).toBe(true);
    expect(quiverCount(world, e, 'standard')).toBe(8);
    expect(addArrows(world, e, 'rope', 2)).toBe(true);
    expect(quiverCount(world, e, 'rope')).toBe(2);
    expect(world.get(e, QuiverComponent)?.slots.map((slot) => slot.arrow)).toEqual([
      ...QUIVER.map((slot) => slot.arrow),
      'rope',
    ]);
  });
});

/** The bow system alone, with a fixed aim, for the edges the player cannot reach. */
function bare(aim: BowAim, register: 'none' | 'timeline' = 'none') {
  const world = new World<ActionFrame>({ seed: 1 });
  if (register === 'timeline') world.register(...ACTION_TIMELINE_COMPONENTS, StaminaComponent);
  installBow(world, { bows: BOWS, arrows: ARROWS, aim });
  installArrows(world.register(...HIT_VOLUME_COMPONENTS, PlacementComponent), {
    arrows: ARROWS,
    damage: new DamageModel(),
  });
  const e = world.spawn();
  giveBow(world, e, { bow: 'shortbow', quiver: QUIVER, equipped: true });
  const ended: BowDrawEndInfo[] = [];
  world.events.on(BowDrawEnded, (x) => ended.push(x));
  return { world, e, ended };
}

describe('the bow system on its own (mw-e05.3)', () => {
  const straight: BowAim = () => ({
    origin: { x: 0, y: 1, z: 0 },
    direction: { x: 0, y: 0, z: -1 },
  });

  it('an archer with no timeline or stamina draws for free', () => {
    const { world, e, ended } = bare(straight);
    world.step([PRESS_FIRE]);
    for (let i = 0; i < 200; i++) world.step([HOLD_FIRE]);
    world.step([LET_GO]);
    expect(ended).toEqual([expect.objectContaining({ reason: 'fired', ticks: 201 })]);
    expect(bowLocomotionScale(world, e, BOWS)).toBe(1);
  });

  it('with a timeline and stamina registered but not given, it is never busy', () => {
    const { world, ended } = bare(straight, 'timeline');
    world.step([PRESS_FIRE]);
    for (let i = 0; i < 15; i++) world.step([HOLD_FIRE]);
    world.step([LET_GO]);
    expect(ended.map((x) => x.reason)).toEqual(['fired']);
  });

  it('an aim that cannot aim interrupts the release and returns the arrow', () => {
    const { world, e, ended } = bare(() => undefined);
    world.step([PRESS_FIRE]);
    for (let i = 0; i < 15; i++) world.step([HOLD_FIRE]);
    world.step([LET_GO]);
    expect(ended.map((x) => x.reason)).toEqual(['interrupted']);
    expect(quiverCount(world, e, 'standard')).toBe(5);
  });

  it('an unknown bow throws', () => {
    const world = new World<ActionFrame>({ seed: 1 });
    const aim: BowAim = () => ({ origin: { x: 0, y: 1, z: 0 }, direction: { x: 0, y: 0, z: -1 } });
    installBow(world, { bows: BOWS, arrows: ARROWS, aim });
    const e = world.spawn();
    giveBow(world, e, { bow: 'longbow', quiver: QUIVER, equipped: true });
    expect(() => {
      world.step([PRESS_FIRE]);
    }).toThrow('bow "longbow" is not in the bow table');
  });

  it('a world without bows moves at full speed', () => {
    const world = new World<never>({ seed: 1 });
    expect(bowLocomotionScale(world, world.spawn(), BOWS)).toBe(1);
  });

  it('custom buttons drive the bow', () => {
    const world = new World<ActionFrame>({ seed: 1 });
    world.register(...ACTION_TIMELINE_COMPONENTS);
    installBow(world, {
      bows: BOWS,
      arrows: ARROWS,
      aim: straight,
      buttons: { fire: 'jump', cycle: 'ability1', toggle: 'ability2' },
    });
    installArrows(world.register(...HIT_VOLUME_COMPONENTS, PlacementComponent), {
      arrows: ARROWS,
      damage: new DamageModel(),
    });
    const e = world.spawn();
    giveActionTimeline(world, e);
    giveActionInput(world, e, {});
    giveBow(world, e, { bow: 'shortbow', quiver: QUIVER });
    world.step([frame(['ability2'])]);
    world.step([frame(['ability1'])]);
    world.step([frame(['jump'])]);
    expect(world.get(e, BowComponent)).toMatchObject({ equipped: true, selected: 'blunt' });
    expect(world.get(e, BowComponent)?.draw).toBeNull(); // blunt: none left
  });
});

describe('the bow and chords (mw-e04.14)', () => {
  it('taking the bow out stows the attack with its chords inert; putting it away restores both', () => {
    const world = new World<ActionFrame>({ seed: 1 });
    world.register(...ACTION_TIMELINE_COMPONENTS);
    const aim: BowAim = () => ({ origin: { x: 0, y: 1, z: 0 }, direction: { x: 0, y: 0, z: -1 } });
    installBow(world, { bows: BOWS, arrows: ARROWS, aim });
    installArrows(world.register(...HIT_VOLUME_COMPONENTS, PlacementComponent), {
      arrows: ARROWS,
      damage: new DamageModel(),
    });
    const e = world.spawn();
    giveActionTimeline(world, e);
    const chord = { held: 'secondaryAttack', press: 'primaryAttack', move: 'bash' } as const;
    giveActionInput(world, e, { primaryAttack: 'sword-light-1' }, [chord]);
    giveBow(world, e, { bow: 'shortbow', quiver: QUIVER });
    world.step([frame(['ability4'])]);
    expect(world.get(e, ActionInputComponent)).toEqual({ bindings: {}, chords: [chord] });
    world.step([frame(['ability4'])]);
    expect(world.get(e, ActionInputComponent)).toEqual({
      bindings: { primaryAttack: 'sword-light-1' },
      chords: [chord],
    });
  });
});

describe('the player’s aim (mw-e05.3)', () => {
  function aimed(pitch: number, anchor?: { x: number; y: number; z: number }) {
    const a = archer();
    const look = a.world.get(a.player, PlayerLook);
    a.world.set(a.player, PlayerLook, { yaw: look?.yaw ?? 0, pitch });
    if (anchor !== undefined) a.world.add(a.player, ViewAnchor, { point: anchor });
    return a;
  }

  it('looses from the camera’s shoulder along the look, half a metre out', () => {
    const a = aimed(0);
    const feet = a.world.get(a.player, CharacterController)?.position ?? { x: 0, y: 0, z: 0 };
    const shot = lookAim()(a.world, a.player, 60);
    expect(shot?.direction.x).toBeCloseTo(0, 12);
    expect(shot?.direction.y).toBeCloseTo(0, 12);
    expect(shot?.direction.z).toBeCloseTo(-1, 12);
    expect(shot?.origin.x).toBeCloseTo(feet.x + 0.5, 12);
    expect(shot?.origin.y).toBeCloseTo(feet.y + 1.5, 12);
    expect(shot?.origin.z).toBeCloseTo(feet.z - 0.5, 12);
  });

  it('pitch tilts the shot', () => {
    const a = aimed(Math.PI / 6);
    const shot = lookAim({ height: 1, right: 0, forward: 0 })(a.world, a.player, 60);
    expect(shot?.direction.y).toBeCloseTo(0.5, 12);
    expect(shot?.direction.z).toBeCloseTo(-Math.sqrt(3) / 2, 12);
  });

  it('locked on, it aims at the anchor raised by the arrow’s drop', () => {
    const a = aimed(0);
    const feet = a.world.get(a.player, CharacterController)?.position ?? { x: 0, y: 0, z: 0 };
    const point = { x: feet.x, y: feet.y + 1, z: feet.z - 20 };
    a.world.add(a.player, ViewAnchor, { point });
    const shot = lookAim({ height: 1, right: 0, forward: 0 }, 10)(a.world, a.player, 20);
    // 20 m at 20 m/s: 1 s, so ½·10·1² = 5 m of lead.
    const d = shot?.direction ?? { x: 0, y: 0, z: 0 };
    expect(d.y / -d.z).toBeCloseTo(5 / 20, 12);
  });

  it('locked on to its own nock point, it shoots along its look', () => {
    const a = aimed(0);
    const feet = a.world.get(a.player, CharacterController)?.position ?? { x: 0, y: 0, z: 0 };
    a.world.add(a.player, ViewAnchor, { point: { x: feet.x, y: feet.y + 1, z: feet.z } });
    const shot = lookAim({ height: 1, right: 0, forward: 0 })(a.world, a.player, 20);
    expect(shot?.direction).toEqual({ x: 0, y: 0, z: -1 });
  });

  it('no aim without a body and a look', () => {
    const world = new World<never>({ seed: 1 }).register(
      CharacterController,
      PlayerLook,
      ViewAnchor,
    );
    expect(lookAim()(world, world.spawn(), 60)).toBeUndefined();
  });

  it('a shot flies where the player looks', () => {
    const a = archer();
    a.shoot(48);
    const shot = a.fired[0];
    expect(shot?.velocity.x).toBeCloseTo(0, 9);
    expect(shot?.velocity.z).toBeCloseTo(-60, 9);
    expect(shot?.origin.x).toBeCloseTo(0.5, 9);
  });
});
