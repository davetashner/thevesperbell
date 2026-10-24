// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { NO_RETICLE, Reticle } from './reticle';

describe('Reticle (mw-e06.15)', () => {
  it('starts hidden and shows the spell with its state', () => {
    const reticle = new Reticle();
    expect(reticle.element.hidden).toBe(true);
    reticle.update({ visible: true, state: 'far', spell: 'Ember', note: '' });
    expect(reticle.element.hidden).toBe(false);
    expect(reticle.element.dataset['state']).toBe('far');
    expect(reticle.element.dataset['spell']).toBe('Ember');
    expect(reticle.element.querySelector('.vb-reticle-spell')?.textContent).toBe('Ember');
  });

  it('AC-2: invalid is red with the reason under the cross', () => {
    const reticle = new Reticle();
    reticle.update({ visible: true, state: 'invalid', spell: 'Wall', note: 'No floor there' });
    expect(reticle.element.dataset['state']).toBe('invalid');
    expect(reticle.element.querySelector('.vb-reticle-note')?.textContent).toBe('No floor there');
  });

  it('hides again for NO_RETICLE and writes nothing for an unchanged model', () => {
    const reticle = new Reticle();
    const model = { visible: true, state: 'ready', spell: 'Ember', note: '' } as const;
    reticle.update(model);
    const seen: string[] = [];
    new MutationObserver((records) => { records.forEach((r) => seen.push(r.type)); }).observe(
      reticle.element,
      { attributes: true, childList: true, subtree: true, characterData: true },
    );
    reticle.update({ ...model });
    expect(seen).toEqual([]);
    reticle.update(NO_RETICLE);
    expect(reticle.element.hidden).toBe(true);
  });
});
