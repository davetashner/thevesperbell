// Projectile spells (mw-e06.6): a spell whose delivery is `projectile` flies as a physical thing
// until it strikes, expires or runs out of range, and the spell pipeline's ops run where it lands.
//
//   cast ──► launch ──► (each tick) integrate → sweep the level → sweep hurtboxes ──► land / strike
//
// - Launch: the delivery handler needs the request's `aim` — a world POINT the caster aims at. A
//   straight bolt (gravity 0) flies at it; a lobbed one (gravity > 0) takes the low arc that reaches
//   it at the spell's speed, or 45° (the farthest reach) when the point is out of range. The shot
//   starts `muzzleHeight` above the caster's placement. The delivery stays `pending`; the
//   `magic.projectile` component on the delivery entity holds the flight.
// - Flight: constant gravity is integrated exactly (p += v·dt + ½·a·dt²), so a lob lands where
//   ballistics says it does rather than a Euler step's fraction of a tick early. The path from one
//   tick to the next is SWEPT, never sampled: the level with the projectile's own radius through the
//   collision world's capsule sweep (so a fast bolt cannot tunnel a thin wall), creatures through
//   `segmentHurtboxHits`, the same query arrows use. The nearer of a wall and a creature wins.
// - Creature: `pierce` creatures are struck (the spell's effects apply to each through
//   `pipeline.strike`) and flown through, once each; the next creature, or any wall, is the impact.
// - Wall: `bounce` walls are rebounded off (speed × restitution, no effects); the next one is the
//   impact. A wall bound to an entity (a crate, a door) is the hit's target; level geometry is a
//   bare point.
// - Impact: effects apply to the thing struck and, with `impactRadius`, to every other placed entity
//   within that many metres (the caster excluded) via `pipeline.land`, ending the delivery.
// - Expiry: when `lifetime` or `maxRange` runs out, the delivery's `onExpire` ops apply at its
//   position and the delivery ends (with none, it ends as a fizzle, `delivery-ended`).
// - Trail: a `trail` leaves a stimulus capsule along every tick's swept path, so a heat trail ignites
//   whatever flammable thing it passes (stimulus rules decide what that does).
//
// Homing is out of scope (a later spell). The caster cannot be hit by their own bolt for its first
// half second, so a shot leaves a hand that overlaps its own hurtboxes.

import type { EntityId } from '../core/component';
import { defineComponent } from '../core/component';
import { defineEvent } from '../core/events';
import type { System, World } from '../core/world';
import type { CollisionHit, CollisionWorld } from '../character/collision-world';
import { ricochet, speedOf } from '../combat/arrows/ballistics';
import { physicsSurfaceOf, type SurfaceRule } from '../combat/arrows/system';
import {
  hurtboxTargets,
  noInvulnerability,
  segmentHurtboxHits,
  type HurtboxTargets,
  type InvulnerabilityRule,
} from '../combat/hits/system';
import { PlacementComponent, placementOf } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { applyStimulus } from '../stimulus/stimulus';
import type { SpellPipeline } from './pipeline';
import type { DeliveryContext, DeliveryHit, DeliveryResult } from './registry';

/** A projectile spell in flight (`magic.projectile`, on the delivery entity). Plain data. */
export interface SpellProjectile {
  readonly spell: string;
  readonly caster: EntityId;
  /** Centre of the projectile, metres. */
  readonly position: Vec3;
  /** Metres per second. */
  readonly velocity: Vec3;
  /** Ticks flown. */
  readonly flown: number;
  /** Metres flown (against `maxRange`). */
  readonly travelled: number;
  readonly bouncesLeft: number;
  readonly pierceLeft: number;
  /** Creatures already struck or flown through, ascending: never struck twice. */
  readonly struck: readonly EntityId[];
}
export const SpellProjectileComponent = defineComponent<SpellProjectile>('magic.projectile');

/** A projectile rebounded off a wall (render: a spark; audio: a ricochet). */
export interface SpellProjectileBouncedInfo {
  readonly tick: number;
  readonly delivery: EntityId;
  readonly caster: EntityId;
  readonly spell: string;
  readonly point: Vec3;
  readonly normal: Vec3;
  /** Bounces it has left after this one. */
  readonly left: number;
}
export const SpellProjectileBounced =
  defineEvent<SpellProjectileBouncedInfo>('SpellProjectileBounced');

export interface SpellProjectileOptions {
  /** The level projectiles hit (RapierCollisionWorld in the game); omitted, they meet no level. */
  readonly collision?: CollisionWorld;
  /** Who is flown through this tick (dodge i-frames); defaults to nobody. */
  readonly invulnerable?: InvulnerabilityRule;
  /** Which entity a level collider belongs to; defaults to the arrows' `physicsSurfaceOf`. */
  readonly surfaceOf?: SurfaceRule;
  /** Metres above the caster's placement a shot starts at (chest height); default 1.2. */
  readonly muzzleHeight?: number;
  /** Seconds the caster cannot hit themselves with their own bolt; default 0.5. */
  readonly selfImmuneSeconds?: number;
}

