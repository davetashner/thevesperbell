// The game clock save section (mw-e27.12 AC-5): the clock and the pending schedule survive a save
// and load, and the loaded world hashes like the saved one.
import {
  DEFAULT_CLOCK_CONFIG,
  gameClockOf,
  hashWorld,
  installGameClock,
  totalMinutes,
  World,
} from '@sim/index';
import { describe, expect, it } from 'vitest';
import { migrateSection, validateSection } from './format';
import {
  GAME_CLOCK_MIGRATIONS,
  GAME_CLOCK_SECTION_VERSION,
  gameClockSaveSection,
} from './game-clock';
import { createGameSaveRegistry } from './sections';

const build = { gameVersion: '0.1.0', buildSha: 'deadbee', contentHash: 'c0ffee' };
const saveOptions = { build, wallClockSavedAt: 1_790_000_000_000 };

function clockWorld(seed: number) {
  const world = new World<never>({ seed });
  const clock = installGameClock(world, DEFAULT_CLOCK_CONFIG);
  return { world, clock };
}

describe('game clock save section', () => {
  it('AC-5: a save at day 3 14:30 with 2 pending events reloads the clock, schedule and state hash', () => {
    const { world, clock } = clockWorld(7);
    clock.setTime({ day: 3, minute: 14 * 60 + 30 });
    for (let i = 0; i < 40; i++) world.step(); // mid-minute
    expect(
      clock.schedule.at(totalMinutes({ day: 3, minute: 18 * 60 }), 'curfew', { bell: 1 }).ok,
    ).toBe(true);
    expect(clock.schedule.every(180, 'rounds', { lap: 'north' }, 2).ok).toBe(true);
    const pending = clock.schedule.pending();
    expect(pending).toHaveLength(2);

    const bytes = createGameSaveRegistry().write(world, saveOptions);
    const { world: loaded, clock: reloaded } = clockWorld(99);
    expect(createGameSaveRegistry().read(loaded, bytes).ok).toBe(true);

    expect(reloaded.time()).toEqual({ day: 3, minute: 14 * 60 + 30 });
    expect(reloaded.schedule.pending()).toEqual(pending);
    expect(hashWorld(loaded)).toBe(hashWorld(world));
    // The loaded clock carries on mid-minute and fires the restored events.
    const fired: string[] = [];
    reloaded.subscribe('scheduled', (e) => fired.push(e.id));
    reloaded.advanceTime(4 * 60, 'rest');
    expect(fired).toEqual(['rounds', 'curfew']);
  });

  it('a world without a game clock saves an empty schedule and ignores a loaded one', () => {
    const { world, clock } = clockWorld(1);
    clock.schedule.at(clock.total() + 10, 'x');
    const bytes = createGameSaveRegistry().write(world, saveOptions);
    const bare = new World<never>({ seed: 1 });
    expect(createGameSaveRegistry().read(bare, bytes).ok).toBe(true);
    expect(gameClockOf(bare)).toBeUndefined();
    const empty = createGameSaveRegistry().write(bare, saveOptions);
    const { world: other, clock: otherClock } = clockWorld(2);
    otherClock.schedule.at(otherClock.total() + 10, 'stale');
    expect(createGameSaveRegistry().read(other, empty).ok).toBe(true);
    expect(otherClock.schedule.pending()).toEqual([]);
  });

  it('a save from before the section existed loads with an empty schedule', () => {
    const { world, clock } = clockWorld(3);
    clock.schedule.at(clock.total() + 10, 'stale');
    const section = gameClockSaveSection();
    section.missing?.(world, { worldFacts: undefined, warn: () => undefined });
    expect(clock.schedule.pending()).toEqual([]);
  });

  it('validates its data and has no migrations yet', () => {
    const section = gameClockSaveSection();
    expect(GAME_CLOCK_SECTION_VERSION).toBe(1);
    expect(GAME_CLOCK_MIGRATIONS).toEqual({});
    const good = { schedule: [{ id: 'a', at: 5, priority: 0, payload: { n: 1 } }] };
    expect(validateSection(section, good).ok).toBe(true);
    expect(validateSection(section, { schedule: [{ id: '', at: 5 }] }).ok).toBe(false);
    expect(migrateSection(section, { version: 1, data: good }).ok).toBe(true);
  });
});
