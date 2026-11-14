import { describe, expect, it } from 'vitest';
import type { CheckBreakdown, LogicDescription } from '@sim/index';
import { humanize, oddsView, outcomeView, reasonText, tagView, TAG_GLYPHS } from './text';

const part = (
  key: string,
  params: LogicDescription['params'] = {},
  children: LogicDescription[] = [],
): LogicDescription => ({ key: `logic.condition.${key}`, params, children });

describe('dialogue text (mw-e22.10)', () => {
  it('humanizes ids', () => {
    expect(humanize('miners-tally-stick')).toBe('miners tally stick');
  });

  it('AC-4: a locked reason reads as words for each condition kind', () => {
    expect(reasonText(part('hasItem', { item: 'iron-key', count: 1 }))).toBe('Needs iron key');
    expect(reasonText(part('hasItem', { item: 'iron-key', count: 3 }))).toBe('Needs 3 x iron key');
    expect(reasonText(part('gold', { op: 'gte', value: 50 }))).toBe('Needs gold at least 50');
    expect(reasonText(part('playerClass', { class: 'thief' }))).toBe('For the thief only');
    expect(reasonText(part('hasCapability', { capability: 'detect-magic' }))).toBe(
      'Needs the detect magic ability',
    );
    expect(reasonText(part('timeOfDay', { from: '22:00', to: '04:00' }))).toBe(
      'Only between 22:00 and 04:00',
    );
    expect(reasonText(part('fact', { fact: 'gate-open' }))).toBe('Requires gate open');
  });

  it('nested conditions read as their parts, and an unknown kind as a plain refusal', () => {
    const key = part('hasItem', { item: 'a', count: 1 });
    const gold = part('gold', { op: 'lt', value: 5 });
    expect(reasonText(part('all', {}, [key, gold]))).toBe('Needs a, Needs gold below 5');
    expect(reasonText(part('any', {}, [key, gold]))).toBe('Any of: Needs a, Needs gold below 5');
    expect(reasonText(part('not', {}, [key]))).toBe('Not: Needs a');
    expect(reasonText(part('somethingNew', { x: 1 }))).toBe('Requirement not met');
    expect(reasonText(part('gold', { op: 'odd', value: true }))).toBe('Needs gold odd true');
  });

  it('tags are a glyph and a bracketed label, from the string table or the id', () => {
    expect(
      tagView({ kind: 'class', id: 'thief', tag: 'thief', labelKey: 'dialogue.tag.class.thief' }),
    ).toEqual({ kind: 'class', glyph: TAG_GLYPHS.class, label: '[Thief]' });
    expect(
      tagView({
        kind: 'item',
        id: 'iron-key',
        tag: 'iron-key',
        labelKey: 'dialogue.tag.item.iron-key',
      }),
    ).toEqual({ kind: 'item', glyph: TAG_GLYPHS.item, label: '[Iron key]' });
    expect(
      tagView({ kind: 'capability', id: 'x', tag: 'x', labelKey: 'dialogue.tag.capability.x' })
        .glyph,
    ).toBe(TAG_GLYPHS.capability);
  });

  const check = (over: Partial<CheckBreakdown> = {}): CheckBreakdown => ({
    approach: 'intimidate',
    difficulty: 8,
    target: 'guard',
    score: 5,
    margin: -3,
    label: 'hard',
    success: false,
    modifiers: [
      { source: 'base', label: 'base', value: 2 },
      { source: 'rule', label: 'Brute force', value: 3 },
      { source: 'disposition', label: 'wary', value: -1 },
    ],
    ...over,
  });

  it('odds label the approach and the difficulty before the player commits', () => {
    expect(oddsView(check())).toEqual({ level: 'hard', label: 'Intimidate: hard' });
    expect(oddsView(check({ approach: 'charm', label: 'impossible' })).label).toBe(
      'Charm: impossible',
    );
  });

  it('the outcome lists every modifier and the score against the difficulty', () => {
    expect(outcomeView(check())).toEqual({
      success: false,
      title: 'Intimidate failed',
      lines: ['Base +2', 'Brute force +3', 'Disposition (wary) -1', 'Score 5 against 8'],
    });
    expect(outcomeView(check({ success: true, approach: 'deceive' })).title).toBe('Deceive worked');
  });
});
