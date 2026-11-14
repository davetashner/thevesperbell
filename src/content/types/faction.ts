// The faction content type (mw-e12.8): who stands with whom. Goblins that fight skeletons, wolves
// that hunt sheep and guards that tolerate the player all read one table, so a faction is data: its
// default stance toward its own members, toward the player, toward every other faction, and any
// specific relations that differ. Relations are one-way (asymmetry is allowed: wolves see sheep as
// prey, sheep see wolves as predator); `mutual` also gives the other faction the mirrored stance
// unless it declares its own. The sim builds its faction table from these entries (src/sim/factions)
// and adds the runtime part: per-creature overrides and faction-wide changes caused by play.
//
// A creature with no `faction` belongs to `unaligned` (src/content/data/faction/unaligned.json).
// `player` is reserved: it names the player in the sim's table, so no faction may use it.

import { z } from 'zod';
import { contentId, ref } from '../schema.ts';
import { STANCES } from './creature.ts';

/** Faction a creature belongs to when its definition names none. */
export const UNALIGNED_FACTION = 'unaligned';

/** Reserved id: the player's side of the sim's faction table; no faction may be called this. */
export const PLAYER_FACTION_ID = 'player';

const stance = z.enum(STANCES);

const relationSchema = z.strictObject({
  faction: ref('faction').describe('The other faction.'),
  stance: stance.describe('This faction’s stance toward the other one.'),
  mutual: z
    .boolean()
    .default(false)
    .describe(
      'Also give the other faction the mirrored stance toward this one (prey ↔ predator, others unchanged) unless it declares its own.',
    ),
});

/** Schema of one faction file, `src/content/data/faction/<id>.json`. */
export const factionSchema = z
  .strictObject({
    id: contentId
      .refine((id) => id !== PLAYER_FACTION_ID, '"player" is reserved for the player')
      .describe('Unique faction id, e.g. "rootcellar". Stable once shipped (saves).'),
    name: z.string().min(1).describe('Display name (editor, docs and debug tools).'),
    notes: z
      .string()
      .min(1)
      .describe('Who belongs and why these stances (canon), for owner review.'),
    towardPlayer: stance
      .default('neutral')
      .describe('Starting stance of members toward the player; play can change it.'),
    towardMembers: stance.default('ally').describe('Stance of members toward each other.'),
    towardOthers: stance
      .default('neutral')
      .describe('Stance toward any faction not listed in `relations`.'),
    dispositionSpread: z
      .number()
      .min(0)
      .max(1)
      .default(0)
      .describe(
        'Fraction of a change in one member’s disposition toward the player that the other members take too (mw-e22.4): 0.5 turns -20 into -10 for each. 0 = members judge the player alone.',
      ),
    relations: z
      .array(relationSchema)
      .prefault([])
      .describe('Stances toward specific factions that differ from `towardOthers`.'),
  })
  .superRefine((def, ctx) => {
    const seen = new Set<string>();
    def.relations.forEach(({ faction }, index) => {
      if (faction.id === def.id) {
        ctx.addIssue({
          code: 'custom',
          path: ['relations', index, 'faction'],
          message: 'a faction’s stance toward itself is `towardMembers`, not a relation',
        });
      } else if (seen.has(faction.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['relations', index, 'faction'],
          message: `"${faction.id}" is listed twice`,
        });
      }
      seen.add(faction.id);
    });
  });

/** A faction as written in JSON (optional fields may be omitted). */
export type FactionDefInput = z.input<typeof factionSchema>;
/** A validated faction with every default filled and refs parsed. */
export type FactionDef = z.output<typeof factionSchema>;
