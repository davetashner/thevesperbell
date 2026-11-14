// The concrete layer of the puzzle solver (mw-e15.6): a declared solution's step list executed in the
// headless sim through the paths a player or the integration tests use, to confirm the puzzle's goal
// becomes true. The scene loads through the game's own wiring (`createGameWorld`: Rapier physics,
// mechanisms, fire rules, spells, the puzzle runtime), so what runs is what ships.
//
// Step vocabulary (the puzzle schema's abstract steps) and what each does:
//   stimulus  with a spell capability whose spell emits that element: the player learns the spell and
//             casts it at the target; otherwise the element is applied to the target by contact (a
//             torch, a hand). Expects the target to take it (heat: it burns).
//   move      the target is carried or pushed to the destination: teleported beside it (the physics
//             body goes with it), then the world runs for a while. Expects it to end up there.
//   interact  the player uses the target's primary affordance, which must be the step's verb.
//   reach     the player is put beside the target (always possible: there is no pathing yet).
//   wait      the world runs for the seconds.
// After the last step the world runs on for `settleSeconds` (holds such as "burning for a second"
// need time). The run stops as soon as the puzzle is solved. A failure names the step index (from 0)
// where the run diverged from the script, or says the goal never came true.

import type * as Rapier from '@dimforge/rapier3d-deterministic';
import type { Frozen, GameContent, Puzzle as PuzzleDef } from '@content/index';

type Puzzle = Frozen<PuzzleDef>;
import { installFactRegistry } from '@game/facts';
import {
  applyStimulus,
  interactRemotely,
  learnSpell,
  PlacementComponent,
  readProperty,
  remoteAffordance,
  teleportCommand,
  type EntityId,
  type World,
} from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';

export type ConcreteResult =
  | { readonly status: 'confirmed'; readonly ticks: number }
  | {
      readonly status: 'diverged';
      /** Index (from 0) of the step the run diverged at; undefined: every step ran, the goal stayed false. */
      readonly step?: number;
      readonly reason: string;
    };

export interface ConcreteOptions {
  /** Seconds the world runs on after the last step for holds to finish. */
  readonly settleSeconds: number;
  /** Ticks per second. */
  readonly hz: number;
}

export const DEFAULT_CONCRETE: ConcreteOptions = { settleSeconds: 6, hz: 60 };

const NEARBY = 2.5;
/** Seconds the world runs after a step that acts on it, for flames to spread and bodies to settle. */
const STEP_SECONDS = 1.5;

type Step = Puzzle['solutions'][number]['steps'][number];

/** Runs `solution` of `puzzle` headlessly and reports whether the goal came true. */
export function runSolution(
  rapier: typeof Rapier,
  content: GameContent,
  puzzle: Puzzle,
  solution: Puzzle['solutions'][number],
  options: ConcreteOptions = DEFAULT_CONCRETE,
): ConcreteResult {
  const game = createGameWorld<unknown>(rapier, {
    seed: 1,
    hz: options.hz,
    scene: puzzle.scene.id,
    magic: true,
    content,
  });
  const sim = game.world as unknown as World<never>;
  installFactRegistry(sim.facts, content);
  const { puzzles, player } = game;
  if (puzzles === undefined) {
    return { status: 'diverged', reason: `scene "${puzzle.scene.id}" runs no puzzles` };
  }
  const bound = new Map<string, EntityId>();
  for (const { entity, spawn } of game.scene.spawns) bound.set(spawn.id, entity);
  const elementsOf = new Map(
    content
      .all('spell')
      .map((spell) => [
        `spell.${spell.id}`,
        spell.effects.flatMap((e) => (e.op === 'stimulus' ? [e.element as string] : [])),
      ]),
  );
  let ticks = 0;
  const run = (seconds: number): boolean => {
    for (let i = 0; i < Math.round(seconds * options.hz); i++) {
      game.world.step();
      ticks++;
      if (puzzles.state(puzzle.id) === 'solved') return true;
    }
    return puzzles.state(puzzle.id) === 'solved';
  };
  const where = (id: EntityId) => sim.get(id, PlacementComponent);
  const near = (a: EntityId, b: EntityId): boolean => {
    const pa = where(a);
    const pb = where(b);
    return (
      pa !== undefined &&
      pb !== undefined &&
      Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z) <= NEARBY
    );
  };
  const beside = (id: EntityId) => {
    const at = where(id);
    return at === undefined
      ? undefined
      : teleportCommand(player, { x: at.x + 0.75, y: at.y, z: at.z });
  };

  /** Performs one step; returns why it diverged, or undefined. */
  const perform = (step: Step): string | undefined => {
    if (step.do === 'wait') {
      run(step.seconds);
      return undefined;
    }
    const target = step.target === 'player' ? player : bound.get(step.target);
    if (target === undefined) return `the scene has no entity "${step.target}"`;
    if (step.do === 'reach') {
      const command = beside(target);
      if (command === undefined) return `"${step.target}" has no placement to reach`;
      game.world.step([command]);
      run(0.1);
      return undefined;
    }
    if (step.do === 'interact') {
      const found = remoteAffordance(sim, player, target);
      if (found?.verb !== step.verb) {
        return `"${step.target}" offers ${found === undefined ? 'nothing' : `"${found.verb}"`} to the player, not "${step.verb}"`;
      }
      interactRemotely(sim, player, target);
      run(STEP_SECONDS);
      return undefined;
    }
    if (step.do === 'move') {
      const to = bound.get(step.to);
      if (to === undefined) return `the scene has no entity "${step.to}"`;
      const dest = where(to);
      if (dest === undefined) return `"${step.to}" has no placement to move to`;
      game.world.step([teleportCommand(target, { x: dest.x + 0.5, y: dest.y, z: dest.z })]);
      run(STEP_SECONDS);
      return near(target, to) ? undefined : `"${step.target}" did not end up at "${step.to}"`;
    }
    // stimulus
    const spell = step.using === undefined ? undefined : elementsOf.get(step.using);
    const at = where(target);
    if (step.using !== undefined && spell?.includes(step.element) === true && at !== undefined) {
      const id = step.using.slice('spell.'.length);
      learnSpell(sim, player, id);
      game.world.step([
        { type: 'cast', caster: player, spell: id, aim: { x: at.x, y: at.y, z: at.z } },
      ]);
    } else {
      applyStimulus(sim, {
        shape: { kind: 'contact', target },
        element: step.element,
        intensity: 500,
        source: player,
      });
    }
    run(STEP_SECONDS);
    if (step.element === 'heat' && !readProperty(sim, target, 'burning')) {
      return `"${step.target}" did not catch fire`;
    }
    return undefined;
  };

  for (const [index, step] of solution.steps.entries()) {
    const problem = perform(step);
    if (puzzles.state(puzzle.id) === 'solved') return { status: 'confirmed', ticks };
    if (problem !== undefined) return { status: 'diverged', step: index, reason: problem };
  }
  if (run(options.settleSeconds)) return { status: 'confirmed', ticks };
  return {
    status: 'diverged',
    reason: `every step ran but the goal stayed false: ${puzzles.explain(puzzle.id)}`,
  };
}
