// The creature spawner (mw-e12.4): puts any creature into the world by id, from level data, the debug
// console or a test. Pure sim: it builds the entity from a RuntimeCreature (a CreatureDef with its
// senses and locomotion resolved by the content layer, `compileCreatures`) and never reads content
// itself. Entity ids come from the world's entity store; nothing varies per spawn yet, and any future
// variance must draw from the world's seeded RNG (`world.random`), so two worlds with the same seed
// spawn identical creatures.
//
// A spawned creature is:
// - placed at its feet (`spatial.placement`, bounding radius = its nav agent radius), facing the
//   spawn's direction (`combat.facing`);
// - a combatant (health, poise, poise regen, resistances from its stats) with one body hurtbox, a
//   capsule the size of its nav agent (region hurtboxes arrive with each creature's rig), reacting
//   to hits with its `reactions` profile and mass (mw-e04.7);
// - an idle attacker knowing its attacks when it has attacks and the world runs the attack executor
//   (mw-e12.5) — and, in a world with action timelines and hit volumes (knight combat), an action
//   timeline and hitboxes too, so its melee attacks run on the move system exactly as the combat
//   sandbox's attacker dummy swings (mw-e04.20: parried, blocked and staggered by the player's rules);
// - a lock-on target when the world has lock-on (mw-e02.16), lock points up its body;
// - a member of its faction (or the spawn's override) with its disposition toward the player;
// - its creature state: origin (for respawn, with its patrol, routine and leash: mw-e01.17),
//   behaviour profile, needs, senses, nav agent and condition (full morale, awake);
// - a brain running its behaviour profile, with its personality and gait speeds, when the world runs
//   AI (`installAi`, mw-e11.2) and that AI knows the profile. Without one it stands where it spawned. Spawning never throws for bad
// data: an unknown creature or faction comes back as a typed SpawnError and nothing is created.
//
// Register the components first (`registerCreatureComponents`) and install factions
// (`installFactions`). Spawning is structural: inside a step the entity exists from the end of the
// tick; between steps at once.

import type { CreatureTable, RuntimeCreature, RuntimeShield } from '@content/index';
import type { PatrolRoutine } from '../ai/routes';
import { aiBehaviour, giveBrain } from '../ai/runtime';
import { giveAttacker, AttackerComponent } from '../combat/attacks/components';
import {
  combatantFromCreature,
  DAMAGE_COMPONENTS,
  giveCombatant,
} from '../combat/damage/components';
import {
  giveHitboxes,
  giveHurtboxes,
  HitboxComponent,
  HurtboxComponent,
} from '../combat/hits/components';
import {
  CombatFacingComponent,
  FORWARD_FACING,
  giveFacing,
  giveGuard,
  GuardComponent,
} from '../combat/melee/components';
import {
  giveHitReactions,
  HitReactionComponent,
  reactionProfileFromCreature,
} from '../combat/reactions/components';
import { towardPlayer } from '../combat/sandbox/dummies';
import { ActionTimelineComponent, giveActionTimeline } from '../combat/timeline/components';
import type { ComponentType, EntityId } from '../core/component';
import type { World } from '../core/world';
import type { SpawnParams } from '../debug/commands';
import type { Spawner } from '../debug/system';
import { joinFaction, membershipFromCreature } from '../factions/runtime';
import type { FactionTable } from '../factions/table';
import { cos, sin } from '../math';
import type { SceneSpawnPlacement } from '../scene/layout';
import { PlacementComponent, placeEntity } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { giveTargetable, TargetableComponent } from '../targeting/components';
import {
  CREATURE_COMPONENTS,
  CreatureComponent,
  CreatureNavComponent,
  CreatureSensesComponent,
  type Creature,
  type CreatureOrigin,
} from './components';
import { CreatureConditionComponent, FRESH_CONDITION } from './condition';

