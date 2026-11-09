import { describe, expect, it } from 'vitest';
import { Died, type Death } from '../combat/damage/events';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import { hashWorld } from '../snapshot';
import {
  applyWitnessedKill,
  factionKillRule,
  FactionMemberComponent,
  factionOf,
  FactionRelationChanged,
  factionStance,
  FactionStancesComponent,
  improveFactionStance,
  isFriendlyToPlayer,
  installFactions,
  joinFaction,
  membershipFromCreature,
  relation,
  setFactionStance,
  stanceTowardPlayer,
  WITNESSED_KILL,
  worsenFactionStance,
  type FactionRelationChange,
} from './runtime';
import { buildFactionTable, PLAYER_FACTION, UNALIGNED_FACTION } from './table';

const table = buildFactionTable([
  {
    id: 'goblins',
    towardPlayer: 'wary',
    towardMembers: 'ally',
    towardOthers: 'neutral',
    relations: [{ faction: 'spiders', stance: 'hostile', mutual: true }],
  },
  {
    id: 'spiders',
    towardPlayer: 'hostile',
    towardMembers: 'ally',
    towardOthers: 'neutral',
    relations: [],
  },
  {
    id: 'wolves',
    towardPlayer: 'prey',
    towardMembers: 'ally',
    towardOthers: 'neutral',
    relations: [{ faction: 'sheep', stance: 'prey', mutual: false }],
  },
  {
    id: 'sheep',
    towardPlayer: 'neutral',
    towardMembers: 'friendly',
    towardOthers: 'neutral',
    relations: [{ faction: 'wolves', stance: 'predator', mutual: false }],
  },
]);

const world = () => installFactions(new World<never>({ seed: 7 }));

function member(w: World<never>, faction: string, toward = {}): EntityId {
  const e = w.spawn();
  joinFaction(w, table, e, faction, toward);
  return e;
}

function changes(w: World<never>): FactionRelationChange[] {
  const seen: FactionRelationChange[] = [];
  w.events.on(FactionRelationChanged, (c) => seen.push(c));
  return seen;
}

/** The stored faction-wide stance rows. */
function stored(w: World<never>): unknown[] {
  const rows: unknown[] = [];
  w.query(FactionStancesComponent).forEach((_id, r) => rows.push(...r));
  return rows;
}

/** Runs `fn` inside one sim step (as a system would) and flushes its events. */
function inStep(w: World<never>, fn: () => void): void {
  let done = false;
  w.addSystem({
    name: `once-${String(w.tick)}`,
    run: () => {
      if (!done) fn();
      done = true;
    },
  });
  w.step();
}

describe('stance toward the player (mw-e09.5)', () => {
  it('is the creature’s own override, else its faction’s current stance, else unknown', () => {
    const w = world();
    const goblin = member(w, 'goblins');
    const friend = member(w, 'goblins', { [PLAYER_FACTION]: 'friendly' });
    const crate = w.spawn();
    w.step();
    expect(stanceTowardPlayer(w, table, goblin)).toBe('wary');
    expect(stanceTowardPlayer(w, table, friend)).toBe('friendly');
    expect(stanceTowardPlayer(w, table, crate)).toBeUndefined();
    setFactionStance(w, table, 'goblins', PLAYER_FACTION, 'ally', 'test');
    expect(stanceTowardPlayer(w, table, goblin)).toBe('ally');
    expect(stanceTowardPlayer(w, table, friend)).toBe('friendly');
  });

  it('only allies and friends are friendly to the player', () => {
    const w = world();
    const ally = member(w, 'sheep', { [PLAYER_FACTION]: 'ally' });
    const friend = member(w, 'sheep', { [PLAYER_FACTION]: 'friendly' });
    const neutral = member(w, 'sheep');
    const wary = member(w, 'goblins');
    const hostile = member(w, 'spiders');
    const crate = w.spawn();
    w.step();
    expect(
      [ally, friend, neutral, wary, hostile, crate].map((e) => isFriendlyToPlayer(w, table, e)),
    ).toEqual([true, true, false, false, false, false]);
  });
});

