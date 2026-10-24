// The inventory screen and quick-slot HUD in the game (mw-e17.10): the glue between the sim's pack,
// quick slots and equipment, content's items, and the UI's inventory screen (src/ui/inventory.ts) and
// quick-slot strip (src/ui/quick-slots.ts).
//
// - `InventoryViews` derives the screen's and the strip's view models from the sim: stacks newest
//   first (acquisition order, reversed), each with its display name and flavour text (item data's
//   `name` and `description`, or a readable form of the id), its tabs, its verbs (what its data lets
//   you do, written as verbs), its stolen owner, where it is equipped, its quick slot and the actions
//   its rules allow.
// - `requestAction` turns the player's choice into the sim's inventory action; the game submits it
//   as a command (`inventoryActionCommand`), so the screen never changes sim state and every action
//   is in the replay. `refusalText` words a refused one for the screen's status line.
// - `InventoryScreenController` opens and closes the screen (the Inventory action, I or View, toggles
//   it), submits actions, refreshes the open screen after every sim step whose pack changed, and says
//   why an action was refused.

import type { GameContent, ItemCategory, ItemEntry } from '@content/index';
import {
  EQUIPMENT_SLOTS,
  equipmentOf,
  EquipmentRules,
  installInventoryActions,
  inventoryActionCommand,
  InventoryActions,
  inventoryActionDone,
  inventoryOf,
  QUICK_SLOT_COUNT,
  quickSlotsOf,
  SpellLearned,
  ScrollRead,
  StudyEnded,
  StudyStarted,
  type Consumables,
  type EntityId,
  type EquipmentSlot,
  type InventoryAction,
  type ItemGiver,
  type InventoryActionCommand,
  type InventoryActionRefusal,
  type ScrollRules,
  type StudyRules,
  type World,
} from '@sim/index';
import {
  openInventory,
  QuickSlotHud,
  type Inventory,
  type InventoryActionId,
  type InventoryItemModel,
  type InventoryModel,
  type InventoryRequest,
  type InventoryTabId,
  type ItemIconKind,
  type QuickSlotModel,
  type UiRoot,
} from '@ui/index';
import { itemLabel } from '../classes';
import type { ScrollAim } from './scroll-read';

/** The content an inventory view reads. */
export type InventoryContent = Pick<GameContent, 'all'>;

/** An item's display name: its data's `name`, else a readable form of its id. */
export function itemName(item: Pick<ItemEntry, 'id' | 'name'>): string {
  return item.name ?? itemLabel(item.id);
}

/** Category → display name. */
export const CATEGORY_LABELS: Readonly<Record<ItemCategory, string>> = Object.freeze({
  weapon: 'Weapon',
  armor: 'Armor',
  shield: 'Shield',
  ammo: 'Ammunition',
  book: 'Book',
  key: 'Key',
  consumable: 'Consumable',
  tool: 'Tool',
  quest: 'Quest item',
  artifact: 'Artifact',
  currency: 'Currency',
  misc: 'Miscellany',
});

const CATEGORY_TAB: Readonly<Record<ItemCategory, InventoryTabId | undefined>> = Object.freeze({
  weapon: 'arms',
  armor: 'arms',
  shield: 'arms',
  ammo: 'arms',
  book: 'books',
  key: 'keys',
  consumable: 'consumables',
  tool: 'tools',
  misc: 'tools',
  quest: 'quest',
  artifact: 'quest',
  currency: undefined,
});

/** The tabs besides All that list `item`: its category's, and Quest & Artifacts for a quest item. */
export function itemTabs(item: Pick<ItemEntry, 'category' | 'flags'>): InventoryTabId[] {
  const tabs = new Set<InventoryTabId>();
  const tab = CATEGORY_TAB[item.category];
  if (tab !== undefined) tabs.add(tab);
  if (item.flags.questItem) tabs.add('quest');
  return [...tabs];
}

