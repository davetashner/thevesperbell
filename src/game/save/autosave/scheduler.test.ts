// The autosave scheduler (mw-e30.5): ring rotation (AC-1), deferral behind a veto (AC-2), the timed
// autosave and its reset (AC-3), throttling, coalescing and retry rules. The integration paths
// through IndexedDB (AC-4) and a checkpoint volume (AC-5) are in autosave.integration.test.ts.
import { defineComponent, World } from '@sim/index';
import { describe, expect, it } from 'vitest';
import { createGameSaveRegistry } from '../sections';
import { SaveSlots, type SaveSlotInput, type SlotSummary } from '../slots/index';
import { MemorySaveStore, SaveQuotaError, type SaveStore } from '../storage/index';
import {
  AUTOSAVE_INTERVAL_SECONDS,
  AutosaveScheduler,
  type AutosaveEvent,
  type AutosaveSchedulerOptions,
} from './scheduler';
import { SafetyVetoes } from './vetoes';

const HZ = 60;
const SECOND = HZ;
const MINUTE = 60 * SECOND;
const Position = defineComponent<{ x: number }>('Position');
const build = { gameVersion: '0.2.0', buildSha: 'abc1234', contentHash: 'c0ffee' };
const input: SaveSlotInput = {
  characterName: 'Aldric',
  classId: 'knight',
  areaId: 'testbed-arena',
};

function world(tick = 0): World {
  const w = new World({ seed: 3, hz: HZ }).register(Position);
  w.add(w.spawn(), Position, { x: 1 });
  return at(w, tick);
}

/** Moves the world's clock to `tick` (playtime passing without stepping every tick). */
function at(w: World, tick: number): World {
  w.restore({ ...w.snapshot(), clock: { tick, hz: HZ } });
  return w;
}

function setup(
  options: Partial<AutosaveSchedulerOptions> = {},
  store: SaveStore = new MemorySaveStore(),
) {
  let wallClock = 1_790_000_000_000;
  const slots = new SaveSlots({
    store,
    registry: createGameSaveRegistry(),
    build,
    now: () => (wallClock += 1_000),
  });
  const scheduler = new AutosaveScheduler({ slots, describe: () => input, ...options });
  const events: AutosaveEvent[] = [];
  scheduler.subscribe((event) => events.push(event));
  return { store, slots, scheduler, events };
}

const ticksIn = (list: SlotSummary[]) =>
  list.map((s) => (s.state === 'ready' ? `${s.slot}@${String(s.details?.playtimeTicks)}` : s.slot));
const saves = (events: AutosaveEvent[]) =>
  events.filter((e) => e.type === 'saved').map((e) => `${e.trigger.kind}:${e.slot}`);

/** A store whose next `failures` writes throw a quota error. */
function flaky(failures: number): SaveStore & { failures: number } {
  const inner = new MemorySaveStore();
  const store = {
    kind: 'memory' as const,
    durable: false,
    failures,
    write: (slot: string, bytes: Uint8Array) => {
      if (store.failures > 0) {
        store.failures -= 1;
        return Promise.reject(new SaveQuotaError(new Error('disk full')));
      }
      return inner.write(slot, bytes);
    },
    read: inner.read.bind(inner),
    list: inner.list.bind(inner),
    delete: inner.delete.bind(inner),
  };
  return store;
}