/** What to spawn, and where. */
export interface CreatureSpawnRequest {
  /** Creature id. */
  readonly creature: string;
  /** Its feet, metres. */
  readonly at: Vec3;
  /** Direction it faces (horizontal part); absent or without a horizontal part = +z. */
  readonly facing?: Vec3;
  /** The scene spawn point it comes from. */
  readonly point?: string;
  /** A faction it joins instead of its definition's. */
  readonly faction?: string;
  /** Its patrol route, metres. */
  readonly patrol?: readonly Vec3[];
  /** The routes it walks, each in its window of hours (mw-e11.9). */
  readonly routine?: readonly PatrolRoutine[];
  /** Its leash (mw-e01.17): a radius in metres around a post, by default where it spawns. */
  readonly leash?: { readonly radius: number; readonly post?: Vec3 };
}

/** What spawning needs: the creatures it can spawn and the world's faction table. */
export interface CreatureSpawnOptions {
  /** Runtime creatures by id (`compileCreatures`). */
  readonly creatures: CreatureTable;
  readonly factions: FactionTable;
  /**
   * The shield each creature that carries one holds, by creature id (mw-ju8.19: the compiled
   * `shield` of its definition); a creature absent here has no guard.
   */
  readonly shields?: ReadonlyMap<string, RuntimeShield>;
}

/** Why a spawn did not happen. */
export type SpawnError =
  | { readonly kind: 'unknown-creature'; readonly creature: string }
  | { readonly kind: 'unknown-faction'; readonly creature: string; readonly faction: string }
  | { readonly kind: 'not-a-creature'; readonly entity: EntityId };

/** The spawned entity, or why there is none. */
export type SpawnResult =
  | { readonly ok: true; readonly entity: EntityId }
  | { readonly ok: false; readonly error: SpawnError };

/** A readable line for `error` (logs, the console). */
export function spawnErrorMessage(error: SpawnError): string {
  switch (error.kind) {
    case 'unknown-creature':
      return `unknown creature "${error.creature}"`;
    case 'unknown-faction':
      return `creature "${error.creature}": unknown faction "${error.faction}"`;
    case 'not-a-creature':
      return `entity ${String(error.entity)} is not a creature`;
  }
}

/** Every component a creature is built from (see the file header), factions aside. */
const BODY_COMPONENTS: readonly ComponentType<unknown>[] = Object.freeze([
  ...CREATURE_COMPONENTS,
  PlacementComponent,
  CombatFacingComponent,
  ...DAMAGE_COMPONENTS,
  HurtboxComponent,
  HitReactionComponent,
]);

/**
 * Registers every component spawned creatures need that `world` does not have yet (factions come
 * from `installFactions`). Setup, once per world; returns `world`.
 */
export function registerCreatureComponents<W extends World<never>>(world: W): W {
  for (const type of BODY_COMPONENTS) if (!world.isRegistered(type)) world.register(type);
  return world;
}

/** Whether `world` can spawn creatures (`registerCreatureComponents` ran). */
export function creaturesInstalled(world: World<never>): boolean {
  return world.isRegistered(CreatureComponent);
}

/** Rounds to 1e-9 and folds -0, so equal facings encode (and hash) equal. */
const clean = (n: number): number => Math.round(n * 1e9) / 1e9 + 0;

/** The unit horizontal part of `facing`, or +z when it has none. */
function unitFacing(facing: Vec3 | undefined): Vec3 {
  const x = facing?.x ?? 0;
  const z = facing?.z ?? 0;
  const length = Math.sqrt(x * x + z * z);
  if (!(length > 0 && Number.isFinite(length))) return FORWARD_FACING;
  return Object.freeze({ x: clean(x / length), y: 0, z: clean(z / length) });
}

/** The facing of a scene yaw in degrees (0 faces +z; 90 turns +z into +x). */
export function facingFromYaw(yaw: number): Vec3 {
  const r = (yaw * Math.PI) / 180;
  return Object.freeze({ x: clean(sin(r)), y: 0, z: clean(cos(r)) });
}

