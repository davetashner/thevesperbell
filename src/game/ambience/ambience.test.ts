import { describe, expect, it } from 'vitest';
import type { PlayOptions, SoundHandle } from '@audio/index';
import { AMBIENCE_CROSSFADE_S } from '@content/index';
import { Rng } from '@sim/index';
import {
  AmbienceController,
  OneShotSchedule,
  equalPowerGain,
  placeZones,
  spawnInAnnulus,
  zoneAt,
  type AmbienceEngine,
  type PlacedZone,
} from './ambience.ts';

const v = (x: number, y = 0, z = 0) => ({ x, y, z });
const rngOf = (seed: number) => {
  const rng = Rng.create(seed).stream('ambience');
  return () => rng.float();
};

interface FakeHandle extends SoundHandle {
  volume: number;
  stopped: boolean;
  stopFade: number | undefined;
}

function fakeEngine(state = 'running', missing: readonly string[] = []) {
  const plays: { cue: string; options: PlayOptions | undefined }[] = [];
  const handles: FakeHandle[] = [];
  let ctx = state;
  const engine: AmbienceEngine = {
    get context() {
      return ctx === 'none' ? undefined : { state: ctx };
    },
    play: (cue, options) => {
      plays.push({ cue, options });
      if (missing.includes(cue)) return null;
      const handle: FakeHandle = {
        cueId: cue,
        state: 'playing',
        volume: options?.volume ?? 1,
        stopped: false,
        stopFade: undefined,
        stop(fade) {
          this.stopped = true;
          this.stopFade = fade;
        },
        fade(volume) {
          this.volume = volume;
        },
      };
      handles.push(handle);
      return handle;
    },
  };
  return {
    engine,
    plays,
    handles,
    setState: (next: string) => {
      ctx = next;
    },
  };
}

const bedZone = (id: string, cue: string, gainDb = 0): PlacedZone['zone'] => ({
  id,
  bed: { cue, gainDb },
  oneShots: [],
});

const west: PlacedZone = {
  zone: bedZone('west', 'amb-west'),
  box: { min: v(-20, -5, -20), max: v(0, 5, 20) },
};
const east: PlacedZone = {
  zone: bedZone('east', 'amb-east'),
  box: { min: v(0.001, -5, -20), max: v(20, 5, 20) },
};

describe('OneShotSchedule (mw-e28.13)', () => {
  it('AC-1: every gap of a 4–9 s one-shot is within [4, 9] s over 10 minutes', () => {
    const schedule = new OneShotSchedule(4, 9, rngOf(7), 0);
    const times: number[] = [];
    for (let t = 0; t <= 600; t += 1 / 60) {
      const fired = schedule.due(t);
      if (fired !== undefined) times.push(fired);
    }
    expect(times.length).toBeGreaterThan(60);
    const gaps = times.slice(1).map((time, i) => time - (times[i] ?? 0));
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(4);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(9);
    expect(times[0]).toBeGreaterThanOrEqual(4);
    expect(times[0]).toBeLessThanOrEqual(9);
    // Fires within one frame of its schedule.
    expect(new Set(gaps.map((g) => Math.round(g * 1000))).size).toBeGreaterThan(10);
  });

  it('AC-1: the same seed gives the same schedule', () => {
    const run = (seed: number) => {
      const schedule = new OneShotSchedule(4, 9, rngOf(seed), 0);
      const out: number[] = [];
      for (let t = 0; t < 120; t += 0.1) {
        const fired = schedule.due(t);
        if (fired !== undefined) out.push(fired);
      }
      return out;
    };
    expect(run(3)).toEqual(run(3));
    expect(run(3)).not.toEqual(run(4));
  });

  it('a long stall fires once and reschedules from the present instead of bursting', () => {
    const schedule = new OneShotSchedule(4, 9, rngOf(1), 0);
    expect(schedule.due(600)).toBeDefined();
    expect(schedule.due(600)).toBeUndefined();
    expect(schedule.due(600.5)).toBeUndefined();
    expect(schedule.due(610)).toBeDefined();
  });
});

describe('spawnInAnnulus (mw-e28.13)', () => {
  it('AC-3: every spawn of a 10–25 m one-shot lies inside the annulus around the listener', () => {
    const random = rngOf(11);
    const listener = v(3, 1.5, -8);
    let nearest = Infinity;
    let farthest = 0;
    for (let i = 0; i < 5000; i++) {
      const p = spawnInAnnulus(listener, 10, 25, 0, random);
      const d = Math.hypot(p.x - listener.x, p.z - listener.z);
      expect(d).toBeGreaterThanOrEqual(10 - 1e-9);
      expect(d).toBeLessThanOrEqual(25 + 1e-9);
      expect(p.y).toBe(listener.y);
      nearest = Math.min(nearest, d);
      farthest = Math.max(farthest, d);
    }
    // And it uses the whole ring, not a corner of it.
    expect(nearest).toBeLessThan(11);
    expect(farthest).toBeGreaterThan(24);
  });

  it('lifts the spawn by the height', () => {
    expect(spawnInAnnulus(v(0, 1, 0), 1, 2, 3, () => 0.5).y).toBe(4);
  });
});

