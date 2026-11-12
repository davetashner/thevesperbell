// The player's traversal against its combat (mw-e02.13 climbing through installPlayer; mw-e02.33 no
// dodge, attack or block while the hands are on a ledge or a wall), driven by ActionFrames the way
// the game drives it.
import type {
  ControllerTuning,
  Frozen,
  MoveTable,
  RuntimeMove,
  RuntimeShield,
} from '@content/index';
import { describe, expect, it } from 'vitest';
import { SKIN } from '../character/controller';
import { FakeCollisionWorld } from '../character/fake-collision-world';
import { CharacterController } from '../character/system';
import { climbRefused, DEFAULT_CLIMB_TUNING, type ClimbRefused } from '../climb/climb';
import { sceneLedges } from '../climb/ledges';
import { ClimbRopeComponent, spawnRope } from '../climb/ropes';
import { DEFAULT_LEDGE_TUNING, LEDGE_HANG_CAPABILITY } from '../climb/mantle';
import { ActionRejected, type ActionRejection } from '../combat/actions';
import { DAMAGE_COMPONENTS } from '../combat/damage/components';
import { HIT_VOLUME_COMPONENTS } from '../combat/hits/components';
import { guardOf } from '../combat/melee/components';
import { StaminaComponent, staminaOf } from '../combat/stamina';
import { ActionStarted, type ActionStartInfo } from '../combat/timeline/events';
import { handsBusy } from '../combat/timeline/timeline';
import { World } from '../core/world';
import { at as nth } from '../geom/vec';
import {
  actionButton,
  actionFrame,
  actionVector,
  IDLE_ACTION_FRAME,
  type ActionFrame,
  type ButtonAction,
} from '../input/action-frame';
import { PhysicsColliderComponent } from '../physics/objects';
import { InMemoryColliderSink } from '../physics/static-colliders';
import { addProperties, registerWorldProperties } from '../properties/components';
import { testKit, TEST_SCENE } from '../scene/fixtures';
import { loadScene, registerSceneComponents } from '../scene/loader';
import { PlacementComponent } from '../stimulus/placement';
import { installPlayer, type PlayerOptions } from './player';

const BASE: Frozen<ControllerTuning> = {
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
const TUNING: Frozen<ControllerTuning> = {
  ...BASE,
  ledge: DEFAULT_LEDGE_TUNING,
  climb: DEFAULT_CLIMB_TUNING,
};

/** A RuntimeMove as compileMove builds it (sim tests may not load content, so by hand). */
function move(
  id: string,
  verb: RuntimeMove['verb'],
  frames: [number, number, number],
  cost: number,
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
    staminaCost: cost,
    cancelWindows: [],
    damage: null,
    hitbox: null,
    parryable: false,
    blockable: false,
    unblockable: false,
    interruptible: false,
    hyperarmor: null,
    iframes: verb === 'dodge' ? { from: 2, to: 14 } : null,
    telegraphTick: 0,
    hitStop: null,
    chainNext: null,
    charge: null,
    presentation: { anim: `anim-${id}` },
    motion: verb === 'dodge' ? { distance: 3, direction: 'input' } : null,
  };
}

const MOVES: MoveTable = new Map(
  [
    move('dodge-roll', 'dodge', [2, 13, 21], 20),
    move('backstep', 'dodge', [2, 6, 16], 12),
    move('sword-light-1', 'attack', [12, 4, 18], 12),
  ].map((m) => [m.id, m]),
);

const WOOD: RuntimeShield = {
  id: 'wood-shield',
  kind: 'shield',
  absorption: { slash: 85, pierce: 85, blunt: 85, fire: 30 },
  stability: 60,
  raiseTicks: 6,
  arcDegrees: 120,
  moveSpeedScale: 0.5,
};

function frame(
  pressed: readonly ButtonAction[] = [],
  held: readonly ButtonAction[] = [],
  move: [number, number] = [0, 0],
): ActionFrame {
  return actionFrame({
    move: actionVector(move[0], move[1]),
    look: actionVector(0, 0),
    buttons: (b) =>
      actionButton(pressed.includes(b), pressed.includes(b) || held.includes(b), false),
  });
}

