// @vitest-environment happy-dom
// The shop screen (mw-e20.10): tabs, rows with prices, badges and tooltips, refusals, quantity,
// confirmation of expensive purchases, model updates that keep focus, and text-size layout.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setTextScale } from '@ui/comfort';
import {
  crownsText,
  dealLabel,
  needsConfirmation,
  openShopWindow,
  SHOP_SCREEN,
  SHOP_TABS,
  type ShopDeal,
  type ShopModel,
  type ShopRowModel,
} from '@ui/shop-window';
import { UiRoot } from '@ui/screens';
import { find, rectFromData } from '@ui/testing/layout';
import { findClippedText, type OverflowGeometry } from '@ui/testing/overflow';

let ui: UiRoot;

beforeEach(() => {
  document.body.innerHTML = '';
  ui = new UiRoot(document.body, { unstyled: true, focus: { rectOf: rectFromData } });
});

const row = (
  id: number,
  name: string,
  extra: Partial<Omit<ShopRowModel, 'unitPrice'>> & { unitPrice?: number | undefined } = {},
): ShopRowModel => {
  const { unitPrice = 10, ...rest } = { ...extra };
  const model: ShopRowModel = {
    id,
    name,
    icon: 'misc',
    count: 1,
    specialty: false,
    stolen: false,
    breakdown: ['Base value 10 crowns', 'Price 10 crowns'],
    ...rest,
    ...('unitPrice' in extra && extra.unitPrice === undefined ? {} : { unitPrice }),
  };
  return model;
};

const MODEL: ShopModel = {
  merchant: { name: 'Ottilie Marsh', greeting: 'Mind the step.', portrait: 'portrait-ottilie' },
  crowns: 100,
  buy: [
    row(1, 'Healing draught', { icon: 'consumable', count: 5, unitPrice: 8 }),
    row(2, 'Arming sword', {
      icon: 'weapon',
      unitPrice: 60,
      comparison: 'Equipped: Hunting knife.',
    }),
  ],
  sell: [
    row(7, 'Old book', { icon: 'book', specialty: true, breakdown: ['Specialty bonus ×1.2'] }),
    row(8, 'Candlestick', {
      stolen: true,
      refusal: 'Only a fence buys stolen goods.',
      unitPrice: undefined,
    }),
  ],
  buyback: [row(3, 'Lockpicks', { unitPrice: 6, count: 2 })],
};

function open(model: ShopModel = MODEL) {
  const onDeal = vi.fn<(deal: ShopDeal) => void>();
  const onClose = vi.fn<() => void>();
  const window = openShopWindow(ui, { model, onDeal, onClose });
  const rows = (tab: string) => [
    ...document.querySelectorAll<HTMLButtonElement>(`[data-shop-panel="${tab}"] .vb-shop-row`),
  ];
  return { window, onDeal, onClose, rows };
}

