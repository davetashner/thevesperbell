// The merchant content type (mw-e20.2): who sells and buys, one file per merchant at
// `src/content/data/merchant/<id>.json`. A merchant is data (contract §1): an identity (the NPC who
// speaks for the shop and their personality), what they buy and what they are best at buying
// (`specialties` pay a bonus), their stock (items or loot tables, with restock rules), the gold they
// carry, and the markup and buy-rate the price model (src/sim/economy, mw-e20.3) turns into prices.
// Bands (markup 1.1-1.5, buy rate 0.3-0.6, specialty bonus, stolen factor) come from
// docs/design/economy.md (mirrored from src/sim/economy/bands.ts, which content may not import at
// runtime; tests/integration/economy-bands.test.ts asserts the two agree); `checkMerchants` fails a merchant outside
// them, naming the merchant and the field. Only a fence (`isFence`) may buy stolen goods
// (`buysStolen`). Item and loot-table references are checked by the loader; `checkMerchants` also
// refuses currency and quest items in stock. Bookshop specialisation (E21) extends this type.
// The field reference in docs/content/merchant-schema.md is generated (`pnpm content:docs`).

import { z } from 'zod';
import type { ContentCheck, ContentIssue } from '../loader.ts';
import { contentId, ref } from '../schema.ts';
import { capabilityId } from './capability.ts';
import { conditionSchema } from './condition.ts';
import { ITEM_CATEGORIES, type ItemDef } from './item.ts';

/** An inclusive numeric band from the economy doc (mirrors `Band` in src/sim/economy/bands.ts). */
export interface Band {
  readonly min: number;
  readonly max: number;
  readonly default: number;
}

/** Merchant markup on what the player buys (economy doc, "Merchant modifiers"). */
export const MARKUP_BAND: Band = { min: 1.1, max: 1.5, default: 1.3 };
/** Fraction of an item's value paid when the player sells. */
export const BUY_RATE_BAND: Band = { min: 0.3, max: 0.6, default: 0.4 };
/** Extra multiplier on the buy rate for a merchant's specialties. */
export const SPECIALTY_BONUS_BAND: Band = { min: 1.1, max: 1.3, default: 1.2 };
/** A fence's multiplier on the sell price of stolen goods. */
export const STOLEN_FACTOR_BAND: Band = { min: 0.5, max: 0.8, default: 0.6 };

/** Gold for a night at an inn (mirrors `INN_BED_PRICE_BAND` in src/sim/economy/bands.ts). */
export const INN_BED_PRICE_BAND = { min: 8, max: 15 } as const;

/** Crowns for one trainer technique (mirrors `TRAINER_PRICE_BAND`; economy doc, "Trainers"). */
export const TRAINER_PRICE_BAND = { min: 100, max: 400 } as const;

/** Kinds of service a merchant sells. */
export const SERVICE_KINDS = ['rest', 'train'] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number];

/** Whether `value` lies inside `band` (inclusive, with a hair of float slack). */
const inBand = (band: Pick<Band, 'min' | 'max'>, value: number): boolean =>
  value >= band.min - 1e-9 && value <= band.max + 1e-9;

/** How a shopkeeper carries themselves; barks and haggling read these (E22/E20 later). */
export const MERCHANT_PERSONALITIES = [
  'greedy',
  'gossipy',
  'suspicious',
  'generous',
  'gruff',
  'friendly',
  'shrewd',
  'nervous',
] as const;
export type MerchantPersonality = (typeof MERCHANT_PERSONALITIES)[number];

const itemCategory = z.enum(ITEM_CATEGORIES);

const stockSchema = z
  .strictObject({
    item: ref('item').optional().describe('An item the merchant stocks.'),
    lootTable: ref('loot-table')
      .optional()
      .describe('A loot table rolled to stock the shelf (a shop that varies).'),
    count: z.int().min(1).max(999).describe('Units of the item, or rolls of the loot table.'),
    restock: z
      .strictObject({
        everyHours: z
          .int()
          .min(1)
          .max(24 * 30)
          .describe('In-world hours between restocks.'),
        amount: z
          .int()
          .min(1)
          .max(999)
          .describe('Units (or rolls) added each time, up to `count`.'),
      })
      .optional()
      .describe(
        'How the stock refills; absent = never restocks (a unique good never returns once sold). Runs on world-day ticks: `amount` every `everyHours` rounded up to whole days, up to `count`. A loot-table entry with a rule rotates instead: its unsold units are replaced by `count` fresh rolls each period.',
      ),
    when: conditionSchema
      .optional()
      .describe(
        'A world-fact condition (mw-e27.5): the entry is absent until it holds, appears at the next restock and stays.',
      ),
  })
  .refine((entry) => (entry.item === undefined) !== (entry.lootTable === undefined), {
    message: 'a stock entry names exactly one of `item` or `lootTable`',
  });

