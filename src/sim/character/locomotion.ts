// Locomotion state and events (mw-e02.6): what a character is doing, published by the sim so any
// renderer or animation set can play matching clips without deciding anything itself. After the
// character controller has moved a character, `locomotionSystem` classifies the tick into one
// locomotion state, records its speed, normalised speed, vertical speed and turn rate, and emits
// discrete events on the world's bus: jumpStart, land (with the impact speed), footstep (which foot,
// which gait, where, on which material, how loud), mantleStart and ledgeGrab.
//
// States, first match wins:
//   climb / mantle / hang / swim   a traversal mode has the character
//   airborne                off the ground
//   landing                 within landingMs of a hard landing (impact ≥ hardLanding)
//   crouch                  crouched
//   idle                    no move input, or slower than walkFrom — so a character shoved
//                           sideways while standing still never "walks" (no false locomotion)
//   sprint                  sprinting, at runFrom or faster
//   run                     at runFrom or faster
//   walk                    otherwise
//
// Land impact speed is exact for the controller's constant-acceleration fall: from the last airborne
// tick's height and vertical speed, v² = vy² + 2·g·drop (capped at maxFallSpeed), so it does not
// depend on where in the tick the feet met the ground. Footsteps come from ground distance travelled
// (gait spacing from content), never from animation curves, so they are deterministic and replay.
//
// A footstep says what it fell on and how loud it is (mw-e02.11, footsteps.ts): the ground's material
// and wet / frozen / burning state, the movement profile's noise, and loudness = noise × the
// surface's pressure ratio. It is the one footstep event: audio plays it and stealth (mw-e09.5)
// reads it; nothing else detects footsteps.
//
// Animation only reads the snapshot: nothing here reads presentation, and nothing reads it back.

