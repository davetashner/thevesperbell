import { describe, expect, it } from 'vitest';
import { CONDITION_USAGES } from '../condition-checks.ts';
import { ContentLoadError, loadContent } from '../loader.ts';
import { contentChecks, contentTypes } from '../registry.ts';
import { ContentRef, serializeContent } from '../schema.ts';
import { describeContent } from '../testing.ts';
import { LOOT_MAX_DEPTH, lootTableSchema } from './loot-table.ts';

const problems = (value: unknown) =>
  (lootTableSchema.safeParse(value).error?.issues ?? []).map(
    (i) => `${i.path.join('.')}: ${i.message}`,
  );

const base = { id: 'crate', notes: 'A test table.' };

describe('loot-table schema (mw-e18.1)', () => {
  it('defaults to nothing guaranteed, no rolls, no entries and duplicates allowed', () => {
    expect(LOOT_MAX_DEPTH).toBe(4);
    expect(lootTableSchema.parse(base)).toEqual({
      ...base,
      guaranteed: [],
      rolls: { min: 0, max: 0 },
      entries: [],
      noDuplicates: false,
    });
  });

  it('parses item and table entries into refs, with a count of one by default', () => {
    const table = lootTableSchema.parse({
      ...base,
      guaranteed: [{ item: 'bread' }],
      rolls: { min: 1, max: 2 },
      entries: [
        { item: 'arrow', weight: 3, count: { min: 2, max: 5 } },
        {
          table: 'sundries',
          weight: 1,
          conditions: { class: ['thief'], when: { fact: 'cellar.open' } },
        },
      ],
    });
    expect(table.guaranteed).toEqual([{ item: new ContentRef('item', 'bread'), count: 1 }]);
    expect(table.entries[0]?.item).toEqual(new ContentRef('item', 'arrow'));
    expect(table.entries[1]).toEqual({
      table: new ContentRef('loot-table', 'sundries'),
      weight: 1,
      count: { min: 1, max: 1 },
      conditions: { class: [new ContentRef('class', 'thief')], when: { fact: 'cellar.open' } },
    });
  });

  it('rejects entries naming both or neither of item and table, bad weights and ranges', () => {
    expect(
      problems({
        ...base,
        rolls: { min: 3, max: 1 },
        entries: [
          { item: 'arrow', table: 'sundries', weight: 1 },
          { weight: 1 },
          { item: 'arrow', weight: 0, count: { min: 2, max: 1 } },
        ],
      }),
    ).toEqual([
      'rolls.max: min must not exceed max',
      'entries.0: an entry names exactly one of `item` or `table`',
      'entries.1: an entry names exactly one of `item` or `table`',
      'entries.2.weight: Too small: expected number to be >=1',
      'entries.2.count.max: min must not exceed max',
    ]);
  });

  it('rejects empty conditions and malformed fact conditions', () => {
    expect(
      problems({
        ...base,
        entries: [
          { item: 'arrow', weight: 1, conditions: {} },
          { item: 'arrow', weight: 1, conditions: { class: [] } },
          { item: 'arrow', weight: 1, conditions: { when: { fact: 'a', count: 'b' } } },
        ],
      }),
    ).toEqual([
      'entries.0.conditions: conditions need `class` or `when`; omit the field for an unconditional entry',
      'entries.1.conditions.class: Too small: expected array to have >=1 items',
      'entries.2.conditions.when: a condition is an object with exactly one of: fact, count, all, any, not, entities, signal, sustained',
    ]);
  });

  it('registers entry fact conditions for the load-time condition check', () => {
    const table = lootTableSchema.parse({
      ...base,
      entries: [
        { item: 'arrow', weight: 1 },
        { item: 'arrow', weight: 1, conditions: { class: ['thief'] } },
        { item: 'arrow', weight: 1, conditions: { when: { fact: 'cellar.open' } } },
      ],
    });
    expect(CONDITION_USAGES['loot-table']?.(table as never)).toEqual([
      { pointer: '/entries/2/conditions/when', condition: { fact: 'cellar.open' } },
    ]);
  });

  it('fails the load for an undeclared fact or a missing table, item or class', () => {
    const file = (json: object) => ({
      path: 'src/content/data/loot-table/crate.json',
      text: JSON.stringify({ ...base, ...json }),
    });
    const load = (json: object) => {
      try {
        loadContent(contentTypes, [file(json)], contentChecks);
        return [];
      } catch (error) {
        return (error as ContentLoadError).issues.map((i) => `${i.pointer}: ${i.message}`);
      }
    };
    expect(
      load({
        entries: [
          { item: 'no-such-item', weight: 1 },
          { table: 'no-such-table', weight: 1, conditions: { class: ['bard'] } },
        ],
      }),
    ).toEqual([
      '/entries/0/item: loot-table:crate references missing item:no-such-item',
      '/entries/1/table: loot-table:crate references missing loot-table:no-such-table',
      '/entries/1/conditions/class/0: loot-table:crate references missing class:bard',
    ]);
    expect(
      load({ entries: [{ table: 'crate', weight: 1, conditions: { when: { fact: 'nope' } } }] }),
    ).toEqual([
      '/entries/0/conditions/when/fact: loot-table:crate names undeclared fact "nope": declare it in src/content/data/fact/',
      // A table rolling itself is a cycle (the loot validator, mw-e18.2).
      '/entries/0/table: loot-table:crate entries[0] closes a cycle of nested tables: crate > crate',
    ]);
  });
});

describeContent('loot-table', 'is valid and round-trips', (entry) => {
  expect(lootTableSchema.parse(JSON.parse(serializeContent(entry)))).toEqual(entry);
  expect(entry.guaranteed.length + entry.entries.length).toBeGreaterThan(0);
});
