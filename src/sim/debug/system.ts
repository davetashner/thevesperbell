// Applies debug commands inside the tick (mw-e33.1; blasts, mw-e04.34, go through the stimulus API and
// resolve where the world's stimulus system runs; controller tuning, mw-e02.3, replaces the
// character's CharacterTuning). `installDebugCommands` registers the cheat
// component and adds the system; install it right after creating the world, before other systems,
// so a teleport or a cheat toggle is what every later system of that tick sees. Structural changes
// follow the world's usual rule: entities a spawn command creates, and a first cheat component, go
// live at the end of the tick, i.e. they exist from the next tick.
//
// The system trusts nothing it is fed: a replay may carry a command for content this build no longer
// has, or for an entity that is gone, so such commands are skipped rather than failing the tick. The
// console checks the same things up front and tells the developer instead.

import { gameClockOf } from '../gametime/clock';
import { initialCharacterState } from '../character/controller';
import { CharacterController, CharacterTuning } from '../character/system';
import { HealthComponent } from '../combat/damage/components';
import { Died } from '../combat/damage/events';
import { ActionTimelineComponent } from '../combat/timeline/components';
import { requestMove } from '../combat/timeline/timeline';
import type { DamageModel } from '../combat/damage/model';
import type { ComponentType, EntityId } from '../core/component';
import { despawnAllCreatures } from '../creatures/spawn';
import type { BodyShape } from '../physics/bodies';
import type { System, World } from '../core/world';
import { PhysicsObjectComponent, teleportPhysicsObject } from '../physics/objects';
import { assignProperty, WorldProperties } from '../properties/components';
import { validateProperty, type WorldPropertyValues } from '../properties/spec';
import { SceneSpawnComponent, SceneTransformComponent } from '../scene/loader';
import { addPropPhysics, type ScenePhysicsOptions } from '../scene/physics';
import type { Vec3 } from '../stimulus/shapes';
import { applyStimulus, StimulusQueueComponent } from '../stimulus/stimulus';
import { DebugCheatsComponent, godModeModifier, NO_CHEATS, type DebugCheats } from './cheats';
import {
  isDebugCommand,
  NO_SPAWN_PARAMS,
  type ActCommand,
  type CheatCommand,
  type DebugCommand,
  type PropertyCommand,
  type SpawnParams,
  type TuneCommand,
} from './commands';

/** Distance between the entities one spawn command creates, metres along +x. */
export const SPAWN_SPACING = 1;

/** The tag every debug-spawned prop carries in its SceneSpawn component. */
export const DEBUG_SPAWN_TAG = 'debug-spawn';

/**
 * Creates one entity of some content at `at` (code, not state: the same on every run), configured by
 * the command's `params`. A spawner that rejects its params throws a RangeError before changing the
 * world; the command is then skipped.
 */
export type Spawner = <TInput>(world: World<TInput>, at: Vec3, params: SpawnParams) => EntityId;

export interface DebugCommandOptions {
  /** Spawnable id → spawner; `spawn` commands for other ids are skipped. */
  readonly spawners: ReadonlyMap<string, Spawner>;
  /** The world's damage model, if it has one: god mode registers on it. */
  readonly damage?: DamageModel;
}

const IDENTITY = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });

/** Prop bodies and material presets, so props with a body spawn as physics objects. */
export type SpawnPhysics = Pick<ScenePhysicsOptions, 'props' | 'materials'>;

/**
 * A spawner for a grey-box test prop: a scene-spawn entity (the scene components must be
 * registered) that the renderer draws like the scene's own props, tagged DEBUG_SPAWN_TAG. With
 * `physics`, a prop with a body also becomes a physics object standing on `at`, like a scene prop
 * (mw-e33.16; the world needs world properties and physics objects installed). All of it happens in
 * the tick of the recorded spawn command: the body exists at once, built from the prop's resolved
 * material properties, and everything else goes live with the entity at the end of that tick.
 */
export function propSpawner(prop: string, physics?: SpawnPhysics): Spawner {
  const body = physics?.props(prop);
  return (world, at) => {
    const id = world.spawn();
    world.add(
      id,
      SceneTransformComponent,
      Object.freeze({ position: Object.freeze({ ...at }), rotation: IDENTITY }),
    );
    world.add(
      id,
      SceneSpawnComponent,
      Object.freeze({ id: `${DEBUG_SPAWN_TAG}-${prop}`, prop, tags: [DEBUG_SPAWN_TAG] }),
    );
    if (physics !== undefined && body !== undefined) {
      const sim = world as unknown as World<never>; // the physics layer never reads inputs
      addPropPhysics(sim, id, body, physics.materials, at);
    }
    return id;
  };
}

/** Spawners for test props, keyed `testprop-<id>`; with `physics`, see `propSpawner`. */
export function testPropSpawners(
  ids: readonly string[],
  physics?: SpawnPhysics,
): Map<string, Spawner> {
  return new Map(ids.map((id) => [`testprop-${id}`, propSpawner(id, physics)]));
}

/** `type` of `id`, or undefined also when the world does not register `type`. */
function read<T>(world: World, id: EntityId, type: ComponentType<T>): T | undefined {
  return world.isRegistered(type) ? world.get(id, type) : undefined;
}

