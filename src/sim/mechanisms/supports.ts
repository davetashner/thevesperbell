// Load-bearing supports (mw-e03.13): the ropes and chains that hold a chandelier, a cage, a
// drawbridge, a counterweight or a rope bridge up. A support is a length of cord or chain between two
// anchors, an entity with `hp` and a body of its own that arrows hit. Nothing here names a source of
// damage or a kind of rope: what a support does follows from its world properties and its resistances.
// A rope is flammable (the fire rules burn it, mw-e03.5) and takes pierce and slash, a chain is iron
// and shrugs them off (resistance 1), a rotten rope has few `hp`.
//
// What lets go of what it holds: a support releases when
// - its `hp` reaches 0: a hit of a kind (blunt, slash, pierce or force, the stimulus API's damage
//   elements) wears `hp` down by its amount less the support's resistance to that kind, in whole
//   hundredths like a breakable's; fire does the same through the fire rules' own burn damage;
// - it burns out (`fireBurntOut`): a burnt-away rope is gone and so is what it held;
// - it is overloaded: the load of what hangs from its span (below) exceeds its `rating`, kg.
// A release is one event (`supportReleased`), on the tick it happens: everything hanging from the
// support lets go (`releaseSuspended`: its `suspended` property turns false, blamed on whoever cut
// the rope, so a crushing chandelier is theirs; counterweights trip) and becomes an ordinary
// dynamic body from the end of that tick, bodies resting on it are woken so they fall too, and every
// lever node bound to the support in a signal graph is switched on, once. A support releases once.
//
// A span is the supports that share a load: a rope bridge's two ropes. The span's load is the
// `weight` of everything hanging from any of its ropes plus the `weight` of every body or actor
// resting on what hangs (planks under a crate, a knight on a plank): a body rests on whatever its
// footprint overlaps. Its rating is the lowest of its
// ropes'. When the load exceeds it the weakest rope (fewest `hp`, then lowest id) snaps, and a span
// with one rope gone cannot stand: the whole span lets go and its ropes are gone.
//
// A support is not a climbable rope (mw-e02 climb surfaces: a rope can be both) and not a cuttable
// cord (src/sim/mechanisms/ropes.ts, which any slash or pierce severs at once): it takes hits.

