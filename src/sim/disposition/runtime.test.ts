import { describe, expect, it } from 'vitest';
import { DamageApplied, type DamageResult } from '../combat/damage/events';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import { installFactions, joinFaction } from '../factions/runtime';
import { buildFactionTable, PLAYER_FACTION } from '../factions/table';
import {
  clampDisposition,
  dispositionStance,
  DISPOSITION_MAX,
  DISPOSITION_MIN,
  STANCE_SEED,
} from './bands';
import {
  compileDispositionRules,
  decayedScore,
  DispositionChanged,
  DispositionComponent,
  dispositionLogicHost,
  Dispositions,
  DispositionStanceChanged,
  DispositionTrigger,
  gameMinutesNow,
  type DispositionChange,
  type DispositionConfig,
} from './runtime';
import { installGameClock } from '../gametime/clock';
import { DEFAULT_CLOCK_CONFIG } from '../gametime/config';

const factions = buildFactionTable([
  {
    id: 'goblins',
    towardPlayer: 'wary',
    towardMembers: 'ally',
    towardOthers: 'neutral',
    relations: [],
  },
  {
    id: 'folk',
    towardPlayer: 'friendly',
    towardMembers: 'ally',
    towardOthers: 'neutral',
    relations: [],
  },
]);
const rules = compileDispositionRules([
  { id: 'attacked', delta: -40 },
  { id: 'fed', delta: 15 },
]);

interface Setup {
  readonly w: World<never>;
  readonly d: Dispositions;
  readonly player: EntityId;
  readonly clock: { minutes: number };
}

function setup(config: Partial<DispositionConfig> = {}): Setup {
  const w = installFactions(new World<never>({ seed: 3 }));
  const clock = { minutes: 0 };
  const player = w.spawn();
  joinFaction(w, factions, player, PLAYER_FACTION);
  const d = new Dispositions(w, { factions, rules, now: () => clock.minutes, ...config });
  return { w, d, player, clock };
}

function creature(s: Setup, faction = 'folk'): EntityId {
  const e = s.w.spawn();
  joinFaction(s.w, factions, e, faction);
  return e;
}

function changes(w: World<never>, type = DispositionChanged): DispositionChange[] {
  const seen: DispositionChange[] = [];
  w.events.on(type, (c) => seen.push(c));
  return seen;
}

function hit(s: Setup, instigator: EntityId | null, target: EntityId): void {
  s.w.events.emit(DamageApplied, { target, packet: { instigator } } as unknown as DamageResult);
  s.w.step();
}

describe('stances', () => {
  it('maps scores to stances at the documented thresholds', () => {
    const at = (n: number) => dispositionStance(n);
    expect([-100, -51, -50, -11, -10, 0, 10, 11, 50, 51, 100].map(at)).toEqual([
      'hostile',
      'hostile',
      'wary',
      'wary',
      'neutral',
      'neutral',
      'neutral',
      'friendly',
      'friendly',
      'devoted',
      'devoted',
    ]);
  });

  it('clamps to -100..100 and every seed lies inside its own faction-stance band', () => {
    expect(clampDisposition(500)).toBe(DISPOSITION_MAX);
    expect(clampDisposition(-500)).toBe(DISPOSITION_MIN);
    expect(dispositionStance(STANCE_SEED.friendly)).toBe('friendly');
    expect(dispositionStance(STANCE_SEED.ally)).toBe('devoted');
    expect(dispositionStance(STANCE_SEED.hostile)).toBe('hostile');
    expect(dispositionStance(STANCE_SEED.wary)).toBe('wary');
  });
});