/** "main-hand" → "Main hand". */
export const slotLabel = (slot: EquipmentSlot): string => itemLabel(slot.replace(/-\d$/, ''));

/** Names the verbs need: capabilities, locks. */
export interface VerbNames {
  capability(id: string): string;
  lock(id: string): string;
}

const enabledProperties = (properties: object): string[] =>
  Object.entries(properties)
    .filter(([key, value]) => value === true && key !== 'material')
    .map(([key]) => key);

/**
 * What `item` lets you do, as verbs, from its data (never numbers first): "Restore health (30)",
 * "Throw (flammable, liquid)", "Pick Locks while carried", "Wear (8 kg while worn)".
 */
export function itemVerbs(item: ItemEntry, names: VerbNames): string[] {
  const verbs: string[] = [];
  for (const effect of item.use ?? []) {
    switch (effect.op) {
      case 'restore':
        verbs.push(`Restore ${effect.pool} (${String(effect.amount)})`);
        break;
      case 'stat-step':
        verbs.push(`Raise your maximum ${effect.pool} for good`);
        break;
      case 'learn':
        verbs.push(`Learn ${names.capability(effect.capability)}`);
        break;
      case 'status':
        verbs.push(`${itemLabel(effect.status)} for ${String(effect.seconds)} s`);
        break;
      case 'coat': {
        const props = enabledProperties(effect.properties);
        verbs.push(
          `Coat your blade${props.length > 0 ? ` (${props.join(', ')})` : ''} for ${String(effect.seconds)} s`,
        );
        break;
      }
      case 'throw': {
        const props = enabledProperties(item.worldProperties ?? {});
        verbs.push(`Throw${props.length > 0 ? ` (${props.join(', ')})` : ''}`);
        break;
      }
    }
  }
  switch (item.category) {
    case 'weapon':
      verbs.push(item.equip.slot === 'both-hands' ? 'Wield in both hands' : 'Wield in one hand');
      break;
    case 'shield':
      verbs.push('Block');
      break;
    case 'armor':
      verbs.push(`Wear (${String(item.armor.weightKg)} kg while worn)`);
      break;
    case 'ammo':
      verbs.push('Shoot from a bow');
      break;
    case 'book':
      verbs.push('Read');
      if (item.book.teaches.kind === 'spell') {
        verbs.push(`Study to learn ${names.capability(`spell.${item.book.teaches.spell.id}`)}`);
      } else if (item.book.teaches.kind === 'insight') {
        verbs.push(`Learn ${names.capability(item.book.teaches.capability)}`);
      }
      break;
    case 'key':
      verbs.push(
        ...item.key.opens.map((id) => `Unlock: ${names.lock(id)}`),
        ...(item.key.opensTag === undefined ? [] : [`Unlock any ${item.key.opensTag} lock`]),
      );
      break;
    default:
      break;
  }
  for (const grant of item.grants) {
    verbs.push(`${names.capability(grant.capability)} while ${grant.while}`);
  }
  return verbs;
}

/** The sim action a screen request asks for. */
export function requestAction(request: InventoryRequest): InventoryAction {
  switch (request.action) {
    case 'assign':
      return { op: 'assign', instanceId: request.itemId, slot: request.slot };
    case 'unassign':
      return { op: 'clear-slot', slot: request.slot };
    default:
      return { op: request.action, instanceId: request.itemId };
  }
}

const REFUSALS: Readonly<Partial<Record<InventoryActionRefusal, string>>> = Object.freeze({
  'no-drop': 'You can’t let go of that: someone is counting on it.',
  busy: 'Not now: your hands are busy.',
  'no-weapon': 'You need a weapon in hand to coat.',
  'not-usable': 'That isn’t something you can use.',
  'not-readable': 'There is nothing here you can read aloud.',
  fizzled: 'The scroll’s magic fizzles. It is not used up.',
  'not-assignable': 'Only things you can use go in a quick slot.',
  'not-equippable': 'That isn’t something you can equip.',
  'no-equipment': 'You can’t equip anything yet.',
  class: 'The runes swim before your eyes.',
  prerequisite: 'You don’t yet know enough to follow it.',
  unsafe: 'Not with danger so close.',
});

