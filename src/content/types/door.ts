// Door profiles (mw-e03.18): how a kind of door moves and what it shuts out. A profile is a greybox
// prefab, not a kind of object: a scene spawn becomes a door by naming one (`door.profile`), and the
// door's material (wood burns, iron does not) gives it its world properties, so fire, breaking and
// arrows treat it like any other wooden or iron thing. The sim's mechanisms (src/sim/mechanisms) read
// the profile; signals, keys, picks and hands all open it through the same rules.
// One file per profile, `src/content/data/door/<id>.json`.

import { z } from 'zod';
import { contentId, ref } from '../schema.ts';

/** How a door's leaf moves (the sim's DOOR_KINDS). */
export const DOOR_KIND_IDS = ['hinged', 'sliding', 'portcullis', 'trapdoor'] as const;

const metres = z.number().positive().max(10);

export const doorSchema = z.strictObject({
  id: contentId,
  name: z.string().min(1).describe('Display name (debug tools and docs).'),
  notes: z
    .string()
    .min(1)
    .describe('Where the numbers come from (bead, design intent), for owner review.'),
  kind: z
    .enum(DOOR_KIND_IDS)
    .describe(
      'hinged swings about a side, sliding moves sideways into the wall, portcullis rises, trapdoor swings up from the floor.',
    ),
  size: z
    .tuple([metres, metres, metres])
    .describe(
      'Leaf width (across the doorway, out from the hinge), height and thickness, metres; a trapdoor: length out from its hinge, length along it, thickness.',
    ),
  seconds: z
    .number()
    .positive()
    .max(60)
    .describe('Seconds to go from fully closed to fully open (and back): its speed.'),
  crush: z
    .number()
    .min(0)
    .max(1_000_000_000)
    .default(0)
    .describe(
      'Blunt hit, J, it delivers to something it closes on; what does not break wedges it (0: it just stops).',
    ),
  manual: z
    .boolean()
    .default(true)
    .describe(
      'Opens and closes by hand (Interact); false for a portcullis that only signals move.',
    ),
  material: ref('material').describe('What the leaf is made of: its world properties.'),
  model: z
    .string()
    .regex(/^model-[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .optional()
    .describe(
      'Approved model drawn in place of the grey leaf box, fitted into the leaf and swinging with it (render only): public/assets/model/<id>.glb. Its long axis is z with the hinge-side beam at +z.',
    ),
  blocks: z
    .strictObject({
      light: z.boolean().describe('Shuts out light when closed.'),
      gas: z.boolean().describe('Shuts out gas and smoke when closed.'),
      sound: z.boolean().describe('Muffles sound when closed (noise propagation, mw-e09.3).'),
    })
    .describe('What it shuts out while closed; open or broken it shuts out nothing.'),
  loudness: z
    .number()
    .min(0)
    .max(140)
    .describe('Noise when it starts to move, dB 1 m away (stealth and AI hearing).'),
});

/** A door profile as written in a data file. */
export type DoorDefInput = z.input<typeof doorSchema>;
/** A loaded door profile. */
export type DoorDef = z.output<typeof doorSchema>;
