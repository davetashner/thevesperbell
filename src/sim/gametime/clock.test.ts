import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { factChanged } from '../facts/store';
import { hashWorld } from '../snapshot';
import {
  DAY_FACT,
  HELD_AT_FACT,
  MINUTE_FACT,
  MINUTE_ORIGIN_FACT,
  PHASE_FACT,
} from '../rest/day-clock';
import {
  dayStarted,
  gameClockOf,
  gameDayClock,
  hourChanged,
  installGameClock,
  phaseChanged,
  scheduledEvent,
  timeOf,
  totalMinutes,
  type GameClock,
} from './clock';
import { DEFAULT_CLOCK_CONFIG, type GameClockConfig } from './config';

function setup(config: GameClockConfig = DEFAULT_CLOCK_CONFIG, seed = 1) {
  const world = new World<never>({ seed });
  const clock = installGameClock(world, config);
  return { world, clock };
}
const stepN = (world: World<never>, n: number): void => {
  for (let i = 0; i < n; i++) world.step();
};
const at = (day: number, hour: number, minute = 0): number =>
  totalMinutes({ day, minute: hour * 60 + minute });
/** Moves a fresh clock to day/hour without events mattering. */
function startAt(clock: GameClock, day: number, hour: number): void {
  clock.setTime({ day, minute: hour * 60 });
}

