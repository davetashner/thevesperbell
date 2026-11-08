// The Interact verb in the sim (mw-e02.5). Once per tick, for every actor with an `Interactor`:
//
// 1. Focus: the objects the actor could interact with are scored (focus.ts) from its view, those it
//    can't reach in a straight line are dropped (line of sight against the physics world, ignoring
//    the object's own colliders), and one is picked with hysteresis. The result lives on the actor's
//    `interaction.focus` component, so it is snapshotted, hashed and replayed.
// 2. Interact: the tick's `interact` button acts on the focus's primary affordance, the first one the
//    actor can use. Nothing usable (a locked door, no key, no lockpicking): nothing is dispatched. An
//    instant affordance fires `interacted` on press. A hold affordance fires once Interact has been
//    held for its duration (round(hold × hz) ticks, the press tick counting as the first); releasing
//    early, losing focus or losing the affordance cancels it and nothing fires.
//
// Owning systems (doors, containers, carrying, hiding, talking) subscribe to `interacted` and act
// through properties and the stimulus API; this system never knows what an affordance does. An owning
// system can also gate its affordances on world state the actor's kit doesn't carry (`addAffordanceGate`:
// a locked door's Unlock needs a fitting key on the keyring, mw-e17.5). The UI reads
// `interactionPrompt` (text, availability, reason, hold progress) and adds the binding glyph.
//
// Candidates are entities with a placement (`spatial.placement`) that have an `Interactable`, or a
// property that implies an affordance (affordance.ts), and are not `hidden`. Setup: register the
// world properties (registerWorldProperties) and the placement component before
// `installInteraction`, and install it after the systems that move actors (the character
// controller), so focus is computed from this tick's positions.