/** Why a study session broke off (`StudyEnded.reason`), as the status line says it. */
export const STUDY_INTERRUPTIONS: Readonly<Record<string, string>> = Object.freeze({
  threat: 'Something close by is stirring. You break off your studies.',
  hurt: 'Pain breaks your concentration.',
  moved: 'You lose your place when you move.',
  'book-gone': 'The book is gone.',
  prerequisite: 'The pages no longer make sense to you.',
  'no-clock': 'You cannot settle to it.',
});

/** The status line for a refused action on `name`. */
export function refusalText(reason: InventoryActionRefusal, name: string): string {
  return REFUSALS[reason] ?? `${name}: that didn’t work.`;
}

/** Category → placeholder icon. */
export const ICON_KIND: Readonly<Record<ItemCategory, ItemIconKind>> = Object.freeze({
  weapon: 'weapon',
  armor: 'armor',
  shield: 'shield',
  ammo: 'ammo',
  book: 'book',
  key: 'key',
  consumable: 'consumable',
  tool: 'tool',
  quest: 'quest',
  artifact: 'artifact',
  currency: 'currency',
  misc: 'misc',
});

/** Derives the inventory screen's and quick-slot strip's view models from the sim. */
export class InventoryViews {
  readonly #items: ReadonlyMap<string, ItemEntry>;
  readonly #names: VerbNames;
  readonly #owners: ReadonlyMap<string, string>;
  readonly #consumables: Consumables;

