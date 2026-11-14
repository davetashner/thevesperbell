// Footstep noise (mw-e09.5): every step and every landing is a sound in the world, so moving slowly
// and choosing the path pays off ("running on gravel in plate armour wakes the keep; creeping
// barefoot over carpet does not"). One rule serves the player and the creatures; the player hears
// guards through the same events.
//
//   step loudness    = gait dB + surface offset + equipment dB + creak          (dB at 1 m)
//   gait dB          sneak 25, walk 40, run 55, sprint 65 (the stealth table's `noise.footsteps`)
//   surface offset   the surface under the foot, dB relative to stone (carpet -10, gravel +8; wet and
//                    frozen included), read by the footstep event (mw-e02.11, mw-e09.4)
//   equipment dB     20·log10 of the wearer's noise multiplier (ADR-0003: the armor load class,
//                    1.0 / 1.3 / 1.6 / 1.8, applied ONCE, times each equipped item's own multiplier,
//                    clamped to 0.5–2.0). A product of multipliers is a sum of decibels, so this is
//                    "the sum of the equipped items' noise values", never one term per armor piece.
//   creak            a surface row's seeded chance of an extra loud step (hollow boards 10% for +12 dB)
//
// The seeded variance (`varianceDb`) of the surface table is not rolled here: a step's loudness is
// exactly what the formula says, so tuning is legible and tests can pin dB. Variance stays a hint for
// the audio side's pitch and sample choice. The creak is rolled from the world's `footstep-creak`
// stream, so it replays and never shifts another system's draws.
//
// Gaits: crouched, or the slow-walk modifier, is a sneak; otherwise the footstep event's own gait.
// Creatures have no controller: their gait is read from the speed they move at (the stealth table's
// `creatureGait`), and their steps come at the gait's stride from distance moved, so a patrolling
// guard steps and a standing one is silent.
//
// A landing is one noise by fall height (the `land` event's `fallHeight`, the height whose free fall
// reaches the touchdown speed): silent below `minHeight`, then the table's piecewise curve, plus the
// surface and the equipment dB. It is the only noise of a landing: the player's body is not a physics
// object, so no `physicsImpact` (and no impact noise) is raised for it.
//
// A listener never hears its own footfall (source and entity are the walker), and perception only
// lets creatures notice the footsteps of its targets (a patrol does not chase its own colleagues).

import type { AcousticSurface, NoiseTuning } from '@content/index';
import { CharacterController } from '../character/system';
import { LocomotionEvents } from '../character/locomotion';
import { CharacterEncumbrance } from '../character/profile';
import type { FootSurface } from '../character/footsteps';
import { defineComponent, type EntityId } from '../core/component';
import type { Query } from '../core/query';
import type { World } from '../core/world';
import { CreatureComponent } from '../creatures/components';
import { conditionOf } from '../creatures/condition';
import { log } from '../math';
import { piecewise } from '../stealth/visibility';
import { PlacementComponent, type Placement } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { emitNoise } from './system';

/** The noise kind of one footstep. */
export const FOOTSTEP_NOISE = 'footstep';
/** The noise kind of a landing. */
export const LANDING_NOISE = 'landing';

/** Whether a noise kind is a character's own movement (footsteps and landings). */
export function isMovementNoise(kind: string): boolean {
  return kind === FOOTSTEP_NOISE || kind === LANDING_NOISE;
}

/** The footstep tuning (the stealth table's `noise.footsteps`). */
export type FootstepNoiseTuning = NoiseTuning['footsteps'];

/** The gaits a step is loud by. */
export type NoiseGait = keyof FootstepNoiseTuning['gaitDb'];

/** 20·log10 of a noise multiplier: the equipment term, dB (a multiplier of 1 is 0 dB). */
export function equipmentDb(multiplier: number): number {
  return (20 * log(multiplier)) / Math.LN10;
}

/** One step's loudness, dB at 1 m (see the file header); never below 0. */
export function footstepDb(
  tuning: FootstepNoiseTuning,
  gait: NoiseGait,
  surfaceDb: number,
  equipment: number,
  creak = 0,
): number {
  return Math.max(0, tuning.gaitDb[gait] + surfaceDb + equipment + creak);
}

/** A landing's base level, dB on stone, by fall height; null below the minimum height. */
export function landingBaseDb(tuning: FootstepNoiseTuning, fallHeight: number): number | null {
  const { minHeight, curve } = tuning.landing;
  if (!(fallHeight >= minHeight)) return null;
  return piecewise(
    curve.map((point) => ({ x: point.height, y: point.db })),
    fallHeight,
  );
}

/** A landing's loudness, dB at 1 m; null when the fall is too short to be heard over a step. */
export function landingDb(
  tuning: FootstepNoiseTuning,
  fallHeight: number,
  surfaceDb: number,
  equipment: number,
): number | null {
  const base = landingBaseDb(tuning, fallHeight);
  return base === null ? null : Math.max(0, base + surfaceDb + equipment);
}

/** The gait a creature moving at `speed` m/s steps in, or undefined when it is standing. */
export function creatureGait(
  tuning: FootstepNoiseTuning,
  speed: number,
): 'walk' | 'run' | 'sprint' | undefined {
  const { walkFrom, runFrom, sprintFrom } = tuning.creatureGait;
  if (!(speed >= walkFrom)) return undefined;
  if (speed >= sprintFrom) return 'sprint';
  return speed >= runFrom ? 'run' : 'walk';
}