import type { BodyId } from '../character/collision-world';
import { CharacterController } from '../character/system';
import { defineComponent, type EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { System, World } from '../core/world';
import { actionFrameOf, type ActionButton } from '../input/action-frame';
import { PhysicsColliderComponent, PhysicsObjectComponent } from '../physics/objects';
import { PlayerLook } from '../player/player';
import { readProperty, WorldProperties } from '../properties/components';
import { isRevealed } from '../properties/derived';
import type { SceneSpawnPlacement } from '../scene/layout';
import type { SightWorld } from '../sight/sight-world';
import { placeEntity, PlacementComponent } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import {
  normalizeAffordance,
  PROPERTY_AFFORDANCES,
  unavailableReason,
  type Affordance,
  type AffordanceVerb,
  type InteractableSpec,
  type InteractorKit,
} from './affordance';
import {
  DEFAULT_FOCUS_SETTINGS,
  focusScore,
  selectFocus,
  type ActorView,
  type FocusSettings,
  type ScoredFocus,
} from './focus';

/** An object's declared affordances (`interaction.interactable`; a snapshot key, never renamed). */
export interface Interactable {
  readonly affordances: readonly Affordance[];
  /** Reach for this object, metres; null = the focus settings' range. */
  readonly range: number | null;
}

/** A hold in progress: which target and affordance, and for how many ticks so far. */
export interface InteractionHold {
  readonly target: EntityId;
  /** Index into the target's affordances (declared, then property-derived). */
  readonly affordance: number;
  readonly ticks: number;
}

/** An actor's focus and hold (`interaction.focus`; a snapshot key, never renamed). */
export interface InteractionFocus {
  readonly target: EntityId | null;
  /** The focus's score this tick (0 with no focus); hysteresis compares against it. */
  readonly score: number;
  readonly hold: InteractionHold | null;
}

export const InteractableComponent = defineComponent<Interactable>('interaction.interactable');
/** What an actor brings: capabilities and carried items (`interaction.interactor`). */
export const InteractorComponent = defineComponent<InteractorKit>('interaction.interactor');
export const InteractionFocusComponent = defineComponent<InteractionFocus>('interaction.focus');

/** Every component the interaction system owns. */
export const INTERACTION_COMPONENTS = [
  InteractableComponent,
  InteractorComponent,
  InteractionFocusComponent,
] as const;

/** An actor used an affordance of an object. */
export interface Interaction {
  readonly actor: EntityId;
  readonly target: EntityId;
  readonly verb: AffordanceVerb;
  /** Index into the target's affordances (declared, then property-derived). */
  readonly affordance: number;
}

/** Fired once per completed interaction; the owning system acts on it. */
export const interacted = defineEvent<Interaction>('interacted');

const NO_FOCUS: InteractionFocus = Object.freeze({ target: null, score: 0, hold: null });

/** A validated, frozen Interactable from its spec (RangeError on a bad affordance or range). */
export function interactableOf(spec: InteractableSpec): Interactable {
  const { range } = spec;
  if (range !== undefined && !(Number.isFinite(range) && range > 0)) {
    throw new RangeError(`interaction range must be a finite number > 0, got ${String(range)}`);
  }
  return Object.freeze({
    affordances: Object.freeze(spec.affordances.map(normalizeAffordance)),
    range: range ?? null,
  });
}

/**
 * Makes `entity` interactable: its affordances, and a placement at its focus point (`origin` plus the
 * spec's anchor). Structural, so during a step it takes effect at the end of the tick.
 */
export function addInteractable(
  world: World<never>,
  entity: EntityId,
  spec: InteractableSpec,
  origin: Vec3,
): void {
  const interactable = interactableOf(spec);
  const [ax, ay, az] = spec.anchor ?? [0, 1, 0];
  world.add(entity, InteractableComponent, interactable);
  placeEntity(world, entity, { x: origin.x + ax, y: origin.y + ay, z: origin.z + az }, spec.radius);
}

/** A scene spawn and its entity (as `LoadedScene.spawns` lists them). */
export interface SpawnEntity {
  readonly entity: EntityId;
  readonly spawn: Pick<SceneSpawnPlacement, 'position' | 'interact'>;
}

/** Makes every loaded spawn that declares `interact` interactable; returns those entities. */
export function addSceneInteractables(
  world: World<never>,
  spawns: readonly SpawnEntity[],
): EntityId[] {
  const added: EntityId[] = [];
  for (const { entity, spawn } of spawns) {
    if (spawn.interact === undefined) continue;
    addInteractable(world, entity, spawn.interact, spawn.position);
    added.push(entity);
  }
  return added;
}

/** An entity's affordances: declared first, then property-derived ones whose verb is not declared. */
export function affordancesOf(world: World<never>, entity: EntityId): readonly Affordance[] {
  const declared = world.get(entity, InteractableComponent)?.affordances ?? [];
  const derived = PROPERTY_AFFORDANCES.filter(
    ([key, affordance]) =>
      readProperty(world, entity, key) === true &&
      !declared.some((own) => own.verb === affordance.verb),
  ).map(([, affordance]) => affordance);
  return derived.length === 0 ? declared : [...declared, ...derived];
}

const NO_KIT: InteractorKit = Object.freeze({ capabilities: [], items: [] });

/**
 * A rule an owning system adds to the Interact verb: why `actor` can't use `affordance` on `target`
 * right now (the reason the prompt shows), or undefined when this rule does not stop it. Gates are
 * checked after the affordance's own requirements, in the order they were added. They are rules, not
 * state (like systems, they are set up again when a world is made), and must only read the world.
 */
export type AffordanceGate = (
  world: World<never>,
  actor: EntityId,
  target: EntityId,
  affordance: Affordance,
) => string | undefined;

const gates = new WeakMap<World<never>, AffordanceGate[]>();

/** Adds `gate` to `world`'s Interact verb (see `AffordanceGate`). Returns a function that removes it. */
export function addAffordanceGate<TInput>(world: World<TInput>, gate: AffordanceGate): () => void {
  const w: World<never> = world;
  let own = gates.get(w);
  if (own === undefined) gates.set(w, (own = []));
  const list = own;
  list.push(gate);
  return () => {
    const at = list.indexOf(gate);
    if (at >= 0) list.splice(at, 1);
  };
}

/** Why `actor` (bringing `kit`) can't use `affordance` on `target`, or undefined when it can. */
function reasonFor(
  world: World<never>,
  actor: EntityId,
  kit: InteractorKit,
  target: EntityId,
  affordance: Affordance,
): string | undefined {
  const own = unavailableReason(kit, affordance);
  if (own !== undefined) return own;
  for (const gate of gates.get(world) ?? []) {
    const reason = gate(world, actor, target, affordance);
    if (reason !== undefined) return reason;
  }
  return undefined;
}

/** Index of the first affordance `actor` can use on `target`, or −1. */
function primaryIndex(
  world: World<never>,
  actor: EntityId,
  kit: InteractorKit,
  target: EntityId | null,
  affordances: readonly Affordance[],
): number {
  if (target === null) return -1;
  return affordances.findIndex(
    (affordance) => reasonFor(world, actor, kit, target, affordance) === undefined,
  );
}

/**
 * Performs `target`'s primary affordance for `actor` without the actor's focus, reach or Interact
 * button (remote use: Mage Hand's tether, mw-e08.10). It is the same door a direct interaction goes
 * through: the first affordance the actor can use (its kit and every affordance gate apply) fires
 * `interacted`, so the owning system cannot tell the difference. A hold affordance fires at once
 * (the caller is already paying for the use). Returns the interaction, or undefined when the target
 * is hidden or nothing on it is usable (nothing is dispatched).
 */
export function interactRemotely(
  world: World<never>,
  actor: EntityId,
  target: EntityId,
): Interaction | undefined {
  const found = remoteAffordance(world, actor, target);
  if (found === undefined) return undefined;
  const interaction: Interaction = { actor, target, verb: found.verb, affordance: found.index };
  world.events.emit(interacted, interaction);
  return interaction;
}

/** The affordance `interactRemotely` would perform (verb and index), or undefined; dispatches nothing. */
export function remoteAffordance(
  world: World<never>,
  actor: EntityId,
  target: EntityId,
): { readonly verb: AffordanceVerb; readonly index: number } | undefined {
  if (!isRevealed(world, target)) return undefined;
  const kit = world.get(actor, InteractorComponent) ?? NO_KIT;
  const affordances = affordancesOf(world, target);
  const index = primaryIndex(world, actor, kit, target, affordances);
  const chosen = affordances[index];
  return chosen === undefined ? undefined : { verb: chosen.verb, index };
}

export interface InteractionOptions<TInput> {
  /** Solid colliders that block reach (RapierSightWorld in the game). Omitted: no reach test. */
  readonly sight?: SightWorld;
  /** Colliders belonging to `entity`, which never block reach to it. Defaults to none. */
  readonly bodiesOf?: (world: World<TInput>, entity: EntityId) => readonly BodyId[];
  /** Overrides of DEFAULT_FOCUS_SETTINGS. */
  readonly settings?: Partial<FocusSettings>;
  /** Where `actor` reaches from and faces; defaults to the player's (see `playerView`). */
  readonly view?: (world: World<TInput>, actor: EntityId) => ActorView | undefined;
  /** This tick's Interact button for `actor`; defaults to the tick's ActionFrame's `interact`. */
  readonly input?: (inputs: readonly TInput[], actor: EntityId) => ActionButton | undefined;
}

/**
 * A character's view: its reach point `reachHeight` above its feet (CharacterController) and its look
 * yaw (PlayerLook); undefined without either.
 */
export function playerView(
  world: World<never>,
  actor: EntityId,
  reachHeight: number = DEFAULT_FOCUS_SETTINGS.reachHeight,
): ActorView | undefined {
  const state = world.get(actor, CharacterController);
  const look = world.get(actor, PlayerLook);
  if (state === undefined || look === undefined) return undefined;
  const { x, y, z } = state.position;
  return { origin: { x, y: y + reachHeight, z }, yaw: look.yaw };
}

const NO_BODIES: readonly BodyId[] = Object.freeze([]);

/**
 * An entity's own colliders in the physics port: its physics object's body and its bound level
 * colliders (mw-e03.10). Pass it as `bodiesOf` once the physics-object components are registered
 * (installGamePhysics), so a crate's own collider never hides the crate from reach.
 */
export function physicsBodiesOf(world: World<never>, entity: EntityId): BodyId[] {
  const bodies: BodyId[] = [];
  const object = world.get(entity, PhysicsObjectComponent);
  if (object !== undefined) bodies.push(object.body);
  const bound = world.get(entity, PhysicsColliderComponent);
  if (bound !== undefined) bodies.push(...bound.colliders);
  return bodies;
}

/** The interaction system (see the file header). */
export function interactionSystem<TInput>(
  options: InteractionOptions<TInput> = {},
): System<TInput> {
  const settings: FocusSettings = { ...DEFAULT_FOCUS_SETTINGS, ...options.settings };
  const { sight } = options;
  const bodiesOf = options.bodiesOf ?? (() => NO_BODIES);
  const viewOf =
    options.view ??
    ((world: World<TInput>, actor: EntityId) => playerView(world, actor, settings.reachHeight));
  const inputOf = options.input ?? ((inputs: readonly TInput[]) => actionFrameOf(inputs)?.interact);

  /** Whether nothing solid but the target's own colliders lies between `from` and `to`. */
  const reachable = (world: World<TInput>, target: EntityId, from: Vec3, to: Vec3): boolean => {
    if (sight === undefined) return true;
    if (from.x === to.x && from.y === to.y && from.z === to.z) return true;
    const own = bodiesOf(world, target);
    let clear = true;
    sight.forEachCrossing(from, to, (body) => {
      clear = own.includes(body);
      return clear;
    });
    return clear;
  };

  /** Every candidate entity, ascending id. */
  const candidates = (world: World<TInput>): EntityId[] => {
    const ids = new Set(world.query(InteractableComponent).ids());
    for (const [key] of PROPERTY_AFFORDANCES) {
      world.query(WorldProperties[key]).forEach((id, value) => {
        if (value === true) ids.add(id);
      });
    }
    return [...ids].sort((a, b) => a - b);
  };

  const focusOf = (
    world: World<TInput>,
    actor: EntityId,
    view: ActorView,
    all: readonly EntityId[],
    current: EntityId | null,
  ): ScoredFocus | undefined => {
    const scored: ScoredFocus[] = [];
    for (const entity of all) {
      if (entity === actor || !isRevealed(world, entity)) continue;
      const placement = world.get(entity, PlacementComponent);
      if (placement === undefined) continue;
      const range = world.get(entity, InteractableComponent)?.range ?? settings.range;
      const score = focusScore(
        view,
        { entity, center: placement, radius: placement.radius, range },
        settings,
      );
      if (score === undefined || !reachable(world, entity, view.origin, placement)) continue;
      scored.push({ entity, score });
    }
    return selectFocus(scored, current, settings);
  };

  return {
    name: 'interaction',
    run({ world, inputs, clock }) {
      const actors = world.query(InteractorComponent);
      if (actors.count === 0) return;
      const all = candidates(world);
      actors.forEach((actor, kit) => {
        const before = world.get(actor, InteractionFocusComponent) ?? NO_FOCUS;
        const view = viewOf(world, actor);
        const focus =
          view === undefined ? undefined : focusOf(world, actor, view, all, before.target);
        const target = focus?.entity ?? null;
        const button = inputOf(inputs, actor);
        const affordances = target === null ? [] : affordancesOf(world, target);
        const index = primaryIndex(world, actor, kit, target, affordances);
        const chosen = affordances[index];

        // A hold carries on only while Interact stays down on the same target and affordance.
        let hold: InteractionHold | null = null;
        if (target !== null && chosen !== undefined) {
          const needed = holdTicks(chosen, clock.hz);
          const fire = (): void => {
            world.events.emit(interacted, { actor, target, verb: chosen.verb, affordance: index });
          };
          const ongoing = before.hold;
          if (ongoing !== null) {
            const same = ongoing.target === target && ongoing.affordance === index;
            if (same && button?.held === true) {
              const ticks = ongoing.ticks + 1;
              if (ticks >= needed) fire();
              else hold = { target, affordance: index, ticks };
            }
          } else if (button?.pressed === true) {
            if (needed <= 1) fire();
            else if (button.held) hold = { target, affordance: index, ticks: 1 };
          }
        }

        const next: InteractionFocus =
          focus === undefined ? NO_FOCUS : Object.freeze({ target, score: focus.score, hold });
        if (world.has(actor, InteractionFocusComponent)) {
          world.set(actor, InteractionFocusComponent, next);
        } else {
          world.add(actor, InteractionFocusComponent, next);
        }
      });
    },
  };
}

/** Ticks Interact must be held for `affordance` at `hz` (0 for an instant one). */
export function holdTicks(affordance: Pick<Affordance, 'hold'>, hz: number): number {
  return Math.round(affordance.hold * hz);
}

/** Registers the interaction components and adds the system. Once per world, between steps. */
export function installInteraction<TInput>(
  world: World<TInput>,
  options: InteractionOptions<TInput> = {},
): void {
  world.register(...INTERACTION_COMPONENTS);
  world.addSystem(interactionSystem(options));
}

/** Makes `actor` an interactor with the given capabilities and items (none by default). */
export function addInteractor(
  world: World<never>,
  actor: EntityId,
  kit: Partial<InteractorKit> = {},
): void {
  world.add(
    actor,
    InteractorComponent,
    Object.freeze({
      capabilities: Object.freeze([...(kit.capabilities ?? NO_KIT.capabilities)]),
      items: Object.freeze([...(kit.items ?? NO_KIT.items)]),
    }),
  );
}

/** One affordance as a prompt lists it. */
export interface PromptOption {
  readonly verb: AffordanceVerb;
  readonly label: string;
  readonly available: boolean;
  /** Why it can't be used; empty when available. */
  readonly reason: string;
}

/** What the contextual prompt shows for an actor's focus. The UI adds the Interact binding glyph. */
export interface InteractionPrompt extends PromptOption {
  readonly target: EntityId;
  /** Seconds Interact must be held (0 = press). */
  readonly hold: number;
  /** Hold progress, 0…1 (0 unless a hold is under way). */
  readonly progress: number;
  /** Every affordance of the target, in order (the headline is the primary, else the first). */
  readonly options: readonly PromptOption[];
}

/**
 * The prompt for `actor`'s focus, or undefined with no focus (or an object with no affordances).
 * The headline is the affordance Interact would use; when there is none, the first one, unavailable
 * with its reason. Pure: reads the world as of the last tick.
 */
export function interactionPrompt(
  world: World<never>,
  actor: EntityId,
): InteractionPrompt | undefined {
  const { target, hold } = world.get(actor, InteractionFocusComponent) ?? NO_FOCUS;
  if (target === null || !world.isAlive(target)) return undefined;
  const affordances = affordancesOf(world, target);
  const kit = world.get(actor, InteractorComponent) ?? NO_KIT;
  const option = (affordance: Affordance): PromptOption => {
    const reason = reasonFor(world, actor, kit, target, affordance);
    return {
      verb: affordance.verb,
      label: affordance.label,
      available: reason === undefined,
      reason: reason ?? '',
    };
  };
  const primary = Math.max(0, primaryIndex(world, actor, kit, target, affordances));
  const affordance = affordances[primary];
  if (affordance === undefined) return undefined;
  const needed = holdTicks(affordance, world.clock.hz);
  const progress =
    hold !== null && hold.target === target && hold.affordance === primary && needed > 0
      ? Math.min(1, hold.ticks / needed)
      : 0;
  return {
    ...option(affordance),
    target,
    hold: affordance.hold,
    progress,
    options: affordances.map(option),
  };
}
