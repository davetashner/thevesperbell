// The arrow system (mw-e05.2): flies every arrow one fixed tick and resolves what it hits. Arrows are
// data (src/content/types/arrow.ts): mass and drag shape the arc, penetration against the struck
// surface's hardness decides whether it sticks, and its damage packet goes through the damage model.
//
// Each tick an arrow integrates (ballistics.ts), then its path from where it was to where it is now
// is tested against the level and against hurtboxes, so no arrow can skip a thin plank or a limb
// between ticks however fast it flies:
// - the level: a ray along the segment through the CollisionWorld (the Rapier port in the game, the
//   in-memory fake in tests). A contact where the segment starts (it starts on or inside a surface:
//   loosed from the ground) or whose normal does not face the arrow (it is leaving a surface) is
//   skipped and the ray re-cast just past it.
// - creatures: the segment, grown by the arrow's radius, through the shared hit-volume query
//   (`segmentHurtboxHits`), which names the hurtbox touched first and so the region and multiplier.
// The nearest contact wins. A target in its i-frames (the `invulnerable` rule, the same one the
// hit-volume system and creature attacks ask) gets DodgedHit once and is flown through, as creature
// projectiles are (mw-e04.28). The shooter cannot be hit by its own arrow for its first
// `selfImmuneTicks` of flight, then can (an arrow shot straight up comes back down on it).
//
// What an impact does, by the arrow's onImpact:
// - stick: when its penetration reaches the surface's hardness rating (surfaceHardness: soft 5,
//   medium 10, hard 40; a creature's own surfaceHardness, flesh by default medium) it embeds: a
//   creature takes the damage packet, and the arrow rests stuck in what it hit. Otherwise it
//   ricochets and deals no damage.
// - bounce (blunt heads): never embeds; a creature takes the damage packet and the arrow ricochets.
// - shatter: a creature takes the damage packet and the arrow leaves the world.
// A ricochet reflects the arrow off the surface keeping 40% of its speed. Too slow to fly on (below
// `minRicochetSpeed`), it drops instead: on ground (a surface facing up) it rests there; otherwise it
// falls, harmless, and rests on the next surface it touches. Damage scales with (v / v0)² at impact,
// clamped to [0.3, 1]: the packet's amounts, poise damage, impact force and impulse alike.
//
// The world answers what things are made of through properties, never arrow-specific code: the
// struck entity's surfaceHardness and material. The level's colliders name their entity through
// `bindCollider` and physics objects through their body (`physicsSurfaceOf`); unbound geometry reads
// the properties' defaults. The momentum an arrow loses pushes what it hit through the one stimulus
// API — a force stimulus on that entity — so a struck crate or bottle reacts by its own properties —
// and its impact energy strikes it as a pierce hit (a blunt one for a bounce head), so a pot shatters
// and a barricade takes the hit (mw-e03.11 breakables).
// Payloads (fire, water, rope…) are each trick arrow's bead; this system reports the impact they act on.
//
// Every impact emits `arrowImpact` (physicsImpact's conventions, events.ts). An arrow that flies its
// airborne lifetime (10 s) without coming to rest leaves the world with ArrowExpired.
//
// Determinism: arrows run in ascending entity id order, targets are tested in ascending id order and
// every computation is IEEE-exact arithmetic on sim state, so replays reproduce every arc and hit.

import type { ArrowEntry } from '@content/index';
import type { BodyId, CollisionHit, CollisionWorld } from '../../character/collision-world';
import type { EntityId } from '../../core/component';
import type { System, World } from '../../core/world';
import { PhysicsColliderComponent, PhysicsObjectComponent } from '../../physics/objects';
import { readProperty, WorldProperties } from '../../properties/components';
import { WORLD_PROPERTY_SPECS, type SurfaceHardness } from '../../properties/spec';
import type { GeomShape } from '../../geom';
import type { Vec3 } from '../../stimulus/shapes';
import { PlacementComponent } from '../../stimulus/placement';
import { applyStimulus, StimulusQueueComponent } from '../../stimulus/stimulus';
import { rotateToWorld } from '../attacks/frame';
import { scaleDamage, type DamageModel } from '../damage/model';
import type { DamageResult } from '../damage/events';
import { DAMAGE_TAGS } from '../damage/packet';
import type { Hurtbox } from '../hits/components';
import { DodgedHit } from '../hits/events';
import {
  hurtboxTargets,
  noInvulnerability,
  segmentHurtboxHits,
  type HurtboxTargets,
  type InvulnerabilityRule,
  type SegmentHurtboxHit,
} from '../hits/system';
import {
  damageFactor,
  DEFAULT_ARROW_RULES,
  integrateFlight,
  penetrates,
  ricochet,
  speedOf,
  intactChanceOf,
  type ArrowRules,
} from './ballistics';
import {
  ARROW_COMPONENTS,
  ArrowComponent,
  ArrowRestComponent,
  type ArrowFlight,
  type ArrowRestState,
} from './components';
import {
  ArrowExpired,
  ArrowFired,
  arrowImpact,
  ArrowRested,
  type ArrowImpactOutcome,
} from './events';