describe('shop window (mw-e20.10)', () => {
  it('shows the merchant, greeting, crowns and the four tabs; the Buy tab lists stock with prices', () => {
    const t = open();
    expect(ui.top?.id).toBe(SHOP_SCREEN);
    expect(ui.pausesSim).toBe(true);
    expect(ui.capturesInput).toBe(true);
    expect(find('.vb-shop-name').textContent).toBe('Ottilie Marsh');
    expect(find('[data-testid="shop-greeting"]').textContent).toBe('Mind the step.');
    expect(find('[data-testid="shop-portrait"]').dataset['portrait']).toBe('portrait-ottilie');
    expect(find('[data-testid="shop-crowns"]').textContent).toBe('Your crowns: 100 crowns');
    expect([...document.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual(
      SHOP_TABS.map((tab) => tab.label),
    );
    expect(t.rows('buy').map((r) => r.getAttribute('aria-label'))).toEqual([
      'Buy Healing draught, 8 crowns',
      'Buy Arming sword, 60 crowns',
    ]);
    expect(t.rows('buy')[1]?.textContent).toContain('Equipped: Hunting knife.');
    // mw-e31.11: the visible words read "Healing draught 8 crowns" (Label in Name).
    expect(t.rows('buy')[0]?.textContent).toMatch(/Healing draught.* 8 crowns/);
    expect(t.rows('buy')[0]?.querySelector('svg')?.dataset['icon']).toBe('consumable');
    expect(t.window.tab).toBe('buy');
  });

  it('mw-ju8.6: the Services tab lists services as bookable rows and books on confirm', () => {
    const room = row(0, 'Room for the night', {
      unitPrice: 12,
      breakdown: ['Fixed price 12 crowns'],
    });
    const t = open({ ...MODEL, services: [room] });
    t.window.select('services');
    expect(t.rows('services').map((r) => r.getAttribute('aria-label'))).toEqual([
      'Book Room for the night, 12 crowns',
    ]);
    (t.rows('services')[0] as HTMLElement).click(); // 12 of 100: no confirmation
    expect(t.onDeal).toHaveBeenCalledWith({ tab: 'services', id: 0, count: 1 });
  });

  it('mw-ju8.6: a room that is over a quarter of the crowns asks first; too few crowns refuses', async () => {
    const room = row(0, 'Room for the night', { unitPrice: 12 });
    const asks = open({ ...MODEL, crowns: 40, services: [room] });
    asks.window.select('services');
    (asks.rows('services')[0] as HTMLElement).click();
    expect(ui.top?.id).toBe('confirm');
    expect(asks.onDeal).not.toHaveBeenCalled();
    (document.querySelectorAll('[data-testid="confirm"] button')[1] as HTMLElement).click();
    await Promise.resolve();
    await Promise.resolve();
    expect(asks.onDeal).toHaveBeenCalledWith({ tab: 'services', id: 0, count: 1 });
  });

  it('the Services tab is empty when the merchant offers nothing', () => {
    const t = open();
    t.window.select('services');
    expect(find('[data-shop-panel="services"]').textContent).toBe('Nothing on offer');
    expect(find('[data-shop-panel="services"]').hidden).toBe(false);
  });

  it('empty tabs say so', () => {
    open({ ...MODEL, buy: [], sell: [], buyback: [] });
    expect(find('[data-testid="shop-rows-buy"]').textContent).toBe('Nothing for sale.');
    expect(find('[data-testid="shop-rows-sell"]').textContent).toBe('You have nothing to sell.');
    expect(find('[data-testid="shop-rows-buyback"]').textContent).toBe('Nothing sold lately.');
  });

  it('AC-1: a specialty row carries a badge and its tooltip lists the modifier', () => {
    const t = open();
    t.window.select('sell');
    const book = t.rows('sell')[0] as HTMLElement;
    expect(book.querySelector('[data-badge="specialty"]')?.textContent).toBe('Specialty');
    book.focus();
    const tip = find('[data-shop-row="sell:7"] [role="tooltip"]');
    expect(tip.hidden).toBe(false);
    expect(tip.textContent).toContain('Specialty bonus ×1.2');
    expect(book.getAttribute('aria-describedby')).toBe(tip.id);
  });

  it('AC-3: a stolen item is marked and disabled with its reason, and pressing says why', () => {
    const t = open();
    t.window.select('sell');
    const stolen = t.rows('sell')[1] as HTMLElement;
    expect(stolen.querySelector('[data-badge="stolen"]')).not.toBeNull();
    expect(stolen.getAttribute('aria-disabled')).toBe('true');
    expect(stolen.querySelector('[data-testid="shop-reason"]')?.textContent).toBe(
      'Only a fence buys stolen goods.',
    );
    stolen.click();
    expect(t.onDeal).not.toHaveBeenCalled();
    expect(find('[data-testid="shop-status"]').textContent).toBe('Only a fence buys stolen goods.');
    // Still focusable, so the reason can be read.
    stolen.focus();
    expect(document.activeElement).toBe(stolen);
  });

  it('AC-2: a cheap purchase is one input', () => {
    const t = open();
    t.rows('buy')[0]?.click(); // 8 crowns of 100
    expect(t.onDeal).toHaveBeenCalledExactlyOnceWith({ tab: 'buy', id: 1, count: 1 });
    expect(ui.top?.id).toBe(SHOP_SCREEN);
  });

  it('AC-2: a purchase over a quarter of the crowns asks first; Not now cancels, confirm buys', async () => {
    const t = open();
    t.rows('buy')[1]?.click(); // 60 of 100
    expect(t.onDeal).not.toHaveBeenCalled();
    expect(ui.top?.id).toBe('confirm');
    expect(find('[data-testid="confirm"]').textContent).toContain('Buy Arming sword, 60 crowns');
    ui.intent('confirm', 'keyboard'); // focus starts on the safe answer
    await Promise.resolve();
    expect(t.onDeal).not.toHaveBeenCalled();
    expect(ui.top?.id).toBe(SHOP_SCREEN);

    t.rows('buy')[1]?.click();
    const buttons = document.querySelectorAll<HTMLButtonElement>('[data-testid="confirm"] button');
    buttons[1]?.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(t.onDeal).toHaveBeenCalledExactlyOnceWith({ tab: 'buy', id: 2, count: 1 });
  });

  it('selling never asks, however much it pays', () => {
    const t = open({ ...MODEL, crowns: 10, sell: [row(7, 'Gem', { unitPrice: 500 })] });
    t.window.select('sell');
    t.rows('sell')[0]?.click();
    expect(t.onDeal).toHaveBeenCalledWith({ tab: 'sell', id: 7, count: 1 });
  });

  it('buying back more than a quarter of the crowns also asks', () => {
    const t = open({ ...MODEL, crowns: 20, buyback: [row(3, 'Lockpicks', { unitPrice: 6 })] });
    t.window.select('buyback');
    t.rows('buyback')[0]?.click();
    expect(ui.top?.id).toBe('confirm');
  });

  it('a stack has a quantity stepper; the price and the deal follow it', () => {
    const t = open();
    const draught = () => t.rows('buy')[0] as HTMLElement;
    find('[data-shop-focus="buy:1:more"]').click();
    find('[data-shop-focus="buy:1:more"]').click();
    expect(find('[data-stepper="buy:1"] .vb-shop-qty').dataset['qty']).toBe('3');
    expect(draught().querySelector('.vb-shop-price')?.textContent).toBe('24 crowns');
    expect(draught().getAttribute('aria-label')).toBe('Buy Healing draught ×3, 24 crowns');
    // The stepper keeps focus through the redraw.
    expect(document.activeElement?.getAttribute('data-shop-focus')).toBe('buy:1:more');
    find('[data-shop-focus="buy:1:fewer"]').click();
    expect(find('[data-stepper="buy:1"] .vb-shop-qty').dataset['qty']).toBe('2');
    // Fewer stops at 1, more at the count.
    find('[data-shop-focus="buy:1:fewer"]').click();
    find('[data-shop-focus="buy:1:fewer"]').click();
    expect(find('[data-stepper="buy:1"] .vb-shop-qty').dataset['qty']).toBe('1');
    for (let i = 0; i < 8; i++) find('[data-shop-focus="buy:1:more"]').click();
    expect(find('[data-stepper="buy:1"] .vb-shop-qty').dataset['qty']).toBe('5');
    draught().click(); // 40 of 100: asks
    expect(ui.top?.id).toBe('confirm');
    // A single-unit row has no stepper controls.
    expect(find('[data-stepper="buy:2"]').children).toHaveLength(0);
  });

  it('a row the player cannot afford is disabled with "Not enough crowns."', () => {
    const t = open({ ...MODEL, crowns: 30 });
    const sword = t.rows('buy')[1] as HTMLElement;
    expect(sword.getAttribute('aria-disabled')).toBe('true');
    expect(sword.textContent).toContain('Not enough crowns.');
    sword.click();
    expect(t.onDeal).not.toHaveBeenCalled();
    expect(ui.top?.id).toBe(SHOP_SCREEN);
  });

  it('an update keeps the tab, the quantity and focus, and a vanished row hands focus to a neighbour', () => {
    const t = open();
    find('[data-shop-focus="buy:1:more"]').click();
    (t.rows('buy')[1] as HTMLElement).focus();
    t.window.update({ ...MODEL, crowns: 90 });
    expect(find('[data-testid="shop-crowns"]').textContent).toBe('Your crowns: 90 crowns');
    expect(document.activeElement?.getAttribute('data-shop-focus')).toBe('buy:2:row');
    expect(find('[data-stepper="buy:1"] .vb-shop-qty').dataset['qty']).toBe('2');
    t.window.update({ ...MODEL, buy: MODEL.buy.slice(0, 1) });
    const focused = document.activeElement?.getAttribute('data-shop-focus');
    expect(focused?.startsWith('buy:1')).toBe(true);
    // An update while focus is outside the window does not steal it.
    (document.activeElement as HTMLElement).blur();
    t.window.update(MODEL);
    expect(document.activeElement).toBe(document.body);
  });

  it('a stack that shrank clamps the chosen quantity', () => {
    const t = open();
    for (let i = 0; i < 4; i++) find('[data-shop-focus="buy:1:more"]').click();
    t.window.update({ ...MODEL, buy: [row(1, 'Healing draught', { count: 2, unitPrice: 8 })] });
    expect(find('[data-stepper="buy:1"] .vb-shop-qty').dataset['qty']).toBe('2');
  });

  it('says things on the status line, and Close and Back close the screen', () => {
    const t = open();
    t.window.say('Bought Lockpicks for 6 crowns.');
    expect(find('[data-testid="shop-status"]').textContent).toBe('Bought Lockpicks for 6 crowns.');
    ui.intent('back', 'keyboard');
    expect(ui.top).toBeUndefined();
    expect(t.onClose).toHaveBeenCalledOnce();
    const again = open();
    find('[data-action="close"]').click();
    expect(ui.top).toBeUndefined();
    expect(again.onClose).toHaveBeenCalledOnce();
    const third = open();
    third.window.close();
    expect(ui.top).toBeUndefined();
  });

  it('opens on the tab asked for', () => {
    const onDeal = vi.fn();
    const window = openShopWindow(ui, { model: MODEL, onDeal, tab: 'sell' });
    expect(window.tab).toBe('sell');
  });

  it('keyboard and gamepad move between rows and confirm presses them', () => {
    const t = open();
    const [first, second] = [t.rows('buy')[0], t.rows('buy')[1]] as HTMLElement[];
    if (first === undefined || second === undefined) throw new Error('no rows');
    first.dataset['rect'] = '0,0,400,30';
    second.dataset['rect'] = '0,40,400,30';
    first.focus();
    ui.intent('down', 'gamepad');
    expect(document.activeElement).toBe(second);
    ui.intent('up', 'keyboard');
    expect(document.activeElement).toBe(first);
    ui.intent('confirm', 'gamepad');
    expect(t.onDeal).toHaveBeenCalledWith({ tab: 'buy', id: 1, count: 1 });
    // Q and E switch tabs from anywhere.
    ui.intent('tabNext', 'keyboard');
    expect(t.window.tab).toBe('sell');
    ui.intent('tabPrev', 'gamepad');
    expect(t.window.tab).toBe('buy');
  });

  it('AC-5: at 150% text the price column stays aligned and no row text can clip', () => {
    document.body.innerHTML = '';
    ui = new UiRoot(document.body, { focus: { rectOf: rectFromData } });
    setTextScale(ui.element, 1.5);
    const long = 'Unreasonably long name of a very old and storied ceremonial item';
    const model: ShopModel = {
      ...MODEL,
      buy: [
        row(1, long, { count: 4, unitPrice: 12345, comparison: long, specialty: true }),
        row(2, 'Pin', { unitPrice: 1 }),
        row(3, long, { refusal: long, unitPrice: undefined }),
      ],
    };
    openShopWindow(ui, { model, onDeal: vi.fn() });
    expect(ui.element.style.getPropertyValue('--ui-text-scale')).toBe('1.5');
    const prices = [...document.querySelectorAll<HTMLElement>('.vb-shop-price')].filter((el) =>
      el.closest('[data-shop-panel="buy"]'),
    );
    expect(prices).toHaveLength(3);
    for (const price of prices) {
      const style = getComputedStyle(price);
      // One fixed column in every row, right-aligned in tabular figures: digits line up.
      expect(style.textAlign).toBe('right');
      expect(style.fontVariantNumeric).toBe('tabular-nums');
      expect(style.overflowWrap).toBe('anywhere');
    }
    const rowStyle = getComputedStyle(find('.vb-shop-row'));
    expect(rowStyle.display).toBe('grid');
    expect(rowStyle.gridTemplateColumns).toBe('auto minmax(0, 1fr) 6em');
    const name = getComputedStyle(find('.vb-shop-item-name'));
    expect(name.overflowWrap).toBe('anywhere');
    expect(name.whiteSpace).not.toBe('nowrap');
    expect(name.textOverflow).not.toBe('ellipsis');
    expect(getComputedStyle(find('.vb-shop-rows')).overflowY).toBe('auto');
    // Worst case: every text box overflows everything around it; nothing between the text and the
    // screen's scroll container may clip.
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
    expect(findClippedText(find('[data-screen="shop"]'), worst)).toEqual([]);
  });

  it('formats prices and labels', () => {
    expect(crownsText(1)).toBe('1 crown');
    expect(crownsText(12)).toBe('12 crowns');
    expect(needsConfirmation(25, 100)).toBe(false);
    expect(needsConfirmation(26, 100)).toBe(true);
    expect(dealLabel('sell', row(1, 'Gem', { unitPrice: undefined }), 2)).toBe('Sell Gem ×2');
    expect(dealLabel('buyback', row(1, 'Gem'), 1)).toBe('Buy back Gem, 10 crowns');
  });

  it('a row with neither a price nor a refusal deals as free (a malformed model does not crash)', () => {
    const t = open({
      ...MODEL,
      buy: [row(9, 'Gift', { unitPrice: undefined })],
    });
    t.rows('buy')[0]?.click();
    expect(t.onDeal).toHaveBeenCalledWith({ tab: 'buy', id: 9, count: 1 });
  });

  it('Sell all offers a whole stack at once; single items and refused rows have no button', () => {
    const t = open({
      ...MODEL,
      sell: [
        row(5, 'Arrows', { count: 20, unitPrice: 2 }),
        row(6, 'Sword'),
        row(8, 'Candlestick', { count: 3, refusal: 'Only a fence buys stolen goods.' }),
      ],
    });
    expect(document.querySelectorAll('[data-sell-all]')).toHaveLength(1);
    t.window.select('sell');
    find('[data-sell-all]').click();
    expect(t.onDeal).toHaveBeenCalledWith({ tab: 'sell', id: 5, count: 20 });
  });

  it('a sale beyond the merchant’s crowns is dimmed with the reason and shows their till', () => {
    const t = open({
      ...MODEL,
      merchantCrowns: 15,
      sell: [row(5, 'Arrows', { count: 20, unitPrice: 2 })],
    });
    expect(find('[data-testid="shop-till"]').textContent).toBe('Their crowns: 15 crowns');
    t.window.select('sell');
    find('[data-sell-all]').click();
    expect(t.onDeal).not.toHaveBeenCalled();
    expect(find('[data-testid="shop-status"]').textContent).toBe(
      'They cannot afford that just now.',
    );
    expect(t.rows('sell')[0]?.getAttribute('aria-disabled')).toBeNull();
  });
});
