// The player in the sim (mw-e02.23): the character the ActionFrames drive. Installing the player adds
// one entity at the scene's player-start spawn with a CharacterController and a PlayerLook, and two
// systems run each tick in this order: look (mouse and right stick) turns the player's view yaw, then
// the character controller moves it with the tick's ActionFrame and that yaw.
//
// With `combat` (mw-e04.8) the player also gets a stamina pool, an action timeline and a dodge, and
// four systems run between look and the controller: stamina, dodge input (a dodge press rolls in the
// held direction relative to the view yaw, or backsteps), the action timeline, and dodge motion,
// whose root-motion velocity the controller travels at while a roll or backstep runs.
//
// With `combat.melee` (mw-e04.6) the player is also a knight: the attack button starts the light
// chain (or, with a riposte, the riposte while a Parried foe is in reach: mw-e04.12), the heavy
// button its heavy attack (held, it charges: mw-e04.13), the parry button its parry, the block button
// holds its shield up, attack while blocking bashes with it (or, with no shield, kicks: mw-e04.14),
// and it has a combat facing, hitboxes and a placement
// at its feet (the frame its swings are placed in). Three more systems join: block (just before the
// timeline), facing (after it: idle the knight faces where it looks — or its lock-on target — and a
// move's startup turns at 360°/s, then locks) and, after the controller, placement. While it swings
// the knight is planted and while its shield is up it walks at the shield's speed without sprinting
// (`locomotionScale`). The caller registers the hit-volume, damage and placement components, and
// adds the hit-volume system and `installMeleeStrikes` itself (they are world-wide, not the player's).
//
// With `ledges` (mw-e02.12) the controller runs the mantle and ledge-hang traversal hook over the
// scene's ledges (src/sim/climb/mantle.ts): the player mantles onto crates and sills, and with the
// ledge-hang capability grabs, hangs from and shimmies along higher ledges.
//
// With `climb` (mw-e02.13) it also runs the climbing hook (src/sim/climb/climb.ts), after the ledge
// hook: the player climbs ladders, ropes and ivy, and with the climbing capability rough walls, and
// pulls up onto the ledge at the top. With combat, climbing drains the stamina pool (the climb
// tuning's staminaPerSecond, after the controller), and at 0 the player falls. While any traversal
// mode has the player (mantle, hang, climb), no dodge, attack, block or bow draw starts: the action
// timeline's one gate, `handsBusy` (mw-e02.33).
//
// After the controller, the locomotion system (mw-e02.6) publishes what the player is doing — idle,
// walk, run, airborne, landing… — with its speeds and turn rate, and emits jump, land and footstep
// events, for animation and audio to follow. The player counts as moving while move input is held or
// a dodge's root motion carries it; its facing is the look yaw.
//
// The view yaw and pitch live in the sim (not in the camera) so a replay of ActionFrames alone
// reproduces every turn: the recorded look input (mouse counts, stick deflection) is their only source. Pitch does not move
// the player today, but aiming will (bow, spells: mw-e05.3, mw-e06.15), so it is clamped here once,
// as a rule, rather than in the camera. The orbit camera (src/game/camera, mw-e02.4) only reads them.
//
// While the player has a ViewAnchor (lock-on, mw-e02.16, src/sim/targeting) the lock-on system owns
// the view: look input does not turn it, and the controller strafes around the anchor point.

