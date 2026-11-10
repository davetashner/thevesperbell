// Tests for the injected DifficultyConfig (mw-e31.14): defaults, validation, hashing, snapshot/save
// round trips and runtime changes replayed through the mw-e00.17 recorder and player.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  applyDifficultyCommands,
  DEFAULT_DIFFICULTY,
  DIFFICULTY_KEYS,
  DIFFICULTY_RANGES,
  DifficultyChanged,
  difficultyCommand,
  DifficultyConfigError,
  difficultyOverrides,
  diffSnapshots,
  encodeCanonical,
  encodeSnapshot,
  hashSnapshot,
  hashWorld,
  isDifficultyCommand,
  parseReplay,
  playReplay,
  recordScenario,
  resolveDifficulty,
  scaleDifficulty,
  difficultyScaler,
  serializeReplay,
  World,
  type DifficultyChange,
  type DifficultyCommand,
  type DifficultyOverrides,
  type Replay,
  type ReplayScenario,
  type WorldSnapshot,
} from '@sim/index';

type Input = string | DifficultyCommand;

/** A world whose one system logs the damageTaken multiplier it sees each tick. */
function probed(difficulty?: DifficultyOverrides): { world: World<Input>; seen: number[] } {
  const seen: number[] = [];
  const world = new World<Input>({ seed: 9, ...(difficulty && { difficulty }) }).addSystem({
    name: 'probe',
    run: (ctx) => {
      seen.push(ctx.difficulty.damageTaken);
      ctx.world.random('ai').nextU32();
    },
  });
  return { world, seen };
}

describe('DifficultyConfig defaults', () => {
  it('AC-1: with no overrides every multiplier is 1.0 and the config is frozen', () => {
    const w = new World({ seed: 1 });
    expect(DIFFICULTY_KEYS).toEqual([
      'damageDealt',
      'damageTaken',
      'detectionSpeed',
      'dodgeWindow',
      'fallDamage',
      'parryWindow',
      'puzzleHints',
      'searchDuration',
    ]);
    for (const key of DIFFICULTY_KEYS) expect(w.difficulty[key]).toBe(1);
    expect(w.difficulty).toEqual(DEFAULT_DIFFICULTY);
    expect(Object.isFrozen(w.difficulty)).toBe(true);
    expect(Object.isFrozen(DIFFICULTY_RANGES.damageTaken)).toBe(true);
    expect(() => {
      (w.difficulty as { damageTaken: number }).damageTaken = 2;
    }).toThrow(TypeError);
  });

  it('AC-1: overrides given at creation are validated, merged onto neutral and frozen', () => {
    const w = new World({ seed: 1, difficulty: { damageTaken: 0.5, fallDamage: 0 } });
    expect(w.difficulty).toEqual({ ...DEFAULT_DIFFICULTY, damageTaken: 0.5, fallDamage: 0 });
    expect(Object.isFrozen(w.difficulty)).toBe(true);
    expect(() => new World({ seed: 1, difficulty: { parryWindow: 10 } })).toThrow(
      DifficultyConfigError,
    );
  });

  it('a neutral world snapshots exactly as before the config existed', () => {
    expect(new World({ seed: 1 }).snapshot()).not.toHaveProperty('difficulty');
    expect(new World({ seed: 1, difficulty: { detectionSpeed: 1 } }).snapshot()).not.toHaveProperty(
      'difficulty',
    );
  });
});

