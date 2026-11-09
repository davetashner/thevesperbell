import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import { MAX_MAGIC_PULSE_HZ } from '@render/magic-materials/rules';
import { arrowImpact, World, type ArrowImpactInfo, type EntityId } from '@sim/index';
import {
  arrowBreaks,
  ArrowFx,
  BROKEN_SHAFT_MS,
  brokenShaftOpacity,
  MAX_BROKEN,
  MAX_DECALS,
  MAX_RINGS,
  MAX_ROPES,
  NOISE_RING_INTERVAL_S,
  NOISE_RING_LIFE_S,
  noiseOf,
  noiseRingAt,
  noiseRingRadius,
  noiseRingStarts,
  ROPE_LIFE_S,
  ropeAt,
  ropeLengthOf,
  STUCK_WOBBLE_MS,
  WET_DECAL_MS,
  wetDecalOpacity,
  wetRadius,
  withWobble,
  wobbleAngle,
  WOBBLE_AMPLITUDE,
} from './arrow-fx';

const content = loadGameContent();
const ARROWS = content.all('arrow');
const def = (id: string) => content.get('arrow', id);

const V = (x: number, y: number, z: number) => ({ x, y, z });

function setup(options: { reduced?: boolean; breakShaft?: (e: EntityId) => boolean } = {}) {
  const world = new World<never>({ seed: 1 });
  let now = 1000;
  const fx = new ArrowFx({
    world,
    arrows: ARROWS,
    now: () => now,
    reducedMotion: () => options.reduced === true,
    ...(options.breakShaft !== undefined && { breakShaft: options.breakShaft }),
  });
  const off = fx.attach();
  const arrowEntity = world.spawn();
  const impact = (
    arrow: string,
    outcome: ArrowImpactInfo['outcome'],
    more: Partial<ArrowImpactInfo> = {},
  ) => {
    world.events.emit(arrowImpact, {
      tick: 0,
      entity: arrowEntity,
      arrow,
      shooter: null,
      other: null,
      material: 'stone',
      hardness: 'hard',
      outcome,
      speed: 30,
      energy: 20,
      impulse: 1,
      normal: V(0, 1, 0),
      position: V(2, 0, -3),
      ...more,
    });
    world.events.flush();
  };
  return {
    world,
    fx,
    off,
    arrowEntity,
    impact,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('arrow payload readers (mw-e29.11)', () => {
  it('reads what each shipped arrow does from its payload, not its name', () => {
    expect(wetRadius(def('water'))).toBe(1.5);
    expect(wetRadius(def('fire'))).toBe(0);
    expect(noiseOf(def('noise'))).toEqual({ loudness: 70, duration: 2 });
    expect(noiseOf(def('water'))).toBeUndefined();
    expect(ropeLengthOf(def('rope'))).toBe(8);
    expect(ropeLengthOf(def('fire'))).toBeUndefined();
  });

  it('a payload that dries (wetness false) draws no decal; a rope with no length defaults', () => {
    expect(
      wetRadius({
        payload: [{ op: 'applyProperty', property: 'wetness', value: false, radius: 2 }],
      }),
    ).toBe(0);
    expect(ropeLengthOf({ payload: [{ op: 'spawn', entity: 'rope' }] })).toBe(4);
    expect(ropeLengthOf({ payload: [{ op: 'spawn', entity: 'torch' }] })).toBeUndefined();
  });

  it('an arrow breaks when it shattered, or rests and cannot be picked up; never on a ricochet', () => {
    expect(arrowBreaks({ retrievable: true }, 'shatter')).toBe(true);
    expect(arrowBreaks({ retrievable: true }, 'stick')).toBe(false);
    expect(arrowBreaks({ retrievable: false }, 'stick')).toBe(true);
    expect(arrowBreaks({ retrievable: false }, 'drop')).toBe(true);
    expect(arrowBreaks({ retrievable: false }, 'ricochet')).toBe(false);
  });
});

describe('wobble (mw-e29.11)', () => {
  it('AC-2: quivers for 400 ms, dies away, and is exactly still outside the window', () => {
    expect(STUCK_WOBBLE_MS).toBe(400);
    expect(wobbleAngle(-1, false)).toBe(0);
    expect(wobbleAngle(0, false)).toBe(0);
    expect(wobbleAngle(399, false)).not.toBe(0);
    expect(wobbleAngle(400, false)).toBe(0);
    expect(wobbleAngle(5000, false)).toBe(0);
    let early = 0;
    let late = 0;
    for (let t = 0; t < 100; t += 2) early = Math.max(early, Math.abs(wobbleAngle(t, false)));
    for (let t = 300; t < 400; t += 2) late = Math.max(late, Math.abs(wobbleAngle(t, false)));
    expect(early).toBeGreaterThan(late);
    expect(early).toBeLessThanOrEqual(WOBBLE_AMPLITUDE);
  });

  it('reduced motion holds the arrow still', () => {
    expect(wobbleAngle(50, true)).toBe(0);
  });

  it('turns the shaft about its own sideways axis, and not at all for 0', () => {
    const identity = { x: 0, y: 0, z: 0, w: 1 };
    expect(withWobble(identity, 0)).toEqual(identity);
    const q = withWobble(identity, 0.2);
    expect(q.x).toBeCloseTo(Math.sin(0.1));
    expect(q.w).toBeCloseTo(Math.cos(0.1));
    expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1);
    // A turn about y first, then the quiver: still a unit quaternion.
    const turned = withWobble({ x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 }, 0.3);
    expect(Math.hypot(turned.x, turned.y, turned.z, turned.w)).toBeCloseTo(1);
  });
});

describe('decals, rings, ropes and broken shafts (mw-e29.11)', () => {
  it('wet decal fades in, holds, then dries out', () => {
    expect(wetDecalOpacity(-1)).toBe(0);
    expect(wetDecalOpacity(0)).toBe(0);
    expect(wetDecalOpacity(100)).toBeGreaterThan(0);
    expect(wetDecalOpacity(5000)).toBeCloseTo(0.4);
    expect(wetDecalOpacity(WET_DECAL_MS - 1000)).toBeLessThan(0.4);
    expect(wetDecalOpacity(WET_DECAL_MS)).toBe(0);
  });

  it('noise rings never come faster than the shared 2 Hz pulse ceiling', () => {
    const starts = noiseRingStarts(2, false);
    expect(starts.length).toBeGreaterThan(1);
    for (let i = 1; i < starts.length; i++) {
      expect((starts[i] ?? 0) - (starts[i - 1] ?? 0)).toBeGreaterThanOrEqual(
        1 / MAX_MAGIC_PULSE_HZ - 1e-9,
      );
    }
    expect(NOISE_RING_INTERVAL_S).toBeGreaterThanOrEqual(1 / MAX_MAGIC_PULSE_HZ);
    // Even a very long noise: still spaced, so never more than 2 starts in any half second.
    const long = noiseRingStarts(60, false);
    for (let i = 2; i < long.length; i++) {
      expect((long[i] ?? 0) - (long[i - 2] ?? 0)).toBeGreaterThan(0.5);
    }
  });

  it('an instant noise, or reduced motion, makes one ring', () => {
    expect(noiseRingStarts(0, false)).toEqual([0]);
    expect(noiseRingStarts(2, true)).toEqual([0]);
  });

  it('a ring grows and fades; reduced motion holds it still', () => {
    expect(noiseRingAt(-0.1, 4, false).opacity).toBe(0);
    expect(noiseRingAt(NOISE_RING_LIFE_S, 4, false).opacity).toBe(0);
    const a = noiseRingAt(0.1, 4, false);
    const b = noiseRingAt(0.6, 4, false);
    expect(b.radius).toBeGreaterThan(a.radius);
    expect(b.opacity).toBeLessThan(a.opacity);
    expect(noiseRingAt(0.1, 4, true).radius).toBe(noiseRingAt(0.6, 4, true).radius);
    expect(noiseRingRadius(70)).toBeCloseTo(4.5);
    expect(noiseRingRadius(500)).toBe(6);
  });

  it('a rope unfurls fast then hangs and fades', () => {
    expect(ropeAt(-1).opacity).toBe(0);
    expect(ropeAt(ROPE_LIFE_S).opacity).toBe(0);
    expect(ropeAt(0.2).unfurled).toBeGreaterThan(0.2 / 0.7);
    expect(ropeAt(1).unfurled).toBe(1);
    expect(ropeAt(ROPE_LIFE_S - 0.1).opacity).toBeLessThan(ropeAt(1).opacity);
  });

  it('a broken shaft stays a while, then fades out', () => {
    expect(brokenShaftOpacity(-1)).toBe(0);
    expect(brokenShaftOpacity(1000)).toBe(1);
    expect(brokenShaftOpacity(BROKEN_SHAFT_MS - 500)).toBeLessThan(1);
    expect(brokenShaftOpacity(BROKEN_SHAFT_MS)).toBe(0);
  });
});

describe('ArrowFx (mw-e29.11)', () => {
  it('AC-1: a water arrow impact leaves a wet decal at the 1.5 m radius its payload wets', () => {
    const { fx, impact, advance } = setup();
    impact('water', 'shatter', { position: V(1, 0, 2), normal: V(0, 1, 0) });
    advance(200);
    fx.frame();
    expect(fx.view.decals).toHaveLength(1);
    expect(fx.view.decals[0]).toMatchObject({ x: 1, y: 0, z: 2, ny: 1, radius: 1.5 });
    expect(fx.view.decals[0]?.opacity).toBeGreaterThan(0);
    advance(WET_DECAL_MS);
    fx.frame();
    expect(fx.view.decals).toHaveLength(0);
  });

  it('no decal when a water arrow hits a creature, nor for arrows that wet nothing', () => {
    const { fx, impact } = setup();
    impact('water', 'shatter', { hurtbox: 'torso', other: 7 });
    impact('standard', 'stick');
    fx.frame();
    expect(fx.view.decals).toHaveLength(0);
  });

  it('forgets the oldest decals past the cap, and ignores arrows it does not know', () => {
    const { fx, impact } = setup();
    for (let i = 0; i < MAX_DECALS + 3; i++) impact('water', 'shatter', { position: V(i, 0, 0) });
    impact('mystery', 'stick');
    fx.frame();
    expect(fx.view.decals).toHaveLength(MAX_DECALS);
    expect(fx.view.decals[0]?.x).toBe(3);
  });

  it('AC-2: an arrow that sticks intact wobbles for 400 ms, then stands still', () => {
    const { fx, impact, advance, arrowEntity } = setup();
    impact('standard', 'stick');
    expect(fx.wobbling).toBe(1);
    expect(fx.wobblesStarted).toBe(1);
    advance(20);
    expect(Math.abs(fx.wobble(arrowEntity))).toBeGreaterThan(0);
    advance(379);
    expect(fx.wobble(arrowEntity)).not.toBe(0);
    advance(2);
    expect(fx.wobble(arrowEntity)).toBe(0);
    fx.frame();
    expect(fx.wobbling).toBe(0);
    expect(fx.wobble(arrowEntity)).toBe(0);
  });

  it('does not wobble under reduced motion, nor on a ricochet; and drops a wobble when the arrow goes', () => {
    const reduced = setup({ reduced: true });
    reduced.impact('standard', 'stick');
    reduced.advance(20);
    expect(reduced.fx.wobble(reduced.arrowEntity)).toBe(0);
    const ric = setup();
    ric.impact('standard', 'ricochet');
    expect(ric.fx.wobbling).toBe(0);
    const gone = setup();
    gone.impact('standard', 'stick');
    gone.world.destroy(gone.arrowEntity);
    gone.fx.frame();
    expect(gone.fx.wobbling).toBe(0);
  });

  it('AC-2: a shattered arrow leaves the broken shaft in the surface, then it fades out', () => {
    const { fx, impact, advance } = setup();
    impact('water', 'shatter', { normal: V(0, 0, 1), position: V(1, 2, 3) });
    fx.frame();
    expect(fx.view.broken).toHaveLength(1);
    expect(fx.view.broken[0]).toMatchObject({ x: 1, y: 2, z: 3, dz: -1, opacity: 1 });
    advance(BROKEN_SHAFT_MS - 100);
    fx.frame();
    expect(fx.view.broken[0]?.opacity).toBeLessThan(1);
    advance(200);
    fx.frame();
    expect(fx.view.broken).toHaveLength(0);
  });

  it('a shattered arrow on a creature leaves no stub hanging in the air; and the cap holds', () => {
    const { fx, impact } = setup();
    impact('water', 'shatter', { hurtbox: 'torso', other: 7 });
    fx.frame();
    expect(fx.view.broken).toHaveLength(0);
    for (let i = 0; i < MAX_BROKEN + 2; i++) impact('water', 'shatter', { position: V(i, 0, 0) });
    fx.frame();
    expect(fx.view.broken).toHaveLength(MAX_BROKEN);
  });

  it('AC-2: a non-retrievable arrow that comes to rest swaps its bound shaft for the broken one', () => {
    const swapped: EntityId[] = [];
    let ready = false;
    const { world, fx, impact, arrowEntity } = setup({
      breakShaft: (entity) => {
        if (!ready) return false;
        swapped.push(entity);
        return true;
      },
    });
    const custom = { ...def('standard'), id: 'brittle', retrievable: false };
    const fx2 = new ArrowFx({
      world,
      arrows: [custom],
      now: () => 0,
      breakShaft: (entity) => {
        if (!ready) return false;
        swapped.push(entity);
        return true;
      },
    });
    fx2.attach();
    impact('brittle', 'stick'); // both listeners hear it; only fx2 knows this arrow
    expect(fx2.breaking).toBe(1);
    expect(fx2.wobbling).toBe(0);
    fx2.frame();
    expect(swapped).toEqual([]); // no shaft bound yet: kept for the next frame
    expect(fx2.breaking).toBe(1);
    ready = true;
    fx2.frame();
    expect(swapped).toEqual([arrowEntity]);
    expect(fx2.breaking).toBe(0);
    expect(fx.breaking).toBe(0);
  });

  it('forgets a pending swap when the arrow leaves the world, or when nothing can swap', () => {
    const world = new World<never>({ seed: 1 });
    const custom = { ...def('standard'), id: 'brittle', retrievable: false };
    const fx = new ArrowFx({ world, arrows: [custom], now: () => 0 });
    fx.attach();
    const a = world.spawn();
    const b = world.spawn();
    for (const entity of [a, b]) {
      world.events.emit(arrowImpact, {
        tick: 0,
        entity,
        arrow: 'brittle',
        shooter: null,
        other: null,
        material: 'stone',
        hardness: 'hard',
        outcome: 'stick',
        speed: 1,
        energy: 1,
        impulse: 1,
        normal: V(0, 1, 0),
        position: V(0, 0, 0),
      });
    }
    world.events.flush();
    expect(fx.breaking).toBe(2);
    world.destroy(a);
    fx.frame();
    expect(fx.breaking).toBe(1); // b has no swap hook to call, so it waits
    world.destroy(b);
    fx.frame();
    expect(fx.breaking).toBe(0);
  });

  it('a noise arrow rings at most twice a second, each ring growing and fading', () => {
    const { fx, impact, advance } = setup();
    impact('noise', 'ricochet', { position: V(4, 0, 4) });
    const startsSeen = new Set<number>();
    for (let ms = 0; ms < 2600; ms += 50) {
      fx.frame();
      for (const ring of fx.view.rings) {
        expect(ring).toMatchObject({ x: 4, z: 4, ny: 1 });
        expect(ring.radius).toBeLessThanOrEqual(noiseRingRadius(70));
        startsSeen.add(Math.round(ring.radius * 1000));
      }
      // Never more than one ring per 0.5 s of a 0.9 s life: at most 2 alive at once.
      expect(fx.view.rings.length).toBeLessThanOrEqual(2);
      advance(50);
    }
    expect(startsSeen.size).toBeGreaterThan(5);
    advance(500);
    fx.frame();
    expect(fx.view.rings).toHaveLength(0);
  });

  it('a noise arrow under reduced motion shows one still ring that only fades', () => {
    const { fx, impact, advance } = setup({ reduced: true });
    impact('noise', 'ricochet');
    fx.frame();
    const first = fx.view.rings[0];
    advance(400);
    fx.frame();
    expect(fx.view.rings).toHaveLength(1);
    expect(fx.view.rings[0]?.radius).toBe(first?.radius);
    expect(fx.view.rings[0]?.opacity).toBeLessThan(first?.opacity ?? 0);
  });

  it('noises landing together (a bouncing arrow) still ring no faster than the ceiling', () => {
    const { fx, impact, advance } = setup();
    for (let i = 0; i < 6; i++) impact('noise', 'ricochet', { position: V(i, 0, 0) });
    const starts: number[] = [];
    let alive = 0;
    for (let ms = 0; ms < 4000; ms += 20) {
      fx.frame();
      const now = fx.view.rings.length;
      // A ring appearing is a pulse; count appearances over a sliding half second.
      if (now > alive) starts.push(ms);
      alive = now;
      expect(now).toBeLessThanOrEqual(MAX_RINGS);
      advance(20);
    }
    expect(starts.length).toBeGreaterThan(2);
    for (let i = 1; i < starts.length; i++) {
      expect((starts[i] ?? 0) - (starts[i - 1] ?? 0)).toBeGreaterThanOrEqual(500);
    }
  });

  it('skips rings that would have to wait too long behind the others', () => {
    const { fx, impact } = setup();
    for (let i = 0; i < 20; i++) impact('noise', 'ricochet', { position: V(i, 0, 0) });
    fx.frame();
    expect(fx.view.rings.length).toBeLessThanOrEqual(MAX_RINGS);
  });

  it('a rope arrow unfurls a ribbon down its rope length from where it stuck', () => {
    const { fx, impact, advance } = setup();
    impact('rope', 'stick', { position: V(1, 3, -2) });
    advance(100);
    fx.frame();
    const early = fx.view.ropes[0];
    expect(early).toMatchObject({ x: 1, y: 3, z: -2 });
    expect(early?.length).toBeGreaterThan(0);
    expect(early?.length).toBeLessThan(8);
    advance(800);
    fx.frame();
    expect(fx.view.ropes[0]?.length).toBe(8);
    advance(ROPE_LIFE_S * 1000);
    fx.frame();
    expect(fx.view.ropes).toHaveLength(0);
  });

  it('a rope arrow that bounces off unfurls nothing; ropes are capped', () => {
    const { fx, impact } = setup();
    impact('rope', 'ricochet');
    fx.frame();
    expect(fx.view.ropes).toHaveLength(0);
    for (let i = 0; i < MAX_ROPES + 2; i++) impact('rope', 'stick', { position: V(i, 0, 0) });
    fx.frame();
    expect(fx.view.ropes).toHaveLength(MAX_ROPES);
  });

  it('stops listening when told to, and attaching twice listens once', () => {
    const { fx, off, impact } = setup();
    fx.attach();
    impact('water', 'shatter');
    fx.frame();
    expect(fx.view.decals).toHaveLength(1);
    off();
    off();
    impact('water', 'shatter', { position: V(9, 0, 0) });
    fx.frame();
    expect(fx.view.decals).toHaveLength(1);
  });
});
