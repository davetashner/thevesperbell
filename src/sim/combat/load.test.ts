// mw-e04.16: armor weight sets the roll, stamina regen, poise, absorption and footstep noise, through
// the shipped moves and the real player controller (installPlayer). The load class itself comes from
// the equipment rules (ADR-0003); these tests wear items and check what the player then does.
import type { ControllerTuning, Frozen, MoveTable, RuntimeMove, TickRange } from '@content/index';
import { describe, expect, it } from 'vitest';
import { FakeCollisionWorld } from '../character/fake-collision-world';
import { box } from '../character/greybox';
import {
  actionButton,
  actionFrame,
  actionVector,
  IDLE_ACTION_FRAME,
  type ActionFrame,
} from '../input/action-frame';
import {
  ACTION_TIMELINE_COMPONENTS,
  actionTimelineSystem,
  DodgeComponent,
  dodgeInputSystem,
  giveActionInput,
  giveActionTimeline,
  giveDodge,
  giveStamina,
  requestDodge,
  StaminaComponent,
  ActionRejected,
  addEquipment,
  addInventory,
  armorLoadSystem,
  CharacterController,
  CharacterEncumbrance,
  DAMAGE_COMPONENTS,
  DamageModel,
  DEFAULT_STAMINA_PROFILE,
  EquipmentRules,
  giveCombatant,
  InventoryRules,
  installPlayer,
  isInvulnerable,
  LocomotionEvents,
  loadStaminaProfile,
  poiseOf,
  setSprintHeld,
  staminaOf,
  World,
  actionOf,
  type ActionRejection,
  type EntityId,
  type EquipmentClassDef,
  type EquipmentItemDef,
  type InventoryItemDef,
  type LocomotionEvent,
  type SceneSpawnPlacement,
} from '../index';

/** A dodge RuntimeMove by hand (sim tests do not load content); the numbers are the shipped files'. */
function dodge(
  id: string,
  frames: readonly [number, number, number],
  iframes: TickRange | null,
  distance: number | null,
): RuntimeMove {
  const [startup, active, recovery] = frames;
  return Object.freeze({
    id,
    verb: 'dodge',
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
    iframes,
    telegraphTick: 0,
    hitStop: null,
    chainNext: null,
    charge: null,
    motion: distance === null ? null : { distance, direction: 'input' },
    presentation: { anim: `anim-${id}` },
  } as RuntimeMove);
}

// src/content/data/move/dodge-roll*.json and dodge-stumble.json (tests/integration/armor-load.test.ts
// checks the shipped files against these).
const MOVES: MoveTable = new Map(
  [
    dodge('dodge-roll', [2, 13, 21], { from: 2, to: 14 }, 3),
    dodge('dodge-roll-light', [2, 13, 21], { from: 2, to: 14 }, 3.6),
    dodge('dodge-roll-medium', [2, 11, 27], { from: 2, to: 12 }, 3),
    dodge('dodge-roll-heavy', [2, 9, 35], { from: 2, to: 10 }, 2.2),
    dodge('dodge-stumble', [20, 0, 0], null, null),
  ].map((m) => [m.id, m] as const),
);

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

const START: SceneSpawnPlacement = {
  id: 'player-start',
  position: { x: 0, y: 0, z: 0 },
  yaw: 180,
  rotation: { x: 0, y: 1, z: 0, w: 0 },
  prop: undefined,
  tags: ['player-start'],
};

type Def = EquipmentItemDef & Omit<InventoryItemDef, 'grants'>;

const PENALTY = { drawTimeMultiplier: 1.5, staminaCostMultiplier: 1.25, noiseMultiplier: 1 };

/** A body piece of `kg` kilograms, with optional absorption and poise. */
const body = (
  id: string,
  kg: number,
  extra: { absorption?: Partial<Record<'slash' | 'blunt', number>>; poise?: number } = {},
): Def => ({
  id,
  category: 'armor',
  stackable: false,
  flags: { unique: false, questItem: false },
  equip: { slot: 'body', proficiencies: [], nonProficient: PENALTY },
  armor: { weightKg: kg, ...extra },
});

const ITEMS: readonly Def[] = [
  body('rags', 3), // 10% of 30 kg
  body('nine', 9), // exactly 30%
  body('nine-and-a-bit', 9.03), // 30.1%
  body('plate-chest', 12, { absorption: { slash: 12 }, poise: 20 }),
  body('plate-set', 22), // 73%
  body('overweight', 31), // 103%
  body('overweight-105', 31.5), // 105%
];