import type { ControllerTuning, Frozen, MoveTable, RuntimeShield } from '@content/index';
import { statusMoveScale, type StatusLookup } from '../magic/statuses';
import { initialCharacterState, SKIN } from '../character/controller';
import type { CollisionWorld } from '../character/collision-world';
import { carryRestraint, refuseGrab } from '../carry/state';
import { pushRestraint } from '../push/state';
import { radians } from '../character/greybox';
import {
  CharacterController,
  characterControllerSystem,
  CharacterTuning,
  characterTuning,
  spawnCharacter,
} from '../character/system';
import { CharacterLocomotion, giveLocomotion, locomotionSystem } from '../character/locomotion';
import { DEFAULT_ARROW_RULES } from '../combat/arrows/ballistics';
import type { ArrowLookup } from '../combat/arrows/system';
import { giveBow, type BowLoadout } from '../combat/bow/components';
import {
  bowLocomotionScale,
  installBow,
  type BowAim,
  type BowButtons,
  type BowLookup,
} from '../combat/bow/system';
import { DodgeComponent, giveDodge, type DodgeMoves } from '../combat/dodge/components';
import { dodgeInputSystem, dodgeMotionSystem, type DodgeFacing } from '../combat/dodge/dodge';
import {
  DEFAULT_STAMINA_PROFILE,
  drainStamina,
  giveStamina,
  StaminaComponent,
  staminaSystem,
  type StaminaProfile,
} from '../combat/stamina';
import {
  ACTION_TIMELINE_COMPONENTS,
  giveActionInput,
  giveActionTimeline,
  type ActionChord,
} from '../combat/timeline/components';
import { actionTimelineSystem } from '../combat/timeline/timeline';
import { giveHitboxes } from '../combat/hits/components';
import { giveFacing, giveGuard, MELEE_COMPONENTS } from '../combat/melee/components';
import {
  faceTarget,
  facingSystem,
  firstFacing,
  type EntityLocator,
  type FacingRule,
} from '../combat/melee/facing';
import { bashRedirect, firstRedirect } from '../combat/melee/bash';
import {
  blockSystem,
  DEFAULT_BLOCK_BUTTON,
  isAttacking,
  locomotionScale,
} from '../combat/melee/guard';
import { riposteRedirect } from '../combat/parry/parry';
import { placeEntity, PlacementComponent } from '../stimulus/placement';
import { defineComponent, type EntityId } from '../core/component';
import type { System, World } from '../core/world';
import { hasCheat } from '../debug/cheats';
import {
  actionButton,
  actionFrameOf,
  type ActionFrame,
  type ActionVector,
  type ButtonAction,
} from '../input/action-frame';
import { cos, pow, sin } from '../math';
import { climbTraversal, DEFAULT_CLIMB_TUNING } from '../climb/climb';
import type { LedgeIndex } from '../climb/ledges';
import { ledgeTraversal, type LedgeTraversalHook } from '../climb/mantle';
import { ClimbRopeComponent } from '../climb/ropes';
import {
  CharacterBreath,
  DEFAULT_WATER_TUNING,
  giveBreath,
  waterDepthAt,
  waterSystem,
  waterTraversal,
  WATER_MATERIAL,
  type WaterVolume,
} from '../character/water';
import type { LoadClass } from '../inventory/equipment';
import { capabilitiesOf } from '../progression/capabilities';
import type { TraversalHook } from '../character/traversal';
import type { SceneSpawnPlacement } from '../scene/layout';
import type { Vec3 } from '../stimulus/shapes';
import { LockOnComponent, NO_LOCK } from '../targeting/components';

/** The tag that marks a scene's player spawn. */
export const PLAYER_START_TAG = 'player-start';

/** Radians of yaw per mouse count (the same feel as the debug camera until settings, mw-e31). */
export const PLAYER_LOOK_SENSITIVITY = 0.003;

/** Metres below the lowest authored scene geometry before a fall resets the player. */
export const PLAYER_FALL_RESET_MARGIN = 10;

/**
 * Where the player looks. Yaw is about +y, radians in (−π, π]; 0 looks along −z, positive turns
 * left. Pitch is radians above the horizon (positive looks up), within the look settings' limits.
 */
export interface PlayerLook {
  readonly yaw: number;
  readonly pitch: number;
}

export const PlayerLook = defineComponent<PlayerLook>('player.look');

/**
 * The point the player's view and movement are anchored on (a locked target, mw-e02.16): look input
 * is ignored and movement strafes around it. Written by the lock-on system; absent otherwise.
 */
export interface ViewAnchor {
  /** World position, metres. */
  readonly point: Vec3;
}

export const ViewAnchor = defineComponent<ViewAnchor>('player.anchor');

const TAU = 2 * Math.PI;

/** `yaw` wrapped into (−π, π]. */
export function wrapYaw(yaw: number): number {
  const wrapped = yaw - TAU * Math.round(yaw / TAU);
  return wrapped <= -Math.PI ? wrapped + TAU : wrapped;
}

/**
 * The look yaw that faces a spawn's direction. A scene yaw of 0 faces +z and turns counter-clockwise
 * seen from above; look yaw 0 faces −z, so the two differ by a half turn.
 */
export function spawnYaw(spawn: Pick<SceneSpawnPlacement, 'yaw'>): number {
  return wrapYaw(radians(spawn.yaw) + Math.PI);
}

/** The scene's player spawn: the first one tagged `player-start`, if any. */
export function playerStart(
  spawns: readonly SceneSpawnPlacement[],
): SceneSpawnPlacement | undefined {
  return spawns.find((spawn) => spawn.tags.includes(PLAYER_START_TAG));
}

/**
 * Where the player stands when a scene opens: the spawn called `startSpawn` when one is asked for
 * (an area transition's arrival, mw-e01.11), else the `player-start`. Undefined when the scene lacks
 * the spawn asked for, or has no start.
 */
export function playerSpawn(
  spawns: readonly SceneSpawnPlacement[],
  startSpawn?: string,
): SceneSpawnPlacement | undefined {
  return startSpawn === undefined ? playerStart(spawns) : spawns.find((s) => s.id === startSpawn);
}

/**
 * How an analog stick turns the view (rate-based: a held deflection turns at a steady speed). The
 * gamepad's right stick feeds it through the ActionFrame's `lookStick` (mw-e02.9).
 */
