// The service content type (mw-e20.9): something an NPC does for gold, one file per service at
// `src/content/data/service/<id>.json`. A service is data: who provides it, its price (a fixed
// `price` or a `priceFormula` that eases with the provider's disposition), the `conditions` that
// must hold, and the `effects` (the shared logic DSL, src/sim/logic) it applies once paid. Dialogue
// invokes it with the `purchaseService` effect; the gold is taken in the same atomic batch as the
// effects, so a refusal anywhere changes nothing. Bribes and donations are services whose effects
// are `disposition` / `setFact`; a translation is an item swap; a barge ride (mw-e25.15) is a service
// with a fare, a `timeOfDay` condition for its schedule window and the `advanceTime` and
// `travelTo` effects (src/sim/logic/travel-kinds.ts; `heal` sits beside them). Trainer techniques and merchant-window rooms stay in the merchant type
// (`services` there: `rest`, `train`). Kinds, fields and references of `conditions`/`effects` are
// validated by src/sim/services (content may not import the sim at runtime).
// The field reference in docs/content/service-schema.md is generated (`pnpm content:docs`).

import { z } from 'zod';
import { contentId, ref } from '../schema.ts';

const logicNode = z
  .looseObject({ kind: z.string().min(1).describe('The logic kind, e.g. "hasItem".') })
  .describe('A logic DSL node: an object with a `kind` and that kind’s fields.');

const priceFormulaSchema = z
  .strictObject({
    base: z.int().min(1).max(100_000).describe('Crowns at disposition 0 or below.'),
    floor: z.int().min(1).max(100_000).describe('The least it ever costs.'),
    perDisposition: z
      .number()
      .positive()
      .max(1000)
      .describe('Crowns knocked off per point of disposition above 0 (rounded down).'),
  })
  .refine((formula) => formula.floor <= formula.base, {
    message: '`floor` must not exceed `base`',
    path: ['floor'],
  });

/** Schema of one service file. */
export const serviceSchema = z
  .strictObject({
    id: contentId.describe(
      'Unique service id, e.g. "kettleback-carrying-fee". Stable once shipped.',
    ),
    notes: z.string().min(1).describe('Who sells it, why this price, for owner review.'),
    providerNpcId: ref('creature').describe('The NPC creature who provides the service.'),
    name: z.string().min(1).describe('What a listing shows, e.g. "Carrying fee".'),
    price: z
      .int()
      .min(1)
      .max(100_000)
      .optional()
      .describe('Fixed crowns. Give exactly one of `price` and `priceFormula`.'),
    priceFormula: priceFormulaSchema
      .optional()
      .describe('A price that eases with the provider’s disposition toward the player.'),
    conditions: z
      .array(logicNode)
      .default([])
      .describe('Conditions (logic DSL) that must all hold to buy; none = always.'),
    showWhenLocked: z
      .boolean()
      .default(false)
      .describe('Unmet conditions: `true` lists the service locked, `false` hides it.'),
    effects: z
      .array(logicNode)
      .default([])
      .describe(
        'Effects (logic DSL) applied with the payment, all or nothing. None = a pure fee. `purchaseService` is not allowed here.',
      ),
  })
  .refine((service) => (service.price === undefined) !== (service.priceFormula === undefined), {
    message: 'give exactly one of `price` and `priceFormula`',
    path: ['price'],
  });

export type ServiceDef = z.output<typeof serviceSchema>;
export type ServiceDefInput = z.input<typeof serviceSchema>;
