// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { SpellFizzled, World } from '@sim/index';
import { NO_RETICLE, Reticle } from '@ui/index';
import type { AimResult } from './aim';
import { attachSpellHud, NOTE_MS, reasonText, reticleModel } from './hud';
import type { SpellCaster } from './caster';

const ok: AimResult = {
  mode: 'reticle',
  target: null,
  clamped: false,
  range: 10,
  valid: true,
  point: { x: 0, y: 0, z: 0 },
  reason: null,
};

describe('reticle model', () => {
  it('is hidden with no spell, ready on a good aim, far when clamped', () => {
    expect(reticleModel(undefined, ok, '')).toBe(NO_RETICLE);
    expect(reticleModel('Ember', ok, '')).toEqual({
      visible: true,
      state: 'ready',
      spell: 'Ember',
      note: '',
    });
    expect(reticleModel('Ember', { ...ok, clamped: true }, '').state).toBe('far');
    expect(reticleModel('Ember', undefined, '').state).toBe('ready');
  });

  it('AC-2: an invalid aim is red with the reason, and a note keeps it red', () => {
    const bad: AimResult = { ...ok, valid: false, reason: 'no-floor' };
    expect(reticleModel('Wall', bad, '')).toMatchObject({
      state: 'invalid',
      note: 'No floor there',
    });
    expect(reticleModel('Wall', ok, 'Not enough mana')).toMatchObject({
      state: 'invalid',
      note: 'Not enough mana',
    });
  });

  it('words known reasons and passes unknown ones through', () => {
    expect(reasonText('insufficient-mana')).toBe('Not enough mana');
    expect(reasonText('odd-reason')).toBe('odd-reason');
  });
});

describe('spell HUD glue', () => {
  function setup() {
    const world = new World<never>({ seed: 1 });
    const reticle = new Reticle();
    const state = {
      spell: { name: 'Ember' } as { name: string } | undefined,
      refusals: 0,
      lastRefusal: undefined as string | undefined,
      aim: ok as AimResult | undefined,
    };
    const caster = {
      get refusals() {
        return state.refusals;
      },
      get lastRefusal() {
        return state.lastRefusal;
      },
      spell: () => state.spell,
      preview: () => state.aim,
    } as unknown as SpellCaster;
    const glue = attachSpellHud({
      world,
      player: 1,
      caster,
      reticle,
      ray: () => ({ origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: -1 } }),
    });
    return { world, reticle, state, glue };
  }

  it('shows the selected spell and hides without one', () => {
    const { reticle, state, glue } = setup();
    glue.frame(0);
    expect(reticle.element.hidden).toBe(false);
    expect(reticle.element.dataset['spell']).toBe('Ember');
    expect(glue.aim()).toBe(ok);
    state.spell = undefined;
    glue.frame(10);
    expect(reticle.element.hidden).toBe(true);
    expect(glue.aim()).toBeUndefined();
    glue.dispose();
  });

  it('a sim fizzle for the player turns the reticle red for NOTE_MS; others do not', () => {
    const { world, reticle, glue } = setup();
    const fizzle = (caster: number) => {
      world.events.emit(SpellFizzled, {
        tick: 0,
        caster,
        spell: 'ember',
        reason: 'insufficient-mana',
        stage: 'validate',
      });
    };
    fizzle(2);
    world.step([]);
    glue.frame(0);
    expect(reticle.element.dataset['state']).toBe('ready');
    fizzle(1);
    world.step([]);
    glue.frame(100);
    expect(reticle.element.dataset['state']).toBe('invalid');
    glue.frame(100 + NOTE_MS - 1);
    expect(reticle.element.dataset['state']).toBe('invalid');
    glue.frame(100 + NOTE_MS);
    expect(reticle.element.dataset['state']).toBe('ready');
  });

  it("a controller refusal is shown with the controller's reason", () => {
    const { reticle, state, glue } = setup();
    state.refusals = 1;
    state.lastRefusal = 'no-floor';
    glue.frame(5);
    expect(reticle.element.querySelector('.vb-reticle-note')?.textContent).toBe('No floor there');
    state.refusals = 2;
    state.lastRefusal = undefined;
    glue.frame(6);
    expect(reticle.element.querySelector('.vb-reticle-note')?.textContent).toBe('');
  });
});