describe('zones', () => {
  it('equalPowerGain traces sin(p·π/2) and clamps', () => {
    expect(equalPowerGain(0)).toBe(0);
    expect(equalPowerGain(1)).toBe(1);
    expect(equalPowerGain(0.5) ** 2 + equalPowerGain(0.5) ** 2).toBeCloseTo(1, 12);
    expect(equalPowerGain(-1)).toBe(0);
    expect(equalPowerGain(2)).toBe(1);
  });

  it('zoneAt finds the last containing zone, or none, and a box-less zone covers everything', () => {
    const all: PlacedZone = { zone: bedZone('all', 'amb-all') };
    expect(zoneAt([west, east], v(-5))?.zone.id).toBe('west');
    expect(zoneAt([west, east], v(5))?.zone.id).toBe('east');
    expect(zoneAt([west, east], v(50))).toBeUndefined();
    expect(zoneAt([west, east], v(-5, 0, 99))).toBeUndefined();
    expect(zoneAt([all, west], v(-5))?.zone.id).toBe('west');
    expect(zoneAt([all, west], v(50))?.zone.id).toBe('all');
    expect(zoneAt([], v(0))).toBeUndefined();
  });

  it('placeZones puts each entry over its region, or the whole scene', () => {
    const regions = [{ id: 'cave', min: v(0), max: v(4, 4, 4) }];
    const zones = new Map([
      ['a', bedZone('a', 'amb-a')],
      ['b', bedZone('b', 'amb-b')],
    ]);
    const placed = placeZones(
      { ambience: [{ zone: { id: 'a' }, region: 'cave' }, { zone: { id: 'b' } }] },
      regions,
      (id) => {
        const zone = zones.get(id);
        if (zone === undefined) throw new Error(id);
        return zone;
      },
    );
    expect(placed[0]?.zone.id).toBe('a');
    expect(placed[0]?.box).toEqual({ min: v(0), max: v(4, 4, 4) });
    expect(placed[1]?.box).toBeUndefined();
    const lost = placeZones({ ambience: [{ zone: { id: 'a' }, region: 'gone' }] }, regions, () =>
      bedZone('a', 'amb-a'),
    );
    expect(lost[0]?.box).toBeUndefined();
  });
});

