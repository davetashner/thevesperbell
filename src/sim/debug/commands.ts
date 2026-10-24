// Debug commands (mw-e33.1): how the in-game debug console (src/tools/console) spawns, teleports and
// cheats. A command is plain JSON fed to `World.step` among that tick's inputs, exactly like an
// ActionFrame or a fact command, so the replay recorder captures it and a replay reproduces the
// cheat on the same tick. The console never touches sim state itself; `debugCommandSystem` applies
// these inside the tick. Builders validate at the call site so a bad value fails where it is typed,
// not deep inside a tick.

import type { ControllerTuning, Frozen } from '@content/index';
import type { EntityId } from '../core/component';
import { isWorldPropertyKey, validateProperty, type WorldPropertyKey } from '../properties/spec';
import type { Vec3 } from '../stimulus/shapes';

/** The `kind` tag of a debug command. */
export const DEBUG_COMMAND = 'sim.debug' as const;

/** The toggleable cheats. */
export const DEBUG_CHEATS = ['god', 'noclip'] as const;

export type DebugCheat = (typeof DEBUG_CHEATS)[number];

/** Most entities one spawn command may create. */
export const MAX_SPAWN_COUNT = 100;

/**
 * Options a spawn passes its spawner, as typed (`spawn dummy --poise 60` → `{ poise: '60' }`): option
 * name → value text. The spawner parses and validates them.
 */
export type SpawnParams = Readonly<Record<string, string>>;

/** No spawn options. */
export const NO_SPAWN_PARAMS: SpawnParams = Object.freeze({});

/** Spawns `count` of a spawnable content id, the first at `at`, the rest in a row along +x. */
export interface SpawnCommand {
  readonly kind: typeof DEBUG_COMMAND;
  readonly op: 'spawn';
  /** A spawnable id such as `testprop-crate` (see `testPropSpawners`). */
  readonly content: string;
  readonly count: number;
  readonly at: Vec3;
  /** Options for the spawner (absent when there are none, as in older replays). */
  readonly params?: SpawnParams;
}

/** Turns a cheat on or off for one entity. */
export interface CheatCommand {
  readonly kind: typeof DEBUG_COMMAND;
  readonly op: 'cheat';
  readonly target: EntityId;
  readonly cheat: DebugCheat;
  readonly on: boolean;
}

/** Moves an entity (a character's feet, or a placed object) to `to`, at rest. */
export interface TeleportCommand {
  readonly kind: typeof DEBUG_COMMAND;
  readonly op: 'teleport';
  readonly target: EntityId;
  readonly to: Vec3;
}

/** Kills a combatant (health to 0, Died emitted), or removes an entity that has no health. */
export interface KillCommand {
  readonly kind: typeof DEBUG_COMMAND;
  readonly op: 'kill';
  readonly target: EntityId;
}

/** Largest `blast` radius, metres. */
export const MAX_BLAST_RADIUS = 20;
/** Largest `blast` intensity, N·s. */
export const MAX_BLAST_INTENSITY = 100_000;

/**
 * Sets off a force stimulus at `at` (mw-e04.34): a sphere of `radius` metres delivering `intensity`
 * N·s at its centre, falling off linearly, with no source. Whatever it reaches — props, characters —
 * is pushed away from its centre through the one stimulus API.
 */
export interface BlastCommand {
  readonly kind: typeof DEBUG_COMMAND;
  readonly op: 'blast';
  readonly at: Vec3;
  readonly radius: number;
  readonly intensity: number;
}

/** Removes every spawned creature (mw-e12.4: the console's `despawn all`). */
export interface DespawnCommand {
  readonly kind: typeof DEBUG_COMMAND;
  readonly op: 'despawn';
  readonly what: 'creatures';
}

/**
 * Sets one world property of an entity (mw-e03.37: put a torch out with `burning false`), exactly as
 * a rule would: the entity gains the property if it lacks it, and `propertyChanged` fires.
 */
export interface PropertyCommand {
  readonly kind: typeof DEBUG_COMMAND;
  readonly op: 'property';
  readonly target: EntityId;
  readonly key: WorldPropertyKey;
  /** A valid value of `key` (plain JSON: a number, boolean, id or flat record). */
  readonly value: unknown;
}

