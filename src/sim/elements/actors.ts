// Creatures and the player in the element rules (mw-e03.24). An actor is wet, burning, frozen or
// charged by the same rules as an object: it carries the same property components (temperature,
// wetness, flammable, charge, conductive…), and fire, water, ice and conduction act on them without
// asking what the thing is. This module adds only what an actor needs that a crate does not:
//
// - `actor.elements` (the component): its resistances (a fraction, 0 none … 1 immune: from the
//   creature's damage multipliers), whether it is data-forced alight (a fire elemental), how long an
//   ignition lasts, the properties it had before an element changed them, and a little state the
//   rules need (when its ice ends, whether it is soaked). Its presence is what makes an entity an
//   actor to the rules below; nothing names a creature kind.
// - Cold: an actor whose temperature falls to its `freezePoint` (a cold stimulus did it) freezes solid
//   (dry or wet: a body is not a sponge) for `frozenSeconds` (shortened by its cold resistance),
//   unless it is on fire. Frozen, it is immobile (`elementMoveScale` 0; AI does not think), brittle
//   (`fragile` is set, so the frozen divisor makes a hit shatter it) and insulating (`conductsNow`),
//   and it thaws when the time is up or it is heated past `meltTemperature`. A chilled actor above
//   its freeze point is slowed. `frozenSolid` and `thawed` report it.
// - Fire: the fire rules read `isFireImmune` (never ignites) and `isAflame` (never goes out, never
//   spends fuel), and an actor whose fuel is spent is not destroyed or turned to char: its fire goes
//   out and, once it has cooled below its ignition point, its fuel comes back (`actor.recover`).
//   Actors warm slowly (`heatInertia`) so a torch they walk past does not light them, a flame
//   stimulus does. A burning actor holds the cells around it hot, so it lights the grass it walks
//   through exactly as a burning crate lights its neighbours.
// - Water: wetness comes from rain, wading and splashes like any object's; soaking (wetness at least
//   SOAKED_WETNESS) puts fire out through the ordinary rule and reports `soaked`.
// - Charge: a shock on an actor is multiplied by the conduction config's wet factor while the actor
//   is soaked, and spared by its shock resistance (`shockIntensity`).
//
// What an element does to an actor's health is the damage model's (burning is a hazard the
// environment rules apply, the shatter is a blunt hit): none of it is decided here.

