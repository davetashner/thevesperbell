// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { SoundCaptions, type SoundCaptionsModel } from './sound-captions';

const model = (over: Partial<SoundCaptionsModel> = {}): SoundCaptionsModel => ({
  enabled: true,
  size: 'medium',
  captions: [
    { key: 'a', text: '[Footsteps, behind left]', bearingDeg: -135 },
    { key: 'b', text: '[Attack incoming, ahead]', bearingDeg: 3 },
  ],
  ...over,
});

const lines = (w: SoundCaptions) => [...w.element.querySelectorAll<HTMLElement>('.vb-caption')];

describe('SoundCaptions (mw-e28.14)', () => {
  it('is a polite live region that announces additions, hidden until there is something to show', () => {
    const w = new SoundCaptions();
    expect(w.element.getAttribute('aria-live')).toBe('polite');
    expect(w.element.getAttribute('aria-relevant')).toBe('additions');
    expect(w.element.getAttribute('aria-label')).toBe('Sound captions');
    expect(w.element.hidden).toBe(true);
    w.update(model());
    expect(w.element.hidden).toBe(false);
    w.update(model({ captions: [] }));
    expect(w.element.hidden).toBe(true);
  });

  it('shows each caption’s words and a decorative arrow turned to its bearing', () => {
    const w = new SoundCaptions();
    w.update(model());
    expect(lines(w).map((l) => l.textContent)).toEqual([
      '▲[Footsteps, behind left]',
      '▲[Attack incoming, ahead]',
    ]);
    const arrow = lines(w)[0]?.querySelector<HTMLElement>('.vb-caption-arrow');
    expect(arrow?.getAttribute('aria-hidden')).toBe('true');
    expect(arrow?.style.transform).toBe('rotate(-135deg)');
    expect(lines(w)[1]?.querySelector<HTMLElement>('.vb-caption-arrow')?.style.transform).toBe(
      'rotate(5deg)',
    );
  });

  it('mw-e31.5 AC-1: a caption 90° to the right turns its arrow to point right, and the words say so too', () => {
    const w = new SoundCaptions();
    w.update(model({ captions: [{ key: 'r', text: '[Footsteps, right]', bearingDeg: 90 }] }));
    const line = lines(w)[0];
    expect(line?.querySelector<HTMLElement>('.vb-caption-arrow')?.style.transform).toBe(
      'rotate(90deg)',
    );
    // Direction is never colour alone: a shape (the arrow) and the words carry it.
    expect(line?.textContent).toContain('right');
  });

  it('keeps a line (and its place in the live region) while its arrow turns, writing in 5° steps', () => {
    const w = new SoundCaptions();
    w.update(model());
    const first = lines(w)[0];
    w.update(model({ captions: [{ key: 'a', text: '[Footsteps, left]', bearingDeg: -92 }] }));
    expect(lines(w)).toEqual([first]);
    expect(first?.dataset['bearing']).toBe('-90');
    expect(first?.textContent).toBe('▲[Footsteps, left]');
    if (first) first.dataset['bearing'] = 'tampered';
    w.update(model({ captions: [{ key: 'a', text: '[Footsteps, left]', bearingDeg: -91 }] }));
    expect(first?.dataset['bearing']).toBe('tampered');
  });

  it('orders lines as the model does and drops the ones that are gone', () => {
    const w = new SoundCaptions();
    w.update(model());
    w.update(model({ captions: [...model().captions].reverse() }));
    expect(lines(w).map((l) => l.dataset['caption'])).toEqual(['b', 'a']);
    w.update(model({ captions: [{ key: 'b', text: 'x', bearingDeg: 0 }] }));
    expect(lines(w).map((l) => l.dataset['caption'])).toEqual(['b']);
    // A returning key gets a fresh line with its text written.
    w.update(model());
    expect(lines(w).map((l) => l.textContent)).toEqual([
      '▲[Footsteps, behind left]',
      '▲[Attack incoming, ahead]',
    ]);
  });

  it('shows nothing while captions are off, and carries the size for the stylesheet', () => {
    const w = new SoundCaptions();
    w.update(model({ enabled: false, size: 'large' }));
    expect(w.element.hidden).toBe(true);
    expect(lines(w)).toEqual([]);
    expect(w.element.dataset['size']).toBe('large');
  });
});