describe('disposition toward the player', () => {
  it('AC-1: attacking a creature at 0 makes it -40 and wary', () => {
    const s = setup();
    const e = creature(s);
    s.d.adjust(e, -30, 'setup'); // 30 -> 0
    expect(s.d.get(e)).toBe(0);
    s.d.listen();
    hit(s, s.player, e);
    expect(s.d.get(e)).toBe(-40);
    expect(s.d.stance(e)).toBe('wary');
  });

  it('AC-1: only the player hitting a creature counts as an attack', () => {
    const s = setup();
    s.d.listen();
    const e = creature(s);
    const other = creature(s);
    const prop = s.w.spawn();
    hit(s, other, e); // a creature hit it
    hit(s, null, e); // the environment hit it
    hit(s, e, e); // hit itself
    hit(s, s.player, prop); // not a creature
    expect(s.d.get(e)).toBe(STANCE_SEED.friendly);
    expect(s.w.isRegistered(DispositionComponent)).toBe(false);
  });

  it('AC-2: a +15 modifier at 95 clamps to 100, and at the limit nothing is emitted', () => {
    const s = setup();
    const e = creature(s);
    s.d.adjust(e, 65, 'setup'); // 30 -> 95
    s.w.step();
    const seen = changes(s.w);
    expect(s.d.trigger(e, 'fed')).toBe(true);
    s.w.step();
    expect(s.d.get(e)).toBe(100);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ before: 95, after: 100, delta: 15, cause: 'fed' });
    expect(s.d.adjust(e, 15, 'fed')).toBe(100);
    s.w.step();
    expect(seen).toHaveLength(1);
  });

  it('AC-3: decay of 1 per minute toward baseline 0 takes 20 to 10 after 10 minutes', () => {
    const s = setup({ defaultsOf: () => ({ baseline: 0, decayPerMinute: 1 }) });
    const e = creature(s);
    s.d.adjust(e, 20, 'setup');
    expect(s.d.get(e)).toBe(20);
    s.clock.minutes = 10;
    expect(s.d.get(e)).toBe(10);
    s.clock.minutes = 500; // never overshoots the baseline
    expect(s.d.get(e)).toBe(0);
    s.d.adjust(e, -5, 'setup');
    s.clock.minutes = 503;
    expect(s.d.get(e)).toBe(-2); // from below, drifting up
    expect(decayedScore({ score: 7, baseline: 7, decayPerMinute: 2, at: 0 }, 99)).toBe(7);
  });

  it('AC-3: a change settles decay first, so only time since the last change counts', () => {
    const s = setup({ defaultsOf: () => ({ baseline: 0, decayPerMinute: 1 }) });
    const e = creature(s);
    s.d.adjust(e, 20, 'setup');
    s.clock.minutes = 10;
    s.d.adjust(e, 5, 'fed');
    expect(s.d.get(e)).toBe(15);
    s.clock.minutes = 12;
    expect(s.d.get(e)).toBe(13);
  });

  it('AC-4: a rule for an event that never fires leaves disposition alone and adds no state', () => {
    const s = setup();
    s.d.listen();
    const e = creature(s);
    for (let i = 0; i < 10_000; i++) s.w.step();
    expect(s.d.get(e)).toBe(STANCE_SEED.friendly);
    expect(s.w.isRegistered(DispositionComponent)).toBe(false);
  });

  it('seeds from the faction stance, then the definition: baseline wins, unknown creatures are neutral', () => {
    const s = setup({
      defaultsOf: (_w, e) => (e === 99 ? undefined : { baseline: -20 }),
    });
    const gob = creature(s, 'goblins');
    expect(s.d.get(gob)).toBe(-20);
    const plain = setup();
    expect(plain.d.get(creature(plain, 'goblins'))).toBe(STANCE_SEED.wary);
    expect(plain.d.get(plain.w.spawn())).toBe(0); // no faction at all
    expect(plain.d.get(creature(plain))).toBe(STANCE_SEED.friendly);
  });

  it('emits DispositionChanged with the stances, and StanceChanged only on a crossing', () => {
    const s = setup();
    const e = creature(s);
    const all = changes(s.w);
    const crossed = changes(s.w, DispositionStanceChanged);
    s.d.adjust(e, 5, 'gift'); // 30 -> 35, still friendly
    s.d.adjust(e, -70, 'insult'); // 35 -> -35, wary
    s.w.step();
    expect(all.map((c) => [c.before, c.after, c.stanceBefore, c.stanceAfter, c.cause])).toEqual([
      [30, 35, 'friendly', 'friendly', 'gift'],
      [35, -35, 'friendly', 'wary', 'insult'],
    ]);
    expect(crossed).toHaveLength(1);
    expect(crossed[0]?.after).toBe(-35);
  });

  it('a second creature gets its own record once the component is registered', () => {
    const s = setup();
    const a = creature(s);
    const b = creature(s, 'goblins');
    s.d.adjust(a, 10, 'x');
    s.d.adjust(b, 10, 'x');
    expect([s.d.get(a), s.d.get(b)]).toEqual([40, -20]);
  });

  it('a zero or unmoving change stores nothing; non-finite changes throw', () => {
    const s = setup();
    const e = creature(s);
    expect(s.d.adjust(e, 0, 'noop')).toBe(30);
    expect(s.w.isRegistered(DispositionComponent)).toBe(false);
    expect(() => s.d.adjust(e, Number.NaN, 'bad')).toThrow(RangeError);
  });

  it('DispositionTrigger events run rules by type; unknown types are ignored; listen() unsubscribes', () => {
    const s = setup();
    const off = s.d.listen();
    const e = creature(s);
    s.w.events.emit(DispositionTrigger, { type: 'fed', target: e });
    s.w.events.emit(DispositionTrigger, { type: 'sneezed', target: e });
    s.w.step();
    expect(s.d.get(e)).toBe(45);
    expect(s.d.trigger(e, 'sneezed')).toBe(false);
    off();
    s.w.events.emit(DispositionTrigger, { type: 'fed', target: e });
    hit(s, s.player, e);
    expect(s.d.get(e)).toBe(45);
  });

  it('reads follow the game clock when none is injected', () => {
    const w = installFactions(new World<never>({ seed: 1 }));
    expect(gameMinutesNow(w)).toBe(0);
    const clock = installGameClock(w, DEFAULT_CLOCK_CONFIG);
    const d = new Dispositions(w, { factions, rules });
    const e = w.spawn();
    joinFaction(w, factions, e, 'folk');
    d.adjust(e, 1, 'x');
    clock.advanceTime(60, 'rest');
    expect(gameMinutesNow(w)).toBe(clock.total());
    expect(d.get(e)).toBe(31); // no decay configured
  });

  it('adapts to the logic DSL host by NPC name', () => {
    const s = setup();
    const e = creature(s);
    const host = dispositionLogicHost(s.d, (npc) => (npc === 'miller' ? e : undefined));
    expect(host.disposition('miller')).toBe(30);
    expect(host.disposition('ghost')).toBe(0);
    expect(host.adjustDisposition('miller', 10)).toBeUndefined();
    expect(host.disposition('miller')).toBe(40);
    expect(host.adjustDisposition('ghost', 10)).toBe('unknown-npc:ghost');
    expect(changes(s.w)).toEqual([]);
  });
});

describe('disposition component', () => {
  it('rejects malformed saved data', () => {
    const ok = { score: -37, baseline: 0, decayPerMinute: 0, at: 5 };
    expect(DispositionComponent.deserialize(ok)).toEqual(ok);
    for (const bad of [
      null,
      { ...ok, score: 101 },
      { ...ok, baseline: -101 },
      { ...ok, decayPerMinute: -1 },
      { ...ok, at: 'x' },
      { ...ok, score: Number.NaN },
    ]) {
      expect(() => DispositionComponent.deserialize(bad)).toThrow(RangeError);
    }
  });
});