/** Arrow definitions by id (`arrowLookup`); the system looks every arrow's numbers up here. */
export type ArrowLookup = ReadonlyMap<string, ArrowEntry>;

/** The arrow table for the system, from the loaded arrow content (`content.all('arrow')`). */
export function arrowLookup(arrows: Iterable<ArrowEntry>): ArrowLookup {
  return new Map([...arrows].map((arrow) => [arrow.id, arrow]));
}

/** The entity a level collider or body belongs to, or null when it belongs to none. */
export type SurfaceRule = (world: World<never>, body: BodyId) => EntityId | null;

/**
 * Colliders bound to an entity (`bindCollider`) and physics objects' bodies name their entity; any
 * other collider is unbound level geometry. Worlds without physics components have only the latter.
 */
export const physicsSurfaceOf: SurfaceRule = (world, body) => {
  if (world.isRegistered(PhysicsColliderComponent)) {
    for (const entity of world.query(PhysicsColliderComponent).ids()) {
      if (world.get(entity, PhysicsColliderComponent)?.colliders.includes(body)) return entity;
    }
  }
  if (world.isRegistered(PhysicsObjectComponent)) {
    for (const entity of world.query(PhysicsObjectComponent).ids()) {
      if (world.get(entity, PhysicsObjectComponent)?.body === body) return entity;
    }
  }
  return null;
};

/** What the arrow system needs. */
export interface ArrowSystemOptions {
  readonly arrows: ArrowLookup;
  /** The damage model creature hits resolve through. */
  readonly damage: DamageModel;
  /** The level arrows hit (RapierCollisionWorld in the game); omitted, arrows meet no level. */
  readonly collision?: CollisionWorld;
  /**
   * Who is invulnerable this tick (DodgedHit, flown through). Defaults to nobody;
   * `invulnerabilityRule(moves)` gives dodge and wake-up i-frames (run the timeline first).
   */
  readonly invulnerable?: InvulnerabilityRule;
  /** Which entity a level collider belongs to; defaults to `physicsSurfaceOf`. */
  readonly surfaceOf?: SurfaceRule;
  /** Overrides of DEFAULT_ARROW_RULES. */
  readonly rules?: Partial<ArrowRules>;
  /**
   * The roll in [0, 1) that decides whether an arrow coming to rest is intact (it is when the roll is
   * below the surface's chance). Defaults to a draw from the world's `arrows` RNG stream, a sub-stream
   * named for the arrow's entity, so it never shifts any other draw. Tests inject fixed rolls.
   */
  readonly roll?: (world: World<never>, arrow: EntityId) => number;
}

/** The world RNG stream arrow rolls are drawn from (a sub-stream per arrow entity). */
export const ARROW_RNG_STREAM = 'arrows';

/** How to loose an arrow. */
export interface FireArrowSpec {
  /** Arrow content id. */
  readonly arrow: string;
  /** Who shot it; null or omitted for nobody. */
  readonly shooter?: EntityId | null;
  /** Where it starts, metres. */
  readonly origin: Vec3;
  /** Launch velocity, m/s (non-zero). */
  readonly velocity: Vec3;
}

function lookup(arrows: ArrowLookup, id: string): ArrowEntry {
  const arrow = arrows.get(id);
  if (arrow === undefined) throw new Error(`arrow "${id}" is not in the arrow table`);
  return arrow;
}

const frozen = (v: Vec3): Vec3 => Object.freeze({ x: v.x, y: v.y, z: v.z });

/**
 * Looses an arrow: spawns its entity in flight at `spec.origin` and emits ArrowFired. Adding the
 * component is structural, so during a step the arrow flies from the next tick. Returns the arrow
 * entity. Throws for an arrow not in `arrows`, or a non-finite origin or a zero or non-finite
 * velocity.
 */
