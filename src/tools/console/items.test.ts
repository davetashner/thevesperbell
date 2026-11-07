import {
  addInventory,
  inventoryOf,
  InventoryRules,
  isItemDebugCommand,
  runItemDebugCommand,
  giveItems,
  isGiveItemCommand,
  World,
  type EntityId,
} from '@sim/index';
import { describe, expect, it } from 'vitest';
import { registerBuiltins, type ConsoleHost } from './builtins';
import { createGameHost } from './host';
import { CommandRegistry } from './registry';

const base = { stackable: true, maxStack: 10, flags: { unique: false, questItem: false } };
const DEFS = [
  { id: 'healing-draught', category: 'consumable', ...base },
  { id: 'healing-tonic', category: 'consumable', ...base },
  { id: 'silver-ring', category: 'misc', ...base },
  { id: 'iron-sword', category: 'weapon', ...base, stackable: false },
] as never[];
const IDS = ['healing-draught', 'healing-tonic', 'iron-sword', 'silver-ring'];

/** A console over a real inventory, with queued commands applied by `tick`. */
function session(options: { withPlayer?: boolean; catalogue?: boolean } = {}) {
  const world = new World<never>({ seed: 1 });
  const rules = new InventoryRules(DEFS);
  const giver = { inventory: rules, known: (id: string) => IDS.includes(id) };
  let player: EntityId | undefined;
  if (options.withPlayer !== false) {
    player = world.spawn();
    addInventory(world, player, 10);
  }
  const queue: unknown[] = [];
  const host = createGameHost({
    world,
    submit: (command) => queue.push(command),
    player: () => player,
    spawnables: [],
    ...(options.catalogue !== false && { items: IDS }),
    itemCategories: Object.fromEntries(
      DEFS.map((d: { id: string; category: string }) => [d.id, d.category]),
    ),
    bookmarks: () => new Map(),
    scenes: [],
    loadScene: () => undefined,
    loop: { timeScale: 1 },
  });
  const registry = new CommandRegistry<ConsoleHost>(host);
  registerBuiltins(registry);
  const tick = () => {
    for (const command of queue.splice(0)) {
      if (isGiveItemCommand(command)) giveItems(world, command, giver);
      else if (isItemDebugCommand(command)) runItemDebugCommand(world, command, giver);
    }
  };
  const held = (id: string): number =>
    (player === undefined ? [] : (inventoryOf(world, player)?.items ?? []))
      .filter((item) => item.defId === id)
      .reduce((n, item) => n + item.count, 0);
  return { world, registry, queue, tick, held, player: () => player };
}

