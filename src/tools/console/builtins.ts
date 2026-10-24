// The debug console's built-in commands (mw-e33.1): help, spawn, despawn (mw-e12.4), give, god,
// noclip, kill, prop (mw-e03.37), tp, timescale, scene, set and seed, blast (mw-e04.34), save
// (mw-e30.7), act (mw-e03.11: the knight's heavy attack until the controls bind it) and quickslot
// (mw-e17.10: uses a quick slot until the controls bind them, mw-e17.17).
// Everything that changes the sim goes out as a sim command through
// `host.submit` (applied next tick, recorded in replays); the host's other members only read the
// sim or drive the page (time scale, scene reload), never sim state.

import {
  actCommand,
  blastCommand,
  cheatCommand,
  despawnCreaturesCommand,
  DIFFICULTY_KEYS,
  DIFFICULTY_RANGES,
  difficultyCommand,
  killCommand,
  giveItemCommand,
  assignSpellSlotCommand,
  learnSpellCommand,
  MAX_BLAST_INTENSITY,
  MAX_BLAST_RADIUS,
  MAX_SPAWN_COUNT,
  propertyCommand,
  spawnCommand,
  teleportCommand,
  timeAdvanceCommand,
  timeSetCommand,
  type DebugCheat,
  type DifficultyKey,
  type EntityId,
  type Vec3,
  QUICK_SLOT_COUNT,
  useQuickSlotCommand,
  WORLD_PROPERTY_KEYS,
  SPELL_HOTBAR_SLOTS,
} from '@sim/index';
import { MAX_TIME_SCALE } from '@game/loop/fixed-step';
import { ALL_SLOTS, isSlotId, type SlotId } from '@game/save/slots/ids';
import { z } from 'zod';
import { ConsoleError, type CommandRegistry, type CommandSpec } from './registry';
import { closest, splitOptions } from './text';

/** What the built-ins need from the running game. */
export interface ConsoleHost {
  /** Queues a sim command for the next tick. */
  submit(command: unknown): void;
  /** The world seed. */
  readonly seed: number;
  isAlive(entity: EntityId): boolean;
  /** The player entity, if the scene has one. */
  player(): EntityId | undefined;
  /** Whether `entity` has `cheat` on right now. */
  cheat(entity: EntityId, cheat: DebugCheat): boolean;
  /** Where `spawn` puts things: a little in front of the player, or the scene origin. */
  spawnPoint(): Vec3;
  /**
   * The point under the cursor (the screen centre while the pointer is locked), for
   * `spawn … at-cursor`; undefined when nothing is under it. Absent: at-cursor is unavailable.
   */
  cursorPoint?(): Vec3 | undefined;
  /** Spawnable content ids (`testprop-crate`…), sorted. */
  readonly spawnables: readonly string[];
  /**
   * What is wrong with `options` for spawning `content` (`spawn dummy --poise 60`), or undefined
   * when they are fine. Without it, no spawnable takes options.
   */
  checkSpawn?(content: string, options: Readonly<Record<string, string>>): string | undefined;
  /** Named places `tp` accepts (the loaded scene's spawns). */
  bookmarks(): ReadonlyMap<string, Vec3>;
  /** Item ids `give` accepts, sorted. Absent: `give` is unavailable. */
  readonly items?: readonly string[];
  /** Spell ids `spell` accepts, sorted (empty: no spells in this build). */
  readonly spells?: readonly string[];
  /** Makes `id` the spell the cast button casts; false when the player has not learned it. */
  readonly selectSpell?: (id: string) => boolean;
  /** Scene ids `scene` accepts, sorted. */
  readonly scenes: readonly string[];
  /** Switches to scene `id` (reloads the page). */
  loadScene(id: string): void;
  /** Saves the game into `slot`, overwriting it. Absent: `save` is unavailable. */
  save?(slot: SlotId): void;
  /** Sim speed: 1 is real time. */
  timeScale: number;
}