/**
 * A creature's lock-on profile until creatures name their own (content `targetable`): its chest
 * (60 % of its height), then its head (90 %) and its base (25 %) where the chest is hidden.
 */
export function creatureLockProfile(height: number) {
  const up = (fraction: number) => [0, clean(height * fraction), 0] as const;
  return Object.freeze({
    points: Object.freeze([
      Object.freeze({ id: 'chest', at: up(0.6) }),
      Object.freeze({ id: 'head', at: up(0.9) }),
      Object.freeze({ id: 'base', at: up(0.25) }),
    ]),
    priority: 0,
  });
}

const vec = ({ x, y, z }: Vec3): Vec3 => Object.freeze({ x: x + 0, y: y + 0, z: z + 0 });

function originOf(request: CreatureSpawnRequest, facing: Vec3): CreatureOrigin {
  const { point, faction, patrol, routine, leash } = request;
  return Object.freeze({
    creature: request.creature,
    at: vec(request.at),
    facing,
    ...(point !== undefined && { point }),
    ...(faction !== undefined && { faction }),
    ...(patrol !== undefined && { patrol: Object.freeze(patrol.map(vec)) }),
    ...(routine !== undefined && { routine }),
    ...(leash !== undefined && {
      leash: Object.freeze({ radius: leash.radius, post: vec(leash.post ?? request.at) }),
    }),
  });
}

function creatureState(creature: RuntimeCreature, origin: CreatureOrigin): Creature {
  const { behaviour, needs } = creature.def;
  const needIds = Object.keys(needs).sort();
  return Object.freeze({
    origin,
    behaviour: behaviour.profile,
    tuning: Object.freeze({ ...behaviour.tuning }),
    needs: Object.freeze(Object.fromEntries(needIds.map((id) => [id, 0]))),
  });
}

const fail = (error: SpawnError): SpawnResult => ({ ok: false, error: Object.freeze(error) });

/** Spawns the creature `request` names (see the file header). Never throws for bad data. */
export function spawnCreature(
  world: World<never>,
  options: CreatureSpawnOptions,
  request: CreatureSpawnRequest,
): SpawnResult {
  const creature = options.creatures.get(request.creature);
  if (creature === undefined) {
    return fail({ kind: 'unknown-creature', creature: request.creature });
  }
  const membership = membershipFromCreature(creature.def);
  const faction = request.faction ?? membership.faction;
  if (!options.factions.has(faction)) {
    return fail({ kind: 'unknown-faction', creature: creature.id, faction });
  }
  const { def, nav } = creature;
  const facing = unitFacing(request.facing);
  const entity = world.spawn();
  placeEntity(world, entity, request.at, nav.radius);
  giveFacing(world, entity, facing);
  const top = Math.max(nav.height - nav.radius, nav.radius);
  giveHurtboxes(world, entity, {
    facing,
    boxes: [
      {
        id: 'body',
        socket: 'root',
        region: 'torso',
        armored: false,
        multiplier: 1,
        shape: {
          kind: 'capsule',
          from: { x: 0, y: nav.radius, z: 0 },
          to: { x: 0, y: top, z: 0 },
          radius: nav.radius,
        },
      },
    ],
  });
  giveCombatant(world, entity, combatantFromCreature(def));
  giveHitReactions(world, entity, reactionProfileFromCreature(def));
  if (def.attacks.length > 0 && world.isRegistered(AttackerComponent)) {
    giveAttacker(
      world,
      entity,
      def.attacks.map((attack) => attack.id),
    );
    if (world.isRegistered(ActionTimelineComponent) && world.isRegistered(HitboxComponent)) {
      giveActionTimeline(world, entity);
      giveHitboxes(world, entity);
    }
  }
  const shield = options.shields?.get(def.id);
  // The melee components come with the player's combat (a world without them has no guards).
  if (shield !== undefined && world.isRegistered(GuardComponent)) giveGuard(world, entity, shield);
  if (world.isRegistered(TargetableComponent)) {
    giveTargetable(world, entity, creatureLockProfile(nav.height));
  }
  joinFaction(world, options.factions, entity, faction, membership.toward);
  world.add(entity, CreatureComponent, creatureState(creature, originOf(request, facing)));
  world.add(entity, CreatureSensesComponent, creature.senses);
  world.add(entity, CreatureNavComponent, nav);
  world.add(entity, CreatureConditionComponent, FRESH_CONDITION);
  const profile = def.behaviour.profile;
  if (aiBehaviour(world, profile) !== undefined) {
    giveBrain(world, entity, {
      behaviour: profile,
      traits: def.personality,
      gaits: creature.gaits,
    });
  }
  return { ok: true, entity };
}