describe('DifficultyConfig validation', () => {
  it('AC-2: out-of-range values fail naming the field and its range', () => {
    for (const bad of [0, 10]) {
      let error: unknown;
      try {
        resolveDifficulty({ detectionSpeed: bad });
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(DifficultyConfigError);
      expect(error).toBeInstanceOf(RangeError);
      expect(error).toMatchObject({
        name: 'DifficultyConfigError',
        field: 'detectionSpeed',
        message: `difficulty detectionSpeed must be a number in [0.25, 4], got ${String(bad)}`,
      });
    }
  });

  it('AC-2: NaN, infinities, negatives, non-numbers and unknown fields are rejected', () => {
    const cases: [DifficultyOverrides, string][] = [
      [{ damageTaken: Number.NaN }, 'damageTaken'],
      [{ damageDealt: Number.POSITIVE_INFINITY }, 'damageDealt'],
      [{ fallDamage: -0.5 }, 'fallDamage'],
      [{ dodgeWindow: '2' as unknown as number }, 'dodgeWindow'],
      [{ bogus: 1 } as DifficultyOverrides, 'bogus'],
      [{ toString: 1 } as unknown as DifficultyOverrides, 'toString'],
    ];
    for (const [overrides, field] of cases) {
      expect(() => resolveDifficulty(overrides)).toThrow(expect.objectContaining({ field }));
    }
    expect(() => resolveDifficulty({ bogus: 1 } as DifficultyOverrides)).toThrow(
      'unknown difficulty multiplier "bogus"',
    );
  });

  it('accepts every range boundary, including 0 where a multiplier can be switched off', () => {
    for (const key of DIFFICULTY_KEYS) {
      const { min, max } = DIFFICULTY_RANGES[key];
      expect(resolveDifficulty({ [key]: min })[key]).toBe(min);
      expect(resolveDifficulty({ [key]: max })[key]).toBe(max);
    }
    expect(resolveDifficulty({ fallDamage: 0, puzzleHints: 0 })).toMatchObject({
      fallDamage: 0,
      puzzleHints: 0,
    });
  });

  it('resolves onto a given base and reports only non-neutral values as overrides', () => {
    const base = resolveDifficulty({ damageTaken: 0.5 });
    const next = resolveDifficulty({ parryWindow: 1.5 }, base);
    expect(next).toMatchObject({ damageTaken: 0.5, parryWindow: 1.5, dodgeWindow: 1 });
    expect(difficultyOverrides(next)).toEqual({ damageTaken: 0.5, parryWindow: 1.5 });
    expect(Object.keys(difficultyOverrides(next))).toEqual(['damageTaken', 'parryWindow']);
    expect(difficultyOverrides(DEFAULT_DIFFICULTY)).toEqual({});
  });
});

describe('DifficultyConfig in the state hash', () => {
  it('AC-3: worlds differing only in damageTaken hash differently; identical configs hash equal', () => {
    const a = new World({ seed: 5, difficulty: { damageTaken: 0.5 } });
    const b = new World({ seed: 5, difficulty: { damageTaken: 2 } });
    const c = new World({ seed: 5, difficulty: { damageTaken: 0.5 } });
    const neutral = new World({ seed: 5 });
    expect(hashWorld(a)).not.toBe(hashWorld(b));
    expect(hashWorld(a)).not.toBe(hashWorld(neutral));
    expect(hashWorld(a)).toBe(hashWorld(c));
    expect(hashWorld(new World({ seed: 5, difficulty: {} }))).toBe(hashWorld(neutral));
  });

  it('encodes the difficulty section exactly as the generic canonical form', () => {
    const snap = new World({ seed: 5, difficulty: { puzzleHints: 0 } }).snapshot();
    expect(snap.difficulty).toEqual({ puzzleHints: 0 });
    const body = encodeSnapshot(snap).subarray(4);
    expect(body).toEqual(encodeCanonical(snap));
  });

  it('diffSnapshots names the differing multiplier, reading an absent one as neutral', () => {
    const neutral = new World({ seed: 5 }).snapshot();
    const easy = new World({ seed: 5, difficulty: { damageTaken: 0.5 } }).snapshot();
    expect(diffSnapshots(neutral, easy)).toEqual({
      section: 'difficulty',
      path: 'difficulty.damageTaken',
      field: 'damageTaken',
      a: 1,
      b: 0.5,
    });
    const explicit: WorldSnapshot = { ...neutral, difficulty: { damageTaken: 1 } };
    expect(diffSnapshots(neutral, explicit)).toBeUndefined();
  });
});

describe('DifficultyConfig across saves', () => {
  it('a snapshot with detectionSpeed 0.5 restores (through JSON) a sim that reads 0.5', () => {
    const saved = new World({ seed: 3, difficulty: { detectionSpeed: 0.5 } });
    saved.step();
    // A save stores the snapshot as plain data; a JSON round trip is the strictest such medium.
    const file = JSON.stringify(saved.snapshot());
    const loaded = new World({ seed: 99 });
    loaded.restore(JSON.parse(file) as WorldSnapshot);
    expect(loaded.difficulty.detectionSpeed).toBe(0.5);
    expect(Object.isFrozen(loaded.difficulty)).toBe(true);
    expect(hashWorld(loaded)).toBe(hashWorld(saved));
    let seen = 0;
    loaded.addSystem({ name: 'probe', run: (ctx) => (seen = ctx.difficulty.detectionSpeed) });
    loaded.step();
    expect(seen).toBe(0.5);
  });

  it('restoring a snapshot without a difficulty section resets to neutral', () => {
    const w = new World({ seed: 3, difficulty: { damageDealt: 2 } });
    w.restore(new World({ seed: 3 }).snapshot());
    expect(w.difficulty).toEqual(DEFAULT_DIFFICULTY);
  });

  it('rejects a snapshot with an invalid difficulty and leaves the world untouched', () => {
    const w = new World({ seed: 3, difficulty: { damageDealt: 2 } });
    const bad: WorldSnapshot = { ...w.snapshot(), seed: 8, difficulty: { damageDealt: -1 } };
    expect(() => {
      w.restore(bad);
    }).toThrow(DifficultyConfigError);
    expect(w.seed).toBe(3);
    expect(w.difficulty.damageDealt).toBe(2);
  });
});

describe('DifficultyConfig runtime changes', () => {
  it('AC-5: a change fed between ticks takes effect on the next tick and emits DifficultyChanged once', () => {
    const { world, seen } = probed();
    const changes: DifficultyChange[] = [];
    world.events.on(DifficultyChanged, (change) => {
      changes.push(change);
      seen.push(-1); // delivered before any system runs this tick
    });
    world.step(['move']);
    world.step(['move', difficultyCommand({ damageTaken: 0.5 })]);
    world.step(['move']);
    expect(seen).toEqual([1, -1, 0.5, 0.5]);
    expect(world.difficulty.damageTaken).toBe(0.5);
    expect(changes).toEqual([
      {
        tick: 1,
        previous: DEFAULT_DIFFICULTY,
        next: { ...DEFAULT_DIFFICULTY, damageTaken: 0.5 },
      },
    ]);
  });

  it('AC-5: the change is recorded in the replay log, so replays stay identical', () => {
    const scenario: ReplayScenario<Input> = {
      name: 'difficulty-probe',
      usesContent: false,
      command: z.union([z.string(), z.custom<DifficultyCommand>(isDifficultyCommand)]),
      create: () => probed().world,
      drive: () => [],
    };
    const script = (tick: number): Input[] => {
      if (tick === 30) return ['move', difficultyCommand({ damageTaken: 0.5, detectionSpeed: 2 })];
      if (tick === 90) return [difficultyCommand({ damageTaken: 1 })];
      return ['move'];
    };
    const record = (inputs: (tick: number) => Input[]): Replay =>
      recordScenario(scenario, {
        seed: 9,
        ticks: 120,
        buildSha: 'test',
        contentHash: 'none',
        checkpointInterval: 10,
        inputs,
      });
    // Replay files are JSON: the change must survive the file round trip and replay identically.
    const live = record(script);
    const replay = parseReplay(JSON.parse(serializeReplay(live)));
    expect(replay.inputs).toContainEqual([
      1,
      ['move', { kind: 'sim.difficulty', set: { damageTaken: 0.5, detectionSpeed: 2 } }],
    ]);
    expect(playReplay(replay, scenario)).toMatchObject({ status: 'passed', checkpoints: 13 });

    // The same session without the change diverges at the first checkpoint after tick 30.
    const without = record((tick) => (tick === 30 || tick === 90 ? ['move'] : script(tick)));
    expect(playReplay({ ...without, checkpoints: live.checkpoints }, scenario)).toMatchObject({
      status: 'diverged',
      divergence: {
        tick: 40,
        difference: { section: 'difficulty', path: 'difficulty.damageTaken', a: 0.5, b: 1 },
      },
    });
  });

  it('applies several commands in one tick in input order and skips no-op changes', () => {
    const result = applyDifficultyCommands(
      DEFAULT_DIFFICULTY,
      [
        'x',
        null,
        difficultyCommand({ fallDamage: 0 }),
        difficultyCommand({ fallDamage: 0 }),
        difficultyCommand({ fallDamage: 2 }),
      ],
      4,
    );
    expect(result.config.fallDamage).toBe(2);
    expect(result.changes.map((c) => [c.tick, c.previous.fallDamage, c.next.fallDamage])).toEqual([
      [4, 1, 0],
      [4, 0, 2],
    ]);
    expect(applyDifficultyCommands(DEFAULT_DIFFICULTY, [], 0)).toEqual({
      config: DEFAULT_DIFFICULTY,
      changes: [],
    });
  });

  it('rejects an invalid command at construction, and in a step before any state changes', () => {
    expect(() => difficultyCommand({ parryWindow: 10 })).toThrow(DifficultyConfigError);
    const { world, seen } = probed({ damageTaken: 2 });
    const forged = { kind: 'sim.difficulty', set: { damageTaken: 0 } } as const;
    expect(isDifficultyCommand(forged)).toBe(true);
    expect(() => {
      world.step([forged]);
    }).toThrow(DifficultyConfigError);
    expect(world.tick).toBe(0);
    expect(seen).toEqual([]);
    expect(world.difficulty.damageTaken).toBe(2);
    world.step(); // the world is still usable
    expect(seen).toEqual([2]);
  });

  it('recognises difficulty commands only by their kind tag', () => {
    expect(difficultyCommand({ puzzleHints: 2 })).toEqual({
      kind: 'sim.difficulty',
      set: { puzzleHints: 2 },
    });
    for (const other of ['sim.difficulty', null, 3, {}, { kind: 'move' }]) {
      expect(isDifficultyCommand(other)).toBe(false);
    }
  });

  it('snapshots taken after a runtime change carry it', () => {
    const { world } = probed();
    world.step([difficultyCommand({ dodgeWindow: 1.5 })]);
    expect(world.snapshot().difficulty).toEqual({ dodgeWindow: 1.5 });
    expect(hashSnapshot(world.snapshot())).toBe(hashWorld(world));
  });
});

describe('difficulty.scale (mw-e31.10)', () => {
  it('AC-2: a 20-damage hit at damageTaken 0.5 becomes 10', () => {
    const config = resolveDifficulty({ damageTaken: 0.5 });
    expect(scaleDifficulty(config, 'damageTaken', 20)).toBe(10);
    expect(difficultyScaler(config).scale('damageTaken', 20)).toBe(10);
    expect(difficultyScaler(config).config).toBe(config);
  });

  it('AC-2: rounds to the nearest whole number, halves up, and neutral leaves values alone', () => {
    const half = resolveDifficulty({ damageTaken: 0.5 });
    expect(scaleDifficulty(half, 'damageTaken', 5)).toBe(3); // 2.5 rounds up
    expect(scaleDifficulty(half, 'damageTaken', 4)).toBe(2);
    expect(scaleDifficulty(resolveDifficulty({ damageTaken: 0.4 }), 'damageTaken', 1)).toBe(0);
    expect(scaleDifficulty(resolveDifficulty({ damageTaken: 0.3 }), 'damageTaken', 5)).toBe(2); // 1.5 up
    expect(scaleDifficulty(DEFAULT_DIFFICULTY, 'damageTaken', 37)).toBe(37);
    expect(scaleDifficulty(resolveDifficulty({ searchDuration: 0.6 }), 'searchDuration', 300)).toBe(
      180,
    );
    expect(scaleDifficulty(resolveDifficulty({ fallDamage: 0 }), 'fallDamage', 40)).toBe(0);
  });

  it('AC-2: rejects values that are negative or not finite', () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => scaleDifficulty(DEFAULT_DIFFICULTY, 'damageTaken', bad)).toThrow(RangeError);
    }
  });
});