const CLASSES: readonly EquipmentClassDef[] = [
  { id: 'knight', proficiencies: [], armorCapacityKg: 30 },
];

const FORWARD = [0, 1] as const;

function press(button: 'dodge' | null, move: readonly [number, number] = [0, 0], sprint = false) {
  return actionFrame({
    move: actionVector(move[0], move[1]),
    look: actionVector(0, 0),
    buttons: (b) =>
      b === 'sprint' && sprint
        ? actionButton(false, true, false)
        : actionButton(b === button, b === button, false),
  });
}

/** A knight on a floor, wearing `defId` (or nothing), with the armor load system. */
function knight(defId?: string, stamina = DEFAULT_STAMINA_PROFILE, equipped = true) {
  const collision = new FakeCollisionWorld([
    box({ x: -50, y: -1, z: -50 }, { x: 50, y: 0, z: 50 }),
  ]);
  const world = new World<ActionFrame>({ seed: 5 }).register(...DAMAGE_COMPONENTS);
  const equipment = new EquipmentRules(ITEMS, CLASSES);
  const player = installPlayer(world, {
    spawns: [START],
    collision,
    tuning: TUNING,
    combat: { moves: MOVES, equipment, stamina },
  });
  if (equipped) {
    addInventory(world, player);
    addEquipment(world, player, 'knight');
  }
  if (defId !== undefined) {
    const added = new InventoryRules(ITEMS).add(world, player, defId, 1);
    if (!added.ok) throw new Error('add failed');
    equipment.equip(world, player, added.instanceIds[0] ?? 0);
  }
  const rejected: ActionRejection[] = [];
  const footsteps: Extract<LocomotionEvent, { kind: 'footstep' }>[] = [];
  world.events.on(ActionRejected, (e) => rejected.push(e));
  world.events.on(LocomotionEvents, (e) => {
    if (e.kind === 'footstep') footsteps.push(e);
  });
  world.step([IDLE_ACTION_FRAME]); // settle, and apply the armor load
  const position = () => {
    const state = world.get(player, CharacterController);
    if (state === undefined) throw new Error('no player');
    return state.position;
  };
  /** Rolls forward from rest; returns the move, its length in ticks, i-frames and travel. */
  const roll = () => {
    const from = position();
    const start = world.tick;
    world.step([press('dodge', FORWARD)]);
    const move = actionOf(world, player)?.move;
    let iframes = 0;
    let ticks = 1;
    if (isInvulnerable(world, player, MOVES)) iframes++;
    while (actionOf(world, player) !== undefined && ticks < 100) {
      world.step([IDLE_ACTION_FRAME]);
      ticks++;
      if (actionOf(world, player) !== undefined && isInvulnerable(world, player, MOVES)) iframes++;
    }
    const to = position();
    return {
      move,
      ticks: world.tick - start - 1,
      iframes,
      metres: Math.sqrt((to.x - from.x) ** 2 + (to.z - from.z) ** 2),
    };
  };
  return { world, player, equipment, rejected, footsteps, roll, position };
}

