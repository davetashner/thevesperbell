// The element-state feedback table (mw-e03.28): how burning, wet, frozen and charged things look, in
// one file at `src/content/data/element-feedback/element-feedback.json` (the game has one). Each
// state names the world property that drives it and when it counts as on (`when`), the VFX effect
// that plays on whatever is in that state (sized to the entity's bounds, never to an entity type),
// the material look its mesh takes (wet darkening, frost overlay, ember glow, charge shimmer) and an
// optional audio cue. The game's presentation bridge (src/game/vfx/element-feedback.ts) watches the
// sim's `propertyChanged` events against this table, so a new state is a new row, not new code.
//
// The sim never reads this file: it is presentation only. The field reference in
// docs/content/element-feedback-schema.md is generated (`pnpm content:docs`).

import { z } from 'zod';
import type { Frozen } from '../loader.ts';
import { contentId, ref } from '../schema.ts';
import { isWorldPropertyName } from '../world-properties.ts';

/** The game's element-state table (`src/content/data/element-feedback/element-feedback.json`). */
export const ELEMENT_FEEDBACK_ID = 'element-feedback';

/** Most live element effects the bridge may hold at once; the rest are culled by distance. */
export const MAX_ELEMENT_HANDLES = 256;

const colour = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'must be a colour like "#3F7FA0"');

/** The mesh look of a state: a tint, an emissive glow and a surface sheen. */
export const elementLookSchema = z.strictObject({
  tint: colour
    .optional()
    .describe('Colour the albedo is mixed towards (white leaves it alone, a dark colour darkens).'),
  tintMix: z
    .number()
    .min(0)
    .max(1)
    .default(0)
    .describe('How far the albedo moves towards `tint`, 0 = not at all … 1 = fully.'),
  emissive: colour.optional().describe('Glow colour added to the surface (emissive).'),
  emissiveIntensity: z.number().min(0).max(2).default(0).describe('Strength of the glow.'),
  roughness: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('Roughness the surface takes (low = a specular sheen, as wet or iced things have).'),
  pulseHz: z
    .number()
    .min(0)
    .max(3)
    .default(0)
    .describe(
      'Glow pulses this many times a second, at most 3 (photosensitivity, style bible §7); 0 = steady. Reduced motion holds it steady.',
    ),
});

const whenSchema = z.union([
  z.strictObject({ is: z.boolean().describe('A flag property equals this.') }),
  z.strictObject({
    atLeast: z.number().describe('A number property is at least this (and the state is on).'),
  }),
]);

/** One state: a world property condition and what it shows. */
export const elementStateSchema = z.strictObject({
  id: contentId.describe('State id, e.g. "burning".'),
  property: z
    .string()
    .refine(isWorldPropertyName, 'must be a world property (docs/design/world-properties.md)')
    .describe('World property that drives the state (burning, wetness, frozen, charge…).'),
  when: whenSchema.describe('When the property counts as on.'),
  precedence: z
    .int()
    .min(0)
    .describe(
      'Look precedence, higher wins. An entity in several states has their looks layered lowest first: the highest precedence tints last (on top), and takes the roughness when several states set one. Glows add. Order used: wet 10 < burning 20 < charged 30 < frozen 40, so a wet and frozen thing reads iced.',
    ),
  effect: ref('vfx-effect').describe('VFX effect played on the entity while the state is on.'),
  referenceRadius: z
    .number()
    .positive()
    .describe('Bounding radius, metres, the effect is authored for; larger things scale it up.'),
  scale: z
    .strictObject({
      min: z.number().positive().describe('Smallest effect scale.'),
      max: z.number().positive().describe('Largest effect scale.'),
    })
    .refine((s) => s.max >= s.min, { message: 'max must not be less than min', path: ['max'] })
    .describe('Limits on bounds-driven effect scale (1 = as authored).'),
  reducedIntensity: z
    .number()
    .min(0)
    .max(1)
    .default(1)
    .describe('Emission multiplier while reduced motion is on (strobing sparks use less).'),
  look: elementLookSchema.optional().describe('Material look of the entity’s mesh in this state.'),
  audioCue: z
    .string()
    .regex(/^sfx-[a-z0-9-]+$/, 'must be a sound cue id like "sfx-element-zap"')
    .optional()
    .describe(
      'One-shot sound cue played where the entity is when it enters the state; only cues in the sound manifest play. Absent while no cue exists.',
    ),
});

