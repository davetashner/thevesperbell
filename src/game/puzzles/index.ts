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

import type { GameContent } from '@content/index';
import {
  puzzleSolvedUndeclared,
  PuzzleRuntime,
  puzzleSystem,
  type EntityId,
  type PuzzleDef,
  type PuzzleStatus,
  type World,
} from '@sim/index';

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
  const runtime = new PuzzleRuntime(world, defs, { player: options.player });
  world.addSystem(puzzleSystem(runtime));
  world.events.on(puzzleSolvedUndeclared, ({ puzzle, trail, tick }) => {
    options.report?.(
      `puzzle ${puzzle} solved at tick ${String(tick)} by an undeclared route (capabilities used: ${trail.join(', ') || 'none'})`,
    );
  });
  return runtime;
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
