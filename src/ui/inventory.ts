// The inventory screen (mw-e17.10): everything the player carries, by category, with an inspect card
// and a context menu of actions, so managing gear takes seconds. Grey-box styling on the kit's tokens:
// the inventory panel frame, quick-slot frame and item icons are asset beads (mw-e37.117 and the icon
// integration beads); until then each category has a flat placeholder glyph (item-icons.ts).
//
// - Tabs: All, Weapons & Armor, Tools, Consumables, Books, Keys, Quest & Artifacts. Q/E, PageUp/
//   PageDown or LB/RB switch them from anywhere; the model says which tabs list each item.
// - Grid: item cards in the order the model gives (the game sorts newest first). A listbox with a
//   roving tabindex, so it is one Tab stop: directions move between cards (spatially, so any column
//   count works) and hand focus back at the grid's edges. A card shows the icon, name, count, and
//   badges for stolen, equipped and quick slot; a stolen card's tooltip names the owner.
// - Inspect card: the focused item's name, category, value, flavour text and what it lets you do,
//   written as verbs ("Restore health (30)"), never a stat block.
// - Actions: confirm or a click on a card opens its context menu (a modal screen): Use, Assign to
//   quick slot, Equip, Drop… as the model lists them. Assign opens a slot picker. A chosen action is
//   reported through `onAction`; the screen never changes game state, and the game answers with a new
//   model (`update`) once the sim has done it.
// - Empty: an empty pack shows a message instead of the grid, and so does an empty tab.
//
// The screen pauses the sim and captures input; Back closes the menu on top, then the screen. Every
// size is in em, so the whole screen follows the text-size setting, and names wrap rather than clip.

import { button } from './components/controls';
import { h, uid } from './components/dom';
import { tabs, type Tabs } from './components/tabs';
import { isDirection } from './input';
import { itemIcon, type ItemIconKind } from './item-icons';
import { onIntent, type Screen, type UiRoot } from './screens';
import { spatialPick } from './focus';

/** `data-screen` of the inventory and its two menus. */
export const INVENTORY_SCREEN = 'inventory';
export const INVENTORY_MENU_SCREEN = 'inventory-actions';
export const INVENTORY_ASSIGN_SCREEN = 'inventory-assign';

/** The tabs, in order. */
export const INVENTORY_TABS = [
  { id: 'all', label: 'All', empty: 'Nothing here yet.' },
  { id: 'arms', label: 'Weapons & Armor', empty: 'No weapons or armor.' },
  { id: 'tools', label: 'Tools', empty: 'No tools.' },
  { id: 'consumables', label: 'Consumables', empty: 'No potions, oils or other consumables.' },
  { id: 'books', label: 'Books', empty: 'No books.' },
  { id: 'keys', label: 'Keys', empty: 'No keys.' },
  { id: 'quest', label: 'Quest & Artifacts', empty: 'No quest items or artifacts.' },
] as const;
export type InventoryTabId = (typeof INVENTORY_TABS)[number]['id'];

/** What can be done to an item from its context menu. */
export type InventoryActionId =
  'use' | 'study' | 'assign' | 'unassign' | 'equip' | 'unequip' | 'drop' | 'throw';

/** Each action's menu label. */
export const INVENTORY_ACTION_LABELS: Readonly<Record<InventoryActionId, string>> = Object.freeze({
  use: 'Use',
  study: 'Study',
  assign: 'Assign to quick slot',
  unassign: 'Remove from quick slot',
  equip: 'Equip',
  unequip: 'Unequip',
  drop: 'Drop',
  throw: 'Throw',
});

/** One stack, as the screen shows it. */
export interface InventoryItemModel {
  /** Stable while the stack exists (the inventory instance id). */
  readonly id: number;
  readonly name: string;
  /** Flavour text; empty for none. */
  readonly description: string;
  /** The category's display name, e.g. "Consumable". */
  readonly category: string;
  readonly icon: ItemIconKind;
  /** The tabs besides All that list it. */
  readonly tabs: readonly InventoryTabId[];
  readonly count: number;
  /** Base value in gold. */
  readonly value: number;
  readonly stolen: boolean;
  /** Whose it was, when known (a stolen item's tooltip names them). */
  readonly owner?: string;
  /** What it lets you do, as verbs, e.g. "Restore health (30)". */
  readonly verbs: readonly string[];
  /** Where it is equipped ("Main hand"), when it is. */
  readonly equipped?: string;
  /** The quick slot holding it (0-based), when one does. */
  readonly quickSlot?: number;
  /** Extra lines for the inspect card ("Can't be dropped"). */
  readonly notes?: readonly string[];
  /** Its context menu, in order. */
  readonly actions: readonly InventoryActionId[];
}

