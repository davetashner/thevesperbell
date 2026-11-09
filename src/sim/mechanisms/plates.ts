// Pressure plates (mw-e03.19): a plate is a footprint on the floor that weighs whatever rests on it.
// Anything counts, never a pairing of types: crates, bodies, frozen blocks, summoned skeletons, the
// player. What rests on it is every physics object or actor (a creature, or an entity tagged `player`
// or `actor`) whose centre is over the footprint and whose underside touches the plate's top, and
// the plate sums their `weight` properties plus what the actors carry in their hands (the carry
// ledger) and wear (`PlateOptions.gear`, the equipment rules' armour and shield weight).
//
// Weight is what gravity makes of mass: a thing's weight is scaled by the gravity it feels
// (`PlateOptions.gravityScale`; the game passes the remote-hold fields' `gravityScaleOf`), so a levitated
// object, held by a spell or inside a gravity-scale-0 zone, weighs 0 kg, and a doubled zone doubles it.
// What an actor carries weighs with the carrier, at the carrier's gravity.
//
// The window and its timing: the plate is on while the total is within `minWeight` … `maxWeight`
// (null: no ceiling, so too heavy fails only when the plate has a ceiling) and has been for
// `armSeconds` without a break (a crate that merely bounces over the plate does not trip it).
// `hysteresis` is a margin in kg that widens the window once the plate is on, so a load that jitters
// at an edge does not make it chatter: it turns off only when the total leaves the window by more
// than that margin. A `momentary` plate follows its load; a `latching` one stays on after the weight
// is gone until a signal resets it (`mechanism` receiver bound to the plate, on; or `resetPlate`).
//
// A plate drives the lever nodes bound to it in signal graphs, like any switch. A `hidden` plate is
// the trap variant: the same plate, with nothing in the world to see or prompt, wired to trap
// signals; what the trap does is its graph's business (mw-e10). `plateChanged` reports every change.

import type { EntityId } from '../core/component';
import { defineComponent } from '../core/component';
import { defineEvent } from '../core/events';
import type { System, World } from '../core/world';
import { holdsOf } from '../carry/state';
import { CreatureComponent } from '../creatures/components';
import { PhysicsObjectComponent } from '../physics/objects';
import { readProperty } from '../properties/components';
import { hasTag } from '../signals/filter';
import { setLever } from '../signals/runtime';
import {
  boundingSphereOf,
  PlacementComponent,
  placeEntity,
  type Placement,
} from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { boundNodes } from './bindings';

/** How a plate behaves once weight leaves it. */
export const PLATE_MODES = ['momentary', 'latching'] as const;
export type PlateMode = (typeof PLATE_MODES)[number];

/** How far below its top a thing's underside may sink and still rest on a plate, metres. */
export const PLATE_SINK = 0.1;
/** How far above its top a thing's underside may hover and still touch a plate, metres. */
export const PLATE_REACH = 0.05;

/** What defines a plate (a scene spawn's `plate` data). */
export interface PlateSpec {
  /** Lightest total that turns it on, kg (> 0). */
  readonly minWeight: number;
  /** Heaviest total that keeps it on, kg; null: no ceiling. */
  readonly maxWeight: number | null;
  /** Margin, kg, by which the window widens once it is on. */
  readonly hysteresis: number;
  readonly mode: PlateMode;
  /** Seconds the load must stay in the window before it turns on. */
  readonly armSeconds: number;
  /** Footprint, metres (axis-aligned, centred on the plate's origin). */
  readonly width: number;
  readonly depth: number;
  /** The trap variant: nothing to see or prompt. */
  readonly hidden: boolean;
}

/** A plate (`mechanisms.plate`; a snapshot and save key, never renamed). */
export interface Plate extends PlateSpec {
  /** The middle of its top surface, metres. */
  readonly origin: Vec3;
  /** On now (a latching plate: until reset). */
  readonly active: boolean;
  /** Total weight on it at the last tick, kg. */
  readonly weight: number;
  /** Ticks the load has been in the window while it is off. */
  readonly arming: number;
}

