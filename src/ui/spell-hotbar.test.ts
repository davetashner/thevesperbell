// @vitest-environment happy-dom
// The spell hotbar HUD (mw-e06.16): slot states and labels, cooldown in tenths, DOM writes only on
// change, and sizes from the HUD scale.
import { describe, expect, it } from 'vitest';
import {
  cooldownText,
  EMPTY_SPELL_SLOT,
  SPELL_HOTBAR_BASE,
  SpellHotbar,
  spellHotbarLayout,
  spellSlotLabel,
  spellSlotState,
  type SpellSlotModel,
} from '@ui/spell-hotbar';

const EMBER: SpellSlotModel = {
  name: 'Ember',
  cost: 6,
  cooldown: 0,
  cooldownTotal: 2,
  affordable: true,
  selected: false,
  channelling: false,
};

describe('slot state and text', () => {
  it('AC-2: a cooldown is shown in tenths, rounded up, and marks the slot unavailable', () => {
    expect(cooldownText(0)).toBe('');
    expect(cooldownText(1.44)).toBe('1.5');
    expect(cooldownText(1.4)).toBe('1.4');
    expect(cooldownText(0.01)).toBe('0.1');
    expect(spellSlotState({ ...EMBER, cooldown: 1.4 })).toBe('cooldown');
    expect(spellSlotLabel(1, { ...EMBER, cooldown: 1.4 })).toBe(
      'Spell 2: Ember, 6 mana, recharging, 1.4 seconds',
    );
  });

  it('AC-3: too little mana is the unaffordable state, and a cooldown outranks it', () => {
    expect(spellSlotState({ ...EMBER, affordable: false })).toBe('unaffordable');
    expect(spellSlotState({ ...EMBER, affordable: false, cooldown: 1 })).toBe('cooldown');
    expect(spellSlotState(EMBER)).toBe('ready');
    expect(spellSlotLabel(0, { ...EMBER, affordable: false, selected: true })).toBe(
      'Spell 1: Ember, 6 mana, not enough mana, selected',
    );
  });

  it('AC-4: an empty slot is empty and says so', () => {
    expect(spellSlotState(EMPTY_SPELL_SLOT)).toBe('empty');
    expect(spellSlotLabel(3, EMPTY_SPELL_SLOT)).toBe('Spell 4: empty');
  });
});

describe('SpellHotbar', () => {
  const slots = (hotbar: SpellHotbar) => [
    ...hotbar.element.querySelectorAll<HTMLElement>('.vb-spell-slot'),
  ];

  it('shows eight slots with icon initial, key, cost, state, selection and channel', () => {
    const hotbar = new SpellHotbar();
    hotbar.update([
      { ...EMBER, selected: true },
      { ...EMBER, name: 'Gale', cooldown: 1.2, channelling: true },
      { ...EMBER, name: 'Wall', cost: 40, affordable: false },
    ]);
    const els = slots(hotbar);
    expect(els).toHaveLength(8);
    expect(hotbar.element.getAttribute('aria-label')).toBe('Spell hotbar');
    expect(els.map((e) => e.dataset['state'])).toEqual([
      'ready',
      'cooldown',
      'unaffordable',
      'empty',
      'empty',
      'empty',
      'empty',
      'empty',
    ]);
    expect(els[0]?.dataset['selected']).toBe('true');
    expect(els[1]?.dataset['channelling']).toBe('true');
    expect(els[0]?.querySelector('.vb-spell-slot-icon')?.textContent).toBe('E');
    expect(els[2]?.querySelector('.vb-spell-slot-cost')?.textContent).toBe('40');
    expect(els[3]?.querySelector('.vb-spell-slot-cost')?.textContent).toBe('');
    expect(els[7]?.querySelector('.vb-spell-slot-key')?.textContent).toBe('8');
    expect(els[1]?.querySelector('.vb-spell-slot-timer')?.textContent).toBe('1.2');
    expect(els[1]?.style.getPropertyValue('--sweep')).toBe('60%');
    expect(els[0]?.getAttribute('aria-label')).toBe('Spell 1: Ember, 6 mana, ready, selected');
  });

  it('sweeps the cooldown as the fraction left, capped at the whole', () => {
    const hotbar = new SpellHotbar({ slots: 2 });
    hotbar.update([
      { ...EMBER, cooldown: 0.5, cooldownTotal: 2 },
      { ...EMBER, cooldown: 3, cooldownTotal: 2 },
    ]);
    expect(slots(hotbar).map((e) => e.style.getPropertyValue('--sweep'))).toEqual(['25%', '100%']);
    hotbar.update([EMBER, { ...EMBER, cooldown: 1, cooldownTotal: 0 }]);
    expect(slots(hotbar).map((e) => e.style.getPropertyValue('--sweep'))).toEqual(['0%', '0%']);
  });

  it('touches the DOM only when a shown value changes', () => {
    const hotbar = new SpellHotbar({ slots: 1 });
    hotbar.update([EMBER]);
    let writes = 0;
    new MutationObserver(() => (writes += 1)).observe(hotbar.element, {
      attributes: true,
      subtree: true,
      childList: true,
      characterData: true,
    });
    hotbar.update([{ ...EMBER }]);
    expect(writes).toBe(0);
  });

  it('takes custom key labels and scales with the HUD scale', () => {
    const hotbar = new SpellHotbar({ slots: 2, keys: ['Q', 'W'], scale: 2 });
    expect(slots(hotbar).map((e) => e.querySelector('.vb-spell-slot-key')?.textContent)).toEqual([
      'Q',
      'W',
    ]);
    expect(hotbar.layout).toEqual(spellHotbarLayout(2));
    expect(hotbar.element.style.bottom).toBe(`${String(SPELL_HOTBAR_BASE.margin * 2)}px`);
    expect(slots(hotbar)[0]?.style.width).toBe(`${String(SPELL_HOTBAR_BASE.size * 2)}px`);
    hotbar.setScale(10);
    expect(hotbar.layout.scale).toBe(2);
    hotbar.setScale(0.1);
    expect(hotbar.layout.scale).toBe(0.75);
    expect(hotbar.element.dataset['scale']).toBe('0.75');
  });
});