export interface StickLookSettings {
  /** Deflection at or below this (0–1, radial) is ignored. */
  readonly deadzone: number;
  /** Response curve exponent over the live range: 1 is linear, 2 gives finer aim near centre. */
  readonly exponent: number;
  /** Turn rate at full deflection, radians per second. */
  readonly yawRate: number;
  /** Pitch rate at full deflection, radians per second. */
  readonly pitchRate: number;
}

/** How look input turns the view. The game passes the camera content's values (mw-e02.4). */
export interface LookSettings {
  /** Mouse: radians per mouse count, both axes (a delta, so no time scaling). */
  readonly sensitivity: number;
  /** Looking up (mouse or stick) looks down. */
  readonly invertY: boolean;
  /** Lowest pitch, radians (looking down); ≤ 0. */
  readonly minPitch: number;
  /** Highest pitch, radians (looking up); ≥ 0. */
  readonly maxPitch: number;
  readonly stick: StickLookSettings;
}

/** The defaults: the bead's clamp of −70°..+60° (mw-e02.4 AC-1). */
export const DEFAULT_LOOK_SETTINGS: LookSettings = Object.freeze({
  sensitivity: PLAYER_LOOK_SENSITIVITY,
  invertY: false,
  minPitch: radians(-70),
  maxPitch: radians(60),
  stick: Object.freeze({
    deadzone: 0.15,
    exponent: 2,
    yawRate: radians(240),
    pitchRate: radians(160),
  }),
});

/** One tick of look input, from any device: x right, y up. */
export interface LookInput {
  /** Mouse movement this tick, raw counts. */
  readonly mouse?: ActionVector;
  /** Stick deflection, each axis −1..1. */
  readonly stick?: ActionVector;
}

/** A view turn, radians: yaw (positive turns left) and pitch (positive looks up). */
export interface LookTurn {
  readonly yaw: number;
  readonly pitch: number;
}

/** The stick's rate as a fraction of full speed per axis, after the deadzone and response curve. */
export function stickResponse(stick: ActionVector, settings: StickLookSettings): ActionVector {
  const length = Math.sqrt(stick.x * stick.x + stick.y * stick.y);
  if (length <= settings.deadzone) return { x: 0, y: 0 };
  const live = (Math.min(1, length) - settings.deadzone) / (1 - settings.deadzone);
  const scale = pow(live, settings.exponent) / length;
  return { x: stick.x * scale, y: stick.y * scale };
}

/**
 * How far `input` turns the view in one tick of `dt` seconds: mouse counts × sensitivity (a delta),
 * plus the stick's response × its rates × dt (a rate). Moving right turns right; up looks up.
 */
export function lookTurn(input: LookInput, settings: LookSettings, dt: number): LookTurn {
  const up = settings.invertY ? -1 : 1;
  let yaw = 0;
  let pitch = 0;
  if (input.mouse !== undefined) {
    yaw -= input.mouse.x * settings.sensitivity;
    pitch += input.mouse.y * settings.sensitivity * up;
  }
  if (input.stick !== undefined) {
    const rate = stickResponse(input.stick, settings.stick);
    yaw -= rate.x * settings.stick.yawRate * dt;
    pitch += rate.y * settings.stick.pitchRate * dt * up;
  }
  return { yaw: yaw + 0, pitch: pitch + 0 };
}

/** `pitch` clamped to the settings' limits. */
export function clampPitch(
  pitch: number,
  { minPitch, maxPitch }: Pick<LookSettings, 'minPitch' | 'maxPitch'>,
): number {
  return Math.min(maxPitch, Math.max(minPitch, pitch));
}

/**
 * Turns every PlayerLook by the tick's look input (see `lookTurn`): the ActionFrame's mouse counts
 * and right-stick deflection together. Pitch stops at the limits. Anchored views (ViewAnchor, which
 * the world must have registered) do not turn.
 */
export function playerLookSystem<TInput>(
  settings: LookSettings = DEFAULT_LOOK_SETTINGS,
): System<TInput> {
  return {
    name: 'player-look',
    run({ world, inputs, clock }) {
      const frame = actionFrameOf(inputs);
      if (frame === undefined) return;
      const turn = lookTurn({ mouse: frame.look, stick: frame.lookStick }, settings, 1 / clock.hz);
      if (turn.yaw === 0 && turn.pitch === 0) return;
      world.query(PlayerLook).forEach((id, current) => {
        if (world.has(id, ViewAnchor)) return;
        world.set(id, PlayerLook, {
          yaw: wrapYaw(current.yaw + turn.yaw),
          pitch: clampPitch(current.pitch + turn.pitch, settings),
        });
      });
    },
  };
}

/** The knight's dodge moves (src/content/data/move). */
export const KNIGHT_DODGE: DodgeMoves = Object.freeze({ roll: 'dodge-roll', backstep: 'backstep' });

/** The move the knight's attack button starts: the root of its light chain (mw-e04.6). */
export const KNIGHT_LIGHT_ATTACK = 'sword-light-1';