/** Gap a rebounding projectile keeps from the wall it leaves, metres. */
const SEPARATION = 1e-4;
const DEFAULT_MUZZLE_HEIGHT = 1.2;
const DEFAULT_SELF_IMMUNE_SECONDS = 0.5;

/**
 * Launch velocity from `from` toward the point `aim` at `speed` under `gravity`: straight for
 * gravity 0 (or a point straight above/below), else the low arc reaching the point, else 45°
 * (farthest reach) when it cannot. Undefined when `aim` is `from`. Only + − × ÷ and sqrt.
 */
export function launchVelocity(
  from: Vec3,
  aim: Vec3,
  speed: number,
  gravity: number,
): Vec3 | undefined {
  const dx = aim.x - from.x;
  const dy = aim.y - from.y;
  const dz = aim.z - from.z;
  const flat = Math.sqrt(dx * dx + dz * dz);
  const length = Math.sqrt(flat * flat + dy * dy);
  if (length === 0) return undefined;
  if (gravity === 0 || flat === 0) {
    const k = speed / length;
    return { x: dx * k, y: dy * k, z: dz * k };
  }
  const s2 = speed * speed;
  const disc = s2 * s2 - gravity * (gravity * flat * flat + 2 * dy * s2);
  const tan = disc < 0 ? 1 : (s2 - Math.sqrt(disc)) / (gravity * flat);
  const cos = 1 / Math.sqrt(1 + tan * tan);
  const along = (speed * cos) / flat;
  return { x: dx * along, y: speed * tan * cos, z: dz * along };
}

const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});

/** Every placed entity within `radius` of `point` (by its own radius), ascending id, minus `skip`. */
function withinRadius(
  world: World<never>,
  point: Vec3,
  radius: number,
  skip: readonly (EntityId | null)[],
): DeliveryHit[] {
  const found: [EntityId, DeliveryHit][] = [];
  world.query(PlacementComponent).forEach((entity, at) => {
    if (skip.includes(entity)) return;
    const dx = at.x - point.x;
    const dy = at.y - point.y;
    const dz = at.z - point.z;
    const reach = radius + at.radius;
    if (dx * dx + dy * dy + dz * dz <= reach * reach) {
      found.push([entity, { target: entity, point: { x: at.x, y: at.y, z: at.z } }]);
    }
  });
  return found.sort((a, b) => a[0] - b[0]).map(([, hit]) => hit);
}

/**
 * Wires projectile spells into a world that has `installSpells`: registers the component, the
 * `projectile` delivery on `pipeline`, and the flight system. Add it before `stimulusSystem` so a
 * trail's stimuli resolve in the tick they are laid. Call once at setup, outside a step.
 */
