// Breakables (mw-e03.11): walls, barricades, crates and pottery that break from what hits them, never
// from who hit them. Everything arrives through the two channels every other world rule uses:
// - stimuli (the one stimulus API): a blunt, slash or pierce stimulus is a hit of that kind carrying
//   its amount as impact energy (J); a force stimulus is a shove (N·s). A knight's heavy swing, an
//   arrow, Thunderclap and a gas explosion all arrive this way, so no class or weapon is special;
// - physics impacts: a thrown, fallen or struck physics object, and whatever it hits, feel the
//   impact's energy (J).
//
// What a hit does depends only on the entity's properties and its breakable profile:
// - Fragility: one impact (a hit's energy, or a physics impact's) at or above the `fragile` threshold
//   breaks it outright, whatever its hit points. Frozen (`frozen`) things are brittle: the threshold
//   is divided by the frozen fragility multiplier (4 by default), so a frozen door shatters.
// - Structure: every hit of a kind wears `hp` down by its amount less the profile's resistance to
//   that kind (an old wall shrugs off 90% of a sword's slash but only 20% of a hammer's blunt);
//   amounts are 1:1 hit points, in whole hundredths so totals never drift. At 0 it breaks. Physics
//   impacts only test fragility: dropping a crate must not wear it down.
//
// A break, resolved the tick the hit lands: `hp` goes to 0 (attributed to the source), debris spawns
// as small physics objects of the broken thing's material inside its bounds (thrown up and out from
// the world's `breakables` random stream), its contents spill as props, `breakableBroken` fires, then
// `passageRevealed` when it hides a passage and a `noiseEmitted` at the profile's break loudness; the
// entity is destroyed at the end of the tick, and its bound colliders or body leave the physics world
// with it (mw-e03.42), so the way is open from the next tick. A thing breaks once: further hits in the
// same tick find it at 0 hp and do nothing.
//
// Debris is budgeted: at most `debrisBudget` pieces live at once (24 by default). A break that would
// go over removes the oldest pieces first (earliest tick, then lowest id) and reports them in
// `debrisCulled`; the break itself always completes. Debris also clears itself after
// `debrisLifetime` seconds. With nothing breakable and no debris, the layer costs one empty ledger
// check a tick.

import type { EntityId } from '../core/component';
import type { System, World } from '../core/world';
import { blameOf, BlameComponent } from '../combat/environment/environment';
import { fromUnits, scaleUnits, toUnits } from '../combat/damage/types';
import { noiseEmitted } from '../noise/events';
import { addPhysicsObject, PhysicsObjectComponent, physicsImpact } from '../physics/objects';
import { addProperties, assignProperty, hasProperty, readProperty } from '../properties/components';
import { FROZEN_FRAGILITY } from '../properties/derived';
import type { MaterialPresets } from '../properties/materials';
import { BREAK_TYPES, type BreakType } from '../properties/spec';
import { ScenePieceComponent } from '../scene/loader';
import { addPropPhysics, type PropBodyLookup } from '../scene/physics';
import { boundingSphereOf, PlacementComponent } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { stimulusResolved, StimulusQueueComponent } from '../stimulus/stimulus';
import {
  BREAKABLE_COMPONENTS,
  BreakableComponent,
  DebrisComponent,
  DebrisLedgerComponent,
  SpilledComponent,
  type Breakable,
  type BreakableProfile,
  type DebrisLedger,
} from './components';
import { breakableBroken, debrisCulled, passageRevealed, type BreakCause } from './events';

/** Default most debris pieces alive at once. */
export const DEFAULT_DEBRIS_BUDGET = 24;
/** Default seconds a piece of debris lasts. */
export const DEFAULT_DEBRIS_LIFETIME = 4;
/** Default divisor of a frozen thing's `fragile` threshold. */
export const DEFAULT_FROZEN_FRAGILITY = FROZEN_FRAGILITY;
/** Heaviest piece of debris, kg (a stone chunk weighs no more, so it cannot crush anyone). */
export const MAX_DEBRIS_WEIGHT = 4;
/** Lightest piece of debris, kg. */
export const MIN_DEBRIS_WEIGHT = 0.05;
/** Name of the random stream debris is thrown from. */
export const DEBRIS_STREAM = 'breakables';

export interface BreakablesOptions {
  /** Most debris pieces alive at once; DEFAULT_DEBRIS_BUDGET. 0: breaks leave no debris. */
  readonly debrisBudget?: number;
  /** Seconds a piece of debris lasts; DEFAULT_DEBRIS_LIFETIME. */
  readonly debrisLifetime?: number;
  /** Divisor of a frozen thing's fragile threshold; DEFAULT_FROZEN_FRAGILITY. */
  readonly frozenFragility?: number;
  /** Bodies of the props breakables spill; without them (or `materials`), nothing spills. */
  readonly props?: PropBodyLookup;
  readonly materials?: MaterialPresets;
}