/** The knight's heavy attack (mw-e04.13): hold its button to charge it (sword-heavy-charged). */
export const KNIGHT_HEAVY_ATTACK = 'sword-heavy';

/** The strong-attack button: ability 1 (RT/R2, or 1 on keyboard; mw-e04.39). */
export const DEFAULT_HEAVY_BUTTON: ButtonAction = 'ability1';

/** The knight's parry (mw-e04.12). */
export const KNIGHT_PARRY = 'shield-parry';

/** The knight's riposte: its attack button starts it while a Parried target is in reach (e04.12). */
export const KNIGHT_RIPOSTE = 'sword-riposte';

/** The left-hand button: ability 3 (LB/L1, or 3); the knight's shield uses it to parry. */
export const DEFAULT_PARRY_BUTTON: ButtonAction = 'ability3';

/** The knight's shield bash (mw-e04.14): attack while blocking. */
export const KNIGHT_SHIELD_BASH = 'shield-bash';

/** What the knight does on block + attack without a shield (mw-e04.14; the kick is mw-e04.18). */
export const KNIGHT_KICK = 'kick';

/** The knight's sword and shield (mw-e04.6). */
export interface PlayerMeleeOptions {
  /**
   * The shield the block button raises (content `shield`, e.g. the wood shield); absent = no shield
   * equipped: no block, and block + attack starts `bashFallback` instead of the bash.
   */
  readonly shield?: RuntimeShield;
  /** The move the attack button starts; defaults to KNIGHT_LIGHT_ATTACK. */
  readonly lightAttack?: string;
  /** The lock-on target to face during startup (lock-on, e02.16); none by default. */
  readonly target?: (world: World<never>, entity: EntityId) => EntityId | undefined;
  /** Where the target is (lock-on's locator, mw-e02.31); defaults to its placement. */
  readonly locate?: EntityLocator;
  /**
   * The move the heavy button starts (e.g. KNIGHT_HEAVY_ATTACK, mw-e04.13); held, it charges when
   * the move table has its charged variant. Absent = no heavy attack.
   */
  readonly heavyAttack?: string;
  /** The button that starts the heavy attack; defaults to DEFAULT_HEAVY_BUTTON. */
  readonly heavyButton?: ButtonAction;
  /** The move the parry button starts (e.g. KNIGHT_PARRY, mw-e04.12); absent = no parry. */
  readonly parry?: string;
  /** The button that parries; defaults to DEFAULT_PARRY_BUTTON. */
  readonly parryButton?: ButtonAction;
  /**
   * The riposte the attack button starts instead of the light attack while a Parried target is in
   * reach (e.g. KNIGHT_RIPOSTE, `riposteRedirect`); absent = no riposte.
   */
  readonly riposte?: string;
  /**
   * The move attack starts while the block button is held (e.g. KNIGHT_SHIELD_BASH, mw-e04.14);
   * absent = attack while blocking is a plain attack.
   */
  readonly bash?: string;
  /** What starts instead of the bash with no shield (e.g. KNIGHT_KICK); absent = the bash itself. */
  readonly bashFallback?: string;
  /** The move the kick button starts (e.g. KNIGHT_KICK, mw-e04.18); absent = no kick button. */
  readonly kick?: string;
}

/**
 * Where the player's arrows leave from, relative to its feet and look: `height` up and `right` along
 * the look's right (the orbit camera's pivot height and shoulder, so a shot flies straight down the
 * middle of the screen), then `forward` along the shot. Metres.
 */
export interface BowNock {
  readonly height: number;
  readonly right: number;
  readonly forward: number;
}

/** The player camera's pivot (1.5 m) and shoulder (0.5 m), half a metre out along the shot. */
export const DEFAULT_BOW_NOCK: BowNock = Object.freeze({ height: 1.5, right: 0.5, forward: 0.5 });

/** The player's bow (mw-e05.3). */
export interface PlayerBowOptions {
  /** Bow tuning (compiled bow content). */
  readonly bows: BowLookup;
  /** The arrows it looses; the world's arrow system (installArrows) flies them. */
  readonly arrows: ArrowLookup;
  /** The bow, quiver and whether the bow starts out. */
  readonly loadout: BowLoadout;
  /** Defaults to DEFAULT_BOW_NOCK. */
  readonly nock?: BowNock;
  /** Gravity the lock-on aim leads for, m/s²; defaults to the arrow rules'. */
  readonly gravity?: number;
  /** Defaults to DEFAULT_BOW_BUTTONS. */
  readonly buttons?: BowButtons;
}

/**
 * The player's aim (mw-e05.3): from the nock point along its look (yaw and pitch), or, locked on, at
 * the anchor point raised by the drop of a drag-free arrow at `speed` over that distance
 * (½·g·(d/v)²), so a locked shot lands on the lock point.
 */
