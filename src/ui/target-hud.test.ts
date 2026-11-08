// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  DAMAGE_NUMBER_MS,
  DAMAGE_NUMBER_RISE,
  BossBar,
  DamageNumbers,
  HIT_MARKER_MS,
  HitMarkers,
  MAX_HIT_MARKERS,
  targetNote,
  MAX_DAMAGE_NUMBERS,
  TargetBar,
} from './target-hud';

describe('target bar (mw-e04.21)', () => {
  it('is hidden without a target, then shows its name and health', () => {
    const bar = new TargetBar();
    bar.update(null, 0);
    expect(bar.element.hidden).toBe(true);
    bar.update({ name: 'Forgotten miner', health: { value: 30, max: 40 } }, 10);
    expect(bar.element.hidden).toBe(false);
    expect(bar.element.textContent).toContain('Forgotten miner');
    expect(bar.health.element.dataset['value']).toBe('30');
    bar.update(null, 20);
    expect(bar.element.hidden).toBe(true);
  });

  it('a hit leaves a chip that drains', () => {
    const bar = new TargetBar();
    bar.update({ name: 'Dummy', health: { value: 40, max: 40 } }, 0);
    bar.update({ name: 'Dummy', health: { value: 20, max: 40 } }, 16);
    expect(bar.health.chip).toBeCloseTo(0.5, 5);
    bar.update({ name: 'Dummy', health: { value: 20, max: 40 } }, 2000);
    expect(bar.health.chip).toBe(0);
  });
});

describe('target bar under reduced motion (mw-e04.21)', () => {
  it('snaps instead of draining a chip', () => {
    const bar = new TargetBar({ reducedMotion: () => true });
    bar.update({ name: 'Dummy', health: { value: 40, max: 40 } }, 0);
    bar.update({ name: 'Dummy', health: { value: 20, max: 40 } }, 16);
    expect(bar.health.chip).toBe(0);
  });
});

describe('damage numbers (mw-e04.21)', () => {
  it('reuses a finished slot before replacing a live number', () => {
    const n = new DamageNumbers();
    n.spawn('1', 'dealt', 0, 0, 0);
    n.spawn('2', 'dealt', 0, 0, DAMAGE_NUMBER_MS + 1);
    n.update(DAMAGE_NUMBER_MS + 1);
    expect(n.numbers.map((x) => x.text)).toEqual(['2']);
  });

  it('a number rises and fades, then is gone', () => {
    const n = new DamageNumbers();
    n.spawn('12', 'dealt', 100, 200, 1000);
    n.update(1000);
    expect(n.numbers).toEqual([{ text: '12', kind: 'dealt', opacity: 1 }]);
    n.update(1000 + DAMAGE_NUMBER_MS / 2);
    expect(n.numbers[0]?.opacity).toBeCloseTo(0.5, 5);
    const el = n.element.querySelector<HTMLElement>('.vb-damage-number:not([hidden])');
    expect(el?.style.transform).toBe(`translate(100px, ${String(200 - DAMAGE_NUMBER_RISE / 2)}px)`);
    expect(el?.dataset['kind']).toBe('dealt');
    n.update(1000 + DAMAGE_NUMBER_MS);
    expect(n.numbers).toEqual([]);
    expect(n.element.querySelector('.vb-damage-number:not([hidden])')).toBeNull();
  });

  it('under reduced motion the number fades in place', () => {
    const n = new DamageNumbers({ reducedMotion: () => true });
    n.spawn('5', 'taken', 10, 20, 0);
    n.update(DAMAGE_NUMBER_MS / 2);
    const el = n.element.querySelector<HTMLElement>('.vb-damage-number:not([hidden])');
    expect(el?.style.transform).toBe('translate(10px, 20px)');
    expect(el?.dataset['kind']).toBe('taken');
  });

  it('a full pool replaces the oldest number even when it is not in the first slot', () => {
    const n = new DamageNumbers();
    for (let i = 0; i < MAX_DAMAGE_NUMBERS; i++) {
      n.spawn(String(i), 'dealt', 0, 0, MAX_DAMAGE_NUMBERS - i);
    }
    n.spawn('new', 'dealt', 0, 0, MAX_DAMAGE_NUMBERS + 1);
    n.update(MAX_DAMAGE_NUMBERS + 1);
    expect(n.numbers.map((x) => x.text)).toContain('0');
    expect(n.numbers.map((x) => x.text)).not.toContain(String(MAX_DAMAGE_NUMBERS - 1));
    expect(n.numbers.map((x) => x.text)).toContain('new');
  });

  it('a full pool reuses its oldest number', () => {
    const n = new DamageNumbers();
    for (let i = 0; i < MAX_DAMAGE_NUMBERS + 1; i++) n.spawn(String(i), 'dealt', 0, 0, i);
    n.update(MAX_DAMAGE_NUMBERS);
    expect(n.numbers).toHaveLength(MAX_DAMAGE_NUMBERS);
    expect(n.numbers.map((x) => x.text)).not.toContain('0');
    expect(n.numbers.at(-1)?.text).toBe(String(MAX_DAMAGE_NUMBERS));
  });
});

