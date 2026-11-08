// Fall, crush and hazard damage (mw-e04.19, with mw-e02.15's fall damage): the world as a weapon for
// every class. Each source turns its physical quantity into a DamagePacket tagged `environment` and
// resolves it through the damage model, so resistances, armor, difficulty, hit reactions and death
// treat a shove off a bridge exactly like a sword. The numbers come from content
// (src/content/data/environment-damage).
//
// - Falls: every CharacterImpacted (a landing, or a launched character striking a wall) costs a
//   share of max health from its equivalent drop height (speed² / 2g): none up to fall.safeHeight,
//   rising linearly to all of it at fall.lethalHeight. The surface's impactAbsorb takes off its
//   share (hay 0.8 → 80% less), and landing in liquid at least fall.deepWater deep costs nothing.
//   Blunt damage, tagged `fall` (and `wall` for a wall strike); the instigator is whoever launched
//   the character (null for a plain fall), the source the surface's entity.
// - Kinetic impacts: a physics object whose bounding sphere starts touching a creature's capsule at a
//   relative speed above kinetic.minSpeed deals blunt ½·m·v² / kinetic.joulesPerPoint, with its
//   momentum as the impulse (so hit reactions knock the creature about) and m·v per tick as the
//   impact force. One strike per contact: the pair must separate before it can strike again. The
//   instigator is whoever the object is blamed on.
// - Hazards: an entity whose hazard property is true (burning) hurts every creature whose capsule
//   overlaps its placement sphere grown by the hazard's reach, perSecond in pulses of pulseMs. The
//   instigator is whoever the hazard is blamed on.
//
// Blame (instigator chains, for credit and AI blame): an entity's `combat.blame` names who set it
// going. A force stimulus with a source blames its source on the objects it pushes, a `suspended`
// object let go by someone (a cut rope) blames them, and a hazard property switched on by someone (a
// torch lighting a haystack) blames them; other rules call `blame` directly. A physics object's blame
// lapses when it comes to rest (its body sleeps), a hazard's when the property switches off.
//
// Creatures are the entities with Health and a CharacterController: their feet position and velocity
// come from the controller, their capsule from the options (the controller tuning's).

import type { EnvironmentDamageTuning, Frozen } from '@content/index';
import type { Capsule } from '../../character/collision-world';
import {
  CharacterImpacted,
  CharacterController,
  type CharacterImpactInfo,
} from '../../character/system';
import { defineComponent, type EntityId } from '../../core/component';
import type { System, World } from '../../core/world';
import { boundingRadius } from '../../physics/bodies';
import {
  PhysicsColliderComponent,
  PhysicsObjectComponent,
  rigidBodiesOf,
} from '../../physics/objects';
import type { ColliderHandle } from '../../physics/static-colliders';
import {
  forEachWithProperty,
  hasProperty,
  propertyChanged,
  readProperty,
} from '../../properties/components';
import { PlacementComponent } from '../../stimulus/placement';
import type { Vec3 } from '../../stimulus/shapes';
import { applyStimulus, impulseApplied } from '../../stimulus/stimulus';
import { HealthComponent } from '../damage/components';
import type { DamageModel } from '../damage/model';
import { DAMAGE_TAGS } from '../damage/packet';
import type { DamageAmounts, DamageType } from '../damage/types';

/** Tags environmental packets carry besides `environment`. */
export const ENVIRONMENT_TAGS = Object.freeze({
  /** A landing or a launched character striking a wall. */
  fall: 'fall',
  /** With `fall`: the impact was a launched character striking a wall, not a landing. */
  wall: 'wall',
  /** A physics object striking a creature. */
  crush: 'crush',
  /** A hazard volume (fire). */
  hazard: 'hazard',
} as const);

/** Who an entity's harm is blamed on (`combat.blame`; a snapshot and save key, never renamed). */
export interface Blame {
  readonly instigator: EntityId;
}

export const BlameComponent = defineComponent<Blame>('combat.blame');

/** Object–creature pairs in contact as of the last tick (`combat.environment-contacts`). */
export interface EnvironmentContacts {
  /** [object, creature], sorted. */
  readonly contacts: readonly (readonly [EntityId, EntityId])[];
}

export const EnvironmentContactsComponent = defineComponent<EnvironmentContacts>(
  'combat.environment-contacts',
);

/** Blames `entity`'s harm on `instigator`, or clears its blame (null). Structural (end of tick). */
export function blame(world: World<never>, entity: EntityId, instigator: EntityId | null): void {
  if (instigator === null) world.remove(entity, BlameComponent);
  else world.add(entity, BlameComponent, Object.freeze({ instigator }));
}

/** Who `entity`'s harm is blamed on, or null. */
export function blameOf(world: World<never>, entity: EntityId): EntityId | null {
  return world.get(entity, BlameComponent)?.instigator ?? null;
}