export function lookAim(
  nock: BowNock = DEFAULT_BOW_NOCK,
  gravity = DEFAULT_ARROW_RULES.gravity,
): BowAim {
  return (world, entity, speed) => {
    const state = world.get(entity, CharacterController);
    const look = world.get(entity, PlayerLook);
    if (state === undefined || look === undefined) return undefined;
    const forward = yawForward(look.yaw);
    const { position: feet } = state;
    const base = {
      x: feet.x - forward.z * nock.right,
      y: feet.y + nock.height,
      z: feet.z + forward.x * nock.right,
    };
    const anchor = world.get(entity, ViewAnchor);
    let direction: Vec3;
    if (anchor === undefined) {
      const flat = cos(look.pitch);
      direction = { x: forward.x * flat, y: sin(look.pitch), z: forward.z * flat };
    } else {
      const { point } = anchor;
      const to = { x: point.x - base.x, y: point.y - base.y, z: point.z - base.z };
      const distance = Math.sqrt(to.x * to.x + to.y * to.y + to.z * to.z);
      const time = distance / speed;
      const lead = { ...to, y: to.y + 0.5 * gravity * time * time };
      const length = Math.sqrt(lead.x * lead.x + lead.y * lead.y + lead.z * lead.z);
      direction =
        length === 0 ? forward : { x: lead.x / length, y: lead.y / length, z: lead.z / length };
    }
    return {
      origin: {
        x: base.x + direction.x * nock.forward,
        y: base.y + direction.y * nock.forward,
        z: base.z + direction.z * nock.forward,
      },
      direction,
    };
  };
}

/** The player's combat (mw-e04.8): what its action timeline can perform. */
export interface PlayerCombatOptions {
  /** Every move the player may perform (`compileMoves` of the game content). */
  readonly moves: MoveTable;
  /** The moves the dodge button starts; defaults to KNIGHT_DODGE. */
  readonly dodge?: DodgeMoves;
  /** The stamina pool the moves draw on; defaults to DEFAULT_STAMINA_PROFILE. */
  readonly stamina?: StaminaProfile;
  /** Sword and shield (mw-e04.6); absent = no attacks or block. */
  readonly melee?: PlayerMeleeOptions;
  /** A bow and quiver (mw-e05.3); absent = none. */
  readonly bow?: PlayerBowOptions;
}

/** The horizontal direction a look yaw faces (yaw 0 faces −z). */
export function yawForward(yaw: number): { readonly x: number; readonly y: 0; readonly z: number } {
  return { x: -sin(yaw) + 0, y: 0, z: -cos(yaw) + 0 };
}

/** The player's facing for dodge input: its look yaw (the camera; it faces the target while locked on). */
const lookFacing: DodgeFacing & FacingRule = (world, entity) => {
  const look = world.get(entity, PlayerLook);
  return look === undefined ? undefined : yawForward(look.yaw);
};

const UP = actionButton(false, false, false);

/** `actions` as the controller may use them at `scale` of normal speed (see `locomotionScale`). */
export function restrainMovement(
  actions: ActionFrame,
  scale: number,
  noJump = scale === 0,
): ActionFrame {
  if (scale === 1) return actions;
  const { x, y } = actions.move;
  return {
    ...actions,
    move: { x: x * scale, y: y * scale },
    sprint: UP,
    jump: noJump ? UP : actions.jump,
  };
}

/** How fast the player may move: behind its shield or swinging (melee), and while it draws (bow). */
function combatLocomotionScale(
  world: World<never>,
  entity: EntityId,
  combat: PlayerCombatOptions,
): number {
  const melee = combat.melee === undefined ? 1 : locomotionScale(world, entity, combat.moves);
  const bow = combat.bow === undefined ? 1 : bowLocomotionScale(world, entity, combat.bow.bows);
  return Math.min(melee, bow);
}

/** Keeps the player's placement at its feet (the frame its swings are placed in), after it moves. */
function playerPlacementSystem<TInput>(entity: EntityId, radius: number): System<TInput> {
  return {
    name: 'player-placement',
    run: ({ world }) => {
      const state = world.get(entity, CharacterController);
      if (state !== undefined) placeEntity(world, entity, state.position, radius);
    },
  };
}

/** The knight's button bindings: the light attack and, when given, the heavy and parry buttons. */
function meleeBindings(melee: PlayerMeleeOptions): Partial<Record<ButtonAction, string>> {
  const bindings: Partial<Record<ButtonAction, string>> = {
    primaryAttack: melee.lightAttack ?? KNIGHT_LIGHT_ATTACK,
  };
  if (melee.heavyAttack !== undefined) {
    bindings[melee.heavyButton ?? DEFAULT_HEAVY_BUTTON] = melee.heavyAttack;
  }
  if (melee.parry !== undefined) bindings[melee.parryButton ?? DEFAULT_PARRY_BUTTON] = melee.parry;
  if (melee.kick !== undefined) bindings.kick = melee.kick;
  return bindings;
}