import type { ControllerTuning, Frozen, GaitTuning } from '@content/index';
import type { ReadonlyClock } from '../clock';
import { defineComponent, type EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { System, World } from '../core/world';
import type { Vec3 } from '../stimulus/shapes';
import type { CharacterState } from './controller';
import { footstepLoudness, type FootSurface } from './footsteps';
import { CharacterController, characterTuning } from './system';
import type { TraversalMode } from './traversal';

/** Every locomotion state, in the order the file header lists them. */
export const LOCOMOTION_STATES = [
  'idle',
  'walk',
  'run',
  'sprint',
  'crouch',
  'airborne',
  'landing',
  'climb',
  'mantle',
  'hang',
  'swim',
] as const;

/** A locomotion state. */
export type LocomotionState = (typeof LOCOMOTION_STATES)[number];

/** The gaits footsteps are spaced by. */
export type FootstepGait = keyof GaitTuning['footstep'];

/** Which foot a footstep falls on. */
export type Foot = 'left' | 'right';

/**
 * The defaults when a controller profile has no `gait` block: idle below 0.2 m/s of horizontal
 * speed, run from 2.5 m/s, a 150 ms landing after impacts of 6 m/s or more (a drop of about 0.7 m
 * at the player's gravity), and footsteps 0.7 / 1.0 / 1.25 / 0.5 m apart walking / running /
 * sprinting / crouching. The shipped player profile states its own (src/content/data/controller).
 */
export const DEFAULT_GAIT_TUNING: Frozen<GaitTuning> = Object.freeze({
  walkFrom: 0.2,
  runFrom: 2.5,
  landingMs: 150,
  hardLanding: 6,
  footstep: Object.freeze({ walk: 0.7, run: 1.0, sprint: 1.25, crouch: 0.5 }),
});

/** What a character is doing this tick: the part presentation reads. */
export interface LocomotionSnapshot {
  readonly state: LocomotionState;
  /** Horizontal speed, m/s. */
  readonly speed: number;
  /** Horizontal speed as a fraction of the profile's run speed (1 = full run; sprint is above 1). */
  readonly normalizedSpeed: number;
  /** Vertical speed, m/s (positive rising). */
  readonly verticalSpeed: number;
  /** Facing yaw rate, rad/s (positive turns left); 0 without a facing. */
  readonly turnRate: number;
  readonly grounded: boolean;
}

/** The component: the snapshot plus what the next tick's classification and events need. */
export interface Locomotion extends LocomotionSnapshot {
  /** Facing yaw last tick, radians; null before the first tick or without a facing. */
  readonly yaw: number | null;
  /** Height and vertical speed at the end of the last tick spent airborne; null when grounded. */
  readonly fall: { readonly y: number; readonly vy: number } | null;
  /** The character had jumped (CharacterState.jumped) last tick. */
  readonly jumped: boolean;
  /** The traversal mode last tick. */
  readonly traversal: TraversalMode | null;
  /** Ticks of landing state left. */
  readonly landingTicks: number;
  /** Ground distance since the last footstep, m. */
  readonly stride: number;
  /** The foot the next footstep falls on. */
  readonly nextFoot: Foot;
}

/** The locomotion component (`character.locomotion`; a snapshot and save key, never renamed). */
export const CharacterLocomotion = defineComponent<Locomotion>('character.locomotion');

/** What happened: a locomotion event without its entity and tick. */
export type LocomotionEventKind =
  | { readonly kind: 'jumpStart' }
  | { readonly kind: 'land'; /** Downward speed at touchdown, m/s. */ readonly impactSpeed: number }
  | {
      readonly kind: 'footstep';
      readonly foot: Foot;
      readonly gait: FootstepGait;
      /** Where the foot came down: the character's feet, m. */
      readonly position: Vec3;
      /**
       * The material under the feet: the ground's, or `water` while wading (mw-e02.14); absent when
       * the game reads no ground (a world without surfaces).
       */
      readonly material?: string;
      /** The ground is wet enough to splash, or the foot is in water. */
      readonly wet: boolean;
      readonly frozen: boolean;
      readonly burning: boolean;
      /** The movement profile's noise, 0–1: stance × gait × encumbrance (1 when none is read). */
      readonly profileNoise: number;
      /**
       * The walker's armor-load noise multiplier (ADR-0003: 1.0 / 1.3 / 1.6 / 1.8; 1 when it wears
       * none), unclamped: the value stealth (mw-e09.5) scales this step's noise by.
       */
      readonly encumbrance: number;
      /** The surface's loudness offset, dB relative to stone (material, wet and frozen). */
      readonly surfaceDb: number;
      /** Normalised loudness: profileNoise × 10^(surfaceDb / 20). */
      readonly loudness: number;
    }
  | { readonly kind: 'mantleStart' }
  | { readonly kind: 'ledgeGrab' };

/** A locomotion event for one entity on one tick. */
export type LocomotionEvent = LocomotionEventKind & {
  readonly entity: EntityId;
  readonly tick: number;
};

/** Locomotion events, emitted by locomotionSystem in the order they happened within a tick. */
export const LocomotionEvents = defineEvent<LocomotionEvent>('LocomotionEvents');

/** A character standing still, before its first tick. */
export function initialLocomotion(): Locomotion {
  return {
    state: 'idle',
    speed: 0,
    normalizedSpeed: 0,
    verticalSpeed: 0,
    turnRate: 0,
    grounded: true,
    yaw: null,
    fall: null,
    jumped: false,
    traversal: null,
    landingTicks: 0,
    stride: 0,
    nextFoot: 'left',
  };
}

/** Gives `entity` locomotion (register CharacterLocomotion first). */
export function giveLocomotion<TInput>(world: World<TInput>, entity: EntityId): void {
  world.add(entity, CharacterLocomotion, initialLocomotion());
}

/** The published part of a character's locomotion, or undefined when it has none. */
export function locomotionOf(
  world: Pick<World<never>, 'get'>,
  entity: EntityId,
): LocomotionSnapshot | undefined {
  const l = world.get(entity, CharacterLocomotion);
  if (l === undefined) return undefined;
  const { state, speed, normalizedSpeed, verticalSpeed, turnRate, grounded } = l;
  return { state, speed, normalizedSpeed, verticalSpeed, turnRate, grounded };
}

/** What classification reads besides the thresholds. */
export interface LocomotionInputs {
  readonly grounded: boolean;
  readonly crouched: boolean;
  readonly sprinting: boolean;
  readonly traversal: TraversalMode | null;
  /** Horizontal speed, m/s. */
  readonly speed: number;
  /** The character is being asked to move (move input held, or a committed move's root motion). */
  readonly moving: boolean;
  /** Ticks of landing state left. */
  readonly landingTicks: number;
}

/** The locomotion state for one tick (see the file header for the rules). */
export function classifyLocomotion(
  inputs: LocomotionInputs,
  gait: Pick<GaitTuning, 'walkFrom' | 'runFrom'>,
): LocomotionState {
  if (inputs.traversal !== null) return inputs.traversal;
  if (!inputs.grounded) return 'airborne';
  if (inputs.landingTicks > 0) return 'landing';
  if (inputs.crouched) return 'crouch';
  if (!inputs.moving || inputs.speed < gait.walkFrom) return 'idle';
  if (inputs.speed >= gait.runFrom) return inputs.sprinting ? 'sprint' : 'run';
  return 'walk';
}

const TAU = 2 * Math.PI;

/** `angle` wrapped into (−π, π]. */
function wrapAngle(angle: number): number {
  const wrapped = angle - TAU * Math.round(angle / TAU);
  return wrapped <= -Math.PI ? wrapped + TAU : wrapped;
}

/** Downward speed at touchdown after `fall`, landing at height `y` (exact under constant gravity). */
export function impactSpeed(
  fall: { readonly y: number; readonly vy: number },
  y: number,
  tuning: Pick<ControllerTuning, 'gravity' | 'maxFallSpeed'>,
): number {
  const squared = fall.vy * fall.vy + 2 * tuning.gravity * (fall.y - y);
  return Math.min(Math.sqrt(Math.max(0, squared)), tuning.maxFallSpeed);
}

/** The footstep gait of a grounded state, or undefined when it takes no steps. */
function gaitOf(state: LocomotionState): FootstepGait | undefined {
  switch (state) {
    case 'walk':
    case 'run':
    case 'sprint':
    case 'crouch':
      return state;
    default:
      return undefined;
  }
}

/** One tick's per-entity input to `stepLocomotion`. */
export interface LocomotionTick {
  /** The character after this tick's controller step. */
  readonly character: CharacterState;
  /** Move input or root motion drives it this tick. */
  readonly moving: boolean;
  /** The ground (or water) under the feet, tagged on footsteps; undefined reads no surface. */
  readonly surface?: FootSurface | undefined;
  /** The movement profile's noise this tick, 0–1; undefined = 1. */
  readonly noise?: number | undefined;
  /** The armor-load noise multiplier this tick; undefined = 1. */
  readonly encumbrance?: number | undefined;
  /** Facing yaw this tick, radians, or undefined without one. */
  readonly yaw: number | undefined;
}

/** What `stepLocomotion` needs besides the character. */
export interface LocomotionContext {
  readonly tuning: Frozen<Pick<ControllerTuning, 'gravity' | 'maxFallSpeed' | 'speeds'>>;
  readonly gait: Frozen<GaitTuning>;
  readonly clock: Pick<ReadonlyClock, 'hz' | 'ticksFor'>;
}

/**
 * The next locomotion from the last one and this tick's character, plus this tick's events in the
 * order they happened. Pure.
 */
export function stepLocomotion(
  last: Locomotion,
  tick: LocomotionTick,
  context: LocomotionContext,
): { readonly locomotion: Locomotion; readonly events: readonly LocomotionEventKind[] } {
  const { character, moving } = tick;
  const { tuning, gait, clock } = context;
  const events: LocomotionEventKind[] = [];
  const dt = 1 / clock.hz;
  const { velocity, position, grounded, traversal } = character;
  const speed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);

  if (character.jumped && !last.jumped) events.push({ kind: 'jumpStart' });
  if (traversal !== last.traversal && traversal === 'mantle') events.push({ kind: 'mantleStart' });
  // Hands take a ledge: every hang begins with one, and a climb entered while falling (a catch).
  const grabbed = traversal === 'hang' || (traversal === 'climb' && last.fall !== null);
  if (traversal !== last.traversal && grabbed) events.push({ kind: 'ledgeGrab' });

  let landingTicks = Math.max(0, last.landingTicks - 1);
  if (grounded && last.fall !== null) {
    const impact = impactSpeed(last.fall, position.y, tuning);
    events.push({ kind: 'land', impactSpeed: impact });
    if (impact >= gait.hardLanding) landingTicks = clock.ticksFor(gait.landingMs);
  }
  const state = classifyLocomotion(
    {
      grounded,
      crouched: character.crouched,
      sprinting: character.sprinting,
      traversal,
      speed,
      moving,
      landingTicks,
    },
    gait,
  );

  // Footsteps: half a step in when a character starts moving, so the first one comes promptly.
  const stepGait = grounded ? gaitOf(state) : undefined;
  let stride = last.stride;
  let nextFoot = last.nextFoot;
  if (stepGait === undefined) {
    stride = gait.footstep.walk / 2;
  } else {
    const spacing = gait.footstep[stepGait];
    stride += speed * dt;
    if (stride >= spacing) {
      const { surface } = tick;
      const profileNoise = tick.noise ?? 1;
      const surfaceDb = surface?.surfaceDb ?? 0;
      events.push({
        kind: 'footstep',
        foot: nextFoot,
        gait: stepGait,
        position,
        ...(surface !== undefined && { material: surface.material }),
        wet: surface?.wet ?? false,
        frozen: surface?.frozen ?? false,
        burning: surface?.burning ?? false,
        profileNoise,
        encumbrance: tick.encumbrance ?? 1,
        surfaceDb,
        loudness: footstepLoudness(profileNoise, surfaceDb),
      });
      stride -= spacing;
      nextFoot = nextFoot === 'left' ? 'right' : 'left';
    }
  }

  const yaw = tick.yaw ?? null;
  const turnRate = yaw === null || last.yaw === null ? 0 : wrapAngle(yaw - last.yaw) * clock.hz;
  return {
    locomotion: {
      state,
      speed,
      normalizedSpeed: speed / tuning.speeds.run,
      verticalSpeed: velocity.y,
      turnRate: turnRate + 0,
      grounded,
      yaw,
      fall: grounded ? null : { y: position.y, vy: velocity.y },
      jumped: character.jumped,
      traversal,
      landingTicks,
      stride,
      nextFoot,
    },
    events,
  };
}

