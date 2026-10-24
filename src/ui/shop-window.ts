// The shop screen (mw-e20.10): a merchant's face, name and greeting over Buy, Sell, Buyback and
// Services tabs. Grey-box styling on the kit's tokens; the shop panel frame, portrait frame and the
// badge, crown and buyback icons are asset beads, so until they land the portrait is a plain framed
// slot (fed by an optional portrait id) and the badges are text.
//
// - Rows: icon, name, badges (specialty, stolen), a price in crowns and, for stacks, a quantity
//   stepper. Confirm or a click on a row does the deal for the chosen quantity. A row's tooltip (shown
//   on focus or hover) lists the price steps ("Base value 40 crowns, Merchant's markup ×1.3 …").
// - Refusals: a row the merchant will not deal in stays in the list, dimmed and marked
//   `aria-disabled`, with the reason written on it ("Only a fence buys stolen goods."). It keeps
//   focus so the reason can be read; pressing it says the reason on the status line.
// - Confirmation: a purchase (Buy or Buyback) costing more than a quarter of the player's crowns asks
//   first; a cheaper one is a single input. Selling never asks.
// - Services: what the merchant sells besides goods (a room for the night, mw-ju8.6), listed and booked
//   like a purchase: a fixed price, the same confirmation rule. Empty: "Nothing on offer".
//
// The screen pauses the sim and captures input; Back (Esc, B) or Close shuts it. It never changes
// game state: every deal is reported through `onDeal`, the game does it with the sim's `Shops` engine
// and answers with a new model (`update`) and a line for the status (`say`). Every size is in em, so
// the screen follows the text-size setting; names and reasons wrap rather than clip, and the price
// column is a fixed-width, right-aligned, tabular-figure column so prices line up at any size.

import { button } from './components/controls';
import { h } from './components/dom';
import { attachTooltip, confirmDialog, UI_INTENT_GLYPHS } from './components/overlays';
import { tabs, type Tabs } from './components/tabs';
import { itemIcon, type ItemIconKind } from './item-icons';
import type { Screen, UiRoot } from './screens';

/** `data-screen` of the shop. */
export const SHOP_SCREEN = 'shop';

/** The tabs, in order. */
export const SHOP_TABS = [
  { id: 'buy', label: 'Buy', empty: 'Nothing for sale.' },
  { id: 'sell', label: 'Sell', empty: 'You have nothing to sell.' },
  { id: 'buyback', label: 'Buyback', empty: 'Nothing sold lately.' },
  { id: 'services', label: 'Services', empty: 'Nothing on offer' },
] as const;
export type ShopTabId = (typeof SHOP_TABS)[number]['id'];
/** The tabs that list rows a deal can be done on (all of them). */
export type ShopDealTab = ShopTabId;

/** A purchase costing more than this fraction of the player's crowns asks first (economy doc). */
export const CONFIRM_FRACTION = 0.25;

export const SHOP_TEXT = Object.freeze({
  crowns: 'Your crowns',
  tabs: 'Shop',
  close: 'Close',
  specialty: 'Specialty',
  stolen: 'Stolen',
  fewer: 'Fewer',
  more: 'More',
  notEnough: 'Not enough crowns.',
  merchantBroke: 'They cannot afford that just now.',
  till: 'Their crowns',
  sellAll: 'Sell all',
  hint: `${UI_INTENT_GLYPHS.keyboard.tabPrev}/${UI_INTENT_GLYPHS.keyboard.tabNext} or ${UI_INTENT_GLYPHS.gamepad.tabPrev}/${UI_INTENT_GLYPHS.gamepad.tabNext}: change tab. ${UI_INTENT_GLYPHS.keyboard.back} or ${UI_INTENT_GLYPHS.gamepad.back}: Close.`,
});

/** "1 crown", "12 crowns". */
export const crownsText = (amount: number): string =>
  `${String(amount)} ${amount === 1 ? 'crown' : 'crowns'}`;

