// The world state console commands (mw-e27.6): look at, change, snapshot and compare the world's
// facts and per-level deltas without replaying the game to reach a state.
//   facts.list [prefix]       set facts, optionally those under a key prefix
//   facts.get <key>           one fact: value, type, default
//   facts.set <key> <value>   write a declared fact (a sim command, so replays record it)
//   deltas.list [level]       levels with changes; or one level's changed entities and spawns
//   state.snapshot [name]     keep the facts and level deltas now, in memory
//   state.restore [name]      put them back (a sim command; the loaded level's entities stay)
//   state.diff <a> <b>        compare two of: a save slot, `live`, a snapshot name
// Reads go straight to the world; every change is a command handed to `host.submit`, applied by
// the next `World.step` like any other debug command.

import {
  factCommand,
  isFactKey,
  levelDeltasOf,
  restoreStateCommand,
  type FactValue,
  type World,
} from '@sim/index';
import { ALL_SLOTS, isSlotId } from '@game/save/slots/ids';
import { z } from 'zod';
import type { ConsoleHost } from '../console/builtins';
import { ConsoleError, type CommandRegistry } from '../console/registry';
import { describeDelta, diffStates, formatDiff, type StateView } from './diff';
import type { SaveStateResult } from './save-state';

export interface WorldStateCommandOptions {
  readonly world: World<never>;
  /** The state a save slot holds; undefined when the slot is empty. */
  readonly readSlot: (slot: string) => Promise<SaveStateResult | undefined>;
}

/** The snapshot name `state.snapshot` and `state.restore` use when none is given. */
export const DEFAULT_SNAPSHOT = 'default';

/** The operand of `state.diff` that means the running world. */
export const LIVE = 'live';

const SNAPSHOT_NAME = /^[a-z][a-z0-9-]*$/;

const show = (value: FactValue | undefined): string =>
  value === undefined ? '(unset)' : JSON.stringify(value);

/** The text typed for a fact as the value its declared type holds. */
function factValue(key: string, type: string | undefined, text: string): FactValue {
  if (type === 'bool') {
    if (text !== 'true' && text !== 'false') {
      throw new ConsoleError([`fact "${key}" is a bool: use true or false, not "${text}"`]);
    }
    return text === 'true';
  }
  if (type === 'int' || type === 'tick') {
    const number = Number(text);
    if (text.trim() === '' || !Number.isInteger(number)) {
      throw new ConsoleError([
        `fact "${key}" is ${type === 'int' ? 'an int' : 'a tick'}: "${text}" is not a whole number`,
      ]);
    }
    return number;
  }
  return text;
}