/** The knight's chords: attack while blocking bashes (mw-e04.14), when it has a bash. */
function meleeChords(melee: PlayerMeleeOptions): ActionChord[] {
  if (melee.bash === undefined) return [];
  return [{ held: DEFAULT_BLOCK_BUTTON, press: 'primaryAttack', move: melee.bash }];
}

/**
 * Drains every climbing character's stamina pool at the climb tuning's rate (mw-e02.13): the climb
 * hook lets go when it reaches 0. Runs after the controller, so the regen pause restarts every tick
 * of a climb.
 */
function climbStaminaSystem<TInput>(tuning: Frozen<ControllerTuning>): System<TInput> {
  return {
    name: 'climb-stamina',
    run: ({ world, clock }) => {
      const w: World<never> = world;
      w.query(CharacterController, StaminaComponent).forEach((entity, state) => {
        if (state.traversal !== 'climb') return;
        const climb = characterTuning(w, entity, tuning).climb ?? DEFAULT_CLIMB_TUNING;
        if (climb.staminaPerSecond > 0) drainStamina(w, entity, climb.staminaPerSecond / clock.hz);
      });
    },
  };
}

export interface PlayerOptions {
  /** The loaded scene's spawns; the player starts at the one tagged `player-start`. */
  readonly spawns: readonly SceneSpawnPlacement[];
  /**
   * The id of the spawn to start at, facing the way its yaw says, instead of the one tagged
   * `player-start`: an area transition's arrival point (mw-e01.11).
   */
  readonly startSpawn?: string;
  readonly collision: CollisionWorld;
  readonly tuning: Frozen<ControllerTuning>;
  /** Look input; each setting defaults to DEFAULT_LOOK_SETTINGS. */
  readonly look?: Partial<LookSettings>;
  /** The pitch the player starts with, radians (clamped to the limits); defaults to level (0). */
  readonly pitch?: number;
  /** Falling below this world-space height resets position and look to `player-start`. */
  readonly fallResetY?: number;
  /** Stamina, the action timeline and the dodge (see the file header); absent = movement only. */
  readonly combat?: PlayerCombatOptions;
  /** Mantling and ledge hangs over the scene's ledges (mw-e02.12); absent = none. */
  readonly ledges?: PlayerLedgeOptions;
  /** Climbing ladders, ropes, ivy and rough walls (mw-e02.13); absent = none. */
  readonly climb?: PlayerClimbOptions;
  /** Wading, swimming, sinking and breath in the scene's water (mw-e02.14); absent = none. */
  readonly water?: PlayerWaterOptions;
  /**
   * Status definitions (mw-e06.24): the player's `moveSpeed` statuses (slowed, rooted) scale its
   * speed, read through `modifiedStat`; absent = statuses leave movement alone.
   */
  readonly statuses?: StatusLookup;
}

/** The player's water (mw-e02.14, src/sim/character/water.ts). */
export interface PlayerWaterOptions {
  /** The scene's water volumes (`waterVolumes` of its regions). */
  readonly volumes: readonly WaterVolume[];
  /** The player's armor load class; absent or undefined = light (no sinking). */
  readonly loadClass?: (entity: EntityId) => LoadClass | undefined;
  /** Applies a drowning tick of `amount` health points (the game routes it to the damage model). */
  readonly onDrown?: (entity: EntityId, amount: number) => void;
}

/** The player's climbing (mw-e02.13). */
export interface PlayerClimbOptions {
  /**
   * Fixed climbing capabilities, e.g. CLIMB_ROUGH_CAPABILITY (tests and tools); none by default
   * (ladders, ropes and ivy need none). Mantling and climbing share one list: these, the ledge
   * options' and whatever the capability registry grants the player (mw-e19.2) apply to both.
   */
  readonly capabilities?: readonly string[];
}

/** The player's mantling and ledge hangs (mw-e02.12). */
export interface PlayerLedgeOptions {
  /** The scene's ledges (`sceneLedges` of the loaded scene). */
  readonly index: LedgeIndex;
  /**
   * Fixed capabilities, e.g. LEDGE_HANG_CAPABILITY (tests and tools), on top of what the capability
   * registry grants the player (mw-e19.2); none by default.
   */
  readonly capabilities?: readonly string[];
}

/** Thrown when a scene has no spawn tagged `player-start`. */
export class NoPlayerStartError extends Error {
  override readonly name = 'NoPlayerStartError';
}

/** Deterministically returns an out-of-bounds player to the authored scene start. */
export function playerFallRecoverySystem<TInput>(
  entity: EntityId,
  resetBelowY: number,
  position: Vec3,
  look: PlayerLook,
  placementRadius = 0,
): System<TInput> {
  return {
    name: 'player-fall-recovery',
    run({ world }) {
      const state = world.get(entity, CharacterController);
      if (state === undefined || state.position.y >= resetBelowY) return;
      world.set(entity, CharacterController, initialCharacterState(position));
      world.set(entity, PlayerLook, look);
      if (world.isRegistered(PlacementComponent) && world.has(entity, PlacementComponent)) {
        placeEntity(world, entity, position, placementRadius);
      }
      if (world.has(entity, ViewAnchor)) world.remove(entity, ViewAnchor);
      if (world.isRegistered(LockOnComponent) && world.has(entity, LockOnComponent)) {
        world.set(entity, LockOnComponent, NO_LOCK);
      }
    },
  };
}