import { defineComponent, type EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { System, World } from '../core/world';
import { fromUnits, toUnits } from '../combat/damage/types';
import type { BreakResistances } from '../breakables/components';
import { structuralDamage } from '../breakables/system';
import { fireBurntOut } from '../elements/fire';
import { PhysicsObjectComponent, bindCollider, rigidBodiesOf } from '../physics/objects';
import type { ColliderHandle, StaticColliderSink } from '../physics/static-colliders';
import { assignProperty, hasProperty, readProperty } from '../properties/components';
import { supportOf } from '../properties/derived';
import { BREAK_TYPES, type BreakType } from '../properties/spec';
import { setLever } from '../signals/runtime';
import { boundingSphereOf, placeEntity, PlacementComponent } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { stimulusResolved } from '../stimulus/stimulus';
import { boundNodes } from './bindings';
import { weighable } from './plates';
import { releaseSuspended, SuspendedComponent } from './ropes';

/** Why a support let go. */
export type ReleaseCause = 'damage' | 'burnt' | 'overload';

/** A support (`mechanisms.support`; a snapshot and save key, never renamed). */
export interface Support {
  /** The two anchors, metres. */
  readonly from: Vec3;
  readonly to: Vec3;
  /** Half its thickness, metres: the collider an arrow hits. */
  readonly radius: number;
  /** Share of each kind of hit it shrugs off, 0 (none) … 1 (immune); a kind left out is 0. */
  readonly resistances: BreakResistances;
  /** Heaviest load its span carries, kg; null: it never overloads. */
  readonly rating: number | null;
  /** The other supports of its span (a bridge's other rope), ascending ids. */
  readonly peers: readonly EntityId[];
  /** Its collider's handle in the sink it was added to; null: it has none. */
  readonly collider: number | null;
  /** Let go already (it goes at the end of the tick). */
  readonly released: boolean;
}

export const SupportComponent = defineComponent<Support>('mechanisms.support');

/** A support let go. */
export interface SupportRelease {
  readonly tick: number;
  readonly entity: EntityId;
  readonly cause: ReleaseCause;
  /** Who cut it (the archer, the thrower), else null: fire and load blame no one. */
  readonly source: EntityId | null;
  /** Everything that was hanging from its span, ascending id. */
  readonly held: readonly EntityId[];
  /** The load of the span at that moment, kg. */
  readonly load: number;
}

export const supportReleased = defineEvent<SupportRelease>('supportReleased');

/** Default half thickness of a rope or chain, metres. */
export const DEFAULT_SUPPORT_RADIUS = 0.05;

/**
 * Largest radius of a support's placement, metres: a spatial strike (a sword arc, a blast) reaches a
 * long rope only near its middle, so swinging on a bridge does not cut it from end to end. Arrows
 * hit its collider wherever they land.
 */
export const MAX_SUPPORT_REACH = 1;

/** How far above a body's top a thing's underside may be and still rest on it, metres. */
export const REST_REACH = 0.05;
/** How far below its top a thing's underside may sink and still rest on a body, metres. */
export const REST_SINK = 0.15;

const known = <T>(value: T | undefined): T => value as T;

/** Options of `makeSupport`. */
export interface SupportOptions {
  /** Half thickness, metres; DEFAULT_SUPPORT_RADIUS. */
  readonly radius?: number;
  readonly resistances?: BreakResistances;
  /** Heaviest load its span carries, kg; none: it never overloads. */
  readonly rating?: number;
  /** Where its collider goes (the world's physics port in the game); none: no body to hit. */
  readonly colliders?: StaticColliderSink;
}

/**
 * Makes `entity` a support from `from` to `to`. It gets `hp` of its own when it has none (set it
 * first, or give it a material, for anything else). Call between steps.
 * @throws RangeError for anchors that coincide, a radius that is not above 0 or a rating that is not
 * above 0.
 */
export function makeSupport(
  world: World<never>,
  entity: EntityId,
  from: Vec3,
  to: Vec3,
  options: SupportOptions = {},
): void {
  const radius = options.radius ?? DEFAULT_SUPPORT_RADIUS;
  const length = Math.sqrt((to.x - from.x) ** 2 + (to.y - from.y) ** 2 + (to.z - from.z) ** 2);
  if (!(Number.isFinite(length) && length > 0)) {
    throw new RangeError('a support needs two anchors that are not the same point');
  }
  if (!(Number.isFinite(radius) && radius > 0)) {
    throw new RangeError('a support needs a radius above 0 m');
  }
  const { rating } = options;
  if (rating !== undefined && !(Number.isFinite(rating) && rating > 0)) {
    throw new RangeError('a support needs a rating above 0 kg');
  }
  if (!hasProperty(world, entity, 'hp')) {
    assignProperty(world, entity, 'hp', readProperty(world, entity, 'hp'));
  }
  const { colliders } = options;
  let collider: ColliderHandle | null = null;
  if (colliders !== undefined) {
    collider = colliders.add({
      kind: 'box',
      min: {
        x: Math.min(from.x, to.x) - radius,
        y: Math.min(from.y, to.y) - radius,
        z: Math.min(from.z, to.z) - radius,
      },
      max: {
        x: Math.max(from.x, to.x) + radius,
        y: Math.max(from.y, to.y) + radius,
        z: Math.max(from.z, to.z) + radius,
      },
    });
    bindCollider(world, entity, collider);
  }
  world.add(
    entity,
    SupportComponent,
    Object.freeze({
      from: Object.freeze({ x: from.x, y: from.y, z: from.z }),
      to: Object.freeze({ x: to.x, y: to.y, z: to.z }),
      radius,
      resistances: Object.freeze({ ...options.resistances }),
      rating: rating ?? null,
      peers: Object.freeze([]),
      collider,
      released: false,
    }),
  );
  placeEntity(
    world,
    entity,
    { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2, z: (from.z + to.z) / 2 },
    Math.min(length / 2, MAX_SUPPORT_REACH),
  );
}

/**
 * Makes `supports` one span that shares a load (a bridge's two ropes). Call between steps, after
 * they are made.
 * @throws Error when one is not a support.
 */
export function linkSpan(world: World<never>, supports: readonly EntityId[]): void {
  const ids = [...new Set(supports)].sort((a, b) => a - b);
  for (const entity of ids) {
    const support = world.get(entity, SupportComponent);
    if (support === undefined) throw new Error(`entity ${String(entity)} is not a support`);
    world.set(
      entity,
      SupportComponent,
      Object.freeze({ ...support, peers: Object.freeze(ids.filter((other) => other !== entity)) }),
    );
  }
}

/** Everything that hangs, by the support it hangs from, each list in ascending id order. */
function hangingBySupport(world: World<never>): Map<EntityId, EntityId[]> {
  const index = new Map<EntityId, EntityId[]>();
  for (const body of world.query(SuspendedComponent).ids()) {
    const from = supportOf(world, body);
    if (from === undefined) continue;
    const list = index.get(from);
    if (list === undefined) index.set(from, [body]);
    else list.push(body);
  }
  return index;
}

/** What hangs from `entity` and the rest of its span, ascending id, out of `index`. */
function spanHeld(
  world: World<never>,
  entity: EntityId,
  index: ReadonlyMap<EntityId, readonly EntityId[]>,
): EntityId[] {
  const support = world.get(entity, SupportComponent);
  const held = [entity, ...(support?.peers ?? [])].flatMap((id) => index.get(id) ?? []);
  return held.sort((a, b) => a - b);
}

/** Everything hanging from `entity` or its span, ascending id. */
export function heldBy(world: World<never>, entity: EntityId): EntityId[] {
  return spanHeld(world, entity, hangingBySupport(world));
}

/** Half sizes of the axis-aligned box that bounds a body in its pose, metres. */
function extentOf(world: World<never>, body: EntityId): { at: Vec3; half: Vec3 } | undefined {
  const object = world.get(body, PhysicsObjectComponent);
  if (object === undefined) return undefined;
  const { shape, rotation: q, position: at } = object;
  if (shape.kind === 'sphere') {
    return { at, half: { x: shape.radius, y: shape.radius, z: shape.radius } };
  }
  if (shape.kind === 'capsule') {
    const r = shape.radius;
    return { at, half: { x: r, y: shape.halfHeight + r, z: r } };
  }
  const { x, y, z, w } = q;
  const h = shape.halfExtents;
  const row = (a: number, b: number, c: number): number =>
    Math.abs(a) * h.x + Math.abs(b) * h.y + Math.abs(c) * h.z;
  return {
    at,
    half: {
      x: row(1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)),
      y: row(2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)),
      z: row(2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)),
    },
  };
}

