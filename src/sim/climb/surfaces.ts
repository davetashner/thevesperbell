// Climbable surfaces (mw-e03.22). Whether a surface can be climbed comes only from world properties,
// so every rule that changes those properties changes climbing with no special cases: ivy that burns
// away takes its climb with it (its burnt state is `destroyed`), wood that burns out becomes charred
// (climbable none), and anything frozen turns slippery. A rope arrow, a vines spell or a propped
// ladder is just an entity with the `climbable` property.
//
// The grade is the `climbable` property; what each grade asks of the actor (a capability, from its
// class or a tool) and how hard it is for nav agents is the rule table below. Queries read the
// properties live on every call, so there is nothing to invalidate: a change made on one tick is
// what the next tick's queries see (mw-e03.22 AC-3, AC-4). Climbing movement itself is mw-e02.13;
// this module only says whether an actor may attach.

import type { EntityId } from '../core/component';
import type { World } from '../core/world';
import { PhysicsColliderComponent, PhysicsObjectComponent } from '../physics/objects';
import { readProperty } from '../properties/components';
import type { ClimbGrade } from '../properties/spec';

/** A grade an actor can climb (every grade but `none`). */
export type ClimbableGrade = Exclude<ClimbGrade, 'none'>;

/** What climbing a grade asks for. */
export interface ClimbGradeRule {
  /** Difficulty for nav agents' climb links (locomotion `maxGrade`): 1 easy … 3 needs a tool. */
  readonly difficulty: 1 | 2 | 3;
  /** Capability the actor needs to attach, or null when anyone can. */
  readonly requires: string | null;
}

/** Capability that lets an actor climb rough stone and timber (the thief's). */
export const CLIMB_ROUGH_CAPABILITY = 'verb.climb.rough';
/** Capability that lets an actor climb sheer faces (claws, tools: mw-e10). Nobody has it yet. */
export const CLIMB_SHEER_CAPABILITY = 'verb.climb.sheer';
/** Capability that lets an actor climb a frozen, slippery surface (ice tools, future). */
export const CLIMB_ICE_CAPABILITY = 'verb.climb.ice';

/**
 * Per grade: nav difficulty and the capability needed. Ladders, ropes and ivy are for everyone;
 * rough walls for climbers; sheer faces for nobody until climbing tools arrive.
 */
export const CLIMB_GRADE_RULES: Readonly<Record<ClimbableGrade, ClimbGradeRule>> = Object.freeze({
  ladder: Object.freeze({ difficulty: 1, requires: null }),
  rope: Object.freeze({ difficulty: 1, requires: null }),
  ivy: Object.freeze({ difficulty: 1, requires: null }),
  rough: Object.freeze({ difficulty: 2, requires: CLIMB_ROUGH_CAPABILITY }),
  sheer: Object.freeze({ difficulty: 3, requires: CLIMB_SHEER_CAPABILITY }),
});

/**
 * How a surface climbs right now: its grade, or `slippery` when it has a grade but is frozen.
 * `none` for a surface without a grade or an entity that no longer exists.
 */
export type Climbability = ClimbGrade | 'slippery';

/** How `entity` climbs right now (see Climbability). */
export function climbabilityOf(world: World<never>, entity: EntityId): Climbability {
  if (!world.isAlive(entity)) return 'none';
  const grade = readProperty(world, entity, 'climbable');
  if (grade === 'none') return grade;
  return readProperty(world, entity, 'frozen') ? 'slippery' : grade;
}

/**
 * The nav difficulty (1–3) of a surface's climbability, or 0 when nav agents cannot climb it
 * (`none`; `slippery` counts as needing a tool, 3).
 */
export function climbDifficulty(climbability: Climbability): 0 | 1 | 2 | 3 {
  if (climbability === 'none') return 0;
  return climbability === 'slippery' ? 3 : CLIMB_GRADE_RULES[climbability].difficulty;
}

/** The easiest climb difficulty (ladders, ropes, ivy): every actor can do it. */
export const BASE_CLIMB_DIFFICULTY = 1;

/**
 * The hardest climb difficulty (1-3) an actor with `capabilities` attempts (mw-e10.9): the highest
 * `climbDifficulty` any of them grants in `grants` (capability id -> difficulty, read from content's
 * capability data, so a class's reach is its capabilities and never a class check here), and never
 * below BASE_CLIMB_DIFFICULTY.
 */
