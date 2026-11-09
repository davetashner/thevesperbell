// The character controller inside the sim world (mw-e02.2): a component holding each character's
// controller state (so it is snapshotted, hashed and replayed) and a system that steps every
// character once per tick with that tick's input, emitting CharacterImpacted for every hard landing
// and (while launched) wall strike, for fall damage (mw-e04.19), audio and VFX.
//
// A character may carry its own tuning in CharacterTuning (mw-e02.3): the player gets its profile
// at spawn, and the debug console's `ctl.set` replaces it through a recorded debug command, so a
// live edit is world state (snapshotted, hashed, replayed) and the very next tick moves with it.
// Characters without one move with the system's tuning.

import type { ControllerTuning, Frozen } from '@content/index';
import { defineComponent, type EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { System, World } from '../core/world';
import type { Vec3 } from '../stimulus/shapes';
import type { CollisionWorld } from './collision-world';
import {
  controllerParams,
  IDLE_INPUT,
  initialCharacterState,
  stepCharacterWithImpacts,
  type CharacterImpact,
  type CharacterInput,
  type CharacterState,
} from './controller';
import { stepNoclip } from './noclip';
import type { TraversalHook } from './traversal';

/** A character moved by the kinematic controller. */
export const CharacterController = defineComponent<CharacterState>('character.controller');

/** A character's own controller tuning, replacing the systems' (see the file header). */
export const CharacterTuning = defineComponent<Frozen<ControllerTuning>>('character.tuning');

/** The tuning `entity` moves with: its CharacterTuning, else `fallback`. */
export function characterTuning<TInput>(
  world: World<TInput>,
  entity: EntityId,
  fallback: Frozen<ControllerTuning>,
): Frozen<ControllerTuning> {
  return (
    (world.isRegistered(CharacterTuning) ? world.get(entity, CharacterTuning) : undefined) ??
    fallback
  );
}

/** Payload of CharacterImpacted. */
export interface CharacterImpactInfo extends CharacterImpact {
  readonly tick: number;
  readonly entity: EntityId;
  /** Feet position after the tick, metres. */
  readonly position: Vec3;
}

/** A character landed, or (launched) struck a wall, this tick (see CharacterImpact). */
export const CharacterImpacted = defineEvent<CharacterImpactInfo>('CharacterImpacted');

/** Adds a character with its feet at `feet` to `world` (register CharacterController first). */
export function spawnCharacter<TInput>(world: World<TInput>, feet: Vec3): EntityId {
  const id = world.spawn();
  world.add(id, CharacterController, initialCharacterState(feet));
  return id;
}

export interface CharacterSystemOptions<TInput> {
  readonly collision: CollisionWorld;
  readonly tuning: Frozen<ControllerTuning>;
  /** Traversal modes in priority order. */
  readonly hooks?: readonly TraversalHook[];
  /** This tick's input for `entity`, picked from the tick's commands; undefined = idle. */
  readonly input: (inputs: readonly TInput[], entity: EntityId) => CharacterInput | undefined;
  /** Whether `entity` flies free of collision and gravity this tick (the noclip cheat, mw-e33.1). */
  readonly noclip?: (entity: EntityId) => boolean;
  /**
   * Whether `entity` is held where it is this tick (hiding inside a wardrobe, mw-e03.23): its state
   * is not stepped at all, so no gravity, input or depenetration moves it.
   */
  readonly held?: (entity: EntityId) => boolean;
  /**
   * Wraps one tick's run of the system, so glue can time the controller's cost (mw-e02.8). It must
   * call `run` exactly once. The sim reads no clock itself: whatever times it lives outside.
   */
  readonly measure?: (run: () => void) => void;
}

/** A system stepping every CharacterController once per tick. */
export function characterControllerSystem<TInput>(
  options: CharacterSystemOptions<TInput>,
): System<TInput> {
  const { collision, tuning, hooks = [], measure } = options;
  const system: System<TInput> = {
    name: 'character-controller',
    run({ world, inputs, clock, tick }) {
      const shared = controllerParams(tuning, clock);
      world.query(CharacterController).forEach((entity, state) => {
        if (options.held?.(entity) === true) return;
        const own = characterTuning(world, entity, tuning);
        const params = own === tuning ? shared : controllerParams(own, clock);
        const context = { world: collision, tuning: own, params, hooks, entity };
        const input = options.input(inputs, entity) ?? IDLE_INPUT;
        const step =
          options.noclip?.(entity) === true
            ? { state: stepNoclip(state, input, own, params), impacts: [] }
            : stepCharacterWithImpacts(state, input, context);
        world.set(entity, CharacterController, step.state);
        const { position } = step.state;
        for (const impact of step.impacts) {
          world.events.emit(CharacterImpacted, { ...impact, tick, entity, position });
        }
      });
    },
  };
  if (measure === undefined) return system;
  return {
    name: system.name,
    run: (ctx) => {
      measure(() => {
        system.run(ctx);
      });
    },
  };
}
