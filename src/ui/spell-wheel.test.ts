// @vitest-environment happy-dom
// The quick-select wheel widget and its pointing geometry (mw-e06.16).
import { describe, expect, it } from 'vitest';
import { CLOSED_WHEEL, SpellWheel, WHEEL_DEAD_ZONE, wheelSlotAt } from '@ui/spell-wheel';

describe('wheelSlotAt', () => {
  it('numbers sectors clockwise from straight up, and ignores the dead zone', () => {
    expect(wheelSlotAt(0, -1, 8)).toBe(0);
    expect(wheelSlotAt(1, -1, 8)).toBe(1);
    expect(wheelSlotAt(1, 0, 8)).toBe(2);
    expect(wheelSlotAt(0, 1, 8)).toBe(4);
    expect(wheelSlotAt(-1, 0, 8)).toBe(6);
    expect(wheelSlotAt(-0.1, -1, 8)).toBe(0); // just left of up still rounds to slot 1
    expect(wheelSlotAt(WHEEL_DEAD_ZONE / 2, 0, 8)).toBeNull();
    expect(wheelSlotAt(0, -1, 0)).toBeNull();
    expect(wheelSlotAt(0.2, 0, 8, 0.1)).toBe(2);
  });
});

describe('SpellWheel', () => {
  const sectors = (wheel: SpellWheel) => [
    ...wheel.element.querySelectorAll<HTMLElement>('.vb-spell-wheel-slot'),
  ];
  const slots = [
    { name: 'Ember', ready: true },
    { name: 'Gale', ready: false },
    { name: '', ready: true },
  ];

  it('is hidden while closed and lays the slots round a ring when open', () => {
    const wheel = new SpellWheel();
    wheel.update(CLOSED_WHEEL);
    expect(wheel.element.hidden).toBe(true);
    wheel.update({ open: true, slots, highlight: 1, selected: 0 });
    expect(wheel.element.hidden).toBe(false);
    expect(wheel.element.dataset['open']).toBe('true');
    const els = sectors(wheel);
    expect(els.map((e) => e.textContent)).toEqual(['Ember', 'Gale', '3']);
    expect(els.map((e) => e.dataset['state'])).toEqual(['ready', 'unavailable', 'empty']);
    expect(els.map((e) => e.dataset['highlight'])).toEqual(['false', 'true', 'false']);
    expect(els.map((e) => e.dataset['selected'])).toEqual(['true', 'false', 'false']);
    expect(wheel.element.querySelector('.vb-spell-wheel-name')?.textContent).toBe('Gale');
    expect(els[0]?.style.top).toBe('12%'); // slot 1 sits at the top
  });

  it('shows no name when the pointer rests at the centre, and closes again', () => {
    const wheel = new SpellWheel();
    wheel.update({ open: true, slots, highlight: null, selected: null });
    expect(wheel.element.querySelector('.vb-spell-wheel-name')?.textContent).toBe('');
    wheel.update({ open: true, slots, highlight: 7, selected: null });
    wheel.update(CLOSED_WHEEL);
    expect(wheel.element.hidden).toBe(true);
  });

  it('keeps its sectors between updates and drops the extras when the slot count shrinks', () => {
    const wheel = new SpellWheel();
    wheel.update({ open: true, slots, highlight: null, selected: null });
    const first = sectors(wheel)[0];
    wheel.update({ open: true, slots, highlight: 0, selected: null });
    expect(sectors(wheel)[0]).toBe(first);
    wheel.update({ open: true, slots: slots.slice(0, 2), highlight: 0, selected: null });
    expect(sectors(wheel)).toHaveLength(2);
  });
});
