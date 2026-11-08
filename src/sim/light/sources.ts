// Light sources (mw-e03.16): candles, torches, sconces, braziers, lanterns and fireplaces, entirely
// from world properties. A light source is flammable fuel plus a light emitter that shines only while
// it burns (the light field reads `light.source`), so everything that already puts fires out or
// lights them acts on it; nothing here pairs "water arrow" with "torch".
//
// - Extinguish: wetness at or above 0.5, cold and freezing (the fire rules, mw-e03.5); a force
//   stimulus delivering more than the source's `windResistance` (this file: a candle gutters in a
//   gust, a brazier does not); the silent smother by hand (the `extinguish` affordance, held 1.0 s,
//   reach 2 m, a whisper of noise); and fuel running out (the fire rules' burnout; a light source
//   stays in the world, unlit, instead of burning away).
// - Relight: heat. The fire rules ignite anything flammable whose temperature reaches its ignition
//   point and is not soaked (wetness < 0.5) or frozen, so a soaked torch stays dark until it has
//   dried. A gust or a smother also cools the flame's heat away, or the source would relight at once.
// - `lightChanged` says every time one goes on or off, why, and who is to blame (the heat source of a
//   relight, the actor of a smother or a blast; null for the weather and for fuel).
// - Designer flags: `unlit` (starts dark) and `infiniteFuel` (topped up while it burns).
// - A guard's lantern is the same prefab with a `carrier`: it follows the actor, so soaking or
//   freezing it leaves the guard walking in the dark.
//
// Noise: the smother makes `SNUFF_LOUDNESS` dB at 1 m. Noise events are in dB; a 0..1 loudness is
// `normalizedLoudness(dB)` = dB / `NOISE_REFERENCE_DB`, so a smother is 0.04 (the bell's 85 dB is 0.85).