/** The `spawn` word that puts the spawn under the cursor instead of in front of the player. */
export const AT_CURSOR = 'at-cursor';

const count = (max: number) => z.coerce.number<string>().int().min(1).max(max);
const coordinate = z.coerce.number<string>().refine(Number.isFinite, 'expected a finite number');

function player(host: ConsoleHost): EntityId {
  const id = host.player();
  if (id === undefined) throw new ConsoleError(['no player in this scene']);
  return id;
}

function unknown(what: string, value: string, known: readonly string[]): ConsoleError {
  const near = closest(value, known);
  return new ConsoleError([
    near.length === 0
      ? `unknown ${what} "${value}"`
      : `unknown ${what} "${value}"; closest: ${near.join(', ')}`,
  ]);
}

const onOff = z.enum(['on', 'off']).optional();

/** A `blast` with no arguments: enough to launch the player standing next to it. */
export const DEFAULT_BLAST = Object.freeze({ intensity: 1500, radius: 4 });

/**
 * A typed property value: true/false, a number, a JSON record (`{"intensity":80,"radius":6}`) or
 * else a bare id or enum value.
 */
export function propertyValue(text: string): unknown {
  if (text === 'true' || text === 'false') return text === 'true';
  if (text.startsWith('{')) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new ConsoleError([`bad value ${text}: expected JSON like {"intensity":80,"radius":6}`]);
    }
  }
  const number = Number(text);
  return text.trim() !== '' && Number.isFinite(number) ? number : text;
}

/** `splitOptions` with its errors as console errors. */
export function parsedOptions(tokens: readonly string[]): ReturnType<typeof splitOptions> {
  try {
    return splitOptions(tokens);
  } catch (error) {
    throw new ConsoleError([(error as Error).message]);
  }
}

function cheatToggle(
  name: DebugCheat,
  label: string,
): CommandSpec<[('on' | 'off' | undefined)?], ConsoleHost> {
  return {
    name,
    summary: `toggle ${label} for the player`,
    usage: '[on|off]',
    args: z.tuple([onOff]),
    complete: () => ['on', 'off'],
    run: ([state], host) => {
      const target = player(host);
      const on = state === undefined ? !host.cheat(target, name) : state === 'on';
      host.submit(cheatCommand(target, name, on));
      return `${label} ${on ? 'on' : 'off'}`;
    },
  };
}

