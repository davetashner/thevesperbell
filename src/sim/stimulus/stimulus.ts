// The one stimulus API (mw-e03.3). Spells, arrows, torches, lightning, creatures and traps all act on
// the world through `applyStimulus(world, { shape, element, intensity, duration, source })`, never by
// knowing what they hit: an element meets whatever properties the overlapped entities have, so "fire
// + rope" and "frost + water" are consequences of properties, not special cases. This module only
// injects; what happens next (ignition, freezing, conduction, gas spread) is propagation, owned by the
// element rules that react to the property changes and events emitted here.
//
// Timing and order. `applyStimulus` only queues. The queue lives in the world (a snapshotted
// component on one entity), kept in canonical order: by the tick it was applied, then by its encoded
// content. `resolveStimuli` — run by `stimulusSystem` at a fixed place in the system order — resolves
// every queued stimulus in that order, and each one hits its targets in ascending entity id order.
// Issue order therefore never matters: two stimuli applied in either order give identical state.
// A stimulus with a duration is spread evenly over round(duration × hz) resolutions (at least one).
//
// Element effects (intensity units in brackets; each hit receives intensity × falloff):
// - heat / cold [°C]: raise / lower `temperature` of entities that have one (clamped to its range).
// - water [wetness 0–1]: raise `wetness` of entities that have one (clamped at 1, or at the entity's
//   `absorbency` when that is lower: iron takes a film of water, mw-e03.6).
// - charge [charge]: raise `charge` of entities that have one.
// - force [N·s]: an impulse on pushable, liftable, breakable or bashable entities with weight > 0,
//   delivered through `impulseApplied` (velocity change = impulse / weight) for the physics layer to
//   integrate; a breakable's structure takes the shove too (mw-e03.11: a blast brings an old wall
//   down). A force with a `maxWeight` (a shield bash's 60 kg, mw-e04.14) moves nothing heavier: such
//   an entity resists — `ImpactResisted`, no impulse, and it is not among the stimulus's hits.
// - blunt / slash / pierce [J]: impact energy on entities with `hp` or `fragile`, reported as hits
//   for breakables to consume.
// - gas [concentration], light [light units]: no entity targets; they act on the element field and
//   light field, which read them from `stimulusResolved`.
// Every property write carries the stimulus's source for attribution (quests, crime, telemetry). A
// stimulus that `sparesSource` never reaches its own source (a knight's swing does not shove the
// knight).

import type { EntityId } from '../core/component';
import { defineComponent } from '../core/component';
import { defineEvent } from '../core/events';
import type { System, World } from '../core/world';
import { hasProperty, readProperty, setProperty } from '../properties/components';
import { PROPERTY_ID_PATTERN, WORLD_PROPERTY_SPECS } from '../properties/spec';
import { encodeCanonical } from '../snapshot';
import { boundingSphereOf, PlacementCentreComponent, PlacementComponent } from './placement';
import {
  isDegenerateShape,
  normalize,
  normalizeShape,
  shapeFalloff,
  shapePush,
  type StimulusFalloff,
  type StimulusShape,
  type Vec3,
} from './shapes';

/** Every stimulus element. */
export const STIMULUS_ELEMENTS = [
  'heat',
  'cold',
  'water',
  'charge',
  'force',
  'gas',
  'light',
  'blunt',
  'slash',
  'pierce',
] as const;

/** What a stimulus carries into the world. */
export type StimulusElement = (typeof STIMULUS_ELEMENTS)[number];

const SHAPE_KINDS: readonly string[] = ['point', 'sphere', 'cone', 'capsule', 'box', 'contact'];
const FALLOFFS: readonly string[] = ['linear', 'none'];

/** Properties an element changes directly, and in which direction. */
interface PropertyEffect {
  readonly kind: 'property';
  readonly key: 'temperature' | 'wetness' | 'charge';
  readonly sign: 1 | -1;
}
type TargetEffect = PropertyEffect | { readonly kind: 'impulse' } | { readonly kind: 'impact' };
type Effect = TargetEffect | { readonly kind: 'field' };

