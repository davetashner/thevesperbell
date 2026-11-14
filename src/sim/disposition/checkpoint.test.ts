import { describe, expect, it } from 'vitest';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import { installFactions, joinFaction } from '../factions/runtime';
import { buildFactionTable, PLAYER_FACTION } from '../factions/table';
import {
  applyLogicEffects,
  composeCheckpoints,
  MemoryLogicHost,
  validateLogicEffects,
} from '../logic';
import type { LogicHost, LogicNode } from '../logic';
import {
  compileDispositionRules,
  compileFactionSpread,
  DispositionBandChanged,
  DispositionChanged,
  DispositionComponent,
  dispositionLogicHost,
  Dispositions,
  DispositionStanceChanged,
} from './runtime';

const spec = (id: string) => ({
  id,
  towardPlayer: 'neutral' as const,
  towardMembers: 'ally' as const,
  towardOthers: 'neutral' as const,
  relations: [],
});
const factions = buildFactionTable([spec('folk')]);
const spread = compileFactionSpread([{ id: 'folk', dispositionSpread: 0.5 }]);

function setup() {
  const w = installFactions(new World<never>({ seed: 1 }));
  const player = w.spawn();
  joinFaction(w, factions, player, PLAYER_FACTION);
  const d = new Dispositions(w, {
    factions,
    rules: compileDispositionRules([]),
    spread,
    now: () => 0,
  });
  const npcs = [0, 1, 2].map((): EntityId => {
    const e = w.spawn();
    joinFaction(w, factions, e, 'folk');
    return e;
  });
  const names = new Map(npcs.map((e, i) => [`n${String(i)}`, e]));
  const seen: string[] = [];
  w.events.on(DispositionChanged, (c) => seen.push(`changed:${String(c.entity)}`));
  w.events.on(DispositionStanceChanged, (c) => seen.push(`stance:${String(c.entity)}`));
  w.events.on(DispositionBandChanged, (c) => seen.push(`band:${String(c.entity)}`));
  const logic = dispositionLogicHost(d, (n) => names.get(n));
  // A game host: memory-backed items/facts plus disposition, one composed checkpoint.
  const memory = new MemoryLogicHost({ items: {} });
  const host = Object.assign(Object.create(memory) as MemoryLogicHost, {
    adjustDisposition: (npc: string, delta: number) => logic.adjustDisposition(npc, delta),
    checkpoint: () => composeCheckpoints(memory.checkpoint(), logic.checkpoint()),
  }) as LogicHost;
  const stored = () =>
    npcs.map((e) =>
      w.isRegistered(DispositionComponent) ? w.get(e, DispositionComponent) : undefined,
    );
  const [a, b, c] = npcs as [EntityId, EntityId, EntityId];
  return { w, d, npcs, a, b, c, seen, host, memory, logic, stored };
}

const batch = (data: unknown): readonly LogicNode[] => {
  const result = validateLogicEffects(data);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
};