type FallRules = Frozen<EnvironmentDamageTuning>['fall'];
type KineticRules = Frozen<EnvironmentDamageTuning>['kinetic'];
type HazardRule = Frozen<EnvironmentDamageTuning>['hazards'][number];

/** Share of max health (0–1) a drop of `height` metres costs (see the file header). */
export function fallDamageFraction(height: number, fall: FallRules): number {
  if (height <= fall.safeHeight) return 0;
  if (height >= fall.lethalHeight) return 1;
  return (height - fall.safeHeight) / (fall.lethalHeight - fall.safeHeight);
}

/** Blunt damage of a `mass` kg object striking at `speed` m/s; 0 at or below kinetic.minSpeed. */
export function kineticDamage(mass: number, speed: number, kinetic: KineticRules): number {
  return speed > kinetic.minSpeed ? (0.5 * mass * speed * speed) / kinetic.joulesPerPoint : 0;
}

/** The entity owning collider `body` (a physics object or a bound collider), or null. */
export type SurfaceReader = (world: World<never>, body: number) => EntityId | null;

/** Surfaces from the physics-object layer (its components must be registered). */
export const physicsSurface: SurfaceReader = (world, body) => {
  let owner: EntityId | null = null;
  world.query(PhysicsObjectComponent).forEach((entity, object) => {
    if (object.body === body) owner = entity;
  });
  world.query(PhysicsColliderComponent).forEach((entity, { colliders }) => {
    if (colliders.includes(body)) owner = entity;
  });
  return owner;
};

/** Depth of liquid over `feet` where `entity` landed, metres (0 when dry). */
export type LiquidDepthReader = (world: World<never>, entity: EntityId, feet: Vec3) => number;

/** No liquids (until water volumes exist). */
export const noLiquid: LiquidDepthReader = () => 0;

/** What the fall rules need. */
export interface FallDamageOptions {
  readonly damage: DamageModel;
  readonly fall: FallRules;
  /** Defaults to `physicsSurface`. */
  readonly surface?: SurfaceReader;
  /** Defaults to `noLiquid`. */
  readonly liquidDepth?: LiquidDepthReader;
}

/**
 * The damage one impact deals (see the file header), applied through the damage model. Returns the
 * points of blunt damage asked for (0: none, and nothing is applied).
 */
export function resolveFall(
  world: World<never>,
  impact: CharacterImpactInfo,
  options: FallDamageOptions,
): number {
  const { entity } = impact;
  const health = world.get(entity, HealthComponent);
  if (health === undefined) return 0;
  const liquid = (options.liquidDepth ?? noLiquid)(world, entity, impact.position);
  if (impact.kind === 'ground' && liquid >= options.fall.deepWater) return 0;
  const fraction = fallDamageFraction(impact.height, options.fall);
  if (fraction === 0) return 0;
  const surface = (options.surface ?? physicsSurface)(world, impact.body);
  const absorb = surface === null ? 0 : readProperty(world, surface, 'impactAbsorb');
  const blunt = health.max * fraction * (1 - absorb);
  if (blunt <= 0) return 0;
  options.damage.apply(world, entity, {
    amounts: { blunt },
    instigator: impact.launch?.source ?? null,
    source: surface,
    direction: impact.normal,
    tags:
      impact.kind === 'wall'
        ? [DAMAGE_TAGS.environment, ENVIRONMENT_TAGS.fall, ENVIRONMENT_TAGS.wall]
        : [DAMAGE_TAGS.environment, ENVIRONMENT_TAGS.fall],
  });
  return blunt;
}

/** What a launched creature striking something fragile needs. */
export interface FragileStrikeOptions {
  readonly damage: DamageModel;
  readonly kinetic: KineticRules;
  /** Defaults to `physicsSurface`. */
  readonly surface?: SurfaceReader | undefined;
}

/**
 * A launched creature (a spell's push, a blast) that strikes a fragile thing at kinetic.minSpeed or
 * more breaks it and is hurt by it (mw-e06.8): its own kinetic energy ½·m·v² goes into the thing as a
 * blunt stimulus, which breakables read, and it takes the thing's kinetic damage (the same
 * `kineticDamage` an object striking a creature deals, by the thing's mass). Anything with the
 * `fragile` property counts; nothing here names what it is. Returns the blunt damage asked for.
 */