/**
 * Adds the player to `world`: registers its components, adds the look and controller systems and
 * spawns it at the player start, facing the spawn's direction. Once per world, between steps. The
 * feet start SKIN above the spawn, where the controller rests on flat ground, so an idle player
 * does not move on its first tick.
 * @throws NoPlayerStartError when no spawn is tagged `player-start` (the world is left unchanged).
 */
export function installPlayer<TInput>(world: World<TInput>, options: PlayerOptions): EntityId {
  const start = playerSpawn(options.spawns, options.startSpawn);
  if (start === undefined) {
    throw new NoPlayerStartError(
      options.startSpawn === undefined
        ? `the scene has no spawn tagged "${PLAYER_START_TAG}"`
        : `the scene has no spawn "${options.startSpawn}"`,
    );
  }
  const look: LookSettings = { ...DEFAULT_LOOK_SETTINGS, ...options.look };
  if (options.fallResetY !== undefined && !Number.isFinite(options.fallResetY)) {
    throw new RangeError(`fallResetY must be finite, got ${String(options.fallResetY)}`);
  }
  const { combat } = options;
  world.register(CharacterController, CharacterTuning, CharacterLocomotion, PlayerLook, ViewAnchor);
  world.addSystem(playerLookSystem(look));
  const melee = combat?.melee;
  if (combat !== undefined) {
    const { moves } = combat;
    world.register(StaminaComponent, ...ACTION_TIMELINE_COMPONENTS, DodgeComponent);
    world.addSystem(staminaSystem()).addSystem(dodgeInputSystem({ facing: lookFacing }));
    if (melee !== undefined) {
      world.register(...MELEE_COMPONENTS);
      world.addSystem(blockSystem({ moves }));
    }
    const riposte = melee?.riposte;
    const trigger = melee?.lightAttack ?? KNIGHT_LIGHT_ATTACK;
    const bash = melee?.bash;
    const fallback = melee?.bashFallback;
    const redirects = [
      riposte === undefined ? undefined : riposteRedirect({ trigger, riposte }),
      bash === undefined || fallback === undefined ? undefined : bashRedirect({ bash, fallback }),
    ];
    world.addSystem(
      actionTimelineSystem({
        moves,
        ...(redirects.some((r) => r !== undefined) && { redirect: firstRedirect(...redirects) }),
      }),
    );
    if (melee !== undefined) {
      const { target, locate } = melee;
      const desired =
        target === undefined ? lookFacing : firstFacing(faceTarget(target, locate), lookFacing);
      world.addSystem(facingSystem({ moves, desired }));
    }
    const { bow } = combat;
    if (bow !== undefined) {
      installBow(world, {
        bows: bow.bows,
        arrows: bow.arrows,
        aim: lookAim(bow.nock, bow.gravity),
        ...(bow.buttons !== undefined && { buttons: bow.buttons }),
      });
    }
    world.addSystem(dodgeMotionSystem({ moves, facing: lookFacing }));
  }
  const { ledges, climb, water } = options;
  // The options' fixed list plus whatever the capability registry grants the player (mw-e19.2), read
  // live so a grant or revoke changes traversal from the next check.
  const fixed = [...(ledges?.capabilities ?? []), ...(climb?.capabilities ?? [])];
  const capabilities = (entity: EntityId | undefined): readonly string[] => {
    const held = capabilitiesOf(world, entity);
    return held.length === 0 ? fixed : [...fixed, ...held];
  };
  const hooks: TraversalHook[] = [];
  let ledgeHook: LedgeTraversalHook | undefined;
  if (ledges !== undefined) {
    ledgeHook = ledgeTraversal({
      world,
      ledges: ledges.index,
      capabilities,
      handsFull: (entity) => refuseGrab(world, entity, 'ledge'),
    });
    hooks.push(ledgeHook);
  }
  if (climb !== undefined) {
    if (!world.isRegistered(ClimbRopeComponent)) world.register(ClimbRopeComponent);
    hooks.push(
      climbTraversal({
        world,
        capabilities,
        handsFull: (entity) => refuseGrab(world, entity, 'climb'),
        stamina: (entity) =>
          combat === undefined || entity === undefined
            ? undefined
            : world.get(entity, StaminaComponent)?.current,
        ...(ledgeHook !== undefined && { ledges: ledgeHook }),
      }),
    );
  }
  if (water !== undefined) {
    world.register(CharacterBreath);
    hooks.push(
      waterTraversal({
        volumes: water.volumes,
        ...(water.loadClass !== undefined && { loadClass: water.loadClass }),
      }),
    );
  }
  world.addSystem(
    characterControllerSystem<TInput>({
      collision: options.collision,
      tuning: options.tuning,
      ...(hooks.length > 0 && { hooks }),
      input: (inputs, entity) => {
        const frame = actionFrameOf(inputs);
        const look = world.get(entity, PlayerLook);
        if (frame === undefined || look === undefined) return undefined;
        const statusScale =
          options.statuses === undefined ? 1 : statusMoveScale(world, options.statuses, entity);
        // What the player carries or has hold of (pushing a crate) slows it the same way.
        const carrying = carryRestraint(world, entity) ?? pushRestraint(world, entity, frame.move);
        const fought =
          combat === undefined
            ? undefined
            : {
                scale: combatLocomotionScale(world, entity, combat),
                noJump:
                  combat.melee !== undefined && isAttacking(world, entity, combat.moves)
                    ? true
                    : undefined,
              };
        // Statuses and combat take the slower of the two; what the carrier holds slows it on top
        // (ADR-0003: carry stacks with other restraints).
        const actions =
          fought === undefined && carrying === undefined && statusScale === 1
            ? frame
            : restrainMovement(
                frame,
                Math.min(fought?.scale ?? 1, statusScale) * (carrying?.scale ?? 1),
                fought?.noJump === true || carrying?.noJump === true ? true : undefined,
              );
        const motion = combat && world.get(entity, DodgeComponent)?.velocity;
        const anchor = world.get(entity, ViewAnchor);
        return {
          actions,
          cameraYaw: look.yaw,
          ...(motion != null && { motion }),
          ...(anchor !== undefined && { strafeAround: anchor.point }),
        };
      },
      noclip: (entity) => hasCheat(world, entity, 'noclip'),
    }),
  );
  if (climb !== undefined && combat !== undefined) {
    world.addSystem(climbStaminaSystem(options.tuning));
  }
  if (water !== undefined) {
    world.addSystem(
      waterSystem<TInput>({
        volumes: water.volumes,
        tuning: options.tuning,
        ...(water.loadClass !== undefined && { loadClass: water.loadClass }),
        ...(water.onDrown !== undefined && { onDrown: water.onDrown }),
        drain: (entity, amount) => {
          if (combat !== undefined) drainStamina(world, entity, amount);
        },
      }),
    );
  }
  world.addSystem(
    locomotionSystem<TInput>({
      tuning: options.tuning,
      ...(water !== undefined && {
        material: (entity: EntityId) => {
          const state = world.get(entity, CharacterController);
          const tuning =
            characterTuning(world, entity, options.tuning).water ?? DEFAULT_WATER_TUNING;
          return state !== undefined &&
            waterDepthAt(water.volumes, state.position) >= tuning.wadeDepth
            ? WATER_MATERIAL
            : undefined;
        },
      }),
      moving: (inputs, entity) => {
        const move = actionFrameOf(inputs)?.move;
        const held = move !== undefined && (move.x !== 0 || move.y !== 0);
        return (
          held || (combat !== undefined && world.get(entity, DodgeComponent)?.velocity != null)
        );
      },
      facing: (entity) => world.get(entity, PlayerLook)?.yaw,
    }),
  );
  const { x, y, z } = start.position;
  const startPosition = { x, y: y + SKIN, z };
  const startLook = { yaw: spawnYaw(start), pitch: clampPitch(options.pitch ?? 0, look) };
  const id = spawnCharacter(world, startPosition);
  // Its own tuning, so the debug console's ctl.set changes it from the very next tick (mw-e02.3).
  world.add(id, CharacterTuning, options.tuning);
  giveLocomotion(world, id);
  if (water !== undefined) {
    giveBreath(world, id, options.tuning.water ?? DEFAULT_WATER_TUNING, world.clock.hz);
  }
  world.add(id, PlayerLook, startLook);
  if (combat !== undefined) {
    giveStamina(world, id, combat.stamina ?? DEFAULT_STAMINA_PROFILE);
    giveActionTimeline(world, id);
    if (melee === undefined) giveActionInput(world, id, {});
    else giveActionInput(world, id, meleeBindings(melee), meleeChords(melee));
    giveDodge(world, id, combat.dodge ?? KNIGHT_DODGE);
    if (combat.bow !== undefined) giveBow(world, id, combat.bow.loadout);
  }
  if (melee !== undefined) {
    giveFacing(world, id, yawForward(spawnYaw(start)));
    if (melee.shield !== undefined) giveGuard(world, id, melee.shield);
    giveHitboxes(world, id);
    placeEntity(world, id, { x, y: y + SKIN, z }, options.tuning.capsule.radius);
    world.addSystem(playerPlacementSystem(id, options.tuning.capsule.radius));
  }
  if (options.fallResetY !== undefined) {
    world.addSystem(
      playerFallRecoverySystem(
        id,
        options.fallResetY,
        startPosition,
        startLook,
        options.tuning.capsule.radius,
      ),
    );
  }
  return id;
}
