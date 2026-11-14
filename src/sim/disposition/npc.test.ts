import { describe, expect, it } from 'vitest';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import { installFactions, joinFaction } from '../factions/runtime';
import { buildFactionTable, PLAYER_FACTION } from '../factions/table';
import { NPC_BANDS, npcBand } from './bands';
import {
  compileDispositionRules,
  compileFactionSpread,
  CrimeTheft,
  DispositionBandChanged,
  DispositionChanged,
  Dispositions,
  ruleDelta,
  type DispositionChange,
  type DispositionConfig,
} from './runtime';

const spec = (id: string) => ({
  id,
  towardPlayer: 'neutral' as const,
  towardMembers: 'ally' as const,
  towardOthers: 'neutral' as const,
  relations: [],
});
const factions = buildFactionTable([spec('folk'), spec('loners')]);
const rules = compileDispositionRules([
  {
    id: 'theft',
    delta: -10,
    valueTiers: [
      { minValue: 0, scale: 1 },
      { minValue: 25, scale: 2 },
      { minValue: 100, scale: 3 },
    ],
  },
  { id: 'witnessed-theft', delta: -20 },
]);
const spread = compileFactionSpread([
  { id: 'folk', dispositionSpread: 0.5 },
  { id: 'loners', dispositionSpread: 0 },
]);

function setup(config: Partial<DispositionConfig> = {}) {
  const w = installFactions(new World<never>({ seed: 1 }));
  const player = w.spawn();
  joinFaction(w, factions, player, PLAYER_FACTION);
  const d = new Dispositions(w, { factions, rules, spread, now: () => 0, ...config });
  const npc = (faction = 'folk'): EntityId => {
    const e = w.spawn();
    joinFaction(w, factions, e, faction);
    return e;
  };
  const bands: DispositionChange[] = [];
  const changes: DispositionChange[] = [];
  w.events.on(DispositionBandChanged, (c) => bands.push(c));
  w.events.on(DispositionChanged, (c) => changes.push(c));
  return { w, d, npc, bands, changes };
}

describe('NPC bands', () => {
  it('maps scores to hostile, cold, neutral, friendly and devoted at the documented thresholds', () => {
    expect([-100, -51, -50, -11, -10, 0, 50, 51, 75, 76, 100].map(npcBand)).toEqual([
      'hostile',
      'hostile',
      'cold',
      'cold',
      'neutral',
      'neutral',
      'neutral',
      'friendly',
      'friendly',
      'devoted',
      'devoted',
    ]);
    expect(NPC_BANDS).toHaveLength(5);
  });
});

describe('disposition bands and clamp (mw-e22.4)', () => {
  it('AC-1: 45 (neutral) plus 10 is 55, friendly, and exactly one disposition.bandChanged fires', () => {
    const s = setup({ defaultsOf: () => ({ baseline: 45 }) });
    const e = s.npc('loners');
    expect(npcBand(s.d.get(e))).toBe('neutral');
    expect(s.d.adjust(e, 10, 'gift')).toBe(55);
    s.w.step();
    expect(s.bands).toHaveLength(1);
    expect(s.bands[0]).toMatchObject({
      entity: e,
      before: 45,
      after: 55,
      bandBefore: 'neutral',
      bandAfter: 'friendly',
    });
    expect(DispositionBandChanged.name).toBe('disposition.bandChanged');
    s.d.adjust(e, 5, 'gift'); // friendly to friendly: no band event
    s.w.step();
    expect(s.bands).toHaveLength(1);
  });

  it('AC-2: a +200 effect clamps at 100', () => {
    const s = setup();
    const e = s.npc('loners');
    expect(s.d.adjust(e, 200, 'miracle')).toBe(100);
    expect(s.d.get(e)).toBe(100);
  });
});

