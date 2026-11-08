// Impact switches (mw-e03.20): a mechanism that something hits from afar. A bullseye on a far wall,
// a bell, a crystal, a hanging counterweight. Nothing here names a source: arrows, thrown objects,
// strikes, spells and force all arrive as one `Impact` (a place, an energy, a damage type or an
// element, a source), so a thrown dagger, a shield, a Mage Hand shove and a sorcerer's spark all
// work on any switch whose filter permits them. Designers restrict filters only deliberately.
//
// Where impacts come from (`impactFeeds`, installed with the mechanisms): `physicsImpact` (thrown,
// dropped and flung bodies: blunt, at the body's position), `arrowImpact` (the arrow's own damage
// type, at the contact point) and `stimulusResolved` (strikes, spells, force and every other element
// act through the one stimulus API: the stimulus's shape must reach the switch's hit zone). A
// `contact` stimulus is never an impact of its own: arrows send one as the echo of the hit they
// already reported.
//
// The filter: `minEnergy` (J for blunt, slash and pierce; the delivered amount in its own unit for
// an element, so N·s for force), `damageTypes` and `elements`. An impact passes when its damage type
// or its element is in the matching set, so a pierce bullseye ignores fire and a charge crystal
// ignores a thrown rock. The hit zone is a sphere around the switch's origin: a small one is a
// bullseye, a larger one a bell.
//
// Timing: a hit while the switch is off turns it on (one `impactSwitchChanged`, the edge), however
// many arrive in that tick. A `momentary` switch stays on `holdSeconds` after its last hit; a
// `latching` one until a signal resets it (`mechanism` receiver bound to it, on; or `resetImpactSwitch`).
// A bell also rings: one noise event per tick it is struck. Outputs drive the lever nodes bound to it
// in signal graphs, like any switch. A counterweight is released by its support giving way (a cut or
// burnt rope): the rope calls `releaseImpactSwitch`, which trips it whatever the filter says.
//
// Shootable (mw-e05.13): the `shootable` world property is the authoring surface of a target, a gong
// or any other thing a projectile fires a signal from. It is a threshold in N·s (the momentum the
// projectile delivers), so it maps onto an impact switch's `minImpulse` (`makeShootable`; a scene
// spawn that sets the property becomes one). The two thresholds are separate on purpose: `minEnergy`
// is J and `minImpulse` N·s, and a switch may set either or both. Arrows and physics bodies report
// both; a stimulus reports an impulse only when it is a force (its delivered amount is N·s), so a
// switch with a `minImpulse` ignores a spark or a slash, which carry none.

