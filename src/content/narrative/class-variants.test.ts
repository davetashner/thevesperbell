// mw-e39.3: the class-variant convention (AC-4: an unknown class value fails naming the field).

import { describe, expect, it } from 'vitest';
import { loadGameContent } from '../index.ts';
import {
  CLASS_VARIANT_KEYS,
  NARRATIVE_CLASSES,
  classVariantsSchema,
  missingClassVariants,
  pickClassVariant,
} from './class-variants.ts';

describe('class variants', () => {
  it('names exactly the classes the game ships, plus all', () => {
    const shipped = loadGameContent()
      .all('class')
      .map((c) => c.id)
      .sort();
    expect([...NARRATIVE_CLASSES].sort()).toEqual(shipped);
    expect(CLASS_VARIANT_KEYS).toEqual([...NARRATIVE_CLASSES, 'all']);
  });

  it('AC-4: an unknown class key such as paladin fails, naming the key', () => {
    const result = classVariantsSchema.safeParse({ paladin: 'Hail.', all: 'Hello.' });
    expect(result.success).toBe(false);
    const issue = result.error?.issues[0];
    expect(issue?.code).toBe('unrecognized_keys');
    expect(issue?.message).toContain('paladin');
  });

  it('rejects an empty map and an empty text', () => {
    expect(classVariantsSchema.safeParse({}).error?.issues[0]?.message).toMatch(/at least one/);
    expect(classVariantsSchema.safeParse({ knight: '' }).success).toBe(false);
  });

  it('picks the class text, falling back to all, else nothing', () => {
    const variants = classVariantsSchema.parse({ thief: 'Quiet one.', all: 'Welcome.' });
    expect(pickClassVariant(variants, 'thief')).toBe('Quiet one.');
    expect(pickClassVariant(variants, 'knight')).toBe('Welcome.');
    expect(pickClassVariant(variants, 'paladin')).toBe('Welcome.');
    expect(pickClassVariant(variants, undefined)).toBe('Welcome.');
    expect(pickClassVariant({ thief: 'Quiet one.' }, 'archer')).toBeUndefined();
  });

  it('lists the classes with no text and no all fallback', () => {
    expect(missingClassVariants({ all: 'x' })).toEqual([]);
    expect(missingClassVariants({ knight: 'x', thief: 'y' })).toEqual(['archer', 'sorcerer']);
  });
});