/** One gas drawn from the element field as clouds. */
export const elementFieldRuleSchema = z.strictObject({
  gas: contentId.describe('Gas id in the element field, e.g. "smoke" or "steam".'),
  effect: ref('vfx-effect').describe('Looping cloud effect held on each dense cell.'),
  threshold: z
    .number()
    .gt(0)
    .lt(1)
    .describe('Concentration (0–1 of a cell) at which a cell gets a cloud.'),
  cap: z
    .int()
    .min(1)
    .max(MAX_ELEMENT_HANDLES)
    .describe('Most clouds of this gas at once; the densest win.'),
  referenceCell: z
    .number()
    .positive()
    .describe(
      'Cell edge, metres, the effect is authored for; the cloud scales by cell size over it.',
    ),
});

/** A one-shot effect when an entity moves from one state to another (e.g. burning to wet: steam). */
export const elementTransitionSchema = z.strictObject({
  from: contentId.describe('State id the entity leaves.'),
  to: contentId.describe('State id the entity enters (in either order within one tick).'),
  effect: ref('vfx-effect').describe('One-shot effect spawned once at the entity per transition.'),
  referenceRadius: z
    .number()
    .positive()
    .describe('Bounding radius, metres, the effect is authored for.'),
  scale: z
    .strictObject({
      min: z.number().positive().describe('Smallest effect scale.'),
      max: z.number().positive().describe('Largest effect scale.'),
    })
    .refine((s) => s.max >= s.min, { message: 'max must not be less than min', path: ['max'] })
    .describe('Limits on bounds-driven effect scale (1 = as authored).'),
  reducedIntensity: z
    .number()
    .min(0)
    .max(1)
    .default(1)
    .describe('Emission multiplier while reduced motion is on.'),
});

/** Schema of the table, `src/content/data/element-feedback/<id>.json`. */
export const elementFeedbackSchema = z
  .strictObject({
    id: contentId.describe('Unique table id; the game reads "element-feedback".'),
    notes: z.string().min(1).describe('Where the looks come from and what is placeholder.'),
    handleCap: z
      .int()
      .min(1)
      .max(MAX_ELEMENT_HANDLES)
      .describe('Most element effects live at once; beyond it the farthest from the camera go.'),
    fullDetailCap: z
      .int()
      .min(1)
      .max(MAX_ELEMENT_HANDLES)
      .describe(
        'Most element effects drawn at full detail. Beyond it the farthest drop to low LOD (`lowLodIntensity`) and only beyond `handleCap` are they culled.',
      ),
    lowLodIntensity: z
      .number()
      .gt(0)
      .max(1)
      .describe('Emission multiplier of a low-LOD effect (fewer particles, same look and size).'),
    hysteresis: z
      .number()
      .min(0)
      .describe(
        'Metres of preference an effect that is already live gets over a rival at the cap, so two things at the same distance do not trade places every frame.',
      ),
    states: z.array(elementStateSchema).min(1).describe('The states, in the order looks combine.'),
    transitions: z
      .array(elementTransitionSchema)
      .default([])
      .describe('One-shot effects when an entity moves between states (burning to wet: steam).'),
    fields: z
      .array(elementFieldRuleSchema)
      .default([])
      .describe('Gases of the element field drawn as clouds (smoke, steam).'),
  })
  .superRefine((table, ctx) => {
    const seen = new Set<string>();
    if (table.fullDetailCap > table.handleCap) {
      ctx.addIssue({
        code: 'custom',
        path: ['fullDetailCap'],
        message: 'fullDetailCap must not exceed handleCap',
      });
    }
    table.states.forEach((state, index) => {
      if (seen.has(state.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['states', index, 'id'],
          message: `duplicate state id "${state.id}"`,
        });
      }
      seen.add(state.id);
    });
    table.transitions.forEach((t, index) => {
      for (const side of ['from', 'to'] as const) {
        if (!seen.has(t[side])) {
          ctx.addIssue({
            code: 'custom',
            path: ['transitions', index, side],
            message: `unknown state id "${t[side]}"`,
          });
        }
      }
    });
  });

