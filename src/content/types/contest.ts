// Contests as data (mw-e40.5): `src/content/data/contest/<id>.json`, one contest per file. A contest
// is a bounded event the player enters (arm-wrestling at the Drowned Gull, a Tidefair event): an
// `entry` gate and fee, the `participants` the player competes against, `scoring` rules that turn sim
// events into points, a `finish` (first to a score, or a time limit), and the outcomes: `win`,
// `lose` (losing gracefully has its own effects) and, when someone cheats and is seen,
// `disqualified`. `cheats` are rules over events ("magic used") with the creatures who would notice:
// cheating is always possible and always has a consequence (story bible 6.1, quest 7), whether or
// not it is seen. `betting` is a bookmaker's offer: a stake on the player at fixed odds, or a bribe
// to throw the match with a payout if you lose and a grudge if you win.
//
// Conditions and effects are the shared logic DSL (src/sim/logic). Only their shape is checked
// here; kinds, fields and content references are validated by src/sim/contest/validate.ts (content
// may not import the sim at runtime). The runner is src/sim/contest/runtime.ts. The field
// reference docs/content/contest-schema.md is generated (`pnpm content:docs`).

import { z } from 'zod';
import type { Frozen } from '../loader.ts';
import { contentId, ref } from '../schema.ts';

const localId = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be lowercase kebab-case, e.g. "big-oona"');
const eventName = z
  .string()
  .regex(
    /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/,
    'must be a dotted lowercase event name, e.g. "arrow.hit"',
  );
const text = z.string().min(1);
const note = z.string().min(1).optional().describe('A note for writers; never shown to players.');

const logicNode = z
  .looseObject({ kind: z.string().min(1).describe('The logic kind, e.g. "gold".') })
  .describe('A logic DSL node: an object with a `kind` and that kind’s fields.');
const effects = z
  .array(logicNode)
  .min(1)
  .describe('Effects (logic DSL) applied together: all or nothing.');

const eventMatch = {
  event: eventName.describe('The sim event the rule listens for, as reported to the runner.'),
  where: z
    .record(z.string().min(1), z.union([z.string(), z.number(), z.boolean()]))
    .default({})
    .describe('Fields the event data must equal, e.g. `{ "targetTag": "gull" }`.'),
};

const participantSchema = z
  .strictObject({
    id: localId.describe('Id of the participant in this contest; events name it as `actor`.'),
    name: text.describe('Shown in the standings.'),
    creature: ref('creature').optional().describe('The NPC competing, when there is one.'),
    pace: z
      .strictObject({
        everyTicks: z.int().min(1).describe('Ticks between scores.'),
        points: z.int().min(1).describe('Points per score.'),
        spread: z
          .int()
          .min(0)
          .default(0)
          .describe('Up to this many extra points, drawn from the seeded stream.'),
      })
      .optional()
      .describe('Scores on its own at this pace. Omit: scored only by reported events.'),
  })
  .describe('A rival.');

const scoringSchema = z
  .strictObject({
    ...eventMatch,
    points: z
      .int()
      .refine((n) => n !== 0, 'must not be zero')
      .describe('Added to the actor.'),
    note,
  })
  .describe('Turns a matching event into points for the actor who caused it.');

const cheatSchema = z
  .strictObject({
    id: localId,
    ...eventMatch,
    when: logicNode
      .optional()
      .describe('Extra condition (logic DSL) that must hold as it happens.'),
    observedBy: z
      .array(ref('creature'))
      .min(1)
      .describe('Creatures who would catch it. The first that perceives the event does.'),
    bonusPoints: z
      .int()
      .min(0)
      .default(0)
      .describe('What the cheat is worth to the player; voided on disqualification.'),
    detected: z
      .strictObject({
        disqualify: z.boolean().default(true).describe('Remove the player from the contest.'),
        effects: effects.optional().describe('Applied when it is caught (a fine, a grudge).'),
      })
      .refine((d) => d.disqualify || d.effects !== undefined, {
        message: 'a caught cheat must disqualify or have effects',
      })
      .describe('What happens when a watcher perceives it.'),
    undetected: z
      .strictObject({
        effects: effects.describe(
          'Applied when the contest ends and nobody caught it: cheating always has a consequence.',
        ),
      })
      .describe('What a cheat nobody saw still costs.'),
    note,
  })
  .describe('A way to cheat, and who would notice.');