const serviceSchema = z.strictObject({
  id: contentId.describe('Service id, unique within the merchant, e.g. "room-for-the-night".'),
  name: z.string().min(1).describe('What the shop window lists, e.g. "Room for the night".'),
  price: z
    .int()
    .min(1)
    .max(100_000)
    .describe(
      'Crowns, fixed by the merchant: no markup, disposition or haggle applies. A `rest` service sits in the inn-bed band 8-15.',
    ),
  kind: z
    .enum(SERVICE_KINDS)
    .describe(
      '`rest`: sleep until morning, fully healed (the Sleeping Ox room). `train`: a lesson that teaches `teaches` (mw-ju8.13).',
    ),
  teaches: capabilityId
    .optional()
    .describe('The capability a `train` service teaches; required for `train`, absent otherwise.'),
});

const hoursSchema = z
  .strictObject({
    open: z.int().min(0).max(23).describe('Hour of day (0-23) the shop opens.'),
    close: z
      .int()
      .min(0)
      .max(23)
      .describe('Hour of day (0-23) it closes; may be earlier than open (overnight).'),
  })
  .refine((hours) => hours.open !== hours.close, {
    message: 'open and close must differ (omit `hours` for always open)',
    path: ['close'],
  });

/** Schema of one merchant file, `src/content/data/merchant/<id>.json`. */
export const merchantSchema = z
  .strictObject({
    id: contentId.describe(
      'Unique merchant id, e.g. "briar-glen-general-store". Stable once shipped.',
    ),
    notes: z
      .string()
      .min(1)
      .describe('Who runs it and why these prices and stock, for owner review.'),
    npcId: contentId.describe('The NPC who speaks for the shop (dialogue speaker id).'),
    displayName: z
      .string()
      .min(1)
      .optional()
      .describe(
        'The keeper’s name as the shop window shows it, e.g. "Ottilie Marsh"; absent = the NPC id made readable.',
      ),
    shopName: z
      .string()
      .min(1)
      .optional()
      .describe('The shop’s name, e.g. "Brand’s Forge" (signage, shop window subtitle).'),
    personalityTags: z
      .array(z.enum(MERCHANT_PERSONALITIES))
      .default([])
      .describe('Personality traits that colour barks and haggling.'),
    specialties: z
      .array(itemCategory)
      .default([])
      .describe(
        'Item categories bought at a better rate (`specialtyBonus`); must be bought categories.',
      ),
    buysCategories: z
      .array(itemCategory)
      .min(1)
      .describe('Item categories the merchant buys from the player.'),
    stock: z.array(stockSchema).default([]).describe('What the merchant sells.'),
    services: z
      .array(serviceSchema)
      .default([])
      .describe('Services on the shop window’s Services tab (an inn’s rooms).'),
    goldReserve: z
      .int()
      .nonnegative()
      .describe('Gold the merchant starts with to pay the player for sales.'),
    goldRestockPerDay: z
      .int()
      .nonnegative()
      .default(0)
      .describe('Gold the reserve refills by each in-world day, up to `goldReserve`.'),
    markup: z
      .number()
      .positive()
      .describe(
        `Multiplier on item value when the player buys (economy band ${bandText(MARKUP_BAND)}).`,
      ),
    buyRate: z
      .number()
      .positive()
      .describe(
        `Fraction of item value paid when the player sells (band ${bandText(BUY_RATE_BAND)}).`,
      ),
    specialtyBonus: z
      .number()
      .positive()
      .optional()
      .describe(
        `Extra multiplier on the buy rate for specialties (band ${bandText(SPECIALTY_BONUS_BAND)}); default ${String(SPECIALTY_BONUS_BAND.default)}.`,
      ),
    isFence: z.boolean().default(false).describe('A fence deals in stolen goods.'),
    buysStolen: z
      .boolean()
      .default(false)
      .describe('Buys stolen goods; only a fence (`isFence`) may.'),
    stolenFactor: z
      .number()
      .positive()
      .optional()
      .describe(
        `Multiplier on the price of stolen goods (band ${bandText(STOLEN_FACTOR_BAND)}); default ${String(STOLEN_FACTOR_BAND.default)}.`,
      ),
    hours: hoursSchema
      .optional()
      .describe('Opening hours (world-time hook); absent = always open.'),
    barkSet: contentId.optional().describe('Bark set id for the shopkeeper’s lines (E22).'),
  })
  .superRefine((merchant, ctx) => {
    const issue = (path: PropertyKey[], message: string) => {
      ctx.addIssue({ code: 'custom', path, message: `merchant "${merchant.id}": ${message}` });
    };
    if (merchant.buysStolen && !merchant.isFence) {
      issue(['buysStolen'], 'only a fence (isFence: true) may buy stolen goods');
    }
    if (merchant.stolenFactor !== undefined && !merchant.buysStolen) {
      issue(['stolenFactor'], 'stolenFactor needs buysStolen: true');
    }
    const serviceIds = new Set<string>();
    merchant.services.forEach((service, i) => {
      if (service.kind === 'train' && service.teaches === undefined) {
        issue(
          ['services', i, 'teaches'],
          `lesson "${service.id}" must name the capability it teaches`,
        );
      }
      if (service.kind !== 'train' && service.teaches !== undefined) {
        issue(['services', i, 'teaches'], `only a train service teaches (service "${service.id}")`);
      }
      if (serviceIds.has(service.id)) {
        issue(['services', i, 'id'], `service "${service.id}" is listed twice`);
      }
      serviceIds.add(service.id);
    });
    merchant.specialties.forEach((category, i) => {
      if (!merchant.buysCategories.includes(category)) {
        issue(['specialties', i], `specialty "${category}" must also be in buysCategories`);
      }
    });
  });

