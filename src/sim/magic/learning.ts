// Learning a spell (mw-e07.2): the one door every teacher uses. A book that has been studied, a
// trainer, a deed or a debug command all call `SpellLearning.learn`; none of them touches
// `magic.known` or the capability registry itself, so "what learning a spell means" lives here once:
//
// - the spell enters the learner's known spells (`magic.known`), which is what the cast pipeline reads;
// - its capability `spell.<id>` is granted (ADR-0004, books.md): through the unlock book when an
//   unlock is defined for it (so prerequisites and requirements bind), otherwise straight from the
//   registry with the permanent `learned` source. A spell with no declared capability (a test
//   fixture) is simply known;
// - `SpellLearned {actor, spellId, source}` is emitted once. Learning a known spell is a no-op.
//
// `source` is who taught it: a book's item id, or `trainer:<id>` and the like. `channel` is the
// unlock channel (`book:<id>`) the unlock book checks; it defaults to `source` as a book channel.

import type { EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { World } from '../core/world';
import { LEARNED_SOURCE } from '../progression/unlocks';
import type { CapabilityRegistry } from '../progression/capabilities';
import type { LearnRefusal, UnlockBook } from '../progression/unlocks';
import { knowsSpell, learnSpell } from './components';

/** An actor learned a spell (once per spell; never for a spell already known). */
export interface SpellLearnedInfo {
  readonly tick: number;
  readonly actor: EntityId;
  readonly spellId: string;
  /** Who taught it: a book's item id, or `trainer:<id>`. */
  readonly source: string;
}
export const SpellLearned = defineEvent<SpellLearnedInfo>('SpellLearned');

/** The capability that stands for knowing a spell (ADR-0004). */
export const spellCapability = (spell: string): string => `spell.${spell}`;

/** What a learn attempt did. */
export type SpellLearnResult =
  | { readonly status: 'learned' }
  /** Already known: nothing changed and nothing was emitted. */
  | { readonly status: 'already-known' }
  /** The unlock book refused (missing prerequisite…). Nothing changed. */
  | { readonly status: 'refused'; readonly refusals: readonly LearnRefusal[] };

/** The registries learning goes through; both optional (a world without progression just knows). */
export interface SpellLearningOptions {
  readonly capabilities?: CapabilityRegistry;
  readonly unlocks?: UnlockBook;
}

export class SpellLearning {
  readonly #capabilities: CapabilityRegistry | undefined;
  readonly #unlocks: UnlockBook | undefined;

  constructor(options: SpellLearningOptions = {}) {
    this.#capabilities = options.capabilities;
    this.#unlocks = options.unlocks;
  }

  /**
   * Whether `actor` could learn `spell` through `channel` right now, without learning it. Only the
   * unlock book can refuse (prerequisites, requirements, rules).
   * @throws RangeError for a malformed channel when an unlock defines the spell's capability.
   */
  check(world: World<never>, actor: EntityId, spell: string, channel: string): SpellLearnResult {
    if (knowsSpell(world, actor, spell)) return { status: 'already-known' };
    const capability = spellCapability(spell);
    if (this.#unlocks?.unlockFor(capability) !== undefined) {
      const result = this.#unlocks.check(world, actor, capability, channel);
      if (result.status === 'refused') return result;
    }
    return { status: 'learned' };
  }

  /**
   * Teaches `spell` to `actor`. A refusal changes nothing. Call it outside a step, or on an actor
   * that already has `magic.known` (`addStudent` gives it to the player up front).
   * @throws RangeError for a malformed channel when an unlock defines the spell's capability, or an
   *   actor without a capability set when the capability is declared.
   */
  learn(
    world: World<never>,
    actor: EntityId,
    spell: string,
    source: string,
    channel = `book:${source}`,
  ): SpellLearnResult {
    const checked = this.check(world, actor, spell, channel);
    if (checked.status !== 'learned') return checked;
    const capability = spellCapability(spell);
    if (this.#unlocks?.unlockFor(capability) !== undefined) {
      this.#unlocks.learn(world, actor, capability, channel);
    } else if (this.#capabilities?.isDefined(capability) === true) {
      this.#capabilities.grant(world, actor, capability, LEARNED_SOURCE);
    }
    learnSpell(world, actor, spell);
    world.events.emit(SpellLearned, { tick: world.tick, actor, spellId: spell, source });
    return { status: 'learned' };
  }
}