/**
 * Replaces a character's controller tuning (mw-e02.3: the console's `ctl.set`), from this tick on.
 * The console validates `tuning` against the controller schema before sending it; the sim cannot
 * (content schemas are not sim code), so a command is only as good as the build that recorded it.
 */
export interface TuneCommand {
  readonly kind: typeof DEBUG_COMMAND;
  readonly op: 'tune';
  readonly target: EntityId;
  readonly tuning: Frozen<ControllerTuning>;
}

/**
 * Makes an entity perform a move through its action timeline (mw-e03.11: the knight's heavy attack,
 * until the controls bind it), exactly as its attack button would request it.
 */
export interface ActCommand {
  readonly kind: typeof DEBUG_COMMAND;
  readonly op: 'act';
  readonly target: EntityId;
  /** A move id (or chain root), e.g. `sword-heavy`. */
  readonly move: string;
}

/**
 * Moves the game clock (mw-e27.12: the console's `time set` and `time advance`). `set` puts it at a
 * day and minute (forward fires the usual events, backward does not); `advance` jumps `minutes`.
 */
export type TimeCommand =
  | {
      readonly kind: typeof DEBUG_COMMAND;
      readonly op: 'time';
      readonly action: 'set';
      readonly day: number;
      readonly minute: number;
    }
  | {
      readonly kind: typeof DEBUG_COMMAND;
      readonly op: 'time';
      readonly action: 'advance';
      readonly minutes: number;
    };

export type DebugCommand =
  | TimeCommand
  | ActCommand
  | SpawnCommand
  | TuneCommand
  | CheatCommand
  | TeleportCommand
  | KillCommand
  | BlastCommand
  | DespawnCommand
  | PropertyCommand;

/** A finite position with -0 folded to 0 (replays reject -0). */
function position(what: string, v: Vec3): Vec3 {
  for (const axis of [v.x, v.y, v.z]) {
    if (!Number.isFinite(axis)) throw new RangeError(`${what} must be finite, got ${String(axis)}`);
  }
  return { x: v.x + 0, y: v.y + 0, z: v.z + 0 };
}

function entity(target: EntityId): EntityId {
  if (!Number.isSafeInteger(target) || target < 1) {
    throw new RangeError(`target must be an entity id, got ${String(target)}`);
  }
  return target;
}

/** Option names: lower-case words joined by dashes, like command names. */
const PARAM_NAME = /^[a-z][a-z0-9-]*$/;

/**
 * A spawn command, with the spawner's `params` when there are any.
 * @throws RangeError for an empty id, a count outside 1–MAX_SPAWN_COUNT, a non-finite position or
 * a malformed option name.
 */
export function spawnCommand(
  content: string,
  count: number,
  at: Vec3,
  params: SpawnParams = NO_SPAWN_PARAMS,
): SpawnCommand {
  if (content === '') throw new RangeError('spawn needs a content id');
  if (!Number.isInteger(count) || count < 1 || count > MAX_SPAWN_COUNT) {
    throw new RangeError(`spawn count must be 1–${String(MAX_SPAWN_COUNT)}, got ${String(count)}`);
  }
  const entries = Object.entries(params).sort(([a], [b]) => (a < b ? -1 : 1));
  for (const [name] of entries) {
    if (!PARAM_NAME.test(name)) throw new RangeError(`bad spawn option name "${name}"`);
  }
  const command = {
    kind: DEBUG_COMMAND,
    op: 'spawn',
    content,
    count,
    at: position('spawn position', at),
  } as const;
  return entries.length === 0 ? command : { ...command, params: Object.fromEntries(entries) };
}

/** A cheat toggle. @throws RangeError for an invalid target or cheat. */
export function cheatCommand(target: EntityId, cheat: DebugCheat, on: boolean): CheatCommand {
  if (!DEBUG_CHEATS.includes(cheat)) throw new RangeError(`unknown cheat "${cheat}"`);
  return { kind: DEBUG_COMMAND, op: 'cheat', target: entity(target), cheat, on };
}

