// Wading, swimming and sinking (mw-e02.14): how a character moves in water volumes (scene regions
// tagged `water`), and the breath that running out of keeps it from staying under. Deterministic
// sim: depth, speeds and breath come from the controller content's `water` tuning, never from the
// renderer. Water volumes are boxes; the surface is the top of the box and the depth at the feet is
// the surface minus the feet height.
//
// Depth at the feet picks the mode, every tick:
//   < wadeDepth (0.5 m)         ordinary walking
//   wadeDepth..swimDepth (1.2)  WADING: locomotion at wadeScale (60%) of the run speed, no sprint,
//                               footsteps report the material `water`
//   > swimDepth                 by armor load class (ADR-0003):
//     lighter than sinkFromLoadClass  SWIMMING (traversal 'swim'): floats with the head above the surface
//                               at swimSpeed.<class>, crouch dives, hands are busy (no attack, block
//                               or bow: the combat gate reads the traversal mode), stamina drains
//     sinkFromLoadClass and up  SINKING (traversal 'swim', `swim.sinking`): no buoyancy; descends at
//                               sinkSpeed to the bottom and walks it at sinkScale (40%), cannot swim
//                               up and cannot jump. It climbs out where the bottom comes up to
//                               swimDepth (a bank, a ramp), or by shedding armor (the load class is
//                               read every tick, so unequipping floats it up).
// Wading and sinking are the ordinary locomotion (steps, slopes, ground) run at a scaled speed, so
// the bottom of a river is walked like any ground; only swimming has its own movement.
//
// Breath (`CharacterBreath`, given to the player) runs out while the surface is above the mouth
// (headHeight above the feet): breathSeconds of air, then a drowning event every drowning.intervalMs
// (damage is a placeholder until the damage model prices it, e04). Above water it refills in
// breathRecoverSeconds. Being in water (wading or deeper) makes the actor wet (wetness 1); the
// drying rules take it from there.
//
// Events: WaterEntered / WaterExited (a splash cue), Sinking (the first tick an armored character
// is dragged down: the warning), Drowning (damage).