/**
 * What a creature's stepping remembers between ticks (`noise.stride`; a snapshot and save key, never
 * renamed): where it was last tick and the ground distance since its last step.
 */
export interface CreatureStride {
  readonly x: number;
  readonly z: number;
  readonly stride: number;
}

/** A creature's stride (see CreatureStride). */
export const CreatureStrideComponent = defineComponent<CreatureStride>('noise.stride');

/** Faster than this between two ticks is a teleport, not a walk: no step, no stride. */
export const MAX_STEP_SPEED = 30;

/** What footstep noise reads. */
export interface FootstepNoiseOptions {
  readonly tuning: FootstepNoiseTuning;
  /** Surface id → its acoustics, for the creak; none: no board creaks. */
  readonly surfaces?: ReadonlyMap<string, AcousticSurface>;
  /** What a creature's feet are on at `position` (no collider to read); none: stone (0 dB). */
  readonly creatureSurface?: (position: Vec3) => FootSurface | undefined;
}

/**
 * Makes every footstep and landing a `noiseEmitted` and every moving creature step (see the file
 * header). Install once, after the creature AI (so a creature's move is read the tick it is made).
 * Returns the function that stops it.
 */
export function installFootstepNoise<T>(
  world: World<T>,
  options: FootstepNoiseOptions,
): () => void {
  const w = world as unknown as World<never>;
  const { tuning } = options;
  let installed = true;
  if (!w.isRegistered(CreatureStrideComponent)) w.register(CreatureStrideComponent);

  const load = (entity: EntityId): number =>
    w.isRegistered(CharacterEncumbrance)
      ? equipmentDb(w.get(entity, CharacterEncumbrance)?.noise ?? 1)
      : 0;

  const creakOf = (material: string | undefined): number => {
    const creak = material === undefined ? undefined : options.surfaces?.get(material)?.creak;
    if (creak === undefined) return 0;
    return w.random('footstep-creak').chance(creak.chance) ? creak.db : 0;
  };

  const step = (
    entity: EntityId,
    position: Vec3,
    gait: NoiseGait,
    surfaceDb: number,
    equipment: number,
    material: string | undefined,
  ): void => {
    emitNoise(w, {
      position,
      loudness: footstepDb(tuning, gait, surfaceDb, equipment, creakOf(material)),
      kind: FOOTSTEP_NOISE,
      entity,
      source: entity,
      tags: [gait],
    });
  };

  const off = w.events.on(LocomotionEvents, (event) => {
    if (event.kind === 'footstep') {
      const state = w.get(event.entity, CharacterController);
      const sneaking = event.gait === 'crouch' || state?.slowWalk === true;
      const gait: NoiseGait = sneaking ? 'sneak' : event.gait;
      step(
        event.entity,
        event.position,
        gait,
        event.surfaceDb,
        equipmentDb(event.encumbrance),
        event.material,
      );
    } else if (event.kind === 'land') {
      const loudness = landingDb(
        tuning,
        event.fallHeight,
        event.surfaceDb,
        equipmentDb(event.encumbrance),
      );
      if (loudness === null) return;
      emitNoise(w, {
        position: event.position,
        loudness,
        kind: LANDING_NOISE,
        entity: event.entity,
        source: event.entity,
      });
    }
  });

  // Scenes install this before the creature components exist: look for them each tick.
  const walking: [EntityId, Placement][] = [];
  let walkers: Query<[typeof CreatureComponent, typeof PlacementComponent]> | undefined;
  w.addSystem({
    name: 'creature-footsteps',
    run({ world: sim, clock }) {
      if (!installed) return;
      if (!sim.isRegistered(CreatureComponent) || !sim.isRegistered(PlacementComponent)) return;
      walkers ??= sim.query(CreatureComponent, PlacementComponent);
      const dt = 1 / clock.hz;
      // Collected first: a creature's stride is stored (added or replaced) as it steps.
      walking.length = 0;
      walkers.forEach((entity, _creature, at) => {
        walking.push([entity, at]);
      });
      for (const [entity, at] of walking) {
        if (sim.isRegistered(CharacterController) && sim.has(entity, CharacterController)) continue;
        const last = sim.get(entity, CreatureStrideComponent);
        let stride = last?.stride ?? 0;
        const moved =
          last === undefined ? 0 : Math.sqrt((at.x - last.x) ** 2 + (at.z - last.z) ** 2);
        const speed = moved / dt;
        const gait =
          last === undefined || speed > MAX_STEP_SPEED || conditionIsDown(w, entity)
            ? undefined
            : creatureGait(tuning, speed);
        if (gait === undefined) {
          stride = tuning.creatureGait.stride.walk / 2;
        } else {
          stride += moved;
          const spacing = tuning.creatureGait.stride[gait];
          if (stride >= spacing) {
            stride -= spacing;
            const feet = { x: at.x, y: at.y, z: at.z };
            const ground = options.creatureSurface?.(feet);
            step(entity, feet, gait, ground?.surfaceDb ?? 0, load(entity), ground?.material);
          }
        }
        const next = Object.freeze({ x: at.x, z: at.z, stride });
        if (last === undefined) sim.add(entity, CreatureStrideComponent, next);
        else sim.set(entity, CreatureStrideComponent, next);
      }
    },
  });

  return () => {
    installed = false;
    off();
  };
}

function conditionIsDown(world: World<never>, entity: EntityId): boolean {
  const condition = conditionOf(world, entity);
  return condition !== undefined && condition.unconsciousUntil > world.tick;
}