import { defineComponent, type EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { World } from '../core/world';
import { assignProperty, hasProperty, readProperty, setProperty } from '../properties/components';
import { SOAKED_WETNESS } from '../properties/derived';
import { WORLD_PROPERTY_SPECS } from '../properties/spec';
import { clampTemperature } from './heat';
import type { ElementRule } from './rules';

/** An actor's element state (`actor.elements`; a snapshot and save key, never renamed). */
export interface ActorElements {
  /** Fraction of fire the actor shrugs off, 0 … 1: at 1 it never ignites; it scales how long it burns. */
  readonly fireResistance: number;
  /** Fraction of cold it shrugs off, 0 … 1: at 1 it never freezes; it scales how long it stays frozen. */
  readonly coldResistance: number;
  /** Fraction of a shock it shrugs off, 0 … 1. */
  readonly shockResistance: number;
  /** Data-forced alight: it is always burning and nothing puts it out. */
  readonly aflame: boolean;
  /** Seconds an ignition lasts before its fire resistance shortens it. */
  readonly baseFuel: number;
  /** Its `fragile` before ice made it brittle, J. */
  readonly baseFragile: number;
  /** Its own `conductive` before armor changed it. */
  readonly baseConductive: boolean;
  /** Heat exchange with the air is divided by this (≥ 1): a body warms slower than a twig. */
  readonly heatInertia: number;
  /** Temperature below which it starts to slow, °C. */
  readonly chillBelow: number;
  /** Fraction of its speed it keeps at its freeze point, 0 … 1. */
  readonly chillSlowest: number;
  /** The tick its ice ends; 0 when it is not frozen by cold. */
  readonly frozenUntil: number;
  /** It is soaked (wetness at least SOAKED_WETNESS), as last reported. */
  readonly soaked: boolean;
}

/** The actor component. */
export const ActorElementsComponent = defineComponent<ActorElements>('actor.elements');

/** Tuning of the actor rules (plain data; game values). */
export interface ActorConfig {
  /** Seconds an actor stays frozen solid before its cold resistance shortens it (> 0). */
  readonly frozenSeconds: number;
  /** Temperature that melts a frozen actor at once, °C. */
  readonly meltTemperature: number;
  /** Impact energy that breaks a frozen actor's ice, J, before the frozen divisor (≥ 0). */
  readonly frozenFragile: number;
  /** Where an actor's ice goes when it thaws: it is not left colder than this above its freeze point, °C. */
  readonly thawMargin: number;
}

/** The default actor tuning. */
export const DEFAULT_ACTOR_CONFIG: ActorConfig = Object.freeze({
  frozenSeconds: 6,
  meltTemperature: 60,
  frozenFragile: 400,
  thawMargin: 5,
});

/** The full, validated actor config for `input` over the defaults. Throws a RangeError. */
export function resolveActorConfig(input: Partial<ActorConfig> = {}): ActorConfig {
  const config = { ...DEFAULT_ACTOR_CONFIG, ...input };
  const positive = (key: 'frozenSeconds'): void => {
    if (!(config[key] > 0) || !Number.isFinite(config[key])) {
      throw new RangeError(`actor config ${key} must be a finite number > 0`);
    }
  };
  positive('frozenSeconds');
  for (const key of ['frozenFragile', 'thawMargin'] as const) {
    if (!(config[key] >= 0) || !Number.isFinite(config[key])) {
      throw new RangeError(`actor config ${key} must be a finite number ≥ 0`);
    }
  }
  if (!Number.isFinite(config.meltTemperature)) {
    throw new RangeError('actor config meltTemperature must be a finite number');
  }
  return config;
}

/** An actor caught fire is `fireIgnited`; these report the other element states (VFX, audio, AI). */
export interface ActorSoaked {
  readonly tick: number;
  readonly entity: EntityId;
}
/** An actor froze solid; it thaws at `until` unless heat melts it first. */
export interface ActorFrozen {
  readonly tick: number;
  readonly entity: EntityId;
  readonly until: number;
}
/** A frozen actor thawed. */
export interface ActorThawed {
  readonly tick: number;
  readonly entity: EntityId;
}

/** Fired when an actor becomes soaked. */
export const soaked = defineEvent<ActorSoaked>('soaked');
/** Fired when an actor freezes solid. */
export const frozenSolid = defineEvent<ActorFrozen>('frozenSolid');
/** Fired when a frozen actor thaws. */
export const thawed = defineEvent<ActorThawed>('thawed');

/** `entity`'s actor state, or undefined (not an actor, or actors are not registered). */
export function actorOf(world: World<never>, entity: EntityId): ActorElements | undefined {
  return world.isRegistered(ActorElementsComponent)
    ? world.get(entity, ActorElementsComponent)
    : undefined;
}

/** Whether `entity` is an actor. */
export function isActor(world: World<never>, entity: EntityId): boolean {
  return actorOf(world, entity) !== undefined;
}

/** Whether fire can never light `entity` (an actor with fire resistance 1). */
export function isFireImmune(world: World<never>, entity: EntityId): boolean {
  return (actorOf(world, entity)?.fireResistance ?? 0) >= 1;
}

/** Whether `entity` is data-forced alight (it burns whatever it touches and is never put out). */
export function isAflame(world: World<never>, entity: EntityId): boolean {
  return actorOf(world, entity)?.aflame === true;
}

/** Divisor of the heat an entity exchanges with the air: 1 for everything but an actor. */
export function heatInertiaOf(world: World<never>, entity: EntityId): number {
  return actorOf(world, entity)?.heatInertia ?? 1;
}

/**
 * The fraction of its normal speed `entity` moves at under the elements: 0 frozen solid; slowed as
 * the cold takes it from `chillBelow` down to its freeze point (to `chillSlowest` of its speed);
 * otherwise 1. Everything that is not an actor is 1.
 */
export function elementMoveScale(world: World<never>, entity: EntityId): number {
  const actor = actorOf(world, entity);
  if (actor === undefined) return 1;
  if (readProperty(world, entity, 'frozen')) return 0;
  const temperature = readProperty(world, entity, 'temperature');
  if (temperature >= actor.chillBelow) return 1;
  const freezePoint = readProperty(world, entity, 'freezePoint');
  const depth = (actor.chillBelow - temperature) / Math.max(1e-9, actor.chillBelow - freezePoint);
  return 1 - Math.min(1, depth) * (1 - actor.chillSlowest);
}

/** Whether `entity` is frozen solid (immobile, and it does not think). */
export function isFrozenSolid(world: World<never>, entity: EntityId): boolean {
  return isActor(world, entity) && readProperty(world, entity, 'frozen');
}

/**
 * The intensity of a shock of `charge` on `entity`: an actor soaked to SOAKED_WETNESS takes
 * `wetFactor` times as much (water carries current through it), less its shock resistance; anything
 * else takes `charge` as it is.
 */
export function shockIntensity(
  world: World<never>,
  entity: EntityId,
  charge: number,
  wetFactor: number,
): number {
  const actor = actorOf(world, entity);
  if (actor === undefined) return charge;
  const wet = readProperty(world, entity, 'wetness') >= SOAKED_WETNESS ? wetFactor : 1;
  return charge * wet * (1 - actor.shockResistance);
}

/** Seconds a burning actor burns for: its base fuel shortened by its fire resistance. */
export function actorFuel(actor: ActorElements): number {
  return actor.baseFuel * (1 - actor.fireResistance);
}

const FUEL_MAX = WORLD_PROPERTY_SPECS.fuel.max;

/** The fuel a data-forced actor burns on: effectively endless, and never spent. */
export const AFLAME_FUEL = FUEL_MAX;

function freezeRule(config: ActorConfig): ElementRule {
  return {
    id: 'actor.freeze',
    phase: 'exchange',
    run: ({ world, field, tick, hz }) => {
      if (!world.isRegistered(ActorElementsComponent)) return;
      const { ambient } = field.config.temperature;
      const found: [EntityId, ActorElements][] = [];
      world.query(ActorElementsComponent).forEach((entity, actor) => found.push([entity, actor]));
      for (const [entity, actor] of found) {
        const temperature = readProperty(world, entity, 'temperature');
        if (readProperty(world, entity, 'frozen')) {
          if (tick < actor.frozenUntil && temperature < config.meltTemperature) continue;
          setProperty(world, entity, 'frozen', false);
          assignProperty(world, entity, 'fragile', actor.baseFragile);
          assignProperty(
            world,
            entity,
            'temperature',
            clampTemperature(
              Math.max(
                temperature,
                readProperty(world, entity, 'freezePoint') + config.thawMargin,
                ambient,
              ),
            ),
          );
          world.set(entity, ActorElementsComponent, { ...actor, frozenUntil: 0 });
          world.events.emit(thawed, { tick, entity });
          continue;
        }
        if (
          actor.coldResistance >= 1 ||
          temperature > readProperty(world, entity, 'freezePoint') ||
          readProperty(world, entity, 'burning')
        ) {
          continue;
        }
        const until =
          tick + Math.max(1, Math.round(config.frozenSeconds * (1 - actor.coldResistance) * hz));
        assignProperty(world, entity, 'frozen', true);
        assignProperty(world, entity, 'fragile', config.frozenFragile);
        world.set(entity, ActorElementsComponent, { ...actor, frozenUntil: until });
        world.events.emit(frozenSolid, { tick, entity, until });
      }
    },
  };
}

function soakRule(): ElementRule {
  return {
    id: 'actor.soak',
    phase: 'transition',
    run: ({ world, tick }) => {
      if (!world.isRegistered(ActorElementsComponent)) return;
      const changed: [EntityId, ActorElements, boolean][] = [];
      world.query(ActorElementsComponent).forEach((entity, actor) => {
        const now = hasProperty(world, entity, 'wetness')
          ? readProperty(world, entity, 'wetness') >= SOAKED_WETNESS
          : false;
        if (now !== actor.soaked) changed.push([entity, actor, now]);
      });
      for (const [entity, actor, now] of changed) {
        world.set(entity, ActorElementsComponent, { ...actor, soaked: now });
        if (now) world.events.emit(soaked, { tick, entity });
      }
    },
  };
}

function recoverRule(): ElementRule {
  return {
    id: 'actor.recover',
    phase: 'settle',
    run: ({ world }) => {
      if (!world.isRegistered(ActorElementsComponent)) return;
      world.query(ActorElementsComponent).forEach((entity, actor) => {
        if (actor.aflame || readProperty(world, entity, 'burning')) return;
        if (readProperty(world, entity, 'fuel') > 0) return;
        if (
          readProperty(world, entity, 'temperature') >= readProperty(world, entity, 'ignitionPoint')
        ) {
          return;
        }
        assignProperty(world, entity, 'fuel', actorFuel(actor));
      });
    },
  };
}

/**
 * The actor rules, in the order they run: actor.freeze (exchange: add it after `freezeRules`),
 * actor.soak (transition), actor.recover (settle: after `fireRules`' burnout). Throws a RangeError
 * for an invalid config.
 */
export function actorRules(config: Partial<ActorConfig> = {}): ElementRule[] {
  return [freezeRule(resolveActorConfig(config)), soakRule(), recoverRule()];
}
