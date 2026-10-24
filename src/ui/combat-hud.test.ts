// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  CHIP_DRAIN_MS,
  CHIP_HOLD_MS,
  clampHudScale,
  COMBAT_HUD_BASE,
  CombatHud,
  combatHudBounds,
  combatHudLayout,
  DAMAGE_ARC_MS,
  DamageIndicator,
  MAX_DAMAGE_ARCS,
  STAMINA_FLASH_MS,
  type CombatHudModel,
} from './combat-hud';
import { Meter } from './hud';
import { uiStyleSheet } from './tokens';

const model = (health: number, stamina = 100, max = 100): CombatHudModel => ({
  health: { value: health, max },
  stamina: { value: stamina, max: 100 },
});

const transformOf = (hud: CombatHud, part: 'trail' | 'fill'): string | undefined =>
  hud.health.element.querySelector<HTMLElement>(`.vb-meter-${part}`)?.style.transform;

describe('combat HUD (mw-e04.10)', () => {
  it('AC-1: health 100→70 on one hit shows 70 filled and a 30-wide chip that drains from 500 ms and is gone by 1000 ms', () => {
    const hud = new CombatHud();
    hud.update(model(100), 0);
    hud.update(model(70), 1000); // the hit lands at t = 1000
    expect(transformOf(hud, 'fill')).toBe('scaleX(0.7000)');
    expect(transformOf(hud, 'trail')).toBe('scaleX(1.0000)');
    expect(hud.health.chip).toBeCloseTo(0.3, 10);
    expect(hud.health.element.getAttribute('aria-valuenow')).toBe('70');
    expect(hud.health.element.dataset['value']).toBe('70');

    hud.update(model(70), 1000 + CHIP_HOLD_MS - 1); // still holding
    expect(hud.health.chip).toBeCloseTo(0.3, 10);
    hud.update(model(70), 1000 + CHIP_HOLD_MS); // draining begins
    expect(hud.health.chip).toBeCloseTo(0.3, 10);
    hud.update(model(70), 1000 + CHIP_HOLD_MS + CHIP_DRAIN_MS / 2); // half way
    expect(hud.health.chip).toBeCloseTo(0.15, 10);
    hud.update(model(70), 1000 + CHIP_HOLD_MS + CHIP_DRAIN_MS - 1);
    expect(hud.health.chip).toBeGreaterThan(0);
    hud.update(model(70), 1000 + 1000); // 1000 ms after the hit: gone
    expect(hud.health.chip).toBe(0);
    expect(transformOf(hud, 'trail')).toBe('scaleX(0.7000)');
  });

  it('AC-1: the chip takes the same time whatever its size, even on a sparse frame rate', () => {
    const hud = new CombatHud();
    hud.update(model(100), 0);
    hud.update(model(10), 100);
    expect(hud.health.chip).toBeCloseTo(0.9, 10);
    hud.update(model(10), 100 + CHIP_HOLD_MS + 250); // one frame lands mid-drain
    expect(hud.health.chip).toBeCloseTo(0.45, 10);
    hud.update(model(10), 1100);
    expect(hud.health.chip).toBe(0);
  });

  it('a second hit while the chip drains restarts the hold from where the chip was', () => {
    const hud = new CombatHud();
    hud.update(model(100), 0);
    hud.update(model(70), 0);
    hud.update(model(70), 750); // chip 1.0 → 0.85
    hud.update(model(50), 750);
    expect(hud.health.trail).toBeCloseTo(0.85, 10);
    hud.update(model(50), 750 + CHIP_HOLD_MS);
    expect(hud.health.trail).toBeCloseTo(0.85, 10);
    hud.update(model(50), 750 + CHIP_HOLD_MS + CHIP_DRAIN_MS);
    expect(hud.health.trail).toBe(0.5);
  });

  it('a meter with no frame yet has no chip; a zero drain time clears the chip at the hold end', () => {
    const hud = new CombatHud();
    expect(hud.health.chip).toBe(0);
    const m = new Meter({ label: 'Health', trailHoldMs: 100, trailDrainMs: 0 });
    m.update({ value: 100, max: 100 }, 0);
    m.update({ value: 40, max: 100 }, 0);
    m.update({ value: 40, max: 100 }, 99);
    expect(m.chip).toBeCloseTo(0.6, 10);
    m.update({ value: 40, max: 100 }, 100);
    expect(m.chip).toBe(0);
  });

  it('under reduced motion the chip snaps', () => {
    const hud = new CombatHud({ reducedMotion: () => true });
    hud.update(model(100), 0);
    hud.update(model(70), 16);
    expect(hud.health.chip).toBe(0);
  });

  it('AC-2: a stamina refusal puts the stamina bar in its flash state for 300 ms', () => {
    const hud = new CombatHud();
    hud.update(model(100, 0), 0);
    expect(hud.stamina.flashing).toBe(false);
    expect(hud.stamina.element.hasAttribute('data-flash')).toBe(false);
    hud.staminaRejected(1000);
    hud.update(model(100, 0), 1000);
    expect(hud.stamina.flashing).toBe(true);
    expect(hud.stamina.element.hasAttribute('data-flash')).toBe(true);
    hud.update(model(100, 0), 1000 + STAMINA_FLASH_MS - 1);
    expect(hud.stamina.flashing).toBe(true);
    hud.update(model(100, 0), 1000 + STAMINA_FLASH_MS);
    expect(hud.stamina.flashing).toBe(false);
    expect(hud.stamina.element.hasAttribute('data-flash')).toBe(false);
    // Health never flashes.
    expect(hud.health.element.hasAttribute('data-flash')).toBe(false);
  });

  it('AC-3: an arc towards 120° appears and fades out at 1.5 s', () => {
    const hud = new CombatHud();
    hud.damageFrom(120, 2000);
    hud.update(model(100), 2000);
    expect(hud.indicator.arcs).toEqual([{ bearing: 120, opacity: 1 }]);
    const arc = hud.indicator.element.querySelector<HTMLElement>('.vb-damage-arc:not([hidden])');
    expect(arc?.style.transform).toBe('rotate(120.0deg)');
    expect(arc?.dataset['bearing']).toBe('120.0');
    hud.update(model(100), 2000 + DAMAGE_ARC_MS / 2);
    expect(hud.indicator.arcs[0]?.opacity).toBeCloseTo(0.5, 10);
    hud.update(model(100), 2000 + DAMAGE_ARC_MS - 1);
    expect(hud.indicator.arcs).toHaveLength(1);
    hud.update(model(100), 2000 + DAMAGE_ARC_MS);
    expect(hud.indicator.arcs).toEqual([]);
    expect(hud.indicator.element.querySelector('.vb-damage-arc:not([hidden])')).toBeNull();
    expect(hud.indicator.element.getAttribute('aria-hidden')).toBe('true');
  });

  it('AC-4: the low-health pulse is on at 24% of max and off at 25%', () => {
    const hud = new CombatHud();
    hud.update(model(24), 0);
    expect(hud.health.low).toBe(true);
    expect(hud.health.element.hasAttribute('data-low')).toBe(true);
    hud.update(model(25), 16);
    expect(hud.health.low).toBe(false);
    expect(hud.health.element.hasAttribute('data-low')).toBe(false);
    hud.update(model(48, 100, 200), 32); // 24% of a bigger pool
    expect(hud.health.low).toBe(true);
    // Stamina never pulses, however empty.
    hud.update(model(100, 0), 48);
    expect(hud.stamina.element.hasAttribute('data-low')).toBe(false);
    // The pulse is a CSS animation the motion setting can switch off.
    const css = uiStyleSheet();
    expect(css).toContain('.vb-meter[data-low]');
    expect(css).toContain("[data-motion='reduce'] .vb-meter[data-low] { animation: none; }");
  });

  it('AC-6: at 150% HUD scale the bars are 1.5× baseline and stay inside a 1280×720 viewport', () => {
    const base = new CombatHud();
    const big = new CombatHud({ scale: 1.5 });
    const size = (el: HTMLElement) => ({
      width: parseFloat(el.style.width),
      height: parseFloat(el.style.height),
    });
    expect(size(base.health.element)).toEqual(COMBAT_HUD_BASE.health);
    expect(size(big.health.element)).toEqual({
      width: COMBAT_HUD_BASE.health.width * 1.5,
      height: COMBAT_HUD_BASE.health.height * 1.5,
    });
    expect(size(big.stamina.element)).toEqual({
      width: COMBAT_HUD_BASE.stamina.width * 1.5,
      height: COMBAT_HUD_BASE.stamina.height * 1.5,
    });
    expect(big.element.dataset['scale']).toBe('1.5');
    const bounds = combatHudBounds(big.layout, { width: 1280, height: 720 });
    expect(bounds.top).toBe(big.layout.margin);
    expect(bounds.right).toBe(1280 - big.layout.margin);
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.top).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(1280);
    expect(bounds.bottom).toBeLessThanOrEqual(720);
    expect(big.layout.ring).toBeLessThanOrEqual(720);
    // Even the largest scale fits.
    const max = combatHudBounds(combatHudLayout(2), { width: 1280, height: 720 });
    expect(max.right).toBeLessThanOrEqual(1280);
    expect(max.top).toBeGreaterThanOrEqual(0);
  });

  it('changes scale live and clamps it to 75–200%', () => {
    const hud = new CombatHud();
    hud.setScale(2);
    expect(hud.health.element.style.width).toBe(`${String(COMBAT_HUD_BASE.health.width * 2)}px`);
    const bars = hud.element.querySelector<HTMLElement>('.vb-combat-bars');
    expect(bars?.style.right).toBe(`${String(COMBAT_HUD_BASE.margin * 2)}px`);
    expect(bars?.style.top).toBe(`${String(COMBAT_HUD_BASE.margin * 2)}px`);
    expect(hud.indicator.element.style.width).toBe(`${String(COMBAT_HUD_BASE.ring * 2)}px`);
    hud.setScale(9);
    expect(hud.layout.scale).toBe(2);
    expect(clampHudScale(0.1)).toBe(0.75);
    expect(clampHudScale(Number.NaN)).toBe(1);
  });
});