import type { EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { World } from '../core/world';
import { cellsInSphere } from '../elements/cells';
import { DEFAULT_FIRE_CONFIG, fireBurntOut, fireExtinguished, fireIgnited } from '../elements/fire';
import type { ExtinguishCause } from '../elements/fire';
import { ElementFieldComponent, elementFieldOf } from '../field/install';
import {
  addAffordanceGate,
  addInteractable,
  InteractableComponent,
  interacted,
} from '../interaction/system';
import { noiseEmitted } from '../noise/events';
import {
  addProperties,
  assignProperty,
  propertyChanged,
  readProperty,
  setProperty,
  WorldProperties,
} from '../properties/components';
import { placeEntity, PlacementComponent, placementOf } from '../stimulus/placement';
import { shapeFalloff, type Vec3 } from '../stimulus/shapes';
import { stimulusResolved } from '../stimulus/stimulus';
import { LightSourceComponent } from './components';

/** The light source prefabs. */
export const LIGHT_SOURCE_VARIANTS = [
  'candle',
  'torch',
  'sconce',
  'brazier',
  'lantern',
  'fireplace',
] as const;
export type LightSourceVariant = (typeof LIGHT_SOURCE_VARIANTS)[number];

/** What defines a light source prefab (all of it ends up as world properties). */
export interface LightSourcePrefab {
  /** Seconds of burning a full source has. */
  readonly fuel: number;
  /** Temperature at which it lights, °C. */
  readonly ignitionPoint: number;
  /** Force of one gust or blast that blows it out, N·s. */
  readonly windResistance: number;
  /** Light output (sim light units) and reach (m). */
  readonly intensity: number;
  readonly radius: number;
  /** Bounding radius, metres. */
  readonly size: number;
}

const prefab = (spec: LightSourcePrefab): LightSourcePrefab => Object.freeze(spec);

/**
 * The prefabs' numbers. Wind resistance runs from a candle that a breath puts out to a fireplace
 * that no blast of a spell does; a lantern's glass shields its flame, a torch is in the open.
 */
export const LIGHT_SOURCE_PREFABS: Readonly<Record<LightSourceVariant, LightSourcePrefab>> =
  Object.freeze({
    candle: prefab({
      fuel: 1800,
      ignitionPoint: 200,
      windResistance: 0.5,
      intensity: 30,
      radius: 4,
      size: 0.05,
    }),
    torch: prefab({
      fuel: 1200,
      ignitionPoint: 250,
      windResistance: 4,
      intensity: 100,
      radius: 8,
      size: 0.15,
    }),
    sconce: prefab({
      fuel: 3600,
      ignitionPoint: 250,
      windResistance: 4,
      intensity: 80,
      radius: 7,
      size: 0.15,
    }),
    brazier: prefab({
      fuel: 3600,
      ignitionPoint: 250,
      windResistance: 40,
      intensity: 120,
      radius: 9,
      size: 0.4,
    }),
    lantern: prefab({
      fuel: 2400,
      ignitionPoint: 200,
      windResistance: 8,
      intensity: 70,
      radius: 7,
      size: 0.15,
    }),
    fireplace: prefab({
      fuel: 7200,
      ignitionPoint: 250,
      windResistance: 1000,
      intensity: 130,
      radius: 10,
      size: 0.6,
    }),
  });

/** Seconds Interact is held to smother a flame by hand. */
export const SNUFF_SECONDS = 1.0;
/** How close an actor must be to smother a flame, metres. */
export const SNUFF_REACH = 2;
/** Noise of a smother, dB 1 m away: a pinch of fingers. */
export const SNUFF_LOUDNESS = 4;
/** The dB that is loudness 1 when noise is normalised to 0..1 (a shout is about 100). */
export const NOISE_REFERENCE_DB = 100;

/** A noise level in dB at 1 m as a 0..1 loudness. */
export function normalizedLoudness(decibels: number): number {
  return decibels / NOISE_REFERENCE_DB;
}

/** The most fuel a source can hold (the `fuel` property's maximum): what `infiniteFuel` keeps it at. */
export const FULL_FUEL = 86_400;
/** Temperature of a source lit at spawn, °C: a flame (`DEFAULT_FIRE_CONFIG`). */
export const LIT_TEMPERATURE = DEFAULT_FIRE_CONFIG.flameTemperature;

/** Why a light changed. */
export type LightChangeCause =
  /** A relight: the heat reached its ignition point. */
  | 'heat'
  /** The fire rules put it out: water, cold, frozen, smothered air or no longer flammable. */
  | ExtinguishCause
  /** A force above its wind resistance. */
  | 'force'
  /** Smothered by hand. */
  | 'snuff'
  /** The fuel ran out. */
  | 'fuel';

/** A light source went on or off. */
export interface LightChange {
  readonly tick: number;
  readonly entity: EntityId;
  /** Whether it is lit now. */
  readonly lit: boolean;
  readonly cause: LightChangeCause;
  /** Who it is attributed to (the heat source, the actor who smothered it), or null. */
  readonly source: EntityId | null;
}

/** Fired whenever a light source lights or goes out; AI noticing dark torches listens to it. */
export const lightChanged = defineEvent<LightChange>('lightChanged');

/** Designer options of a spawned light source. */
export interface LightSourceOptions {
  /** Starts dark (a heat source or an actor lights it later). Default false. */
  readonly unlit?: boolean;
  /** Never runs out of fuel while it burns. Default false. */
  readonly infiniteFuel?: boolean;
  /** An actor that carries it (a guard's lantern). */
  readonly carrier?: EntityId;
  /** Where it hangs relative to its carrier, metres. Default 1 m up. */
  readonly offset?: Vec3;
}

const SOURCE_AT_HAND = Object.freeze({ x: 0, y: 1, z: 0 });

/**
 * Turns `entity` into a light source of `variant` at `position` (see the file header): its fuel,
 * ignition point, light and wind resistance are the prefab's, replacing any of its own. With an
 * interaction system installed it also gets the smother affordance. Structural: during a step it
 * takes effect at the end of the tick.
 */
export function makeLightSource(
  world: World<never>,
  entity: EntityId,
  variant: LightSourceVariant,
  position: Vec3,
  options: LightSourceOptions = {},
): void {
  const { fuel, ignitionPoint, windResistance, intensity, radius, size } =
    LIGHT_SOURCE_PREFABS[variant];
  const lit = options.unlit !== true;
  const infiniteFuel = options.infiniteFuel === true;
  addProperties(world, entity, {
    flammable: true,
    ignitionPoint,
    fuel: infiniteFuel ? FULL_FUEL : fuel,
    burning: lit,
    temperature: lit ? LIT_TEMPERATURE : 20,
    wetness: 0,
    extinguishable: true,
    windResistance,
    lightEmitter: { intensity, radius },
  });
  world.add(entity, LightSourceComponent, {
    variant,
    infiniteFuel,
    carrier: options.carrier ?? null,
    offset: options.offset ?? SOURCE_AT_HAND,
  });
  if (world.isRegistered(InteractableComponent)) {
    addInteractable(
      world,
      entity,
      {
        affordances: [{ verb: 'extinguish', label: 'Snuff', hold: SNUFF_SECONDS }],
        range: SNUFF_REACH,
        anchor: [0, 0, 0],
        radius: size,
      },
      position,
    );
  } else {
    placeEntity(world, entity, position, size);
  }
}

/** Spawns a new entity and makes it a light source (see `makeLightSource`). Returns it. */
export function spawnLightSource(
  world: World<never>,
  variant: LightSourceVariant,
  position: Vec3,
  options: LightSourceOptions = {},
): EntityId {
  const entity = world.spawn();
  makeLightSource(world, entity, variant, position, options);
  return entity;
}

/** The moves a light source makes every tick: it follows its carrier and tops up infinite fuel. */
export function updateLightSources(world: World<never>): void {
  for (const entity of [...world.query(LightSourceComponent).ids()]) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const source = world.get(entity, LightSourceComponent)!;
    if (source.infiniteFuel && readProperty(world, entity, 'burning')) {
      assignProperty(world, entity, 'fuel', FULL_FUEL);
    }
    if (source.carrier === null) continue;
    const at = world.get(source.carrier, PlacementComponent);
    if (at === undefined) continue;
    const { offset } = source;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const own = world.get(entity, PlacementComponent)!;
    placeEntity(
      world,
      entity,
      { x: at.x + offset.x, y: at.y + offset.y, z: at.z + offset.z },
      own.radius,
    );
  }
}

