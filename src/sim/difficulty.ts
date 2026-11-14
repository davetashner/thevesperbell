// Difficulty and assist multipliers (mw-e31.14). Combat and stealth rules need to read tunable
// multipliers from day one, long before the assists UI exists, so the sim takes a DifficultyConfig as
// an input — like the seed and tick rate, never a global. A World is created with one (every value
// defaults to the neutral 1.0), systems read it from their TickContext, it is part of the snapshot (so
// state hashes, saves and replays reproduce it), and it changes mid-game only through a
// `difficultyCommand` fed to `World.step`, which the replay recorder captures like any other command.
//
// Snapshots store only the non-neutral values (sparse overrides), so a world on default difficulty
// hashes exactly as it did before this config existed, and adding a multiplier later changes no
// existing hash.

import { defineEvent } from './core/events';

const BASIS_POINTS = 10_000;

/** Every tunable multiplier the sim knows about; all are dimensionless factors, neutral at 1. */
export interface DifficultyConfig {
  /** Scales damage the player receives (e04 damage model). */
  readonly damageTaken: number;
  /** Scales damage the player deals (e04 damage model). */
  readonly damageDealt: number;
  /** Scales how fast enemy awareness accumulates (e11 awareness); lower is more forgiving. */
  readonly detectionSpeed: number;
  /** Scales the parry timing window (e04 parry/riposte); higher is more forgiving. */
  readonly parryWindow: number;
  /** Scales dodge invulnerability frames (e04 dodge); higher is more forgiving. */
  readonly dodgeWindow: number;
  /** Scales fall, crush and hazard damage (e04 environmental damage); 0 turns it off. */
  readonly fallDamage: number;
  /** Scales puzzle hint availability (e15 hints); 0 turns hints off, higher offers them sooner. */
  readonly puzzleHints: number;
  /** Scales how long a creature searches at a last known position (e09 stealth); lower is more forgiving. */
  readonly searchDuration: number;
}

export type DifficultyKey = keyof DifficultyConfig;

/** Partial overrides of the neutral config, as given to a world, a command or a snapshot. */
export type DifficultyOverrides = Readonly<Partial<Record<DifficultyKey, number>>>;

/** An inclusive allowed range for one multiplier. */
export interface DifficultyRange {
  readonly min: number;
  readonly max: number;
}

/**
 * Allowed ranges. Multipliers that would break a rule at 0 (no damage, never detected, a zero-tick
 * window) keep a positive floor; fall damage and hints may be switched off with 0.
 */
export const DIFFICULTY_RANGES: Readonly<Record<DifficultyKey, DifficultyRange>> = Object.freeze({
  damageTaken: Object.freeze({ min: 0.25, max: 4 }),
  damageDealt: Object.freeze({ min: 0.25, max: 4 }),
  detectionSpeed: Object.freeze({ min: 0.25, max: 4 }),
  parryWindow: Object.freeze({ min: 0.5, max: 3 }),
  dodgeWindow: Object.freeze({ min: 0.5, max: 3 }),
  fallDamage: Object.freeze({ min: 0, max: 4 }),
  puzzleHints: Object.freeze({ min: 0, max: 4 }),
  searchDuration: Object.freeze({ min: 0.25, max: 4 }),
});

/** Multiplier names in code-unit order (the order snapshots and errors use). */
export const DIFFICULTY_KEYS: readonly DifficultyKey[] = Object.freeze(
  (Object.keys(DIFFICULTY_RANGES) as DifficultyKey[]).sort(),
);

/** The neutral config: every multiplier 1.0, so rules behave exactly as authored. */
export const DEFAULT_DIFFICULTY: DifficultyConfig = Object.freeze({
  damageTaken: 1,
  damageDealt: 1,
  detectionSpeed: 1,
  parryWindow: 1,
  dodgeWindow: 1,
  fallDamage: 1,
  puzzleHints: 1,
  searchDuration: 1,
});

/** Thrown for an unknown multiplier or a value outside its range; `field` names the culprit. */
export class DifficultyConfigError extends RangeError {
  override readonly name = 'DifficultyConfigError';

  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
  }
}

const isKey = (key: string): key is DifficultyKey => Object.hasOwn(DIFFICULTY_RANGES, key);

/**
 * Validates overrides against DIFFICULTY_RANGES and merges them onto `base` (the neutral config by
 * default). The result is a new frozen config.
 * @throws DifficultyConfigError for an unknown field, a non-number, NaN, ±Infinity or an
 *   out-of-range value, naming the field and its allowed range.
 */
