// @vitest-environment happy-dom
// The inventory screen in the game (mw-e17.10): view models from the sim (tabs, order, verbs, stolen
// owners, actions), the screen's actions reaching the sim as commands, and the quick-slot strip, on a
// real world with content's items (plus the item fixtures, for a book).
import { readFileSync } from 'node:fs';
import type { ItemEntry } from '@content/index';
import { loadItemFixtureContent } from '@content/test-fixtures';
import {
  addEquipment,
  addStudent,
  DEFAULT_CLOCK_CONFIG,
  installGameClock,
  installStudy,
  knowsSpell,
  SpellLearned,
  StudyEnded,
  StudyStarted,
  type StudyRules,
  CharacterController,
  DAMAGE_COMPONENTS,
  giveCombatant,
  HealthComponent,
  initialCharacterState,
  inventoryOf,
  isInventoryActionCommand,
  PlayerLook,
  quickSlotsOf,
  RapierPhysics,
  registerSceneComponents,
  World,
  WorldItemComponent,
  type EntityId,
  type InventoryActionCommand,
} from '@sim/index';
import { place, rectFromData } from '@ui/testing/layout';
import { UiRoot, type UiPadLike } from '@ui/index';
import { beforeEach, describe, expect, it } from 'vitest';
import { createCapabilityRegistry, createUnlockBook } from '../capabilities';
import { installGamePhysics } from '../physics-objects';
import { createStudyRules } from './book-study';
import { prepareConsumables, prepareWorldItems, startConsumables, startWorldItems } from './index';
import {
  CATEGORY_LABELS,
  InventoryViews,
  itemName,
  itemTabs,
  itemVerbs,
  refusalText,
  requestAction,
  slotLabel,
  STUDY_INTERRUPTIONS,
  startInventoryUi,
  type VerbNames,
} from './inventory-screen';

// Rapier fetches its WASM when imported; under happy-dom, fetch would ask a server that is not there,
// so serve the module's .wasm file from disk (the URL path is the repo-relative file), compiled from
// its bytes (streaming compilation only takes Node's own Response, not happy-dom's).
const pageFetch = globalThis.fetch;
const streaming = WebAssembly.instantiateStreaming;
Object.assign(WebAssembly, {
  instantiateStreaming: async (
    source: Response | PromiseLike<Response>,
    imports?: WebAssembly.Imports,
  ) => WebAssembly.instantiate(await (await source).arrayBuffer(), imports),
});
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);
  if (!url.endsWith('.wasm')) return pageFetch(input, init);
  return new Response(readFileSync(`.${new URL(url, location.href).pathname}`), {
    headers: { 'content-type': 'application/wasm' },
  });
};
const RAPIER = await import('@dimforge/rapier3d-deterministic');
globalThis.fetch = pageFetch;
Object.assign(WebAssembly, { instantiateStreaming: streaming });

const content = loadItemFixtureContent();
const byId = new Map(content.all('item').map((item) => [item.id, item]));
const def = (id: string): ItemEntry => {
  const item = byId.get(id);
  if (item === undefined) throw new Error(`no item ${id}`);
  return item;
};

beforeEach(() => {
  document.body.innerHTML = '';
});