export function installSpellProjectiles<TInput>(
  world: World<TInput>,
  pipeline: SpellPipeline,
  options: SpellProjectileOptions = {},
): void {
  const muzzleHeight = options.muzzleHeight ?? DEFAULT_MUZZLE_HEIGHT;
  const selfImmuneSeconds = options.selfImmuneSeconds ?? DEFAULT_SELF_IMMUNE_SECONDS;
  const invulnerable = options.invulnerable ?? noInvulnerability;
  const surfaceOf = options.surfaceOf ?? physicsSurfaceOf;
  world.register(SpellProjectileComponent);

  pipeline.deliveries.register(
    'projectile',
    (ctx: DeliveryContext<'projectile'>): DeliveryResult => {
      const { world: w, request, delivery, entity, spell } = ctx;
      if (request.aim === undefined) return { kind: 'fizzle', reason: 'no-aim' };
      const at = placementOf(w, request.caster);
      if (at === undefined) return { kind: 'fizzle', reason: 'no-position' };
      if (!delivery.onExpire.every((op) => pipeline.ops.has(op.op))) {
        return { kind: 'fizzle', reason: 'unsupported-op' };
      }
      const origin = { x: at.x, y: at.y + muzzleHeight, z: at.z };
      const velocity = launchVelocity(origin, request.aim, delivery.speed, delivery.gravity);
      if (velocity === undefined) return { kind: 'fizzle', reason: 'no-aim' };
      const flight: SpellProjectile = {
        spell: spell.id,
        caster: request.caster,
        position: origin,
        velocity,
        flown: 0,
        travelled: 0,
        bouncesLeft: delivery.bounce,
        pierceLeft: delivery.pierce,
        struck: [],
      };
      w.add(entity, SpellProjectileComponent, flight);
      return { kind: 'pending' };
    },
  );

  const system: System<TInput> = {
    name: 'spell-projectiles',
    run: ({ world: sim, clock }) => {
      const w: World<never> = sim;
      const flying = w.query(SpellProjectileComponent);
      if (flying.ids().length === 0) return;
      const dt = 1 / clock.hz;
      const immuneTicks = Math.round(selfImmuneSeconds * clock.hz);
      let targets: HurtboxTargets | undefined;

      flying.forEach((entity, p) => {
        const spell = pipeline.spells(p.spell);
        const def = spell?.delivery;
        if (def?.kind !== 'projectile') {
          pipeline.cancel(w, entity);
          return;
        }
        const flown = p.flown + 1;
        const from = p.position;
        const v = p.velocity;
        let to: Vec3 = {
          x: from.x + v.x * dt,
          y: from.y + v.y * dt - 0.5 * def.gravity * dt * dt,
          z: from.z + v.z * dt,
        };
        const velocity: Vec3 = { x: v.x, y: v.y - def.gravity * dt, z: v.z };
        let length = speedOf({ x: to.x - from.x, y: to.y - from.y, z: to.z - from.z });
        const remaining = def.maxRange - p.travelled;
        const rangeEnd = length >= remaining;
        if (rangeEnd) {
          to = lerp(from, to, remaining / length);
          length = remaining;
        }

        // The level, swept with the projectile's own radius.
        let wall: CollisionHit | undefined;
        if (options.collision !== undefined && length > 0) {
          const dir = {
            x: (to.x - from.x) / length,
            y: (to.y - from.y) / length,
            z: (to.z - from.z) / length,
          };
          wall = options.collision.sweepCapsule(
            { radius: def.radius, height: 2 * def.radius },
            { x: from.x, y: from.y - def.radius, z: from.z },
            dir,
            length,
          );
        }
        const limit = wall === undefined ? Infinity : wall.distance / length;
        const end = wall === undefined ? to : lerp(from, to, limit);

        if (def.trail !== undefined) {
          applyStimulus(w, {
            shape: { kind: 'capsule', from, to: end, radius: def.trail.radius },
            element: def.trail.element,
            intensity: def.trail.intensity * dt,
            source: p.caster,
          });
        }

        // Creatures along the path, nearest first.
        targets ??= hurtboxTargets(w);
        const selfImmune = flown <= immuneTicks;
        const hits = segmentHurtboxHits(
          targets,
          { from, to, radius: def.radius },
          (target) => (target === p.caster && selfImmune) || p.struck.includes(target),
        );
        const struck = [...p.struck];
        let pierceLeft = p.pierceLeft;
        for (const hit of hits) {
          if (hit.fraction > limit) break;
          struck.push(hit.entity);
          if (invulnerable(w, hit.entity)) continue;
          const point = lerp(from, to, hit.fraction);
          if (pierceLeft > 0) {
            pierceLeft--;
            pipeline.strike(w, entity, [{ target: hit.entity, point }]);
            continue;
          }
          const area = withinRadius(w, point, def.impactRadius, [p.caster, ...struck]);
          pipeline.land(w, entity, [
            { target: hit.entity, point },
            ...(def.impactRadius > 0 ? area : []),
          ]);
          return;
        }

        struck.sort((a, b) => a - b);
        if (wall !== undefined) {
          if (p.bouncesLeft > 0) {
            const { normal } = wall;
            const bounced = ricochet(velocity, normal, def.restitution);
            const position = {
              x: end.x + normal.x * SEPARATION,
              y: end.y + normal.y * SEPARATION,
              z: end.z + normal.z * SEPARATION,
            };
            w.events.emit(SpellProjectileBounced, {
              tick: w.tick,
              delivery: entity,
              caster: p.caster,
              spell: p.spell,
              point: wall.point,
              normal,
              left: p.bouncesLeft - 1,
            });
            w.set(entity, SpellProjectileComponent, {
              ...p,
              position,
              velocity: bounced,
              flown,
              travelled: p.travelled + wall.distance,
              bouncesLeft: p.bouncesLeft - 1,
              pierceLeft,
              struck,
            });
            return;
          }
          const point = wall.point;
          const target = surfaceOf(w, wall.body);
          const area = withinRadius(w, point, def.impactRadius, [p.caster, target, ...struck]);
          pipeline.land(w, entity, [{ target, point }, ...(def.impactRadius > 0 ? area : [])]);
          return;
        }

        if (rangeEnd || flown >= Math.round(def.lifetime * clock.hz)) {
          if (def.onExpire.length > 0) {
            pipeline.strike(w, entity, [{ target: null, point: to }], def.onExpire);
            pipeline.land(w, entity, []);
          } else {
            pipeline.cancel(w, entity);
          }
          return;
        }
        w.set(entity, SpellProjectileComponent, {
          ...p,
          position: to,
          velocity,
          flown,
          travelled: p.travelled + length,
          pierceLeft,
          struck,
        });
      });
    },
  };
  world.addSystem(system);
}