export function resolveDifficulty(
  overrides: DifficultyOverrides = {},
  base: DifficultyConfig = DEFAULT_DIFFICULTY,
): DifficultyConfig {
  const next: Record<DifficultyKey, number> = { ...base };
  for (const [field, value] of Object.entries(overrides)) {
    if (!isKey(field)) {
      throw new DifficultyConfigError(field, `unknown difficulty multiplier "${field}"`);
    }
    const { min, max } = DIFFICULTY_RANGES[field];
    // `>= min && <= max` is false for NaN, so NaN is rejected with the range too.
    if (typeof value !== 'number' || !(value >= min && value <= max)) {
      throw new DifficultyConfigError(
        field,
        `difficulty ${field} must be a number in [${String(min)}, ${String(max)}], got ${String(value)}`,
      );
    }
    next[field] = value;
  }
  return Object.freeze(next);
}

/**
 * Scales a whole number of `value`s (damage points, ticks) by the multiplier `key` of `config`, for
 * systems that read the config (`difficulty.scale("damageTaken", 20)`). The multiplier is rounded to
 * basis points (so 0.1 + 0.2 style float noise never decides a result) and the product is rounded to
 * the nearest whole number, halves rounding up: 20 x 0.5 = 10, 5 x 0.5 = 3 (2.5 rounds up), 1 x 0.4 = 0.
 * Systems that need finer units (the damage model counts hundredths) scale those units instead.
 * @throws RangeError when `value` is negative or not finite.
 */
export function scaleDifficulty(
  config: DifficultyConfig,
  key: DifficultyKey,
  value: number,
): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`cannot scale ${String(value)}: expected a finite number >= 0`);
  }
  return Math.round((value * Math.round(config[key] * BASIS_POINTS)) / BASIS_POINTS);
}

/** A config with the `scale` helper bound to it. */
export interface DifficultyScaler {
  readonly config: DifficultyConfig;
  /** `scaleDifficulty(config, key, value)`. */
  scale(key: DifficultyKey, value: number): number;
}

/** Binds `config` so a system can write `difficulty.scale("damageTaken", x)`. */
export function difficultyScaler(config: DifficultyConfig): DifficultyScaler {
  return { config, scale: (key, value) => scaleDifficulty(config, key, value) };
}

/** The values of `config` that differ from neutral, in key order (empty when fully neutral). */
export function difficultyOverrides(config: DifficultyConfig): DifficultyOverrides {
  const sparse: Partial<Record<DifficultyKey, number>> = {};
  for (const key of DIFFICULTY_KEYS) {
    if (!Object.is(config[key], DEFAULT_DIFFICULTY[key])) sparse[key] = config[key];
  }
  return sparse;
}

/** The `kind` tag of a difficulty change command. */
export const DIFFICULTY_COMMAND = 'sim.difficulty' as const;

/**
 * A mid-game difficulty change, fed to `World.step` among that tick's inputs. It is plain JSON, so
 * the replay recorder captures it and replays reproduce the change on the same tick.
 */
export interface DifficultyCommand {
  readonly kind: typeof DIFFICULTY_COMMAND;
  /** Multipliers to change; unlisted ones keep their current value. */
  readonly set: DifficultyOverrides;
}

/**
 * Builds a difficulty change command, validating it now so a bad value fails at the settings call
 * site rather than inside a tick.
 * @throws DifficultyConfigError as `resolveDifficulty`.
 */
export function difficultyCommand(set: DifficultyOverrides): DifficultyCommand {
  resolveDifficulty(set);
  return { kind: DIFFICULTY_COMMAND, set: { ...set } };
}

/** True for a DifficultyCommand among arbitrary step inputs. */
export function isDifficultyCommand(input: unknown): input is DifficultyCommand {
  return (
    typeof input === 'object' &&
    input !== null &&
    (input as { kind?: unknown }).kind === DIFFICULTY_COMMAND
  );
}

/** Payload of `DifficultyChanged`: the config before and after a change. */
export interface DifficultyChange {
  readonly tick: number;
  readonly previous: DifficultyConfig;
  readonly next: DifficultyConfig;
}

/** Emitted (delivered at the start of the tick, before any system runs) when a command changes it. */
export const DifficultyChanged = defineEvent<DifficultyChange>('DifficultyChanged');

/**
 * Applies this tick's difficulty commands, in input order, to `config`. Returns the resulting config
 * and one change per command that altered it. Pure: nothing is committed if any command is invalid.
 * @throws DifficultyConfigError for an invalid command.
 */
export function applyDifficultyCommands(
  config: DifficultyConfig,
  inputs: readonly unknown[],
  tick: number,
): { readonly config: DifficultyConfig; readonly changes: readonly DifficultyChange[] } {
  let current = config;
  const changes: DifficultyChange[] = [];
  for (const input of inputs) {
    if (!isDifficultyCommand(input)) continue;
    const next = resolveDifficulty(input.set, current);
    if (DIFFICULTY_KEYS.some((key) => !Object.is(next[key], current[key]))) {
      changes.push({ tick, previous: current, next });
      current = next;
    }
  }
  return { config: current, changes };
}