/** Whether the spawn's creature belongs in the scene in `phase` (always, when it sets no presence). */
export function presentIn(spawn: SceneSpawnPlacement, phase: string): boolean {
  return spawn.presence === undefined || spawn.presence.phases.includes(phase);
}

/** Whether `entity` is a living creature. */
export function isCreature(world: World<never>, entity: EntityId): boolean {
  return creaturesInstalled(world) && world.isAlive(entity) && world.has(entity, CreatureComponent);
}

/** Removes `entity` if it is a creature; false when it is not (or is gone). */
export function despawnCreature(world: World<never>, entity: EntityId): boolean {
  if (!isCreature(world, entity)) return false;
  world.destroy(entity);
  return true;
}

/** Every creature, ascending (none when creatures are not installed); a copy, safe to destroy by. */
export function creatureEntities(world: World<never>): EntityId[] {
  if (!creaturesInstalled(world)) return [];
  return [...world.query(CreatureComponent).ids()];
}

/** Removes every creature; returns how many. */
export function despawnAllCreatures(world: World<never>): number {
  const all = creatureEntities(world);
  for (const entity of all) world.destroy(entity);
  return all.length;
}

/**
 * Removes creature `entity` and spawns it again, fresh, from its origin (same creature, place,
 * facing, spawn point, faction override, patrol, routine and leash) under a new entity id.
 */
export function respawnCreature(
  world: World<never>,
  options: CreatureSpawnOptions,
  entity: EntityId,
): SpawnResult {
  const state = isCreature(world, entity) ? world.get(entity, CreatureComponent) : undefined;
  if (state === undefined) return fail({ kind: 'not-a-creature', entity });
  world.destroy(entity);
  return spawnCreature(world, options, state.origin);
}

/** The origin a scene spawn that names `creature` spawns it with (also used to bring it back). */
export function originOfSpawn(spawn: SceneSpawnPlacement, creature: string): CreatureOrigin {
  return {
    creature,
    at: spawn.position,
    facing: facingFromYaw(spawn.yaw),
    point: spawn.id,
    ...(spawn.faction !== undefined && { faction: spawn.faction }),
    ...(spawn.patrol !== undefined && { patrol: spawn.patrol }),
    ...(spawn.routine !== undefined && { routine: spawn.routine }),
    ...(spawn.leash !== undefined && { leash: spawn.leash }),
  };
}

/** What `spawnSceneCreatures` did. */
export interface SceneCreatures {
  /** The creatures spawned, in spawn order. */
  readonly entities: readonly EntityId[];
  /** Spawns that failed, with the spawn point's id. */
  readonly errors: readonly { readonly point: string; readonly error: SpawnError }[];
}

/**
 * Spawns the creature of every scene spawn that names one, facing the spawn's yaw, with its faction
 * override, patrol route, routine and leash. With `phase` (the clock's `time.phase`), a spawn whose
 * `presence` leaves that phase out is skipped (mw-ju8.14). A failed spawn is reported, not thrown; the rest still spawn.
 */