  constructor(content: InventoryContent, consumables: Consumables) {
    this.#items = new Map(content.all('item').map((item) => [item.id, item]));
    const capabilities = new Map(
      content
        .all('capability')
        .flatMap((group) => group.capabilities.map((c) => [c.id, c.name] as const)),
    );
    const locks = new Map(content.all('lock').map((lock) => [lock.id, lock.name] as const));
    this.#names = {
      capability: (id) => capabilities.get(id) ?? itemLabel(id),
      lock: (id) => locks.get(id) ?? itemLabel(id),
    };
    this.#owners = new Map(content.all('faction').map((f) => [f.id, f.name] as const));
    this.#consumables = consumables;
  }

  /** The item definition `defId`. @throws RangeError for an unknown id. */
  item(defId: string): ItemEntry {
    const item = this.#items.get(defId);
    if (item === undefined) throw new RangeError(`item "${defId}" is not defined`);
    return item;
  }

  /** A capability's display name (a spell's, for `spell.<id>`). */
  capabilityName(id: string): string {
    return this.#names.capability(id);
  }

  /** A stolen item's owner, by name when content knows them. */
  owner(ownerId: string): string {
    return this.#owners.get(ownerId) ?? itemLabel(ownerId);
  }

  /** The inventory screen's model for `actor` (empty without an inventory). */
  /** The spell the scroll `instanceId` in `actor`'s pack casts, or undefined for anything else. */
  scrollSpell(world: World<never>, actor: EntityId, instanceId: number): string | undefined {
    const defId = inventoryOf(world, actor)?.items.find(
      (item) => item.instanceId === instanceId,
    )?.defId;
    const item = defId === undefined ? undefined : this.item(defId);
    return item?.category === 'book' ? item.book.casts?.id : undefined;
  }

  model(world: World<never>, actor: EntityId): InventoryModel {
    const pack = inventoryOf(world, actor);
    const slots = quickSlotsOf(world, actor)?.slots ?? [];
    const equipment = equipmentOf(world, actor);
    const equippedAt = new Map<number, EquipmentSlot>();
    for (const slot of EQUIPMENT_SLOTS) {
      const ref = equipment?.slots[slot];
      if (ref != null && !equippedAt.has(ref.instanceId)) equippedAt.set(ref.instanceId, slot);
    }
    const items = [...(pack?.items ?? [])].reverse().map((instance): InventoryItemModel => {
      const item = this.item(instance.defId);
      const slot = slots.findIndex((s) => s?.instanceId === instance.instanceId);
      const equippedSlot = equippedAt.get(instance.instanceId);
      const usable = this.#consumables.usable(this.#consumables.def(item.id));
      const equippable =
        equipment !== undefined &&
        (('equip' in item && item.equip !== undefined) || item.category === 'ammo');
      const actions: InventoryActionId[] = [];
      if (usable) actions.push('use', 'assign');
      if (item.category === 'book' && item.book.teaches.kind === 'spell') actions.push('study');
      if (
        item.category === 'book' &&
        item.book.kind === 'scroll' &&
        item.book.casts !== undefined
      ) {
        actions.push('read');
      }
      if (slot !== -1) actions.push('unassign');
      if (equippable) actions.push(equippedSlot === undefined ? 'equip' : 'unequip');
      if (!item.flags.noDrop) actions.push('drop', 'throw');
      const { stolen, ownerId } = instance.flags;
      return {
        id: instance.instanceId,
        name: itemName(item),
        description: item.description ?? '',
        category: CATEGORY_LABELS[item.category],
        icon: ICON_KIND[item.category],
        tabs: itemTabs(item),
        count: instance.count,
        value: item.value,
        stolen: stolen === true,
        ...(ownerId !== undefined && { owner: this.owner(ownerId) }),
        verbs: itemVerbs(item, this.#names),
        ...(equippedSlot !== undefined && { equipped: slotLabel(equippedSlot) }),
        ...(slot !== -1 && { quickSlot: slot }),
        ...(item.flags.noDrop && { notes: ['Can’t be dropped.'] }),
        actions,
      };
    });
    return {
      gold: pack?.gold ?? 0,
      items,
      quickSlots: this.quickSlots(world, actor).map(({ label, count }) => ({ label, count })),
    };
  }

  /** The quick-slot strip's model for `actor`: four slots, empty without quick slots. */
  quickSlots(world: World<never>, actor: EntityId): QuickSlotModel[] {
    const slots = quickSlotsOf(world, actor)?.slots;
    return Array.from({ length: QUICK_SLOT_COUNT }, (_, i) => {
      const view = slots === undefined ? null : this.#consumables.slotView(world, actor, i);
      if (view === null) return { label: '', icon: null, count: 0 };
      const item = this.item(view.defId);
      return { label: itemName(item), icon: ICON_KIND[item.category], count: view.count };
    });
  }
}

export interface InventoryScreenOptions {
  readonly ui: UiRoot;
  readonly world: World<never>;
  readonly player: EntityId;
  readonly views: InventoryViews;
  /** Queues a sim command for the next step. */
  readonly submit: (command: InventoryActionCommand) => void;
  /** The screen opened or closed. */
  readonly onChange?: (open: boolean) => void;
  /** Aims a scroll's spell from the current view (mw-ju8.17); without it a scroll cannot be read. */
  readonly scrollAim?: (spellId: string | undefined) => ScrollAim | undefined;
}

/**
 * Opens, refreshes and closes the inventory screen for the player. Call `afterStep` after every sim
 * step; `toggle` on the Inventory action.
 */
export class InventoryScreenController {
  readonly #options: InventoryScreenOptions;
  #screen: Inventory | undefined;
  #shown = '';
  readonly #off: () => void;
  readonly #offStudy: readonly (() => void)[];