const EFFECTS: Readonly<Record<StimulusElement, Effect>> = {
  heat: { kind: 'property', key: 'temperature', sign: 1 },
  cold: { kind: 'property', key: 'temperature', sign: -1 },
  water: { kind: 'property', key: 'wetness', sign: 1 },
  charge: { kind: 'property', key: 'charge', sign: 1 },
  force: { kind: 'impulse' },
  gas: { kind: 'field' },
  light: { kind: 'field' },
  blunt: { kind: 'impact' },
  slash: { kind: 'impact' },
  pierce: { kind: 'impact' },
};

/**
 * Which way `element` moves a temperature: +1 for heat, -1 for cold, 0 for every other element.
 * Things that hold their own temperature apart from the entities (a liquid volume's surface cells)
 * read the direction here, so they never name an element.
 */
export function temperatureSign(element: StimulusElement): -1 | 0 | 1 {
  const effect = EFFECTS[element];
  return effect.kind === 'property' && effect.key === 'temperature' ? effect.sign : 0;
}

/** A stimulus as callers describe it; see the file header for element semantics and units. */
export interface StimulusInput {
  readonly shape: StimulusShape;
  readonly element: StimulusElement;
  /** Total amount delivered at full falloff (≥ 0; 0 is a no-op). */
  readonly intensity: number;
  /** Seconds to spread the intensity over (≥ 0); 0 or omitted resolves once. */
  readonly duration?: number;
  /** Entity the effects are attributed to (the caster, archer, trap), or null. */
  readonly source?: EntityId | null;
  /** Defaults to `linear`. */
  readonly falloff?: StimulusFalloff;
  /** Force only: push direction (non-zero). Omitted: the shape's own push (see `shapePush`). */
  readonly direction?: Vec3;
  /** Gas only, required: gas type id (e.g. `smoke`, `marsh-gas`). */
  readonly gas?: string;
  /** Force only: the heaviest entity it moves, kg (> 0); heavier ones resist. Omitted: no limit. */
  readonly maxWeight?: number;
  /** The source itself is never reached (a swing's shove spares the swinger). Defaults to false. */
  readonly sparesSource?: boolean;
}

/** A validated stimulus with every default filled in (plain data, snapshot-safe). */
export interface Stimulus {
  readonly shape: StimulusShape;
  readonly element: StimulusElement;
  readonly intensity: number;
  readonly duration: number;
  readonly source: EntityId | null;
  readonly falloff: StimulusFalloff;
  /** Unit length when present. */
  readonly direction?: Vec3;
  readonly gas?: string;
  readonly maxWeight?: number;
  /** Present (true) only when the source is spared. */
  readonly sparesSource?: true;
}

/**
 * A validated, defaulted copy of `input`. Throws a RangeError for an unknown element, shape kind or
 * falloff, a negative or non-finite intensity or duration, a bad source id, a zero or non-finite
 * direction, or a gas id on the wrong element (or missing on gas).
 */
export function normalizeStimulus(input: StimulusInput): Stimulus {
  const { element, intensity } = input;
  if (!(STIMULUS_ELEMENTS as readonly string[]).includes(element)) {
    throw new RangeError(`unknown stimulus element "${element}"`);
  }
  if (!SHAPE_KINDS.includes(input.shape.kind)) {
    throw new RangeError(`unknown stimulus shape "${input.shape.kind}"`);
  }
  const falloff = input.falloff ?? 'linear';
  if (!FALLOFFS.includes(falloff)) throw new RangeError(`unknown falloff "${falloff}"`);
  if (!Number.isFinite(intensity) || intensity < 0) {
    throw new RangeError(`intensity must be a finite number ≥ 0, got ${String(intensity)}`);
  }
  const duration = input.duration ?? 0;
  if (!Number.isFinite(duration) || duration < 0) {
    throw new RangeError(`duration must be a finite number ≥ 0, got ${String(duration)}`);
  }
  const source = input.source ?? null;
  if (source !== null && (!Number.isSafeInteger(source) || source < 1)) {
    throw new RangeError(`source must be an entity id or null, got ${String(source)}`);
  }
  const stimulus: {
    -readonly [K in keyof Stimulus]: Stimulus[K];
  } = { shape: normalizeShape(input.shape), element, intensity, duration, source, falloff };
  if (input.direction !== undefined) {
    const { x, y, z } = input.direction;
    const unit = [x, y, z].every(Number.isFinite) ? normalize({ x, y, z }) : undefined;
    if (unit === undefined) throw new RangeError('direction must be a finite, non-zero vector');
    stimulus.direction = unit;
  }
  if (element === 'gas') {
    if (input.gas === undefined || !PROPERTY_ID_PATTERN.test(input.gas)) {
      throw new RangeError('a gas stimulus needs a lowercase kebab-case gas id');
    }
    stimulus.gas = input.gas;
  } else if (input.gas !== undefined) {
    throw new RangeError(`only gas stimuli take a gas id, not ${element}`);
  }
  if (input.maxWeight !== undefined) {
    if (element !== 'force') throw new RangeError(`only force stimuli take a maxWeight`);
    if (!Number.isFinite(input.maxWeight) || input.maxWeight <= 0) {
      throw new RangeError(`maxWeight must be a finite number > 0, got ${String(input.maxWeight)}`);
    }
    stimulus.maxWeight = input.maxWeight;
  }
  if (input.sparesSource === true) stimulus.sparesSource = true;
  return stimulus;
}

