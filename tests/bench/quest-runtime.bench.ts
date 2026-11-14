// mw-e23.2 AC-6: 50 active quests under 500 fact changes per second cost the quest runtime ≤ 0.5 ms
// per sim tick on the reference machine (backlog contract: M1 Pro). Each quest watches its own facts
// (a `fact` objective, a resolution over two facts, a failure fact and a `hasItem` resolution)
// and the world changes 500 facts a second over 60 ticks (8 or 9 a tick, round-robin over the 200 facts
// the quests read: the worst case for the dependency index). Time covers the tick's whole quest work: delivering the
// fact events and `update()`. Run with `pnpm bench`.
import { describe, expect, test } from 'vitest';
import type { QuestDef } from '@content/types/quest';
import { World, QuestRuntime, type LogicHost } from '@sim/index';
import { MemoryLogicHost } from '@sim/logic/index';

const QUESTS = 50;
const HZ = 60;
const CHANGES_PER_SECOND = 500;
/** The AC-6 budget, milliseconds per tick. */
const BUDGET_MS = 0.5;
const SECONDS = 20;

/** Never true: the benchmark flips facts between 0 and 2, so no quest ever resolves or fails. */
const never = (key: string) => ({ kind: 'factCmp', fact: key, op: 'eq', value: 99 });

function quest(i: number): QuestDef {
  const n = String(i);
  return {
    givers: [],
    stages: [],
    id: `bench-${n}`,
    title: `Bench ${n}`,
    summary: 'Bench.',
    objectives: [
      {
        id: 'a',
        kind: 'fact',
        text: 'a',
        optional: false,
        hidden: false,
        params: { fact: `b${n}.a`, value: 1 },
      },
      { id: 'b', kind: 'event', text: 'b', optional: true, hidden: false, params: { event: 'e' } },
    ],
    resolutions: [
      {
        id: 'win',
        approach: 'other',
        priority: 0,
        journal: 'w',
        when: { kind: 'any', of: [never(`b${n}.x`), never(`b${n}.y`)] },
      },
      {
        id: 'trade',
        approach: 'other',
        priority: 0,
        journal: 't',
        when: { kind: 'hasItem', item: `bench-item-${n}`, count: 1 },
      },
    ],
    failures: [
      {
        id: 'lost',
        when: never(`b${n}.lost`),
        journal: 'l',
        npcRemoved: [],
        itemDestroyed: [],
        continuation: { kind: 'resolve', resolution: 'win' },
      },
    ],
  } as unknown as QuestDef;
}

describe('quest runtime', () => {
  test('AC-6: 50 active quests at 500 fact changes/s cost ≤ 0.5 ms per tick', async ({ bench }) => {
    const world = new World<never>({ seed: 1 });
    // The game's host with its facts being the world's, so conditions read what the sim changes.
    let reads = 0;
    const host: LogicHost = Object.create(new MemoryLogicHost(), {
      facts: {
        value: {
          get: (key: string) => {
            reads++;
            return world.facts.get(key);
          },
          entries: (prefix?: string) => world.facts.entries(prefix),
        },
      },
    }) as LogicHost;
    const runtime = new QuestRuntime({
      quests: Array.from({ length: QUESTS }, (_, i) => quest(i)),
      facts: world.facts,
      host,
      events: world.events,
    });
    for (let i = 0; i < QUESTS; i++) runtime.startQuest(`bench-${String(i)}`);
    runtime.settle();
    // Facts changed round-robin, every one read by some quest (the worst case for the dependency index).
    const keys: string[] = [];
    for (let i = 0; i < QUESTS; i++) {
      for (const f of ['a', 'x', 'y', 'lost']) keys.push(`b${String(i)}.${f}`);
    }
    let write = 0;
    const perTick = CHANGES_PER_SECOND / HZ;
    const tick = (): number => {
      const start = performance.now();
      world.facts.transaction(() => {
        for (let c = 0; c < perTick; c++) {
          const key = keys[write % keys.length] ?? '';
          // Every write is a real change: each round over the keys flips 0 and 2.
          const round = Math.floor(write / keys.length);
          world.facts.set(key, (round % 2) * 2);
          write++;
        }
      });
      world.events.flush();
      runtime.update();
      return performance.now() - start;
    };
    for (let i = 0; i < HZ * 2; i++) tick();
    reads = 0;
    const samples: number[] = [];
    for (let i = 0; i < HZ * SECONDS; i++) samples.push(tick());
    const sorted = [...samples].sort((a, b) => a - b);
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? Infinity;
    // The quests really were evaluated: about one read per condition leaf of each affected quest.
    const readsPerTick = reads / samples.length;
    expect(readsPerTick).toBeGreaterThan(CHANGES_PER_SECOND / HZ);
    await bench('one tick: 8 fact changes, 50 active quests', () => {
      tick();
    }).run();
    console.info(
      `quest runtime ×${String(QUESTS)} @ ${String(CHANGES_PER_SECOND)} changes/s: mean ${mean.toFixed(4)} ms, p99 ${p99.toFixed(4)} ms per tick over ${String(samples.length)} ticks (${readsPerTick.toFixed(1)} condition fact reads/tick)`,
    );
    for (let i = 0; i < QUESTS; i++) {
      expect(runtime.questState(`bench-${String(i)}`)).toBe('active');
    }
    expect(mean).toBeLessThanOrEqual(BUDGET_MS);
  });
});