export function resolveFragileStrike(
  world: World<never>,
  impact: CharacterImpactInfo,
  options: FragileStrikeOptions,
): number {
  if (impact.kind !== 'wall' || impact.launch === null) return 0;
  const struck = (options.surface ?? physicsSurface)(world, impact.body);
  if (struck === null || !hasProperty(world, struck, 'fragile')) return 0;
  const blunt = kineticDamage(readProperty(world, struck, 'weight'), impact.speed, options.kinetic);
  if (blunt === 0) return 0;
  const mass = readProperty(world, impact.entity, 'weight');
  applyStimulus(world, {
    shape: { kind: 'contact', target: struck },
    element: 'blunt',
    intensity: 0.5 * mass * impact.speed * impact.speed,
    source: impact.launch.source,
  });
  options.damage.apply(world, impact.entity, {
    amounts: { blunt },
    instigator: impact.launch.source,
    source: struck,
    direction: impact.normal,
    tags: [DAMAGE_TAGS.environment, ENVIRONMENT_TAGS.crush],
  });
  return blunt;
}

/** A creature this tick: feet, velocity, alive. */
interface Creature {
  readonly entity: EntityId;
  readonly feet: Vec3;
  readonly velocity: Vec3;
}

function creaturesOf(world: World<never>): Creature[] {
  const found: Creature[] = [];
  world.query(CharacterController, HealthComponent).forEach((entity, character, health) => {
    if (health.current > 0) {
      found.push({ entity, feet: character.position, velocity: character.velocity });
    }
  });
  return found;
}

/** Whether a sphere (centre, radius) overlaps a vertical capsule standing on `feet`. */
export function sphereTouchesCapsule(
  centre: Vec3,
  radius: number,
  feet: Vec3,
  capsule: Capsule,
): boolean {
  const low = feet.y + capsule.radius;
  const high = feet.y + Math.max(capsule.radius, capsule.height - capsule.radius);
  const y = Math.min(high, Math.max(low, centre.y));
  const dx = centre.x - feet.x;
  const dy = centre.y - y;
  const dz = centre.z - feet.z;
  const reach = radius + capsule.radius;
  return dx * dx + dy * dy + dz * dz <= reach * reach;
}

/** What the kinetic-impact rules need. */
export interface KineticDamageOptions {
  readonly damage: DamageModel;
  readonly kinetic: KineticRules;
  /** The creatures' capsule (the controller tuning's). */
  readonly capsule: Capsule;
}

const pairOrder = (a: readonly [number, number], b: readonly [number, number]): number =>
  a[0] - b[0] || a[1] - b[1];

/**
 * The kinetic-impact system (see the file header). Needs physics objects installed and one
 * EnvironmentContactsComponent entity (installEnvironmentDamage creates it); run it after the
 * physics-object system so poses are this tick's.
 */
export function kineticImpactSystem<TInput>(options: KineticDamageOptions): System<TInput> {
  const { damage, kinetic, capsule } = options;
  return {
    name: 'environment-kinetic',
    run: ({ world: w, clock }) => {
      const world: World<never> = w;
      let memory: EntityId | undefined;
      let before: EnvironmentContacts['contacts'] = [];
      world.query(EnvironmentContactsComponent).forEach((entity, { contacts }) => {
        memory = entity;
        before = contacts;
      });
      if (memory === undefined) return;
      const touching = new Set(before.map(([o, c]) => `${String(o)}:${String(c)}`));
      const port = rigidBodiesOf(world);
      const creatures = creaturesOf(world);
      const contacts: (readonly [EntityId, EntityId])[] = [];
      world.query(PhysicsObjectComponent).forEach((object, body) => {
        if (body.sleeping) {
          if (world.has(object, BlameComponent)) blame(world, object, null);
          return;
        }
        const radius = boundingRadius(body.shape);
        for (const creature of creatures) {
          if (!sphereTouchesCapsule(body.position, radius, creature.feet, capsule)) continue;
          contacts.push([object, creature.entity]);
          if (touching.has(`${String(object)}:${String(creature.entity)}`)) continue;
          const { linvel, mass } = port.motionOf(body.body as ColliderHandle);
          const rel = {
            x: linvel.x - creature.velocity.x,
            y: linvel.y - creature.velocity.y,
            z: linvel.z - creature.velocity.z,
          };
          const speed = Math.sqrt(rel.x * rel.x + rel.y * rel.y + rel.z * rel.z);
          const blunt = kineticDamage(mass, speed, kinetic);
          if (blunt === 0) continue;
          damage.apply(world, creature.entity, {
            amounts: { blunt },
            instigator: blameOf(world, object),
            source: object,
            impulse: { x: rel.x * mass, y: rel.y * mass, z: rel.z * mass },
            impactForce: mass * speed * clock.hz,
            direction: { x: rel.x / speed, y: rel.y / speed, z: rel.z / speed },
            tags: [DAMAGE_TAGS.environment, ENVIRONMENT_TAGS.crush],
          });
        }
      });
      contacts.sort(pairOrder);
      world.set(memory, EnvironmentContactsComponent, Object.freeze({ contacts }));
    },
  };
}