describe('relation queries', () => {
  it('AC-1: members of a faction hostile to another are hostile to its members', () => {
    const w = world();
    const goblin = member(w, 'goblins');
    const spider = member(w, 'spiders');
    expect(relation(w, table, goblin, spider)).toBe('hostile');
    expect(relation(w, table, spider, goblin)).toBe('hostile'); // the mutual mirror
  });

  it('AC-2: an asymmetric pair answers each direction with its own stance', () => {
    const w = world();
    const wolf = member(w, 'wolves');
    const sheep = member(w, 'sheep');
    expect(relation(w, table, wolf, sheep)).toBe('prey');
    expect(relation(w, table, sheep, wolf)).toBe('predator');
  });

  it('AC-3: a creature-level override applies to that creature only', () => {
    const w = world();
    const player = member(w, PLAYER_FACTION);
    const snig = member(w, 'goblins', { [PLAYER_FACTION]: 'friendly' });
    const other = member(w, 'goblins');
    expect(relation(w, table, snig, player)).toBe('friendly');
    expect(relation(w, table, other, player)).toBe('wary');
  });

  it('uses members’ own stance, and neutral when either side has no faction', () => {
    const w = world();
    const a = member(w, 'sheep');
    const b = member(w, 'sheep');
    const crate = w.spawn();
    expect(relation(w, table, a, b)).toBe('friendly');
    expect([relation(w, table, a, crate), relation(w, table, crate, a)]).toEqual([
      'neutral',
      'neutral',
    ]);
    expect([factionOf(w, a), factionOf(w, crate)]).toEqual(['sheep', undefined]);
  });

  it('gives the player a neutral stance toward everyone', () => {
    const w = world();
    const player = member(w, PLAYER_FACTION);
    expect(relation(w, table, player, member(w, 'spiders'))).toBe('neutral');
  });

  it('rejects unknown factions when joining', () => {
    const w = world();
    expect(() => {
      joinFaction(w, table, w.spawn(), 'dragons');
    }).toThrow('unknown faction "dragons"');
    expect(() => {
      joinFaction(w, table, w.spawn(), 'goblins', { dragons: 'hostile' });
    }).toThrow('unknown faction "dragons"');
  });

  it('reads a creature definition’s faction and stance toward the player', () => {
    const ref = { type: 'faction', id: 'goblins' } as never;
    expect(
      membershipFromCreature({ faction: ref, disposition: { towardPlayer: 'friendly' } }),
    ).toEqual({ faction: 'goblins', toward: { player: 'friendly' } });
    expect(membershipFromCreature({ disposition: {} })).toEqual({
      faction: UNALIGNED_FACTION,
      toward: {},
    });
  });
});

describe('faction-wide stance changes', () => {
  it('changes, emits once per change, and stores only differences from the base', () => {
    const w = world();
    const seen = changes(w);
    const goblin = member(w, 'goblins');
    const player = member(w, PLAYER_FACTION);
    inStep(w, () => {
      expect(setFactionStance(w, table, 'goblins', PLAYER_FACTION, 'friendly', 'horn-deal')).toBe(
        true,
      );
      expect(setFactionStance(w, table, 'goblins', PLAYER_FACTION, 'friendly', 'again')).toBe(
        false,
      );
      expect(worsenFactionStance(w, table, 'goblins', 'sheep', 'test')).toBe(true);
    });
    expect(relation(w, table, goblin, player)).toBe('friendly');
    expect(seen).toEqual([
      {
        tick: 0,
        from: 'goblins',
        to: 'player',
        before: 'wary',
        after: 'friendly',
        cause: 'horn-deal',
      },
      { tick: 0, from: 'goblins', to: 'sheep', before: 'neutral', after: 'wary', cause: 'test' },
    ]);
    expect(stored(w)).toEqual([
      ['goblins', 'player', 'friendly'],
      ['goblins', 'sheep', 'wary'],
    ]);

    expect(improveFactionStance(w, table, 'goblins', 'sheep', 'amends')).toBe(true);
    expect(factionStance(w, table, 'goblins', 'sheep')).toBe('neutral');
    expect(stored(w)).toEqual([['goblins', 'player', 'friendly']]);
  });

  it('refuses to set the player’s own stance and needs installFactions', () => {
    const w = world();
    expect(() => setFactionStance(w, table, PLAYER_FACTION, 'goblins', 'hostile', 'x')).toThrow(
      'the player has no faction-wide stance',
    );
    const bare = new World<never>({ seed: 1 }).register(FactionStancesComponent);
    expect(() => factionStance(bare, table, 'goblins', 'sheep')).toThrow('installFactions');
  });

  it('survives snapshot and restore, and the change is part of the state hash', () => {
    const w = world();
    const goblin = member(w, 'goblins', { sheep: 'hostile' });
    const player = member(w, PLAYER_FACTION);
    const before = hashWorld(w);
    setFactionStance(w, table, 'goblins', PLAYER_FACTION, 'hostile', 'test');
    expect(hashWorld(w)).not.toBe(before);

    const copy = world();
    copy.restore(w.snapshot());
    expect(relation(copy, table, goblin, player)).toBe('hostile');
    expect(copy.get(goblin, FactionMemberComponent)).toEqual({
      faction: 'goblins',
      toward: { sheep: 'hostile' },
    });
    expect(hashWorld(copy)).toBe(hashWorld(w));
  });

  it('rejects corrupt saved faction data', () => {
    const restore = (data: unknown) => FactionMemberComponent.deserialize(data);
    const restored = restore({ faction: 'a', toward: { c: 'wary', b: 'ally' } });
    expect(restored).toEqual({ faction: 'a', toward: { b: 'ally', c: 'wary' } });
    expect(Object.keys(restored.toward)).toEqual(['b', 'c']);
    for (const bad of [
      null,
      { faction: '', toward: {} },
      { faction: 'a' },
      { faction: 'a', toward: null },
      { faction: 'a', toward: [] },
      { faction: 'a', toward: { b: 'angry' } },
    ]) {
      expect(() => restore(bad)).toThrow('faction membership');
    }

    const rows = (data: unknown) => FactionStancesComponent.deserialize(data);
    expect(
      rows([
        ['b', 'a', 'wary'],
        ['a', 'c', 'hostile'],
        ['a', 'b', 'ally'],
      ]),
    ).toEqual([
      ['a', 'b', 'ally'],
      ['a', 'c', 'hostile'],
      ['b', 'a', 'wary'],
    ]);
    for (const bad of [
      {},
      [['a', 'b']],
      [['a', '', 'ally']],
      [[1, 'b', 'ally']],
      [['a', 'b', 'angry']],
      ['x'],
    ]) {
      expect(() => rows(bad)).toThrow('[from, to, stance] rows');
    }
    expect(() =>
      rows([
        ['a', 'b', 'ally'],
        ['a', 'b', 'wary'],
      ]),
    ).toThrow('a faction stance is stored twice');
  });
});