import type { ControllerTuning, Frozen, WaterTuning } from '@content/index';
import { defineComponent, type EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { System, World } from '../core/world';
import { LOAD_CLASSES, type LoadClass } from '../inventory/equipment';
import { assignProperty, WorldProperties } from '../properties/components';
import type { Vec3 } from '../stimulus/shapes';
import {
  capsuleOf,
  moveFree,
  SKIN,
  moveTarget,
  moveTowards,
  stepCharacterWithImpacts,
  type CharacterInput,
  type CharacterState,
  type CharacterStep,
} from './controller';
import { CharacterController, characterTuning } from './system';
import type { TraversalContext, TraversalHook } from './traversal';
import { add, DOWN, flat, length, scale, vec } from './vec';

/** The tag a scene region carries to be water. */
export const WATER_TAG = 'water';
/** The footstep material of a character standing in water. */
export const WATER_MATERIAL = 'water';

/** The defaults when a controller profile has no `water` block (the shipped player profile has one). */
export const DEFAULT_WATER_TUNING: Frozen<WaterTuning> = Object.freeze({
  wadeDepth: 0.5,
  swimDepth: 1.2,
  wadeScale: 0.6,
  sinkFromLoadClass: 'medium',
  swimSpeed: Object.freeze({ light: 3, medium: 2 }),
  swimAccelTime: 0.4,
  staminaPerSecond: Object.freeze({ light: 1, medium: 4 }),
  floatDepth: 1.3,
  diveSpeed: 1.5,
  riseSpeed: 1.5,
  sinkSpeed: 2,
  sinkScale: 0.4,
  headHeight: 1.6,
  breathSeconds: 20,
  breathRecoverSeconds: 2,
  drowning: Object.freeze({ intervalMs: 1000, damage: 10 }),
});

/**
 * A box of water: corners in metres; the surface is `max.y` unless the volume is `live`, when it is
 * whatever `surface()` reads now (a liquid volume's level: a pond that fills and drains swims and
 * wades by its present depth).
 */
export interface WaterVolume {
  readonly id: string;
  readonly min: Vec3;
  readonly max: Vec3;
  /** The live surface height, m, capped at `max.y`; absent = the brim, always. */
  readonly surface?: () => number;
}

/** The height of the surface of `volume` now, m (an empty live volume is at its floor). */
export function surfaceOfVolume(volume: WaterVolume): number {
  if (volume.surface === undefined) return volume.max.y;
  return Math.min(volume.max.y, Math.max(volume.min.y, volume.surface()));
}

/**
 * The water volumes among a scene's regions (those tagged `water`), in scene order. `follow` may
 * give a region a live surface (see `WaterVolume.surface`); absent or undefined = the static box.
 */
export function waterVolumes(
  regions: readonly {
    readonly id: string;
    readonly min: Vec3;
    readonly max: Vec3;
    readonly tags: readonly string[];
  }[],
  follow?: (region: { readonly min: Vec3; readonly max: Vec3 }) => (() => number) | undefined,
): readonly WaterVolume[] {
  return regions
    .filter((region) => region.tags.includes(WATER_TAG))
    .map(({ id, min, max }) => {
      const surface = follow?.({ min, max });
      return surface === undefined ? { id, min, max } : { id, min, max, surface };
    });
}

/** The volume holding the point `p` (the highest surface when several do), or undefined. */
export function waterAt(volumes: readonly WaterVolume[], p: Vec3): WaterVolume | undefined {
  let found: WaterVolume | undefined;
  for (const v of volumes) {
    if (p.x < v.min.x || p.x > v.max.x || p.z < v.min.z || p.z > v.max.z) continue;
    const top = surfaceOfVolume(v);
    if (p.y < v.min.y || p.y > top) continue;
    if (found === undefined || top > surfaceOfVolume(found)) found = v;
  }
  return found;
}

/** How deep the water is at `feet`: metres from the surface down to the feet; 0 when not in water. */
export function waterDepthAt(volumes: readonly WaterVolume[], feet: Vec3): number {
  const volume = waterAt(volumes, feet);
  return volume === undefined ? 0 : surfaceOfVolume(volume) - feet.y;
}

/** What a character in water does (see the file header). */
export type WaterMode = 'dry' | 'wade' | 'swim' | 'sink';

/** The mode for `depth` of water and an armor load class. */
export function waterMode(
  depth: number,
  load: LoadClass | undefined,
  water: Frozen<WaterTuning>,
): WaterMode {
  if (depth < water.wadeDepth) return 'dry';
  if (depth <= water.swimDepth) return 'wade';
  const rank = (c: LoadClass): number => LOAD_CLASSES.indexOf(c);
  return rank(load ?? 'light') >= rank(water.sinkFromLoadClass) ? 'sink' : 'swim';
}

export interface WaterHookOptions {
  readonly volumes: readonly WaterVolume[];
  /**
   * A character's armor load class; undefined (no equipment) counts as light, as does a controller
   * run without an entity.
   */
  readonly loadClass?: (entity: EntityId) => LoadClass | undefined;
}

const tuningOf = (ctx: TraversalContext): Frozen<WaterTuning> =>
  ctx.tuning.water ?? DEFAULT_WATER_TUNING;

/** `state` without the water's data. */
function dry(state: CharacterState): CharacterState {
  const copy = { ...state };
  delete copy.swim;
  return copy;
}

/**
 * A swimmer reaching the bottom or a bank hands over to walking standing on it: the ground within a
 * step below the feet becomes its ground, so it steps up and follows slopes from the first tick
 * instead of drifting up them in the air.
 */
function settled(ctx: TraversalContext, state: CharacterState): CharacterState {
  const clean = dry(state);
  if (state.traversal !== 'swim' || state.grounded) return clean;
  const { stepHeight } = ctx.tuning;
  const from = add(state.position, vec(0, stepHeight, 0));
  const hit = ctx.world.sweepCapsule(
    capsuleOf(state, ctx.tuning),
    from,
    DOWN,
    2 * stepHeight + 2 * SKIN,
  );
  if (hit === undefined || hit.normal.y < ctx.params.minGroundY) return clean;
  return {
    ...clean,
    position: add(from, scale(DOWN, hit.distance - SKIN)),
    velocity: vec(state.velocity.x, 0, state.velocity.z),
    grounded: true,
    groundNormal: hit.normal,
    groundBody: hit.body,
  };
}

/** Runs the ordinary locomotion for this tick (no hooks), at the given tuning and input. */
function walk(
  ctx: TraversalContext,
  state: CharacterState,
  input: CharacterInput,
  tuning = ctx.tuning,
): CharacterStep {
  return stepCharacterWithImpacts({ ...settled(ctx, state), traversal: null }, input, {
    world: ctx.world,
    tuning,
    params: ctx.params,
  });
}

/** The input with the jump let go: no jumping off the bottom against the armor. */
function noJump(input: CharacterInput): CharacterInput {
  return { ...input, actions: { ...input.actions, jump: { pressed: false, held: false } } };
}

/**
 * The water traversal hook (see the file header): takes the character whenever its feet are in
 * wading water or deeper, runs wading and sinking through ordinary locomotion at a scaled speed, and
 * swims the loads lighter than sinkFromLoadClass. Add it after the ledge and climb hooks.
 */
export function waterTraversal(options: WaterHookOptions): TraversalHook {
  const { volumes } = options;
  const loadOf = (entity: EntityId | undefined): LoadClass =>
    (entity === undefined ? undefined : options.loadClass?.(entity)) ?? 'light';
  const surfaceOf = (state: CharacterState): number | undefined => {
    const volume = waterAt(volumes, state.position);
    return volume === undefined ? undefined : surfaceOfVolume(volume);
  };
  return {
    modes: ['swim'],
    shouldEnter(ctx) {
      const surface = surfaceOf(ctx.state);
      return surface !== undefined && surface - ctx.state.position.y >= tuningOf(ctx).wadeDepth;
    },
    step(ctx) {
      const { state, input } = ctx;
      const water = tuningOf(ctx);
      const surface = surfaceOf(state);
      const depth = surface === undefined ? 0 : surface - state.position.y;
      const mode = surface === undefined ? 'dry' : waterMode(depth, loadOf(ctx.entity), water);
      if (surface === undefined || mode === 'dry') return walk(ctx, state, input).state;
      if (mode === 'wade') {
        return walk(ctx, state, { ...input, speedScale: water.wadeScale }).state;
      }
      if (mode === 'sink') {
        // No buoyancy: drag takes the fall down to the sinking speed at once, then the bottom is
        // walked at a crawl. Jumping is no use against the armor.
        const slowed = {
          ...state,
          velocity: vec(
            state.velocity.x,
            Math.max(state.velocity.y, -water.sinkSpeed),
            state.velocity.z,
          ),
        };
        const tuning = { ...ctx.tuning, maxFallSpeed: water.sinkSpeed };
        const step = walk(ctx, slowed, { ...noJump(input), speedScale: water.sinkScale }, tuning);
        return {
          ...step.state,
          traversal: 'swim',
          swim: { surface, sinking: true, diving: false },
        };
      }
      return swim(ctx, water, surface, loadOf(ctx.entity) === 'medium' ? 'medium' : 'light');
    },
  };
}

/** One tick of swimming (light and medium loads): float, dive with crouch, paddle. */
function swim(
  ctx: TraversalContext,
  water: Frozen<WaterTuning>,
  surface: number,
  load: 'light' | 'medium',
): CharacterState {
  const { state, input, params, world } = ctx;
  const { dt } = params;
  const raw = input.actions.move;
  const deflection = Math.min(1, Math.sqrt(raw.x * raw.x + raw.y * raw.y));
  const speed = water.swimSpeed[load];
  const target = moveTarget(state.position, input, raw, speed * deflection, dt);
  const horizontal = moveTowards(flat(state.velocity), target, (speed / water.swimAccelTime) * dt);
  // Vertical: dive while crouch is held, otherwise float up to the height the head stays dry at.
  // Buoyancy only lifts: a swimmer carried above that height (a rising bed, a bank) is left there
  // rather than pushed back down into the slope.
  const floatY = surface - water.floatDepth;
  const wanted = input.actions.crouch.held
    ? -water.diveSpeed
    : Math.min(water.riseSpeed, Math.max(0, (floatY - state.position.y) / dt));
  const moved = moveFree(
    world,
    ctx.tuning,
    params,
    state.position,
    vec(horizontal.x, wanted, horizontal.z),
    capsuleOf({ ...state, crouched: false }, ctx.tuning),
  );
  const next = dry(state);
  return {
    ...next,
    position: moved.position,
    velocity: moved.velocity,
    grounded: false,
    groundNormal: vec(0, 1, 0),
    groundBody: null,
    crouched: false,
    sprinting: false,
    airTicks: 0,
    jumped: false,
    jumpAge: -1,
    traversal: 'swim',
    swim: { surface, sinking: false, diving: input.actions.crouch.held },
  };
}

// ---------------------------------------------------------------------------------------------
// Breath, wetness and the events

/** A character's breath: ticks of air left and the drowning clock (`character.breath`). */
export interface Breath {
  /** Ticks of air left (full = breathSeconds × hz). */
  readonly air: number;
  /** Ticks since the air ran out; 0 while there is air. */
  readonly drowning: number;
  /** The feet were in water (wading or deeper) last tick. */
  readonly inWater: boolean;
  /** The armor was dragging the character down last tick. */
  readonly sinking: boolean;
}

export const CharacterBreath = defineComponent<Breath>('character.breath');

/** A character with a full breath, out of the water (register CharacterBreath first). */
export function giveBreath(
  world: World<never>,
  entity: EntityId,
  tuning: Frozen<WaterTuning>,
  hz: number,
): void {
  world.add(entity, CharacterBreath, {
    air: tuning.breathSeconds * hz,
    drowning: 0,
    inWater: false,
    sinking: false,
  });
}

/** Share of the breath left, 0 (empty) to 1 (full). */
export function breathFraction(breath: Breath, tuning: Frozen<WaterTuning>, hz: number): number {
  return Math.min(1, Math.max(0, breath.air / (tuning.breathSeconds * hz)));
}

export interface WaterEvent {
  readonly entity: EntityId;
  readonly tick: number;
  readonly volume: string;
  /** Downward speed on entering, m/s (0 for exits). */
  readonly speed: number;
}

/** A character's feet went into water at least wadeDepth deep. */
export const WaterEntered = defineEvent<WaterEvent>('WaterEntered');
/** A character's feet left the water (or rose above wading depth). */
export const WaterExited = defineEvent<WaterEvent>('WaterExited');
/** An armored character began to sink: the warning that it is being dragged under. */
export const Sinking = defineEvent<{ readonly entity: EntityId; readonly tick: number }>('Sinking');
/**
 * Out of breath: damage tick. `amount` is a placeholder (tuning.drowning.damage) until the damage
 * model prices drowning (e04).
 */
export const Drowning = defineEvent<{
  readonly entity: EntityId;
  readonly tick: number;
  readonly amount: number;
}>('Drowning');

export interface WaterSystemOptions {
  readonly volumes: readonly WaterVolume[];
  readonly tuning: Frozen<ControllerTuning>;
  /** A character's armor load class (as for the hook). */
  readonly loadClass?: (entity: EntityId) => LoadClass | undefined;
  /** Applies a drowning tick (the game routes it to the damage model). */
  readonly onDrown?: (entity: EntityId, amount: number) => void;
  /** Drains a swimmer's stamina by `amount` this tick. */
  readonly drain?: (entity: EntityId, amount: number) => void;
}

/**
 * Breath, wetness and water events for every character with a CharacterBreath, after the
 * controller has moved it (see the file header).
 */
export function waterSystem<TInput>(options: WaterSystemOptions): System<TInput> {
  const { volumes } = options;
  return {
    name: 'water',
    run({ world: w, clock, tick }) {
      const world: World<never> = w;
      world.query(CharacterController, CharacterBreath).forEach((entity, state, breath) => {
        const water = characterTuning(world, entity, options.tuning).water ?? DEFAULT_WATER_TUNING;
        const volume = waterAt(volumes, state.position);
        const depth = volume === undefined ? 0 : surfaceOfVolume(volume) - state.position.y;
        const inWater = volume !== undefined && depth >= water.wadeDepth;
        const full = water.breathSeconds * clock.hz;
        const submerged = inWater && (depth > water.headHeight || state.swim?.diving === true);
        let { air, drowning } = breath;
        if (submerged) {
          air = Math.max(0, air - 1);
          if (air === 0) {
            drowning += 1;
            const every = Math.max(1, clock.ticksFor(water.drowning.intervalMs));
            if (drowning % every === 0) {
              world.events.emit(Drowning, { entity, tick, amount: water.drowning.damage });
              options.onDrown?.(entity, water.drowning.damage);
            }
          }
        } else {
          air = Math.min(full, air + full / (water.breathRecoverSeconds * clock.hz));
          drowning = 0;
        }
        const sinking = state.swim?.sinking === true;
        if (sinking && !breath.sinking) world.events.emit(Sinking, { entity, tick });
        if (inWater && !breath.inWater) {
          world.events.emit(WaterEntered, {
            entity,
            tick,
            volume: volume.id,
            speed: Math.max(0, -state.velocity.y),
          });
        } else if (!inWater && breath.inWater) {
          world.events.emit(WaterExited, { entity, tick, volume: '', speed: 0 });
        }
        if (inWater && world.isRegistered(WorldProperties.wetness)) {
          assignProperty(world, entity, 'wetness', 1);
        }
        if (state.traversal === 'swim' && state.swim?.sinking === false) {
          const load = options.loadClass?.(entity) === 'medium' ? 'medium' : 'light';
          const perSecond = water.staminaPerSecond[load];
          if (perSecond > 0) options.drain?.(entity, perSecond / clock.hz);
        }
        if (
          air !== breath.air ||
          drowning !== breath.drowning ||
          inWater !== breath.inWater ||
          sinking !== breath.sinking
        ) {
          world.set(entity, CharacterBreath, { air, drowning, inWater, sinking });
        }
      });
    },
  };
}

/** Horizontal speed of a character, m/s (for tests and readouts). */
export const horizontalSpeed = (state: Pick<CharacterState, 'velocity'>): number =>
  length(flat(state.velocity));