export function fireArrow(world: World<never>, arrows: ArrowLookup, spec: FireArrowSpec): EntityId {
  lookup(arrows, spec.arrow);
  const { origin, velocity } = spec;
  const launchSpeed = speedOf(velocity);
  if (![origin.x, origin.y, origin.z].every(Number.isFinite)) {
    throw new RangeError('arrow origin must be finite');
  }
  if (!Number.isFinite(launchSpeed) || launchSpeed === 0) {
    throw new RangeError('arrow velocity must be finite and non-zero');
  }
  const shooter = spec.shooter ?? null;
  const entity = world.spawn();
  const flight: ArrowFlight = Object.freeze({
    arrow: spec.arrow,
    shooter,
    position: frozen(origin),
    velocity: frozen(velocity),
    launchSpeed,
    flown: 0,
    spent: false,
  });
  world.add(entity, ArrowComponent, flight);
  world.events.emit(ArrowFired, {
    tick: world.tick,
    entity,
    arrow: spec.arrow,
    shooter,
    origin: flight.position,
    velocity: flight.velocity,
  });
  return entity;
}

/** The unit direction a flying arrow points: along its velocity. */
export function arrowDirection(flight: Pick<ArrowFlight, 'velocity'>): Vec3 {
  const { velocity: v } = flight;
  const speed = speedOf(v);
  return { x: v.x / speed, y: v.y / speed, z: v.z / speed };
}

/** Gap an arrow keeps from a surface it leaves (a ricochet, a re-cast ray), metres. */
const SEPARATION = 1e-4;
/** Most rays one segment casts past contacts it is leaving. */
const MAX_CASTS = 3;
/** A surface whose normal's y is at least this is ground a dropped arrow rests on. */
const GROUND_NORMAL_Y = 0.5;

/**
 * The first level contact along `from`→`to` that faces the segment (see the file header), with its
 * distance from `from`; undefined when the path is clear.
 */
export function castSegment(
  collision: CollisionWorld,
  from: Vec3,
  to: Vec3,
): CollisionHit | undefined {
  const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
  const length = speedOf(d);
  if (length === 0) return undefined;
  const dir = { x: d.x / length, y: d.y / length, z: d.z / length };
  let start = 0;
  for (let i = 0; i < MAX_CASTS && start < length; i++) {
    const origin = {
      x: from.x + dir.x * start,
      y: from.y + dir.y * start,
      z: from.z + dir.z * start,
    };
    const hit = collision.raycast(origin, dir, length - start);
    if (hit === undefined) return undefined;
    const { normal: n } = hit;
    if (hit.distance > 0 && n.x * dir.x + n.y * dir.y + n.z * dir.z < 0) {
      return { ...hit, distance: start + hit.distance };
    }
    start += hit.distance + SEPARATION;
  }
  return undefined;
}

/** Unit normal of placed `shape`'s surface at `point` (out of the shape); `fallback` at its core. */
function surfaceNormal(shape: GeomShape, point: Vec3, fallback: Vec3): Vec3 {
  let core: Vec3;
  switch (shape.kind) {
    case 'sphere':
    case 'box':
      core = shape.center;
      break;
    case 'capsule': {
      const { from: a, to: b } = shape;
      const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
      const lengthSq = ab.x * ab.x + ab.y * ab.y + ab.z * ab.z;
      const along =
        lengthSq === 0
          ? 0
          : ((point.x - a.x) * ab.x + (point.y - a.y) * ab.y + (point.z - a.z) * ab.z) / lengthSq;
      const t = Math.min(1, Math.max(0, along));
      core = { x: a.x + ab.x * t, y: a.y + ab.y * t, z: a.z + ab.z * t };
      break;
    }
  }
  const out = { x: point.x - core.x, y: point.y - core.y, z: point.z - core.z };
  const length = speedOf(out);
  return length === 0 ? fallback : { x: out.x / length, y: out.y / length, z: out.z / length };
}

/** Where along the segment the arrow touched what it hit, and what that is. */
interface Contact {
  readonly point: Vec3;
  readonly normal: Vec3;
  readonly other: EntityId | null;
  readonly hurtbox?: Hurtbox;
}

/** Everything one tick of one arrow works with. */
interface Flying {
  readonly entity: EntityId;
  readonly flight: ArrowFlight;
  readonly def: ArrowEntry;
  readonly flown: number;
  /** Velocity after this tick's integration (the velocity at impact). */
  readonly velocity: Vec3;
  readonly dodged: readonly EntityId[];
}

const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});