/** One line of stock, a pack stack or a buyback entry, as the screen shows it. */
export interface ShopRowModel {
  /** The stock line, pack instance or buyback entry id the deal names. */
  readonly id: number;
  readonly name: string;
  readonly icon: ItemIconKind;
  /** Units on offer (a stock line), held (a pack stack) or sold (a buyback entry). */
  readonly count: number;
  /** Crowns for one unit; absent when the merchant refuses the item. */
  readonly unitPrice?: number;
  /** The merchant pays a specialty bonus on it. */
  readonly specialty: boolean;
  readonly stolen: boolean;
  /** Why the row cannot be dealt, when it cannot. */
  readonly refusal?: string;
  /** The tooltip's price steps, one per line. */
  readonly breakdown: readonly string[];
  /** The button's verb when it is not the tab's (a lesson says "Learn", mw-ju8.38). */
  readonly verb?: string;
  /** How it compares with what the player has equipped, when it is equipment. */
  readonly comparison?: string;
}

/** What the shop screen shows. */
export interface ShopModel {
  readonly merchant: {
    readonly name: string;
    readonly greeting: string;
    /** Portrait asset id; the frame carries it as `data-portrait` until the art is integrated. */
    readonly portrait?: string;
  };
  /** The player's crowns. */
  readonly crowns: number;
  /** The crowns the merchant can pay out; a sale costing more is blocked. Absent = not shown. */
  readonly merchantCrowns?: number;
  readonly buy: readonly ShopRowModel[];
  readonly sell: readonly ShopRowModel[];
  readonly buyback: readonly ShopRowModel[];
  /** Services on offer, one row each (id = the service's index; count 1); none when absent. */
  readonly services?: readonly ShopRowModel[];
}

/** A deal the player chose. */
export interface ShopDeal {
  readonly tab: ShopDealTab;
  readonly id: number;
  readonly count: number;
}

export interface ShopWindowOptions {
  readonly model: ShopModel;
  /** The player chose a deal (confirmed, when it needed it). */
  readonly onDeal: (deal: ShopDeal) => void;
  /** The screen closed. */
  readonly onClose?: () => void;
  /** The tab to open on (default Buy). */
  readonly tab?: ShopTabId;
}

export interface ShopWindow {
  readonly screen: Screen;
  /** The selected tab. */
  readonly tab: ShopTabId;
  /** Shows a new model, keeping the tab, the quantities and focus where they can be kept. */
  update(model: ShopModel): void;
  /** Says something on the status line (a finished or refused deal). */
  say(text: string): void;
  select(tab: ShopTabId): void;
  close(): void;
}

/** Whether buying `total` crowns' worth needs a confirmation when the player holds `crowns`. */
export const needsConfirmation = (total: number, crowns: number): boolean =>
  total > crowns * CONFIRM_FRACTION;

const VERB: Readonly<Record<ShopDealTab, string>> = Object.freeze({
  buy: 'Buy',
  sell: 'Sell',
  buyback: 'Buy back',
  services: 'Book',
});

/** A row's accessible name: "Buy Healing draught ×2, 52 crowns". */
export function dealLabel(tab: ShopDealTab, row: ShopRowModel, count: number): string {
  const units = count > 1 ? ` ×${String(count)}` : '';
  const price = row.unitPrice === undefined ? '' : `, ${crownsText(row.unitPrice * count)}`;
  return `${row.verb ?? VERB[tab]} ${row.name}${units}${price}`;
}