describe('AutosaveScheduler', () => {
  it('AC-1: a 4th autosave replaces the oldest of three and leaves the other two', async () => {
    const { slots, scheduler, events } = setup({ minGapSeconds: 0 });
    const w = world();
    for (const tick of [100, 200, 300]) {
      scheduler.request({ kind: 'checkpoint' });
      await scheduler.update(at(w, tick));
    }
    const before = await slots.list(['auto-1', 'auto-2', 'auto-3']);
    expect(ticksIn(before)).toEqual(['auto-1@100', 'auto-2@200', 'auto-3@300']);

    scheduler.request({ kind: 'area-transition', source: 'briar-glen' });
    await scheduler.update(at(w, 400));
    const after = await slots.list(['auto-1', 'auto-2', 'auto-3']);
    expect(ticksIn(after)).toEqual(['auto-1@400', 'auto-2@200', 'auto-3@300']);
    expect(saves(events)).toEqual([
      'checkpoint:auto-1',
      'checkpoint:auto-2',
      'checkpoint:auto-3',
      'area-transition:auto-1',
    ]);
    // Manual slots are never touched by the ring.
    expect((await slots.list(['manual-1']))[0]?.state).toBe('empty');
  });

  it('AC-2: a trigger during a combat veto saves exactly once when the veto clears 20 s later', async () => {
    const vetoes = new SafetyVetoes();
    let inCombat = true;
    vetoes.register('combat', () => (inCombat ? 'in combat' : null));
    const { store, scheduler, events } = setup({ vetoes });
    const w = world();
    scheduler.request({ kind: 'checkpoint', source: 'crypt/door' });
    const deferred: (AutosaveEvent | null)[] = [];
    for (let tick = 0; tick < 20 * SECOND; tick += 1) {
      if (tick === 5 * SECOND) scheduler.request({ kind: 'quest', source: 'bell' });
      deferred.push(await scheduler.update(at(w, tick)));
    }
    expect(deferred.every((d) => d === null)).toBe(true);
    expect(scheduler.pending).toEqual({ kind: 'checkpoint', source: 'crypt/door' });

    inCombat = false;
    const saved = await scheduler.update(at(w, 20 * SECOND));
    expect(saved?.type).toBe('saved');
    for (let tick = 20 * SECOND + 1; tick < 40 * SECOND; tick += 30) {
      await scheduler.update(at(w, tick));
    }
    expect(saves(events)).toEqual(['checkpoint:auto-1']);
    expect(await store.list()).toEqual(['auto-1']);
    expect(scheduler.pending).toBeNull();
  });

  it('AC-3: five minutes of playtime without an autosave triggers a timed one when safe', async () => {
    const vetoes = new SafetyVetoes();
    let midAir = false;
    vetoes.register('mid-air', () => (midAir ? 'falling' : null));
    const { scheduler, events } = setup({ vetoes });
    const w = world(1_000);
    expect(await scheduler.update(w)).toBeNull(); // the timer starts here
    expect(await scheduler.update(at(w, 1_000 + 5 * MINUTE - 1))).toBeNull();
    midAir = true;
    expect(await scheduler.update(at(w, 1_000 + 5 * MINUTE))).toBeNull();
    expect(scheduler.pending).toEqual({ kind: 'timed' });
    midAir = false;
    const timed = await scheduler.update(at(w, 1_000 + 5 * MINUTE + 30));
    expect(timed?.type === 'saved' && timed.summary.details?.playtimeTicks).toBe(
      1_000 + 5 * MINUTE + 30,
    );
    expect(saves(events)).toEqual(['timed:auto-1']);
  });

  it('AC-3: an autosave a minute ago resets the timer', async () => {
    const { scheduler, events } = setup();
    const w = world(0);
    await scheduler.update(w);
    scheduler.request({ kind: 'rest' });
    await scheduler.update(at(w, 4 * MINUTE));
    expect(await scheduler.update(at(w, 5 * MINUTE))).toBeNull();
    expect(await scheduler.update(at(w, 9 * MINUTE - 1))).toBeNull();
    expect((await scheduler.update(at(w, 9 * MINUTE)))?.type).toBe('saved');
    expect(saves(events)).toEqual(['rest:auto-1', 'timed:auto-2']);
    expect(AUTOSAVE_INTERVAL_SECONDS).toBe(300);
  });

  it('coalesces requests closer than the minimum gap into one later autosave', async () => {
    const { scheduler, events } = setup({ minGapSeconds: 10 });
    const w = world(0);
    scheduler.request({ kind: 'area-transition', source: 'a' });
    await scheduler.update(w);
    scheduler.request({ kind: 'area-transition', source: 'b' });
    scheduler.request({ kind: 'area-transition', source: 'a' });
    expect(await scheduler.update(at(w, 10 * SECOND - 1))).toBeNull();
    const later = await scheduler.update(at(w, 10 * SECOND));
    expect(later?.trigger).toEqual({ kind: 'area-transition', source: 'b' });
    expect(await scheduler.update(at(w, 30 * SECOND))).toBeNull();
    expect(saves(events)).toEqual(['area-transition:auto-1', 'area-transition:auto-2']);
  });

  it('runs one write at a time and keeps a request made during it for afterwards', async () => {
    const { scheduler, events } = setup({ minGapSeconds: 0 });
    const w = world(0);
    scheduler.request({ kind: 'checkpoint' });
    const first = scheduler.update(w);
    expect(scheduler.saving).toBe(true);
    expect(await scheduler.update(w)).toBeNull();
    scheduler.request({ kind: 'quest', source: 'q1' });
    scheduler.request({ kind: 'quest', source: 'q2' });
    expect(scheduler.pending).toEqual({ kind: 'checkpoint' });
    await first;
    expect(scheduler.saving).toBe(false);
    expect(scheduler.pending).toEqual({ kind: 'quest', source: 'q1' });
    await scheduler.update(at(w, 1));
    expect(saves(events)).toEqual(['checkpoint:auto-1', 'quest:auto-2']);
    expect(events.map((e) => e.type)).toEqual(['saving', 'saved', 'saving', 'saved']);
  });

  it('saves the world as it was when the moment was judged safe, however long the ring read takes (mw-e01.21)', async () => {
    const vetoes = new SafetyVetoes();
    let dialogue = false;
    const w = world(5);
    const inner = new MemorySaveStore();
    const store: SaveStore = {
      kind: 'memory',
      durable: false,
      write: inner.write.bind(inner),
      read: (slot) => {
        // Storage answers later: the game has run on, and a veto has started.
        dialogue = true;
        at(w, 9);
        return inner.read(slot);
      },
      list: inner.list.bind(inner),
      delete: inner.delete.bind(inner),
    };
    vetoes.register('dialogue', () => (dialogue ? 'talking' : null));
    const { slots, scheduler } = setup({ vetoes }, store);
    scheduler.request({ kind: 'checkpoint' });
    const attempt = scheduler.update(w);
    scheduler.request({ kind: 'quest' });
    expect((await attempt)?.type).toBe('saved');
    // The save is the world of tick 5, not of the tick the ring read finished at.
    expect(ticksIn(await slots.list(['auto-1']))).toEqual(['auto-1@5']);
    // The request made during the write waits for its own autosave, as ever.
    expect(scheduler.pending).toEqual({ kind: 'quest' });
  });

  it('retries a failed write once, then warns and gives up on that request', async () => {
    const store = flaky(2);
    const { scheduler } = setup({}, store);
    const w = world(0);
    scheduler.request({ kind: 'checkpoint' });
    const first = await scheduler.update(w);
    expect(first).toMatchObject({ type: 'failed', slot: 'auto-1', retrying: true });
    scheduler.request({ kind: 'quest' }); // covered by the retry
    const second = await scheduler.update(at(w, 1));
    expect(second).toMatchObject({ type: 'failed', slot: 'auto-1', retrying: false });
    expect(second?.type === 'failed' && second.error).toBeInstanceOf(SaveQuotaError);
    expect(scheduler.pending).toBeNull();
    expect(await scheduler.update(at(w, 20 * SECOND))).toBeNull();
    // The next trigger starts afresh.
    scheduler.request({ kind: 'checkpoint' });
    expect((await scheduler.update(at(w, 20 * SECOND)))?.type).toBe('saved');
  });

  it('reports a ring that cannot be read as a failure with no slot', async () => {
    const inner = new MemorySaveStore();
    const store: SaveStore = {
      kind: 'memory',
      durable: false,
      write: inner.write.bind(inner),
      read: () => Promise.reject(new Error('database closed')),
      list: inner.list.bind(inner),
      delete: inner.delete.bind(inner),
    };
    const { scheduler } = setup({}, store);
    scheduler.request({ kind: 'checkpoint' });
    expect(await scheduler.update(world(0))).toMatchObject({
      type: 'failed',
      slot: null,
      retrying: true,
    });
  });

  it('reset forgets waiting requests and restarts the timer; a rewound tick restarts it too', async () => {
    const { scheduler, events } = setup();
    const w = world(0);
    await scheduler.update(w);
    scheduler.request({ kind: 'checkpoint' });
    scheduler.reset(at(w, 4 * MINUTE));
    expect(scheduler.pending).toBeNull();
    expect(await scheduler.update(at(w, 8 * MINUTE))).toBeNull();
    expect((await scheduler.update(at(w, 9 * MINUTE)))?.type).toBe('saved');

    // An earlier save loaded without reset: tick 1 min is before the last autosave at 9 min.
    scheduler.request({ kind: 'area-transition' });
    expect((await scheduler.update(at(w, MINUTE)))?.type).toBe('saved');
    expect(await scheduler.update(at(w, 6 * MINUTE - 1))).toBeNull();
    expect((await scheduler.update(at(w, 6 * MINUTE)))?.trigger.kind).toBe('timed');
    expect(saves(events)).toEqual(['timed:auto-1', 'area-transition:auto-2', 'timed:auto-3']);
  });

  it('stops notifying unsubscribed listeners and exposes its veto registry', async () => {
    const { scheduler } = setup({ minGapSeconds: 0 });
    const heard: string[] = [];
    const stop = scheduler.subscribe((e) => heard.push(e.type));
    scheduler.request({ kind: 'checkpoint' });
    await scheduler.update(world(0));
    stop();
    scheduler.request({ kind: 'checkpoint' });
    await scheduler.update(world(1));
    expect(heard).toEqual(['saving', 'saved']);
    expect(scheduler.vetoes.isSafe()).toBe(true);
  });

  it('rejects bad intervals', () => {
    expect(() => setup({ intervalSeconds: 0 })).toThrow(
      'intervalSeconds must be a positive number',
    );
    expect(() => setup({ intervalSeconds: Number.NaN })).toThrow(RangeError);
    expect(() => setup({ minGapSeconds: -1 })).toThrow(
      'minGapSeconds must be a non-negative number',
    );
    expect(setup({ minGapSeconds: 0 }).scheduler.pending).toBeNull();
  });
});
