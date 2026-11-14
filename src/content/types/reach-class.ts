// The reach-class content type (mw-e04.15): how far each reach class strikes, and which classes
// clang off a wall. One file per table at `src/content/data/reach-class/<id>.json` (the game has one,
// `reach-classes`). A weapon item and every move of its moveset name a class (`weapon.reach`,
// `hitbox.reach`); the weapon check (weapon-checks.ts) holds each move's hit volume, at its widest
// along its socket track, inside its class's metres, so "a spear reaches 3 m" is a fact of the data
// and not a label. The sim's wall recoil rule (src/sim/combat/recoil) reads the compiled form.
//
// Units: metres from the fighter's origin to the farthest point of the hit volume, and sim ticks
// (60 Hz). The field reference in docs/content/reach-class-schema.md is generated (`pnpm content:docs`).

import { z } from 'zod';
import type { Frozen } from '../loader.ts';
import { contentId } from '../schema.ts';
import { REACH_CLASSES, type ReachClass } from './move.ts';

/** The game's reach-class table (`src/content/data/reach-class/reach-classes.json`). */
export const REACH_CLASS_TABLE_ID = 'reach-classes';

const metres = z
  .number()
  .positive()
  .describe('Farthest a hit volume of this class reaches from the fighter’s origin, metres.');

/** Schema of one reach-class file, `src/content/data/reach-class/<id>.json`. */
export const reachClassSchema = z.strictObject({
  id: contentId.describe('Unique table id; the game reads "reach-classes".'),
  notes: z.string().min(1).describe('Where the numbers come from (bead, tuning status).'),
  metres: z
    .strictObject({
      close: metres.describe('Close: a bite, a shove, a bash.'),
      short: metres.describe('Short: daggers and maces.'),
      medium: metres.describe('Medium: swords.'),
      long: metres.describe('Long: spears and halberds.'),
    } satisfies Record<ReachClass, typeof metres>)
    .refine(
      (m) => m.close < m.short && m.short < m.medium && m.medium < m.long,
      'each class must reach farther than the one before it (close < short < medium < long)',
    )
    .describe('Reach in metres per class, strictly increasing.'),
  wallRecoil: z
    .strictObject({
      ticks: z
        .int()
        .positive()
        .describe('Ticks the fighter is locked out of acting after clanging off a wall.'),
      reaches: z
        .array(z.enum(REACH_CLASSES))
        .describe(
          'Reach classes whose horizontal swings recoil when the blade meets a wall in the ' +
            'first half of its active window, before it strikes a creature. Vertical and ' +
            'thrust swings never recoil.',
        ),
    })
    .describe('The wall recoil rule (mw-e04.15).'),
});

/** A reach-class table as written in JSON. */
export type ReachClassDefInput = z.input<typeof reachClassSchema>;
/** A validated reach-class table. */
export type ReachClassDef = z.output<typeof reachClassSchema>;
/** A loaded (deeply frozen) reach-class table. */
export type ReachClassEntry = Frozen<ReachClassDef>;

/** The runtime form of the reach-class table the sim reads. */
export interface ReachTable {
  /** Metres per reach class. */
  readonly metres: Readonly<Record<ReachClass, number>>;
  /** Wall recoil: how long it locks the fighter, and which classes it applies to. */
  readonly wallRecoil: {
    readonly ticks: number;
    readonly reaches: ReadonlySet<ReachClass>;
  };
}

/** The runtime form of one loaded reach-class table (plain, frozen data). */
export function compileReachClasses(table: ReachClassEntry): ReachTable {
  return Object.freeze({
    metres: Object.freeze({ ...table.metres }),
    wallRecoil: Object.freeze({
      ticks: table.wallRecoil.ticks,
      reaches: new Set<ReachClass>(table.wallRecoil.reaches),
    }),
  });
}