/** What a span carries now: its own, and what rests on it. */
export interface SpanLoad {
  /** Bodies and actors resting on what hangs, ascending id. */
  readonly resting: readonly EntityId[];
  /** Total weight of the hanging bodies and of what rests on them, kg. */
  readonly weight: number;
}

/** Something that could rest on a hanging body: where its underside is, and what it weighs. */
interface Candidate {
  readonly entity: EntityId;
  readonly x: number;
  readonly z: number;
  /** Half its footprint, metres: it rests on whatever its footprint overlaps. */
  readonly hx: number;
  readonly hz: number;
  readonly underside: number;
  readonly kilos: number;
}

/**
 * Every body and actor that is not hanging itself, with where its underside is (a body's box's; an
 * actor, with no body here, stands in its bounding sphere).
 */
function candidatesOf(world: World<never>, hanging: ReadonlySet<EntityId>): Candidate[] {
  const found: Candidate[] = [];
  world.query(PlacementComponent).forEach((entity, placed) => {
    if (hanging.has(entity) || !weighable(world, entity)) return;
    const own = extentOf(world, entity);
    const sphere = boundingSphereOf(world, entity, placed);
    found.push({
      entity,
      x: sphere.x,
      z: sphere.z,
      hx: own?.half.x ?? sphere.radius,
      hz: own?.half.z ?? sphere.radius,
      underside: own === undefined ? sphere.y - sphere.radius : own.at.y - own.half.y,
      kilos: readProperty(world, entity, 'weight'),
    });
  });
  return found;
}

