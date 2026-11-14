// Fact persistence policies in the content registry (mw-e27.7): which declarations validate, and
// how they reach the world's fact store.
import { factSchema, type GameEntry } from '@content/index';
import { declareFacts, factSpecFromDef, World } from '@sim/index';
import { describe, expect, it } from 'vitest';

describe('fact registry policies', () => {
  const group = (fact: object) => ({
    id: 'policies',
    name: 'Policies',
    notes: 'Test.',
    facts: [{ type: 'bool', default: false, description: 'd', owner: 'test', ...fact }],
  });

  it('AC-5: the registry fails to validate a fact declared transient and with a reset timer', () => {
    const result = factSchema.safeParse(
      group({ key: 'a.b', persistence: 'transient', resetAfter: 100 }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({
      path: ['facts', 0, 'resetAfter'],
      message: 'resetAfter needs persistence "reset-after", not "transient"',
    });
  });

  it('validates every policy shape', () => {
    const issues = (fact: object): string[] => {
      const result = factSchema.safeParse(group(fact));
      return result.success
        ? []
        : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    };
    expect(issues({ key: 'a.b', persistence: 'reset-after', resetAfter: 72_000 })).toEqual([]);
    expect(issues({ key: 'a.b', persistence: 'reset-on-rest' })).toEqual([]);
    expect(issues({ key: 'a.b', persistence: 'transient' })).toEqual([]);
    expect(
      issues({ key: 'a.b', persistence: 'decays-to', decaysTo: { from: [true], to: false } }),
    ).toEqual([]);
    expect(issues({ key: 'a.b', persistence: 'reset-after' })).toEqual([
      'facts.0.resetAfter: reset-after needs resetAfter (sim ticks)',
    ]);
    expect(issues({ key: 'a.b', persistence: 'decays-to' })).toEqual([
      'facts.0.decaysTo: decays-to needs decaysTo',
    ]);
    expect(issues({ key: 'a.b', decaysTo: { from: [true], to: false } })).toEqual([
      'facts.0.decaysTo: decaysTo needs persistence "decays-to", not "permanent"',
    ]);
    expect(
      issues({ key: 'a.b', persistence: 'decays-to', decaysTo: { from: ['x'], to: 'y' } }),
    ).toEqual([
      'facts.0.decaysTo.from.0: is not a value of type bool',
      'facts.0.decaysTo.to: is not a value of type bool',
    ]);
    expect(issues({ key: 'a.b', type: 'id', default: null, persistence: 'reset-on-rest' })).toEqual(
      ['facts.0.default: reset-on-rest needs a default to return to'],
    );
  });

  it('checks decaysTo values against every fact type', () => {
    const typed = (type: string, extra: object, from: unknown, to: unknown): boolean =>
      factSchema.safeParse({
        id: 'typed',
        name: 'Typed',
        notes: 'Test.',
        facts: [
          {
            key: 'a.b',
            type,
            description: 'd',
            owner: 'test',
            persistence: 'decays-to',
            decaysTo: { from: [from], to },
            ...extra,
          },
        ],
      }).success;
    expect(typed('int', { default: 0 }, 1, 2)).toBe(true);
    expect(typed('int', { default: 0 }, true, 2)).toBe(false);
    expect(typed('tick', { default: 0 }, 1, 2)).toBe(true);
    expect(typed('tick', { default: 0 }, -1, 2)).toBe(false);
    expect(typed('id', { default: null }, 'a', 'b')).toBe(true);
    expect(typed('id', { default: null }, 1, 'b')).toBe(false);
    expect(typed('enum', { values: ['a', 'b'], default: 'a' }, 'a', 'b')).toBe(true);
    expect(typed('enum', { values: ['a', 'b'], default: 'a' }, 'a', 'c')).toBe(false);
  });

  it('declares the policy on the world’s fact store', () => {
    const parsed = factSchema.parse({
      ...group({ key: 'a.b', persistence: 'reset-after', resetAfter: 40 }),
    }) as unknown as GameEntry<'fact'>;
    expect(parsed.facts.map(factSpecFromDef)[0]).toMatchObject({
      persistence: 'reset-after',
      resetAfter: 40,
    });
    const world = new World({ seed: 1 });
    declareFacts(world.facts, [parsed], { mode: 'throw' });
    expect(world.facts.persistenceOf('a.b')).toBe('reset-after');
    const decay = factSchema.parse(
      group({
        key: 'c.d',
        persistence: 'decays-to',
        decaysTo: { from: [true], to: false },
      }),
    ) as unknown as GameEntry<'fact'>;
    expect(decay.facts.map(factSpecFromDef)[0]).toMatchObject({
      persistence: 'decays-to',
      decaysTo: { from: [true], to: false },
    });
  });
});
