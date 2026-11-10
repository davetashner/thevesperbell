// Puzzle goals at run time (mw-e15.2): a goal is a condition (src/sim/facts/conditions.ts) over live
// world properties, signals, entities and facts, so any way of reaching the outcome counts. The
// runtime compiles each goal once, then keeps its result current without re-reading the world every
// tick: facts, properties and tags announce changes by event, and `poll` (the `puzzleGoalSystem`, run
// after the systems that move things) re-checks only what no event announces — a signal output that
// flipped, entities that appeared or vanished, a volume to look in, a hold that came due. A goal none
// of that touches is never evaluated. Goals are in-memory watches: after `World.restore`, call
// `refresh` (a `sustained` hold then starts over). `explain` gives the readable account designers
// and hints read.

import type { System, World } from '../core/world';
import {
  CompiledCondition,
  compileCondition,
  formatExplanation,
  onConditionChanged,
  type Condition,
  type ConditionSubscription,
} from '../facts/conditions';
import { conditionHost, worldLiveReader } from '../facts/live';

/** Called when a goal's result changes, with the new result and the sim tick it changed on. */
export type GoalCallback = (met: boolean, tick: number) => void;

/** The goals of one world. */
export class GoalRuntime {
  readonly #world: World<never>;
  readonly #goals = new Map<string, ConditionSubscription>();

  constructor(world: World<never>) {
    this.#world = world;
  }

  /** The ids of the goals being watched, in the order they were added. */
  get ids(): readonly string[] {
    return [...this.#goals.keys()];
  }

  /**
   * Starts watching `goal` under `id`. It is compiled and evaluated now; `onChange` runs when its
   * result changes (not for the initial result: read `met`).
   * @throws ConditionError for a malformed goal; Error when `id` is already watched.
   */
  add(id: string, goal: Condition | CompiledCondition, onChange?: GoalCallback): void {
    if (this.#goals.has(id)) throw new Error(`goal "${id}" is already watched`);
    const compiled = goal instanceof CompiledCondition ? goal : compileCondition(goal);
    this.#goals.set(
      id,
      onConditionChanged(conditionHost(this.#world), compiled, (met) => {
        onChange?.(met, this.#world.tick);
      }),
    );
  }

  /** Stops watching goal `id`; false when it was not watched. */
  remove(id: string): boolean {
    const goal = this.#goals.get(id);
    goal?.unsubscribe();
    return this.#goals.delete(id);
  }

  /** Whether goal `id` is met (as of the last evaluation). */
  met(id: string): boolean {
    return this.#subscription(id).value;
  }

  /** The compiled goal `id`, with its dependencies. */
  compiled(id: string): CompiledCondition {
    return this.#subscription(id).condition;
  }

  /**
   * Each sub-condition of goal `id` and whether it holds now, one per line, indented by nesting:
   * for debug tools and hints ("2 of 3 braziers burn").
   */
  explain(id: string): string {
    const { condition } = this.#subscription(id);
    return formatExplanation(condition.explain(this.#world.facts, worldLiveReader(this.#world)));
  }

  /** Re-checks what events cannot announce; the `puzzleGoalSystem` calls it every tick. */
  poll(): void {
    for (const goal of this.#goals.values()) goal.poll();
  }

  /** Re-evaluates every goal now (after `World.restore`, which changes state without events). */
  refresh(): void {
    for (const goal of this.#goals.values()) goal.refresh();
  }

  /** Stops watching every goal. */
  dispose(): void {
    for (const goal of this.#goals.values()) goal.unsubscribe();
    this.#goals.clear();
  }

  #subscription(id: string): ConditionSubscription {
    const goal = this.#goals.get(id);
    if (goal === undefined) throw new Error(`goal "${id}" is not watched`);
    return goal;
  }
}

/** The system that polls a runtime's goals; add it after movement, stimuli, elements and signals. */
export function puzzleGoalSystem<TInput>(runtime: GoalRuntime): System<TInput> {
  return {
    name: 'puzzle-goals',
    run: () => {
      runtime.poll();
    },
  };
}