export const PlateComponent = defineComponent<Plate>('mechanisms.plate');

/** A plate turned on or off. */
export interface PlateChange {
  readonly tick: number;
  readonly entity: EntityId;
  readonly active: boolean;
  /** Total weight on it, kg. */
  readonly weight: number;
  readonly mode: PlateMode;
  readonly hidden: boolean;
  /** The signal that reset it, else null. */
  readonly source: EntityId | null;
}

export const plateChanged = defineEvent<PlateChange>('plateChanged');

/** Where plates read what the world cannot tell them by properties alone. */
export interface PlateOptions {
  /** Gravity an entity feels as a share of normal; none: everything feels 1. */
  readonly gravityScale?: (world: World<never>, entity: EntityId) => number;
  /** Weight, kg, an actor wears (armour, shield); none: 0. */
  readonly gear?: (world: World<never>, actor: EntityId) => number;
}

const known = <T>(value: T | undefined): T => value as T;

/** The plate defaults: a 1 m square that comes on at 1 kg, momentary, immediately. */
export const DEFAULT_PLATE: PlateSpec = Object.freeze({
  minWeight: 1,
  maxWeight: null,
  hysteresis: 0,
  mode: 'momentary',
  armSeconds: 0,
  width: 1,
  depth: 1,
  hidden: false,
});

/**
 * Makes `entity` a plate whose top surface is centred on `origin`, off at first. Like `World.add`,
 * deferred to the end of the tick during a step; it is placed (a point) when it has no placement.
 * @throws RangeError for a window, margin, delay or footprint that makes no sense.
 */
export function makePlate(
  world: World<never>,
  entity: EntityId,
  origin: Vec3,
  spec: Partial<PlateSpec> = {},
): void {
  const plate = { ...DEFAULT_PLATE, ...spec };
  const positive = (n: number) => Number.isFinite(n) && n > 0;
  if (!positive(plate.minWeight)) throw new RangeError('a plate needs a minimum weight above 0 kg');
  if (plate.maxWeight !== null && !(plate.maxWeight >= plate.minWeight)) {
    throw new RangeError('a plate cannot weigh less at most than at least');
  }
  if (!(Number.isFinite(plate.hysteresis) && plate.hysteresis >= 0)) {
    throw new RangeError('plate hysteresis must be 0 kg or more');
  }
  if (!(Number.isFinite(plate.armSeconds) && plate.armSeconds >= 0)) {
    throw new RangeError('plate arming delay must be 0 s or more');
  }
  if (!positive(plate.width) || !positive(plate.depth)) {
    throw new RangeError('a plate needs a footprint above 0 m');
  }
  world.add(entity, PlateComponent, {
    ...plate,
    origin: { x: origin.x, y: origin.y, z: origin.z },
    active: false,
    weight: 0,
    arming: 0,
  });
  if (!world.has(entity, PlacementComponent)) placeEntity(world, entity, origin);
}

/** Whether a thing is something a plate weighs: a physics object or an actor. */
export function weighable(world: World<never>, entity: EntityId): boolean {
  return (
    (world.isRegistered(PhysicsObjectComponent) && world.has(entity, PhysicsObjectComponent)) ||
    (world.isRegistered(CreatureComponent) && world.has(entity, CreatureComponent)) ||
    hasTag(world, entity, 'player') ||
    hasTag(world, entity, 'actor')
  );
}

/** Whether a body at `at` rests on `plate`: its centre is over the footprint, its underside touches the top. */
function rests(plate: Plate, at: Placement): boolean {
  const { origin, width, depth } = plate;
  if (Math.abs(at.x - origin.x) > width / 2 || Math.abs(at.z - origin.z) > depth / 2) return false;
  const underside = at.y - at.radius;
  return underside <= origin.y + PLATE_REACH && underside >= origin.y - PLATE_SINK;
}

/** What is on a plate now: who rests on it and the total weight, kg. */
export interface PlateLoad {
  /** Everything resting on it (carried objects are counted with their carrier, not listed). */
  readonly resting: readonly EntityId[];
  readonly weight: number;
}