export function maxClimbDifficulty(
  capabilities: readonly string[],
  grants: ReadonlyMap<string, number>,
): number {
  let best = BASE_CLIMB_DIFFICULTY;
  for (const capability of capabilities) best = Math.max(best, grants.get(capability) ?? 0);
  return best;
}

/** Why an actor may not attach to a surface. */
export type ClimbRefusal =
  /** The surface has no climbing grade (or is gone). */
  | { readonly reason: 'not-climbable' }
  /** It is frozen: only an actor with CLIMB_ICE_CAPABILITY holds on. */
  | { readonly reason: 'slippery'; readonly capability: string }
  /** The grade needs a capability the actor lacks. */
  | { readonly reason: 'needs-capability'; readonly capability: string }
  /** The climb is harder than the actor's best (mw-e10.9): `difficulty` asked, `max` it can do. */
  | { readonly reason: 'too-difficult'; readonly difficulty: number; readonly max: number };

/** The prompt text of each refusal (the HUD shows it where the climb was refused). */
export const CLIMB_REFUSAL_TEXT: Readonly<Record<ClimbRefusal['reason'], string>> = Object.freeze({
  'not-climbable': 'Nothing to hold on to',
  slippery: 'Too slippery to climb',
  'needs-capability': 'You do not know how to climb this',
  'too-difficult': 'Too hard for you to climb',
});

/** Whether an actor may attach to a surface, and on which grade. */
export type ClimbAttach =
  | { readonly ok: true; readonly climbability: Exclude<Climbability, 'none'> }
  | ({ readonly ok: false } & ClimbRefusal);

/**
 * Whether an actor with `capabilities` may start climbing `entity` right now (mw-e03.22 AC-4): the
 * surface must have a grade, the actor must have the grade's capability, and a frozen surface also
 * needs CLIMB_ICE_CAPABILITY. With `maxDifficulty` (mw-e10.9) a grade harder than that is refused
 * first, whatever the capabilities say.
 */
export function canAttachClimb(
  world: World<never>,
  entity: EntityId,
  capabilities: readonly string[],
  maxDifficulty = Infinity,
): ClimbAttach {
  const climbability = climbabilityOf(world, entity);
  if (climbability === 'none') return { ok: false, reason: 'not-climbable' };
  const difficulty = climbDifficulty(climbability);
  if (difficulty > maxDifficulty && climbability !== 'slippery') {
    return { ok: false, reason: 'too-difficult', difficulty, max: maxDifficulty };
  }
  if (climbability === 'slippery') {
    return capabilities.includes(CLIMB_ICE_CAPABILITY)
      ? { ok: true, climbability }
      : { ok: false, reason: 'slippery', capability: CLIMB_ICE_CAPABILITY };
  }
  const { requires } = CLIMB_GRADE_RULES[climbability];
  if (requires !== null && !capabilities.includes(requires)) {
    return { ok: false, reason: 'needs-capability', capability: requires };
  }
  return { ok: true, climbability };
}

/**
 * The entity a collider or body handle belongs to (a collision query's `body`): a physics object
 * whose body it is, or the entity it is bound to (`bindCollider`); undefined for unbound geometry
 * (and in a world without physics objects).
 */
export function ownerOfCollider(world: World<never>, handle: number): EntityId | undefined {
  let owner: EntityId | undefined;
  // A world without physics objects (or bound colliders) has none to own it.
  if (world.isRegistered(PhysicsObjectComponent)) {
    world.query(PhysicsObjectComponent).forEach((entity, object) => {
      if (owner === undefined && object.body === handle) owner = entity;
    });
  }
  if (world.isRegistered(PhysicsColliderComponent)) {
    world.query(PhysicsColliderComponent).forEach((entity, { colliders }) => {
      if (owner === undefined && colliders.includes(handle)) owner = entity;
    });
  }
  return owner;
}

/** How the surface a collision query touched climbs (`none` for unbound geometry). */
export function climbabilityOfCollider(world: World<never>, handle: number): Climbability {
  const owner = ownerOfCollider(world, handle);
  return owner === undefined ? 'none' : climbabilityOf(world, owner);
}
