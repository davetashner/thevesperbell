import { describe, expect, it } from 'vitest';
import {
  buildFactionTable,
  factionSpecFromDef,
  FactionTableError,
  PLAYER_FACTION,
  type FactionRelationSpec,
  type FactionSpec,
} from './table';

const faction = (
  id: string,
  relations: readonly FactionRelationSpec[] = [],
  extra: Partial<FactionSpec> = {},
): FactionSpec => ({
  id,
  towardPlayer: 'neutral',
  towardMembers: 'ally',
  towardOthers: 'neutral',
  relations,
  ...extra,
});
const rel = (target: string, stance: FactionRelationSpec['stance'], mutual = false) => ({
  faction: target,
  stance,
  mutual,
});

const issuesOf = (specs: readonly FactionSpec[]) => {
  try {
    buildFactionTable(specs);
  } catch (error) {
    if (error instanceof FactionTableError) return error.issues;
  }
  throw new Error('expected an invalid table');
};

describe('faction table', () => {
  it('AC-1: a declared hostile relation is the base stance', () => {
    const table = buildFactionTable([
      faction('goblins', [rel('spiders', 'hostile')]),
      faction('spiders'),
    ]);
    expect(table.base('goblins', 'spiders')).toBe('hostile');
  });

  it('AC-2: asymmetric relations keep their own direction', () => {
    const table = buildFactionTable([
      faction('wolves', [rel('sheep', 'prey')]),
      faction('sheep', [rel('wolves', 'predator')]),
    ]);
    expect([table.base('wolves', 'sheep'), table.base('sheep', 'wolves')]).toEqual([
      'prey',
      'predator',
    ]);
  });

  it('reads members, the player, declared, mutual and default stances in that order', () => {
    const table = buildFactionTable([
      faction('wolves', [rel('sheep', 'prey', true), rel('bears', 'wary', true)], {
        towardPlayer: 'prey',
        towardMembers: 'friendly',
        towardOthers: 'wary',
      }),
      faction('sheep'),
      faction('bears', [rel('wolves', 'wary')]),
      faction('crows'),
    ]);
    expect(table.base('wolves', 'wolves')).toBe('friendly');
    expect(table.base('wolves', PLAYER_FACTION)).toBe('prey');
    expect(table.base('wolves', 'sheep')).toBe('prey');
    expect(table.base('sheep', 'wolves')).toBe('predator'); // mirrored
    expect(table.base('bears', 'wolves')).toBe('wary'); // declared, agreeing with the mutual
    expect(table.base('wolves', 'crows')).toBe('wary'); // towardOthers
    expect(table.base('crows', 'wolves')).toBe('neutral');
  });

  it('gives the player a neutral row and knows its ids', () => {
    const table = buildFactionTable([faction('b'), faction('a')]);
    expect(table.ids).toEqual(['a', 'b']);
    expect([table.has('a'), table.has(PLAYER_FACTION), table.has('z')]).toEqual([
      true,
      true,
      false,
    ]);
    expect([table.base(PLAYER_FACTION, 'a'), table.base(PLAYER_FACTION, PLAYER_FACTION)]).toEqual([
      'neutral',
      'neutral',
    ]);
  });

  it('rejects lookups of unknown factions on either side', () => {
    const table = buildFactionTable([faction('a')]);
    expect(() => table.base('z', 'a')).toThrow('unknown faction "z"');
    expect(() => table.base('a', 'z')).toThrow('unknown faction "z"');
    expect(() => table.base(PLAYER_FACTION, 'z')).toThrow('unknown faction "z"');
  });

  it('lists every problem: reserved and duplicate ids, unknown, self, repeated and contradicted relations', () => {
    expect(
      issuesOf([
        faction(PLAYER_FACTION),
        faction('a', [
          rel('ghost', 'hostile'),
          rel('a', 'ally'),
          rel('b', 'wary'),
          rel('b', 'ally'),
        ]),
        faction('a'),
        faction('b', [rel('c', 'prey', true)]),
        faction('c', [rel('b', 'hostile')]),
      ]),
    ).toEqual([
      '"player" is reserved for the player',
      'duplicate faction "a"',
      'a → ghost: unknown faction "ghost"',
      'a → a: a stance toward itself is towardMembers',
      'a → b: listed twice',
      'b → c: mutual prey expects c → b predator, but it declares hostile',
    ]);
  });

  it('builds a spec from a loaded content entry (refs become ids)', () => {
    expect(
      factionSpecFromDef({
        id: 'wolves',
        name: 'Wolves',
        notes: 'Test.',
        towardPlayer: 'prey',
        towardMembers: 'ally',
        towardOthers: 'neutral',
        dispositionSpread: 0,
        relations: [
          { faction: { type: 'faction', id: 'sheep' } as never, stance: 'prey', mutual: true },
        ],
      }),
    ).toEqual(faction('wolves', [rel('sheep', 'prey', true)], { towardPlayer: 'prey' }));
  });

  it('formats every issue into the error message', () => {
    const error = new FactionTableError(['one', 'two']);
    expect(error.name).toBe('FactionTableError');
    expect(error.message).toBe('invalid faction table:\n  - one\n  - two');
  });
});