describe('witnessed-kill rule', () => {
  function scene() {
    const w = world();
    const seen = changes(w);
    return {
      w,
      seen,
      player: member(w, PLAYER_FACTION),
      victim: member(w, 'goblins'),
      witness: member(w, 'goblins'),
      bystander: member(w, 'sheep'),
    };
  }

  it('AC-5: a kill witnessed by kin worsens the faction one step toward the killer, emitting once', () => {
    const { w, seen, player, victim, witness } = scene();
    const second = member(w, 'goblins');
    inStep(w, () => {
      expect(
        applyWitnessedKill(w, table, { victim, killer: player, witnesses: [witness, second] }),
      ).toBe(true);
    });
    expect(factionStance(w, table, 'goblins', PLAYER_FACTION)).toBe('hostile');
    expect(seen).toEqual([
      {
        tick: 0,
        from: 'goblins',
        to: 'player',
        before: 'wary',
        after: 'hostile',
        cause: WITNESSED_KILL,
      },
    ]);
  });

  it('does nothing without kin witnesses, without factions, or within one faction', () => {
    const { w, seen, player, victim, witness, bystander } = scene();
    const crate = w.spawn();
    const cases = [
      { victim, killer: player, witnesses: [] },
      { victim, killer: player, witnesses: [bystander, victim, player] },
      { victim: crate, killer: player, witnesses: [witness] },
      { victim, killer: crate, witnesses: [witness] },
      { victim, killer: witness, witnesses: [member(w, 'goblins')] },
    ];
    expect(cases.map((kill) => applyWitnessedKill(w, table, kill))).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    w.step();
    expect(seen).toEqual([]);
  });

  it('runs on Died events, asking perception who saw the kill', () => {
    const { w, seen, player, victim, witness } = scene();
    const asked: Death[] = [];
    factionKillRule(w, table, (_w, death) => {
      asked.push(death);
      return [witness];
    });
    const death = (killer: EntityId | null): Death => ({
      tick: 0,
      target: victim,
      killer,
      source: null,
      tags: [],
    });
    inStep(w, () => {
      w.events.emit(Died, death(null));
      w.events.emit(Died, death(player));
    });
    expect(asked).toEqual([death(player)]);
    expect(seen.map((c) => [c.from, c.to, c.after])).toEqual([['goblins', 'player', 'hostile']]);
  });
});