describe('game clock', () => {
  it('AC-1: 216,000 ticks at 60 Hz from day 1 06:00 read day 2 06:00 with one dayStarted', () => {
    const { world, clock } = setup();
    expect(clock.time()).toEqual({ day: 1, minute: 360 });
    const days: number[] = [];
    clock.subscribe('dayStarted', (e) => days.push(e.day));
    let busDays = 0;
    world.events.on(dayStarted, () => busDays++);
    stepN(world, 216_000);
    expect(clock.time()).toEqual({ day: 2, minute: 360 });
    expect(days).toEqual([2]);
    expect(busDays).toBe(1);
    expect(world.facts.get(DAY_FACT)).toBe(2);
    expect(world.facts.get(MINUTE_ORIGIN_FACT)).toBe(216_000);
  });

  it('writes a fact once per game minute, not once per tick', () => {
    const { world } = setup();
    const changes: string[] = [];
    world.events.on(factChanged, (c) => changes.push(c.key));
    world.step();
    changes.length = 0; // the install's own phase fact is delivered on the first step
    stepN(world, 148);
    expect(changes).toEqual([]);
    stepN(world, 1);
    expect(changes).toContain(MINUTE_FACT); // (and the day fact, set for the first time)
    expect(changes).toContain(MINUTE_ORIGIN_FACT);
    expect(changes.length).toBeLessThanOrEqual(3);
  });

  it('AC-2: a screen that holds the clock keeps it still for 10 real minutes of sim steps', () => {
    const { world, clock } = setup();
    stepN(world, 100); // 100 ticks into the minute when the screen opens
    clock.hold('dialogue');
    clock.hold('dialogue');
    expect(clock.paused).toBe(true);
    expect(world.facts.get(HELD_AT_FACT)).toBe(100);
    stepN(world, 60 * 60 * 10);
    expect(clock.time()).toEqual({ day: 1, minute: 360 });
    clock.release('dialogue');
    expect(clock.paused).toBe(true);
    clock.release('dialogue');
    expect(clock.paused).toBe(false);
    expect(world.facts.get(HELD_AT_FACT)).toBe(-1);
    stepN(world, 49);
    expect(clock.time()).toEqual({ day: 1, minute: 360 });
    stepN(world, 1); // the held ticks never counted: 100 + 50 make the minute
    expect(clock.time()).toEqual({ day: 1, minute: 361 });
  });

  it('a save taken while a screen held the clock resumes with the held ticks not counted', () => {
    const { world, clock } = setup();
    stepN(world, 100);
    clock.hold('shop');
    stepN(world, 500);
    const saved = world.snapshot();
    const loaded = setup(DEFAULT_CLOCK_CONFIG, 1);
    loaded.world.restore(saved);
    expect(loaded.clock.paused).toBe(false);
    stepN(loaded.world, 49);
    expect(loaded.clock.time()).toEqual({ day: 1, minute: 360 });
    stepN(loaded.world, 1);
    expect(loaded.clock.time()).toEqual({ day: 1, minute: 361 });
  });

  it('AC-2: a world whose sim is not stepped (a pausing menu) does not move the clock', () => {
    const { clock } = setup();
    // The sim loop does not step while a menu pauses it, so nothing calls the system at all.
    expect(clock.time()).toEqual({ day: 1, minute: 360 });
  });

  it('screens the data does not list, and releases that never held, change nothing', () => {
    const { clock } = setup();
    clock.hold('map');
    clock.hold('unknown');
    expect(clock.paused).toBe(false);
    clock.release('map');
    expect(clock.paused).toBe(false);
  });

  it('AC-3: advanceTime(8 h) from day 1 22:00 fires 8 hours, one night->dawn, one day start, one latest callback', () => {
    const { world, clock } = setup();
    startAt(clock, 1, 22);
    world.step(); // flush the setup's own events off the bus
    const hours: number[] = [];
    const phases: string[] = [];
    const days: number[] = [];
    const lazy: { elapsed: number; count: number; hour: number }[] = [];
    clock.subscribe('hourChanged', (e) => hours.push(e.hour));
    clock.subscribe('phaseChanged', (e) => phases.push(`${e.from}>${e.to}`));
    clock.subscribe('dayStarted', (e) => days.push(e.day));
    clock.subscribe(
      'hourChanged',
      (e, info) => lazy.push({ elapsed: info.elapsed, count: info.count, hour: e.hour }),
      { mode: 'latest' },
    );
    const bus: string[] = [];
    world.events.on(hourChanged, () => bus.push('hour'));
    world.events.on(phaseChanged, () => bus.push('phase'));
    expect(clock.advanceTime(8 * 60, 'rest')).toEqual({
      ok: true,
      from: at(1, 22),
      to: at(2, 6),
      minutes: 480,
    });
    expect(hours).toEqual([23, 0, 1, 2, 3, 4, 5, 6]);
    expect(phases).toEqual(['night>dawn']);
    expect(days).toEqual([2]);
    expect(lazy).toEqual([{ elapsed: 480, count: 8, hour: 6 }]);
    world.step();
    expect(bus.filter((b) => b === 'hour')).toHaveLength(8);
    expect(clock.phase()).toBe('dawn');
    expect(world.facts.get(PHASE_FACT)).toBe('dawn');
  });

  it('delivers crossings in game-time order: day start, phase change, hour', () => {
    const config: GameClockConfig = {
      ...DEFAULT_CLOCK_CONFIG,
      phases: [
        { id: 'night', startMinute: 0 },
        { id: 'day', startMinute: 360 },
      ],
    };
    const { clock } = setup(config);
    startAt(clock, 1, 23);
    const order: string[] = [];
    for (const topic of ['dayStarted', 'phaseChanged', 'hourChanged'] as const) {
      clock.subscribe(topic, () => order.push(topic));
    }
    clock.advanceTime(60, 'travel');
    expect(order).toEqual(['dayStarted', 'phaseChanged', 'hourChanged']); // day wraps into night
    order.length = 0;
    clock.advanceTime(6 * 60, 'travel');
    expect(order.slice(-2)).toEqual(['phaseChanged', 'hourChanged']); // night -> day at 06:00
  });

  it('AC-4: same-minute events fire in (time, priority, id) order, whatever the registration order', () => {
    const entries = [
      { id: 'b-event', priority: 1 },
      { id: 'a-event', priority: 1 },
      { id: 'z-event', priority: 0 },
      { id: 'c-event', priority: 2 },
    ];
    const expected = ['z-event', 'a-event', 'b-event', 'c-event'];
    for (let seed = 1; seed <= 100; seed++) {
      const { clock } = setup(DEFAULT_CLOCK_CONFIG, seed);
      const order = seed % 2 === 0 ? entries : [...entries].reverse();
      const shuffled = order.slice(seed % 4).concat(order.slice(0, seed % 4));
      for (const e of shuffled) {
        expect(clock.schedule.at(at(1, 7), e.id, {}, e.priority).ok).toBe(true);
      }
      const fired: string[] = [];
      clock.subscribe('scheduled', (e) => fired.push(e.id));
      clock.advanceTime(120, 'rest');
      expect(fired).toEqual(expected);
    }
  });

  it('scheduled events carry their payload, due minute and fire on the bus; id filters subscribers', () => {
    const { world, clock } = setup();
    clock.schedule.at(at(1, 6, 30), 'stew-ready', { pot: 'ox', n: 2, hot: true });
    clock.schedule.at(at(1, 7), 'other');
    const seen: unknown[] = [];
    clock.subscribe('scheduled', (e) => seen.push(e), { id: 'stew-ready' });
    const bus: string[] = [];
    world.events.on(scheduledEvent, (e) => bus.push(e.id));
    clock.advanceTime(90, 'study');
    world.step();
    expect(seen).toEqual([
      { id: 'stew-ready', at: at(1, 6, 30), payload: { pot: 'ox', n: 2, hot: true } },
    ]);
    expect(bus).toEqual(['stew-ready', 'other']);
    expect(clock.schedule.pending()).toEqual([]);
  });

  it('every() repeats: each mode fires per occurrence, latest once with the count', () => {
    const { world, clock } = setup();
    expect(clock.schedule.every(60, 'tide', { a: 1 }).ok).toBe(true);
    const each: number[] = [];
    const lazy: number[] = [];
    clock.subscribe('scheduled', (e) => each.push(e.at), { id: 'tide' });
    clock.subscribe('scheduled', (_e, info) => lazy.push(info.count), {
      id: 'tide',
      mode: 'latest',
    });
    clock.advanceTime(185, 'travel');
    expect(each).toEqual([at(1, 7), at(1, 8), at(1, 9)]);
    expect(lazy).toEqual([3]);
    expect(clock.schedule.pending().map((e) => e.at)).toEqual([at(1, 10)]);
    stepN(world, 150 * 60); // the running clock keeps it firing
    expect(each).toEqual([at(1, 7), at(1, 8), at(1, 9), at(1, 10)]);
    expect(clock.schedule.cancel('tide')).toBe(true);
    expect(clock.schedule.cancel('tide')).toBe(false);
  });

  it('pending() lists in (time, priority, id) order', () => {
    const { clock } = setup();
    const t = clock.total();
    clock.schedule.at(t + 20, 'late');
    clock.schedule.at(t + 10, 'b', {}, 1);
    clock.schedule.at(t + 10, 'a', {}, 1);
    clock.schedule.at(t + 10, 'first', {}, 0);
    expect(clock.schedule.pending().map((e) => e.id)).toEqual(['first', 'a', 'b', 'late']);
  });

  it('a single-phase day never changes phase', () => {
    const { clock } = setup({
      ...DEFAULT_CLOCK_CONFIG,
      phases: [{ id: 'always', startMinute: 0 }],
    });
    const phases: string[] = [];
    clock.subscribe('phaseChanged', (e) => phases.push(e.to));
    clock.advanceTime(3 * 1440, 'travel');
    expect(phases).toEqual([]);
    expect(clock.phase()).toBe('always');
  });

  it('rejects bad schedule requests', () => {
    const { clock } = setup();
    const now = clock.total();
    expect(clock.schedule.at(now + 5, 'Bad Id')).toEqual({ ok: false, reason: 'invalid-id' });
    expect(clock.schedule.at(now, 'now')).toEqual({ ok: false, reason: 'invalid-time' });
    expect(clock.schedule.at(now + 1.5, 'frac')).toEqual({ ok: false, reason: 'invalid-time' });
    expect(clock.schedule.every(0, 'zero')).toEqual({ ok: false, reason: 'invalid-period' });
    expect(clock.schedule.every(2.5, 'frac')).toEqual({ ok: false, reason: 'invalid-period' });
    expect(clock.schedule.at(now + 5, 'ok').ok).toBe(true);
    expect(clock.schedule.has('ok')).toBe(true);
    expect(clock.schedule.at(now + 9, 'ok')).toEqual({ ok: false, reason: 'duplicate-id' });
    expect(clock.schedule.every(5, 'ok')).toEqual({ ok: false, reason: 'duplicate-id' });
  });

  it('AC-5: a saved clock and schedule restore with an equal state hash', () => {
    const { world, clock } = setup();
    clock.setTime({ day: 3, minute: 14 * 60 + 30 });
    clock.schedule.at(at(3, 18), 'curfew', { bell: 1 });
    clock.schedule.every(120, 'rounds', {}, 3);
    const hash = hashWorld(world);
    const saved = world.snapshot();
    const pending = clock.schedule.pending();

    const { world: loaded, clock: reloaded } = setup(DEFAULT_CLOCK_CONFIG, 1);
    loaded.restore(saved);
    reloaded.schedule.restore(pending);
    expect(reloaded.time()).toEqual({ day: 3, minute: 14 * 60 + 30 });
    expect(reloaded.schedule.pending()).toEqual(pending);
    expect(hashWorld(loaded)).toBe(hash);
  });

  it('AC-6: a zero, negative, fractional or non-finite advance is rejected and fires nothing', () => {
    const { clock } = setup();
    clock.schedule.at(at(1, 7), 'soon');
    const events: string[] = [];
    clock.subscribe('hourChanged', () => events.push('hour'));
    clock.subscribe('scheduled', () => events.push('sched'));
    const before = clock.time();
    for (const bad of [
      0,
      -60,
      0.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      expect(clock.advanceTime(bad, 'rest')).toEqual({ ok: false, reason: 'invalid-duration' });
    }
    expect(events).toEqual([]);
    expect(clock.time()).toEqual(before);
    expect(clock.schedule.pending()).toHaveLength(1);
  });

  it('queries: time of day, phase, elapsedSince', () => {
    const { clock } = setup();
    expect(clock.timeOfDay()).toBe(360);
    expect(clock.phase()).toBe('dawn');
    const mark = clock.total();
    clock.advanceTime(3 * 60, 'rest');
    expect(clock.phase()).toBe('day');
    expect(clock.elapsedSince(mark)).toBe(180);
    clock.advanceTime(11 * 60, 'rest');
    expect(clock.phase()).toBe('dusk');
    clock.advanceTime(3 * 60, 'rest');
    expect(clock.phase()).toBe('night');
    expect(timeOf(mark)).toEqual({ day: 1, minute: 360 });
  });

  it('setTime goes forward through events, backward silently, and restarts the minute count', () => {
    const { world, clock } = setup();
    stepN(world, 40);
    const hours: number[] = [];
    clock.subscribe('hourChanged', (e) => hours.push(e.hour));
    clock.setTime({ day: 1, minute: 9 * 60 });
    expect(hours).toEqual([7, 8, 9]);
    clock.setTime({ day: 1, minute: 8 * 60 });
    expect(clock.time()).toEqual({ day: 1, minute: 480 });
    expect(hours).toEqual([7, 8, 9]);
    expect(world.facts.get(MINUTE_ORIGIN_FACT)).toBe(40);
    clock.setTime({ day: 1, minute: 8 * 60 });
    expect(clock.time()).toEqual({ day: 1, minute: 480 });
    clock.hold('dialogue');
    stepN(world, 10);
    clock.setTime({ day: 1, minute: 9 * 60 });
    expect(world.facts.get(HELD_AT_FACT)).toBe(50);
    expect(world.facts.get(MINUTE_ORIGIN_FACT)).toBe(50);
  });

  it('unsubscribing stops delivery', () => {
    const { clock } = setup();
    let n = 0;
    const off = clock.subscribe('hourChanged', () => n++);
    clock.advanceTime(60, 'rest');
    off();
    clock.advanceTime(60, 'rest');
    expect(n).toBe(1);
  });

  it('a rest through the day clock adapter advances the game clock, ignoring non-forward sets', () => {
    const { clock } = setup();
    const day = gameDayClock(clock);
    const hours: number[] = [];
    clock.subscribe('hourChanged', (e) => hours.push(e.hour));
    day.set({ day: 1, minute: 8 * 60 });
    expect(day.now()).toEqual({ day: 1, minute: 480 });
    expect(hours).toEqual([7, 8]);
    day.set({ day: 1, minute: 100 });
    expect(day.now()).toEqual({ day: 1, minute: 480 });
  });

  it('installs once per world and is found by gameClockOf', () => {
    const { world, clock } = setup();
    expect(gameClockOf(world)).toBe(clock);
    expect(gameClockOf(new World<never>({ seed: 1 }))).toBeUndefined();
    expect(() => installGameClock(world, DEFAULT_CLOCK_CONFIG)).toThrow(/already installed/);
  });

  it('rejects a config that is not whole ticks per game minute, or has bad phases', () => {
    const world = new World<never>({ seed: 1 });
    expect(() =>
      installGameClock(world, { ...DEFAULT_CLOCK_CONFIG, dayLengthRealMinutes: 1 / 7 }),
    ).toThrow(/whole number of ticks/);
  });

  it('a different day length scales the clock: a 30-minute day is 75 ticks per minute', () => {
    const { world, clock } = setup({ ...DEFAULT_CLOCK_CONFIG, dayLengthRealMinutes: 30 });
    expect(clock.ticksPerMinute).toBe(75);
    stepN(world, 75 * 60);
    expect(clock.time()).toEqual({ day: 1, minute: 420 });
  });

  it('starts from the config when the time facts are unset', () => {
    const { clock, world } = setup({ ...DEFAULT_CLOCK_CONFIG, start: { day: 4, minute: 1000 } });
    expect(clock.time()).toEqual({ day: 4, minute: 1000 });
    expect(world.facts.get(MINUTE_FACT)).toBeUndefined();
  });

  it('determinism: two worlds stepped alike hash alike', () => {
    const a = setup(DEFAULT_CLOCK_CONFIG, 9);
    const b = setup(DEFAULT_CLOCK_CONFIG, 9);
    for (const { clock } of [a, b]) clock.schedule.every(45, 'x');
    stepN(a.world, 30_000);
    stepN(b.world, 30_000);
    expect(hashWorld(a.world)).toBe(hashWorld(b.world));
  });
});