/** One quick slot, as the slot picker shows it. */
export interface InventorySlotModel {
  /** The item's name, or empty for an empty slot. */
  readonly label: string;
  readonly count: number;
}

/** What the inventory screen shows. */
export interface InventoryModel {
  readonly gold: number;
  /** Every stack, in display order (newest first). */
  readonly items: readonly InventoryItemModel[];
  readonly quickSlots: readonly InventorySlotModel[];
}

/** An action the player chose. */
export type InventoryRequest =
  | {
      readonly action: Exclude<InventoryActionId, 'assign' | 'unassign'>;
      readonly itemId: number;
    }
  | { readonly action: 'assign' | 'unassign'; readonly itemId: number; readonly slot: number };

export interface InventoryOptions {
  readonly model: InventoryModel;
  /** The player chose an action (the menus have closed). */
  readonly onAction: (request: InventoryRequest) => void;
  /** The screen closed. */
  readonly onClose?: () => void;
  /** The tab to open on (default All). */
  readonly tab?: InventoryTabId;
}

export interface Inventory {
  readonly screen: Screen;
  /** The selected tab. */
  readonly tab: InventoryTabId;
  /** The focused (inspected) item's id, if any. */
  readonly active: number | undefined;
  /** The items the selected tab lists, in order. */
  readonly listed: readonly InventoryItemModel[];
  /** Shows a new model, keeping the tab, the inspected item and focus where they can be kept. */
  update(model: InventoryModel): void;
  /** Says something on the status line (a refused action). */
  say(text: string): void;
  /** Selects a tab. */
  select(tab: InventoryTabId): void;
  /** Closes the screen and any menu open over it. */
  close(): void;
}

export const INVENTORY_TEXT = Object.freeze({
  heading: 'Inventory',
  tabs: 'Item categories',
  items: 'Items',
  details: 'Item details',
  verbs: 'Lets you',
  empty: 'Your pack is empty. Whatever you pick up on your travels ends up here.',
  cancel: 'Cancel',
  slots: 'Quick slots',
  hint: 'Confirm an item for its actions. Q/E or LB/RB switch tabs.',
});

/** Each tab's empty-state line. */
const TAB_EMPTY = Object.fromEntries(INVENTORY_TABS.map((tab) => [tab.id, tab.empty])) as Readonly<
  Record<InventoryTabId, string>
>;

/** "123 gold". */
export const goldText = (gold: number): string => `${String(gold)} gold`;

/** "Stolen from the Warden", or "Stolen" when the owner is unknown. */
export const stolenText = (owner: string | undefined): string =>
  owner === undefined ? 'Stolen' : `Stolen from ${owner}`;

/** "Quick slot 2". */
export const slotText = (slot: number): string => `Quick slot ${String(slot + 1)}`;

/** A card's accessible name: name, count and its badges. */
export function cardLabel(item: InventoryItemModel): string {
  const parts = [item.name];
  if (item.count > 1) parts.push(String(item.count));
  if (item.stolen) parts.push('stolen');
  if (item.equipped !== undefined) parts.push('equipped');
  if (item.quickSlot !== undefined) parts.push(slotText(item.quickSlot).toLowerCase());
  return parts.join(', ');
}

/** The items tab `tab` lists, in model order. */
export function itemsInTab(
  model: InventoryModel,
  tab: InventoryTabId,
): readonly InventoryItemModel[] {
  return tab === 'all' ? model.items : model.items.filter((item) => item.tabs.includes(tab));
}

/** A slot picker line: "Slot 2: Healing draught ×3" or "Slot 1: empty". */
export function slotChoiceText(slot: number, model: InventorySlotModel | undefined): string {
  const name = `Slot ${String(slot + 1)}`;
  if (model === undefined || model.label === '') return `${name}: empty`;
  return `${name}: ${model.label}${model.count > 1 ? ` ×${String(model.count)}` : ''}`;
}