describe('faction propagation (mw-e22.4)', () => {
  it('AC-3: with spread 0.5, -20 to one member gives every other member -10, once, and no echo', () => {
    const s = setup();
    const [a, b, c] = [s.npc(), s.npc(), s.npc()];
    const outsider = s.npc('loners');
    s.d.adjust(a, -20, 'insult');
    s.w.step();
    expect([a, b, c].map((e) => s.d.get(e))).toEqual([-20, -10, -10]);
    expect(s.d.get(outsider)).toBe(0);
    expect(s.changes.map((x) => [x.entity, x.delta, x.cause])).toEqual([
      [a, -20, 'insult'],
      [b, -10, 'faction:insult'],
      [c, -10, 'faction:insult'],
    ]);
  });

  it('a change that moved nothing (already at the limit) spreads nothing; a spread of 0 spreads nothing', () => {
    const s = setup();
    const [a, b] = [s.npc(), s.npc()];
    s.d.adjust(a, 100, 'x');
    s.d.adjust(a, 5, 'x');
    s.w.step();
    expect(s.changes.map((c) => c.entity)).toEqual([a, b]);
    const l = setup();
    const [x, y] = [l.npc('loners'), l.npc('loners')];
    l.d.adjust(x, -30, 'x');
    expect(l.d.get(y)).toBe(0);
  });

  it('an entity without a faction spreads nothing', () => {
    const s = setup();
    const prop = s.w.spawn();
    s.npc();
    expect(s.d.adjust(prop, -10, 'x')).toBe(-10);
    s.w.step();
    expect(s.changes).toHaveLength(1);
  });
});

describe('crime.theft (mw-e22.4)', () => {
  it('AC-4: the owner, among the witnesses, drops by the theft amount scaled by item value tier', () => {
    const run = (itemValue: number) => {
      const s = setup();
      const owner = s.npc('loners');
      s.d.listen();
      s.w.events.emit(CrimeTheft, { itemValue, owner, witnesses: [owner] });
      s.w.step();
      return s.d.get(owner);
    };
    expect([0, 24, 25, 99, 100, 5000].map(run)).toEqual([-10, -10, -20, -20, -30, -30]);
  });

  it('other witnesses answer the witnessed-theft rule; a duplicate witness counts once; an absent owner is unmoved', () => {
    const s = setup();
    s.d.listen();
    const owner = s.npc('loners');
    const bystander = s.npc('loners');
    const away = s.npc('loners');
    s.w.events.emit(CrimeTheft, {
      itemValue: 30,
      owner,
      witnesses: [owner, bystander, bystander],
    });
    s.w.step();
    expect([owner, bystander, away].map((e) => s.d.get(e))).toEqual([-20, -20, 0]);
    s.w.events.emit(CrimeTheft, { itemValue: 30, owner: away, witnesses: [bystander] });
    s.w.step();
    expect(s.d.get(away)).toBe(0);
  });

  it('without theft rules loaded a theft changes nobody', () => {
    const s = setup({ rules: compileDispositionRules([]) });
    const owner = s.npc('loners');
    const other = s.npc('loners');
    s.d.crimeTheft({ itemValue: 500, owner, witnesses: [owner, other] });
    s.w.step();
    expect(s.changes).toHaveLength(0);
  });

  it('ruleDelta: the highest tier reached scales the delta; no tiers = x1', () => {
    expect(ruleDelta({ delta: -4, valueTiers: [] }, 999)).toBe(-4);
    expect(ruleDelta({ delta: -4, valueTiers: [{ minValue: 10, scale: 3 }] }, 9)).toBe(-4);
    expect(ruleDelta({ delta: -4, valueTiers: [{ minValue: 10, scale: 3 }] })).toBe(-4);
  });
});

describe('class affinity baseline (mw-e22.4)', () => {
  const affinity = { thief: 30, knight: -15 };
  const make = (playerClass: string | undefined, classAffinity: typeof affinity | undefined) =>
    setup({
      playerClass: () => playerClass,
      defaultsOf: () => (classAffinity === undefined ? {} : { classAffinity }),
    });

  it('AC-5: a never-met NPC reads the data baseline for the player class, default 0', () => {
    const s0 = setup();
    expect(s0.d.get(s0.npc('loners'))).toBe(0);
    for (const [cls, expected] of [
      ['thief', 30],
      ['knight', -15],
      ['archer', 0],
      [undefined, 0],
    ] as const) {
      const s = make(cls, affinity);
      expect(s.d.get(s.npc('loners'))).toBe(expected);
    }
    const none = make('thief', undefined);
    expect(none.d.get(none.npc('loners'))).toBe(0);
  });

  it('adds to an explicit baseline, clamps, and is what decay returns to', () => {
    const s = setup({
      playerClass: () => 'thief',
      defaultsOf: () => ({ baseline: 90, classAffinity: affinity, decayPerMinute: 1 }),
    });
    expect(s.d.get(s.npc('loners'))).toBe(100);
  });
});
