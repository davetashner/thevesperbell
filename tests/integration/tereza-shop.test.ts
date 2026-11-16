// @vitest-environment happy-dom
// mw-e40.31 (part of mw-e40.10): Tereza Maelo's arms stall opens from her dialogue. Her real dialogue
// runs on the game's logic host; its `tereza.shop-requested` emit reaches the shop controller, which
// opens the stall once the conversation has closed, and the stall sells at the economy's band prices.
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import type { DialogueDef } from '@content/types/dialogue';
import { markExercised } from '@content/testing';
import { installFactRegistry } from '@game/facts';
import { installGameLogic, questsOf } from '@game/logic/index';
import { SHOP_REQUESTS, startShopUi } from '@game/shop/shop-window';
import {
  addInventory,
  CapabilityRegistry,
  DialogueRuntime,
  InventoryRules,
  World,
} from '@sim/index';
import { UiRoot } from '@ui/index';

const content = loadGameContent();
const STALL = 'tereza-arms-stall';

function stall() {
  document.body.innerHTML = '';
  const world = new World<never>({ seed: 1 });
  installFactRegistry(world.facts, content, false);
  const player = world.spawn();
  addInventory(world, player, 0);
  world.step();
  const logic = installGameLogic(world, {
    world,
    player: () => player,
    inventory: new InventoryRules(content.all('item')),
    capabilities: new CapabilityRegistry([]),
    quests: questsOf(content),
  });
  const ui = new UiRoot(document.body, { unstyled: true });
  const shop = startShopUi({ ui, world, content, player });
  const runtime = new DialogueRuntime({
    world,
    host: logic.host,
    dialogues: (id) => content.get('dialogue', id) as unknown as DialogueDef,
  });
  const ask = (): void => {
    runtime.start('tereza-arms-stall', 'npc-tereza');
    for (let view = runtime.view; view?.kind === 'line'; view = runtime.advance());
    const index = runtime.choices().findIndex((c) => c.id === 'ask-stall');
    expect(index).toBeGreaterThanOrEqual(0);
    runtime.choose(index);
    for (let view = runtime.view; view?.kind === 'line'; view = runtime.advance());
  };
  const step = (): void => {
    world.step([]);
    shop.afterStep();
  };
  return { world, logic, shop, ui, ask, step };
}

describe("Tereza Maelo's arms stall (mw-e40.31)", () => {
  it('AC-1: her dialogue opens the stall, which sells at band prices', ({ task }) => {
    markExercised(task, 'merchant', STALL);
    expect(SHOP_REQUESTS['tereza.shop-requested']).toBe(STALL);
    const s = stall();
    s.ask();
    expect(s.shop.controller.isOpen).toBe(false);
    s.step();
    s.step();
    expect(s.shop.controller.isOpen).toBe(true);
    const merchant = content.get('merchant', STALL);
    expect(merchant.markup).toBeGreaterThanOrEqual(1.1);
    expect(merchant.markup).toBeLessThanOrEqual(1.5);
    expect(merchant.buyRate).toBeGreaterThanOrEqual(0.3);
    expect(merchant.buyRate).toBeLessThanOrEqual(0.6);
    const sold = s.shop.shops.stateOf(s.world, STALL).stock.map((line) => line.defId);
    expect(sold).toEqual(
      expect.arrayContaining(['walking-staff', 'yew-staff', 'kite-shield', 'brigandine']),
    );
    for (const defId of sold) {
      const quote = s.shop.shops.quote(STALL, 'buy', defId);
      const value = content.get('item', defId).value;
      expect(quote.ok && quote.price, defId).toBe(Math.round(value * merchant.markup));
    }
  });

  it('AC-2: the under-the-counter tier is hidden until she has been beaten, then appears at the next restock', () => {
    const s = stall();
    const sold = (): string[] =>
      s.shop.shops.stateOf(s.world, STALL).stock.map((line) => line.defId);
    const hidden = ['longsword', 'kettle-helm', 'tempered-mail-hauberk'];
    for (const defId of hidden) expect(sold()).not.toContain(defId);
    s.logic.host.setFact('tereza.under-counter', true);
    for (const defId of hidden) expect(sold()).not.toContain(defId);
    s.shop.shops.restock(s.world, 1);
    for (const defId of hidden) expect(sold()).toContain(defId);
  });

  it('AC-3: a request made while a screen is open waits until it closes', () => {
    const s = stall();
    const blocker = s.ui.push({
      id: 'blocker',
      label: 'Blocker',
      content: document.createElement('div'),
    });
    s.ask();
    s.step();
    s.step();
    expect(s.shop.controller.isOpen).toBe(false);
    blocker.close();
    s.step();
    expect(s.shop.controller.isOpen).toBe(true);
  });
});
