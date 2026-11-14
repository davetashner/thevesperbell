// Audio cue sheets as content (mw-e28.3): `src/content/data/cue-sheet/<id>.json`. A sheet is a list
// of rules mapping sim events to sounds, so combat, fire or a lever can make a noise without a
// hard-coded play() call anywhere: {event, match, cue, at, variants, pitchJitter, volumeJitterDb,
// volumeDb, volumeBy, cooldownMs, priority, caption}. The event vocabulary (which events, which anchors and
// facts) is src/content/cue-events.ts, shared with VFX sheets (e29). The cue id may interpolate
// string facts, e.g. `sfx-impact-{target}` plays the struck material's impact set, so sounds follow
// material properties instead of per-object scripting. src/game/cues runs the sheets.

import { z } from 'zod';
import {
  checkCueRule,
  cueEventSpec,
  cuePlaceholders,
  cueRuleBaseFields,
  type CueEventName,
} from '../cue-events.ts';
import { contentId } from '../schema.ts';
import { hasString } from '../strings.ts';
import { localisationKey } from './capability.ts';

/** A cue template: an audio cue id (audio bible §6) whose segments may be `{fact}` placeholders. */
export const CUE_TEMPLATE_PATTERN =
  /^(?:\{[a-zA-Z]+\}|(?:sfx|amb|music)(?:-(?:[a-z0-9]+|\{[a-zA-Z]+\}))+)$/;

/** Most ms apart two identical cues on one anchor may be and still be de-duplicated (bead AC-2). */
export const CUE_DEDUPE_MS = 30;

const volumeBySchema = z
  .strictObject({
    fact: z.string().min(1).describe('A number fact of the event, e.g. "total".'),
    min: z.number().describe('Fact value at (or below) which the cue plays at floorDb.'),
    max: z.number().describe('Fact value at (or above) which the cue plays at full volume.'),
    floorDb: z
      .number()
      .max(0)
      .min(-60)
      .default(-12)
      .describe('Volume offset at `min`, dB (≤ 0); linear in dB up to 0 at `max`.'),
  })
  .refine((v) => v.max > v.min, { message: 'max must be greater than min', path: ['max'] });

/** One rule of a cue sheet. */
export const cueRuleSchema = z
  .strictObject({
    ...cueRuleBaseFields,
    cue: z
      .string()
      .regex(
        CUE_TEMPLATE_PATTERN,
        'must be an audio cue id, optionally with {fact} segments, e.g. "sfx-impact-{target}"',
      )
      .describe(
        'Sound manifest cue id to play; `{fact}` segments are filled from string facts (a missing fact plays nothing).',
      ),
    at: z
      .string()
      .optional()
      .describe(
        'Event anchor to play at (an entity to follow or a fixed position); default: the event’s first anchor.',
      ),
    variants: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        'Pick randomly among this many variants of the cue (never the same twice in a row); default: all the manifest has.',
      ),
    pitchJitter: z
      .number()
      .min(0)
      .max(0.5)
      .default(0)
      .describe('Random playback-rate spread as a fraction: 0.05 = ±5%.'),
    volumeJitterDb: z.number().min(0).max(12).default(0).describe('Random volume spread, ± dB.'),
    volumeDb: z.number().min(-60).max(12).default(0).describe('Fixed volume offset, dB.'),
    volumeBy: volumeBySchema
      .optional()
      .describe('Scale volume by a number fact (intensity: damage dealt, stimulus amount…).'),
    cooldownMs: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe('Minimum ms between two plays of this rule on the same anchor.'),
    priority: z
      .number()
      .int()
      .min(0)
      .max(100)
      .optional()
      .describe('Voice priority for this play (0–100); default: the manifest cue’s priority.'),
    caption: localisationKey
      .optional()
      .describe(
        'Localisation key of the sound caption shown for this cue (mw-e28.14), e.g. "caption.footsteps"; it also orders captions (the rule’s priority). Absent = no caption.',
      ),
    gameplayCritical: z
      .boolean()
      .default(false)
      .describe(
        'True when a player who cannot hear this sound would miss information they need to react (a footstep, an attack telegraph, an alert). A gameplay-critical rule must have a caption (mw-e31.5).',
      ),
  })
  .superRefine((rule, ctx) => {
    checkCueRule(rule, ctx);
    checkPresentation(rule, ctx);
  });

