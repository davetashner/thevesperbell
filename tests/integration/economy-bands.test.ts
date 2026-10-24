// The merchant validator (src/content) mirrors the economy bands of the price model (src/sim), since
// content may not import sim at runtime. This keeps the two copies, and the design doc, in step.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BUY_RATE_BAND as CONTENT_BUY_RATE,
  INN_BED_PRICE_BAND as CONTENT_INN_BED,
  MARKUP_BAND as CONTENT_MARKUP,
  SPECIALTY_BONUS_BAND as CONTENT_SPECIALTY,
  STOLEN_FACTOR_BAND as CONTENT_STOLEN,
  TRAINER_PRICE_BAND as CONTENT_TRAINER,
} from '@content/types/merchant.ts';
import {
  BUY_RATE_BAND,
  INN_BED_PRICE_BAND,
  MARKUP_BAND,
  SPECIALTY_BONUS_BAND,
  STOLEN_FACTOR_BAND,
  TRAINER_PRICE_BAND,
} from '@sim/economy/bands';

describe('economy bands', () => {
  it('AC-2: the merchant validator’s bands equal the price model’s', () => {
    expect(CONTENT_MARKUP).toEqual(MARKUP_BAND);
    expect(CONTENT_BUY_RATE).toEqual(BUY_RATE_BAND);
    expect(CONTENT_SPECIALTY).toEqual(SPECIALTY_BONUS_BAND);
    expect(CONTENT_STOLEN).toEqual(STOLEN_FACTOR_BAND);
    expect(CONTENT_INN_BED).toEqual(INN_BED_PRICE_BAND);
    expect(CONTENT_TRAINER).toEqual(TRAINER_PRICE_BAND);
  });

  it('the economy doc states the bands the code enforces', () => {
    const doc = readFileSync('docs/design/economy.md', 'utf8');
    expect(doc).toContain('| Markup | 1.1-1.5 | 1.3 |');
    expect(doc).toContain('| Buy rate | 0.3-0.6 | 0.4 |');
    expect(doc).toContain('| Specialty bonus | 1.1-1.3 | 1.2 |');
    expect(doc).toContain('| Stolen / fence factor | 0.5-0.8 | 0.6 |');
    expect(doc).toContain('| Inn bed | 8-15 per night |');
    expect(doc).toContain('| Trainers (one technique) | 100-400 |');
    expect(doc).toContain('**0.6-0.8**');
  });
});
