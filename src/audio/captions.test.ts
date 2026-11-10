import { describe, expect, it } from 'vitest';
import { UI_STRINGS } from '@content/index';
import {
  CAPTION_DEDUPE_MS,
  CAPTION_LIFETIME_MS,
  CAPTION_MAX_VISIBLE,
  CAPTION_RANGE_M,
  CAPTION_SECTORS,
  CaptionTracker,
  captionDirection,
  type CaptionTrigger,
} from './captions.ts';
import type { ListenerPose } from './spatial.ts';

/** At the origin looking down -z (ahead = -z, right = +x). */
const POSE: ListenerPose = {
  position: { x: 0, y: 0, z: 0 },
  forward: { x: 0, y: 0, z: -1 },
  up: { x: 0, y: 1, z: 0 },
};

/** A point `distance` m away at `bearing` degrees clockwise from the heading (right positive). */
const at = (bearing: number, distance = 5) => {
  const r = (bearing * Math.PI) / 180;
  return { x: Math.sin(r) * distance, y: 0, z: -Math.cos(r) * distance };
};

const trigger = (over: Partial<CaptionTrigger> = {}): CaptionTrigger => ({
  stringId: 'caption.footsteps',
  source: 'e1',
  position: at(0),
  priority: 30,
  ...over,
});

describe('captionDirection (mw-e28.14)', () => {
  it('mw-e31.5 AC-1: a source 90° to the player’s right points right, within 15°', () => {
    const { bearingDeg, sector } = captionDirection(POSE, at(90));
    expect(Math.abs(bearingDeg - 90)).toBeLessThanOrEqual(15);
    expect(sector).toBe('right');
    expect(Math.abs(captionDirection(POSE, at(-90)).bearingDeg + 90)).toBeLessThanOrEqual(15);
  });

  it('mw-e28.14 AC-1: a source 135° to the camera’s left-rear is "behind left"', () => {
    const d = captionDirection(POSE, at(-135));
    expect(d.sector).toBe('behind-left');
    expect(d.bearingDeg).toBeCloseTo(-135);
  });

  it('has a direction string for every sector', () => {
    for (const sector of CAPTION_SECTORS) {
      expect(UI_STRINGS[`caption.direction.${sector}`], sector).toBeTruthy();
    }
  });

  it('names all 8 sectors at their centres', () => {
    expect(CAPTION_SECTORS.map((_, i) => captionDirection(POSE, at(i * 45)).sector)).toEqual([
      ...CAPTION_SECTORS,
    ]);
  });

  it('puts the boundaries at 22.5° + 45° × k, each belonging to the sector clockwise of it', () => {
    expect(captionDirection(POSE, at(22.4)).sector).toBe('ahead');
    expect(captionDirection(POSE, at(22.6)).sector).toBe('ahead-right');
    expect(captionDirection(POSE, at(-22.4)).sector).toBe('ahead');
    expect(captionDirection(POSE, at(-22.6)).sector).toBe('ahead-left');
    expect(captionDirection(POSE, at(157.4)).sector).toBe('behind-right');
    expect(captionDirection(POSE, at(157.6)).sector).toBe('behind');
    expect(captionDirection(POSE, at(180)).sector).toBe('behind');
    expect(captionDirection(POSE, at(-157.4)).sector).toBe('behind-left');
    expect(captionDirection(POSE, at(-157.6)).sector).toBe('behind');
  });

  it('is relative to the camera heading, not the world', () => {
    // Facing +x: a source at +z is to the right.
    const east: ListenerPose = { ...POSE, forward: { x: 1, y: 0, z: 0 } };
    expect(captionDirection(east, { x: 0, y: 0, z: 5 }).sector).toBe('right');
    expect(captionDirection(east, { x: 0, y: 0, z: -5 }).sector).toBe('left');
    // Height is ignored when the camera pitches.
    const pitched: ListenerPose = { ...POSE, forward: { x: 0, y: -0.7, z: -0.7 } };
    expect(captionDirection(pitched, at(90)).sector).toBe('right');
  });

  it('reads dead behind as 180° even when the maths lands on -180°', () => {
    const odd: ListenerPose = { ...POSE, forward: { x: -0, y: 0, z: -1 } };
    expect(captionDirection(odd, { x: -0, y: 0, z: 5 })).toEqual({
      bearingDeg: 180,
      sector: 'behind',
    });
  });

  it('reads a source right on the camera, or a camera looking straight down, as ahead', () => {
    expect(captionDirection(POSE, POSE.position)).toEqual({ bearingDeg: 0, sector: 'ahead' });
    const down: ListenerPose = { ...POSE, forward: { x: 0, y: -1, z: 0 } };
    expect(captionDirection(down, at(90)).sector).toBe('ahead');
  });
});