export function spawnSceneCreatures(
  world: World<never>,
  options: CreatureSpawnOptions,
  spawns: readonly SceneSpawnPlacement[],
  phase?: string,
): SceneCreatures {
  const entities: EntityId[] = [];
  const errors: { point: string; error: SpawnError }[] = [];
  for (const spawn of spawns) {
    if (spawn.creature === undefined) continue;
    // A creature that keeps to some phases of the day is not there in the others (mw-ju8.14).
    if (phase !== undefined && !presentIn(spawn, phase)) continue;
    const result = spawnCreature(world, options, originOfSpawn(spawn, spawn.creature));
    if (result.ok) entities.push(result.entity);
    else errors.push({ point: spawn.id, error: result.error });
  }
  return { entities, errors };
}

/** Most waypoints a `--patrol` spawn option may list. */
export const MAX_PATROL_POINTS = 16;

const PATROL_NUMBER = /^-?\d+(\.\d+)?$/;

/**
 * The route of a `--patrol` spawn option (mw-e11.21): waypoints `x,y,z` in metres separated by `;`
 * (`0,0,12;0,0,20`), at least one and at most MAX_PATROL_POINTS.
 * @throws RangeError for anything else.
 */
export function parsePatrolParam(text: string): Vec3[] {
  const points = text.split(';');
  if (points.length > MAX_PATROL_POINTS) {
    throw new RangeError(`--patrol takes at most ${String(MAX_PATROL_POINTS)} waypoints`);
  }
  return points.map((point) => {
    const parts = point.split(',');
    if (parts.length !== 3 || !parts.every((part) => PATROL_NUMBER.test(part))) {
      throw new RangeError(
        `--patrol waypoint "${point}" is not x,y,z (metres, e.g. 0,0,12;0,0,20)`,
      );
    }
    const [x = 0, y = 0, z = 0] = parts.map(Number);
    return { x, y, z };
  });
}

/**
 * What is wrong with the options of a creature spawn (`spawn fixture-guard --patrol 0,0,12;0,0,20`),
 * or undefined when they are fine. `--patrol` is the only option.
 */
export function checkCreatureSpawn(params: SpawnParams): string | undefined {
  for (const name of Object.keys(params)) {
    if (name !== 'patrol') return `unknown option --${name} (creatures take --patrol x,y,z;x,y,z…)`;
  }
  const patrol = params['patrol'];
  if (patrol === undefined) return undefined;
  try {
    parsePatrolParam(patrol);
    return undefined;
  } catch (error) {
    return (error as Error).message;
  }
}

/**
 * The debug console's spawners, one per creature id (`spawn fixture-hound 3`): each creature faces
 * the player when there is one. With `--patrol x,y,z;x,y,z…` (mw-e11.21) the creature walks that
 * route: it spawns at the first waypoint, facing the second. A spawner throws a RangeError (the
 * command is skipped) for options `checkCreatureSpawn` rejects or when the world has no creatures
 * installed.
 */
export function creatureSpawners(options: CreatureSpawnOptions): Map<string, Spawner> {
  const spawner =
    (creature: string): Spawner =>
    (world, at, params) => {
      const w: World<never> = world;
      if (!creaturesInstalled(w)) throw new RangeError('creatures are not installed');
      const problem = checkCreatureSpawn(params);
      if (problem !== undefined) throw new RangeError(problem);
      const patrol =
        params['patrol'] === undefined ? undefined : parsePatrolParam(params['patrol']);
      const [first, second] = patrol ?? [];
      const feet = first ?? at;
      const facing =
        first !== undefined && second !== undefined
          ? { x: second.x - first.x, y: 0, z: second.z - first.z }
          : towardPlayer(w, feet);
      const result = spawnCreature(w, options, {
        creature,
        at: feet,
        ...(facing !== undefined && { facing }),
        ...(patrol !== undefined && { patrol }),
      });
      if (!result.ok) throw new RangeError(spawnErrorMessage(result.error));
      return result.entity;
    };
  return new Map([...options.creatures.keys()].map((id) => [id, spawner(id)]));
}
