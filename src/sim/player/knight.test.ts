// The knight through the player (mw-e04.6): installPlayer with sword and shield, driven by
// ActionFrames the way the game drives it.
import type {
  ControllerTuning,
  Frozen,
  MoveTable,
  RuntimeMove,
  RuntimeShield,
} from '@content/index';
import { describe, expect, it } from 'vitest';
import { FakeCollisionWorld } from '../character/fake-collision-world';
import { box } from '../character/greybox';
import { CharacterController } from '../character/system';
import { DAMAGE_COMPONENTS, giveCombatant, healthOf } from '../combat/damage/components';
import { DamageModel } from '../combat/damage/model';
import {
  giveHurtboxes,
  HIT_VOLUME_COMPONENTS,
  liveHitboxes,
  type SocketTrack,
} from '../combat/hits/components';
import { hitVolumeSystem, noAllies } from '../combat/hits/system';
import { facingOf, guardOf } from '../combat/melee/components';
import { shieldGuard } from '../combat/melee/guard';
import { installMeleeStrikes } from '../combat/melee/strikes';
import { DamageApplied, type DamageResult } from '../combat/damage/events';
import { staminaOf } from '../combat/stamina';
import { ActionStarted, type ActionStartInfo } from '../combat/timeline/events';
import { World } from '../core/world';
import { IDENTITY_POSE } from '../geom';
import {
  actionButton,
  actionFrame,
  actionVector,
  IDLE_ACTION_FRAME,
  type ActionFrame,
  type ButtonAction,
} from '../input/action-frame';
import { atan2 } from '../math';
import type { SceneSpawnPlacement } from '../scene/layout';
import { SceneTransformComponent } from '../scene/loader';
import { PlacementComponent, placeEntity } from '../stimulus/placement';
import { LockOnComponent } from '../targeting/components';
import { lockedTarget, placedTargetPosition } from '../targeting/lock-on';
import { ParryComponent, updateParry } from '../combat/parry/components';
import {
  DEFAULT_HEAVY_BUTTON,
  DEFAULT_PARRY_BUTTON,
  installPlayer,
  KNIGHT_HEAVY_ATTACK,
  KNIGHT_KICK,
  KNIGHT_LIGHT_ATTACK,
  KNIGHT_PARRY,
  KNIGHT_RIPOSTE,
  KNIGHT_SHIELD_BASH,
  PlayerLook,
  restrainMovement,
  type PlayerMeleeOptions,
} from './player';

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
  absorption: { slash: 85, pierce: 85, blunt: 85, fire: 30 },
  stability: 60,
  raiseTicks: 6,
  arcDegrees: 120,
  moveSpeedScale: 0.5,
};

function light(
  id: string,
  frames: [number, number, number],
  cost: number,
  slash: number,
  next: string | null,
): RuntimeMove {
  const [startup, active, recovery] = frames;
  return {
    id,
    verb: 'attack',
    startup,
    active,
    recovery,
    totalTicks: startup + active + recovery,
    activeFrom: startup,
    recoveryFrom: startup + active,
    staminaCost: cost,
    cancelWindows: [],
    damage: {
      amounts: { slash },
      poiseDamage: 15,
      staminaDamage: 12,
      impulse: { x: 0, y: 0, z: 0 },
      impactForce: 0,
      tags: [],
    },
    hitbox: {
      track: 'still',
      shape: {
        kind: 'capsule',
        from: { x: 0.35, y: 1.2, z: 0.35 },
        to: { x: 0.35, y: 1.2, z: 1.45 },
        radius: 0.08,
      },
      reach: 'medium',
      swing: 'horizontal',
    },
    parryable: true,
    blockable: true,
    unblockable: false,
    interruptible: false,
    hyperarmor: null,
    iframes: null,
    telegraphTick: 0,
    hitStop: 'light',
    chainNext: next,
    charge: null,
    presentation: { anim: `anim-${id}` },
    motion: null,
  };
}

