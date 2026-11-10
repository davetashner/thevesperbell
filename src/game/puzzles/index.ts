// Puzzles in the game (mw-e15.3): the glue between the content's puzzle files, the sim's puzzle
// runtime (src/sim/puzzle) and the debug surface.
//
// - `puzzleDefs` turns the content's puzzles for a scene into the runtime's definitions.
// - `startPuzzles` runs them: a `PuzzleRuntime` and its system, added after everything that moves
//   things. A scene with no puzzle starts nothing, so its world is exactly as it was. Call it once,
//   between steps, after the scene, mechanisms and the player exist. An undeclared solve is reported
//   through `report` (the dev log and telemetry sink): designers want to hear of routes they did not
//   plan.
// - `PuzzleWatch` publishes what the puzzles are doing for the e2e (#app[data-puzzles]).
//
// No puzzles, no cost: scenes without puzzle files never reach any of this.

import type { GameContent, SceneDef } from '@content/index';
import {
  puzzleSolvedUndeclared,
  PuzzleRuntime,
  puzzleSystem,
  type EntityId,
  type PuzzleDef,
  type PuzzleHost,
  type PuzzleStatus,
  type RecoveryDef,
  type SceneSpawnPlacement,
  type World,
} from '@sim/index';
import { breakableProfiles } from '../breakables';
import { propBodies } from '../physics-objects';
import { placeSpawn, type SpawnLoader } from '../scene/variants';

type Content = Pick<GameContent, 'all'>;

/** The sim's definitions of the puzzles content places in scene `sceneId`, in content order. */
export function puzzleDefs(content: Content, sceneId: string): PuzzleDef[] {
  return content
    .all('puzzle')
    .filter((puzzle) => puzzle.scene.id === sceneId)
    .map((puzzle) => ({
      id: puzzle.id,
      goal: puzzle.goal,
      repeatable: puzzle.policy.repeatable,
      entities: puzzle.entities.map(({ id, critical }) => ({ id, critical })),
      solutions: puzzle.solutions.map(({ id, capabilities }) => ({ id, capabilities })),
      ...(puzzle.discovery !== undefined && { discovery: puzzle.discovery }),
      recovery: puzzle.policy.recovery.map((policy): RecoveryDef => {
        if (policy.kind === 'respawn') return policy;
        // A reset returns the doors and switches the puzzle lists to the way their scene authored them.
        const { spawns } = content.all('scene').find((scene) => scene.id === sceneId) as SceneDef;
        const listed = new Set(puzzle.entities.map(({ id }) => id));
        return {
          kind: 'reset',
          trigger: policy.trigger,
          fact: policy.fact,
          mechanisms: spawns
            .filter((spawn) => listed.has(spawn.id))
            .flatMap(({ id, door, switch: own }) => [
              ...(door === undefined
                ? []
                : [
                    {
                      spawn: id,
                      door: {
                        open: door.state === 'open',
                        jammed: door.state === 'jammed',
                        locked: door.locked ?? door.lock !== undefined,
                      },
                    },
                  ]),
              ...(own === undefined ? [] : [{ spawn: id, switch: { position: own.initial } }]),
            ]),
        };
      }),
      outputs: {
        solvedFact: puzzle.outputs.solvedFact,
        set: puzzle.outputs.set,
        signals: puzzle.outputs.signals,
        rewards: puzzle.outputs.rewards,
      },
    }));
}

export interface StartPuzzlesOptions {
  /** The player: discovery volumes look for it, and its capability uses form the trail. */
  readonly player?: EntityId | undefined;
  /** Replaces lost critical entities (respawn policies); see `sceneHost`. */
  readonly host?: PuzzleHost | undefined;
  /** The height under which a critical object counts as out of the level, metres. */
  readonly killY?: number | (() => number) | undefined;
  /** Hears of puzzles solved by a route nobody declared (telemetry, the dev log). */
  readonly report?: ((line: string) => void) | undefined;
}

/**
 * Starts the puzzles of scene `sceneId` in `world`; undefined when it has none. Puzzles read the
 * world, the signals and the facts, so call it after the scene's entities, mechanisms and the
 * content's fact registry exist.
 */
export function startPuzzles(
  world: World<never>,
  content: Content,
  sceneId: string,
  options: StartPuzzlesOptions = {},
): PuzzleRuntime | undefined {
  const defs = puzzleDefs(content, sceneId);
  if (defs.length === 0) return undefined;
  const runtime = new PuzzleRuntime(world, defs, {
    player: options.player,
    host: options.host,
    killY: options.killY,
  });
  world.addSystem(puzzleSystem(runtime));
  world.events.on(puzzleSolvedUndeclared, ({ puzzle, trail, tick }) => {
    options.report?.(
      `puzzle ${puzzle} solved at tick ${String(tick)} by an undeclared route (capabilities used: ${trail.join(', ') || 'none'})`,
    );
  });
  return runtime;
}

/** A puzzle host whose new copies are drawn once `flush` is called (between sim steps). */
export interface SceneHost extends PuzzleHost {
  readonly flush: () => void;
}

/**
 * The puzzle host over a scene loader (mw-e15.7): a respawner drops a fresh copy of an authored prop
 * spawn where it began, and the runtime asks for the spot's footprint so a copy never lands in
 * another body. Interactions and breakables come with the copy as they did at load. The copy is made
 * inside the sim step (so it is part of the replay); its render object is bound by `flush`, which the
 * game calls after each step.
 */
export function sceneHost(
  world: World<never>,
  loader: SpawnLoader & {
    addSpawnToSim(spawn: SceneSpawnPlacement): EntityId;
    bindSpawn(spawn: SceneSpawnPlacement, entity: EntityId): void;
  },
  content: GameContent,
): SceneHost {
  const placement = (id: string) => loader.current?.authoredSpawns.find((spawn) => spawn.id === id);
  const bodies = propBodies(content);
  const profiles = breakableProfiles(content);
  const waiting: (() => void)[] = [];
  return {
    flush: () => {
      for (const bind of waiting.splice(0)) bind();
    },
    footprint: (id) => {
      const spawn = placement(id);
      const size = spawn?.prop === undefined ? undefined : bodies(spawn.prop)?.size;
      if (spawn === undefined || size === undefined) return undefined;
      const wide = Math.max(size.x, size.z) / 2;
      const { x, y, z } = spawn.position;
      return {
        centre: { x, y: y + size.y / 2, z },
        halfExtents: { x: wide, y: size.y / 2, z: wide },
      };
    },
    spawn: (id) => {
      const spawn = placement(id);
      if (spawn !== undefined && loader.current !== undefined) {
        placeSpawn(
          world,
          (placed) => {
            const entity = loader.addSpawnToSim(placed);
            waiting.push(() => {
              if (world.isAlive(entity)) loader.bindSpawn(placed, entity);
            });
            return entity;
          },
          profiles,
          spawn,
          loader.current,
        );
      }
    },
    remove: (id) => {
      loader.removeSpawn(id);
    },
  };
}

/** Publishes the puzzles' state when it changes: states, attributions and the entity ids they bind. */
export class PuzzleWatch {
  readonly #runtime: PuzzleRuntime;
  #json = '';

  constructor(runtime: PuzzleRuntime) {
    this.#runtime = runtime;
  }

  /** What the puzzles are doing now. */
  readout(): readonly PuzzleStatus[] {
    return this.#runtime.status();
  }

  /** The readout as JSON when it differs from the last call's, else undefined. */
  changed(): string | undefined {
    const json = JSON.stringify(this.readout());
    if (json === this.#json) return undefined;
    this.#json = json;
    return json;
  }
}