/** Blows or smothers `entity`'s flame out: it goes dark and its heat is carried off. */
function putOut(
  world: World<never>,
  entity: EntityId,
  cause: 'force' | 'snuff',
  source: EntityId | null,
): void {
  const field = world.isRegistered(ElementFieldComponent) ? elementFieldOf(world) : undefined;
  const ambient = field?.config.temperature.ambient ?? 20;
  setProperty(world, entity, 'burning', false, source === null ? {} : { source });
  assignProperty(
    world,
    entity,
    'temperature',
    Math.min(readProperty(world, entity, 'temperature'), ambient),
  );
  const at = world.get(entity, PlacementComponent);
  if (field !== undefined && at !== undefined) {
    for (const cell of cellsInSphere(field, at, at.radius + DEFAULT_FIRE_CONFIG.flameReach)) {
      field.set('temperature', cell, Math.min(field.read('temperature', cell), ambient));
    }
  }
  world.events.emit(lightChanged, { tick: world.tick, entity, lit: false, cause, source });
}

/**
 * Wires the light source rules into `world` (see the file header): force blows flames out, the
 * smother affordance snuffs them, and `lightChanged` reports every change. `installLightField` calls
 * this. Returns a function that removes the subscriptions.
 */
export function installLightSources<TInput>(world: World<TInput>): () => void {
  const w: World<never> = world;
  const isSource = (entity: EntityId): boolean => w.has(entity, LightSourceComponent);
  /** Who last heated each source: the attribution of its relight. */
  const heatedBy = new Map<EntityId, EntityId>();
  const report = (
    entity: EntityId,
    lit: boolean,
    cause: LightChangeCause,
    source: EntityId | null,
  ): void => {
    world.events.emit(lightChanged, { tick: w.tick, entity, lit, cause, source });
  };
  const offs = [
    world.events.on(propertyChanged, (change) => {
      if (change.key === 'temperature' && change.source !== null && change.new > change.old) {
        heatedBy.set(change.entity, change.source);
      }
    }),
    world.events.on(fireIgnited, ({ entity }) => {
      if (!isSource(entity)) return;
      report(entity, true, 'heat', heatedBy.get(entity) ?? null);
      heatedBy.delete(entity);
    }),
    world.events.on(fireExtinguished, ({ entity, cause }) => {
      if (isSource(entity)) report(entity, false, cause, null);
    }),
    world.events.on(fireBurntOut, ({ entity }) => {
      if (w.isAlive(entity) && isSource(entity)) report(entity, false, 'fuel', null);
    }),
    world.events.on(stimulusResolved, ({ stimulus, amount }) => {
      if (stimulus.element !== 'force') return;
      const { shape, source } = stimulus;
      const spared = stimulus.sparesSource === true ? source : null;
      const blown: EntityId[] = [];
      w.query(WorldProperties.burning).forEach((entity, burning) => {
        if (!burning || entity === spared || !readProperty(w, entity, 'extinguishable')) return;
        const at = w.get(entity, PlacementComponent);
        const falloff =
          shape.kind === 'contact'
            ? shape.target === entity
              ? 1
              : undefined
            : at === undefined
              ? undefined
              : shapeFalloff(shape, stimulus.falloff, at, at.radius);
        if (falloff !== undefined && amount * falloff > readProperty(w, entity, 'windResistance')) {
          blown.push(entity);
        }
      });
      for (const entity of blown) putOut(w, entity, 'force', source);
    }),
    world.events.on(interacted, ({ actor, target, verb }) => {
      if (verb !== 'extinguish' || !isSource(target) || !readProperty(w, target, 'burning')) return;
      putOut(w, target, 'snuff', actor);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const at = placementOf(w, target)!;
      world.events.emit(noiseEmitted, {
        tick: w.tick,
        position: { x: at.x, y: at.y, z: at.z },
        loudness: SNUFF_LOUDNESS,
        kind: 'snuff',
        entity: target,
        source: actor,
      });
    }),
    addAffordanceGate(world, (gateWorld, _actor, target, affordance) =>
      affordance.verb === 'extinguish' &&
      isSource(target) &&
      !readProperty(gateWorld, target, 'burning')
        ? 'Already out'
        : undefined,
    ),
  ];
  return () => {
    for (const off of offs) off();
  };
}