/** The arrow system (see the file header); `installArrows` wires it. */
export function arrowSystem<TInput>(options: ArrowSystemOptions): System<TInput> {
  const rules: ArrowRules = { ...DEFAULT_ARROW_RULES, ...options.rules };
  const invulnerable = options.invulnerable ?? noInvulnerability;
  const surfaceOf = options.surfaceOf ?? physicsSurfaceOf;
  const roll =
    options.roll ??
    ((world: World<never>, arrow: EntityId): number =>
      world
        .random(ARROW_RNG_STREAM)
        .stream(`rest:${String(arrow)}`)
        .float());

  /**
   * Whether an arrow coming to rest in `other` is whole: not when its kind is not retrievable, when it
   * burns itself or what it lands in burns (a fire arrow, a burning crate), else by the surface's
   * odds (hardness and conductivity; ballistics.ts intactChanceOf).
   */
  function landsIntact(
    world: World<never>,
    arrow: Flying,
    other: EntityId | null,
    hardness: SurfaceHardness,
  ): boolean {
    const { def, entity } = arrow;
    if (!def.retrievable) return false;
    // A world with no properties has nothing that burns; an arrow in flight carries none of its own yet.
    const props = world.isRegistered(WorldProperties.burning);
    if (def.properties?.burning === true || (props && readProperty(world, entity, 'burning'))) {
      return false;
    }
    if (other !== null && readProperty(world, other, 'burning')) return false;
    const conductive = other !== null && readProperty(world, other, 'conductive');
    return roll(world, entity) < intactChanceOf(rules, hardness, conductive);
  }

  /** Deals the arrow's packet to `target`, scaled by its speed; the damage model's result. */
  function strike(
    world: World<never>,
    arrow: Flying,
    target: EntityId,
    hurtbox: Hurtbox,
  ): DamageResult | undefined {
    const { def, velocity } = arrow;
    const factor = damageFactor(speedOf(velocity), arrow.flight.launchSpeed, rules.minDamageFactor);
    const direction = arrowDirection({ velocity });
    const flat = speedOf({ x: direction.x, y: 0, z: direction.z });
    // The template's impulse is authored facing along the flight (+z forward, +y up).
    const aim =
      flat === 0 ? { x: 0, y: 0, z: 1 } : { x: direction.x / flat, y: 0, z: direction.z / flat };
    const impulse = rotateToWorld(def.damage.impulse, aim);
    return options.damage.apply(world, target, {
      instigator: arrow.flight.shooter,
      source: arrow.entity,
      amounts: scaleDamage(def.damage.amounts, factor),
      poiseDamage: def.damage.poiseDamage * factor,
      staminaDamage: def.damage.staminaDamage * factor,
      impulse: { x: impulse.x * factor, y: impulse.y * factor, z: impulse.z * factor },
      impactForce: def.damage.impactForce * factor,
      direction,
      region: hurtbox.region,
      regionMultiplier: hurtbox.multiplier,
      ...(hurtbox.armor !== undefined && { armor: hurtbox.armor }),
      penetration: def.penetration,
      // A blunt head ignores deflection but deals half to armour (mw-e05.6).
      tags: def.onImpact === 'bounce' ? [...def.damage.tags, DAMAGE_TAGS.blunt] : def.damage.tags,
    });
  }

  function rest(
    world: World<never>,
    arrow: Flying,
    state: ArrowRestState,
    contact: Contact,
    intact: boolean,
  ): void {
    world.remove(arrow.entity, ArrowComponent);
    const host =
      contact.other === null || !world.isRegistered(PlacementComponent)
        ? undefined
        : world.get(contact.other, PlacementComponent);
    const { point } = contact;
    world.add(
      arrow.entity,
      ArrowRestComponent,
      Object.freeze({
        arrow: arrow.flight.arrow,
        shooter: arrow.flight.shooter,
        state,
        position: frozen(point),
        direction: frozen(arrowDirection({ velocity: arrow.velocity })),
        in: contact.other,
        tick: world.tick,
        intact,
        ...(host !== undefined && {
          local: frozen({ x: point.x - host.x, y: point.y - host.y, z: point.z - host.z }),
        }),
      }),
    );
    world.events.emit(ArrowRested, {
      tick: world.tick,
      entity: arrow.entity,
      arrow: arrow.flight.arrow,
      state,
      intact,
      in: contact.other,
      position: frozen(point),
    });
  }

  /** Resolves `arrow` striking `contact` (see the file header). */
  function impact(world: World<never>, arrow: Flying, contact: Contact): void {
    const { def, flight, velocity } = arrow;
    const { other, hurtbox } = contact;
    const hardness: SurfaceHardness =
      other === null
        ? WORLD_PROPERTY_SPECS.surfaceHardness.default
        : readProperty(world, other, 'surfaceHardness');
    const material =
      other === null
        ? WORLD_PROPERTY_SPECS.material.default
        : readProperty(world, other, 'material');
    let outcome: ArrowImpactOutcome;
    let after: Vec3 = { x: 0, y: 0, z: 0 };
    let damage: DamageResult | undefined;
    const hitCreature = hurtbox !== undefined && other !== null;
    // Armour the arrow cannot pierce turns it away (mw-e05.6); a blunt head is never turned away.
    const armor = hurtbox?.armor ?? 0;
    const deflected =
      hitCreature && def.onImpact !== 'bounce' && armor > 0 && def.penetration < armor;
    if (flight.spent) {
      outcome = 'drop';
    } else if (def.onImpact === 'shatter') {
      outcome = 'shatter';
    } else if (def.onImpact === 'stick' && !deflected && penetrates(def.penetration, hardness)) {
      outcome = 'stick';
    } else {
      after = ricochet(velocity, contact.normal, rules.ricochetSpeedFactor);
      outcome = speedOf(after) < rules.minRicochetSpeed ? 'drop' : 'ricochet';
    }
    // Whether this impact brings the arrow to rest, and if so whether it is whole (mw-e05.7).
    const rests =
      outcome === 'stick' ||
      (outcome === 'drop' &&
        (flight.spent || (!hitCreature && contact.normal.y >= GROUND_NORMAL_Y)));
    const intact = rests ? landsIntact(world, arrow, other, hardness) : undefined;
    // Blunt heads hurt without penetrating; a sticking head that fails to penetrate glances off.
    if (
      hitCreature &&
      outcome !== 'drop' &&
      (outcome !== 'ricochet' || def.onImpact === 'bounce' || deflected)
    ) {
      damage = strike(world, arrow, other, hurtbox);
    }
    const lost = { x: velocity.x - after.x, y: velocity.y - after.y, z: velocity.z - after.z };
    const mass = def.massGrams / 1000;
    const speed = speedOf(velocity);
    const impulse = mass * speedOf(lost);
    world.events.emit(arrowImpact, {
      tick: world.tick,
      entity: arrow.entity,
      arrow: flight.arrow,
      shooter: flight.shooter,
      other,
      material,
      hardness,
      outcome,
      ...(intact !== undefined && { intact }),
      speed,
      energy: 0.5 * mass * speed * speed,
      impulse,
      normal: frozen(contact.normal),
      position: frozen(contact.point),
      ...(hurtbox !== undefined && { hurtbox: hurtbox.id, region: hurtbox.region }),
      ...(damage !== undefined && { damage }),
    });
    if (
      other !== null &&
      !hitCreature &&
      impulse > 0 &&
      world.isRegistered(StimulusQueueComponent)
    ) {
      applyStimulus(world, {
        shape: { kind: 'contact', target: other },
        element: 'force',
        intensity: impulse,
        direction: lost,
        source: flight.shooter,
      });
    }
    if (other !== null && !hitCreature && world.isRegistered(StimulusQueueComponent)) {
      applyStimulus(world, {
        shape: { kind: 'contact', target: other },
        element: def.onImpact === 'bounce' ? 'blunt' : 'pierce',
        intensity: 0.5 * mass * speed * speed,
        source: flight.shooter,
      });
    }
    const flyOn = (spent: boolean) => {
      const { x, y, z } = contact.normal;
      const position = {
        x: contact.point.x + x * SEPARATION,
        y: contact.point.y + y * SEPARATION,
        z: contact.point.z + z * SEPARATION,
      };
      const next: ArrowFlight = {
        arrow: flight.arrow,
        shooter: flight.shooter,
        launchSpeed: flight.launchSpeed,
        position: frozen(position),
        velocity: frozen(after),
        flown: arrow.flown,
        spent,
        ...(arrow.dodged.length > 0 && { dodged: Object.freeze([...arrow.dodged]) }),
        // A ricochet cannot catch what it glanced off while still touching it (see ArrowFlight).
        ...(hitCreature && { glanced: other }),
      };
      world.set(arrow.entity, ArrowComponent, Object.freeze(next));
    };
    switch (outcome) {
      case 'shatter':
        world.destroy(arrow.entity);
        return;
      case 'stick':
        rest(world, arrow, 'stuck', contact, intact === true);
        return;
      case 'ricochet':
        flyOn(false);
        return;
      case 'drop':
        if (rests) {
          rest(world, arrow, 'dropped', contact, intact === true);
        } else {
          flyOn(true);
        }
        return;
    }
  }

  return {
    name: 'arrows',
    run: ({ world, clock }) => {
      const w: World<never> = world;
      const arrows = w.query(ArrowComponent);
      if (arrows.ids().length === 0) return;
      const dt = 1 / clock.hz;
      const lifetime = Math.round(rules.lifetimeSeconds * clock.hz);
      // Hurtboxes are placed once per tick, and only when some arrow can hit them.
      let targets: HurtboxTargets | undefined;
      arrows.forEach((entity, flight) => {
        const def = lookup(options.arrows, flight.arrow);
        const flown = flight.flown + 1;
        const next = integrateFlight(flight, def.dragK / (def.massGrams / 1000), rules.gravity, dt);
        const from = flight.position;
        const to = next.position;
        const passed = flight.dodged ?? [];
        const arrow: Flying = {
          entity,
          flight,
          def,
          flown,
          velocity: next.velocity,
          dodged: passed,
        };
        const level =
          options.collision === undefined ? undefined : castSegment(options.collision, from, to);
        const length = speedOf({ x: to.x - from.x, y: to.y - from.y, z: to.z - from.z });
        const limit = level === undefined ? Infinity : level.distance / length;
        let hits: readonly SegmentHurtboxHit[] = [];
        if (!flight.spent) {
          targets ??= hurtboxTargets(w);
          const selfImmune = flown <= rules.selfImmuneTicks;
          hits = segmentHurtboxHits(
            targets,
            { from, to, radius: rules.radius },
            (target) => (target === flight.shooter && selfImmune) || passed.includes(target),
          );
        }
        const dodgedNow: EntityId[] = [];
        const direction = arrowDirection(next);
        for (const hit of hits) {
          if (hit.fraction > limit) break;
          const { entity: target, hurtbox } = hit;
          if (hit.fraction === 0 && target === flight.glanced) continue;
          if (invulnerable(w, target)) {
            w.events.emit(DodgedHit, {
              tick: w.tick,
              attacker: flight.shooter ?? entity,
              hitbox: flight.arrow,
              activeTick: flown,
              target,
              hurtbox: hurtbox.id,
              region: hurtbox.region,
              multiplier: hurtbox.multiplier,
              armored: hurtbox.armored,
              direction,
            });
            dodgedNow.push(target);
            continue;
          }
          const point = lerp(from, to, hit.fraction);
          const back = { x: -direction.x, y: -direction.y, z: -direction.z };
          const normal = surfaceNormal(hit.shape, point, back);
          impact(w, withDodged(arrow, dodgedNow), { point, normal, other: target, hurtbox });
          return;
        }
        if (level !== undefined) {
          const contact = {
            point: level.point,
            normal: level.normal,
            other: surfaceOf(w, level.body),
          };
          impact(w, withDodged(arrow, dodgedNow), contact);
          return;
        }
        if (flown >= lifetime) {
          w.events.emit(ArrowExpired, {
            tick: w.tick,
            entity,
            arrow: flight.arrow,
            position: frozen(to),
          });
          w.destroy(entity);
          return;
        }
        const moved: ArrowFlight = {
          ...flight,
          position: frozen(to),
          velocity: frozen(next.velocity),
          flown,
          ...(dodgedNow.length > 0 && {
            dodged: Object.freeze([...passed, ...dodgedNow].sort((a, b) => a - b)),
          }),
        };
        w.set(entity, ArrowComponent, Object.freeze(moved));
      });
    },
  };
}

/** `arrow` with `dodgedNow` added to the targets it has flown through. */
function withDodged(arrow: Flying, dodgedNow: readonly EntityId[]): Flying {
  if (dodgedNow.length === 0) return arrow;
  return { ...arrow, dodged: [...arrow.dodged, ...dodgedNow].sort((a, b) => a - b) };
}

/**
 * Wires arrows into `world`: registers ARROW_COMPONENTS and appends the arrow system. Register the
 * world properties, placement, hit-volume and damage components first (and stimuli, for impacts to
 * push what they hit). Call at setup, outside a step.
 */
export function installArrows<TInput>(world: World<TInput>, options: ArrowSystemOptions): void {
  world.register(...ARROW_COMPONENTS);
  world.addSystem(arrowSystem(options));
}