interface Rules {
  readonly budget: number;
  readonly lifetime: number;
  readonly frozenFragility: number;
  readonly props: PropBodyLookup | undefined;
  readonly materials: MaterialPresets | undefined;
}

/** What one hit brings. */
export interface BreakHit {
  /** The kind of hit, or `collision` for a physics impact (which only tests fragility). */
  readonly by: BreakType | 'collision';
  /** Structural damage before resistance, hit points (ignored for a collision). */
  readonly amount: number;
  /** Impact energy tested against the fragile threshold, J (0: none). */
  readonly energy: number;
  readonly source: EntityId | null;
}

/** A breakable instance's own data besides its profile (a scene placement's). */
export interface BreakableInstance {
  readonly contents?: readonly string[];
  readonly reveals?: string;
}

/**
 * Makes `entity` breakable with `profile` (see the file header): gives it the breakable component, the
 * `breakable` property and, when it has none, its effective `hp` as a property of its own, so hits can
 * wear it down. Like `World.add`, deferred to the end of the tick during a step.
 */
export function makeBreakable(
  world: World<never>,
  entity: EntityId,
  profile: BreakableProfile,
  instance: BreakableInstance = {},
): void {
  const value: Breakable = {
    profile: profile.id,
    resistances: Object.freeze({ ...profile.resistances }),
    debris: Object.freeze({ ...profile.debris }),
    breakLoudness: profile.breakLoudness,
    contents: Object.freeze([...(instance.contents ?? [])]),
    reveals: instance.reveals ?? null,
  };
  world.add(entity, BreakableComponent, Object.freeze(value));
  addProperties(world, entity, {
    breakable: true,
    ...(!hasProperty(world, entity, 'hp') && { hp: readProperty(world, entity, 'hp') }),
  });
}

/** The fragile threshold `entity` breaks at now, J: `fragile`, divided by `frozenFragility` when frozen. */
export function breakThreshold(
  world: World<never>,
  entity: EntityId,
  frozenFragility = DEFAULT_FROZEN_FRAGILITY,
): number {
  const fragile = readProperty(world, entity, 'fragile');
  return readProperty(world, entity, 'frozen') ? fragile / frozenFragility : fragile;
}

/** Hit points a hit of `amount` takes off through `resistance` (0–1, clamped), whole hundredths. */
export function structuralDamage(amount: number, resistance: number): number {
  const through = 1 - Math.min(1, Math.max(0, resistance));
  return fromUnits(scaleUnits(toUnits(amount), through));
}

const frozenVec = ({ x, y, z }: Vec3): Vec3 => Object.freeze({ x, y, z });

/** Centre and bounds of `entity`: a scene piece's box, else its placement's bounding sphere. */
function extentOf(world: World<never>, entity: EntityId): { centre: Vec3; min: Vec3; max: Vec3 } {
  const piece = world.isRegistered(ScenePieceComponent)
    ? world.get(entity, ScenePieceComponent)
    : undefined;
  if (piece !== undefined) {
    const { min, max } = piece;
    const centre = { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 };
    return { centre, min, max };
  }
  const placed = world.get(entity, PlacementComponent);
  const at = placed === undefined ? undefined : boundingSphereOf(world, entity, placed);
  const centre = at ?? { x: 0, y: 0, z: 0 };
  const r = at?.radius ?? 0;
  return {
    centre: { x: centre.x, y: centre.y, z: centre.z },
    min: { x: centre.x - r, y: centre.y - r, z: centre.z - r },
    max: { x: centre.x + r, y: centre.y + r, z: centre.z + r },
  };
}

function ledgerOf(world: World<never>): readonly [EntityId, DebrisLedger] {
  let found: readonly [EntityId, DebrisLedger] | undefined;
  if (world.isRegistered(DebrisLedgerComponent)) {
    world.query(DebrisLedgerComponent).forEach((id, ledger) => {
      found ??= [id, ledger];
    });
  }
  if (found === undefined) throw new Error('breakables are not installed in this world');
  return found;
}

/** A coordinate inside [lo, hi] shrunk by `half`, from a random draw in [0, 1). */
const within = (lo: number, hi: number, half: number, draw: number): number =>
  hi - lo <= 2 * half ? (lo + hi) / 2 : lo + half + draw * (hi - lo - 2 * half);