/** The fields `checkPresentation` validates. */
interface PresentationShape {
  readonly event: CueEventName;
  readonly cue: string;
  readonly at?: string | undefined;
  readonly volumeBy?: { readonly fact: string } | undefined;
  readonly caption?: string | undefined;
  readonly gameplayCritical?: boolean | undefined;
}

/** Placeholders must be string facts, `at` an anchor and `volumeBy` a number fact of the event. */
function checkPresentation(rule: PresentationShape, ctx: z.RefinementCtx): void {
  const spec = cueEventSpec(rule.event);
  for (const name of cuePlaceholders(rule.cue)) {
    if (spec.facts[name] !== 'string') {
      ctx.addIssue({
        code: 'custom',
        path: ['cue'],
        message: `{${name}} must be a string fact of ${rule.event}`,
      });
    }
  }
  if (rule.at !== undefined && !spec.anchors.includes(rule.at)) {
    ctx.addIssue({
      code: 'custom',
      path: ['at'],
      message: `${rule.event} has no anchor "${rule.at}"; it has: ${spec.anchors.join(', ')}`,
    });
  }
  if (rule.volumeBy !== undefined && spec.facts[rule.volumeBy.fact] !== 'number') {
    ctx.addIssue({
      code: 'custom',
      path: ['volumeBy', 'fact'],
      message: `"${rule.volumeBy.fact}" must be a number fact of ${rule.event}`,
    });
  }
  if (rule.caption !== undefined && !hasString(rule.caption)) {
    ctx.addIssue({
      code: 'custom',
      path: ['caption'],
      message: `caption "${rule.caption}" has no entry in the string table (src/content/strings.ts)`,
    });
  }
  if (rule.gameplayCritical === true && rule.caption === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['caption'],
      message: 'a gameplayCritical rule needs a caption (a localisation key in the string table)',
    });
  }
}

/** Two rules that would always tie (same event, layer and match) are ambiguous. */
function checkDuplicates(
  rules: readonly { event: string; layer: string; match: Readonly<Record<string, unknown>> }[],
  ctx: z.RefinementCtx,
): void {
  const seen = new Map<string, number>();
  rules.forEach((rule, index) => {
    const match = Object.entries(rule.match).sort(([a], [b]) => (a < b ? -1 : 1));
    const key = JSON.stringify([rule.event, rule.layer, match]);
    const first = seen.get(key);
    if (first === undefined) {
      seen.set(key, index);
      return;
    }
    ctx.addIssue({
      code: 'custom',
      path: ['rules', index],
      message: `rule ${String(index)} has the same event, layer and match as rule ${String(first)}, so it can never win`,
    });
  });
}

/** One audio cue sheet: `src/content/data/cue-sheet/<id>.json`. */
export const cueSheetSchema = z
  .strictObject({
    id: contentId.describe('Sheet id, e.g. "combat".'),
    notes: z.string().min(1).describe('What the sheet covers and why, for owner review.'),
    rules: z
      .array(cueRuleSchema)
      .min(1)
      .describe('The rules, most specific wins per event and layer.'),
  })
  .superRefine((sheet, ctx) => {
    checkDuplicates(sheet.rules, ctx);
  });

/** A cue sheet as written in a data file. */
export type CueSheetDefInput = z.input<typeof cueSheetSchema>;
/** A loaded cue sheet. */
export type CueSheetDef = z.output<typeof cueSheetSchema>;
/** A loaded cue rule. */
export type CueRuleDef = z.output<typeof cueRuleSchema>;
