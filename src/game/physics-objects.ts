// Physics objects in the game (mw-e03.39): sets the game world up for the sim's physics-object
// layer (mw-e03.10) and turns its budget warnings into log lines. The sim owns every body; the game
// only installs the layer, says where the player is (bodies near the player are never forced to
// sleep) and reports `physicsBudgetExceeded`. Scene props become physics objects in the scene loader
// (src/game/scene/scene-loader.ts), which also binds their render objects to the sim pose.
//
// The game world also accepts stimuli (mw-e04.34): the stimulus queue and its system, right after
// the physics-object system, so a force stimulus pushes props and characters (src/game/combat wires
// characters) before the player's controller steps. And it breaks things (mw-e03.11): breakables
// listen to those stimuli and to physics impacts (src/sim/breakables).

import type { GameContent } from '@content/index';
import {
  CharacterController,
  installBreakables,
  installPhysicsObjects,
  installStimuli,
  physicsBudgetExceeded,
  registerWorldProperties,
  stimulusSystem,
  type BreakablesOptions,
  type EntityId,
  type PhysicsBudgetExceeded,
  type PropBody,
  type PropBodyLookup,
  type StaticColliderSink,
  type Vec3,
  type World,
} from '@sim/index';

export interface GamePhysicsOptions {
  /** Where the player is now (undefined when there is none): the budget's focus. */
  readonly focus?: () => Vec3 | undefined;
  /** Receives every budget warning, e.g. `console.warn(formatBudgetWarning(w))`. */
  readonly onBudgetExceeded?: (warning: PhysicsBudgetExceeded) => void;
  /**
   * The sink scenes are loaded into when it is not the physics port itself: the game light's
   * ColliderFanOut (mw-e03.37), so a burnt-away piece leaves physics and the light field together.
   */
  readonly levelColliders?: StaticColliderSink;
  /** Breakables' options (mw-e03.11): the props they spill, the debris budget. */
  readonly breakables?: BreakablesOptions;
  /**
   * Installs systems that must run before the stimulus system, with stimuli and physics objects in
   * place: the spell pipeline (mw-e06.15), whose stimuli resolve in the tick they are cast.
   */
  readonly beforeStimuli?: (world: World<never>) => void;
}

/**
 * Registers world properties on `world`, whose physics must be a rigid-body port, installs stimuli
 * (placements and the queue) and physics objects, adds the stimulus system after the physics-object
 * system (and after `beforeStimuli`'s), and installs breakables. Call once at setup, before loading a scene.
 */
export function installGamePhysics<T>(world: World<T>, options: GamePhysicsOptions = {}): World<T> {
  const sim = world as unknown as World<never>; // the physics layer never reads inputs
  installStimuli(registerWorldProperties(sim));
  const { focus, onBudgetExceeded, levelColliders } = options;
  installPhysicsObjects(sim, {
    ...(focus !== undefined && { focus: () => focus() }),
    ...(levelColliders !== undefined && { levelColliders }),
  });
  options.beforeStimuli?.(sim);
  sim.addSystem(stimulusSystem());
  installBreakables(sim, options.breakables);
  if (onBudgetExceeded !== undefined) sim.events.on(physicsBudgetExceeded, onBudgetExceeded);
  return world;
}

/** The budget's focus: the player's feet, once `entity` names the player. */
export interface PlayerFocus {
  /** The player's entity; undefined until there is a player. */
  entity: EntityId | undefined;
  /** Where the player is now (undefined without a player): pass as `focus`. */
  readonly read: () => Vec3 | undefined;
}

/** A focus that follows the player's character controller in `world`. */
export function playerFocus<T>(world: World<T>): PlayerFocus {
  const focus: PlayerFocus = {
    entity: undefined,
    read: () =>
      focus.entity === undefined
        ? undefined
        : world.get(focus.entity, CharacterController)?.position,
  };
  return focus;
}

/** One log line for a budget warning. */
export function formatBudgetWarning(warning: PhysicsBudgetExceeded): string {
  const { tick, active, budget, slept } = warning;
  const outcome =
    slept.length === 0
      ? 'none could sleep (all moving or near the player)'
      : `forced ${String(slept.length)} to sleep`;
  return `physics budget exceeded at tick ${String(tick)}: ${String(active)} awake bodies, budget ${String(budget)}; ${outcome}`;
}

/** Prop id → its physics body from `testprop` content, for props that have one. */
export function propBodies(content: Pick<GameContent, 'get' | 'has'>): PropBodyLookup {
  return (id) => {
    if (!content.has('testprop', id)) return undefined;
    const prop = content.get('testprop', id);
    if (prop.body === undefined) return undefined;
    const [x, y, z] = prop.body.size;
    const body: PropBody = {
      size: { x, y, z },
      material: prop.body.material.id,
      weight: prop.mass,
      flammable: prop.flammable,
    };
    return body;
  };
}