// The heavy and its charge (mw-e04.13), as content has them: 24/5/26, 25 stamina, 32 slash and 33
// poise; at full charge 35 stamina, 57.6 slash and 52.5 poise; hold on tick 18.
const HEAVY: RuntimeMove = {
  ...light('sword-heavy', [24, 5, 26], 25, 32, null),
  damage: {
    amounts: { slash: 32 },
    poiseDamage: 33,
    staminaDamage: 30,
    impulse: { x: 0, y: 0, z: 0 },
    impactForce: 1500,
    tags: [],
  },
  hyperarmor: { from: 10, to: 29, poiseCap: 40 },
  hitStop: 'heavy',
};
const CHARGED: RuntimeMove = {
  ...HEAVY,
  id: 'sword-heavy-charged',
  staminaCost: 35,
  damage: {
    amounts: { slash: 57.6 },
    poiseDamage: 52.5,
    staminaDamage: 45,
    impulse: { x: 0, y: 0, z: 0 },
    impactForce: 2500,
    tags: [],
  },
  hitStop: 'charged',
  charge: {
    from: 'sword-heavy',
    minHoldTicks: 12,
    fullHoldTicks: 60,
    autoReleaseTicks: 90,
    holdTick: 18,
  },
};

const MOVES: MoveTable = new Map(
  [
    HEAVY,
    CHARGED,
    light('sword-light-1', [12, 4, 18], 12, 20, 'sword-light-2'),
    light('sword-light-2', [10, 4, 20], 14, 22, 'sword-light-3'),
    light('sword-light-3', [16, 5, 26], 18, 30, null),
    light('poke', [2, 2, 2], 0, 1, null),
    light('bash', [14, 4, 20], 18, 5, null),
    light('kick', [10, 3, 16], 8, 3, null),
    {
      ...light('guard-parry', [4, 10, 16], 10, 0, null),
      verb: 'parry' as const,
      hitbox: null,
      damage: null,
    },
  ].map((m) => [m.id, m]),
);
const TRACKS = new Map<string, SocketTrack>([['still', { id: 'still', keys: [IDENTITY_POSE] }]]);

function frame(
  pressed: readonly ButtonAction[] = [],
  held: readonly ButtonAction[] = [],
  move: [number, number] = [0, 0],
) {
  return actionFrame({
    move: actionVector(move[0], move[1]),
    look: actionVector(0, 0),
    buttons: (b) =>
      actionButton(pressed.includes(b), pressed.includes(b) || held.includes(b), false),
  });
}

function knight(options: Partial<PlayerMeleeOptions> & { noShield?: true } = {}) {
  const { noShield, ...melee } = options;
  const collision = new FakeCollisionWorld([
    box({ x: -20, y: -1, z: -20 }, { x: 20, y: 0, z: 20 }), // floor, top at y = 0
  ]);
  const world = new World<ActionFrame>({ seed: 5 }).register(
    ...HIT_VOLUME_COMPONENTS,
    ...DAMAGE_COMPONENTS,
    PlacementComponent,
  );
  const player = installPlayer(world, {
    spawns: [START],
    collision,
    tuning: TUNING,
    combat: { moves: MOVES, melee: noShield ? melee : { shield: WOOD, ...melee } },
  });
  world.addSystem(hitVolumeSystem({ isAlly: noAllies }));
  const damage = new DamageModel();
  damage.register(shieldGuard());
  installMeleeStrikes(world, { moves: MOVES, tracks: TRACKS, damage });
  const dummy = world.spawn();
  placeEntity(world, dummy, { x: 0, y: 0, z: -1 }, 0.4);
  giveHurtboxes(world, dummy, {
    boxes: [
      {
        id: 'torso',
        socket: 'root',
        region: 'torso',
        armored: false,
        multiplier: 1,
        shape: {
          kind: 'capsule',
          from: { x: 0, y: 0.4, z: 0 },
          to: { x: 0, y: 1.4, z: 0 },
          radius: 0.4,
        },
      },
    ],
  });
  giveCombatant(world, dummy, { health: 200 });
  world.step([IDLE_ACTION_FRAME]); // settle onto the floor
  const started: ActionStartInfo[] = [];
  world.events.on(ActionStarted, (e) => started.push(e));
  const run = (ticks: number, input: ActionFrame = IDLE_ACTION_FRAME) => {
    for (let i = 0; i < ticks; i++) world.step([input]);
  };
  const state = () => {
    const value = world.get(player, CharacterController);
    if (value === undefined) throw new Error('no player');
    return value;
  };
  const speed = () => Math.sqrt(state().velocity.x ** 2 + state().velocity.z ** 2);
  return { world, player, dummy, started, run, state, speed };
}

