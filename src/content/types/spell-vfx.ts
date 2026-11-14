// Spell VFX slots and templates (mw-e29.10): a spell looks good from day one by naming a template for
// each slot it uses and, if it likes, a tint and a scale, with no VFX code of its own.
//
// Two shapes live here:
//  - the template (content type `spell-vfx-template`, one file per template): which slot it fills and
//    what it draws there, built only from existing `vfx-effect` entries, base textures and the
//    magical materials. A template holds the look's own numbers (ring thickness, beam width, scroll
//    speed) and a default tint and scale, so a spell that names nothing else gets a finished look.
//  - the block (the optional `vfx` field of a `spell`): per slot a template id plus an optional tint
//    and scale. A slot the spell leaves out is simply not drawn.
//
// The standard slots, in the order a cast plays them: castWindup (while the spell charges, on the
// caster), castRelease (the moment it leaves), projectile (a head that rides the bolt and an optional
// trail), impact (where it lands), area (a ring sized to the spell's radius), beam (start and end
// sockets and a width), sustainOnTarget (a loop while a status or channel holds) and summon (the
// arrival of a summoned thing, and the dissolve it leaves by). Which events trigger which slot is the
// spell pipeline's job (e06.17); this file is the shape and the vocabulary only, and the sim never
// reads it. Docs for the magic group: docs/vfx/spell-hooks.md. The field reference in
// docs/content/spell-vfx-template-schema.md is generated (`pnpm content:docs`).

import { z } from 'zod';
import { contentId, ref } from '../schema.ts';
import { HEX_COLOUR_PATTERN } from './vfx-effect.ts';

/** The standard spell VFX slots, in cast order. */
export const SPELL_VFX_SLOTS = [
  'castWindup',
  'castRelease',
  'projectile',
  'impact',
  'area',
  'beam',
  'sustainOnTarget',
  'summon',
] as const;

/** A spell VFX slot. */
export type SpellVfxSlot = (typeof SPELL_VFX_SLOTS)[number];

/** Most times a second a spell visual may pulse (style bible §7, photosensitivity). */
export const SPELL_VFX_MAX_PULSE_HZ = 2;

const colour = z.string().regex(HEX_COLOUR_PATTERN, 'must be a colour like "#8B5CF6"');
const effect = ref('vfx-effect');

const tintField = colour
  .default('#FFFFFF')
  .describe('Default tint: particle colours are recoloured to it, keeping their brightness.');
const scaleField = z
  .number()
  .min(0.1)
  .max(10)
  .default(1)
  .describe(
    'Default size multiplier (particle size, speed and spawn radius, or ring/beam detail).',
  );
const pulse = z
  .number()
  .min(0)
  .max(SPELL_VFX_MAX_PULSE_HZ)
  .default(0)
  .describe(
    `Brightness pulses this many times a second, at most ${String(SPELL_VFX_MAX_PULSE_HZ)} (photosensitivity); 0 = steady. Reduced motion holds it steady.`,
  );

const base = {
  id: contentId.describe('Template id, e.g. "svt-area-rune-ring".'),
  notes: z.string().min(1).describe('What the template shows and where it suits, for review.'),
  tint: tintField,
  scale: scaleField,
};

const particleSlot = <S extends string>(slot: S) =>
  z.strictObject({
    ...base,
    slot: z.literal(slot),
    effect: effect.describe('The `vfx-effect` it plays (recoloured by the tint).'),
  });

/** One template: `src/content/data/spell-vfx-template/<id>.json`. */
export const spellVfxTemplateSchema = z.discriminatedUnion(
  'slot',
  [
    particleSlot('castWindup').describe('Plays on the caster while the spell charges.'),
    particleSlot('castRelease').describe('Plays on the caster the moment the spell leaves.'),
    z
      .strictObject({
        ...base,
        slot: z.literal('projectile'),
        head: effect.describe('Rides the projectile for its whole flight (a looping effect).'),
        trail: effect.optional().describe('Follows the projectile (a looping effect); optional.'),
      })
      .describe('A head that rides the bolt and an optional trail.'),
    particleSlot('impact').describe('Plays where the spell lands, turned to the surface.'),
    z
      .strictObject({
        ...base,
        slot: z.literal('area'),
        ring: z
          .strictObject({
            intensity: z
              .number()
              .min(0)
              .max(4)
              .default(1)
              .describe('Glow strength of the rune ring (magical materials intensity).'),
            spin: z.number().min(0).default(0.04).describe('Turns per second; 0 holds it still.'),
            growSeconds: z
              .number()
              .min(0)
              .describe('The ring expands from its centre to the radius over this long.'),
            pulseHz: pulse,
          })
          .describe(
            'The rune ring from the magical material library, laid flat on the ground: its plane reaches exactly the spell radius.',
          ),
        effect: effect
          .optional()
          .describe('Motes played at the centre, scaled with the radius (a looping effect).'),
      })
      .describe('A rune ring (and optional motes) sized to the spell radius.'),
    z
      .strictObject({
        ...base,
        slot: z.literal('beam'),
        beam: z
          .strictObject({
            width: z.number().positive().describe('Beam width in metres.'),
            alpha: z.number().min(0).max(1).describe('Peak opacity of the beam core.'),
            scrollSpeed: z
              .number()
              .min(0)
              .describe('How fast the energy streams along the beam, in lengths per second.'),
            pulseHz: pulse,
          })
          .describe('The beam strip between its start and end sockets.'),
        endEffect: effect
          .optional()
          .describe('Plays where the beam ends (a looping effect); optional.'),
      })
      .describe('A beam between a start socket and an end point, with a width.'),
    particleSlot('sustainOnTarget').describe(
      'A looping effect on the target while a status or channel holds.',
    ),
    z
      .strictObject({
        ...base,
        slot: z.literal('summon'),
        effect: effect.describe('Plays where the summoned thing arrives or leaves.'),
        dissolveSeconds: z
          .number()
          .positive()
          .describe('How long its body takes to dissolve in (or out), magical materials dissolve.'),
      })
      .describe('Arrival and departure of a summoned thing.'),
  ],
  { error: 'unknown or missing slot; known: ' + SPELL_VFX_SLOTS.join(', ') },
);

/** A template as written in a data file. */
export type SpellVfxTemplateDefInput = z.input<typeof spellVfxTemplateSchema>;
/** A loaded template. */
export type SpellVfxTemplateDef = z.output<typeof spellVfxTemplateSchema>;

const slotUse = z.strictObject({
  template: ref('spell-vfx-template').describe('The template to use; it must fill this slot.'),
  tint: colour.optional().describe('Overrides the template tint.'),
  scale: z.number().min(0.1).max(10).optional().describe('Overrides the template scale.'),
});

/** The optional `vfx` block of a spell: per slot a template, with an optional tint and scale. */
export const spellVfxBlockSchema = z
  .strictObject({
    castWindup: slotUse.optional(),
    castRelease: slotUse.optional(),
    projectile: slotUse.optional(),
    impact: slotUse.optional(),
    area: slotUse.optional(),
    beam: slotUse.optional(),
    sustainOnTarget: slotUse.optional(),
    summon: slotUse.optional(),
  })
  .describe(
    'Visuals by template (docs/vfx/spell-hooks.md): a template per slot, an optional tint and scale. A slot left out is not drawn.',
  );

/** A loaded block. */
export type SpellVfxBlock = z.output<typeof spellVfxBlockSchema>;
/** A block as written in a data file. */
export type SpellVfxBlockInput = z.input<typeof spellVfxBlockSchema>;