export interface LocomotionSystemOptions<TInput> {
  readonly tuning: Frozen<ControllerTuning>;
  /** Whether `entity` is being asked to move this tick (move input held, or root motion). */
  readonly moving: (inputs: readonly TInput[], entity: EntityId) => boolean;
  /** `entity`'s facing yaw, radians (0 faces −z, positive turns left); undefined = no facing. */
  readonly facing?: (entity: EntityId) => number | undefined;
  /** The ground (or water, while wading) under `entity`'s feet; undefined = no surface read. */
  readonly surface?: (entity: EntityId) => FootSurface | undefined;
  /** `entity`'s movement profile noise this tick, 0–1; undefined = 1. */
  readonly noise?: (entity: EntityId) => number | undefined;
  /** `entity`'s armor-load noise multiplier (its CharacterEncumbrance); undefined = 1. */
  readonly encumbrance?: (entity: EntityId) => number | undefined;
}

/**
 * Publishes every character's locomotion after the controller has moved it (add it after the
 * character controller system). Characters without CharacterLocomotion are left alone.
 */
export function locomotionSystem<TInput>(options: LocomotionSystemOptions<TInput>): System<TInput> {
  const { tuning } = options;
  return {
    name: 'character-locomotion',
    run({ world, inputs, clock }) {
      world.query(CharacterController, CharacterLocomotion).forEach((entity, character, last) => {
        const own = characterTuning(world, entity, tuning);
        const context: LocomotionContext = {
          tuning: own,
          gait: own.gait ?? DEFAULT_GAIT_TUNING,
          clock,
        };
        const next = stepLocomotion(
          last,
          {
            character,
            moving: options.moving(inputs, entity),
            yaw: options.facing?.(entity),
            surface: options.surface?.(entity),
            noise: options.noise?.(entity),
            encumbrance: options.encumbrance?.(entity),
          },
          context,
        );
        world.set(entity, CharacterLocomotion, next.locomotion);
        for (const event of next.events) {
          world.events.emit(LocomotionEvents, { ...event, entity, tick: world.tick });
        }
      });
    },
  };
}
