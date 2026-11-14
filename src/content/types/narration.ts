// Narration (mw-e39.16, story bible 4.1 and 4.4): the text that is shown rather than spoken. The title
// card, the arrival and the bounty board, the first night, the barge rides, and the ending cards and
// epilogue slides. One file per sequence group at `src/content/data/narration/narration-<slug>.json`.
//
// A sequence is a short run of pages shown in order. The epilogue slideshow (mw-e39.40) reads the active
// objectives of `quest-briar-glen-epilogue` and looks each one up here with `epilogueSlide`: a slide's
// sequence id is the objective id, so the objective's `activeWhen` decides whether it shows and this file
// supplies what it says. The `facts` of a slide name the world facts that choose it, and
// `src/content/types/narration.test.ts` checks them against the objective.

import { z } from 'zod';
import { contentId } from '../schema.ts';

export const NARRATION_KINDS = [
  'title',
  'arrival',
  'first-night',
  'barge',
  'ending',
  'epilogue',
] as const;
export type NarrationKind = (typeof NARRATION_KINDS)[number];

/** The four headline endings (bible 4.4), as the main quest's `ending.headline` fact spells them. */
export const HEADLINE_ENDINGS = [
  'vespers-rung',
  'last-warden',
  'hirelings-silence',
  'long-vespers',
] as const;
export type HeadlineEnding = (typeof HEADLINE_ENDINGS)[number];

/** Longest ending card or epilogue slide, in words (mw-e39.16: each slide at most 60 words). */
export const SLIDE_MAX_WORDS = 60;
/** Longest page of any other narration, in words: a card the player reads in one go. */
export const PAGE_MAX_WORDS = 90;
/** The beat every first-night variant ends on (bible 4.1 beat 2: "the beat always ends with the horned shadow"). */
export const HORNED_SHADOW_BEAT = 'horned-shadow';

/** Number of words in `text`. */
export const wordCount = (text: string): number => text.split(/\s+/).filter(Boolean).length;

const localId = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be lowercase kebab-case');
const factKey = z
  .string()
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/,
    'must be a fact key `<subject>.<state>`',
  );

const pageSchema = z.strictObject({
  text: z.string().min(1).describe('The page as the player reads it.'),
  beat: z
    .string()
    .regex(/^[a-z]+(?:-[a-z]+)*$/)
    .optional()
    .describe('A named story beat this page lands (the first night ends on `horned-shadow`).'),
});

const sequenceSchema = z.strictObject({
  id: localId.describe('Unique in the file. An epilogue slide uses its objective id.'),
  title: z.string().min(1).max(60).optional().describe('Heading of the card, if it has one.'),
  notes: z.string().min(1).optional().describe('Author-facing: when it is shown.'),
  endings: z
    .array(z.enum(HEADLINE_ENDINGS))
    .min(1)
    .optional()
    .describe('Ending cards and epilogue slides: the headline endings it can appear in.'),
  facts: z
    .array(factKey)
    .optional()
    .describe(
      'Epilogue slides: the world facts that choose it (besides `ending.headline`); empty when only the ending does.',
    ),
  pages: z.array(pageSchema).min(1).describe('The pages, in the order they are shown.'),
});
export type NarrationSequence = z.output<typeof sequenceSchema>;

export const narrationSchema = z
  .strictObject({
    id: contentId.describe('`narration-<slug>`.'),
    kind: z
      .enum(NARRATION_KINDS)
      .describe('What the sequences are, which sets the rules they follow.'),
    notes: z
      .string()
      .min(1)
      .describe('Author-facing: what this file covers and where it is shown.'),
    sequences: z.array(sequenceSchema).min(1),
  })
  .superRefine((entry, ctx) => {
    const issue = (path: (string | number)[], message: string) => {
      ctx.addIssue({ code: 'custom', path, message });
    };
    if (!entry.id.startsWith('narration-')) issue(['id'], 'a narration id is `narration-<slug>`');
    const slides = entry.kind === 'ending' || entry.kind === 'epilogue';
    const seen = new Set<string>();
    entry.sequences.forEach((sequence, s) => {
      if (seen.has(sequence.id))
        issue(['sequences', s, 'id'], `duplicate sequence id "${sequence.id}"`);
      seen.add(sequence.id);
      if (slides && sequence.endings === undefined) {
        issue(
          ['sequences', s, 'endings'],
          'an ending card or slide names the endings it appears in',
        );
      }
      if (slides && sequence.pages.length !== 1) {
        issue(['sequences', s, 'pages'], 'an ending card or slide is one page');
      }
      if (entry.kind === 'epilogue' && sequence.facts === undefined) {
        issue(['sequences', s, 'facts'], 'a slide names the facts that choose it');
      }
      sequence.pages.forEach((page, p) => {
        const limit = slides ? SLIDE_MAX_WORDS : PAGE_MAX_WORDS;
        if (wordCount(page.text) > limit) {
          issue(['sequences', s, 'pages', p, 'text'], `at most ${String(limit)} words`);
        }
      });
      const last = sequence.pages[sequence.pages.length - 1];
      if (entry.kind === 'first-night' && last?.beat !== HORNED_SHADOW_BEAT) {
        issue(
          ['sequences', s, 'pages'],
          `a first-night sequence ends on the ${HORNED_SHADOW_BEAT} beat`,
        );
      }
    });
  })
  .describe('Narration: cards and slides shown to the player (story bible 4.1, 4.4; mw-e39.16).');

export type Narration = z.output<typeof narrationSchema>;

/** The sequence `id` of the `kind` narration among `narrations`, or undefined. */
export function findSequence(
  narrations: readonly Narration[],
  kind: NarrationKind,
  id: string,
): NarrationSequence | undefined {
  for (const narration of narrations) {
    if (narration.kind !== kind) continue;
    const found = narration.sequences.find((sequence) => sequence.id === id);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** The text of the epilogue slide whose objective id is `objective`, or undefined. */
export function epilogueSlide(
  narrations: readonly Narration[],
  objective: string,
): string | undefined {
  return findSequence(narrations, 'epilogue', objective)?.pages[0]?.text;
}

/** The ending card of a headline ending: its title and text. */
export function endingCard(
  narrations: readonly Narration[],
  ending: HeadlineEnding,
): { readonly title: string | undefined; readonly text: string } | undefined {
  const card = findSequence(narrations, 'ending', ending);
  const text = card?.pages[0]?.text;
  return card === undefined || text === undefined ? undefined : { title: card.title, text };
}