  constructor(options: InventoryScreenOptions) {
    this.#options = options;
    this.#off = options.world.events.on(inventoryActionDone, (done) => {
      if (done.actor !== options.player || done.ok || done.reason === undefined) return;
      const name = done.defId === null ? 'That' : itemName(options.views.item(done.defId));
      this.#screen?.say(refusalText(done.reason, name));
    });
    // Studying runs in the sim while the screen stays open; its status line follows the session.
    const events = options.world.events;
    const book = (id: string): string => {
      const item = options.views.item(id);
      return item.category === 'book' ? item.book.title : itemName(item);
    };
    this.#offStudy = [
      events.on(StudyStarted, (e) => {
        if (e.actor !== options.player) return;
        const name = book(e.book);
        this.#screen?.say(
          e.progress > 0
            ? `You pick up ${name} where you left off.`
            : `You settle down to study ${name}.`,
        );
      }),
      events.on(StudyEnded, (e) => {
        if (e.actor !== options.player || e.outcome === 'learned' || e.outcome === 'cancelled') {
          return;
        }
        this.#screen?.say(
          e.outcome === 'known'
            ? `You already know what ${book(e.book)} teaches.`
            : (STUDY_INTERRUPTIONS[e.reason ?? ''] ?? 'You stop studying.'),
        );
      }),
      events.on(ScrollRead, (e) => {
        if (e.actor !== options.player) return;
        this.#screen?.say(
          `The ${itemName(options.views.item(e.scroll))} flares and crumbles to ash.`,
        );
      }),
      events.on(SpellLearned, (e) => {
        if (e.actor !== options.player) return;
        this.#screen?.say(
          `You have learned ${options.views.capabilityName(`spell.${e.spellId}`)}.`,
        );
      }),
    ];
  }

  /** The open screen, if any. */
  get screen(): Inventory | undefined {
    return this.#screen;
  }

  get isOpen(): boolean {
    return this.#screen !== undefined;
  }

  /** Opens the screen (unless it is open, or another screen is). Returns whether it opened. */
  open(): boolean {
    const { ui, world, player, views, submit } = this.#options;
    if (this.#screen !== undefined || ui.top !== undefined) return false;
    const model = views.model(world, player);
    this.#shown = JSON.stringify(model);
    this.#screen = openInventory(ui, {
      model,
      onAction: (request) => {
        const action = requestAction(request);
        if (action.op === 'read') {
          const read = this.#aimRead(action);
          if (read === undefined) return;
          submit(inventoryActionCommand(player, read));
          return;
        }
        submit(inventoryActionCommand(player, action));
      },
      onClose: () => {
        this.#screen = undefined;
        this.#options.onChange?.(false);
      },
    });
    this.#options.onChange?.(true);
    return true;
  }

  /** A read action with its aim, or undefined (and a word on the status line) when it cannot be aimed. */
  #aimRead(action: InventoryAction & { readonly op: 'read' }): InventoryAction | undefined {
    const { world, player, views, scrollAim } = this.#options;
    const spell = views.scrollSpell(world, player, action.instanceId);
    const aim = scrollAim?.(spell);
    if (aim?.valid !== true) {
      this.#screen?.say(aim === undefined ? 'You cannot read that now.' : aim.text);
      return undefined;
    }
    return { ...action, aim: aim.aim, ...(aim.target !== undefined && { target: aim.target }) };
  }

  /** Closes the screen (and its menus). */
  close(): void {
    this.#screen?.close();
  }

  /** Opens the screen when closed, closes it when open. */
  toggle(): void {
    if (this.#screen === undefined) this.open();
    else this.close();
  }

  /** Refreshes the open screen when what it shows changed. */
  afterStep(): void {
    const screen = this.#screen;
    if (screen === undefined) return;
    const model = this.#options.views.model(this.#options.world, this.#options.player);
    const json = JSON.stringify(model);
    if (json === this.#shown) return;
    this.#shown = json;
    screen.update(model);
  }

  /** Stops listening and closes the screen. */
  dispose(): void {
    this.#off();
    for (const off of this.#offStudy) off();
    this.close();
  }
}

export interface InventoryUiOptions<T> {
  readonly ui: UiRoot;
  readonly world: World<T>;
  readonly content: InventoryContent;
  readonly consumables: Consumables;
  /** The study rules (mw-e07.2): without them the Study action is refused. */
  readonly study?: StudyRules;
  /** The scroll rules (mw-ju8.17): without them Read is refused. */
  readonly scrolls?: ScrollRules;
  /** The console's `give` (item catalogue and pack rules). */
  readonly giver?: ItemGiver;
  /** Aims a scroll's spell from the current view; without it a scroll cannot be read. */
  readonly scrollAim?: (spellId: string | undefined) => ScrollAim | undefined;
  /** The player; without one only the action system is installed. */
  readonly player: EntityId | undefined;
  /** Queues a sim command for the next step. */
  readonly submit: (command: InventoryActionCommand) => void;
  /** The HUD scale setting (accessibility.hudScale) at start. */
  readonly hudScale: number;
  /** Publishes a readout for the e2e: `inventory` ("open"/"closed") and `quickSlots` (JSON). */
  readonly publish?: (key: 'inventory' | 'quickSlots', value: string) => void;
  /**
   * The keyboard codes bound to the Inventory action (the sampler's bindings). Keyboard gameplay input
   * only counts under pointer lock, which an open menu releases, so the open screen listens for them
   * itself (`keydown`) to close on the same key.
   */
  readonly closeKeys?: () => readonly string[];
}

/** The inventory UI in a running game. */
export interface InventoryUi {
  readonly controller: InventoryScreenController | undefined;
  readonly hud: QuickSlotHud | undefined;
  /** Opens or closes the inventory (the Inventory action). */
  toggle(): void;
  /** Call after every sim step: refreshes the open screen and the quick-slot strip. */
  afterStep(): void;
  /** Applies a new HUD scale to the quick-slot strip. */
  setHudScale(scale: number): void;
  /** A key went down: closes the open screen on an Inventory key. Returns whether it did. */
  keydown(event: { readonly code: string; readonly repeat: boolean }): boolean;
}

/**
 * Installs the inventory action system in `world` (after consumables and world items) and, when there
 * is a player, puts the quick-slot strip in the HUD and readies the inventory screen.
 */
export function startInventoryUi<T>(options: InventoryUiOptions<T>): InventoryUi {
  const { ui, content, consumables, player, submit, publish } = options;
  const world = options.world as unknown as World<never>;
  const equipment = new EquipmentRules(content.all('item'), content.all('class'));
  installInventoryActions(
    options.world,
    new InventoryActions({
      consumables,
      equipment,
      ...(options.study !== undefined && { study: options.study }),
      ...(options.scrolls !== undefined && { scrolls: options.scrolls }),
      ...(options.giver !== undefined && { giver: options.giver }),
    }),
  );
  if (player === undefined) {
    return {
      controller: undefined,
      hud: undefined,
      toggle: () => undefined,
      afterStep: () => undefined,
      setHudScale: () => undefined,
      keydown: () => false,
    };
  }
  const views = new InventoryViews(content, consumables);
  const controller = new InventoryScreenController({
    ui,
    world,
    player,
    views,
    submit,
    ...(options.scrollAim !== undefined && { scrollAim: options.scrollAim }),
    onChange: (open) => publish?.('inventory', open ? 'open' : 'closed'),
  });
  const hud = new QuickSlotHud({ scale: options.hudScale });
  ui.hud.append(hud.element);
  let published = '';
  const afterStep = (): void => {
    controller.afterStep();
    const slots = views.quickSlots(world, player);
    hud.update(slots);
    const json = JSON.stringify(
      slots.map(({ label, count }) => (label === '' ? null : { label, count })),
    );
    if (json !== published) publish?.('quickSlots', (published = json));
  };
  publish?.('inventory', 'closed');
  afterStep();
  return {
    controller,
    hud,
    toggle: () => {
      controller.toggle();
    },
    afterStep,
    setHudScale: (scale) => {
      hud.setScale(scale);
    },
    keydown: ({ code, repeat }) => {
      if (repeat || !controller.isOpen || !(options.closeKeys?.() ?? []).includes(code)) {
        return false;
      }
      controller.close();
      return true;
    },
  };
}
