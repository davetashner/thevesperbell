// The running game as the console's built-ins see it (mw-e33.1). Reads go straight to the world
// (read-only); every change to the sim goes into the command queue, which the frame loop feeds to
// the next `World.step`, so it is deterministic and recorded like player input.

import type { ControllerTuning, Frozen } from '@content/index';
import {
  CharacterController,
  CharacterTuning,
  DEBUG_SPAWN_TAG,
  hasCheat,
  PlayerLook,
  SceneSpawnComponent,
  SceneTransformComponent,
  type DebugCheat,
  type EntityId,
  type SceneSpawnPlacement,
  type Vec3,
  type World,
} from '@sim/index';
import type { SlotId } from '@game/save/slots/ids';
import type { ConsoleHost } from './builtins';

/** How far in front of the player `spawn` puts things, metres. */
export const SPAWN_DISTANCE = 2;

export interface GameHostOptions {
  /** Read only: the console never changes it directly. */
  readonly world: World<never>;
  /** Where sim commands go (the frame loop's CommandQueue). */
  readonly submit: (command: unknown) => void;
  readonly player: () => EntityId | undefined;
  readonly spawnables: readonly string[];
  /** Checks a spawn's options (ConsoleHost.checkSpawn); without it no spawnable takes options. */
  readonly checkSpawn?: (
    content: string,
    options: Readonly<Record<string, string>>,
  ) => string | undefined;
  readonly bookmarks: () => ReadonlyMap<string, Vec3>;
  /** The point under the cursor (ConsoleHost.cursorPoint); without it `at-cursor` is unavailable. */
  readonly cursorPoint?: () => Vec3 | undefined;
  /** Item ids (ConsoleHost.items); without them `give` is unavailable. */
  readonly items?: readonly string[];
  /** Spell ids (ConsoleHost.spells); without them `spell` knows none. */
  readonly spells?: readonly string[];
  /** Chooses the cast button's spell (ConsoleHost.selectSpell). */
  readonly selectSpell?: (id: string) => boolean;
  readonly scenes: readonly string[];
  readonly loadScene: (id: string) => void;
  /** Saves the game into a slot (ConsoleHost.save); without it `save` is unavailable. */
  readonly save?: (slot: SlotId) => void;
  /** The frame loop (its time scale). */
  readonly loop: { timeScale: number };
}

/** Rounds to the millimetre, so spawn positions read well in the console and in replays. */
const mm = (n: number): number => Math.round(n * 1000) / 1000 + 0;

/** Builds the ConsoleHost over the running game. */
export function createGameHost(options: GameHostOptions): ConsoleHost {
  const { world, loop } = options;
  return {
    submit: options.submit,
    seed: world.seed,
    isAlive: (entity) => world.isAlive(entity),
    player: options.player,
    cheat: (entity: EntityId, cheat: DebugCheat) => hasCheat(world, entity, cheat),
    spawnPoint: () => {
      const id = options.player();
      const feet = id === undefined ? undefined : world.get(id, CharacterController)?.position;
      if (id === undefined || feet === undefined) return { x: 0, y: 0, z: 0 };
      // Look yaw 0 faces −z; positive turns left (see src/sim/player).
      const yaw = world.get(id, PlayerLook)?.yaw ?? 0;
      return {
        x: mm(feet.x - Math.sin(yaw) * SPAWN_DISTANCE),
        y: mm(feet.y),
        z: mm(feet.z - Math.cos(yaw) * SPAWN_DISTANCE),
      };
    },
    spawnables: options.spawnables,
    ...(options.checkSpawn !== undefined && { checkSpawn: options.checkSpawn }),
    ...(options.cursorPoint !== undefined && {
      cursorPoint: (): Vec3 | undefined => {
        const point = options.cursorPoint?.();
        return point === undefined ? undefined : { x: mm(point.x), y: mm(point.y), z: mm(point.z) };
      },
    }),
    ...(options.items !== undefined && { items: options.items }),
    ...(options.spells !== undefined && { spells: options.spells }),
    ...(options.selectSpell !== undefined && { selectSpell: options.selectSpell }),
    bookmarks: options.bookmarks,
    scenes: options.scenes,
    loadScene: options.loadScene,
    ...(options.save !== undefined && { save: options.save }),
    get timeScale() {
      return loop.timeScale;
    },
    set timeScale(value: number) {
      loop.timeScale = value;
    },
  };
}

/** `entity`'s own controller tuning (CharacterTuning), or undefined when it has none. */
export function characterTuningOf(
  world: World<never>,
  entity: EntityId,
): Frozen<ControllerTuning> | undefined {
  return world.isRegistered(CharacterTuning) ? world.get(entity, CharacterTuning) : undefined;
}

/**
 * Debug-spawned props that have no render object yet (`isBound` false), as spawn placements the
 * greybox view can draw. The game binds them after each sim step.
 */
export function unboundDebugSpawns(
  world: World<never>,
  isBound: (entity: EntityId) => boolean,
): { readonly entity: EntityId; readonly placement: SceneSpawnPlacement }[] {
  const found: { entity: EntityId; placement: SceneSpawnPlacement }[] = [];
  world.query(SceneSpawnComponent, SceneTransformComponent).forEach((entity, spawn, placed) => {
    if (!spawn.tags.includes(DEBUG_SPAWN_TAG) || isBound(entity)) return;
    found.push({
      entity,
      placement: {
        id: spawn.id,
        position: placed.position,
        rotation: placed.rotation,
        yaw: 0,
        prop: spawn.prop,
        tags: spawn.tags,
      },
    });
  });
  return found;
}
