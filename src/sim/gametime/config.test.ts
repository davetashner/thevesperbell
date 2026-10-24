import { describe, expect, it } from 'vitest';
import { clockConfigProblems, DEFAULT_CLOCK_CONFIG, dayPhaseAt, ticksPerMinute } from './config';

describe('game clock config', () => {
  it('the default is a 60-minute day, 150 ticks per game minute at 60 Hz', () => {
    expect(ticksPerMinute(DEFAULT_CLOCK_CONFIG, 60)).toBe(150);
    expect(clockConfigProblems(DEFAULT_CLOCK_CONFIG, 60)).toEqual([]);
  });

  it('a day that is not whole ticks per minute has no tick rate', () => {
    expect(
      ticksPerMinute({ ...DEFAULT_CLOCK_CONFIG, dayLengthRealMinutes: 1 }, 30),
    ).toBeUndefined();
    expect(
      ticksPerMinute({ ...DEFAULT_CLOCK_CONFIG, dayLengthRealMinutes: 0 }, 60),
    ).toBeUndefined();
  });

  it('reports every kind of problem', () => {
    const problems = clockConfigProblems(
      {
        dayLengthRealMinutes: 0,
        start: { day: 0, minute: 1440 },
        phases: [
          { id: 'a', startMinute: 100 },
          { id: 'a', startMinute: 50 },
          { id: 'b', startMinute: 1500 },
        ],
        pauseScreens: {},
      },
      60,
    );
    expect(problems.join('\n')).toMatch(/ticks per game minute/);
    expect(problems.join('\n')).toMatch(/start day/);
    expect(problems.join('\n')).toMatch(/start minute/);
    expect(problems.join('\n')).toMatch(/listed twice/);
    expect(problems.join('\n')).toMatch(/does not start after/);
    expect(problems.join('\n')).toMatch(/outside the day/);
    expect(clockConfigProblems({ ...DEFAULT_CLOCK_CONFIG, phases: [] }, 60)).toEqual([
      'there must be at least one phase',
    ]);
  });

  it('dayPhaseAt wraps the last phase past midnight', () => {
    const { phases } = DEFAULT_CLOCK_CONFIG;
    expect(dayPhaseAt(phases, 0)).toBe('night');
    expect(dayPhaseAt(phases, 299)).toBe('night');
    expect(dayPhaseAt(phases, 300)).toBe('dawn');
    expect(dayPhaseAt(phases, 480)).toBe('day');
    expect(dayPhaseAt(phases, 1080)).toBe('dusk');
    expect(dayPhaseAt(phases, 1439)).toBe('night');
  });
});