describe('CaptionTracker (mw-e28.14)', () => {
  it('mw-e28.14 AC-2: five triggers from one source in 1 s make one caption', () => {
    const tracker = new CaptionTracker(() => POSE);
    const started = [0, 200, 400, 600, 800].map((t) => tracker.trigger(trigger(), t));
    expect(started).toEqual([true, false, false, false, false]);
    expect(tracker.visible(900)).toHaveLength(1);
  });

  it('mw-e31.5 AC-2: five identical footstep events within 2 s are one caption with a refreshed timer', () => {
    const tracker = new CaptionTracker(() => POSE);
    const times = [0, 400, 800, 1200, 1600];
    const started = times.map((t) => tracker.trigger(trigger(), t));
    expect(started.filter(Boolean)).toHaveLength(1);
    expect(tracker.visible(1700)).toHaveLength(1);
    // The timer counts from the last event (1600), not the first (0).
    expect(tracker.visible(1600 + CAPTION_LIFETIME_MS - 1)).toHaveLength(1);
    expect(tracker.visible(1600 + CAPTION_LIFETIME_MS)).toEqual([]);
  });

  it('mw-e31.5 AC-3: with more than 4 live captions the lowest priority is dropped first', () => {
    const tracker = new CaptionTracker(() => POSE);
    [40, 80, 20, 60, 100].forEach((priority, i) => {
      tracker.trigger(trigger({ source: `s${String(i)}`, priority }), i);
    });
    expect(tracker.visible(10).map((c) => c.priority)).toEqual([100, 80, 60, 40]);
    // When a higher-priority caption arrives later it displaces the lowest shown one.
    tracker.trigger(trigger({ source: 'late', priority: 90 }), 20);
    expect(tracker.visible(30).map((c) => c.priority)).toEqual([100, 90, 80, 60]);
  });

  it('de-dupes per source and caption: another source or another sound is its own caption', () => {
    const tracker = new CaptionTracker(() => POSE);
    expect(tracker.trigger(trigger(), 0)).toBe(true);
    expect(tracker.trigger(trigger({ source: 'e2' }), 100)).toBe(true);
    expect(tracker.trigger(trigger({ stringId: 'caption.telegraph' }), 100)).toBe(true);
    expect(tracker.visible(200)).toHaveLength(3);
  });

  it('shows the same source again once the 2 s window has passed', () => {
    const tracker = new CaptionTracker(() => POSE);
    expect(tracker.trigger(trigger(), 0)).toBe(true);
    expect(tracker.trigger(trigger(), CAPTION_DEDUPE_MS - 1)).toBe(false);
    expect(tracker.trigger(trigger(), CAPTION_DEDUPE_MS)).toBe(true);
    expect(tracker.visible(CAPTION_DEDUPE_MS)).toHaveLength(1);
  });

  it('mw-e28.14 AC-3: a source 25 m away makes no caption; 20 m is still in range', () => {
    const tracker = new CaptionTracker(() => POSE);
    expect(tracker.trigger(trigger({ position: at(0, 25) }), 0)).toBe(false);
    expect(tracker.visible(0)).toEqual([]);
    expect(tracker.trigger(trigger({ position: at(0, CAPTION_RANGE_M) }), 0)).toBe(true);
  });

  it('measures range in 3D', () => {
    const tracker = new CaptionTracker(() => POSE);
    expect(tracker.trigger(trigger({ position: { x: 0, y: 21, z: 0 } }), 0)).toBe(false);
  });

  it('mw-e28.14 AC-4: with 6 live captions the 4 highest priority show, newest first among equals', () => {
    const tracker = new CaptionTracker(() => POSE);
    [10, 90, 50, 70, 50, 30].forEach((priority, i) => {
      tracker.trigger(trigger({ source: `e${String(i)}`, priority }), i * 10);
    });
    const shown = tracker.visible(100);
    expect(shown).toHaveLength(CAPTION_MAX_VISIBLE);
    expect(shown.map((c) => c.priority)).toEqual([90, 70, 50, 50]);
    expect(shown.map((c) => c.key)).toEqual([
      'e1|caption.footsteps',
      'e3|caption.footsteps',
      'e4|caption.footsteps',
      'e2|caption.footsteps',
    ]);
  });

  it('expires a caption after its lifetime and refreshes it while the source repeats', () => {
    const tracker = new CaptionTracker(() => POSE);
    tracker.trigger(trigger(), 0);
    tracker.trigger(trigger(), 1500);
    expect(tracker.visible(1500 + CAPTION_LIFETIME_MS - 1)).toHaveLength(1);
    expect(tracker.visible(1500 + CAPTION_LIFETIME_MS)).toEqual([]);
  });

  it('gives each caption its direction from the listener as it is now, following a moving source', () => {
    let pose = POSE;
    const tracker = new CaptionTracker(() => pose);
    tracker.trigger(trigger({ position: at(90) }), 0);
    expect(tracker.visible(10)[0]?.sector).toBe('right');
    // The camera turns right to face the source.
    pose = { ...POSE, forward: { x: 1, y: 0, z: 0 } };
    expect(tracker.visible(20)[0]?.sector).toBe('ahead');
    // The source moves to +z (to this camera's right); a repeat updates where it is.
    tracker.trigger(trigger({ position: at(180) }), 100);
    expect(tracker.visible(110)[0]?.sector).toBe('right');
  });

  it('clear drops every caption', () => {
    const tracker = new CaptionTracker(() => POSE);
    tracker.trigger(trigger(), 0);
    tracker.clear();
    expect(tracker.visible(1)).toEqual([]);
  });
});
