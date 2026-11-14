// Rumours (mw-e39.23, story bible 6.2): a line the town or the harbour tells, true, half-true or false,
// pointing at a place, person or quest. One file per rumour at `src/content/data/rumor/<id>.json`, the id
// `rumor-<nn>-<slug>` where `<nn>` is the bible's two-digit rumour number (docs/narrative/content-conventions.md).
//
// The rumour system (pools, journal, resolution: mw-e22.11) and the valley set (1-12, mw-e39.12) build on
// this shape; this bead adds the type with the harbour rumours 13-18. A `target` is a glossary id
// (place, NPC or term) or a quest id; `src/content/types/rumor.test.ts` resolves it. A false rumour
// carries a `debunk` path (a way for the player to learn it is false). A harbour rumour carries a
// `secondHand` line so Dot, who has never been to Wendmouth, can repeat it without the game
// treating the player as having been there (`rumourPool`).

import { z } from 'zod';
import { contentId } from '../schema.ts';

export const RUMOR_TRUTHS = ['true', 'half', 'false'] as const;
export type RumorTruth = (typeof RUMOR_TRUTHS)[number];

/** Longest rumour line, as every in-game line (content-conventions: under 240 characters). */
export const RUMOR_MAX_LENGTH = 240;

const npcId = z.string().regex(/^npc-[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a glossary NPC id');

const debunkSchema = z
  .discriminatedUnion('via', [
    z.strictObject({
      via: z.literal('dive'),
      place: z
        .string()
        .regex(/^place-[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a glossary place id')
        .describe('Where the player goes to see for themselves.'),
    }),
    z.strictObject({
      via: z.literal('ask'),
      npc: npcId.describe('Who laughs it off or sets the player straight.'),
    }),
  ])
  .describe('One way to learn a rumour is false.');

export const rumorSchema = z
  .strictObject({
    id: contentId.describe('`rumor-<nn>-<slug>`; `<nn>` is the bible 6.2 number.'),
    notes: z.string().min(1).describe('Author-facing: what it points at and why it is told.'),
    region: z
      .enum(['valley', 'harbour'])
      .describe('Where it circulates: the valley (1-12, 19-20) or the river and harbour (13-18).'),
    source: z.array(npcId).min(1).describe('The NPCs who tell it first-hand (glossary NPC ids).'),
    sourceTags: z
      .array(z.string().regex(/^[a-z]+(?:-[a-z]+)*$/))
      .optional()
      .describe('Crowd sources, e.g. "tidemarket" for gossip with no single teller.'),
    truth: z.enum(RUMOR_TRUTHS).describe('Whether the rumour is true, half-true or false.'),
    target: z
      .string()
      .regex(
        /^(?:place|npc|term|quest)-[a-z0-9]+(?:-[a-z0-9]+)*$/,
        'must be a glossary or quest id',
      )
      .describe('What it points at: a glossary place, NPC or term id, or a quest id.'),
    text: z
      .string()
      .min(1)
      .max(RUMOR_MAX_LENGTH)
      .describe('The rumour as it is told, in the bible.'),
    secondHand: z
      .strictObject({
        teller: npcId.describe('Who repeats it second-hand (Dot, in the valley).'),
        text: z.string().min(1).max(RUMOR_MAX_LENGTH),
      })
      .optional()
      .describe(
        'How a valley teller repeats it; hearing it this way never marks the target visited.',
      ),
    followUp: z
      .strictObject({
        teller: npcId.describe('Who trades the line back (Dot).'),
        text: z.string().min(1).max(RUMOR_MAX_LENGTH),
      })
      .optional()
      .describe(
        'The line Dot trades back once, when the player has visited the target (confirms a true rumour, debunks a false one).',
      ),
    debunk: z
      .array(debunkSchema)
      .min(1)
      .optional()
      .describe('Required when false: the ways the player can learn it is false.'),
  })
  .superRefine((rumor, ctx) => {
    const issue = (path: string[], message: string) => {
      ctx.addIssue({ code: 'custom', path, message });
    };
    if (!/^rumor-\d{2}-/.test(rumor.id)) issue(['id'], 'a rumour id is `rumor-<nn>-<slug>`');
    if (rumor.truth === 'false' && rumor.debunk === undefined) {
      issue(['debunk'], 'a false rumour has a debunk path');
    }
    if (rumor.truth === 'true' && rumor.debunk !== undefined) {
      issue(['debunk'], 'only a false or half-true rumour has a debunk path');
    }
    if (rumor.region === 'harbour' && rumor.secondHand === undefined) {
      issue(['secondHand'], 'a harbour rumour has a second-hand line for the valley');
    }
  })
  .describe('A rumour (story bible 6.2): source, truth value and target (mw-e39.23).');

export type Rumor = z.output<typeof rumorSchema>;

/** Goblin standing values (`goblins.standing`); the bible's "wary" ships as `neutral`. */
export type GoblinStanding = 'hostile' | 'neutral' | 'friendly';

const GOBLIN_TELLERS = ['npc-kettleback', 'npc-snig'];

/** A rumour only the goblins tell (a goblin first-hand source or the `goblins` crowd tag). */
export function isGoblinRumour(rumor: Rumor): boolean {
  return (
    rumor.source.some((s) => GOBLIN_TELLERS.includes(s)) ||
    (rumor.sourceTags ?? []).includes('goblins')
  );
}

/** Whether a rumour may be offered at all: no goblin-sourced rumour while the goblins are hostile. */
export function rumourAvailable(rumor: Rumor, goblins: GoblinStanding): boolean {
  return !(isGoblinRumour(rumor) && goblins === 'hostile');
}

/**
 * The line Dot trades back for a rumour once the player has visited its target: offered once only
 * (`delivered` holds the ids already traded back).
 */
export function followUpLine(
  rumor: Rumor,
  visited: ReadonlySet<string>,
  delivered: ReadonlySet<string>,
): string | undefined {
  if (rumor.followUp === undefined) return undefined;
  if (!visited.has(rumor.target) || delivered.has(rumor.id)) return undefined;
  return rumor.followUp.text;
}

/** What Dot says when she has no rumour left to trade; nothing is charged. */
export const ALL_KNOWN_LINE =
  "Love, you've heard everything I have and half of what I made up. Keep your coin.";

/** The next rumour Dot can trade, or the fallback line and no cost when `known` holds them all. */
export function dotTrade(
  rumors: readonly Rumor[],
  known: ReadonlySet<string>,
  goblins: GoblinStanding,
): { rumor: Rumor | undefined; line: string | undefined; coinTaken: 0 } {
  const next = rumors.find(
    (r) => !known.has(r.id) && rumourAvailable(r, goblins) && !isGoblinRumour(r),
  );
  return { rumor: next, line: next === undefined ? ALL_KNOWN_LINE : undefined, coinTaken: 0 };
}

/** A rumour as a teller offers it. */
export interface HeardRumor {
  readonly id: string;
  readonly text: string;
  readonly secondHand: boolean;
  /** Target the hearing marks as visited: always none for a second-hand line. */
  readonly marksVisited: string | undefined;
}

/**
 * The harbour rumours `teller` may offer. A teller who is a first-hand source gives the rumour's own
 * text; a teller in the valley gives the `secondHand` line, and only when the player has not been to the
 * harbour (`visitedHarbour`). Hearing a rumour second-hand never marks its target visited.
 */
export function rumourPool(
  rumors: readonly Rumor[],
  teller: string,
  visitedHarbour: boolean,
): HeardRumor[] {
  const heard: HeardRumor[] = [];
  for (const rumor of rumors) {
    if (rumor.region !== 'harbour') continue;
    if (rumor.source.includes(teller)) {
      heard.push({ id: rumor.id, text: rumor.text, secondHand: false, marksVisited: rumor.target });
    } else if (rumor.secondHand?.teller === teller && !visitedHarbour) {
      heard.push({
        id: rumor.id,
        text: rumor.secondHand.text,
        secondHand: true,
        marksVisited: undefined,
      });
    }
  }
  return heard;
}