const FORWARD = frame([], [], [0, 1]);
const JUMP_FORWARD = frame(['jump'], [], [0, 1]);

interface RoomOptions {
  /** Height of the 2 × 2 m block 1 m ahead of the player start. */
  readonly height: number;
  /** World properties of the block (e.g. a ladder's grade). */
  readonly block?: Parameters<typeof addProperties>[2];
  readonly tuning?: Frozen<ControllerTuning>;
  readonly ledgeCapabilities?: readonly string[];
  /** Give the player climbing (mw-e02.13). */
  readonly climb?: PlayerOptions['climb'];
  /** Give the player its knight moves (stamina, dodge, sword and shield). */
  readonly combat?: boolean;
  /** A rope hanging 0.5 m in front of the player start, its component registered by the scene. */
  readonly rope?: boolean;
}

/** The test room with a block ahead of the player start (which faces it), colliders bound to it. */
function room(options: RoomOptions) {
  const { height } = options;
  const scene = {
    ...TEST_SCENE,
    placements: [
      { piece: { id: 'floor' }, at: [0, 0, 0], yaw: 0, scale: [5, 1, 5] },
      // The floor piece stretched up into a 2 × 2 m block.
      { piece: { id: 'floor' }, at: [0, height, 0], yaw: 0, scale: [1, height / 0.2, 1] },
    ],
  } as const;
  const world = registerWorldProperties(
    registerSceneComponents(new World<ActionFrame>({ seed: 3 })),
  ).register(PhysicsColliderComponent, ...HIT_VOLUME_COMPONENTS, ...DAMAGE_COMPONENTS);
  world.register(PlacementComponent);
  const loaded = loadScene(world, scene, testKit, new InMemoryColliderSink());
  // Bind each solid part's collider (fake body n is the scene's collider n) to its piece.
  let next = 0;
  for (const part of loaded.layout.parts) {
    if (part.collider === undefined) continue;
    const handle = nth(loaded.colliders, next++);
    world.add(nth(loaded.pieces, part.placement), PhysicsColliderComponent, {
      colliders: [handle],
    });
  }
  if (options.rope === true) {
    world.register(ClimbRopeComponent);
    spawnRope(world, { anchor: { x: 0, y: 3, z: -1.5 }, length: 3 });
  }
  const block = nth(loaded.pieces, 1);
  if (options.block !== undefined) addProperties(world, block, options.block);
  const collision = new FakeCollisionWorld(
    loaded.layout.parts.flatMap((part) => part.collider ?? []),
  );
  const player = installPlayer(world, {
    spawns: loaded.layout.spawns,
    collision,
    tuning: options.tuning ?? TUNING,
    ledges: {
      index: sceneLedges(loaded),
      ...(options.ledgeCapabilities !== undefined && { capabilities: options.ledgeCapabilities }),
    },
    ...(options.climb !== undefined && { climb: options.climb }),
    ...(options.combat === true && { combat: { moves: MOVES, melee: { shield: WOOD } } }),
  });
  world.step([IDLE_ACTION_FRAME]); // the first tick finds the ground
  const started: ActionStartInfo[] = [];
  world.events.on(ActionStarted, (e) => started.push(e));
  const rejected: ActionRejection[] = [];
  world.events.on(ActionRejected, (e) => rejected.push(e));
  const state = () => {
    const value = world.get(player, CharacterController);
    if (value === undefined) throw new Error('no player');
    return value;
  };
  const run = (ticks: number, input: ActionFrame = IDLE_ACTION_FRAME) => {
    for (let i = 0; i < ticks; i++) world.step([input]);
  };
  const stamina = () => staminaOf(world, player)?.current;
  return { world, player, block, state, run, started, rejected, stamina };
}