function spawnDebris(
  world: World<never>,
  from: EntityId,
  breakable: Breakable,
  box: { min: Vec3; max: Vec3 },
  rules: Rules,
): EntityId[] {
  const { count, size } = breakable.debris;
  if (count === 0 || rules.budget === 0 || !world.isRegistered(PhysicsObjectComponent)) return [];
  const rng = world.random(DEBRIS_STREAM);
  const material = readProperty(world, from, 'material');
  const density = readProperty(world, from, 'density');
  const weight = Math.min(MAX_DEBRIS_WEIGHT, Math.max(MIN_DEBRIS_WEIGHT, density * size ** 3));
  const properties = {
    weight,
    friction: readProperty(world, from, 'friction'),
    impactAbsorb: readProperty(world, from, 'impactAbsorb'),
  };
  const half = size / 2;
  const pieces: EntityId[] = [];
  for (let i = 0; i < count; i++) {
    const piece = world.spawn();
    addProperties(world, piece, { material, ...properties });
    const position = {
      x: within(box.min.x, box.max.x, half, rng.float()),
      y: within(box.min.y, box.max.y, half, rng.float()),
      z: within(box.min.z, box.max.z, half, rng.float()),
    };
    const velocity = {
      x: (rng.float() - 0.5) * 3,
      y: 0.5 + rng.float() * 1.5,
      z: (rng.float() - 0.5) * 3,
    };
    addPhysicsObject(world, piece, {
      shape: { kind: 'box', halfExtents: { x: half, y: half, z: half } },
      position,
      velocity,
      properties,
    });
    world.add(piece, DebrisComponent, Object.freeze({ spawned: world.tick, from }));
    pieces.push(piece);
  }
  return pieces;
}

function spill(
  world: World<never>,
  from: EntityId,
  breakable: Breakable,
  box: { centre: Vec3; min: Vec3 },
  rules: Rules,
): EntityId[] {
  const { props, materials } = rules;
  if (props === undefined || materials === undefined) return [];
  const spilled: EntityId[] = [];
  const n = breakable.contents.length;
  breakable.contents.forEach((prop, i) => {
    const body = props(prop);
    if (body === undefined) return;
    const entity = world.spawn();
    const at = { x: box.centre.x + (i - (n - 1) / 2) * 0.4, y: box.min.y, z: box.centre.z };
    addPropPhysics(world, entity, body, materials, at);
    world.add(entity, SpilledComponent, Object.freeze({ prop, from }));
    spilled.push(entity);
  });
  return spilled;
}

/** Adds `pieces` to the debris ledger, then culls the oldest over the budget. */
function account(world: World<never>, pieces: readonly EntityId[], rules: Rules): void {
  if (pieces.length === 0) return;
  const [id, { live }] = ledgerOf(world);
  const all = [...live, ...pieces.map((entity) => Object.freeze({ entity, spawned: world.tick }))];
  const over = all.length - rules.budget;
  const culled = over > 0 ? all.slice(0, over) : [];
  for (const { entity, spawned } of culled) {
    // This tick's debris is not live yet, but destroying it now still drops it with its body.
    if (spawned === world.tick || world.isAlive(entity)) world.destroy(entity);
  }
  world.set(
    id,
    DebrisLedgerComponent,
    Object.freeze({ live: Object.freeze(all.slice(culled.length)) }),
  );
  if (culled.length > 0) {
    world.events.emit(debrisCulled, {
      tick: world.tick,
      budget: rules.budget,
      culled: culled.map((c) => c.entity),
    });
  }
}

function shatter(
  world: World<never>,
  entity: EntityId,
  breakable: Breakable,
  cause: BreakCause,
  hit: BreakHit,
  rules: Rules,
): void {
  const { source } = hit;
  assignProperty(world, entity, 'hp', 0, source === null ? {} : { source });
  const box = extentOf(world, entity);
  const debris = spawnDebris(world, entity, breakable, box, rules);
  const spilled = spill(world, entity, breakable, box, rules);
  const position = frozenVec(box.centre);
  world.destroy(entity);
  world.events.emit(breakableBroken, {
    tick: world.tick,
    entity,
    profile: breakable.profile,
    material: readProperty(world, entity, 'material'),
    cause,
    by: hit.by,
    source,
    position,
    cleared: Object.freeze({ min: frozenVec(box.min), max: frozenVec(box.max) }),
    debris: Object.freeze(debris),
    spilled: Object.freeze(spilled),
    reveals: breakable.reveals,
    loudness: breakable.breakLoudness,
  });
  if (breakable.reveals !== null) {
    world.events.emit(passageRevealed, {
      tick: world.tick,
      passage: breakable.reveals,
      entity,
      source,
      position,
    });
  }
  world.events.emit(noiseEmitted, {
    tick: world.tick,
    position,
    loudness: breakable.breakLoudness,
    kind: 'break',
    entity,
    source,
  });
  account(world, debris, rules);
}

/**
 * Applies one hit to `entity` (see the file header) and breaks it when it should. Returns true when
 * this hit broke it. Entities that are not breakable, or already broken, ignore hits.
 */