describe('armor load changes the roll (mw-e04.16)', () => {
  it('AC-1: at exactly 30% load a roll is the light profile; at 30.1% the medium one', () => {
    const light = knight('nine');
    expect(light.equipment.state(light.world, light.player).loadRatio).toBe(0.3);
    expect(light.roll().move).toBe('dodge-roll-light');
    const medium = knight('nine-and-a-bit');
    expect(medium.roll().move).toBe('dodge-roll-medium');
  });

  it('AC-1: light 3.6 m / 13 i-frames / 36 ticks, medium 3.0 m / 11 / 40', () => {
    const light = knight('rags').roll();
    expect(light.iframes).toBe(13);
    expect(light.metres).toBeCloseTo(3.6, 6);
    expect(light.ticks).toBe(36);
    const medium = knight('nine-and-a-bit').roll();
    expect(medium.iframes).toBe(11);
    expect(medium.metres).toBeCloseTo(3.0, 6);
    expect(medium.ticks).toBe(40);
  });

  it('AC-2: a heavy load rolls 46 ticks, 2.2 m, 9 i-frames', () => {
    const { world, player, equipment, roll } = knight('plate-set');
    expect(equipment.state(world, player).loadClass).toBe('heavy');
    const result = roll();
    expect(result.move).toBe('dodge-roll-heavy');
    expect(result.ticks).toBe(46);
    expect(result.metres).toBeCloseTo(2.2, 6);
    expect(result.iframes).toBe(9);
  });

  it('an actor with no equipment keeps the knight’s own roll (36 ticks, 3.0 m, 13 i-frames)', () => {
    const result = knight(undefined, DEFAULT_STAMINA_PROFILE, false).roll();
    expect(result.move).toBe('dodge-roll');
    expect(result.metres).toBeCloseTo(3, 6);
    expect(result.iframes).toBe(13);
  });

  it('AC-3: at 105% a dodge is a 20-tick stumble with no i-frames and no travel, and sprint is off', () => {
    const { world, player, equipment, roll, rejected } = knight('overweight-105');
    expect(equipment.state(world, player).loadRatio).toBeCloseTo(1.05, 9);
    const result = roll();
    expect(result.move).toBe('dodge-stumble');
    expect(result.ticks).toBe(20);
    expect(result.iframes).toBe(0);
    expect(result.metres).toBeLessThan(0.02);
    expect(staminaOf(world, player)?.profile.noSprint).toBe(true);
    expect(setSprintHeld(world, player, true)).toBe(false);
    world.events.flush();
    expect(rejected.map((r) => [r.action, r.reason])).toEqual([['sprint', 'overloaded']]);
  });

  it('AC-3: with no direction held an overloaded backstep stumbles too', () => {
    const { world, player } = knight('overweight');
    world.step([press('dodge')]);
    expect(actionOf(world, player)?.move).toBe('dodge-stumble');
  });

  it('AC-3: an overloaded player is not given the sprint input', () => {
    const run = (defId: string | undefined) => {
      const { world, position } = knight(defId, DEFAULT_STAMINA_PROFILE, defId !== undefined);
      const z0 = position().z;
      for (let i = 0; i < 90; i++) world.step([press(null, FORWARD, true)]);
      return z0 - position().z;
    };
    const free = run(undefined);
    const loaded = run('overweight-105');
    expect(free).toBeGreaterThan(8.5);
    expect(loaded).toBeLessThan(7.5);
  });
});

describe('the dodge reads its own load moves (mw-e04.16)', () => {
  it('a world can name its own move per load class', () => {
    const { world, player } = knight('plate-set');
    const moves = { heavy: { roll: 'dodge-roll-light' } };
    world.step([press('dodge', FORWARD)]);
    expect(actionOf(world, player)?.move).toBe('dodge-roll-heavy');
    // The same press through requestDodge with custom moves.
    expect(
      requestDodge(world, player, actionVector(FORWARD[0], FORWARD[1]), undefined, {
        loadClass: 'heavy',
        moves,
      }),
    ).toBe('dodge-roll-light');
    expect(
      requestDodge(world, player, actionVector(0, 0), undefined, {
        loadClass: 'heavy',
        moves,
      }),
    ).toBe('backstep');
  });

  it('dodgeInputSystem uses the loadMoves option', () => {
    const world = new World<ActionFrame>({ seed: 3 }).register(
      StaminaComponent,
      ...ACTION_TIMELINE_COMPONENTS,
      DodgeComponent,
    );
    world.addSystem(
      dodgeInputSystem({
        loadClass: () => 'light',
        loadMoves: { light: { roll: 'dodge-roll-heavy' } },
      }),
    );
    const actor = world.spawn();
    giveStamina(world, actor);
    giveActionTimeline(world, actor);
    giveActionInput(world, actor, {});
    giveDodge(world, actor, { roll: 'dodge-roll', backstep: 'backstep' });
    world.addSystem(actionTimelineSystem({ moves: MOVES }));
    world.step([press('dodge', FORWARD)]);
    expect(actionOf(world, actor)?.move).toBe('dodge-roll-heavy');
  });
});