/** A world with physics, world items, consumables and the inventory UI, and a player at the origin. */
function game(
  options: { player?: boolean; closeKeys?: readonly string[]; study?: StudyRules } = {},
) {
  const physics = new RapierPhysics(RAPIER);
  const world = installGamePhysics(registerSceneComponents(new World<never>({ seed: 7, physics })));
  for (const type of [CharacterController, PlayerLook, ...DAMAGE_COMPONENTS]) {
    if (!world.isRegistered(type)) world.register(type);
  }
  const player: EntityId | undefined = options.player === false ? undefined : world.spawn();
  if (player !== undefined) {
    world.add(player, CharacterController, initialCharacterState({ x: 0, y: 0, z: 0 }));
    world.add(player, PlayerLook, { yaw: 0, pitch: 0 });
    giveCombatant(world, player, { health: 100 });
  }
  const items = prepareWorldItems(content);
  startWorldItems(world, items, [], player);
  const consumables = prepareConsumables(content, items);
  startConsumables(world, consumables, player);
  const ui = new UiRoot(document.body, { unstyled: true, focus: { rectOf: rectFromData } });
  const queue: InventoryActionCommand[] = [];
  const published: Record<string, string> = {};
  const inventoryUi = startInventoryUi({
    ui,
    world,
    content,
    consumables,
    ...(options.study !== undefined && { study: options.study }),
    player,
    submit: (command) => queue.push(command),
    hudScale: 1.25,
    publish: (key, value) => {
      published[key] = value;
    },
    ...(options.closeKeys !== undefined && { closeKeys: () => options.closeKeys ?? [] }),
  });
  world.step([]); // structural adds land
  /** Steps once with the queued commands, then refreshes the UI as the game loop does. */
  const step = (): void => {
    world.step(queue.splice(0) as never[]);
    inventoryUi.afterStep();
  };
  const give = (defId: string, count = 1, flags = {}): void => {
    if (player === undefined) throw new Error('no player');
    const added = items.inventory.add(world, player, defId, count, flags);
    if (!added.ok) throw new Error(added.reason);
  };
  return { world, player, ui, queue, published, inventoryUi, step, give, consumables, items };
}

/** A virtual standard-mapping pad, read by the UI input adapter's `poll`. */
function virtualPad(ui: UiRoot) {
  const pad: UiPadLike & { buttons: { pressed: boolean }[] } = {
    connected: true,
    mapping: 'standard',
    buttons: Array.from({ length: 17 }, () => ({ pressed: false })),
    axes: [0, 0, 0, 0],
  };
  let now = 0;
  const input = ui.attachInput({
    window: new EventTarget(),
    navigator: { getGamepads: () => [pad] },
    now: () => now,
  });
  return (button: 'a' | 'b' | 'up' | 'down' | 'left' | 'right'): void => {
    const index = { a: 0, b: 1, up: 12, down: 13, left: 14, right: 15 }[button];
    const held = pad.buttons[index];
    if (held === undefined) throw new Error('no button');
    held.pressed = true;
    input.poll();
    held.pressed = false;
    now += 1000;
    input.poll();
  };
}

/** Lays out the top screen: cards in a 2-column grid, menu buttons in a column. */
function layout(ui: UiRoot): void {
  const top = ui.top?.element;
  top?.querySelectorAll<HTMLElement>('[role="tab"]').forEach((tab, i) => {
    place(tab, i * 80, 0, 70, 20);
  });
  top?.querySelectorAll<HTMLElement>('[data-item]').forEach((card, i) => {
    place(card, (i % 2) * 110, 40 + Math.floor(i / 2) * 50, 100, 40);
  });
  top?.querySelectorAll<HTMLElement>('.vb-item-menu button').forEach((button, i) => {
    place(button, 300, 100 + i * 40, 160, 30);
  });
}

const focusedText = (): string | null | undefined => document.activeElement?.textContent;

/** `value`, or a thrown error when it is missing. */
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}

const NAMES: VerbNames = { capability: (id) => `cap:${id}`, lock: (id) => `lock:${id}` };