/** Registers the world state commands on `registry`. */
export function registerWorldStateCommands(
  registry: CommandRegistry<ConsoleHost>,
  { world, readSlot }: WorldStateCommandOptions,
): void {
  const snapshots = new Map<string, StateView>();
  const live = (): StateView => ({
    facts: world.facts.snapshot(),
    levels: levelDeltasOf(world).capture(world),
  });

  registry.registerCommand({
    name: 'facts.list',
    summary: 'world state: the set facts, optionally under a key prefix (facts.list quest.)',
    usage: '[prefix]',
    args: z.tuple([z.string().optional()]),
    run: ([prefix = '']) => {
      const entries = world.facts.entries(prefix);
      if (entries.length === 0) {
        return prefix === '' ? 'no facts are set' : `no set fact starts with "${prefix}"`;
      }
      return [
        `${String(entries.length)} fact${entries.length === 1 ? '' : 's'}${prefix === '' ? '' : ` under "${prefix}"`}:`,
        ...entries.map(([key, value]) => `  ${key} = ${show(value)}`),
      ];
    },
  });

  registry.registerCommand({
    name: 'facts.get',
    summary: 'world state: one fact’s value, type and default',
    usage: '<key>',
    args: z.tuple([z.string()]),
    run: ([key]) => {
      if (!isFactKey(key)) throw new ConsoleError([`"${key}" is not a fact key`]);
      const type = world.facts.typeOf(key);
      if (type === undefined) {
        throw new ConsoleError([`no fact "${key}": it is not declared and not set`]);
      }
      const dflt = world.facts.spec(key)?.default;
      return `${key} = ${show(world.facts.get(key))} (${type}${world.facts.has(key) ? ', set' : `, default ${show(dflt)}`})`;
    },
  });

  registry.registerCommand({
    name: 'facts.set',
    summary: 'world state: write a declared fact; dependent conditions re-evaluate',
    usage: '<key> <value>',
    args: z.tuple([z.string(), z.string()]),
    run: ([key, text], host) => {
      if (!isFactKey(key)) throw new ConsoleError([`"${key}" is not a fact key`]);
      if (!world.facts.isDeclared(key)) {
        throw new ConsoleError([`fact "${key}" is not declared; only declared facts can be set`]);
      }
      const value = factValue(key, world.facts.typeOf(key), text);
      if (world.facts.restoreProblem(key, value) !== undefined) {
        throw new ConsoleError([`fact "${key}" does not accept ${show(value)}`]);
      }
      host.submit(factCommand({ [key]: value }));
      return `${key} = ${show(value)} (was ${show(world.facts.get(key))}; applied next tick)`;
    },
  });

  registry.registerCommand({
    name: 'deltas.list',
    summary: 'world state: levels with changes, or one level’s changed entities and spawns',
    usage: '[level]',
    args: z.tuple([z.string().optional()]),
    complete: (index) =>
      index === 0
        ? levelDeltasOf(world)
            .capture(world)
            .map((d) => d.level)
        : [],
    run: ([level]) => {
      const levels = levelDeltasOf(world).capture(world);
      if (level === undefined) {
        if (levels.length === 0) return 'no level has changes yet';
        const current = levelDeltasOf(world).current;
        return levels.map(
          (d) =>
            `${d.level}${d.level === current ? ' (loaded)' : ''}: ${String(d.entities.length)} changed, ${String(d.spawned.length)} spawned`,
        );
      }
      const deltas = levels.find((d) => d.level === level);
      if (deltas === undefined) {
        throw new ConsoleError([
          `no deltas for level "${level}"; levels: ${levels.map((d) => d.level).join(', ') || 'none'}`,
        ]);
      }
      return [
        `${level}: ${String(deltas.entities.length)} changed, ${String(deltas.spawned.length)} spawned`,
        ...deltas.entities.map((entity) => `  ${entity.id}: ${describeDelta(entity)}`),
        ...deltas.spawned.map((spawn) => `  ${spawn.id} (spawned ${spawn.kind})`),
      ];
    },
  });

  registry.registerCommand({
    name: 'state.snapshot',
    summary: 'world state: keep the facts and level deltas now, in memory (this session only)',
    usage: `[name, default ${DEFAULT_SNAPSHOT}]`,
    args: z.tuple([z.string().optional()]),
    run: ([name = DEFAULT_SNAPSHOT]) => {
      if (!SNAPSHOT_NAME.test(name) || name === LIVE || isSlotId(name)) {
        throw new ConsoleError([
          `"${name}" cannot name a snapshot: use lower-case words and dashes, not "${LIVE}" or a save slot`,
        ]);
      }
      const state = live();
      snapshots.set(name, state);
      return `snapshot "${name}": ${String(Object.keys(state.facts).length)} facts, ${String(state.levels.length)} levels`;
    },
  });

  registry.registerCommand({
    name: 'state.restore',
    summary:
      'world state: put a snapshot’s facts and level deltas back (the loaded level’s entities stay)',
    usage: `[name, default ${DEFAULT_SNAPSHOT}]`,
    args: z.tuple([z.string().optional()]),
    complete: (index) => (index === 0 ? [...snapshots.keys()] : []),
    run: ([name = DEFAULT_SNAPSHOT], host) => {
      const state = snapshots.get(name);
      if (state === undefined) {
        throw new ConsoleError([
          `no snapshot "${name}"; snapshots: ${[...snapshots.keys()].join(', ') || 'none (state.snapshot first)'}`,
        ]);
      }
      host.submit(restoreStateCommand(state.facts, state.levels));
      return `restoring "${name}" next tick: facts replaced, unloaded levels' deltas replaced; entities of the loaded level keep their state`;
    },
  });

  const operand = async (name: string): Promise<StateView> => {
    if (name === LIVE) return live();
    const snapshot = snapshots.get(name);
    if (snapshot !== undefined) return snapshot;
    if (!isSlotId(name)) {
      throw new ConsoleError([
        `"${name}" is not a save slot, "${LIVE}" or a snapshot; snapshots: ${[...snapshots.keys()].join(', ') || 'none'}`,
      ]);
    }
    const read = await readSlot(name);
    if (read === undefined) throw new ConsoleError([`slot ${name} is empty`]);
    if (!read.ok) throw new ConsoleError([`slot ${name} cannot be read: ${read.reason}`]);
    return read.state;
  };

  registry.registerCommand({
    name: 'state.diff',
    summary:
      'world state: facts and per-level deltas that differ between two saves, live or snapshots',
    usage: `<a> <b> (each a save slot, ${LIVE} or a snapshot name)`,
    args: z.tuple([z.string(), z.string()]),
    complete: (index) => (index <= 1 ? [LIVE, ...snapshots.keys(), ...ALL_SLOTS] : []),
    run: async ([a, b]) => {
      const [left, right] = [await operand(a), await operand(b)];
      return formatDiff(diffStates(left, right), { a, b });
    },
  });
}