function teleport<TInput>(world: World<TInput>, target: EntityId, to: Vec3): void {
  if (read(world, target, CharacterController) !== undefined) {
    world.set(target, CharacterController, initialCharacterState(to));
    return;
  }
  const placed = read(world, target, SceneTransformComponent);
  if (placed !== undefined) {
    world.set(target, SceneTransformComponent, Object.freeze({ ...placed, position: to }));
  }
  // A physics object's pose lives in its body (mw-e33.17): it stands on `to` like a spawned prop.
  const object = read(world, target, PhysicsObjectComponent);
  if (object !== undefined) {
    const lift = uprightHalfHeight(object.shape);
    teleportPhysicsObject(world, target, { ...to, y: to.y + lift });
  }
}

/** Half a body's height standing upright: its centre's height above the point it stands on. */
function uprightHalfHeight(shape: BodyShape): number {
  switch (shape.kind) {
    case 'box':
      return shape.halfExtents.y;
    case 'sphere':
      return shape.radius;
    case 'capsule':
      return shape.halfHeight + shape.radius;
  }
}

function kill<TInput>(world: World<TInput>, target: EntityId, tick: number): void {
  const health = read(world, target, HealthComponent);
  if (health !== undefined) {
    if (health.current === 0) return;
    world.set(target, HealthComponent, Object.freeze({ ...health, current: 0 }));
    world.events.emit(Died, { tick, target, killer: null, source: null, tags: ['debug'] });
    return;
  }
  // No health: remove it, unless it is a character (the player is never simply deleted).
  if (read(world, target, CharacterController) === undefined) world.destroy(target);
}

/** Writes a property; skipped when the world has no world properties or the value is invalid. */
function setDebugProperty<TInput>(world: World<TInput>, command: PropertyCommand): void {
  const { target, key, value } = command;
  if (!world.isRegistered(WorldProperties[key])) return;
  if (validateProperty(key, value) !== undefined) return; // a replay from a stricter or older build
  const sim = world as unknown as World<never>; // properties never read inputs
  assignProperty(sim, target, key, value as WorldPropertyValues[typeof key]);
}

/**
 * Replaces a character's own tuning at once (a plain set, so this tick's controller already moves
 * with it); skipped for an entity without CharacterTuning (only installPlayer gives one).
 */
function tune<TInput>(world: World<TInput>, { target, tuning }: TuneCommand): void {
  if (read(world, target, CharacterTuning) === undefined) return;
  world.set(target, CharacterTuning, tuning);
}

/** Requests the move; skipped for an entity without an action timeline. */
function act<TInput>(world: World<TInput>, { target, move }: ActCommand): void {
  if (read(world, target, ActionTimelineComponent) === undefined) return;
  requestMove(world, target, move);
}

/** The system applying this tick's debug commands in input order (see the file header). */
export function debugCommandSystem<TInput>(options: DebugCommandOptions): System<TInput> {
  const { spawners } = options;
  return {
    name: 'debug-commands',
    run({ world, inputs, tick }) {
      const commands = (inputs as readonly unknown[]).filter(isDebugCommand);
      if (commands.length === 0) return;
      // Cheat toggles accumulate per entity, so two toggles in one tick both count even while the
      // first component add is still queued.
      const cheats = new Map<EntityId, DebugCheats>();
      const toggle = ({ target, cheat, on }: CheatCommand): void => {
        const current = cheats.get(target) ?? world.get(target, DebugCheatsComponent) ?? NO_CHEATS;
        cheats.set(target, Object.freeze({ ...current, [cheat]: on }));
      };
      for (const command of commands as readonly DebugCommand[]) {
        if (command.op === 'spawn') {
          const spawn = spawners.get(command.content);
          if (spawn === undefined) continue;
          const params = command.params ?? NO_SPAWN_PARAMS;
          try {
            for (let i = 0; i < command.count; i++) {
              const { x, y, z } = command.at;
              spawn(world, { x: x + i * SPAWN_SPACING, y, z }, params);
            }
          } catch (error) {
            if (!(error instanceof RangeError)) throw error;
          }
          continue;
        }
        if (command.op === 'blast') {
          // Only a world with stimuli installed has anything to push.
          if (!world.isRegistered(StimulusQueueComponent)) continue;
          const { at, radius, intensity } = command;
          applyStimulus(world, {
            shape: { kind: 'sphere', center: at, radius },
            element: 'force',
            intensity,
          });
          continue;
        }
        if (command.op === 'time') {
          const clock = gameClockOf(world);
          if (clock === undefined) continue; // a world without the game clock has no time to move
          if (command.action === 'set') clock.setTime({ day: command.day, minute: command.minute });
          else clock.advanceTime(command.minutes, 'debug');
          continue;
        }
        if (command.op === 'despawn') {
          despawnAllCreatures(world);
          continue;
        }
        if (!world.isAlive(command.target)) continue;
        if (command.op === 'act') act(world, command);
        else if (command.op === 'cheat') toggle(command);
        else if (command.op === 'teleport') teleport(world, command.target, command.to);
        else if (command.op === 'property') setDebugProperty(world, command);
        else if (command.op === 'tune') tune(world, command);
        else kill(world, command.target, tick);
      }
      for (const [target, value] of cheats) {
        if (world.has(target, DebugCheatsComponent)) world.set(target, DebugCheatsComponent, value);
        else world.add(target, DebugCheatsComponent, value);
      }
    },
  };
}

/**
 * Makes `world` accept debug commands: registers the cheat component, adds the debug command system
 * and, when given the world's damage model, registers god mode on it. Once per world, at setup.
 */
export function installDebugCommands<TInput>(
  world: World<TInput>,
  options: DebugCommandOptions,
): void {
  world.register(DebugCheatsComponent);
  world.addSystem(debugCommandSystem<TInput>(options));
  options.damage?.register(godModeModifier);
}