/** Opens the inventory screen on `ui`. */
export function openInventory(ui: UiRoot, options: InventoryOptions): Inventory {
  let model = options.model;
  let tabId: InventoryTabId = options.tab ?? 'all';
  let activeId: number | undefined;
  let listed: readonly InventoryItemModel[] = [];
  let cards: HTMLElement[] = [];
  const menus: Screen[] = [];

  const gold = h('p', { className: 'vb-inventory-gold', data: { part: 'gold' } });
  const status = h('p', {
    className: 'vb-inventory-status',
    attrs: { role: 'status' },
    data: { testid: 'inventory-status' },
  });
  const grid = h('div', {
    className: 'vb-inventory-grid',
    attrs: { role: 'listbox', 'aria-label': INVENTORY_TEXT.items },
    data: { testid: 'inventory-grid', uiComponent: 'item-grid' },
  });
  const empty = h('p', { className: 'vb-inventory-empty', data: { testid: 'inventory-empty' } });
  // One tooltip for the grid, outside the listbox (a listbox owns only options): it names a stolen
  // card's owner while that card has focus or the pointer.
  const tooltip = h('div', {
    className: 'vb-tooltip',
    attrs: { role: 'tooltip', id: uid('vb-item-tip') },
    data: { testid: 'inventory-tooltip' },
  });
  tooltip.hidden = true;
  const details = h('aside', {
    className: 'vb-item-details vb-stack',
    attrs: { 'aria-label': INVENTORY_TEXT.details },
    data: { testid: 'item-details' },
  });
  const items = h('div', { className: 'vb-inventory-items' }, grid, empty, tooltip);
  const body = h('div', { className: 'vb-inventory-body' }, items, details);
  const panels = INVENTORY_TABS.map((tab) =>
    h('div', { className: 'vb-inventory-panel', data: { panel: tab.id } }),
  );
  const strip: Tabs = tabs({
    label: INVENTORY_TEXT.tabs,
    tabs: INVENTORY_TABS.map((tab, i) => ({
      id: tab.id,
      label: tab.label,
      panel: panels[i] as HTMLElement,
    })),
    selected: tabId,
    onChange: (id) => {
      const hadFocus = grid.contains(document.activeElement);
      tabId = id as InventoryTabId;
      render(hadFocus);
      // Switching tabs with focus on a card (LB/RB) keeps focus in the grid, or on the tab when the
      // new tab is empty.
      if (hadFocus && cards.length === 0) focusSelectedTab();
    },
  });

  const content = h(
    'div',
    { className: 'vb-panel vb-stack vb-inventory', data: { testid: 'inventory' } },
    h('div', { className: 'vb-inventory-head' }, h('h1', { text: INVENTORY_TEXT.heading }), gold),
    strip.element,
    h('p', { className: 'vb-inventory-hint', text: INVENTORY_TEXT.hint }),
    status,
  );

  function focusSelectedTab(): void {
    strip.element.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
  }

  function renderDetails(item: InventoryItemModel | undefined): void {
    details.hidden = item === undefined;
    if (item === undefined) {
      details.replaceChildren();
      return;
    }
    const lines: HTMLElement[] = [
      h(
        'div',
        { className: 'vb-item-details-head' },
        itemIcon(item.icon, 'vb-icon vb-icon-large'),
        h('h2', { text: item.name, data: { part: 'name' } }),
      ),
      h(
        'p',
        { className: 'vb-item-meta', data: { part: 'meta' } },
        `${item.category} · `,
        itemIcon('currency'),
        ` ${goldText(item.value)}`,
      ),
    ];
    if (item.count > 1) lines.push(h('p', { text: `${String(item.count)} carried` }));
    if (item.stolen) {
      lines.push(
        h(
          'p',
          { className: 'vb-item-stolen', data: { part: 'stolen' } },
          itemIcon('stolen'),
          ` ${stolenText(item.owner)}`,
        ),
      );
    }
    if (item.equipped !== undefined) {
      lines.push(h('p', { text: `Equipped: ${item.equipped}`, data: { part: 'equipped' } }));
    }
    if (item.quickSlot !== undefined) {
      lines.push(h('p', { text: `In ${slotText(item.quickSlot).toLowerCase()}` }));
    }
    if (item.description !== '') {
      lines.push(
        h('p', {
          className: 'vb-item-description',
          text: item.description,
          data: { part: 'description' },
        }),
      );
    }
    if (item.verbs.length > 0) {
      lines.push(
        h('h3', { text: INVENTORY_TEXT.verbs }),
        h(
          'ul',
          { className: 'vb-item-verbs', data: { part: 'verbs' } },
          ...item.verbs.map((verb) => h('li', { text: verb })),
        ),
      );
    }
    for (const note of item.notes ?? []) {
      lines.push(h('p', { className: 'vb-item-note', text: note }));
    }
    details.replaceChildren(...lines);
  }

  function makeCard(item: InventoryItemModel): HTMLElement {
    const badges = h('span', { className: 'vb-item-badges' });
    if (item.stolen) {
      badges.append(
        h(
          'span',
          {
            className: 'vb-item-badge',
            data: { part: 'stolen' },
            attrs: { 'aria-hidden': 'true' },
          },
          itemIcon('stolen'),
        ),
      );
    }
    if (item.equipped !== undefined) {
      badges.append(
        h('span', {
          className: 'vb-item-badge',
          data: { part: 'equipped', glyph: 'E' },
          attrs: { 'aria-hidden': 'true' },
        }),
      );
    }
    if (item.quickSlot !== undefined) {
      badges.append(
        h('span', {
          className: 'vb-item-badge',
          data: { part: 'slot', glyph: String(item.quickSlot + 1) },
          attrs: { 'aria-hidden': 'true' },
        }),
      );
    }
    const card = h(
      'div',
      {
        className: 'vb-item-card',
        attrs: { role: 'option', 'aria-label': cardLabel(item), 'aria-selected': 'false' },
        data: { item: String(item.id), uiComponent: 'item-card' },
      },
      itemIcon(item.icon, 'vb-icon vb-item-icon'),
      h('span', { className: 'vb-item-name', text: item.name, attrs: { 'aria-hidden': 'true' } }),
      ...(item.count > 1
        ? [
            h('span', {
              className: 'vb-item-count',
              data: { glyph: `×${String(item.count)}` },
              attrs: { 'aria-hidden': 'true' },
            }),
          ]
        : []),
      badges,
    );
    card.tabIndex = -1;
    if (item.stolen) card.setAttribute('aria-describedby', tooltip.id);
    card.addEventListener('focus', () => {
      activate(item.id);
      showTip(card, item);
    });
    card.addEventListener('blur', hideTip);
    card.addEventListener('mouseenter', () => {
      showTip(card, item);
    });
    card.addEventListener('mouseleave', () => {
      if (document.activeElement !== card) hideTip();
    });
    card.addEventListener('click', () => {
      activate(item.id);
      card.focus();
      openMenu(item);
    });
    return card;
  }

  function showTip(card: HTMLElement, item: InventoryItemModel): void {
    if (!item.stolen) {
      hideTip();
      return;
    }
    tooltip.textContent = stolenText(item.owner);
    tooltip.style.left = `${String(card.offsetLeft)}px`;
    tooltip.style.top = `${String(card.offsetTop + card.offsetHeight + 4)}px`;
    tooltip.hidden = false;
  }

  function hideTip(): void {
    tooltip.hidden = true;
  }

  /** Makes item `id` the active (inspected, focusable) card. */
  function activate(id: number | undefined): void {
    activeId = id;
    for (const card of cards) {
      const on = card.dataset['item'] === String(id);
      card.tabIndex = on ? 0 : -1;
      card.setAttribute('aria-selected', String(on));
    }
    renderDetails(listed.find((item) => item.id === id));
  }

  /** Rebuilds the selected tab's grid; `refocus` puts focus back on the active card. */
  function render(refocus: boolean): void {
    gold.replaceChildren(itemIcon('currency'), ` ${goldText(model.gold)}`);
    const panel = panels[INVENTORY_TABS.findIndex((tab) => tab.id === tabId)] as HTMLElement;
    if (body.parentElement !== panel) panel.append(body);
    const previous = listed.findIndex((item) => item.id === activeId);
    listed = itemsInTab(model, tabId);
    cards = listed.map(makeCard);
    grid.replaceChildren(...cards);
    hideTip();
    const isEmpty = listed.length === 0;
    grid.hidden = isEmpty;
    empty.hidden = !isEmpty;
    empty.textContent = model.items.length === 0 ? INVENTORY_TEXT.empty : TAB_EMPTY[tabId];
    // Keep the inspected item; if it is gone, its neighbour in the list takes over.
    const kept =
      listed.find((item) => item.id === activeId) ??
      listed[Math.min(Math.max(previous, 0), listed.length - 1)];
    activate(kept?.id);
    const card = cards.find((c) => c.dataset['item'] === String(kept?.id));
    if (card !== undefined) {
      card.dataset['autofocus'] = '';
      if (refocus) card.focus();
    }
  }

  // Directions between cards: spatially among every card (not only the focusable one), so the
  // grid works with any column count; at an edge the intent goes back to the screen's navigation.
  onIntent(grid, (intent, event) => {
    if (!isDirection(intent)) return false;
    const from = event.target as HTMLElement;
    const candidates = cards
      .filter((card) => card !== from)
      .map((card) => ({ item: card, rect: ui.focus.rect(card) }));
    const target = spatialPick(ui.focus.rect(from), candidates, intent);
    if (target === undefined) return false;
    target.focus();
    return true;
  });

  function openMenu(item: InventoryItemModel): void {
    const close = (): void => {
      menu.close();
    };
    const choose = (action: InventoryActionId): void => {
      if (action === 'assign') {
        openAssign(item);
        return;
      }
      close();
      if (action === 'unassign') {
        options.onAction({ action, itemId: item.id, slot: item.quickSlot ?? 0 });
      } else {
        options.onAction({ action, itemId: item.id });
      }
    };
    const buttons = item.actions.map((action, i) => {
      const el = button({
        label: INVENTORY_ACTION_LABELS[action],
        autofocus: i === 0,
        variant: action === 'drop' || action === 'throw' ? 'warning' : 'default',
        onPress: () => {
          choose(action);
        },
      });
      el.dataset['action'] = action;
      return el;
    });
    const cancel = button({
      label: INVENTORY_TEXT.cancel,
      autofocus: buttons.length === 0,
      onPress: close,
    });
    cancel.dataset['action'] = 'cancel';
    const menu = pushMenu(
      INVENTORY_MENU_SCREEN,
      `${item.name}: actions`,
      h(
        'div',
        { className: 'vb-panel vb-stack vb-item-menu', data: { testid: 'inventory-menu' } },
        h('h2', { text: item.name }),
        h('div', { className: 'vb-stack vb-item-menu-actions' }, ...buttons, cancel),
      ),
    );
  }

  function openAssign(item: InventoryItemModel): void {
    const slots = model.quickSlots.map((slot, i) => {
      const el = button({
        label: slotChoiceText(i, slot),
        autofocus: i === 0,
        onPress: () => {
          closeMenus();
          options.onAction({ action: 'assign', itemId: item.id, slot: i });
        },
      });
      el.dataset['slot'] = String(i);
      return el;
    });
    const cancel = button({
      label: INVENTORY_TEXT.cancel,
      onPress: () => {
        picker.close();
      },
    });
    cancel.dataset['action'] = 'cancel';
    const picker = pushMenu(
      INVENTORY_ASSIGN_SCREEN,
      `Assign ${item.name} to a quick slot`,
      h(
        'div',
        { className: 'vb-panel vb-stack vb-item-menu', data: { testid: 'inventory-assign' } },
        h('h2', { text: `Assign ${item.name}` }),
        h(
          'div',
          {
            className: 'vb-stack vb-item-menu-actions',
            attrs: { role: 'group', 'aria-label': INVENTORY_TEXT.slots },
          },
          ...slots,
          cancel,
        ),
      ),
    );
  }

  function pushMenu(id: string, label: string, menuContent: HTMLElement): Screen {
    const menu = ui.push({
      id,
      label,
      content: menuContent,
      modal: true,
      pausesSim: true,
      onClose: () => {
        menus.splice(menus.indexOf(menu), 1);
      },
    });
    menus.push(menu);
    return menu;
  }

  function closeMenus(): void {
    for (const menu of [...menus].reverse()) menu.close();
  }

  render(false);
  const screen = ui.push({
    id: INVENTORY_SCREEN,
    label: INVENTORY_TEXT.heading,
    content,
    pausesSim: true,
    onClose: () => {
      closeMenus();
      options.onClose?.();
    },
  });
  // An empty pack has no card to focus: the tab strip takes focus instead (focusFirst did that).

  return {
    screen,
    get tab() {
      return tabId;
    },
    get active() {
      return activeId;
    },
    get listed() {
      return listed;
    },
    update(next) {
      model = next;
      // Focus stays on the inspected card; if that card was just removed (used up, dropped), the
      // neighbour that takes its place gets it.
      const active = document.activeElement;
      render(grid.contains(active) || (ui.top === screen && !screen.element.contains(active)));
    },
    say(text) {
      status.textContent = text;
    },
    select(tab) {
      strip.select(tab);
    },
    close() {
      closeMenus();
      screen.close();
    },
  };
}