/** A stimulus waiting in the queue. */
export interface PendingStimulus {
  /** Tick it was applied on (the first ordering key). */
  readonly tick: number;
  readonly stimulus: Stimulus;
  /** Resolutions it is spread over. */
  readonly ticks: number;
  /** Resolutions still to come (1 … ticks). */
  readonly ticksLeft: number;
}

/** The queue's component value. */
export interface StimulusQueue {
  readonly entries: readonly PendingStimulus[];
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function restoreQueue(data: unknown): StimulusQueue {
  const entries = (data as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(entries)) throw new RangeError('stimulus queue must have an entries array');
  return {
    entries: entries.map((raw: unknown): PendingStimulus => {
      const { tick, ticks, ticksLeft, stimulus } = raw as Record<string, unknown>;
      const counts = isCount(tick) && isCount(ticks) && isCount(ticksLeft);
      if (!counts || ticksLeft < 1 || ticksLeft > ticks) {
        throw new RangeError('stimulus queue entry has invalid tick counts');
      }
      return { tick, ticks, ticksLeft, stimulus: normalizeStimulus(stimulus as StimulusInput) };
    }),
  };
}

/** The queue component (`stimulus.queue`; a snapshot and save key, never renamed). */
export const StimulusQueueComponent = defineComponent<StimulusQueue>('stimulus.queue', {
  deserialize: restoreQueue,
});

/** One target a resolved stimulus reached. */
export interface StimulusHit {
  readonly entity: EntityId;
  /** Falloff factor in (0, 1]. */
  readonly falloff: number;
  /** What the target received: this resolution's intensity × falloff, in the element's unit. */
  readonly amount: number;
}

/** One stimulus resolution (a stimulus with a duration resolves once per tick). */
export interface StimulusResolution {
  readonly tick: number;
  readonly stimulus: Stimulus;
  /** This resolution's share of the intensity (intensity / ticks). */
  readonly amount: number;
  /** Entities reached, ascending id order (empty for gas and light, which act on fields). */
  readonly hits: readonly StimulusHit[];
}

/** Fired after each stimulus resolution: the stimulus log, debug overlay, fields and breakables. */
export const stimulusResolved = defineEvent<StimulusResolution>('stimulusResolved');

/** A force stimulus's push on one physics object. */
export interface ImpulseApplied {
  readonly entity: EntityId;
  /** N·s. */
  readonly impulse: Vec3;
  /** m/s: impulse / weight. */
  readonly velocityChange: Vec3;
  readonly source: EntityId | null;
}

/** Fired for every entity a force stimulus pushes; the physics layer integrates it. */
export const impulseApplied = defineEvent<ImpulseApplied>('impulseApplied');

/** A force stimulus met something heavier than its `maxWeight` (mw-e04.14). */
export interface ImpactResistance {
  readonly tick: number;
  readonly entity: EntityId;
  /** The entity's weight, kg. */
  readonly weight: number;
  /** The stimulus's limit, kg. */
  readonly maxWeight: number;
  /** The push it did not get, N·s. */
  readonly impulse: Vec3;
  readonly source: EntityId | null;
}

/**
 * Fired for every entity too heavy for a force stimulus's `maxWeight` (a 100 kg crate under a shield
 * bash): it is not pushed. Audio and the HUD read it as the thud of something that will not budge.
 */
export const ImpactResisted = defineEvent<ImpactResistance>('ImpactResisted');

/**
 * Makes `world` accept stimuli: registers the placement, placement centre and queue components and
 * creates the queue. Call once at setup, after `registerWorldProperties` and outside a step.
 */
export function installStimuli<W extends World<never>>(world: W): W {
  world.register(PlacementComponent, PlacementCentreComponent, StimulusQueueComponent);
  world.add(world.spawn(), StimulusQueueComponent, { entries: [] });
  return world;
}

/** The queue's entity and value; throws when stimuli are not installed. */
function queueOf(world: World<never>): readonly [EntityId, StimulusQueue] {
  const found: (readonly [EntityId, StimulusQueue])[] = [];
  world.query(StimulusQueueComponent).forEach((id, queue) => found.push([id, queue]));
  const first = found[0];
  if (first === undefined) throw new Error('stimuli are not installed in this world');
  return first;
}

/** Sort key: the canonical encoding as a string of code units 0–255, so `<` is byte order. */
const contentKey = (entry: PendingStimulus): string =>
  String.fromCharCode(...encodeCanonical(entry));

/** Canonical order: by tick applied, then by encoded content (identical entries are interchangeable). */
function canonicalOrder(entries: readonly PendingStimulus[]): PendingStimulus[] {
  return entries
    .map((entry) => ({ entry, key: contentKey(entry) }))
    .sort((a, b) => a.entry.tick - b.entry.tick || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map(({ entry }) => entry);
}

/**
 * Queues a stimulus for the next resolution (see `resolveStimuli`). Returns false, queuing nothing,
 * for a no-op: zero intensity or a zero-size shape. Throws a RangeError for an invalid stimulus and
 * an Error when stimuli are not installed.
 */
export function applyStimulus(world: World<never>, input: StimulusInput): boolean {
  const stimulus = normalizeStimulus(input);
  const [id, queue] = queueOf(world);
  if (stimulus.intensity === 0 || isDegenerateShape(stimulus.shape)) return false;
  const ticks = Math.max(1, Math.round(stimulus.duration * world.clock.hz));
  const entry: PendingStimulus = { tick: world.tick, stimulus, ticks, ticksLeft: ticks };
  world.set(id, StimulusQueueComponent, { entries: canonicalOrder([...queue.entries, entry]) });
  return true;
}

/** Stimuli waiting to resolve, in resolution order. */
export function pendingStimuli(world: World<never>): readonly PendingStimulus[] {
  return queueOf(world)[1].entries;
}

/** Whether `entity` is something `effect` acts on. */
function isTarget(world: World<never>, effect: TargetEffect, entity: EntityId): boolean {
  switch (effect.kind) {
    case 'property':
      return hasProperty(world, entity, effect.key);
    case 'impulse':
      return (
        (readProperty(world, entity, 'pushable') ||
          readProperty(world, entity, 'liftable') ||
          readProperty(world, entity, 'breakable') ||
          readProperty(world, entity, 'bashable')) &&
        readProperty(world, entity, 'weight') > 0
      );
    case 'impact':
      return hasProperty(world, entity, 'hp') || hasProperty(world, entity, 'fragile');
  }
}

/** Targets reached by `stimulus` with their falloff, ascending entity id. */
function reach(
  world: World<never>,
  stimulus: Stimulus,
  effect: Effect,
): { entity: EntityId; falloff: number }[] {
  const { shape } = stimulus;
  if (effect.kind === 'field') return [];
  const spared = stimulus.sparesSource === true ? stimulus.source : null;
  if (shape.kind === 'contact') {
    const alive =
      shape.target !== spared &&
      world.isAlive(shape.target) &&
      isTarget(world, effect, shape.target);
    return alive ? [{ entity: shape.target, falloff: 1 }] : [];
  }
  const found: { entity: EntityId; falloff: number }[] = [];
  world.query(PlacementComponent).forEach((entity, placement) => {
    if (entity === spared || !isTarget(world, effect, entity)) return;
    const at = boundingSphereOf(world, entity, placement);
    const falloff = shapeFalloff(shape, stimulus.falloff, at, at.radius);
    if (falloff !== undefined) found.push({ entity, falloff });
  });
  return found;
}

function applyProperty(
  world: World<never>,
  effect: PropertyEffect,
  entity: EntityId,
  amount: number,
  source: EntityId | null,
): void {
  const { key, sign } = effect;
  const spec = WORLD_PROPERTY_SPECS[key];
  const old = readProperty(world, entity, key);
  // Water soaks in only as far as the material absorbs (iron: a film, not a sponge); wetness already
  // above that (set directly) is never pushed down by a splash.
  const ceiling =
    key === 'wetness' ? Math.max(old, readProperty(world, entity, 'absorbency')) : spec.max;
  const value = Math.min(ceiling, Math.max(spec.min, old + sign * amount));
  setProperty(world, entity, key, value, source === null ? {} : { source });
}

/** The push on `entity`, or false when there is no direction to push it in or it resists. */
function applyImpulse(
  world: World<never>,
  stimulus: Stimulus,
  entity: EntityId,
  amount: number,
): boolean {
  const placed = world.get(entity, PlacementComponent);
  const at = placed === undefined ? undefined : boundingSphereOf(world, entity, placed);
  const direction =
    stimulus.direction ?? (at === undefined ? undefined : shapePush(stimulus.shape, at));
  if (direction === undefined) return false;
  const weight = readProperty(world, entity, 'weight');
  const impulse = { x: direction.x * amount, y: direction.y * amount, z: direction.z * amount };
  const { maxWeight } = stimulus;
  if (maxWeight !== undefined && weight > maxWeight) {
    world.events.emit(ImpactResisted, {
      tick: world.tick,
      entity,
      weight,
      maxWeight,
      impulse,
      source: stimulus.source,
    });
    return false;
  }
  const inverseMass = 1 / weight;
  world.events.emit(impulseApplied, {
    entity,
    impulse,
    velocityChange: {
      x: impulse.x * inverseMass,
      y: impulse.y * inverseMass,
      z: impulse.z * inverseMass,
    },
    source: stimulus.source,
  });
  return true;
}

function resolveOne(world: World<never>, entry: PendingStimulus): void {
  const { stimulus } = entry;
  const effect = EFFECTS[stimulus.element];
  const amount = stimulus.intensity / entry.ticks;
  const hits: StimulusHit[] = [];
  for (const { entity, falloff } of reach(world, stimulus, effect)) {
    const received = amount * falloff;
    if (effect.kind === 'property') {
      applyProperty(world, effect, entity, received, stimulus.source);
    } else if (effect.kind === 'impulse' && !applyImpulse(world, stimulus, entity, received)) {
      continue;
    }
    hits.push({ entity, falloff, amount: received });
  }
  world.events.emit(stimulusResolved, { tick: world.tick, stimulus, amount, hits });
}

/**
 * Resolves every queued stimulus now, in canonical order (see the file header): applies property
 * changes (attributed to each stimulus's source), queues `impulseApplied` and `stimulusResolved`
 * events, and keeps stimuli with resolutions left for the next call. Normally run once per tick by
 * `stimulusSystem`.
 */
export function resolveStimuli(world: World<never>): void {
  const [id, { entries }] = queueOf(world);
  if (entries.length === 0) return;
  const remaining = entries
    .filter((entry) => entry.ticksLeft > 1)
    .map((entry) => ({ ...entry, ticksLeft: entry.ticksLeft - 1 }));
  world.set(id, StimulusQueueComponent, { entries: canonicalOrder(remaining) });
  for (const entry of entries) resolveOne(world, entry);
}

/**
 * The system that resolves stimuli: add it where stimuli should take effect in the tick (after the
 * systems that emit them, before the element rules that react). Stimuli applied later in a tick, or
 * between ticks, resolve on the next run.
 */
export function stimulusSystem<TInput>(): System<TInput> {
  return {
    name: 'stimuli',
    run: ({ world }) => {
      resolveStimuli(world);
    },
  };
}