/** A teleport. @throws RangeError for an invalid target or a non-finite destination. */
export function teleportCommand(target: EntityId, to: Vec3): TeleportCommand {
  return {
    kind: DEBUG_COMMAND,
    op: 'teleport',
    target: entity(target),
    to: position('teleport destination', to),
  };
}

/** A kill. @throws RangeError for an invalid target. */
export function killCommand(target: EntityId): KillCommand {
  return { kind: DEBUG_COMMAND, op: 'kill', target: entity(target) };
}

/**
 * A blast. @throws RangeError for a non-finite position, a radius outside (0, MAX_BLAST_RADIUS] or
 * an intensity outside (0, MAX_BLAST_INTENSITY].
 */
export function blastCommand(at: Vec3, radius: number, intensity: number): BlastCommand {
  if (!(radius > 0 && radius <= MAX_BLAST_RADIUS)) {
    throw new RangeError(
      `blast radius must be above 0 and at most ${String(MAX_BLAST_RADIUS)}, got ${String(radius)}`,
    );
  }
  if (!(intensity > 0 && intensity <= MAX_BLAST_INTENSITY)) {
    throw new RangeError(
      `blast intensity must be above 0 and at most ${String(MAX_BLAST_INTENSITY)}, got ${String(intensity)}`,
    );
  }
  return {
    kind: DEBUG_COMMAND,
    op: 'blast',
    at: position('blast position', at),
    radius,
    intensity,
  };
}

/** A clock set. @throws RangeError for a day below 1 or a minute outside 0-1439. */
export function timeSetCommand(day: number, minute: number): TimeCommand {
  if (!Number.isInteger(day) || day < 1)
    throw new RangeError(`day must be 1 or more, got ${String(day)}`);
  if (!Number.isInteger(minute) || minute < 0 || minute > 1439) {
    throw new RangeError(`minute must be 0-1439, got ${String(minute)}`);
  }
  return { kind: DEBUG_COMMAND, op: 'time', action: 'set', day, minute };
}

/** A clock advance. @throws RangeError unless `minutes` is a whole number of at least 1. */
export function timeAdvanceCommand(minutes: number): TimeCommand {
  if (!Number.isSafeInteger(minutes) || minutes < 1) {
    throw new RangeError(`minutes must be a whole number of 1 or more, got ${String(minutes)}`);
  }
  return { kind: DEBUG_COMMAND, op: 'time', action: 'advance', minutes };
}

/** A move request. @throws RangeError for an invalid target or an empty move id. */
export function actCommand(target: EntityId, move: string): ActCommand {
  if (move === '') throw new RangeError('act needs a move id');
  return { kind: DEBUG_COMMAND, op: 'act', target: entity(target), move };
}

/** A despawn of every creature. */
export function despawnCreaturesCommand(): DespawnCommand {
  return { kind: DEBUG_COMMAND, op: 'despawn', what: 'creatures' };
}

/**
 * A property write. @throws RangeError for an invalid target, an unknown property or a value the
 * property does not accept (the message says why, e.g. "wetness must be ≤ 1, got 1.4").
 */
export function propertyCommand(target: EntityId, key: string, value: unknown): PropertyCommand {
  if (!isWorldPropertyKey(key)) throw new RangeError(`unknown world property "${key}"`);
  const problem = validateProperty(key, value);
  if (problem !== undefined) throw new RangeError(problem);
  return { kind: DEBUG_COMMAND, op: 'property', target: entity(target), key, value };
}

/**
 * A controller tuning change for `target`; pass tuning that passed `controllerTuningSchema`.
 * @throws RangeError for an invalid target.
 */
export function tuneCommand(target: EntityId, tuning: Frozen<ControllerTuning>): TuneCommand {
  return { kind: DEBUG_COMMAND, op: 'tune', target: entity(target), tuning };
}

/** True for a DebugCommand among arbitrary step inputs. */
export function isDebugCommand(input: unknown): input is DebugCommand {
  return (
    typeof input === 'object' &&
    input !== null &&
    (input as { kind?: unknown }).kind === DEBUG_COMMAND
  );
}
