import { describe, expect, it } from 'vitest';
import {
  at as read,
  catmullRom,
  Trail,
  TRAIL_MAX,
  TRAIL_MAX_STATIONS,
  TRAIL_SAMPLES,
  TRAIL_SUBDIVISIONS,
  TrailSet,
  writeRibbon,
} from './trail-ribbon';

const WHITE = [1, 1, 1] as const;
const at = (x: number) => ({ x, y: 0, z: 0 });

describe('Catmull-Rom smoothing (mw-e29.6)', () => {
  it('passes through its control points and is linear for collinear ones', () => {
    expect(catmullRom(0, 1, 2, 3, 0)).toBeCloseTo(1);
    expect(catmullRom(0, 1, 2, 3, 1)).toBeCloseTo(2);
    expect(catmullRom(0, 1, 2, 3, 0.5)).toBeCloseTo(1.5);
    // A bend is rounded: the midpoint overshoots the chord of a sharp corner.
    expect(catmullRom(0, 0, 1, 1, 0.5)).toBeCloseTo(0.5);
    expect(catmullRom(0, 1, 1, 0, 0.5)).toBeGreaterThan(1);
  });
});

describe('Trail ring buffer', () => {
  it('is not drawable until it has two samples, and clears', () => {
    const trail = new Trail();
    trail.live = true;
    expect(trail.visible).toBe(false);
    trail.push(at(0), at(1));
    expect(trail.visible).toBe(false);
    trail.push(at(2), at(3));
    expect(trail.visible).toBe(true);
    trail.clear();
    expect(trail.length).toBe(0);
    trail.live = false;
    trail.push(at(0), at(1));
    trail.push(at(0), at(1));
    expect(trail.visible).toBe(false);
  });

  it('keeps the newest TRAIL_SAMPLES samples, oldest first, clamping indices', () => {
    const trail = new Trail();
    for (let i = 0; i < TRAIL_SAMPLES + 5; i++) trail.push(at(i), at(i + 100));
    expect(trail.length).toBe(TRAIL_SAMPLES);
    expect(trail.at(0, 0)).toBe(5);
    expect(trail.at(TRAIL_SAMPLES - 1, 3)).toBe(TRAIL_SAMPLES + 4 + 100);
    expect(trail.at(-3, 0)).toBe(5);
    expect(trail.at(99, 0)).toBe(TRAIL_SAMPLES + 4);
  });
});

describe('writeRibbon', () => {
  const positions = new Float32Array(TRAIL_MAX_STATIONS * 6);
  const colours = new Float32Array(TRAIL_MAX_STATIONS * 8);

  it('writes nothing for a trail with fewer than two samples', () => {
    const trail = new Trail();
    trail.push(at(0), at(1));
    expect(writeRibbon(trail, positions, colours)).toBe(0);
  });

  it('writes subdivided stations from tail to head with alpha rising from 0 to the trail’s', () => {
    const set = new TrailSet();
    const { trail } = set.request(1, 'swing', [0.5, 0.25, 1], 0.8);
    trail.push({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    trail.push({ x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 });
    trail.push({ x: 2, y: 0, z: 0 }, { x: 2, y: 1, z: 0 });
    const stations = writeRibbon(trail, positions, colours);
    expect(stations).toBe(2 * TRAIL_SUBDIVISIONS + 1);
    // Tail is the oldest sample, head the newest; base then tip.
    expect([...positions.slice(0, 6)]).toEqual([0, 0, 0, 0, 1, 0]);
    const head = (stations - 1) * 6;
    expect([...positions.slice(head, head + 6)]).toEqual([2, 0, 0, 2, 1, 0]);
    expect(colours[3]).toBe(0);
    expect(colours[7]).toBe(0);
    const last = (stations - 1) * 8;
    expect(colours[last + 3]).toBeCloseTo(0.8);
    expect([colours[last], colours[last + 1], colours[last + 2]]).toEqual([0.5, 0.25, 1]);
    // Smoothing is monotonic along a straight run.
    for (let s = 1; s < stations; s++) {
      expect(read(positions, s * 6)).toBeGreaterThan(read(positions, (s - 1) * 6));
    }
  });
});

describe('TrailSet', () => {
  it('AC-3: with 9 trail requests the oldest is released and 8 remain', () => {
    const set = new TrailSet();
    const requests = Array.from({ length: TRAIL_MAX + 1 }, (_, owner) =>
      set.request(owner, 'swing', WHITE, 1),
    );
    expect(requests.slice(0, TRAIL_MAX).every((r) => r.evicted === undefined)).toBe(true);
    // The ninth releases owner 0, the oldest, and takes its slot.
    expect(requests[TRAIL_MAX]?.evicted).toBe(0);
    expect(requests[TRAIL_MAX]?.trail).toBe(requests[0]?.trail);
    expect(set.live).toBe(TRAIL_MAX);
    expect(
      set.trails
        .filter((t) => t.live)
        .map((t) => t.owner)
        .sort((a, b) => a - b),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // The next one releases owner 1.
    expect(set.request(9, 'arrow', WHITE, 0.2).evicted).toBe(1);
  });

  it('reuses a released slot before evicting, and a recycled trail starts empty', () => {
    const set = new TrailSet();
    const first = set.request(1, 'swing', WHITE, 1);
    first.trail.push(at(0), at(1));
    for (let i = 2; i <= TRAIL_MAX; i++) set.request(i, 'swing', WHITE, 1);
    set.release(first.trail);
    set.release(first.trail);
    expect(set.live).toBe(TRAIL_MAX - 1);
    const again = set.request(99, 'swing', WHITE, 1);
    expect(again.evicted).toBeUndefined();
    expect(again.trail).toBe(first.trail);
    expect(again.trail.length).toBe(0);
  });
});