/** Weighs what `held` hangs and what, out of `candidates`, rests on it (see the file header). */
function weighHeld(
  world: World<never>,
  held: readonly EntityId[],
  candidates: readonly Candidate[],
): SpanLoad {
  let weight = 0;
  for (const body of held) weight += readProperty(world, body, 'weight');
  const resting: Candidate[] = [];
  const boxes = held.flatMap((body) => extentOf(world, body) ?? []);
  if (boxes.length === 0) return { resting: [], weight };
  // The span's bounds, to turn most candidates away at once.
  let [x0, x1, z0, z1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
  for (const { at, half } of boxes) {
    x0 = Math.min(x0, at.x - half.x);
    x1 = Math.max(x1, at.x + half.x);
    z0 = Math.min(z0, at.z - half.z);
    z1 = Math.max(z1, at.z + half.z);
    y0 = Math.min(y0, at.y + half.y - REST_SINK);
    y1 = Math.max(y1, at.y + half.y + REST_REACH);
  }
  for (const candidate of candidates) {
    const { x, z, hx, hz, underside } = candidate;
    if (x + hx < x0 || x - hx > x1 || z + hz < z0 || z - hz > z1) continue;
    if (underside < y0 || underside > y1) continue;
    const on = boxes.some(({ at, half }) => {
      if (Math.abs(x - at.x) > half.x + hx || Math.abs(z - at.z) > half.z + hz) return false;
      const top = at.y + half.y;
      return underside <= top + REST_REACH && underside >= top - REST_SINK;
    });
    if (!on) continue;
    resting.push(candidate);
    weight += candidate.kilos;
  }
  return {
    resting: resting.map(({ entity }) => entity).sort((a, b) => a - b),
    weight,
  };
}

/** Weighs what `held` hangs and what rests on it (see the file header). */
export function weighSpan(world: World<never>, held: readonly EntityId[]): SpanLoad {
  return weighHeld(world, held, candidatesOf(world, new Set(held)));
}

/** Wakes `bodies` (what rests on something about to go must fall with it). */
function wake(world: World<never>, bodies: readonly EntityId[]): void {
  const handles = bodies.flatMap((entity) => world.get(entity, PhysicsObjectComponent)?.body ?? []);
  if (handles.length === 0) return;
  const port = rigidBodiesOf(world);
  for (const body of handles) port.wake(body as ColliderHandle);
}

/**
 * Lets go of support `entity` and its span (see the file header). Returns false for something that is
 * not a support or one that already let go.
 */
export function releaseSupport(
  world: World<never>,
  entity: EntityId,
  cause: ReleaseCause,
  source: EntityId | null = null,
): boolean {
  const support = world.get(entity, SupportComponent);
  if (support === undefined || support.released) return false;
  const held = heldBy(world, entity);
  const load = weighSpan(world, held);
  const span = [entity, ...support.peers];
  for (const id of span) {
    const rope = known(world.get(id, SupportComponent));
    world.set(id, SupportComponent, Object.freeze({ ...rope, released: true }));
  }
  for (const body of held) releaseSuspended(world, body, source);
  wake(world, load.resting);
  for (const id of span) {
    for (const [graph, node, kind] of boundNodes(world, id)) {
      if (kind === 'lever') setLever(world, graph, node, true);
    }
    // A burnt rope is destroyed by the fire rules; any other goes here.
    if (cause !== 'burnt' || id !== entity) world.destroy(id);
  }
  world.events.emit(supportReleased, {
    tick: world.tick,
    entity,
    cause,
    source,
    held: Object.freeze(held),
    load: load.weight,
  });
  return true;
}

const DAMAGE_ELEMENTS: ReadonlySet<string> = new Set(BREAK_TYPES);

/** Snaps the weakest rope of the span `lead` belongs to when its load is over its rating. */
function overload(
  world: World<never>,
  lead: EntityId,
  index: ReadonlyMap<EntityId, readonly EntityId[]>,
  candidates: readonly Candidate[],
): void {
  const first = known(world.get(lead, SupportComponent));
  const ropes = [lead, ...first.peers].filter(
    (id) => world.get(id, SupportComponent)?.released === false,
  );
  const rating = Math.min(
    ...ropes.map((id) => known(world.get(id, SupportComponent)).rating ?? Infinity),
  );
  const { weight } = weighHeld(world, spanHeld(world, lead, index), candidates);
  if (weight <= rating) return;
  let weakest = known(ropes[0]);
  for (const id of ropes) {
    if (readProperty(world, id, 'hp') < readProperty(world, weakest, 'hp')) weakest = id;
  }
  releaseSupport(world, weakest, 'overload');
}

/**
 * The support system: lets go of any support worn to 0 `hp` (fire does that through the burn rule's
 * own damage) and any span that is overloaded, snapping its weakest rope. Installed with the
 * mechanisms.
 */
export function supportsSystem<TInput>(): System<TInput> {
  return {
    name: 'supports',
    run: ({ world: w }) => {
      const world: World<never> = w;
      const worn: EntityId[] = [];
      const leads = new Set<EntityId>();
      world.query(SupportComponent).forEach((entity, support) => {
        if (support.released) return;
        if (readProperty(world, entity, 'hp') <= 0) worn.push(entity);
        else if (support.rating !== null) leads.add(Math.min(entity, ...support.peers));
      });
      for (const entity of worn) {
        releaseSupport(world, entity, readProperty(world, entity, 'burning') ? 'burnt' : 'damage');
      }
      if (leads.size === 0) return;
      const index = hangingBySupport(world);
      const hanging = new Set([...index.values()].flat());
      const candidates = candidatesOf(world, hanging);
      for (const lead of [...leads].sort((a, b) => a - b)) {
        // An earlier release this tick may have taken the span.
        if (world.get(lead, SupportComponent)?.released === false) {
          overload(world, lead, index, candidates);
        }
      }
    },
  };
}

/**
 * Wears supports down with the hits that reach them and lets go of one that burns out. Returns a
 * function that removes the subscriptions.
 */
export function supportFeeds<TInput>(world: World<TInput>): () => void {
  const w: World<never> = world;
  const offs = [
    world.events.on(stimulusResolved, ({ stimulus, hits }) => {
      if (!DAMAGE_ELEMENTS.has(stimulus.element)) return;
      const by = stimulus.element as BreakType;
      for (const { entity, amount } of hits) {
        const support = w.get(entity, SupportComponent);
        if (support === undefined || support.released) continue;
        const damage = structuralDamage(amount, support.resistances[by] ?? 0);
        if (damage === 0) continue;
        const hp = readProperty(w, entity, 'hp');
        const left = Math.max(0, fromUnits(toUnits(hp) - toUnits(damage)));
        const { source } = stimulus;
        assignProperty(w, entity, 'hp', left, source === null ? {} : { source });
        if (left === 0) releaseSupport(w, entity, 'damage', source);
      }
    }),
    // A support that burns away lets go the tick its fire burns out.
    world.events.on(fireBurntOut, ({ entity, becomes }) => {
      if (becomes === null) releaseSupport(w, entity, 'burnt');
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