const stake = z.int().min(1);

const bettingSchema = z
  .strictObject({
    book: ref('creature').describe('Who runs the book.'),
    onPlayer: z
      .strictObject({
        minStake: stake,
        maxStake: stake,
        odds: z
          .strictObject({ numerator: stake, denominator: stake })
          .describe(
            'Winnings are stake x numerator / denominator (rounded down), plus the stake back.',
          ),
      })
      .refine((b) => b.minStake <= b.maxStake, { message: 'minStake must not exceed maxStake' })
      .optional()
      .describe('A stake on the player winning, paid at fixed odds.'),
    throwMatch: z
      .strictObject({
        payout: effects.describe('Applied when the player loses (a clean loss).'),
        grudge: effects.describe('Applied when the player wins, or is disqualified, instead.'),
      })
      .optional()
      .describe('The book pays the player to lose.'),
  })
  .refine((b) => b.onPlayer !== undefined || b.throwMatch !== undefined, {
    message: 'a book offers at least one of onPlayer, throwMatch',
  })
  .describe('The betting book.');

/** Schema of one contest, `src/content/data/contest/<id>.json`. */
export const contestSchema = z
  .strictObject({
    id: contentId,
    name: text.describe('The contest’s name.'),
    notes: note,
    entry: z
      .strictObject({
        fee: z.int().min(0).default(0).describe('Gold paid to enter.'),
        when: logicNode.optional().describe('Condition (logic DSL) to be let in. Omit: anyone.'),
        effects: effects.optional().describe('Applied with the fee as the player enters.'),
      })
      .describe('Who may enter and what it costs.'),
    participants: z
      .array(participantSchema)
      .min(1)
      .refine((list) => new Set(list.map((p) => p.id)).size === list.length, {
        message: 'participant ids must be unique',
      })
      .refine((list) => list.every((p) => p.id !== 'player'), {
        message: '"player" is the player, not a rival',
      })
      .describe('The rivals; the player is always entered.'),
    scoring: z.array(scoringSchema).min(1).describe('How events turn into points.'),
    finish: z
      .strictObject({
        firstTo: z.int().min(1).optional().describe('Ends the moment anyone reaches this score.'),
        afterTicks: z.int().min(1).optional().describe('Ends this many ticks after it starts.'),
      })
      .refine((f) => f.firstTo !== undefined || f.afterTicks !== undefined, {
        message: 'give `firstTo` or `afterTicks`',
      })
      .describe('When it ends.'),
    win: z
      .strictObject({
        placement: z.int().min(1).default(1).describe('Placing this high or better wins.'),
        effects: effects.describe('Prizes and reputation.'),
      })
      .describe('The player placed.'),
    lose: z
      .strictObject({ effects: effects.describe('What losing gracefully earns.') })
      .describe('The player did not place, or forfeited.'),
    disqualified: z
      .strictObject({ effects: effects.describe('On top of whatever the cheat itself costs.') })
      .optional()
      .describe('The player was disqualified.'),
    cheats: z
      .array(cheatSchema)
      .default([])
      .refine((list) => new Set(list.map((c) => c.id)).size === list.length, {
        message: 'cheat ids must be unique',
      })
      .describe('Ways to cheat. Cheating is always possible and always has a consequence.'),
    betting: bettingSchema.optional(),
  })
  .describe('A contest.');

/** A contest as written in JSON. */
export type ContestDefInput = z.input<typeof contestSchema>;
/** A validated contest. */
export type ContestDef = z.output<typeof contestSchema>;
/** A loaded (deeply frozen) contest. */
export type ContestEntry = Frozen<ContestDef>;
