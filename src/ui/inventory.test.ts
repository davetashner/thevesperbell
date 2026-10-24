// @vitest-environment happy-dom
// The inventory screen (mw-e17.10): tabs, the item grid and its keyboard/gamepad navigation, the
// inspect card, the stolen marker, the context menu and slot picker, the empty states, model updates
// and text scaling.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setTextScale } from '@ui/comfort';
import {
  cardLabel,
  INVENTORY_ASSIGN_SCREEN,
  INVENTORY_MENU_SCREEN,
  INVENTORY_SCREEN,
  INVENTORY_TEXT,
  itemsInTab,
  openInventory,
  slotChoiceText,
  stolenText,
  type InventoryItemModel,
  type InventoryModel,
  type InventoryRequest,
} from '@ui/inventory';
import { UiRoot } from '@ui/screens';
import { find, place, rectFromData } from '@ui/testing/layout';
import { findClippedText, type OverflowGeometry } from '@ui/testing/overflow';

let ui: UiRoot;

beforeEach(() => {
  document.body.innerHTML = '';
  ui = new UiRoot(document.body, { unstyled: true, focus: { rectOf: rectFromData } });
});

const item = (id: number, over: Partial<InventoryItemModel> = {}): InventoryItemModel => ({
  id,
  name: `Item ${String(id)}`,
  description: '',
  category: 'Consumable',
  icon: 'consumable',
  tabs: ['consumables'],
  count: 1,
  value: 10,
  stolen: false,
  verbs: [],
  actions: ['use', 'assign', 'drop', 'throw'],
  ...over,
});

const DRAUGHT = item(4, {
  name: 'Healing draught',
  description: 'Red and fizzy.',
  count: 3,
  verbs: ['Restore health (30)'],
  quickSlot: 1,
  actions: ['use', 'assign', 'unassign', 'drop', 'throw'],
});
const SWORD = item(3, {
  name: 'Arming sword',
  category: 'Weapon',
  icon: 'weapon',
  tabs: ['arms'],
  equipped: 'Main hand',
  verbs: ['Wield in one hand'],
  actions: ['unequip', 'drop', 'throw'],
});
const PRIMER = item(2, {
  name: 'Primer',
  category: 'Book',
  icon: 'book',
  tabs: ['books'],
  stolen: true,
  owner: 'the Warden',
  actions: [],
});
const KEY = item(1, {
  name: 'Gallery key',
  category: 'Key',
  icon: 'key',
  tabs: ['keys', 'quest'],
  stolen: true,
  notes: ['Can’t be dropped.'],
  actions: [],
});

const MODEL: InventoryModel = {
  gold: 42,
  items: [DRAUGHT, SWORD, PRIMER, KEY],
  quickSlots: [
    { label: '', count: 0 },
    { label: 'Healing draught', count: 3 },
    { label: '', count: 0 },
    { label: '', count: 0 },
  ],
};

const EMPTY: InventoryModel = { gold: 0, items: [], quickSlots: MODEL.quickSlots };

const cardOf = (id: number): HTMLElement => find(`[data-item="${String(id)}"]`);
const texts = (selector: string, root: ParentNode = document): string[] =>
  [...root.querySelectorAll(selector)].map((el) => el.textContent);
const shownIds = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('[data-item]')].map((el) => el.dataset['item'] ?? '');

/** Lays the cards out in a 2-column grid of 100×40 boxes, the tabs above. */
function layout(): void {
  document.querySelectorAll<HTMLElement>('[role="tab"]').forEach((tab, i) => {
    place(tab, i * 80, 0, 70, 20);
  });
  document.querySelectorAll<HTMLElement>('[data-item]').forEach((card, i) => {
    place(card, (i % 2) * 110, 40 + Math.floor(i / 2) * 50, 100, 40);
  });
}

function open(model: InventoryModel = MODEL) {
  const onAction = vi.fn<(request: InventoryRequest) => void>();
  const onClose = vi.fn();
  const inventory = openInventory(ui, { model, onAction, onClose });
  layout();
  return { inventory, onAction, onClose };
}

