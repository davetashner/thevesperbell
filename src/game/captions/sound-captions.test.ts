// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { CaptionTracker, type ListenerPose } from '@audio/index';
import { SoundCaptions, type CaptionSize } from '@ui/index';
import { attachSoundCaptions } from './sound-captions';

const POSE: ListenerPose = {
  position: { x: 0, y: 0, z: 0 },
  forward: { x: 0, y: 0, z: -1 },
  up: { x: 0, y: 1, z: 0 },
};

function setup(ignore?: (source: string) => boolean) {
  let on = true;
  let size: CaptionSize = 'medium';
  let now = 0;
  const widget = new SoundCaptions();
  const glue = attachSoundCaptions({
    tracker: new CaptionTracker(() => POSE),
    widget,
    enabled: () => on,
    size: () => size,
    now: () => now,
    ...(ignore !== undefined && { ignore }),
  });
  const texts = () =>
    [...widget.element.querySelectorAll('.vb-caption-text')].map((e) => e.textContent);
  return {
    widget,
    glue,
    texts,
    setOn: (v: boolean) => {
      on = v;
    },
    setSize: (v: CaptionSize) => {
      size = v;
    },
    at: (ms: number) => {
      now = ms;
    },
  };
}

const footsteps = (source: string, x: number, z: number) => ({
  stringId: 'caption.footsteps',
  source,
  position: { x, y: 0, z },
  priority: 30,
});

describe('sound caption glue (mw-e28.14)', () => {
  it('measures how long a new caption waited for the frame that shows it', () => {
    const { glue, at } = setup();
    expect(glue.stats()).toEqual({ shown: 0, latencyMs: null });
    at(100);
    glue.trigger(footsteps('e7', 0, -5));
    glue.trigger(footsteps('e8', 0, -6));
    at(116.04);
    glue.frame(116.04);
    expect(glue.stats()).toEqual({ shown: 2, latencyMs: 16 });
    // A later frame with the same captions does not re-measure.
    at(200);
    glue.frame(200);
    expect(glue.stats().latencyMs).toBe(16);
  });

  it('does not start a latency measure for a repeat or an out-of-range source', () => {
    const { glue, texts, at } = setup();
    at(0);
    glue.trigger(footsteps('e7', 0, -30));
    glue.frame(5);
    expect(texts()).toEqual([]);
    expect(glue.stats().latencyMs).toBeNull();
    glue.trigger(footsteps('e7', 0, -5));
    at(10);
    glue.trigger(footsteps('e7', 0, -5));
    at(30);
    glue.frame(30);
    expect(glue.stats().latencyMs).toBe(30);
  });

  it('shows "[Footsteps, behind left]" for a creature behind and to the left', () => {
    const { glue, texts } = setup();
    glue.trigger(footsteps('e7', -5, 5)); // left and behind (ahead is -z)
    glue.frame(10);
    expect(texts()).toEqual(['[Footsteps, behind left]']);
  });

  it('does nothing while captions are off, and clears what was showing when they go off', () => {
    const { glue, texts, setOn, widget, at } = setup();
    setOn(false);
    glue.trigger(footsteps('e7', 0, -5));
    glue.frame(10);
    expect(widget.element.hidden).toBe(true);
    setOn(true);
    glue.frame(20);
    expect(texts()).toEqual([]);
    glue.trigger(footsteps('e7', 0, -5));
    glue.frame(30);
    expect(texts()).toEqual(['[Footsteps, ahead]']);
    setOn(false);
    glue.frame(40);
    expect(texts()).toEqual([]);
    setOn(true);
    at(50);
    glue.frame(50);
    expect(texts()).toEqual([]);
  });

  it('skips ignored sources (the player’s own footsteps) and passes the size through', () => {
    const { glue, texts, widget, setSize } = setup((source) => source === 'e1');
    glue.trigger(footsteps('e1', 0, -5));
    glue.trigger(footsteps('e2', 0, 5));
    setSize('large');
    glue.frame(10);
    expect(texts()).toEqual(['[Footsteps, behind]']);
    expect(widget.element.dataset['size']).toBe('large');
  });
});