/** What the hazard rules need. */
export interface HazardDamageOptions {
  readonly damage: DamageModel;
  readonly hazards: readonly HazardRule[];
  /** The creatures' capsule (the controller tuning's). */
  readonly capsule: Capsule;
}

/** A hazard's damage for one pulse of `seconds`. */
function pulseAmounts(rule: HazardRule, seconds: number): DamageAmounts {
  const amounts: Partial<Record<DamageType, number>> = {};
  for (const [type, perSecond] of Object.entries(rule.perSecond)) {
    amounts[type as DamageType] = perSecond * seconds;
  }
  return amounts;
}

/**
 * The hazard system (see the file header): on every pulse tick (world tick a multiple of the
 * pulse), each creature inside one or more hazards of a rule takes one pulse of its damage, sourced
 * by the lowest-id hazard it is in. Needs world properties and placements registered.
 */
export function hazardSystem<TInput>(options: HazardDamageOptions): System<TInput> {
  const { damage, hazards, capsule } = options;
  return {
    name: 'environment-hazards',
    run: ({ world: w, tick, clock }) => {
      const world: World<never> = w;
      for (const rule of hazards) {
        const pulse = Math.max(1, clock.ticksFor(rule.pulseMs));
        if (tick % pulse !== 0) continue;
        const sources: { entity: EntityId; at: Vec3; radius: number }[] = [];
        forEachWithProperty(world, rule.when, (entity, on) => {
          const at = world.get(entity, PlacementComponent);
          if (on && at !== undefined) sources.push({ entity, at, radius: at.radius + rule.reach });
        });
        if (sources.length === 0) continue;
        const amounts = pulseAmounts(rule, pulse / clock.hz);
        for (const creature of creaturesOf(world)) {
          const hazard = sources.find((s) =>
            sphereTouchesCapsule(s.at, s.radius, creature.feet, capsule),
          );
          if (hazard === undefined) continue;
          damage.apply(world, creature.entity, {
            amounts,
            instigator: blameOf(world, hazard.entity),
            source: hazard.entity,
            tags: [DAMAGE_TAGS.environment, ENVIRONMENT_TAGS.hazard],
          });
        }
      }
    },
  };
}

/** What `installEnvironmentDamage` wires. */
export interface EnvironmentDamageOptions {
  readonly damage: DamageModel;
  readonly tuning: Frozen<EnvironmentDamageTuning>;
  /** The creatures' capsule (the controller tuning's). */
  readonly capsule: Capsule;
  /** Defaults to `physicsSurface`. */
  readonly surface?: SurfaceReader;
  /** Defaults to `noLiquid`. */
  readonly liquidDepth?: LiquidDepthReader;
}

/**
 * Wires the environmental damage rules into `world` (see the file header): registers the blame and
 * contact components, creates the contact memory, subscribes fall damage to CharacterImpacted and
 * blame to impulses and property changes, and appends the kinetic-impact and hazard systems (after
 * the physics-object system). Needs world properties, placements and physics objects installed,
 * and the character and damage components registered. Once per world, between steps. Returns a
 * function that removes the subscriptions (the systems stay, as systems always do).
 */
export function installEnvironmentDamage<TInput>(
  world: World<TInput>,
  options: EnvironmentDamageOptions,
): () => void {
  const w: World<never> = world;
  const { damage, tuning, capsule } = options;
  world.register(BlameComponent, EnvironmentContactsComponent);
  world.add(world.spawn(), EnvironmentContactsComponent, Object.freeze({ contacts: [] }));
  world.addSystem(kineticImpactSystem({ damage, kinetic: tuning.kinetic, capsule }));
  world.addSystem(hazardSystem({ damage, hazards: tuning.hazards, capsule }));
  const hazardKeys: ReadonlySet<string> = new Set(tuning.hazards.map((h) => h.when));
  const fall: FallDamageOptions = {
    damage,
    fall: tuning.fall,
    ...(options.surface !== undefined && { surface: options.surface }),
    ...(options.liquidDepth !== undefined && { liquidDepth: options.liquidDepth }),
  };
  const offs = [
    world.events.on(CharacterImpacted, (impact) => {
      resolveFall(w, impact, fall);
      resolveFragileStrike(w, impact, {
        damage,
        kinetic: tuning.kinetic,
        surface: options.surface,
      });
    }),
    world.events.on(impulseApplied, ({ entity, source }) => {
      if (source !== null && w.has(entity, PhysicsObjectComponent)) blame(w, entity, source);
    }),
    world.events.on(propertyChanged, (change) => {
      const { entity, key, source } = change;
      if (key === 'suspended' && !change.new && source !== null) blame(w, entity, source);
      if (hazardKeys.has(key)) blame(w, entity, change.new === true ? source : null);
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