/** Weighs what rests on `entity`'s plate (see the file header). */
export function weighPlate(
  world: World<never>,
  entity: EntityId,
  options: PlateOptions = {},
): PlateLoad {
  const plate = known(world.get(entity, PlateComponent));
  const scaleOf = options.gravityScale ?? (() => 1);
  const gearOf = options.gear ?? (() => 0);
  const holds = holdsOf(world);
  const carried = new Set(holds.map((hold) => hold.target));
  const resting: EntityId[] = [];
  let weight = 0;
  world.query(PlacementComponent).forEach((other, placed) => {
    if (other === entity || carried.has(other) || !weighable(world, other)) return;
    if (!rests(plate, boundingSphereOf(world, other, placed))) return;
    let kilos = readProperty(world, other, 'weight');
    for (const hold of holds) {
      if (hold.actor === other) kilos += readProperty(world, hold.target, 'weight');
    }
    kilos += gearOf(world, other);
    resting.push(other);
    weight += kilos * Math.max(0, scaleOf(world, other));
  });
  return { resting, weight };
}

/** Writes a plate's state and tells its graphs and listeners when it turned on or off. */
function write(
  world: World<never>,
  entity: EntityId,
  plate: Plate,
  next: Plate,
  source: EntityId | null,
): void {
  if (
    next.active === plate.active &&
    next.weight === plate.weight &&
    next.arming === plate.arming
  ) {
    return;
  }
  world.set(entity, PlateComponent, next);
  if (next.active === plate.active) return;
  for (const [graph, node, kind] of boundNodes(world, entity)) {
    if (kind === 'lever') setLever(world, graph, node, next.active);
  }
  world.events.emit(plateChanged, {
    tick: world.tick,
    entity,
    active: next.active,
    weight: next.weight,
    mode: next.mode,
    hidden: next.hidden,
    source,
  });
}

/** Brings one plate up to date with its load. */
function stepPlate(world: World<never>, entity: EntityId, plate: Plate, options: PlateOptions) {
  const { weight } = weighPlate(world, entity, options);
  if (plate.active && plate.mode === 'latching') {
    write(world, entity, plate, { ...plate, weight }, null);
    return;
  }
  const margin = plate.active ? plate.hysteresis : 0;
  const inWindow =
    weight >= plate.minWeight - margin &&
    (plate.maxWeight === null || weight <= plate.maxWeight + margin);
  if (plate.active) {
    write(world, entity, plate, { ...plate, weight, active: inWindow }, null);
    return;
  }
  const arming = inWindow ? plate.arming + 1 : 0;
  const needed = Math.round(plate.armSeconds * world.clock.hz);
  write(
    world,
    entity,
    plate,
    { ...plate, weight, arming, active: inWindow && arming > needed },
    null,
  );
}

/**
 * Resets a plate: it turns off (a latching plate's way off) and starts arming afresh, so a load
 * still on it turns it on again after its delay. Returns whether it was on. Not a plate: false.
 */
export function resetPlate(
  world: World<never>,
  entity: EntityId,
  source: EntityId | null = null,
): boolean {
  const plate = world.get(entity, PlateComponent);
  if (!plate?.active) return false;
  write(world, entity, plate, { ...plate, active: false, arming: 0 }, source);
  return true;
}

/** Sets every lever node bound to `entity`'s plate to its state (a scene's start). */
export function syncPlateNodes(world: World<never>, entity: EntityId): void {
  const plate = world.get(entity, PlateComponent);
  if (plate === undefined) return;
  for (const [graph, node, kind] of boundNodes(world, entity)) {
    if (kind === 'lever') setLever(world, graph, node, plate.active);
  }
}

/** The plates system: weighs every plate each tick. */
export function platesSystem<TInput>(options: PlateOptions = {}): System<TInput> {
  return {
    name: 'plates',
    run: ({ world: w }) => {
      const world: World<never> = w;
      for (const entity of [...world.query(PlateComponent).ids()]) {
        stepPlate(world, entity, known(world.get(entity, PlateComponent)), options);
      }
    },
  };
}