describe('armor load changes stamina and poise (mw-e04.16)', () => {
  it('stamina regen is x1.0 light and medium, x0.85 heavy, x0.7 overloaded', () => {
    const regen = (defId: string) => {
      const { world, player } = knight(defId);
      return staminaOf(world, player)?.profile.regenPerSecond;
    };
    expect(regen('rags')).toBe(40);
    expect(regen('nine-and-a-bit')).toBe(40);
    expect(regen('plate-set')).toBeCloseTo(34, 9);
    expect(regen('overweight')).toBeCloseTo(28, 9);
  });

  it('taking the armor off restores regen and sprint', () => {
    const { world, player, equipment } = knight('overweight');
    expect(staminaOf(world, player)?.profile.noSprint).toBe(true);
    equipment.unequip(world, player, 'body');
    world.step([IDLE_ACTION_FRAME]);
    const profile = staminaOf(world, player)?.profile;
    expect(profile?.regenPerSecond).toBe(40);
    expect(profile?.noSprint).toBeUndefined();
  });

  it('loadStaminaProfile leaves the profile itself for light and medium', () => {
    expect(loadStaminaProfile(DEFAULT_STAMINA_PROFILE, 'light')).toBe(DEFAULT_STAMINA_PROFILE);
    expect(loadStaminaProfile(DEFAULT_STAMINA_PROFILE, 'medium')).toBe(DEFAULT_STAMINA_PROFILE);
  });

  it('plate adds its poise to the maximum, and taking it off removes it', () => {
    const { world, player, equipment } = knight();
    giveCombatant(world, player, { health: 100, poise: 50 });
    world.step([IDLE_ACTION_FRAME]);
    expect(poiseOf(world, player)?.max).toBe(50);
    const added = new InventoryRules(ITEMS).add(world, player, 'plate-chest', 1);
    if (!added.ok) throw new Error('add failed');
    equipment.equip(world, player, added.instanceIds[0] ?? 0);
    world.step([IDLE_ACTION_FRAME]);
    world.step([IDLE_ACTION_FRAME]);
    expect(poiseOf(world, player)).toMatchObject({ max: 70, current: 70 });
    equipment.unequip(world, player, 'body');
    world.step([IDLE_ACTION_FRAME]);
    expect(poiseOf(world, player)).toMatchObject({ max: 50, current: 50 });
  });

  it('AC-4: plate with 12 flat slash absorption turns a 30-slash hit into 18', () => {
    const { world, player } = knight('plate-chest');
    giveCombatant(world, player, { health: 100, poise: 50 });
    world.step([IDLE_ACTION_FRAME]);
    const result = new DamageModel().apply(world, player, { amounts: { slash: 30 } });
    expect(result?.amounts.slash).toBe(18);
    expect(result?.healthAfter).toBe(82);
  });
});

describe('armor load sets footstep noise (mw-e04.16)', () => {
  it('AC-5: a player in plate emits footsteps carrying multiplier 1.6', () => {
    const { world, player, footsteps } = knight('plate-set');
    for (let i = 0; i < 90; i++) world.step([press(null, FORWARD)]);
    expect(world.get(player, CharacterEncumbrance)?.noise).toBe(1.6);
    expect(footsteps.length).toBeGreaterThan(2);
    expect(new Set(footsteps.map((f) => f.encumbrance))).toEqual(new Set([1.6]));
  });

  it('the load class sets the multiplier once: 1.0 light, 1.3 medium, 1.8 overloaded, 1 unarmored', () => {
    const noise = (defId?: string) => {
      const { world, player, footsteps } = knight(defId);
      for (let i = 0; i < 60; i++) world.step([press(null, FORWARD)]);
      expect(footsteps.length).toBeGreaterThan(0);
      return [world.get(player, CharacterEncumbrance)?.noise, footsteps[0]?.encumbrance];
    };
    expect(noise('rags')).toEqual([1, 1]);
    expect(noise('nine-and-a-bit')).toEqual([1.3, 1.3]);
    expect(noise('overweight')).toEqual([1.8, 1.8]);
    expect(noise()).toEqual([1, 1]);
  });
});

describe('the armor load system without equipment', () => {
  it('does nothing in a world with no equipment registered', () => {
    const world = new World<ActionFrame>({ seed: 1 });
    world.addSystem(armorLoadSystem({ equipment: new EquipmentRules(ITEMS, CLASSES) }));
    expect(() => {
      world.step([IDLE_ACTION_FRAME]);
    }).not.toThrow();
  });

  it('leaves an entity with no stamina, combat or encumbrance component alone', () => {
    const world = new World<ActionFrame>({ seed: 1 });
    const actor: EntityId = world.spawn();
    addInventory(world, actor);
    addEquipment(world, actor, 'knight');
    world.register(CharacterEncumbrance);
    world.addSystem(armorLoadSystem({ equipment: new EquipmentRules(ITEMS, CLASSES) }));
    expect(() => {
      world.step([IDLE_ACTION_FRAME]);
    }).not.toThrow();
    expect(world.get(actor, CharacterEncumbrance)?.noise).toBe(1);
  });
});