/** Opens the shop screen on `ui`. */
export function openShopWindow(ui: UiRoot, options: ShopWindowOptions): ShopWindow {
  let model = options.model;
  const quantities = new Map<string, number>();

  const portrait = h('div', {
    className: 'vb-shop-portrait',
    attrs: { 'aria-hidden': 'true' },
    data: { testid: 'shop-portrait' },
  });
  const title = h('h1', { className: 'vb-shop-name' });
  const greeting = h('p', { className: 'vb-shop-greeting', data: { testid: 'shop-greeting' } });
  const crowns = h('p', { className: 'vb-shop-crowns', data: { testid: 'shop-crowns' } });
  const status = h('p', {
    className: 'vb-shop-status',
    attrs: { role: 'status' },
    data: { testid: 'shop-status' },
  });

  const till = h('p', { className: 'vb-shop-till', data: { testid: 'shop-till' } });

  const lists = new Map<ShopDealTab, { list: HTMLElement; empty: string }>();
  const panels = SHOP_TABS.map((spec) => {
    const panel = h('div', { className: 'vb-shop-panel', data: { shopPanel: spec.id } });
    const list = h('div', {
      className: 'vb-stack vb-shop-rows',
      attrs: { role: 'group', 'aria-label': spec.label },
      data: { testid: `shop-rows-${spec.id}` },
    });
    lists.set(spec.id, { list, empty: spec.empty });
    panel.append(list);
    return { id: spec.id, label: spec.label, panel };
  });
  const strip: Tabs = tabs({
    label: SHOP_TEXT.tabs,
    tabs: panels,
    ...(options.tab !== undefined && { selected: options.tab }),
  });
  const closeButton = button({
    label: SHOP_TEXT.close,
    onPress: () => {
      screen.close();
    },
  });
  closeButton.dataset['action'] = 'close';

  const content = h(
    'div',
    { className: 'vb-panel vb-stack vb-shop', data: { testid: 'shop-window' } },
    h(
      'div',
      { className: 'vb-shop-header' },
      portrait,
      h('div', { className: 'vb-shop-who' }, title, greeting),
    ),
    crowns,
    till,
    strip.element,
    status,
    h('div', { className: 'vb-row vb-shop-actions' }, closeButton),
    h('p', { className: 'vb-shop-hint', text: SHOP_TEXT.hint }),
  );

  const rowsOf = (tab: ShopDealTab): readonly ShopRowModel[] =>
    tab === 'services' ? (model.services ?? []) : model[tab];

  function quantityOf(key: string, row: ShopRowModel): number {
    return Math.min(Math.max(1, quantities.get(key) ?? 1), Math.max(1, row.count));
  }

  /** The reason a row cannot be dealt right now, if any. */
  function blocked(tab: ShopDealTab, row: ShopRowModel, count: number): string | undefined {
    if (row.refusal !== undefined) return row.refusal;
    const total = (row.unitPrice ?? 0) * count;
    if (tab !== 'sell' && total > model.crowns) return SHOP_TEXT.notEnough;
    if (tab === 'sell' && total > (model.merchantCrowns ?? Number.POSITIVE_INFINITY)) {
      return SHOP_TEXT.merchantBroke;
    }
    return undefined;
  }

  function deal(tab: ShopDealTab, row: ShopRowModel, count: number): void {
    const reason = blocked(tab, row, count);
    if (reason !== undefined) {
      status.textContent = reason;
      return;
    }
    const total = (row.unitPrice ?? 0) * count;
    const go = (): void => {
      options.onDeal({ tab, id: row.id, count });
    };
    if (tab === 'sell' || !needsConfirmation(total, model.crowns)) {
      go();
      return;
    }
    void confirmDialog(ui, {
      title: `${row.verb ?? VERB[tab]} ${row.name}?`,
      body: `${dealLabel(tab, row, count)}. You have ${crownsText(model.crowns)}.`,
      confirmLabel: row.verb ?? VERB[tab],
      cancelLabel: 'Not now',
      pausesSim: true,
    }).then((yes) => {
      if (yes) go();
    });
  }

  function makeRow(tab: ShopDealTab, row: ShopRowModel): HTMLElement {
    const key = `${tab}:${String(row.id)}`;
    const count = quantityOf(key, row);
    const reason = blocked(tab, row, count);
    const main = button({
      label: '',
      onPress: () => {
        deal(tab, row, count);
      },
    });
    main.classList.add('vb-shop-row');
    main.dataset['shopFocus'] = `${key}:row`;
    main.dataset['shopItem'] = key;
    main.setAttribute('aria-label', dealLabel(tab, row, count));
    if (reason !== undefined) main.setAttribute('aria-disabled', 'true');
    const badges = [
      ...(row.specialty
        ? [
            h('span', {
              className: 'vb-shop-badge',
              text: SHOP_TEXT.specialty,
              data: { badge: 'specialty' },
            }),
          ]
        : []),
      ...(row.stolen
        ? [
            h(
              'span',
              { className: 'vb-shop-badge', data: { badge: 'stolen' } },
              itemIcon('stolen', 'vb-icon vb-shop-badge-icon'),
              SHOP_TEXT.stolen,
            ),
          ]
        : []),
    ];
    main.replaceChildren(
      itemIcon(row.icon, 'vb-icon vb-shop-icon'),
      h(
        'span',
        { className: 'vb-shop-text', attrs: { 'aria-hidden': 'true' } },
        h('span', { className: 'vb-shop-item-name', text: row.name }),
        ...badges,
        ...(row.comparison === undefined
          ? []
          : [h('span', { className: 'vb-shop-comparison', text: row.comparison })]),
        ...(reason === undefined
          ? []
          : [
              h('span', {
                className: 'vb-shop-reason',
                text: reason,
                data: { testid: 'shop-reason' },
              }),
            ]),
      ),
      h('span', {
        className: 'vb-shop-price',
        text: row.unitPrice === undefined ? '' : crownsText(row.unitPrice * count),
        attrs: { 'aria-hidden': 'true' },
        data: { price: row.unitPrice === undefined ? '' : String(row.unitPrice * count) },
      }),
    );

    const stepper = h('span', { className: 'vb-shop-stepper', data: { stepper: key } });
    if (row.count > 1) {
      const step = (by: number, label: string, focusKey: string): HTMLButtonElement => {
        const control = button({
          label: by < 0 ? '−' : '+',
          onPress: () => {
            quantities.set(key, Math.min(row.count, Math.max(1, count + by)));
            render(focusKey);
          },
        });
        control.classList.add('vb-shop-step');
        control.setAttribute('aria-label', `${label} ${row.name}`);
        control.dataset['shopFocus'] = `${key}:${by < 0 ? 'fewer' : 'more'}`;
        if (count + by < 1 || count + by > row.count) control.setAttribute('aria-disabled', 'true');
        return control;
      };
      stepper.append(
        step(-1, SHOP_TEXT.fewer, `${key}:fewer`),
        h('span', {
          className: 'vb-shop-qty',
          text: `×${String(count)}`,
          attrs: { role: 'status', 'aria-label': `${String(count)} of ${String(row.count)}` },
          data: { qty: String(count) },
        }),
        step(1, SHOP_TEXT.more, `${key}:more`),
      );
    }
    if (tab === 'sell' && row.count > 1 && row.refusal === undefined) {
      const all = button({
        label: SHOP_TEXT.sellAll,
        onPress: () => {
          quantities.set(key, row.count);
          deal(tab, row, row.count);
        },
      });
      all.classList.add('vb-shop-step');
      all.setAttribute('aria-label', `${SHOP_TEXT.sellAll} ${row.name}`);
      all.dataset['shopFocus'] = `${key}:all`;
      all.dataset['sellAll'] = key;
      stepper.append(all);
    }
    const wrap = h('div', { className: 'vb-shop-item', data: { shopRow: key } }, main, stepper);
    if (row.breakdown.length > 0) {
      attachTooltip(main, row.breakdown.join('\n')).classList.add('vb-shop-tooltip');
    }
    return wrap;
  }

  /** Rebuilds the lists; `focusKey` names the control to focus after, else keeps the current one. */
  function render(focusKey?: string): void {
    const active = document.activeElement as HTMLElement | null;
    const keep = focusKey ?? active?.dataset['shopFocus'];
    const index = [...document.querySelectorAll<HTMLElement>('[data-shop-focus]')].findIndex(
      (el) => el === active,
    );
    const hadFocus = focusKey !== undefined || content.contains(active);
    title.textContent = model.merchant.name;
    greeting.textContent = model.merchant.greeting;
    portrait.dataset['portrait'] = model.merchant.portrait ?? '';
    portrait.textContent = model.merchant.name.charAt(0).toUpperCase();
    crowns.textContent = `${SHOP_TEXT.crowns}: ${crownsText(model.crowns)}`;
    till.textContent =
      model.merchantCrowns === undefined
        ? ''
        : `${SHOP_TEXT.till}: ${crownsText(model.merchantCrowns)}`;
    for (const [tab, { list, empty }] of lists) {
      const rows = rowsOf(tab);
      list.replaceChildren(
        ...(rows.length === 0
          ? [h('p', { className: 'vb-shop-empty', text: empty })]
          : rows.map((row) => makeRow(tab, row))),
      );
    }
    if (!hadFocus) return;
    const controls = [...content.querySelectorAll<HTMLElement>('[data-shop-focus]')].filter(
      (el) => el.closest('[hidden]') === null,
    );
    const next =
      controls.find((el) => el.dataset['shopFocus'] === keep) ??
      controls[Math.min(Math.max(index, 0), controls.length - 1)] ??
      closeButton;
    next.focus();
  }

  render();
  const screen = ui.push({
    id: SHOP_SCREEN,
    label: model.merchant.name,
    content,
    pausesSim: true,
    onClose: () => {
      options.onClose?.();
    },
  });

  return {
    screen,
    get tab() {
      return strip.selected as ShopTabId;
    },
    update(next) {
      model = next;
      render();
    },
    say(text) {
      status.textContent = text;
    },
    select(tab) {
      strip.select(tab);
    },
    close() {
      screen.close();
    },
  };
}