describe('climbing through the player (mw-e02.13)', () => {
  it('AC-1: the player walks into a ladder-marked wall, climbs it at 1.2 m/s and pulls up on top', () => {
    const r = room({ height: 3, block: { climbable: 'ladder' }, climb: {} });
    let ticks = 0;
    while (r.state().traversal !== 'climb' && ticks++ < 60) r.run(1, FORWARD);
    expect(r.state().traversal).toBe('climb');
    const from = r.state().position.y;
    r.run(30, FORWARD);
    expect(r.state().position.y - from).toBeCloseTo(1.2 * 0.5, 9);
    ticks = 0;
    while (!(r.state().traversal === null && r.state().grounded) && ticks++ < 120) {
      r.run(1, FORWARD);
    }
    expect(r.state().position.z).toBeGreaterThan(-1);
    expect(r.state()).toMatchObject({ traversal: null, grounded: true });
    expect(r.state().position.y).toBeCloseTo(3 + SKIN, 9);
  });

  it('AC-2: a rough wall needs the climbing capability the player is given', () => {
    const plain = room({ height: 3, block: { climbable: 'rough' }, climb: {} });
    plain.run(20, FORWARD);
    plain.run(1, JUMP_FORWARD);
    plain.run(10, FORWARD);
    expect(plain.state().traversal).toBeNull();
    const thief = room({
      height: 3,
      block: { climbable: 'rough' },
      climb: { capabilities: ['verb.climb.rough'] },
    });
    thief.run(20, FORWARD);
    thief.run(1, JUMP_FORWARD);
    expect(thief.state().traversal).toBe('climb');
  });

  it('AC-5: climbing drains the stamina pool at 5 a second; at 0 the player slips and falls', () => {
    const r = room({ height: 3, block: { climbable: 'ladder' }, climb: {}, combat: true });
    let ticks = 0;
    while (r.state().traversal !== 'climb' && ticks++ < 60) r.run(1, FORWARD);
    const full = r.stamina() ?? 0;
    r.run(60);
    expect(r.state().traversal).toBe('climb');
    expect(full - (r.stamina() ?? 0)).toBeCloseTo(5, 6);
    // Nearly spent: the next ticks empty it and the grip gives.
    const pool = staminaOf(r.world, r.player);
    if (pool === undefined) throw new Error('no pool');
    r.world.set(r.player, StaminaComponent, { ...pool, current: 0.1 });
    r.run(3);
    expect(r.stamina()).toBe(0);
    expect(r.state().traversal).toBeNull();
    expect(r.state().grounded).toBe(false);
  });

  it('AC-4: a rope the scene already spawned (its component registered) climbs through the player', () => {
    const r = room({ height: 0.2, climb: {}, rope: true });
    r.run(1, FORWARD);
    expect(r.state().traversal).toBe('climb');
    r.run(30, FORWARD);
    expect(r.state().position.y).toBeCloseTo(SKIN + 0.5, 6);
  });

  it('a profile that drains nothing leaves the pool alone while climbing', () => {
    const tuning = { ...TUNING, climb: { ...DEFAULT_CLIMB_TUNING, staminaPerSecond: 0 } };
    const r = room({ height: 3, block: { climbable: 'ladder' }, climb: {}, combat: true, tuning });
    let ticks = 0;
    while (r.state().traversal !== 'climb' && ticks++ < 60) r.run(1, FORWARD);
    const full = r.stamina();
    r.run(60);
    expect(r.state().traversal).toBe('climb');
    expect(r.stamina()).toBe(full);
  });

  it('without a climb block in the profile the sim’s defaults drain the pool', () => {
    const r = room({
      height: 3,
      block: { climbable: 'ladder' },
      climb: {},
      combat: true,
      tuning: { ...BASE, ledge: DEFAULT_LEDGE_TUNING },
    });
    let ticks = 0;
    while (r.state().traversal !== 'climb' && ticks++ < 60) r.run(1, FORWARD);
    const full = r.stamina() ?? 0;
    r.run(60);
    expect(full - (r.stamina() ?? 0)).toBeCloseTo(DEFAULT_CLIMB_TUNING.staminaPerSecond, 6);
  });
});