describe('inventory view models', () => {
  it('names items from their data, or a readable form of the id', () => {
    expect(itemName(def('healing-draught'))).toBe('Healing draught');
    expect(itemName(def('fixture-primer'))).toBe('Fixture primer');
    expect(CATEGORY_LABELS.book).toBe('Book');
    expect(slotLabel('main-hand')).toBe('Main hand');
    expect(slotLabel('trinket-2')).toBe('Trinket');
  });

  it('puts each category in its tab, and quest items in Quest & Artifacts too', () => {
    expect(itemTabs(def('arming-sword'))).toEqual(['arms']);
    expect(itemTabs(def('mail-hauberk'))).toEqual(['arms']);
    expect(itemTabs(def('lockpicks'))).toEqual(['tools']);
    expect(itemTabs(def('fixture-primer'))).toEqual(['books']);
    expect(itemTabs(def('healing-draught'))).toEqual(['consumables']);
    expect(itemTabs(def('testbed-closet-key'))).toEqual(['keys']);
    expect(
      itemTabs({ category: 'key', flags: { ...def('testbed-closet-key').flags, questItem: true } }),
    ).toEqual(['keys', 'quest']);
    expect(itemTabs({ category: 'currency', flags: def('fixture-gold').flags })).toEqual([]);
  });

  it('writes what an item lets you do as verbs, not numbers first', () => {
    expect(itemVerbs(def('healing-draught'), NAMES)).toEqual(['Restore health (30)']);
    expect(itemVerbs(def('oil-flask'), NAMES)).toEqual(['Throw (flammable, liquid)']);
    expect(itemVerbs(def('lockpicks'), NAMES)).toEqual(['cap:tool.lockpick while carried']);
    expect(itemVerbs(def('mail-hauberk'), NAMES)).toEqual(['Wear (8 kg while worn)']);
    expect(itemVerbs(def('arming-sword'), NAMES)).toEqual(['Wield in one hand']);
    expect(itemVerbs(def('shortbow'), NAMES)).toEqual(['Wield in both hands']);
    expect(itemVerbs(def('wooden-shield'), NAMES)).toEqual(['Block']);
    expect(itemVerbs(def('standard-arrow'), NAMES)).toEqual(['Shoot from a bow']);
    expect(itemVerbs(def('fixture-primer'), NAMES)).toEqual([
      'Read',
      'Study to learn cap:spell.fixture-bolt',
    ]);
    const primer = def('fixture-primer');
    if (primer.category !== 'book') throw new Error('fixture-primer is a book');
    const withTeaching = (
      teaches: Extract<ItemEntry, { category: 'book' }>['book']['teaches'],
    ): ItemEntry => ({
      ...primer,
      book: { ...primer.book, teaches },
    });
    expect(
      itemVerbs(withTeaching({ kind: 'insight', capability: 'tool.lockpick' }), NAMES),
    ).toEqual(['Read', 'Learn cap:tool.lockpick']);
    expect(itemVerbs(withTeaching({ kind: 'lore' }), NAMES)).toEqual(['Read']);
    expect(itemVerbs(def('testbed-closet-key'), NAMES)).toEqual(['Unlock: lock:testbed-closet']);
    expect(itemVerbs(def('fixture-gold'), NAMES)).toEqual([]);
    const base = def('healing-draught');
    const tonic = {
      ...base,
      use: [
        { op: 'status', status: 'warded', seconds: 5 },
        { op: 'coat', properties: { flammable: true }, seconds: 30 },
        { op: 'coat', properties: {}, seconds: 10 },
        { op: 'stat-step', pool: 'stamina', amount: 10 },
        { op: 'learn', capability: 'spell.ember' },
      ],
    } as unknown as ItemEntry;
    expect(itemVerbs(tonic, NAMES)).toEqual([
      'Warded for 5 s',
      'Coat your blade (flammable) for 30 s',
      'Coat your blade for 10 s',
      'Raise your maximum stamina for good',
      'Learn cap:spell.ember',
    ]);
    const stone = { ...def('oil-flask'), worldProperties: undefined } as unknown as ItemEntry;
    expect(itemVerbs(stone, NAMES)).toEqual(['Throw']);
    const master = {
      ...def('testbed-closet-key'),
      key: { opens: [], opensTag: 'tower', singleUse: false },
    } as unknown as ItemEntry;
    expect(itemVerbs(master, NAMES)).toEqual(['Unlock any tower lock']);
  });

  it('maps screen requests to sim actions and words refusals', () => {
    expect(requestAction({ action: 'use', itemId: 3 })).toEqual({ op: 'use', instanceId: 3 });
    expect(requestAction({ action: 'assign', itemId: 3, slot: 1 })).toEqual({
      op: 'assign',
      instanceId: 3,
      slot: 1,
    });
    expect(requestAction({ action: 'unassign', itemId: 3, slot: 2 })).toEqual({
      op: 'clear-slot',
      slot: 2,
    });
    expect(refusalText('no-drop', 'Key')).toMatch(/someone is counting on it/);
    expect(refusalText('no-view', 'Key')).toBe('Key: that didn’t work.');
  });

  it('AC-1: given items in 4 categories, the Books tab lists only books, newest first', () => {
    const { give, world, player, ui, inventoryUi } = game();
    give('fixture-primer');
    give('arming-sword');
    give('healing-draught', 2);
    give('fixture-primer');
    give('testbed-closet-key');
    inventoryUi.toggle();
    const screen = inventoryUi.controller?.screen;
    expect(screen?.listed.map((item) => item.name)).toEqual([
      'Closet key',
      'Fixture primer',
      'Healing draught',
      'Arming sword',
      'Fixture primer',
    ]);
    screen?.select('books');
    const ids = (inventoryOf(world, must(player))?.items ?? [])
      .filter((item) => item.defId === 'fixture-primer')
      .map((item) => item.instanceId)
      .reverse();
    expect(screen?.listed.map((item) => item.id)).toEqual(ids);
    expect(screen?.listed.every((item) => item.category === 'Book')).toBe(true);
    expect(
      [...(ui.top?.element.querySelectorAll<HTMLElement>('[data-item]') ?? [])].map((card) =>
        Number(card.dataset['item']),
      ),
    ).toEqual(ids);
  });

  it('AC-2: a stolen item’s card shows the marker and its tooltip names a known owner', () => {
    const { give, ui, inventoryUi } = game();
    give('healing-draught', 1, { stolen: true, ownerId: 'unaligned' });
    give('oil-flask', 1, { stolen: true, ownerId: 'harbour-guild' });
    give('arming-sword', 1, { stolen: true });
    inventoryUi.toggle();
    const cards = [...(ui.top?.element.querySelectorAll<HTMLElement>('[data-item]') ?? [])];
    expect(cards.every((card) => card.querySelector('[data-part="stolen"]') !== null)).toBe(true);
    const tip = ui.top?.element.querySelector<HTMLElement>('[data-testid="inventory-tooltip"]');
    const tipFor = (card: HTMLElement | undefined): string | null | undefined => {
      card?.focus();
      return tip?.hidden === true ? null : tip?.textContent;
    };
    expect(tipFor(cards[2])).toBe('Stolen from Unaligned'); // the faction's name
    expect(tipFor(cards[1])).toBe('Stolen from Harbour guild'); // unknown to content: readable id
    expect(tipFor(cards[0])).toBe('Stolen'); // no owner known
  });

  it('AC-3: with a gamepad only, confirm on a consumable opens Use/Assign/Drop, and each works', () => {
    const { give, world, player, ui, inventoryUi, step, published } = game();
    const hero = must(player);
    world.set(hero, HealthComponent, { max: 100, current: 50 });
    give('healing-draught', 3);
    give('arming-sword');
    const press = virtualPad(ui);
    inventoryUi.toggle();
    expect(published['inventory']).toBe('open');
    layout(ui);
    expect(focusedText()).toContain('Arming sword');
    press('right');
    expect(focusedText()).toContain('Healing draught');

    // Use: the draught heals and one is spent.
    press('a');
    layout(ui);
    const labels = [...(ui.top?.element.querySelectorAll('button') ?? [])].map(
      (b) => b.textContent,
    );
    expect(labels).toEqual(expect.arrayContaining(['Use', 'Assign to quick slot', 'Drop']));
    expect(focusedText()).toBe('Use');
    press('a');
    step();
    expect(world.get(hero, HealthComponent)?.current).toBe(80);
    expect(inventoryUi.controller?.screen?.listed[1]?.count).toBe(2);

    // Assign: to quick slot 2, through the slot picker.
    layout(ui);
    expect(focusedText()).toContain('Healing draught');
    press('a');
    layout(ui);
    press('down');
    expect(focusedText()).toBe('Assign to quick slot');
    press('a');
    layout(ui);
    press('down');
    expect(focusedText()).toBe('Slot 2: empty');
    press('a');
    step();
    expect(quickSlotsOf(world, hero)?.slots[1]?.defId).toBe('healing-draught');
    expect(JSON.parse(published['quickSlots'] ?? '[]')).toEqual([
      null,
      { label: 'Healing draught', count: 2 },
      null,
      null,
    ]);
    expect(
      inventoryUi.hud?.element.querySelector('[data-slot="1"]')?.getAttribute('aria-label'),
    ).toBe('Quick slot 2: Healing draught, 2');

    // Drop: the whole stack leaves the pack and lies in the world.
    layout(ui);
    press('a');
    layout(ui);
    const menu = [...(ui.top?.element.querySelectorAll('button') ?? [])].map((b) => b.textContent);
    for (let i = 0; i < menu.indexOf('Drop'); i++) press('down');
    expect(focusedText()).toBe('Drop');
    press('a');
    step();
    expect(inventoryOf(world, hero)?.items.map((i) => i.defId)).toEqual(['arming-sword']);
    let lying = 0;
    world.query(WorldItemComponent).forEach(() => (lying += 1));
    expect(lying).toBe(1);
    expect(inventoryUi.controller?.screen?.listed.map((i) => i.name)).toEqual(['Arming sword']);

    // B closes the screen.
    press('b');
    expect(ui.screens).toHaveLength(0);
    expect(published['inventory']).toBe('closed');
  });

  it('offers equip actions only with equipment, and says why a refused action failed', () => {
    const { give, world, player, ui, inventoryUi, step, queue } = game();
    const hero = must(player);
    give('arming-sword');
    give('testbed-closet-key');
    const views = new InventoryViews(
      content,
      prepareConsumables(content, prepareWorldItems(content)),
    );
    expect(views.model(world, hero).items.map((i) => i.actions)).toEqual([
      ['drop', 'throw'],
      ['drop', 'throw'],
    ]);
    addEquipment(world, hero, 'knight');
    world.step([]);
    const sword = views.model(world, hero).items[1];
    expect(sword?.actions).toEqual(['equip', 'drop', 'throw']);
    inventoryUi.toggle();
    const screen = inventoryUi.controller?.screen;
    // Equip through the screen: the card then says where it is.
    const swordCard = ui.top?.element.querySelector<HTMLElement>(
      `[data-item="${String(sword?.id)}"]`,
    );
    swordCard?.click();
    ui.top?.element.querySelector<HTMLElement>('[data-action="equip"]')?.click();
    expect(queue.every(isInventoryActionCommand)).toBe(true);
    step();
    expect(screen?.listed[1]?.equipped).toBe('Main hand');
    expect(screen?.listed[1]?.actions).toEqual(['unequip', 'drop', 'throw']);
    // A refusal reaches the status line (an action the screen never offers, sent anyway).
    queue.push({
      kind: 'item.inventoryAction',
      actor: hero,
      action: { op: 'assign', instanceId: sword?.id ?? 0, slot: 0 },
    });
    step();
    const status = ui.top?.element.querySelector('[data-testid="inventory-status"]');
    expect(status?.textContent).toBe('Only things you can use go in a quick slot.');
    queue.push({
      kind: 'item.inventoryAction',
      actor: hero,
      action: { op: 'drop', instanceId: 999 },
    });
    step();
    expect(status?.textContent).toBe('That: that didn’t work.');
    // Nothing changed: no refresh needed, and another screen open blocks the inventory.
    inventoryUi.toggle();
    expect(ui.screens).toHaveLength(0);
    ui.push({ id: 'other', label: 'Other', content: document.createElement('div') });
    inventoryUi.toggle();
    expect(ui.top?.id).toBe('other');
    expect(inventoryUi.controller?.open()).toBe(false);
  });

  it('Study on a spellbook runs a session in the sim, and the status line follows it (mw-e07.2)', () => {
    const registry = createCapabilityRegistry(content, true);
    const rules = createStudyRules(content, registry, createUnlockBook(content, registry));
    const { give, world, player, ui, inventoryUi, step } = game({ study: rules });
    const hero = must(player);
    installGameClock(world, DEFAULT_CLOCK_CONFIG);
    installStudy(world, rules);
    addStudent(world, hero);
    world.step([]);
    give('fixture-primer');
    give('testbed-closet-key');
    const views = new InventoryViews(
      content,
      prepareConsumables(content, prepareWorldItems(content)),
    );
    const [key, primer] = views.model(world, hero).items;
    expect(key?.actions).not.toContain('study');
    expect(primer?.actions).toEqual(['study', 'drop', 'throw']);
    inventoryUi.toggle();
    ui.top?.element.querySelector<HTMLElement>(`[data-item="${String(primer?.id)}"]`)?.click();
    ui.top?.element.querySelector<HTMLElement>('[data-action="study"]')?.click();
    step();
    const status = (): string | null | undefined =>
      ui.top?.element.querySelector('[data-testid="inventory-status"]')?.textContent;
    expect(status()).toBe('You settle down to study A Primer of Bolts.');
    for (let i = 0; i < 200; i++) step();
    expect(knowsSpell(world, hero, 'fixture-bolt')).toBe(true);
    expect(status()).toMatch(/^You have learned /);
    // Again: nothing to learn, and the screen says so.
    ui.top?.element.querySelector<HTMLElement>(`[data-item="${String(primer?.id)}"]`)?.click();
    ui.top?.element.querySelector<HTMLElement>('[data-action="study"]')?.click();
    step();
    step();
    expect(status()).toBe('You already know what A Primer of Bolts teaches.');
    // Someone else's study and learning is not the player's business.
    const other = world.spawn();
    world.events.emit(StudyStarted, { tick: 0, actor: other, book: 'fixture-primer', progress: 0 });
    world.events.emit(StudyEnded, {
      tick: 0,
      actor: other,
      book: 'fixture-primer',
      outcome: 'known',
      progress: 1,
    });
    world.events.emit(SpellLearned, { tick: 0, actor: other, spellId: 'x', source: 'y' });
    step();
    expect(status()).toBe('You already know what A Primer of Bolts teaches.');
  });

  it('says where a study session broke off, and words study refusals', () => {
    const registry = createCapabilityRegistry(content, true);
    const rules = createStudyRules(content, registry, createUnlockBook(content, registry));
    const { give, world, player, ui, inventoryUi, step } = game({ study: rules });
    const hero = must(player);
    installGameClock(world, DEFAULT_CLOCK_CONFIG);
    installStudy(world, rules);
    addStudent(world, hero);
    world.step([]);
    give('fixture-primer');
    inventoryUi.toggle();
    const primer = inventoryOf(world, hero)?.items[0]?.instanceId;
    const study = (): void => {
      ui.top?.element.querySelector<HTMLElement>(`[data-item="${String(primer)}"]`)?.click();
      ui.top?.element.querySelector<HTMLElement>('[data-action="study"]')?.click();
      step();
    };
    const status = (): string | null | undefined =>
      ui.top?.element.querySelector('[data-testid="inventory-status"]')?.textContent;
    study();
    for (let i = 0; i < 40; i++) step();
    rules.hurt(world, hero);
    step();
    expect(status()).toBe(STUDY_INTERRUPTIONS['hurt']);
    study();
    expect(status()).toBe('You pick up A Primer of Bolts where you left off.');
    rules.cancel(world, hero);
    step();
    expect(status()).toBe('You pick up A Primer of Bolts where you left off.'); // cancelling says nothing
    // An unlisted reason falls back to a plain line.
    world.events.emit(StudyEnded, {
      tick: 0,
      actor: hero,
      book: 'fixture-primer',
      outcome: 'interrupted',
      progress: 0.1,
    });
    step();
    expect(status()).toBe('You stop studying.');
    expect(refusalText('class', 'It')).toBe('The runes swim before your eyes.');
    expect(refusalText('prerequisite', 'It')).toMatch(/know enough/);
    expect(refusalText('unsafe', 'It')).toMatch(/danger/);
  });

  it('closes the open screen on an Inventory key (keyboard input is not sampled while it is open)', () => {
    const { ui, inventoryUi } = game({ closeKeys: ['KeyI'] });
    expect(inventoryUi.keydown({ code: 'KeyI', repeat: false })).toBe(false); // not open
    inventoryUi.toggle();
    expect(inventoryUi.keydown({ code: 'KeyJ', repeat: false })).toBe(false);
    expect(inventoryUi.keydown({ code: 'KeyI', repeat: true })).toBe(false);
    expect(ui.screens).toHaveLength(1);
    expect(inventoryUi.keydown({ code: 'KeyI', repeat: false })).toBe(true);
    expect(ui.screens).toHaveLength(0);
    // Without bound keys nothing closes it.
    const unbound = game();
    unbound.inventoryUi.toggle();
    expect(unbound.inventoryUi.keydown({ code: 'KeyI', repeat: false })).toBe(false);
  });

  it('the quick-slot strip follows the HUD scale; without a player only the actions install', () => {
    const { inventoryUi } = game();
    expect(inventoryUi.hud?.layout.scale).toBe(1.25);
    inventoryUi.setHudScale(2);
    expect(inventoryUi.hud?.layout.scale).toBe(2);
    inventoryUi.controller?.dispose();

    const headless = game({ player: false });
    expect(headless.inventoryUi.controller).toBeUndefined();
    expect(headless.inventoryUi.hud).toBeUndefined();
    headless.inventoryUi.toggle();
    headless.inventoryUi.afterStep();
    headless.inventoryUi.setHudScale(1);
    expect(headless.inventoryUi.keydown({ code: 'KeyI', repeat: false })).toBe(false);
    expect(headless.ui.screens).toHaveLength(0);
  });

  it('marks items that may not leave the pack, and reads names content lacks from their ids', () => {
    const { give, world, player } = game();
    give('fixture-bell-tongue');
    give('lockpicks');
    give('testbed-closet-key');
    const bare = {
      all: ((type: string) =>
        type === 'capability' || type === 'lock'
          ? []
          : content.all(type as 'item')) as typeof content.all,
    };
    const views = new InventoryViews(bare, prepareConsumables(content, prepareWorldItems(content)));
    const [key, picks, tongue] = views.model(world, must(player)).items;
    expect(tongue?.notes).toEqual(['Can’t be dropped.']);
    expect(tongue?.actions).toEqual([]);
    expect(tongue?.tabs).toEqual(['quest']);
    expect(picks?.verbs).toEqual(['Tool.lockpick while carried']);
    expect(key?.verbs).toEqual(['Unlock: Testbed closet']);
  });

  it('models an actor without an inventory or quick slots as empty', () => {
    const { world } = game({ player: false });
    const views = new InventoryViews(
      content,
      prepareConsumables(content, prepareWorldItems(content)),
    );
    const stranger = world.spawn();
    expect(views.model(world, stranger)).toEqual({
      gold: 0,
      items: [],
      quickSlots: [
        { label: '', count: 0 },
        { label: '', count: 0 },
        { label: '', count: 0 },
        { label: '', count: 0 },
      ],
    });
    expect(() => views.item('nope')).toThrow(/not defined/);
  });
});