describe('target bar poise and note (mw-e04.21)', () => {
  const base = { name: 'Dummy', health: { value: 40, max: 40 } };

  it('hides poise until the model has it, then flashes once per break', () => {
    const bar = new TargetBar();
    bar.update(base, 0);
    expect(bar.poise.element.hidden).toBe(true);
    bar.update({ ...base, poise: { value: 10, max: 30 } }, 16);
    expect(bar.poise.element.hidden).toBe(false);
    bar.update({ ...base, poise: { value: 30, max: 30 }, poiseBroken: true }, 32);
    expect(bar.poise.flashing).toBe(true);
    expect(bar.element.textContent).toContain('Poise broken');
    bar.update({ ...base, poise: { value: 30, max: 30 }, poiseBroken: true }, 1000);
    expect(bar.poise.flashing).toBe(false);
    bar.update(null, 1016);
    bar.update({ ...base, poise: { value: 30, max: 30 }, poiseBroken: true }, 1032);
    expect(bar.poise.flashing).toBe(true);
  });

  it('notes are words, "No effect" first', () => {
    expect(targetNote(base)).toBe('');
    expect(targetNote({ ...base, poiseBroken: true })).toBe('Poise broken');
    expect(targetNote({ ...base, poiseBroken: true, noEffect: true })).toBe('No effect');
  });
});

describe('boss bar (mw-e04.21)', () => {
  it('shows the name and health, hides without a model', () => {
    const bar = new BossBar();
    bar.update(null, 0);
    expect(bar.element.hidden).toBe(true);
    bar.update({ name: 'Warden', health: { value: 90, max: 100 } }, 16);
    expect(bar.element.hidden).toBe(false);
    expect(bar.element.textContent).toContain('Warden');
    expect(bar.health.element.dataset['value']).toBe('90');
    bar.update(null, 32);
    expect(bar.element.hidden).toBe(true);
  });

  it('can run under reduced motion', () => {
    const bar = new BossBar({ reducedMotion: () => true });
    bar.update({ name: 'W', health: { value: 10, max: 10 } }, 0);
    bar.update({ name: 'W', health: { value: 5, max: 10 } }, 16);
    expect(bar.health.chip).toBe(0);
  });
});

describe('hit markers (mw-e04.21)', () => {
  it('each variant has its own shape and fades after its time', () => {
    const m = new HitMarkers();
    const variants = ['normal', 'weakpoint', 'headshot', 'deflected'] as const;
    for (const v of variants) m.spawn(v, 10.4, 20.6, 0);
    m.update(10);
    expect(m.variants).toEqual([...variants]);
    const glyphs = [...m.element.children].map((c) => c.textContent).filter((t) => t !== '');
    expect(new Set(glyphs).size).toBe(4);
    m.update(HIT_MARKER_MS);
    expect(m.variants).toEqual([]);
  });

  it('a new one replaces the oldest when all are live', () => {
    const m = new HitMarkers();
    for (let i = 0; i < MAX_HIT_MARKERS + 1; i++) m.spawn('normal', 0, 0, i);
    m.spawn('headshot', 0, 0, MAX_HIT_MARKERS + 1);
    m.update(MAX_HIT_MARKERS + 2);
    expect(m.variants).toHaveLength(MAX_HIT_MARKERS);
    expect(m.variants.at(-1)).toBe('headshot');
  });
});
