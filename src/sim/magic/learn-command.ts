// The learn-spell command (mw-e06.15): the one way outside code teaches a caster a spell while
// the sim runs. Books, scrolls and trainers (mw-ju8.17, E08) will issue the same command; until
// then the debug console's `spell learn` does. Like every input it is plain JSON fed to
// `World.step`, so a recording replays it on the same tick.

import type { EntityId } from '../core/component';
import type { System, World } from '../core/world';
import { KnownSpellsComponent, learnSpell } from './components';
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

/**
 * Makes `world` act on `learn-spell` commands. A spell `pipeline` does not know, and a caster that
 * is gone, are ignored (a stale command from a recording must not throw). Add it before the
 * casting system so a spell learned in a tick can be cast in the next. Call once at setup, outside
 * a step.
 */
export function installSpellLearning<TInput>(world: World<TInput>, pipeline: SpellPipeline): void {
  const w: World<never> = world;
  const system: System<TInput> = {
    name: 'spell-learning',
    run: ({ inputs }) => {
      // A caster with no spells yet gets its component added at the end of the tick (adds are
      // deferred inside a step), so what several commands teach it in one tick is gathered first.
      const first = new Map<EntityId, string[]>();
      for (const input of inputs) {
        if (!isLearnSpellCommand(input)) continue;
        if (pipeline.spells(input.spell) === undefined || !w.isAlive(input.caster)) continue;
        if (w.has(input.caster, KnownSpellsComponent)) {
          learnSpell(w, input.caster, input.spell);
          continue;
        }
        const spells = first.get(input.caster) ?? [];
        if (!spells.includes(input.spell)) spells.push(input.spell);
        first.set(input.caster, spells);
      }
      for (const [caster, spells] of first) w.add(caster, KnownSpellsComponent, { spells });
    },
  };
  world.addSystem(system);
}