import { defineComponent, type EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { System, World } from '../core/world';
import { arrowImpact } from '../combat/arrows/events';
import { blameOf, BlameComponent } from '../combat/environment/environment';
import { noiseEmitted } from '../noise/events';
import { physicsImpact } from '../physics/objects';
import { hasProperty, readProperty } from '../properties/components';
import { setLever } from '../signals/runtime';
import { placeEntity, PlacementComponent } from '../stimulus/placement';
import { shapeFalloff, type Vec3 } from '../stimulus/shapes';
import { stimulusResolved, type StimulusElement } from '../stimulus/stimulus';
import { boundNodes } from './bindings';

/** Physical damage types an impact can carry. */
export const IMPACT_DAMAGE_TYPES = ['blunt', 'slash', 'pierce'] as const;
export type ImpactDamageType = (typeof IMPACT_DAMAGE_TYPES)[number];

/** Elements an impact can carry (gas acts on the gas field, not on things). */
export const IMPACT_ELEMENTS = ['heat', 'cold', 'water', 'charge', 'force', 'light'] as const;
export type ImpactElement = (typeof IMPACT_ELEMENTS)[number];

/** How a switch behaves once the hits stop. */
export const IMPACT_SWITCH_MODES = ['momentary', 'latching'] as const;
export type ImpactSwitchMode = (typeof IMPACT_SWITCH_MODES)[number];

/** The prefabs. */
export const IMPACT_SWITCH_VARIANTS = [
  'bullseye',
  'bell',
  'crystal',
  'counterweight',
  'target',
] as const;
export type ImpactSwitchVariant = (typeof IMPACT_SWITCH_VARIANTS)[number];

/** What an impact switch accepts. */
export interface ImpactFilter {
  /** Least energy that counts, J (the delivered amount for an element). */
  readonly minEnergy: number;
  /**
   * Least impulse that counts, N·s (mw-e05.13: a `shootable` threshold); 0 or absent: any. An impact
   * that reports no impulse never reaches a switch that asks for one.
   */
  readonly minImpulse?: number;
  readonly damageTypes: readonly ImpactDamageType[];
  readonly elements: readonly ImpactElement[];
}

/** What defines an impact switch (a scene spawn's `impactSwitch` data, after its variant). */
export interface ImpactSwitchSpec extends ImpactFilter {
  readonly variant: ImpactSwitchVariant;
  /** Radius of the spherical hit zone around its origin, metres. */
  readonly radius: number;
  readonly mode: ImpactSwitchMode;
  /** Momentary: seconds it stays on after the last hit. */
  readonly holdSeconds: number;
  /** Noise made when struck, dB at 1 m; null: silent. */
  readonly loudness: number | null;
}

/** An impact switch (`mechanisms.impactSwitch`; a snapshot and save key, never renamed). */
export interface ImpactSwitch extends ImpactSwitchSpec {
  /** The middle of its hit zone, metres. */
  readonly origin: Vec3;
  readonly active: boolean;
  /** Momentary: ticks left on. */
  readonly holdLeft: number;
  /** The last tick it was struck (-1: never); a bell rings once per tick. */
  readonly lastHit: number;
}

export const ImpactSwitchComponent = defineComponent<ImpactSwitch>('mechanisms.impactSwitch');

/** Loudness of a struck bell, dB at 1 m (a shout carries about as far). */
export const BELL_LOUDNESS = 85;

const ALL_DAMAGE: readonly ImpactDamageType[] = IMPACT_DAMAGE_TYPES;

const prefab = (spec: ImpactSwitchSpec): ImpactSwitchSpec =>
  Object.freeze({
    ...spec,
    damageTypes: Object.freeze([...spec.damageTypes]),
    elements: Object.freeze([...spec.elements]),
  });

/** The prefabs' settings, to override one by one. */
export const IMPACT_SWITCH_PREFABS: Readonly<Record<ImpactSwitchVariant, ImpactSwitchSpec>> = {
  /** Pierce only, a small hit zone: precision opens the way. */
  bullseye: prefab({
    variant: 'bullseye',
    minEnergy: 20,
    damageTypes: ['pierce'],
    elements: [],
    radius: 0.1,
    mode: 'momentary',
    holdSeconds: 3,
    loudness: null,
  }),
  /** Any impact, and it rings: a distraction tool. */
  bell: prefab({
    variant: 'bell',
    minEnergy: 5,
    damageTypes: ALL_DAMAGE,
    elements: ['force'],
    radius: 0.4,
    mode: 'momentary',
    holdSeconds: 1,
    loudness: BELL_LOUDNESS,
  }),
  /** Charge or light, no impact. */
  crystal: prefab({
    variant: 'crystal',
    minEnergy: 0,
    damageTypes: [],
    elements: ['charge', 'light'],
    radius: 0.3,
    mode: 'latching',
    holdSeconds: 0,
    loudness: null,
  }),
  /** Released by cutting what holds it: slashes, or `releaseImpactSwitch` from its rope. */
  counterweight: prefab({
    variant: 'counterweight',
    minEnergy: 1,
    damageTypes: ['slash'],
    elements: [],
    radius: 0.2,
    mode: 'latching',
    holdSeconds: 0,
    loudness: null,
  }),
  /** Shootable (mw-e05.13): any projectile or shove at or above its `shootable` impulse fires it for good. */
  target: prefab({
    variant: 'target',
    minEnergy: 0,
    damageTypes: ALL_DAMAGE,
    elements: ['force'],
    radius: 0.3,
    mode: 'latching',
    holdSeconds: 0,
    loudness: null,
  }),
};

/** Something that hit, from any source. */
export interface Impact {
  /** Where it hit, metres. */
  readonly position: Vec3;
  /** J for a damage type; the delivered amount for an element. */
  readonly energy: number;
  /** N·s it delivered, when the source knows (arrows, bodies, force); absent or null: unknown. */
  readonly impulse?: number | null;
  /** Exactly one of these is set. */
  readonly damageType: ImpactDamageType | null;
  readonly element: ImpactElement | null;
  /** Who is responsible, or null. */
  readonly source: EntityId | null;
}

/** An impact switch turned on or off. */
export interface ImpactSwitchChange {
  readonly tick: number;
  readonly entity: EntityId;
  readonly variant: ImpactSwitchVariant;
  readonly active: boolean;
  /** Who struck or released it (on) or reset it (off), else null. */
  readonly source: EntityId | null;
}

export const impactSwitchChanged = defineEvent<ImpactSwitchChange>('impactSwitchChanged');

const known = <T>(value: T | undefined): T => value as T;

/** Whether `impact` passes `filter`. */
export function passesFilter(filter: ImpactFilter, impact: Impact): boolean {
  if (impact.energy < filter.minEnergy) return false;
  const minImpulse = filter.minImpulse ?? 0;
  if (minImpulse > 0 && (impact.impulse ?? 0) < minImpulse) return false;
  return (
    (impact.damageType !== null && filter.damageTypes.includes(impact.damageType)) ||
    (impact.element !== null && filter.elements.includes(impact.element))
  );
}

/**
 * Makes `entity` an impact switch of `variant` (overridden field by field by `spec`) whose hit zone is
 * centred on `origin`, off at first. Like `World.add`, deferred to the end of the tick during a step;
 * it is placed (a point) when it has no placement.
 * @throws RangeError for a filter that accepts nothing, or a zone, energy or hold that makes no sense.
 */
export function makeImpactSwitch(
  world: World<never>,
  entity: EntityId,
  origin: Vec3,
  variant: ImpactSwitchVariant = 'bullseye',
  spec: Partial<Omit<ImpactSwitchSpec, 'variant'>> = {},
): void {
  const prefab = IMPACT_SWITCH_PREFABS[variant] as ImpactSwitchSpec | undefined;
  if (prefab === undefined) throw new RangeError(`unknown impact switch variant "${variant}"`);
  const sw: ImpactSwitchSpec = { ...prefab, ...spec };
  if (sw.damageTypes.length === 0 && sw.elements.length === 0) {
    throw new RangeError('an impact switch must accept some damage type or element');
  }
  if (!(Number.isFinite(sw.minEnergy) && sw.minEnergy >= 0)) {
    throw new RangeError('an impact switch needs a minimum energy of 0 or more');
  }
  if (!(Number.isFinite(sw.minImpulse ?? 0) && (sw.minImpulse ?? 0) >= 0)) {
    throw new RangeError('an impact switch needs a minimum impulse of 0 or more');
  }
  if (!(Number.isFinite(sw.radius) && sw.radius > 0)) {
    throw new RangeError('an impact switch needs a hit zone above 0 m');
  }
  if (!(Number.isFinite(sw.holdSeconds) && sw.holdSeconds >= 0)) {
    throw new RangeError('an impact switch hold must be 0 s or more');
  }
  if (sw.loudness !== null && !(Number.isFinite(sw.loudness) && sw.loudness >= 0)) {
    throw new RangeError('an impact switch loudness must be 0 dB or more');
  }
  world.add(entity, ImpactSwitchComponent, {
    ...sw,
    origin: { x: origin.x, y: origin.y, z: origin.z },
    active: false,
    holdLeft: 0,
    lastHit: -1,
  });
  if (!world.has(entity, PlacementComponent)) placeEntity(world, entity, origin);
}

/**
 * Makes `entity` a shootable target (mw-e05.13): an impact switch of the `target` prefab (overridden
 * field by field by `spec`) whose `minImpulse` is the entity's `shootable` property, N·s.
 * @throws RangeError when `entity` has no `shootable` property, or for anything `makeImpactSwitch` refuses.
 */
export function makeShootable(
  world: World<never>,
  entity: EntityId,
  origin: Vec3,
  spec: Partial<Omit<ImpactSwitchSpec, 'variant' | 'minImpulse'>> = {},
): void {
  if (!hasProperty(world, entity, 'shootable')) {
    throw new RangeError(`entity ${String(entity)} has no shootable property`);
  }
  makeImpactSwitch(world, entity, origin, 'target', {
    ...spec,
    minImpulse: readProperty(world, entity, 'shootable'),
  });
}

/** Writes a switch's state and tells its graphs and listeners when it turned on or off. */
function write(
  world: World<never>,
  entity: EntityId,
  sw: ImpactSwitch,
  next: ImpactSwitch,
  source: EntityId | null,
): void {
  world.set(entity, ImpactSwitchComponent, next);
  if (next.active === sw.active) return;
  for (const [graph, node, kind] of boundNodes(world, entity)) {
    if (kind === 'lever') setLever(world, graph, node, next.active);
  }
  world.events.emit(impactSwitchChanged, {
    tick: world.tick,
    entity,
    variant: next.variant,
    active: next.active,
    source,
  });
}

/** Rings a noisy switch once per tick. */
function ring(world: World<never>, entity: EntityId, sw: ImpactSwitch, source: EntityId | null) {
  if (sw.loudness === null || sw.lastHit === world.tick) return;
  world.events.emit(noiseEmitted, {
    tick: world.tick,
    position: { ...sw.origin },
    loudness: sw.loudness,
    kind: sw.variant,
    entity,
    source,
  });
}

/** A hit that passed the filter and landed in the zone: on (once), held, and heard. */
function accept(world: World<never>, entity: EntityId, source: EntityId | null): void {
  const sw = known(world.get(entity, ImpactSwitchComponent));
  ring(world, entity, sw, source);
  const holdLeft =
    sw.mode === 'momentary' ? Math.max(1, Math.round(sw.holdSeconds * world.clock.hz)) : 0;
  write(
    world,
    entity,
    sw,
    {
      ...sw,
      active: true,
      holdLeft: sw.active ? Math.max(sw.holdLeft, holdLeft) : holdLeft,
      lastHit: world.tick,
    },
    sw.active ? null : source,
  );
}

/**
 * Delivers a point impact to every impact switch whose filter passes it and whose hit zone holds
 * `impact.position`. Returns how many it struck.
 */
export function deliverImpact(world: World<never>, impact: Impact): number {
  let struck = 0;
  for (const entity of [...world.query(ImpactSwitchComponent).ids()]) {
    const sw = known(world.get(entity, ImpactSwitchComponent));
    const { origin } = sw;
    const dx = impact.position.x - origin.x;
    const dy = impact.position.y - origin.y;
    const dz = impact.position.z - origin.z;
    const gap = dx * dx + dy * dy + dz * dz;
    if (gap > sw.radius * sw.radius || !passesFilter(sw, impact)) continue;
    accept(world, entity, impact.source);
    struck += 1;
  }
  return struck;
}

/**
 * Trips `entity`'s switch whatever its filter says (a counterweight whose rope is cut). A momentary
 * switch behaves as if hit. Returns whether it was off. Not an impact switch: false.
 */
export function releaseImpactSwitch(
  world: World<never>,
  entity: EntityId,
  source: EntityId | null = null,
): boolean {
  const sw = world.get(entity, ImpactSwitchComponent);
  if (sw === undefined) return false;
  accept(world, entity, source);
  return !sw.active;
}

/** Turns a switch off (a latching one's way off) and clears its hold. Returns whether it was on. */
export function resetImpactSwitch(
  world: World<never>,
  entity: EntityId,
  source: EntityId | null = null,
): boolean {
  const sw = world.get(entity, ImpactSwitchComponent);
  if (!sw?.active) return false;
  write(world, entity, sw, { ...sw, active: false, holdLeft: 0 }, source);
  return true;
}

/** Sets every lever node bound to `entity`'s switch to its state (a scene's start). */
export function syncImpactSwitchNodes(world: World<never>, entity: EntityId): void {
  const sw = world.get(entity, ImpactSwitchComponent);
  if (sw === undefined) return;
  for (const [graph, node, kind] of boundNodes(world, entity)) {
    if (kind === 'lever') setLever(world, graph, node, sw.active);
  }
}

/** The impact switches system: lets momentary switches run out. */
export function impactSwitchesSystem<TInput>(): System<TInput> {
  return {
    name: 'impactSwitches',
    run: ({ world: w }) => {
      const world: World<never> = w;
      for (const entity of [...world.query(ImpactSwitchComponent).ids()]) {
        const sw = known(world.get(entity, ImpactSwitchComponent));
        if (!sw.active || sw.mode !== 'momentary' || sw.lastHit === world.tick) continue;
        if (sw.holdLeft > 1)
          world.set(entity, ImpactSwitchComponent, { ...sw, holdLeft: sw.holdLeft - 1 });
        else write(world, entity, sw, { ...sw, active: false, holdLeft: 0 }, null);
      }
    },
  };
}

const DAMAGE_SET: ReadonlySet<StimulusElement> = new Set(IMPACT_DAMAGE_TYPES);
const ELEMENT_SET: ReadonlySet<StimulusElement> = new Set(IMPACT_ELEMENTS);

/**
 * Feeds impacts from the world's existing channels into `deliverImpact` and stimuli into switches
 * (see the file header). Returns a function that removes the subscriptions.
 */
export function impactFeeds<TInput>(world: World<TInput>): () => void {
  const w: World<never> = world;
  const offs = [
    world.events.on(physicsImpact, ({ entity, other, energy, impulse, position }) => {
      const blamed = (e: EntityId): EntityId | null =>
        w.isRegistered(BlameComponent) && w.isAlive(e) ? blameOf(w, e) : null;
      const source = blamed(entity) ?? (other === null ? null : blamed(other));
      deliverImpact(w, { position, energy, impulse, damageType: 'blunt', element: null, source });
    }),
    world.events.on(arrowImpact, ({ position, energy, impulse, outcome, shooter }) => {
      deliverImpact(w, {
        position,
        energy,
        impulse,
        damageType: outcome === 'stick' ? 'pierce' : 'blunt',
        element: null,
        source: shooter,
      });
    }),
    world.events.on(stimulusResolved, ({ stimulus, amount }) => {
      const { element, shape, source } = stimulus;
      if (shape.kind === 'contact') return;
      const damageType = DAMAGE_SET.has(element) ? (element as ImpactDamageType) : null;
      const elementOf = ELEMENT_SET.has(element) ? (element as ImpactElement) : null;
      if (damageType === null && elementOf === null) return;
      const impact = {
        position: { x: 0, y: 0, z: 0 },
        energy: amount,
        impulse: element === 'force' ? amount : null,
        damageType,
        element: elementOf,
        source,
      };
      for (const entity of [...w.query(ImpactSwitchComponent).ids()]) {
        const sw = known(w.get(entity, ImpactSwitchComponent));
        if (!passesFilter(sw, impact)) continue;
        if (shapeFalloff(shape, stimulus.falloff, sw.origin, sw.radius) === undefined) continue;
        accept(w, entity, source);
      }
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