describe('the knight player (mw-e04.6)', () => {
  it('AC-1: the attack button runs the light chain and restarts it after the third hit', () => {
    const k = knight();
    k.run(1, frame(['primaryAttack'])); // L1, 34 ticks
    k.run(29);
    k.run(1, frame(['primaryAttack'])); // buffered: L2 from its 34th tick
    k.run(33);
    k.run(1, frame(['primaryAttack'])); // L3
    k.run(50);
    k.run(1, frame(['primaryAttack'])); // chain over: L1
    expect(k.started.map((e) => e.move)).toEqual([
      'sword-light-1',
      'sword-light-2',
      'sword-light-3',
      'sword-light-1',
    ]);
    expect(KNIGHT_LIGHT_ATTACK).toBe('sword-light-1');
  });

  it('the chain’s three hits take 20 + 22 + 30 from a dummy 1 m ahead', () => {
    const k = knight();
    k.run(1, frame(['primaryAttack']));
    k.run(29);
    k.run(1, frame(['primaryAttack']));
    k.run(33);
    k.run(1, frame(['primaryAttack']));
    k.run(60);
    expect(healthOf(k.world, k.dummy)?.current).toBe(200 - 72);
  });

  it('mw-e04.12: with a parry, ability 3 (or its own button) parries; without one, nothing', () => {
    const k = knight({ parry: 'guard-parry' });
    k.run(1, frame(['ability3']));
    expect(k.started.map((e) => e.move)).toEqual(['guard-parry']);
    expect(DEFAULT_PARRY_BUTTON).toBe('ability3');
    expect([KNIGHT_PARRY, KNIGHT_RIPOSTE]).toEqual(['shield-parry', 'sword-riposte']);
    const custom = knight({ parry: 'guard-parry', parryButton: 'ability1' });
    custom.run(1, frame(['ability3']));
    custom.run(1, frame(['ability1']));
    expect(custom.started.map((e) => [e.tick, e.move])).toEqual([[2, 'guard-parry']]);
    const none = knight();
    none.run(1, frame(['ability3']));
    expect(none.started).toEqual([]);
  });

  it('mw-e04.12: with a riposte, the attack button ripostes a Parried foe in reach', () => {
    const k = knight({ riposte: 'poke' });
    k.world.register(ParryComponent);
    updateParry(k.world, k.dummy, { parried: { by: k.player, startedAt: 0, endsAt: 500 } });
    k.run(1);
    k.run(1, frame(['primaryAttack']));
    expect(k.started.map((e) => e.move)).toEqual(['poke']);
    const plain = knight({ riposte: 'poke' });
    plain.run(1, frame(['primaryAttack']));
    expect(plain.started.map((e) => e.move)).toEqual(['sword-light-1']);
  });

  it('a custom light attack binds instead', () => {
    const k = knight({ lightAttack: 'poke' });
    k.run(1, frame(['primaryAttack']));
    expect(k.started.map((e) => e.move)).toEqual(['poke']);
  });

  it('the block button raises the shield; behind it the knight walks at half speed and cannot sprint', () => {
    const k = knight();
    k.run(30, frame([], ['secondaryAttack', 'sprint'], [0, 1]));
    expect(guardOf(k.world, k.player)?.raisedAt).not.toBeNull();
    expect(staminaOf(k.world, k.player)?.blocking).toBe(true);
    expect(k.speed()).toBeCloseTo(2.5, 9);
    k.run(30, frame([], [], [0, 1]));
    expect(k.speed()).toBeCloseTo(5, 9);
  });

  it('a swing slows the knight: it still walks (at the attack scale) but cannot jump until the move ends', () => {
    const k = knight();
    k.run(30, frame([], [], [0, 1]));
    k.run(1, frame(['primaryAttack'], [], [0, 1]));
    k.run(15, frame(['jump'], [], [0, 1]));
    expect(k.speed()).toBeGreaterThan(0);
    expect(k.speed()).toBeLessThan(5 * 0.6 + 1e-6);
    expect(k.state().grounded).toBe(true);
    k.run(40, frame([], [], [0, 1]));
    expect(k.speed()).toBeCloseTo(5, 9);
  });

  it('it faces where it looks, keeps its placement at its feet and swings that way', () => {
    const k = knight();
    expect(facingOf(k.world, k.player)).toEqual({ x: 0, y: 0, z: -1 });
    k.run(20, frame([], [], [0, 1]));
    const at = k.world.get(k.player, PlacementComponent);
    expect(at?.z).toBeCloseTo(k.state().position.z, 12);
    expect(at?.radius).toBe(0.35);
    const look = k.world.get(k.player, PlayerLook);
    if (look === undefined) throw new Error('no look');
    k.world.set(k.player, PlayerLook, { ...look, yaw: -Math.PI / 2 }); // looking +x
    k.run(1);
    expect(facingOf(k.world, k.player).x).toBeCloseTo(1, 12);
  });

  it('with a lock-on target it faces the target, and turns toward it at 6° a tick in startup', () => {
    let locked = false;
    const k = knight({ target: (_w, e) => (locked ? e + 1 : undefined) }); // the dummy is spawned next
    k.run(1);
    expect(facingOf(k.world, k.player).z).toBeCloseTo(-1, 12);
    placeEntity(k.world, k.dummy, { x: 5, y: 0, z: 0 });
    locked = true;
    k.run(1, frame(['primaryAttack']));
    k.run(11);
    const f = facingOf(k.world, k.player);
    // 11 startup ticks after the start tick itself (which already turned 6°): 72° from −z toward +x.
    expect(atan2(f.x, -f.z) * (180 / Math.PI)).toBeCloseTo(72, 6);
    expect(liveHitboxes(k.world, k.player)).toEqual([]);
  });

  it('AC-1 (mw-e02.31): with lock-on 90° to the side, a light attack turns 6° a startup tick toward it, then locks', () => {
    const k = knight({ target: lockedTarget, locate: placedTargetPosition });
    k.world.register(SceneTransformComponent, LockOnComponent);
    // A lock target with only a scene transform (like the arena's dummies), 5 m to the knight's right.
    const target = k.world.spawn();
    k.world.add(target, SceneTransformComponent, {
      position: { x: 5, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    });
    k.run(1);
    expect(facingOf(k.world, k.player).z).toBeCloseTo(-1, 12); // no lock: faces its look (−z)
    k.world.add(k.player, LockOnComponent, { target, unseenTicks: 0, armed: true });
    const degrees = () => {
      const f = facingOf(k.world, k.player);
      return atan2(f.x, -f.z) * (180 / Math.PI);
    };
    const turned: number[] = [];
    k.run(1, frame(['primaryAttack'])); // sword-light-1: 12 startup ticks, from the start tick
    turned.push(degrees());
    for (let tick = 1; tick < 12; tick++) {
      k.run(1);
      turned.push(degrees());
    }
    turned.forEach((angle, i) => {
      expect(angle).toBeCloseTo(6 * (i + 1), 6);
    });
    // Active from move tick 12: the facing stays where startup left it through recovery.
    for (let tick = 12; tick < 34; tick++) {
      k.run(1);
      expect(degrees()).toBeCloseTo(72, 6);
    }
    // Idle again, it turns straight to the target.
    k.run(1);
    expect(degrees()).toBeCloseTo(90, 6);
  });

  it('restrainMovement leaves full-speed input untouched and a destroyed player unplaced', () => {
    const input = frame(['jump'], ['sprint'], [0, 1]);
    expect(restrainMovement(input, 1)).toBe(input);
    expect(restrainMovement(input, 0.5)).toMatchObject({
      move: { x: 0, y: 0.5 },
      sprint: { pressed: false, held: false },
      jump: { pressed: true },
    });
    const k = knight();
    k.world.destroy(k.player);
    expect(() => {
      k.run(2);
    }).not.toThrow();
  });
});

describe('the knight’s shield bash (mw-e04.14)', () => {
  const blockAttack = frame(['primaryAttack'], ['secondaryAttack']);

  it('attack while blocking bashes; without a bash it is the light attack', () => {
    const k = knight({ bash: 'bash', bashFallback: 'kick' });
    k.run(10, frame([], ['secondaryAttack']));
    k.run(1, blockAttack);
    k.run(60);
    k.run(1, frame(['primaryAttack']));
    expect(k.started.map((e) => e.move)).toEqual(['bash', 'sword-light-1']);
    expect([KNIGHT_SHIELD_BASH, KNIGHT_KICK]).toEqual(['shield-bash', 'kick']);
    const plain = knight();
    plain.run(1, blockAttack);
    expect(plain.started.map((e) => e.move)).toEqual(['sword-light-1']);
  });

  it('the kick button (mw-e04.18) starts the kick, with or without a shield, and only when given', () => {
    for (const noShield of [false, true]) {
      const k = knight({ kick: KNIGHT_KICK, ...(noShield && { noShield: true as const }) });
      k.run(1, frame(['kick']));
      expect(k.started.map((e) => e.move)).toEqual(['kick']);
    }
    const none = knight();
    none.run(1, frame(['kick']));
    expect(none.started).toEqual([]);
  });

  it('AC-4: with no shield equipped, block + attack kicks (and nothing blocks)', () => {
    const k = knight({ noShield: true, bash: 'bash', bashFallback: 'kick' });
    expect(guardOf(k.world, k.player)).toBeUndefined();
    k.run(5, frame([], ['secondaryAttack']));
    expect(staminaOf(k.world, k.player)?.blocking).toBe(false);
    k.run(1, blockAttack);
    expect(k.started.map((e) => e.move)).toEqual(['kick']);
    // Without a fallback the bash itself plays, shield or not.
    const bare = knight({ noShield: true, bash: 'bash' });
    bare.run(1, blockAttack);
    expect(bare.started.map((e) => e.move)).toEqual(['bash']);
  });
});

describe('the knight’s heavy attack (mw-e04.13)', () => {
  /** Holds the heavy button `ticks` ticks from a press, lets go and lets the swing land. */
  function heavy(ticks: number, melee: Partial<PlayerMeleeOptions> = {}) {
    const k = knight({ heavyAttack: KNIGHT_HEAVY_ATTACK, ...melee });
    const button = melee.heavyButton ?? DEFAULT_HEAVY_BUTTON;
    const applied: DamageResult[] = [];
    k.world.events.on(DamageApplied, (e) => applied.push(e));
    const before = staminaOf(k.world, k.player)?.current ?? 0;
    k.run(1, frame([button]));
    k.run(ticks - 1, frame([], [button]));
    k.run(1);
    const spent = before - (staminaOf(k.world, k.player)?.current ?? 0);
    k.run(60);
    return { ...k, applied, spent };
  }

  it('AC-1: held 60 ticks the heavy button swings the full charge: 1.8× the heavy, 3.5× light 1’s poise, 35 stamina', () => {
    const k = heavy(60);
    expect(k.started.map((e) => e.move)).toEqual(['sword-heavy']);
    expect(k.spent).toBe(35);
    expect(k.applied).toHaveLength(1);
    const [hit] = k.applied;
    expect(hit?.amounts.slash).toBeCloseTo(1.8 * 32, 9);
    expect(hit?.poiseDamage).toBeCloseTo(3.5 * 15, 9);
    expect(hit?.packet.impactForce).toBe(2500);
  });

  it('AC-2: let go after 8 ticks it is an uncharged heavy: 1.6× light 1’s damage and 2.2× its poise', () => {
    const k = heavy(8);
    expect(k.spent).toBe(25);
    const [hit] = k.applied;
    expect(hit?.amounts.slash).toBe(1.6 * 20);
    expect(hit?.poiseDamage).toBeCloseTo(2.2 * 15, 9);
    expect(hit?.packet.impactForce).toBe(1500);
  });

  it('the heavy binds to ability 1 by default, to its own button when given, and not at all without one', () => {
    expect([KNIGHT_HEAVY_ATTACK, DEFAULT_HEAVY_BUTTON]).toEqual(['sword-heavy', 'ability1']);
    const custom = heavy(8, { heavyButton: 'ability2' });
    expect(custom.started.map((e) => e.move)).toEqual(['sword-heavy']);
    const none = knight();
    none.run(1, frame(['ability1']));
    expect(none.started).toEqual([]);
  });
});