describe('disposition checkpoint (mw-e22.15)', () => {
  it('a batch [adjustDisposition +10 with faction spread, takeItem missing] leaves everyone as before, adds no components and emits nothing', () => {
    const s = setup();
    const before = s.npcs.map((e) => s.d.get(e));
    const result = applyLogicEffects(
      batch([
        { kind: 'disposition', npc: 'n0', delta: 10 },
        { kind: 'takeItem', item: 'missing' },
      ]),
      s.host,
    );
    expect(result).toMatchObject({ ok: false, index: 1, reason: 'missing-item:missing' });
    s.w.step();
    expect(s.npcs.map((e) => s.d.get(e))).toEqual(before);
    expect(s.stored()).toEqual([undefined, undefined, undefined]);
    expect(s.w.isRegistered(DispositionComponent) ? s.w.query(DispositionComponent).count : 0).toBe(
      0,
    );
    expect(s.seen).toEqual([]);
  });

  it('rollback restores the previous record of a creature that already had one', () => {
    const s = setup();
    s.d.adjust(s.b, 20, 'x');
    s.w.step();
    s.seen.length = 0;
    const records = s.stored();
    const cp = s.d.checkpoint();
    s.d.adjust(s.a, 20, 'y'); // spreads 10 onto npcs 1 and 2 (npc 0 had no record)
    s.d.adjust(s.b, -5, 'z');
    cp.rollback();
    s.w.step();
    expect(s.stored()).toEqual(records);
    expect(s.seen).toEqual([]);
  });

  it('a committed batch emits each event exactly once, in order, and only after commit', () => {
    const s = setup();
    const cp = s.d.checkpoint();
    s.d.adjust(s.a, 60, 'gift'); // crosses the friendly band for npc 0 only
    s.w.step();
    expect(s.seen).toEqual([]);
    expect(s.d.get(s.a)).toBe(60); // reads see the pending change
    cp.commit();
    s.w.step();
    const { a, b, c } = s;
    expect(s.seen.filter((e) => e.startsWith('changed'))).toEqual([
      `changed:${String(a)}`,
      `changed:${String(b)}`,
      `changed:${String(c)}`,
    ]);
    expect(s.seen.filter((e) => e.startsWith('stance'))).toHaveLength(3);
    expect(s.seen.filter((e) => e.startsWith('band'))).toEqual([`band:${String(a)}`]);
  });

  it('applyLogicEffects commits a good batch and emits once', () => {
    const s = setup();
    const result = applyLogicEffects(
      batch([
        { kind: 'disposition', npc: 'n1', delta: 10 },
        { kind: 'giveItem', item: 'key' },
      ]),
      s.host,
    );
    expect(result.ok).toBe(true);
    s.w.step();
    expect(s.seen.filter((e) => e.startsWith('changed'))).toHaveLength(3);
    expect(s.memory.itemCount('key')).toBe(1);
  });

  it('outside any checkpoint changes publish immediately as before', () => {
    const s = setup();
    s.d.adjust(s.a, 10, 'x');
    s.w.step();
    expect(s.seen).toHaveLength(3);
  });

  it('nested: an inner rollback undoes only the inner changes; an inner commit is undone by an outer rollback', () => {
    const s = setup();
    const { a, b } = s;
    const outer = s.d.checkpoint();
    s.d.adjust(a, 10, 'outer'); // a 10, others 5
    const inner = s.d.checkpoint();
    s.d.adjust(b, 20, 'inner');
    inner.rollback();
    expect(s.d.get(a)).toBe(10);
    expect(s.d.get(b)).toBe(5);
    const inner2 = s.d.checkpoint();
    s.d.adjust(b, 20, 'inner2');
    inner2.commit();
    expect(s.d.get(b)).toBe(25);
    outer.rollback();
    s.w.step();
    expect(s.stored()).toEqual([undefined, undefined, undefined]);
    expect(s.seen).toEqual([]);
  });

  it('nested: an outer commit publishes the committed inner events but not the rolled-back ones', () => {
    const s = setup();
    const outer = s.d.checkpoint();
    const dropped = s.d.checkpoint();
    s.d.adjust(s.a, 10, 'dropped');
    dropped.rollback();
    const kept = s.d.checkpoint();
    s.d.adjust(s.b, 10, 'kept');
    kept.commit();
    s.w.step();
    expect(s.seen).toEqual([]);
    outer.commit();
    s.w.step();
    expect(s.seen).toHaveLength(3);
  });

  it('sequential checkpoints are independent', () => {
    const s = setup();
    const first = s.d.checkpoint();
    s.d.adjust(s.a, 10, 'x');
    first.rollback();
    const second = s.d.checkpoint();
    s.d.adjust(s.a, 20, 'y');
    second.commit();
    s.w.step();
    expect(s.d.get(s.a)).toBe(20);
    expect(s.seen.filter((e) => e.startsWith('changed'))).toHaveLength(3);
  });

  it('settling a checkpoint twice or out of order throws', () => {
    const s = setup();
    const outer = s.d.checkpoint();
    const inner = s.d.checkpoint();
    expect(() => {
      outer.commit();
    }).toThrow('out of order');
    inner.commit();
    expect(() => {
      inner.rollback();
    }).toThrow('out of order');
    outer.rollback();
  });

  it('a world whose batches all roll back keeps its state hash-visible data empty', () => {
    const s = setup();
    const before = JSON.stringify(s.w.snapshot());
    const cp = s.d.checkpoint();
    s.d.adjust(s.a, 10, 'x');
    cp.rollback();
    expect(JSON.stringify(s.w.snapshot())).toBe(before);
  });
});

describe('composeCheckpoints', () => {
  it('commits in order and rolls back in reverse', () => {
    const log: string[] = [];
    const part = (name: string) => ({
      commit: () => {
        log.push(`commit:${name}`);
      },
      rollback: () => {
        log.push(`rollback:${name}`);
      },
    });
    composeCheckpoints(part('a'), part('b')).commit();
    composeCheckpoints(part('a'), part('b')).rollback();
    expect(log).toEqual(['commit:a', 'commit:b', 'rollback:b', 'rollback:a']);
  });
});