describe('inventory screen', () => {
  it('opens paused and capturing, newest first, focused on the first card with its details', () => {
    const { inventory } = open();
    expect(inventory.screen.id).toBe(INVENTORY_SCREEN);
    expect(ui.pausesSim && ui.capturesInput).toBe(true);
    expect(inventory.tab).toBe('all');
    expect(shownIds()).toEqual(['4', '3', '2', '1']);
    expect(document.activeElement).toBe(cardOf(4));
    expect(inventory.active).toBe(4);
    expect(find('[data-part="gold"]').textContent).toBe(' 42 gold');
    const details = find('[data-testid="item-details"]');
    expect(texts('[data-part="name"]', details)).toEqual(['Healing draught']);
    expect(find('[data-part="meta"]', details).textContent).toBe('Consumable ·  10 gold');
    expect(find('[data-part="description"]', details).textContent).toBe('Red and fizzy.');
    expect(texts('[data-part="verbs"] li', details)).toEqual(['Restore health (30)']);
    expect(details.textContent).toContain('3 carried');
    expect(details.textContent).toContain('In quick slot 2');
  });

  it('labels each card with its name, count and badges, and only the active one is focusable', () => {
    open();
    expect(cardOf(4).getAttribute('aria-label')).toBe('Healing draught, 3, quick slot 2');
    expect(cardOf(3).getAttribute('aria-label')).toBe('Arming sword, equipped');
    expect(cardOf(4).tabIndex).toBe(0);
    expect(cardOf(3).tabIndex).toBe(-1);
    expect(cardOf(4).getAttribute('aria-selected')).toBe('true');
    const glyphs = (selector: string, root: HTMLElement): (string | undefined)[] =>
      [...root.querySelectorAll<HTMLElement>(selector)].map((el) => el.dataset['glyph']);
    expect(glyphs('[data-part="slot"]', cardOf(4))).toEqual(['2']);
    expect(glyphs('[data-part="equipped"]', cardOf(3))).toEqual(['E']);
    expect(glyphs('.vb-item-count', cardOf(4))).toEqual(['×3']);
  });

  it('AC-axe: given a card, when labelled, its visible text is only the item name so the aria-label contains it (label-content-name-mismatch)', () => {
    open();
    const visible = (card: HTMLElement): string =>
      [...card.querySelectorAll('.vb-item-name, .vb-item-count, .vb-item-badge')]
        .map((el) => el.textContent)
        .join('');
    expect(visible(cardOf(3))).toBe('Arming sword');
    expect(visible(cardOf(4))).toBe('Healing draught');
    expect(cardOf(3).getAttribute('aria-label')?.startsWith('Arming sword')).toBe(true);
    expect(cardLabel(item(9, { count: 2, stolen: true }))).toBe('Item 9, 2, stolen');
  });

  it('AC-6: given an empty inventory, when opened, an empty-state message shows instead of a grid', () => {
    open(EMPTY);
    const empty = find('[data-testid="inventory-empty"]');
    expect(empty.hidden).toBe(false);
    expect(empty.textContent).toBe(INVENTORY_TEXT.empty);
    expect(find('[data-testid="inventory-grid"]').hidden).toBe(true);
    expect(document.querySelectorAll('[data-item]')).toHaveLength(0);
    expect(find('[data-testid="item-details"]').hidden).toBe(true);
    // Nothing to inspect: focus waits on the tab strip.
    expect(document.activeElement?.getAttribute('role')).toBe('tab');
  });

  it('lists only a tab’s items, and says so when a tab is empty', () => {
    const { inventory } = open();
    inventory.select('books');
    expect(inventory.tab).toBe('books');
    expect(shownIds()).toEqual(['2']);
    inventory.select('quest');
    expect(shownIds()).toEqual(['1']);
    inventory.select('tools');
    expect(shownIds()).toEqual([]);
    expect(find('[data-testid="inventory-empty"]').textContent).toBe('No tools.');
    expect(itemsInTab(MODEL, 'keys')).toEqual([KEY]);
    expect(itemsInTab(MODEL, 'all')).toBe(MODEL.items);
  });

  it('AC-2: a stolen card shows the marker and its tooltip names the owner, or just "Stolen"', () => {
    open();
    const primer = cardOf(2);
    expect(primer.querySelector('[data-part="stolen"] svg')).not.toBeNull();
    const tip = find('[data-testid="inventory-tooltip"]');
    expect(primer.getAttribute('aria-describedby')).toBe(tip.id);
    expect(tip.hidden).toBe(true);
    primer.focus();
    expect(tip.hidden).toBe(false);
    expect(tip.textContent).toBe('Stolen from the Warden');
    expect(find('[data-part="stolen"]', find('[data-testid="item-details"]')).textContent).toBe(
      ' Stolen from the Warden',
    );
    primer.blur();
    expect(tip.hidden).toBe(true);
    cardOf(1).dispatchEvent(new MouseEvent('mouseenter'));
    expect(tip.textContent).toBe('Stolen');
    cardOf(1).dispatchEvent(new MouseEvent('mouseleave'));
    expect(tip.hidden).toBe(true);
    // A clean card has no marker, no description link, and hides the tip on hover.
    cardOf(2).dispatchEvent(new MouseEvent('mouseenter'));
    cardOf(4).dispatchEvent(new MouseEvent('mouseenter'));
    expect(tip.hidden).toBe(true);
    expect(cardOf(4).hasAttribute('aria-describedby')).toBe(false);
    // Hovering away from the focused card keeps its tip.
    cardOf(2).focus();
    cardOf(2).dispatchEvent(new MouseEvent('mouseleave'));
    expect(tip.hidden).toBe(false);
    expect(stolenText(undefined)).toBe('Stolen');
  });

  it('moves between cards with directions and hands focus back at the grid’s edges', () => {
    open();
    ui.intent('right', 'gamepad');
    expect(document.activeElement).toBe(cardOf(3));
    expect(cardOf(3).tabIndex).toBe(0);
    expect(cardOf(4).tabIndex).toBe(-1);
    ui.intent('down', 'gamepad');
    expect(document.activeElement).toBe(cardOf(1));
    ui.intent('left', 'gamepad');
    expect(document.activeElement).toBe(cardOf(2));
    ui.intent('down', 'gamepad'); // nothing below: focus stays
    expect(document.activeElement).toBe(cardOf(2));
    ui.intent('up', 'gamepad');
    ui.intent('up', 'gamepad'); // past the top row: the screen's navigation takes it to the tabs
    expect(document.activeElement?.getAttribute('role')).toBe('tab');
  });

  it('switches tabs with LB/RB from a card, keeping focus in the grid or on an empty tab', () => {
    const { inventory } = open();
    ui.intent('tabNext', 'gamepad');
    expect(inventory.tab).toBe('arms');
    expect(document.activeElement).toBe(cardOf(3));
    ui.intent('tabNext', 'gamepad');
    expect(inventory.tab).toBe('tools');
    expect(document.activeElement?.getAttribute('role')).toBe('tab');
    expect(document.activeElement?.textContent).toBe('Tools');
  });

  it('confirm on a card opens its context menu; an action closes it and is reported', () => {
    const { onAction } = open();
    ui.intent('confirm', 'gamepad');
    expect(ui.top?.id).toBe(INVENTORY_MENU_SCREEN);
    const menu = find('[data-testid="inventory-menu"]');
    expect(texts('button', menu)).toEqual([
      'Use',
      'Assign to quick slot',
      'Remove from quick slot',
      'Drop',
      'Throw',
      'Cancel',
    ]);
    expect(document.activeElement?.textContent).toBe('Use');
    ui.intent('confirm', 'gamepad');
    expect(onAction).toHaveBeenCalledWith({ action: 'use', itemId: 4 });
    expect(ui.top?.id).toBe(INVENTORY_SCREEN);
    expect(document.activeElement).toBe(cardOf(4));
  });

  it('reports remove-from-slot with the slot, and Cancel or Back close the menu', () => {
    const { onAction } = open();
    cardOf(4).click();
    find('[data-action="unassign"]').click();
    expect(onAction).toHaveBeenCalledWith({ action: 'unassign', itemId: 4, slot: 1 });
    cardOf(4).click();
    find('[data-action="cancel"]').click();
    expect(ui.top?.id).toBe(INVENTORY_SCREEN);
    cardOf(3).click();
    expect(document.activeElement?.textContent).toBe('Unequip');
    ui.intent('back', 'keyboard');
    expect(ui.top?.id).toBe(INVENTORY_SCREEN);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('a remove-from-slot request falls back to slot 1 when the model names no slot', () => {
    const { onAction } = open({ ...MODEL, items: [item(7, { actions: ['unassign'] })] });
    cardOf(7).click();
    find('[data-action="unassign"]').click();
    expect(onAction).toHaveBeenCalledWith({ action: 'unassign', itemId: 7, slot: 0 });
  });

  it('a card with no actions offers only Cancel, focused', () => {
    open();
    cardOf(2).click();
    expect(texts('button', find('[data-testid="inventory-menu"]'))).toEqual(['Cancel']);
    expect(document.activeElement?.textContent).toBe('Cancel');
  });

  it('Assign opens the slot picker; a slot reports the assignment and closes both menus', () => {
    const { onAction } = open();
    cardOf(4).click();
    find('[data-action="assign"]').click();
    expect(ui.top?.id).toBe(INVENTORY_ASSIGN_SCREEN);
    const picker = find('[data-testid="inventory-assign"]');
    expect(texts('button', picker)).toEqual([
      'Slot 1: empty',
      'Slot 2: Healing draught ×3',
      'Slot 3: empty',
      'Slot 4: empty',
      'Cancel',
    ]);
    find('[data-action="cancel"]', picker).click();
    expect(ui.top?.id).toBe(INVENTORY_MENU_SCREEN);
    find('[data-action="assign"]').click();
    find('[data-slot="2"]').click();
    expect(onAction).toHaveBeenCalledWith({ action: 'assign', itemId: 4, slot: 2 });
    expect(ui.top?.id).toBe(INVENTORY_SCREEN);
    expect(slotChoiceText(0, { label: 'Oil flask', count: 1 })).toBe('Slot 1: Oil flask');
    expect(slotChoiceText(3, undefined)).toBe('Slot 4: empty');
  });

  it('update keeps the tab and the inspected item, and a removed card hands focus on', () => {
    const { inventory } = open();
    inventory.update({ ...MODEL, gold: 50, items: [{ ...DRAUGHT, count: 2 }, SWORD, PRIMER, KEY] });
    layout();
    expect(find('[data-part="gold"]').textContent).toBe(' 50 gold');
    expect(document.activeElement).toBe(cardOf(4));
    expect(cardOf(4).getAttribute('aria-label')).toBe('Healing draught, 2, quick slot 2');
    // The draught is used up: its neighbour takes over the focus.
    inventory.update({ ...MODEL, items: [SWORD, PRIMER, KEY] });
    expect(document.activeElement).toBe(cardOf(3));
    expect(inventory.listed.map((i) => i.id)).toEqual([3, 2, 1]);
    // Focus elsewhere on the screen (the tabs) stays there.
    focusTab();
    inventory.update({ ...MODEL, items: [PRIMER, KEY] });
    expect(document.activeElement?.getAttribute('role')).toBe('tab');
    expect(inventory.active).toBe(2);
    inventory.update(EMPTY);
    expect(inventory.active).toBeUndefined();
    expect(find('[data-testid="inventory-empty"]').hidden).toBe(false);
  });

  it('says why an action was refused, and close() closes the menus and the screen', () => {
    const { inventory, onClose } = open();
    const status = find('[data-testid="inventory-status"]');
    expect(status.getAttribute('role')).toBe('status');
    inventory.say('You can’t let go of that.');
    expect(status.textContent).toBe('You can’t let go of that.');
    cardOf(4).click();
    find('[data-action="assign"]').click();
    inventory.close();
    expect(ui.screens).toHaveLength(0);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Back closes the screen, and a later update does not steal focus', () => {
    const { inventory, onClose } = open();
    ui.intent('back', 'gamepad');
    expect(ui.screens).toHaveLength(0);
    expect(onClose).toHaveBeenCalledTimes(1);
    inventory.update(MODEL);
    expect(document.activeElement).toBe(document.body);
  });

  it('AC-4: at 150% text, long item names wrap and nothing in the screen can clip text', () => {
    document.body.innerHTML = '';
    ui = new UiRoot(document.body, { focus: { rectOf: rectFromData } });
    setTextScale(ui.element, 1.5);
    const long = 'Unreasonably long name of a very old and storied ceremonial item';
    openInventory(ui, {
      model: { ...MODEL, items: [{ ...DRAUGHT, name: long, description: long.repeat(3) }, SWORD] },
      onAction: vi.fn(),
    });
    expect(ui.element.style.getPropertyValue('--ui-text-scale')).toBe('1.5');
    // The kit's stylesheet is in force (the grid scrolls rather than clips).
    expect(getComputedStyle(find('.vb-inventory-grid')).overflowY).toBe('auto');
    const name = find('.vb-item-name');
    const style = getComputedStyle(name);
    expect(style.overflowWrap).toBe('anywhere');
    expect(style.whiteSpace).not.toBe('nowrap');
    expect(style.textOverflow).not.toBe('ellipsis');
    // Cards size to their content: no fixed height that a wrapped name could overflow.
    expect(cardOf(4).style.height).toBe('');
    // Worst case: every text box overflows everything around it. Only a clipping ancestor could cut
    // it, and none stands between the text and the screen's scroll containers.
    const worst: OverflowGeometry = {
      textRect: () => ({ left: -1e4, top: -1e4, right: 1e4, bottom: 1e4 }),
      clipRect: () => ({ left: 0, top: 0, right: 1, bottom: 1 }),
      overflow: (el) => {
        const computed = getComputedStyle(el);
        return {
          x: computed.textOverflow === 'ellipsis' ? 'hidden' : computed.overflowX,
          y: computed.overflowY,
        };
      },
    };
    expect(findClippedText(find('[data-screen="inventory"]'), worst)).toEqual([]);
  });
});

function focusTab(): void {
  document.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
}