function strike(world: World<never>, entity: EntityId, hit: BreakHit, rules: Rules): boolean {
  const breakable = world.get(entity, BreakableComponent);
  if (breakable === undefined) return false;
  const hp = readProperty(world, entity, 'hp');
  if (hp <= 0) return false; // broken earlier this tick
  if (hit.energy > 0 && hit.energy >= breakThreshold(world, entity, rules.frozenFragility)) {
    shatter(world, entity, breakable, 'impact', hit, rules);
    return true;
  }
  if (hit.by === 'collision') return false;
  const damage = structuralDamage(hit.amount, breakable.resistances[hit.by] ?? 0);
  if (damage === 0) return false;
  const left = Math.max(0, fromUnits(toUnits(hp) - toUnits(damage)));
  if (left > 0) {
    assignProperty(world, entity, 'hp', left, hit.source === null ? {} : { source: hit.source });
    return false;
  }
  shatter(world, entity, breakable, 'structure', hit, rules);
  return true;
}

const BREAK_ELEMENTS: ReadonlySet<string> = new Set(BREAK_TYPES);

/** The system that clears debris past its lifetime (and forgets pieces already gone). */
export function debrisSystem<TInput>(options: { readonly lifetime: number }): System<TInput> {
  return {
    name: 'breakables-debris',
    run: ({ world: w, tick, clock }) => {
      const world: World<never> = w;
      const [id, { live }] = ledgerOf(world);
      if (live.length === 0) return;
      const ticks = Math.max(1, Math.round(options.lifetime * clock.hz));
      const kept = live.filter(({ entity, spawned }) => {
        // Debris made this tick goes live at its end; anything else not alive was removed.
        if (spawned !== tick && !world.isAlive(entity)) return false;
        if (tick - spawned < ticks) return true;
        world.destroy(entity);
        return false;
      });
      if (kept.length !== live.length) {
        world.set(id, DebrisLedgerComponent, Object.freeze({ live: Object.freeze(kept) }));
      }
    },
  };
}

/**
 * Makes `world` break things (see the file header): registers the breakable components and the debris
 * ledger, listens to stimuli and physics impacts, and adds the debris system. Needs world properties
 * and stimuli installed; debris needs physics objects installed too (without them breaks leave
 * none). Call once at setup, between steps. Returns a function that removes the subscriptions.
 * @throws RangeError for a negative or fractional budget, a non-positive lifetime or a frozen
 * fragility below 1.
 */
export function installBreakables<TInput>(
  world: World<TInput>,
  options: BreakablesOptions = {},
): () => void {
  const w: World<never> = world;
  const budget = options.debrisBudget ?? DEFAULT_DEBRIS_BUDGET;
  const lifetime = options.debrisLifetime ?? DEFAULT_DEBRIS_LIFETIME;
  const frozenFragility = options.frozenFragility ?? DEFAULT_FROZEN_FRAGILITY;
  if (!Number.isSafeInteger(budget) || budget < 0) {
    throw new RangeError(`debris budget must be a whole number ≥ 0, got ${String(budget)}`);
  }
  if (!(lifetime > 0 && Number.isFinite(lifetime))) {
    throw new RangeError(`debris lifetime must be a positive number, got ${String(lifetime)}`);
  }
  if (!(frozenFragility >= 1 && Number.isFinite(frozenFragility))) {
    throw new RangeError(`frozen fragility must be at least 1, got ${String(frozenFragility)}`);
  }
  const rules: Rules = {
    budget,
    lifetime,
    frozenFragility,
    props: options.props,
    materials: options.materials,
  };
  if (!world.isRegistered(StimulusQueueComponent)) {
    throw new Error('install stimuli before breakables');
  }
  world.register(...BREAKABLE_COMPONENTS);
  w.add(w.spawn(), DebrisLedgerComponent, Object.freeze({ live: Object.freeze([]) }));
  world.addSystem(debrisSystem({ lifetime }));
  const blamed = (entity: EntityId): EntityId | null =>
    w.isRegistered(BlameComponent) && w.isAlive(entity) ? blameOf(w, entity) : null;
  const offs = [
    world.events.on(stimulusResolved, ({ stimulus, hits }) => {
      if (!BREAK_ELEMENTS.has(stimulus.element)) return;
      const by = stimulus.element as BreakType;
      for (const { entity, amount } of hits) {
        strike(
          w,
          entity,
          { by, amount, energy: by === 'force' ? 0 : amount, source: stimulus.source },
          rules,
        );
      }
    }),
    world.events.on(physicsImpact, ({ entity, other, energy }) => {
      const source = blamed(entity) ?? (other === null ? null : blamed(other));
      strike(w, entity, { by: 'collision', amount: 0, energy, source }, rules);
      if (other !== null) strike(w, other, { by: 'collision', amount: 0, energy, source }, rules);
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}

/** Live debris pieces, oldest first. */
export function liveDebris(world: World<never>): readonly EntityId[] {
  return ledgerOf(world)[1].live.map((entry) => entry.entity);
}