function bandText(band: Pick<Band, 'min' | 'max'>): string {
  return `${String(band.min)}-${String(band.max)}`;
}

/** A merchant as written in JSON. */
export type MerchantDefInput = z.input<typeof merchantSchema>;
/** A validated merchant with defaults filled and refs parsed. */
export type MerchantDef = z.output<typeof merchantSchema>;

/** The banded numeric fields of a merchant and their economy-doc bands. */
const BANDED_FIELDS = [
  ['markup', MARKUP_BAND],
  ['buyRate', BUY_RATE_BAND],
  ['specialtyBonus', SPECIALTY_BONUS_BAND],
  ['stolenFactor', STOLEN_FACTOR_BAND],
] as const;

/**
 * The load check for merchants: markup, buy rate, specialty bonus and stolen factor sit inside the
 * economy doc's bands (AC-2), and stock holds sellable goods, not currency or quest items.
 * (References to items and loot tables are the loader's, AC-3.)
 */
export const checkMerchants: ContentCheck = (entries) => {
  const items = new Map<string, ItemDef>();
  for (const { type, value } of entries) if (type === 'item') items.set(value.id, value as ItemDef);
  const issues: ContentIssue[] = [];
  for (const { type, file, value } of entries) {
    if (type !== 'merchant') continue;
    const merchant = value as MerchantDef;
    for (const [field, band] of BANDED_FIELDS) {
      const amount = merchant[field];
      if (amount !== undefined && !inBand(band, amount)) {
        issues.push({
          file,
          pointer: `/${field}`,
          message:
            `merchant:${merchant.id} ${field} ${String(amount)} is outside the economy band ` +
            `${bandText(band)} (docs/design/economy.md)`,
        });
      }
    }
    merchant.services.forEach((service, i) => {
      const [band, name] =
        service.kind === 'train'
          ? ([TRAINER_PRICE_BAND, 'trainer'] as const)
          : ([INN_BED_PRICE_BAND, 'inn-bed'] as const);
      if (!inBand(band, service.price)) {
        issues.push({
          file,
          pointer: `/services/${String(i)}/price`,
          message:
            `merchant:${merchant.id} service ${service.id} costs ${String(service.price)}, outside the ${name} band ` +
            `${bandText(band)} (docs/design/economy.md)`,
        });
      }
    });
    merchant.stock.forEach((entry, i) => {
      const stocked = entry.item === undefined ? undefined : items.get(entry.item.id);
      if (stocked?.category === 'currency' || stocked?.category === 'quest') {
        issues.push({
          file,
          pointer: `/stock/${String(i)}/item`,
          message: `merchant:${merchant.id} stocks ${stocked.category} item "${stocked.id}", which a merchant cannot sell`,
        });
      }
    });
  }
  return issues;
};