describe('climb difficulty through the player (mw-e10.9)', () => {
  const GRANTS = new Map([['verb.climb.rough', 3]]);

  it('AC-1: a thief whose capability grants difficulty 3 climbs a difficulty-2 wall', () => {
    const thief = room({
      height: 3,
      block: { climbable: 'rough' },
      climb: { capabilities: ['verb.climb.rough'], difficulty: GRANTS },
    });
    thief.run(20, FORWARD);
    thief.run(1, JUMP_FORWARD);
    expect(thief.state().traversal).toBe('climb');
  });

  it('AC-2: a knight (best difficulty 1) is refused the same wall with a prompt, whatever it holds', () => {
    const knight = room({
      height: 3,
      block: { climbable: 'rough' },
      climb: { capabilities: ['verb.climb.rough'], difficulty: new Map() },
    });
    const refused: ClimbRefused[] = [];
    knight.world.events.on(climbRefused, (event) => refused.push(event));
    knight.run(20, FORWARD);
    knight.run(1, JUMP_FORWARD);
    knight.run(10, FORWARD);
    expect(knight.state().traversal).toBeNull();
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({
      refusal: { reason: 'too-difficult', difficulty: 2, max: 1 },
      text: 'Too hard for you to climb',
    });
    // The easy grades are still its to climb.
    const ladder = room({
      height: 3,
      block: { climbable: 'ladder' },
      climb: { difficulty: new Map() },
    });
    let ticks = 0;
    while (ladder.state().traversal !== 'climb' && ticks++ < 60) ladder.run(1, FORWARD);
    expect(ladder.state().traversal).toBe('climb');
  });

  it('climbing drains stamina by the surface’s difficulty: 5 a second on a ladder, 7.5 on rough stone', () => {
    const drain = (grade: 'ladder' | 'rough') => {
      const r = room({
        height: 6,
        block: { climbable: grade },
        climb: { capabilities: ['verb.climb.rough'] },
        combat: true,
      });
      r.run(20, FORWARD);
      if (grade === 'rough') r.run(1, JUMP_FORWARD);
      let ticks = 0;
      while (r.state().traversal !== 'climb' && ticks++ < 60) r.run(1, FORWARD);
      const before = r.stamina() ?? 0;
      r.run(60);
      expect(r.state().traversal).toBe('climb');
      return before - (r.stamina() ?? 0);
    };
    expect(drain('ladder')).toBeCloseTo(5, 6);
    expect(drain('rough')).toBeCloseTo(7.5, 6);
  });
});

describe('no combat while traversing (mw-e02.33)', () => {
  it('AC-1: hanging from a ledge, dodge, attack and block start nothing and cost no stamina', () => {
    const r = room({ height: 2.1, ledgeCapabilities: [LEDGE_HANG_CAPABILITY], combat: true });
    r.run(1, JUMP_FORWARD);
    r.run(20);
    expect(r.state().traversal).toBe('hang');
    expect(handsBusy(r.world, r.player)).toBe(true);
    const before = r.stamina();
    r.run(1, frame(['dodge']));
    r.run(1, frame(['primaryAttack']));
    r.run(20, frame([], ['secondaryAttack']));
    expect(r.started).toEqual([]);
    expect(r.stamina()).toBe(before);
    expect(guardOf(r.world, r.player)?.raisedAt ?? null).toBeNull();
    expect(r.rejected.map((e) => [e.action, e.reason])).toEqual([
      ['dodge', 'traversal'],
      ['attack', 'traversal'],
    ]);
    expect(r.state().traversal).toBe('hang');
  });

  it('AC-2: mid-mantle a dodge press starts nothing; once the mantle ends a new press dodges', () => {
    const r = room({ height: 1.4, combat: true });
    r.run(1, JUMP_FORWARD);
    expect(r.state().traversal).toBe('mantle');
    r.run(1, frame(['dodge']));
    r.run(5);
    expect(r.started).toEqual([]);
    expect(r.rejected.map((e) => e.reason)).toEqual(['traversal']);
    let ticks = 0;
    while (r.state().traversal !== null && ticks++ < 120) r.run(1);
    expect(r.state().grounded).toBe(true);
    expect(handsBusy(r.world, r.player)).toBe(false);
    r.run(1, frame(['dodge']));
    expect(r.started.map((e) => e.move)).toEqual(['backstep']);
  });

  it('a world without characters never has busy hands', () => {
    const world = new World<never>({ seed: 1 });
    expect(handsBusy(world, world.spawn())).toBe(false);
  });
});