describe('AmbienceController (mw-e28.13)', () => {
  it('AC-2: crossing between zones crossfades beds over 2 s with no loudness gap over 3 dB', () => {
    const t = fakeEngine();
    const ambience = new AmbienceController({
      engine: t.engine,
      zones: [west, east],
      random: rngOf(5),
    });
    const dt = 1 / 60;
    let now = 0;
    const frame = (x: number) => {
      ambience.update(v(x), now);
      now += dt;
    };
    for (let i = 0; i < 150; i++) frame(-5);
    const bedWest = t.handles[0];
    expect(bedWest?.volume).toBeCloseTo(1, 9);
    expect(t.handles).toHaveLength(1);
    // Cross the boundary and sample the combined power each frame.
    let worstDb = 0;
    const crossStart = now;
    let frames = 0;
    while (now - crossStart < AMBIENCE_CROSSFADE_S + 0.5) {
      frame(5);
      const west2 = t.handles[0]?.volume ?? 0;
      const east2 = t.handles[1]?.volume ?? 0;
      const db = 10 * Math.log10(west2 ** 2 + east2 ** 2);
      worstDb = Math.max(worstDb, Math.abs(db));
      frames++;
      if (now - crossStart < AMBIENCE_CROSSFADE_S - 2 * dt) {
        expect(t.handles[1]?.volume).toBeLessThan(1);
        expect(t.handles[0]?.stopped).toBe(false);
      }
    }
    expect(frames).toBeGreaterThan(100);
    expect(worstDb).toBeLessThan(3);
    // A frame-by-frame equal-power ramp is far tighter than the 3 dB bound.
    expect(worstDb).toBeLessThan(0.05);
    expect(t.handles[0]?.stopped).toBe(true);
    expect(t.handles[1]?.volume).toBeCloseTo(1, 9);
    expect(ambience.state).toEqual({ zone: 'east', beds: ['amb-east'] });
  });

  it('crossing back mid-fade carries on from the current level without a jump', () => {
    const t = fakeEngine();
    const ambience = new AmbienceController({
      engine: t.engine,
      zones: [west, east],
      random: rngOf(5),
    });
    let now = 0;
    const frame = (x: number) => {
      ambience.update(v(x), now);
      now += 1 / 60;
    };
    for (let i = 0; i < 150; i++) frame(-5);
    for (let i = 0; i < 60; i++) frame(5);
    const before = t.handles[0]?.volume ?? 0;
    frame(-5);
    expect(Math.abs((t.handles[0]?.volume ?? 0) - before)).toBeLessThan(0.05);
    for (let i = 0; i < 200; i++) frame(-5);
    expect(t.handles[0]?.volume).toBeCloseTo(1, 9);
    expect(t.plays.map((p) => p.cue)).toEqual(['amb-west', 'amb-east']);
  });

  it('leaving every zone fades the bed out; zones sharing a bed carry it on', () => {
    const t = fakeEngine();
    const same: PlacedZone = {
      zone: bedZone('east-too', 'amb-west'),
      box: { min: v(0.001, -5, -20), max: v(20, 5, 20) },
    };
    const ambience = new AmbienceController({
      engine: t.engine,
      zones: [west, same],
      random: rngOf(5),
    });
    let now = 0;
    const frame = (x: number) => {
      ambience.update(v(x), now);
      now += 1 / 60;
    };
    for (let i = 0; i < 200; i++) frame(-5);
    for (let i = 0; i < 200; i++) frame(5);
    expect(t.plays).toHaveLength(1);
    expect(t.handles[0]?.volume).toBeCloseTo(1, 9);
    for (let i = 0; i < 200; i++) frame(90);
    expect(t.handles[0]?.stopped).toBe(true);
    expect(ambience.state).toEqual({ zone: undefined, beds: [] });
  });

  it('applies the bed trim in dB', () => {
    const t = fakeEngine();
    const quiet: PlacedZone = { zone: bedZone('quiet', 'amb-quiet', -6) };
    const ambience = new AmbienceController({ engine: t.engine, zones: [quiet], random: rngOf(1) });
    for (let i = 0; i < 200; i++) ambience.update(v(0), i / 60);
    expect(t.handles[0]?.volume).toBeCloseTo(10 ** (-6 / 20), 9);
  });

  it('stays silent until the audio context is running, then starts', () => {
    const t = fakeEngine('suspended');
    const ambience = new AmbienceController({ engine: t.engine, zones: [west], random: rngOf(1) });
    ambience.update(v(-5), 0);
    expect(t.plays).toEqual([]);
    t.setState('running');
    ambience.update(v(-5), 1);
    expect(t.plays.map((p) => p.cue)).toEqual(['amb-west']);
    const none = fakeEngine('none');
    new AmbienceController({ engine: none.engine, zones: [west], random: rngOf(1) }).update(
      v(-5),
      0,
    );
    expect(none.plays).toEqual([]);
  });

  it('skips a missing bed quietly and keeps running', () => {
    const t = fakeEngine('running', ['amb-west']);
    const ambience = new AmbienceController({
      engine: t.engine,
      zones: [west, east],
      random: rngOf(1),
    });
    expect(() => {
      for (let i = 0; i < 10; i++) ambience.update(v(-5), i / 60);
      for (let i = 0; i < 10; i++) ambience.update(v(5), 1 + i / 60);
    }).not.toThrow();
    expect(ambience.state.beds).toEqual(['amb-east']);
  });

  it('fires the zone’s one-shots on schedule at positions in their annulus, and stops on leaving', () => {
    const t = fakeEngine();
    const zone: PlacedZone = {
      zone: {
        id: 'cave',
        bed: undefined,
        oneShots: [
          {
            cue: 'amb-drip',
            minIntervalS: 4,
            maxIntervalS: 9,
            minRadius: 10,
            maxRadius: 25,
            height: 2,
            gainDb: -6,
          },
        ],
      },
      box: { min: v(-20, -5, -20), max: v(20, 5, 20) },
    };
    const ambience = new AmbienceController({ engine: t.engine, zones: [zone], random: rngOf(9) });
    const listener = v(1, 0.5, 2);
    const times: number[] = [];
    for (let now = 0; now < 600; now += 1 / 60) {
      const before = t.plays.length;
      ambience.update(listener, now);
      if (t.plays.length > before) times.push(now);
    }
    expect(t.plays.length).toBe(times.length);
    expect(times.length).toBeGreaterThan(60);
    for (const { cue, options } of t.plays) {
      expect(cue).toBe('amb-drip');
      const p = options?.position;
      const d = Math.hypot((p?.x ?? 0) - listener.x, (p?.z ?? 0) - listener.z);
      expect(d).toBeGreaterThanOrEqual(10 - 1e-9);
      expect(d).toBeLessThanOrEqual(25 + 1e-9);
      expect(p?.y).toBe(2.5);
      expect(options?.volume).toBeCloseTo(10 ** (-6 / 20), 9);
    }
    const count = t.plays.length;
    for (let now = 600; now < 700; now += 1 / 60) ambience.update(v(90), now);
    expect(t.plays.length).toBe(count);
  });

  it('dispose fades the beds out and forgets the zone', () => {
    const t = fakeEngine();
    const ambience = new AmbienceController({ engine: t.engine, zones: [west], random: rngOf(1) });
    ambience.update(v(-5), 0);
    ambience.dispose();
    expect(t.handles[0]?.stopFade).toBe(AMBIENCE_CROSSFADE_S);
    expect(ambience.state).toEqual({ zone: undefined, beds: [] });
  });

  it('a zero-length crossfade switches at once', () => {
    const t = fakeEngine();
    const ambience = new AmbienceController({
      engine: t.engine,
      zones: [west, east],
      random: rngOf(1),
      crossfadeS: 0,
    });
    ambience.update(v(-5), 0);
    ambience.update(v(5), 0.1);
    expect(t.handles[0]?.stopped).toBe(true);
    expect(t.handles[1]?.volume).toBe(1);
  });
});