describe('item console commands', () => {
  it('AC-1: item.give adds the count and prints the new count', () => {
    const s = session();
    const result = s.registry.execute('item.give healing-draught 3');
    expect(result).toEqual({ ok: true, lines: ['giving 3 × healing-draught (now 3)'] });
    s.tick();
    expect(s.held('healing-draught')).toBe(3);
    expect(s.registry.execute('item.give healing-draught').lines).toEqual([
      'giving 1 × healing-draught (now 4)',
    ]);
  });

  it('AC-2: an unknown id prints the 3 closest ids and changes nothing', () => {
    const s = session();
    const result = s.registry.execute('item.give healing-draugt 2');
    expect(result.ok).toBe(false);
    expect(result.lines[0]).toMatch(/^unknown item "healing-draugt"; closest: healing-draught, /);
    expect(result.lines[0]?.split('closest: ')[1]?.split(', ')).toHaveLength(3);
    s.tick();
    expect(s.queue).toEqual([]);
    expect(s.held('healing-draught')).toBe(0);
  });

  it('AC-3: --stolen marks the instance stolen with that owner', () => {
    const s = session();
    const result = s.registry.execute('item.give silver-ring 1 --stolen mayor');
    expect(result.lines).toEqual(['giving 1 × silver-ring stolen from mayor (now 1)']);
    s.tick();
    const who = s.player();
    const [ring] = (who === undefined ? undefined : inventoryOf(s.world, who))?.items ?? [];
    expect(ring?.flags).toEqual({ stolen: true, ownerId: 'mayor' });
    expect(s.registry.execute('item.list').lines).toContain('#1 silver-ring × 1 [stolen of mayor]');
  });

  it('item.give rejects bad counts and options with usage, and needs a player and a catalogue', () => {
    const s = session();
    expect(s.registry.execute('item.give silver-ring lots').lines[1]).toBe(
      'usage: item.give <itemId> [count] [--stolen ownerId]',
    );
    expect(s.registry.execute('item.give silver-ring --colour red').lines[0]).toBe(
      'item.give: invalid arguments: unknown option --colour',
    );
    expect(s.registry.execute('item.give silver-ring --stolen').lines[0]).toBe(
      'option --stolen needs a value',
    );
    expect(session({ withPlayer: false }).registry.execute('item.give silver-ring').lines).toEqual([
      'no player in this scene',
    ]);
    expect(session({ catalogue: false }).registry.execute('item.give silver-ring').lines).toEqual([
      'no item catalogue in this build',
    ]);
    expect(s.queue).toEqual([]);
  });

  it('item.remove takes units, and refuses more than are carried or an unknown id', () => {
    const s = session();
    s.registry.execute('item.give healing-draught 3');
    s.tick();
    expect(s.registry.execute('item.remove healing-draught 2').lines).toEqual([
      'removing 2 × healing-draught (now 1)',
    ]);
    s.tick();
    expect(s.held('healing-draught')).toBe(1);
    expect(s.registry.execute('item.remove healing-draught 5')).toEqual({
      ok: false,
      lines: ['not carrying 5 × healing-draught (have 1)'],
    });
    expect(s.registry.execute('item.remove healing-draugt').lines[0]).toMatch(/closest: /);
    expect(s.queue).toEqual([]);
  });

  it('item.list shows the pack, filtered by category, and names the closest unknown category', () => {
    const s = session();
    expect(s.registry.execute('item.list').lines).toEqual(['nothing carried', 'gold: 10']);
    s.registry.execute('item.give healing-draught 2');
    s.registry.execute('item.give iron-sword');
    s.tick();
    expect(s.registry.execute('item.list').lines).toEqual([
      '#1 healing-draught × 2',
      '#2 iron-sword × 1',
      'gold: 10',
    ]);
    expect(s.registry.execute('item.list weapon').lines).toEqual(['#2 iron-sword × 1', 'gold: 10']);
    expect(s.registry.execute('item.list wepon').lines[0]).toBe(
      'unknown category "wepon"; closest: weapon, misc, consumable',
    );
    expect(s.registry.execute('item.list ').lines).toBeDefined();
    expect(s.registry.complete('item.list w').line).toBe('item.list weapon ');
  });

  it('equip needs a known, carried item', () => {
    const s = session();
    expect(s.registry.execute('equip iron-swrd').lines[0]).toMatch(/closest: iron-sword/);
    expect(s.registry.execute('equip iron-sword').lines).toEqual([
      'not carrying iron-sword; try: item.give iron-sword',
    ]);
    s.registry.execute('item.give iron-sword');
    s.tick();
    expect(s.registry.execute('equip iron-sword')).toEqual({
      ok: true,
      lines: ['equipping iron-sword'],
    });
    expect(s.queue).toHaveLength(1);
  });

  it('gold adds or spends, and rejects zero and fractions', () => {
    const s = session();
    expect(s.registry.execute('gold 50').lines).toEqual(['adding 50 gold (now 60)']);
    expect(s.registry.execute('gold -4').lines).toEqual(['spending 4 gold (now 6)']);
    expect(s.registry.execute('gold 0').ok).toBe(false);
    expect(s.registry.execute('gold 1.5').ok).toBe(false);
    expect(s.queue).toHaveLength(2);
  });

  it('completes item ids after each item command', () => {
    const s = session();
    expect(s.registry.complete('item.give silver').line).toBe('item.give silver-ring ');
    expect(s.registry.complete('item.remove iron').line).toBe('item.remove iron-sword ');
    expect(s.registry.complete('equip iron').line).toBe('equip iron-sword ');
    expect(s.registry.complete('item.give iron-sword ').options).toEqual([]);
    expect(s.registry.complete('item.list ').options.length).toBe(3);
    expect(s.registry.complete('item.remove iron-sword ').options).toEqual([]);
    expect(s.registry.complete('item.list weapon ').options).toEqual([]);
    expect(s.registry.complete('equip iron-sword ').options).toEqual([]);
  });

  it('works without a readable pack (no counts printed)', () => {
    const s = session();
    const host = (s.registry as unknown as { host: ConsoleHost }).host;
    (host as { pack?: unknown }).pack = undefined;
    expect(s.registry.execute('item.give silver-ring').lines).toEqual(['giving 1 × silver-ring']);
    expect(s.registry.execute('item.list').lines).toEqual(['no pack to list']);
  });

  it('item.list needs a player', () => {
    expect(session({ withPlayer: false }).registry.execute('item.list').lines).toEqual([
      'no player in this scene',
    ]);
  });
});