describe('DamageIndicator', () => {
  it('wraps bearings, keeps each arc on its own clock and replaces the oldest when full', () => {
    const ring = new DamageIndicator();
    ring.show(-90, 0);
    ring.update(0);
    expect(ring.arcs).toEqual([{ bearing: 270, opacity: 1 }]);
    for (let i = 1; i < MAX_DAMAGE_ARCS; i++) ring.show(i * 10, i * 100);
    ring.show(200, 500); // full: replaces the arc from t = 0
    ring.update(500);
    expect(ring.arcs.map((a) => a.bearing)).toEqual([10, 20, 30, 200]);
    ring.show(77, 600); // the oldest is now the arc from t = 100
    ring.update(600);
    expect(ring.arcs.map((a) => a.bearing)).toEqual([20, 30, 200, 77]);
    ring.update(200 + DAMAGE_ARC_MS);
    expect(ring.arcs.map((a) => a.bearing)).toEqual([30, 200, 77]);
    ring.show(45, 200 + DAMAGE_ARC_MS); // reuses the expired slot
    ring.update(200 + DAMAGE_ARC_MS);
    expect(ring.arcs.map((a) => a.bearing)).toEqual([30, 200, 77, 45]);
  });

  it('writes nothing while no arc is live', () => {
    const ring = new DamageIndicator();
    ring.update(0);
    const arc = ring.element.querySelector<HTMLElement>('.vb-damage-arc');
    if (arc === null) throw new Error('no arc');
    arc.style.transform = 'sentinel';
    ring.update(16);
    expect(arc.style.transform).toBe('sentinel');
  });

  it('mw-e06.15: a caster gets a mana bar, hidden for everyone else', () => {
    const hud = new CombatHud();
    hud.update(model(100), 0);
    expect(hud.mana.element.hidden).toBe(true);
    hud.update({ ...model(100), mana: { value: 10, max: 20 } }, 16);
    expect(hud.mana.element.hidden).toBe(false);
    expect(hud.mana.element.dataset['kind']).toBe('mana');
    expect(hud.mana.element.style.width).toBe(`${String(hud.layout.mana.width)}px`);
    hud.update({ ...model(100), mana: { value: 0, max: 0 } }, 32);
    expect(hud.mana.element.hidden).toBe(true);
  });
});