/** A table as written in JSON. */
export type ElementFeedbackDefInput = z.input<typeof elementFeedbackSchema>;
/** A validated table. */
export type ElementFeedbackDef = z.output<typeof elementFeedbackSchema>;
/** A loaded (deeply frozen) table. */
export type ElementFeedbackEntry = Frozen<ElementFeedbackDef>;
/** A gas field rule as the presenter reads it (the effect id is plain). */
export interface ElementFieldRule {
  readonly gas: string;
  readonly effect: string;
  readonly threshold: number;
  readonly cap: number;
  readonly referenceCell: number;
}

/** A mesh look as loaded. */
export type ElementLookDef = z.output<typeof elementLookSchema>;

/** A transition as the bridge reads it (state ids resolved to table indices). */
export interface ElementTransitionRule {
  readonly from: number;
  readonly to: number;
  readonly effect: string;
  readonly referenceRadius: number;
  readonly scale: { readonly min: number; readonly max: number };
  readonly reducedIntensity: number;
}

/** One state as the bridge reads it: the effect id is plain and the condition is a function. */
export interface ElementStateRule {
  readonly id: string;
  readonly property: string;
  readonly precedence: number;
  /** Whether a property value puts the entity in the state (other types never do). */
  readonly matches: (value: unknown) => boolean;
  readonly effect: string;
  readonly referenceRadius: number;
  readonly scale: { readonly min: number; readonly max: number };
  readonly reducedIntensity: number;
  readonly look: ElementLookDef | undefined;
  readonly audioCue: string | undefined;
}

/** The runtime form of a loaded table. */
export interface ElementFeedbackTable {
  readonly handleCap: number;
  readonly hysteresis: number;
  readonly fullDetailCap: number;
  readonly lowLodIntensity: number;
  readonly transitions: readonly ElementTransitionRule[];
  readonly states: readonly ElementStateRule[];
  readonly fields: readonly ElementFieldRule[];
}

/** Compiles a loaded table: conditions become functions, refs plain effect ids. */
export function compileElementFeedback(entry: ElementFeedbackEntry): ElementFeedbackTable {
  return Object.freeze({
    handleCap: entry.handleCap,
    hysteresis: entry.hysteresis,
    fullDetailCap: entry.fullDetailCap,
    lowLodIntensity: entry.lowLodIntensity,
    transitions: Object.freeze(
      entry.transitions.map((t) =>
        Object.freeze({
          from: entry.states.findIndex((state) => state.id === t.from),
          to: entry.states.findIndex((state) => state.id === t.to),
          effect: t.effect.id,
          referenceRadius: t.referenceRadius,
          scale: t.scale,
          reducedIntensity: t.reducedIntensity,
        }),
      ),
    ),
    fields: Object.freeze(entry.fields.map((f) => Object.freeze({ ...f, effect: f.effect.id }))),
    states: Object.freeze(
      entry.states.map((state): ElementStateRule => {
        const { when } = state;
        const matches =
          'is' in when
            ? (value: unknown) => value === when.is
            : (value: unknown) => typeof value === 'number' && value >= when.atLeast;
        return Object.freeze({
          id: state.id,
          property: state.property,
          precedence: state.precedence,
          matches,
          effect: state.effect.id,
          referenceRadius: state.referenceRadius,
          scale: state.scale,
          reducedIntensity: state.reducedIntensity,
          look: state.look,
          audioCue: state.audioCue,
        });
      }),
    ),
  });
}
