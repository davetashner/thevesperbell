// The debug console's item commands (mw-e17.12): item.give, item.remove, item.list, equip and gold,
// with item ids completed from the catalogue. Like every console command they change the sim only by
// submitting sim commands (applied next tick, recorded in replays); the pack is read through the host.
// What the pack ends up holding is the inventory rules' (a refusal there changes nothing), so the
// count printed after a give or remove is what the command leaves when the rules accept it.

import {
  equipItemCommand,
  giveGoldCommand,
  giveItemCommand,
  removeItemCommand,
  type EntityId,
} from '@sim/index';
import { z } from 'zod';
import type { ConsoleHost } from './builtins';
import { ConsoleError, type CommandRegistry } from './registry';
import { closest, splitOptions } from './text';

/** Most units one give or remove moves (matches `give`). */
const MAX_COUNT = 999;

const count = z.coerce.number<string>().int().min(1).max(MAX_COUNT);

function player(host: ConsoleHost): EntityId {
  const id = host.player();
  if (id === undefined) throw new ConsoleError(['no player in this scene']);
  return id;
}

/** The item ids the console knows; an error when the build has no catalogue. */
function catalogue(host: ConsoleHost): readonly string[] {
  if (host.items === undefined) throw new ConsoleError(['no item catalogue in this build']);
  return host.items;
}

/** The catalogue id `id`, or an error naming the 3 closest ids by edit distance. */
function knownItem(host: ConsoleHost, id: string): string {
  const ids = catalogue(host);
  if (ids.includes(id)) return id;
  const near = closest(id, [...ids]);
  throw new ConsoleError([
    near.length === 0
      ? `unknown item "${id}"`
      : `unknown item "${id}"; closest: ${near.join(', ')}`,
  ]);
}

/** Units of `id` the player holds now (undefined when the host cannot read the pack). */
function heldCount(host: ConsoleHost, id: string): number | undefined {
  return host.pack?.()?.items.reduce((n, item) => (item.defId === id ? n + item.count : n), 0);
}

const nowHolding = (held: number | undefined, change: number): string =>
  held === undefined ? '' : ` (now ${String(Math.max(0, held + change))})`;

const GIVE_USAGE = '<itemId> [count] [--stolen ownerId]';

function give([id, ...rest]: [string, ...string[]], host: ConsoleHost): string {
  let words: string[];
  let options: Record<string, string>;
  try {
    ({ words, options } = splitOptions(rest));
  } catch (error) {
    throw new ConsoleError([(error as Error).message, `usage: item.give ${GIVE_USAGE}`]);
  }
  const unexpected = Object.keys(options).filter((name) => name !== 'stolen');
  const counted = z.tuple([count.optional()]).safeParse(words);
  if (unexpected.length > 0 || !counted.success) {
    const problem =
      unexpected.length > 0
        ? `unknown option --${unexpected.join(', --')}`
        : `arg 2: ${(counted.error?.issues ?? []).map((i) => i.message).join('; ')}`;
    throw new ConsoleError([
      `item.give: invalid arguments: ${problem}`,
      `usage: item.give ${GIVE_USAGE}`,
    ]);
  }
  const item = knownItem(host, id);
  const [n = 1] = counted.data;
  const owner = options['stolen'];
  host.submit(
    giveItemCommand(
      player(host),
      item,
      n,
      owner === undefined ? {} : { stolen: true, ownerId: owner },
    ),
  );
  const stolen = owner === undefined ? '' : ` stolen from ${owner}`;
  return `giving ${String(n)} × ${item}${stolen}${nowHolding(heldCount(host, item), n)}`;
}

/** Registers the item commands on `registry` (called by `registerBuiltins`). */
export function registerItemCommands(registry: CommandRegistry<ConsoleHost>): void {
  registry.registerCommand({
    name: 'item.give',
    summary: 'give the player items, optionally as stolen goods of an owner',
    usage: GIVE_USAGE,
    args: z.tuple([z.string()]).rest(z.string()),
    complete: (index, host) => (index === 0 ? (host.items ?? []) : []),
    run: give,
  });

  registry.registerCommand({
    name: 'item.remove',
    summary: 'take items out of the player’s pack',
    usage: '<itemId> [count]',
    args: z.tuple([z.string(), count.optional()]),
    complete: (index, host) => (index === 0 ? (host.items ?? []) : []),
    run: ([id, n = 1], host) => {
      const item = knownItem(host, id);
      const target = player(host);
      const held = heldCount(host, item);
      if (held !== undefined && held < n) {
        throw new ConsoleError([`not carrying ${String(n)} × ${item} (have ${String(held)})`]);
      }
      host.submit(removeItemCommand(target, item, n));
      return `removing ${String(n)} × ${item}${nowHolding(held, -n)}`;
    },
  });

  registry.registerCommand({
    name: 'item.list',
    summary: 'list what the player carries, optionally one category',
    usage: '[category]',
    args: z.tuple([z.string().optional()]),
    complete: (index, host) => (index === 0 ? categoriesOf(host) : []),
    run: ([category], host) => {
      player(host);
      const pack = host.pack?.();
      if (pack === undefined) throw new ConsoleError(['no pack to list']);
      const categories = categoriesOf(host);
      if (category !== undefined && !categories.includes(category)) {
        const near = closest(category, [...categories]);
        throw new ConsoleError([
          `unknown category "${category}"; ${near.length === 0 ? 'none known' : `closest: ${near.join(', ')}`}`,
        ]);
      }
      const shown = pack.items.filter(
        (item) => category === undefined || host.itemCategories?.[item.defId] === category,
      );
      const lines = shown.map((item) => {
        const owner = item.ownerId === undefined ? '' : ` of ${item.ownerId}`;
        const stolen = item.stolen === true ? ` [stolen${owner}]` : '';
        return `#${String(item.instanceId)} ${item.defId} × ${String(item.count)}${stolen}`;
      });
      return [...(lines.length === 0 ? ['nothing carried'] : lines), `gold: ${String(pack.gold)}`];
    },
  });

  registry.registerCommand({
    name: 'equip',
    summary: 'equip an item the player carries',
    usage: '<itemId>',
    args: z.tuple([z.string()]),
    complete: (index, host) => (index === 0 ? (host.items ?? []) : []),
    run: ([id], host) => {
      const item = knownItem(host, id);
      const target = player(host);
      if (heldCount(host, item) === 0) {
        throw new ConsoleError([`not carrying ${item}; try: item.give ${item}`]);
      }
      host.submit(equipItemCommand(target, item));
      return `equipping ${item}`;
    },
  });

  registry.registerCommand({
    name: 'gold',
    summary: 'add gold to the player’s purse (negative spends it)',
    usage: '<amount>',
    args: z.tuple([
      z.coerce
        .number<string>()
        .int()
        .refine((n) => n !== 0, 'expected a non-zero whole number'),
    ]),
    run: ([amount], host) => {
      const target = player(host);
      host.submit(giveGoldCommand(target, amount));
      const held = host.pack?.()?.gold;
      const after = held === undefined ? '' : ` (now ${String(Math.max(0, held + amount))})`;
      return `${amount > 0 ? 'adding' : 'spending'} ${String(Math.abs(amount))} gold${after}`;
    },
  });
}

function categoriesOf(host: ConsoleHost): string[] {
  return [...new Set(Object.values(host.itemCategories ?? {}))].sort();
}
