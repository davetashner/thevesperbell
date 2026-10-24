// The learn-spell command (mw-e06.15): the one way outside code teaches a caster a spell while the
// sim runs. The debug console's `spell learn` sends it; like every input it is plain JSON fed to
// `World.step`, so a recording replays it on the same tick. What learning means (the known list, the
// capability, the SpellLearned event) is `SpellLearning`'s (learning.ts); this system only calls the
// `learn` it is given.

import type { EntityId } from '../core/component';
import type { System, World } from '../core/world';
import type { SpellPipeline } from './pipeline';

/** The `learn-spell` input command: `caster` learns `spell` (a no-op for an unknown spell id). */
export interface LearnSpellCommand {
  readonly type: 'learn-spell';
  readonly caster: EntityId;
  readonly spell: string;
}

/** Builds the command that teaches `caster` `spell`. */
export function learnSpellCommand(caster: EntityId, spell: string): LearnSpellCommand {
  return { type: 'learn-spell', caster, spell };
}

/** Whether an input command is a learn-spell command. */
export function isLearnSpellCommand(input: unknown): input is LearnSpellCommand {
  return (
    typeof input === 'object' &&
    input !== null &&
    (input as { type?: unknown }).type === 'learn-spell'
  );
}

/** Teaches `actor` `spell`; called inside a step, so `actor` must already have `magic.known`. */
export type SpellLearner = (world: World<never>, actor: EntityId, spell: string) => void;

/**
 * Makes `world` act on `learn-spell` commands through `learn`. A spell `pipeline` does not know, and
 * a caster that is gone, are ignored (a stale command from a recording must not throw). Call once at
 * setup, outside a step.
 */
export function installSpellLearning<TInput>(
  world: World<TInput>,
  pipeline: SpellPipeline,
  learn: SpellLearner,
): void {
  const w: World<never> = world;
  const system: System<TInput> = {
    name: 'spell-learning',
    run: ({ inputs }) => {
      for (const input of inputs) {
        if (!isLearnSpellCommand(input)) continue;
        if (pipeline.spells(input.spell) === undefined || !w.isAlive(input.caster)) continue;
        learn(w, input.caster, input.spell);
      }
    },
  };
  world.addSystem(system);
}