/** Registers every built-in command on `registry`. */
export function registerBuiltins(registry: CommandRegistry<ConsoleHost>): void {
  registry.registerCommand({
    name: 'help',
    summary: 'list commands, or show how to use one',
    usage: '[command]',
    args: z.tuple([z.string().optional()]),
    complete: () => registry.list().map((spec) => spec.name),
    run: ([name]) => {
      if (name === undefined) {
        return registry.list().map((spec) => `${registry.usageOf(spec)} — ${spec.summary}`);
      }
      const spec = registry.get(name);
      if (spec === undefined) {
        throw unknown(
          'command',
          name,
          registry.list().map((s) => s.name),
        );
      }
      return [`usage: ${registry.usageOf(spec)}`, spec.summary];
    },
  });

  const spawnUsage = `<contentId> [count 1–${String(MAX_SPAWN_COUNT)}] [at-cursor] [--option value…]`;
  registry.registerCommand({
    name: 'spawn',
    summary:
      'spawn content or a creature in front of the player, or at-cursor (sandbox dummies take options: type dummies)',
    usage: spawnUsage,
    args: z.tuple([z.string()]).rest(z.string()),
    complete: (index, host) => (index === 0 ? host.spawnables : []),
    run: ([content, ...rest], host) => {
      const { words, options } = parsedOptions(rest);
      const atCursor = words.includes(AT_CURSOR);
      const counted = z
        .tuple([count(MAX_SPAWN_COUNT).optional()])
        .safeParse(words.filter((word) => word !== AT_CURSOR));
      if (!counted.success) {
        const issue = counted.error.issues.map((i) => i.message).join('; ');
        throw new ConsoleError([
          `spawn: invalid arguments: arg 2: ${issue}`,
          `usage: spawn ${spawnUsage}`,
        ]);
      }
      const [n = 1] = counted.data;
      if (!host.spawnables.includes(content)) {
        throw unknown('content id', content, host.spawnables);
      }
      const noOptions = Object.keys(options).length === 0;
      const problem =
        host.checkSpawn === undefined
          ? noOptions
            ? undefined
            : `${content} takes no options`
          : host.checkSpawn(content, options);
      if (problem !== undefined) throw new ConsoleError([`spawn ${content}: ${problem}`]);
      let at = host.spawnPoint();
      if (atCursor) {
        if (host.cursorPoint === undefined) {
          throw new ConsoleError(['spawn: at-cursor needs the game view']);
        }
        const point = host.cursorPoint();
        if (point === undefined) throw new ConsoleError(['spawn: nothing under the cursor']);
        at = point;
      }
      host.submit(spawnCommand(content, n, at, options));
      const described = Object.entries(options).map(([name, value]) => `--${name} ${value}`);
      const where = atCursor ? ` at ${String(at.x)} ${String(at.y)} ${String(at.z)}` : '';
      return `spawning ${String(n)} × ${[content, ...described].join(' ')}${where}`;
    },
  });

  registry.registerCommand({
    name: 'despawn',
    summary: 'remove every spawned creature',
    usage: 'all',
    args: z.tuple([z.literal('all')]),
    complete: (index) => (index === 0 ? ['all'] : []),
    run: (_args, host) => {
      host.submit(despawnCreaturesCommand());
      return 'despawning every creature';
    },
  });

  registry.registerCommand({
    name: 'give',
    summary: 'give the player items',
    usage: '<itemId> [n]',
    args: z.tuple([z.string(), count(999).optional()]),
    complete: (index, host) => (index === 0 ? (host.items ?? []) : []),
    run: ([id, n = 1], host) => {
      if (host.items === undefined) {
        throw new ConsoleError([
          'no items to give yet: the inventory arrives with e17 (mw-e17.12)',
        ]);
      }
      if (!host.items.includes(id)) throw unknown('item', id, host.items);
      host.submit(giveItemCommand(player(host), id, n));
      return `giving ${String(n)} × ${id}`;
    },
  });

  registry.registerCommand(cheatToggle('god', 'god mode'));
  registry.registerCommand(cheatToggle('noclip', 'noclip'));

  registry.registerCommand({
    name: 'kill',
    summary: 'kill an entity (the player by default)',
    usage: '[entityId]',
    args: z.tuple([z.coerce.number<string>().int().positive().optional()]),
    run: ([entity], host) => {
      const target = entity ?? player(host);
      if (!host.isAlive(target)) throw new ConsoleError([`no entity ${String(target)}`]);
      host.submit(killCommand(target));
      return `killing entity ${String(target)}`;
    },
  });

  registry.registerCommand({
    name: 'prop',
    summary: 'set a world property of an entity (e.g. put a torch out: prop 12 burning false)',
    usage: '<entityId> <property> <value>',
    args: z.tuple([z.coerce.number<string>().int().positive(), z.string(), z.string()]),
    complete: (index) => (index === 1 ? WORLD_PROPERTY_KEYS : []),
    run: ([target, key, text], host) => {
      if (!host.isAlive(target)) throw new ConsoleError([`no entity ${String(target)}`]);
      const value = propertyValue(text);
      try {
        host.submit(propertyCommand(target, key, value));
      } catch (error) {
        if (!(error instanceof RangeError)) throw error;
        if (error.message.startsWith('unknown world property')) {
          throw unknown('world property', key, WORLD_PROPERTY_KEYS);
        }
        throw new ConsoleError([error.message]);
      }
      return `entity ${String(target)}: ${key} = ${JSON.stringify(value)}`;
    },
  });

  registry.registerCommand({
    name: 'tp',
    summary: 'teleport the player to a position or a named place',
    usage: '<x y z | place>',
    args: z.union([z.tuple([coordinate, coordinate, coordinate]), z.tuple([z.string()])]),
    complete: (index, host) => (index === 0 ? [...host.bookmarks().keys()].sort() : []),
    run: (args, host) => {
      const target = player(host);
      let to: Vec3;
      if (args.length === 3) {
        const [x, y, z] = args;
        to = { x, y, z };
      } else {
        const places = host.bookmarks();
        const place = places.get(args[0]);
        if (place === undefined) throw unknown('place', args[0], [...places.keys()].sort());
        to = place;
      }
      host.submit(teleportCommand(target, to));
      return `teleporting to ${String(to.x)} ${String(to.y)} ${String(to.z)}`;
    },
  });

  registry.registerCommand({
    name: 'blast',
    summary: 'set off a force blast where spawn puts things (knocks back and launches)',
    usage: `[intensity N·s, default ${String(DEFAULT_BLAST.intensity)}] [radius m, default ${String(DEFAULT_BLAST.radius)}]`,
    args: z.tuple([
      z.coerce.number<string>().positive().max(MAX_BLAST_INTENSITY).optional(),
      z.coerce.number<string>().positive().max(MAX_BLAST_RADIUS).optional(),
    ]),
    run: ([intensity = DEFAULT_BLAST.intensity, radius = DEFAULT_BLAST.radius], host) => {
      const at = host.spawnPoint();
      host.submit(blastCommand(at, radius, intensity));
      return `blast of ${String(intensity)} N·s, radius ${String(radius)} m at ${String(at.x)} ${String(at.y)} ${String(at.z)}`;
    },
  });

  registry.registerCommand({
    name: 'time',
    summary: 'move the in-game clock (mw-e27.12): time set <day> <HH:MM>, time advance <N>h|<N>m',
    usage: 'set <day> <HH:MM> | advance <N>h|<N>m',
    args: z.tuple([z.enum(['set', 'advance']), z.string(), z.string().optional()]),
    run: ([action, first, second], host) => {
      try {
        if (action === 'advance') {
          const match = /^(\d+)([hm])$/.exec(first);
          if (match === null) throw new RangeError(`bad duration "${first}": use 8h or 90m`);
          const amount = Number(match[1]) * (match[2] === 'h' ? 60 : 1);
          host.submit(timeAdvanceCommand(amount));
          return `time advances ${String(amount)} game minutes`;
        }
        const match = /^(\d{1,2}):(\d{2})$/.exec(second ?? '');
        if (match === null) throw new RangeError(`set needs <day> <HH:MM>, got "${second ?? ''}"`);
        const minute = Number(match[1]) * 60 + Number(match[2]);
        host.submit(timeSetCommand(Number(first), minute));
        return `time set to day ${first} ${match[0]}`;
      } catch (error) {
        // Only RangeErrors from the command builders and the parsing above reach here.
        throw new ConsoleError([(error as Error).message]);
      }
    },
  });

  registry.registerCommand({
    name: 'act',
    summary: 'make the player perform a move (heavy attack: act sword-heavy)',
    usage: '<moveId>',
    args: z.tuple([z.string()]),
    run: ([move], host) => {
      host.submit(actCommand(player(host), move));
      return `player performs ${move}`;
    },
  });

  registry.registerCommand({
    name: 'quickslot',
    summary: 'use one of the player’s quick slots (until the controls bind them)',
    usage: `<1–${String(QUICK_SLOT_COUNT)}>`,
    args: z.tuple([z.coerce.number<string>().int().min(1).max(QUICK_SLOT_COUNT)]),
    run: ([slot], host) => {
      host.submit(useQuickSlotCommand(player(host), slot - 1));
      return `using quick slot ${String(slot)}`;
    },
  });

  registry.registerCommand({
    name: 'spell',
    summary:
      'learn a spell, choose the one the cast button casts (V, D-pad up), or put one on the hotbar',
    usage: 'learn|select <spellId> | slot <1–8> <spellId|none>',
    args: z.tuple([z.enum(['learn', 'select', 'slot']), z.string(), z.string().optional()]),
    complete: (index, host) =>
      index === 1 ? (host.spells ?? []) : index === 2 ? [...(host.spells ?? []), 'none'] : [],
    run: ([action, first, second], host) => {
      const known = host.spells ?? [];
      if (action === 'slot') {
        const slot = Number(first);
        if (!Number.isInteger(slot) || slot < 1 || slot > SPELL_HOTBAR_SLOTS) {
          throw new ConsoleError([`slot must be 1–${String(SPELL_HOTBAR_SLOTS)}, got "${first}"`]);
        }
        const id = second ?? 'none';
        if (id !== 'none' && !known.includes(id)) throw unknown('spell', id, known);
        host.submit(assignSpellSlotCommand(player(host), slot - 1, id === 'none' ? null : id));
        return id === 'none' ? `slot ${first} cleared` : `slot ${first}: ${id}`;
      }
      const id = first;
      if (!known.includes(id)) throw unknown('spell', id, known);
      if (action === 'learn') {
        host.submit(learnSpellCommand(player(host), id));
        return `learning ${id} (select it with: spell select ${id})`;
      }
      if (host.selectSpell?.(id) !== true) {
        throw new ConsoleError([`${id} is not learned yet; try: spell learn ${id}`]);
      }
      return `${id} selected`;
    },
  });

  registry.registerCommand({
    name: 'timescale',
    summary: 'show or set the sim speed (1 = real time, 0 = frozen)',
    usage: `[0–${String(MAX_TIME_SCALE)}]`,
    args: z.tuple([z.coerce.number<string>().min(0).max(MAX_TIME_SCALE).optional()]),
    run: ([scale], host) => {
      if (scale !== undefined) host.timeScale = scale;
      return `timescale ${String(host.timeScale)}`;
    },
  });

  registry.registerCommand({
    name: 'scene',
    summary: 'load a scene (reloads the page)',
    usage: '<sceneId>',
    args: z.tuple([z.string()]),
    complete: (index, host) => (index === 0 ? host.scenes : []),
    run: ([id], host) => {
      if (!host.scenes.includes(id)) throw unknown('scene', id, host.scenes);
      host.loadScene(id);
      return `loading scene ${id}`;
    },
  });

  registry.registerCommand({
    name: 'save',
    summary: 'save the game into a slot, overwriting it (manual-1 by default)',
    usage: '[slot]',
    args: z.tuple([z.string().optional()]),
    complete: (index) => (index === 0 ? ALL_SLOTS : []),
    run: ([slot = 'manual-1'], host) => {
      if (host.save === undefined) throw new ConsoleError(['saving is unavailable here']);
      if (!isSlotId(slot)) throw unknown('slot', slot, ALL_SLOTS);
      host.save(slot);
      return `saving to ${slot}`;
    },
  });

  registry.registerCommand({
    name: 'set',
    summary: 'set a difficulty multiplier',
    usage: '<setting> <value>',
    args: z.tuple([z.enum(DIFFICULTY_KEYS as [DifficultyKey, ...DifficultyKey[]]), coordinate]),
    complete: (index) => (index === 0 ? DIFFICULTY_KEYS : []),
    run: ([key, value], host) => {
      const { min, max } = DIFFICULTY_RANGES[key];
      if (value < min || value > max) {
        throw new ConsoleError([`${key} must be ${String(min)}–${String(max)}`]);
      }
      host.submit(difficultyCommand({ [key]: value }));
      return `${key} = ${String(value)}`;
    },
  });

  registry.registerCommand({
    name: 'seed',
    summary: 'print the world seed',
    usage: '',
    args: z.tuple([]),
    run: (_args, host) => `seed ${String(host.seed)}`,
  });
}
