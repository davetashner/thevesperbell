import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import {
  addMinutes,
  clockText,
  DAY_CLOCK_FACTS,
  DAY_FACT,
  factDayClock,
  MINUTE_FACT,
  MINUTES_PER_DAY,
  minutesUntilMorning,
  MORNING_MINUTE,
  START_MINUTE,
} from './day-clock';

function clockWorld(): World<never> {
  const world = new World<never>({ seed: 1 });
  for (const [key, spec] of Object.entries(DAY_CLOCK_FACTS)) world.facts.declare(key, spec);
  return world;
}

describe('the minimum day clock (mw-ju8.6)', () => {
  it('a new world starts on day 1 at 06:00', () => {
    const clock = factDayClock(clockWorld().facts);
    expect(clock.now()).toEqual({ day: 1, minute: START_MINUTE });
    expect(clockText(clock.now())).toBe('06:00');
  });

  it('falls back to day 1 at 06:00 when the facts are not declared and the build ignores that', () => {
    const world = new World<never>({ seed: 1 });
    world.facts.setUndeclaredPolicy({ mode: 'ignore', warn: () => undefined });
    const clock = factDayClock(world.facts);
    expect(clock.now()).toEqual({ day: 1, minute: START_MINUTE });
    clock.set({ day: 5, minute: 0 });
    expect(clock.now()).toEqual({ day: 1, minute: START_MINUTE });
  });

  it('setting the time writes the facts (so it is saved with the world facts)', () => {
    const world = clockWorld();
    factDayClock(world.facts).set({ day: 4, minute: 65 });
    expect(world.facts.get(DAY_FACT)).toBe(4);
    expect(world.facts.get(MINUTE_FACT)).toBe(65);
    expect(factDayClock(world.facts).now()).toEqual({ day: 4, minute: 65 });
    expect(clockText({ day: 4, minute: 65 })).toBe('01:05');
  });

  it('addMinutes rolls over midnight and across several days', () => {
    expect(addMinutes({ day: 1, minute: 100 }, 20)).toEqual({ day: 1, minute: 120 });
    expect(addMinutes({ day: 1, minute: 1400 }, 100)).toEqual({ day: 2, minute: 60 });
    expect(addMinutes({ day: 1, minute: 0 }, 3 * MINUTES_PER_DAY + 5)).toEqual({
      day: 4,
      minute: 5,
    });
  });

  it('minutesUntilMorning: this morning before 06:00, tomorrow’s at or after it', () => {
    expect(minutesUntilMorning({ day: 1, minute: MORNING_MINUTE - 30 })).toBe(30);
    expect(minutesUntilMorning({ day: 1, minute: 8 * 60 })).toBe(22 * 60);
    expect(minutesUntilMorning({ day: 1, minute: 23 * 60 })).toBe(7 * 60);
    expect(minutesUntilMorning({ day: 1, minute: MORNING_MINUTE })).toBe(MINUTES_PER_DAY);
  });
});
