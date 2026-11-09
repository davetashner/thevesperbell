// mw-e29.12: the awareness indicator rules, the last-known-position ghost and the noise ripple.
import { describe, expect, it } from 'vitest';
import {
  BrainComponent,
  CreatureNavComponent,
  DAMAGE_COMPONENTS,
  entitySource,
  giveCombatant,
  HealthComponent,
  noiseEmitted,
  PlacementComponent,
  World,
  type Brain,
  type EntityId,
  type MemoryRecord,
  type NoiseEvent,
  type Vec3,
} from '@sim/index';
import { MAX_MAGIC_PULSE_HZ } from '@render/magic-materials/rules';
import { at } from './indexing.ts';
import { defaultSettings, settingDefs } from '../settings/index.ts';
import {
  ALARM_PULSE_HZ,
  AwarenessFx,
  DEFAULT_HEAD_M,
  ghostOpacity,
  GHOST_MAX_OPACITY,
  GHOST_MIN_OPACITY,
  indicatorFill,
  indicatorPulse,
  indicatorRangeFade,
  indicatorScale,
  INDICATOR_FADE_M,
  INDICATOR_LIFT_M,
  INDICATOR_MAX_SCALE,
  INDICATOR_MIN_SCALE,
  INDICATOR_RANGE_M,
  MAX_RIPPLES,
  popIn,
  POP_IN_S,
  readAgents,
  rippleAt,
  rippleRadius,
  RIPPLE_INTERVAL_S,
  RIPPLE_LIFE_S,
  RIPPLE_MAX_RADIUS_M,
  RIPPLE_QUEUE_MS,
  RIPPLE_RANGE_M,
  showsGhost,
  showsIndicator,
  type AgentReading,
} from './awareness-fx.ts';

const CAMERA: Vec3 = { x: 0, y: 2, z: 0 };

function reading(over: Partial<AgentReading> = {}): AgentReading {
  return {
    entity: 1,
    state: 'suspicious',
    awareness: 0.4,
    feet: { x: 0, y: 0, z: 5 },
    height: 1.8,
    lkp: null,
    confidence: 0.5,
    targetVisible: false,
    ...over,
  };
}

function setup(
  agents: () => AgentReading[],
  opts: {
    ghost?: boolean;
    ripples?: boolean;
    reduced?: boolean;
    at?: Vec3 | undefined;
    friendly?: (entity: EntityId) => boolean;
  } = {},
) {
  const world = new World<never>({ seed: 1 });
  let now = 10_000;
  const fx = new AwarenessFx({
    world,
    now: () => now,
    agents: (into) => {
      into.length = 0;
      into.push(...agents());
      return into;
    },
    ghostEnabled: () => opts.ghost === true,
    ripplesEnabled: () => opts.ripples === true,
    reducedMotion: () => opts.reduced === true,
    listener: () => opts.at,
    ...(opts.friendly !== undefined && { friendly: opts.friendly }),
  });
  const noise = (p: Vec3, loudness = 70, kind = 'break'): void => {
    world.events.emit(noiseEmitted, {
      tick: 1,
      position: p,
      loudness,
      kind,
      entity: null,
      source: null,
    } satisfies NoiseEvent);
    world.events.flush();
  };
  return {
    world,
    fx,
    noise,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('indicator rules (mw-e29.12)', () => {
  it('every state but Unaware shows an indicator; only Suspicious fills with suspicion', () => {
    expect(showsIndicator('unaware')).toBe(false);
    for (const s of ['suspicious', 'investigating', 'searching', 'alerted', 'combat'] as const) {
      expect(showsIndicator(s)).toBe(true);
    }
    expect(indicatorFill('suspicious', 0.4)).toBe(0.4);
    expect(indicatorFill('suspicious', 7)).toBe(1);
    expect(indicatorFill('suspicious', -1)).toBe(0);
    expect(indicatorFill('searching', 0.2)).toBe(1);
  });

  it('grows with distance within limits, and fades out toward its range', () => {
    expect(indicatorScale(0)).toBe(INDICATOR_MIN_SCALE);
    expect(indicatorScale(10)).toBeCloseTo(2);
    expect(indicatorScale(500)).toBe(INDICATOR_MAX_SCALE);
    expect(indicatorRangeFade(INDICATOR_RANGE_M - INDICATOR_FADE_M)).toBe(1);
    expect(indicatorRangeFade(INDICATOR_RANGE_M - INDICATOR_FADE_M / 2)).toBeCloseTo(0.5);
    expect(indicatorRangeFade(INDICATOR_RANGE_M)).toBe(0);
    expect(indicatorRangeFade(1)).toBe(1);
  });

  it('pops in over a moment, and not at all with reduced motion', () => {
    expect(popIn(0, false)).toBeCloseTo(0.5);
    expect(popIn(POP_IN_S / 2, false)).toBeGreaterThan(0.5);
    expect(popIn(POP_IN_S, false)).toBe(1);
    expect(popIn(0, true)).toBe(1);
  });

  it('never pulses faster than 2 Hz: only Alerted and Combat breathe, below the ceiling, and reduced motion holds them still', () => {
    expect(ALARM_PULSE_HZ).toBeLessThanOrEqual(MAX_MAGIC_PULSE_HZ);
    for (const s of ['suspicious', 'investigating', 'searching'] as const) {
      expect(indicatorPulse(s, 0.123, false)).toBe(1);
    }
    for (const s of ['alerted', 'combat'] as const) {
      expect(indicatorPulse(s, 0.123, true)).toBe(1);
      const samples = Array.from({ length: 60 }, (_, i) => indicatorPulse(s, i / 60, false));
      expect(Math.min(...samples)).toBeLessThan(0.8);
      // Count sign changes of the slope over one second: two per cycle.
      let turns = 0;
      for (let i = 2; i < samples.length; i++) {
        const a = at(samples, i - 1) - at(samples, i - 2);
        const b = at(samples, i) - at(samples, i - 1);
        if (a * b < 0) turns++;
      }
      expect(turns / 2).toBeLessThanOrEqual(MAX_MAGIC_PULSE_HZ);
    }
  });

  it('a ghost shows for an alarmed creature that has lost its target, fainter as memory fades', () => {
    const lkp = { x: 1, y: 0, z: 1 };
    expect(showsGhost({ state: 'searching', lkp, targetVisible: false })).toBe(true);
    expect(showsGhost({ state: 'searching', lkp, targetVisible: true })).toBe(false);
    expect(showsGhost({ state: 'searching', lkp: null, targetVisible: false })).toBe(false);
    expect(showsGhost({ state: 'unaware', lkp, targetVisible: false })).toBe(false);
    expect(ghostOpacity(0)).toBe(GHOST_MIN_OPACITY);
    expect(ghostOpacity(1)).toBe(GHOST_MAX_OPACITY);
    expect(ghostOpacity(9)).toBe(GHOST_MAX_OPACITY);
  });

  it('a ripple reaches as far as its noise carries, capped, and grows then fades', () => {
    expect(rippleRadius(50)).toBeCloseTo(10);
    expect(rippleRadius(0)).toBe(0.5);
    expect(rippleRadius(120)).toBe(RIPPLE_MAX_RADIUS_M);
    expect(rippleAt(-1, 5, false)).toEqual({ radius: 0, opacity: 0 });
    expect(rippleAt(RIPPLE_LIFE_S, 5, false)).toEqual({ radius: 0, opacity: 0 });
    const early = rippleAt(0.1, 5, false);
    const late = rippleAt(1, 5, false);
    expect(late.radius).toBeGreaterThan(early.radius);
    expect(late.opacity).toBeLessThan(early.opacity);
    expect(rippleAt(0.1, 5, true).radius).toBe(5);
  });
});

describe('assist settings (mw-e29.12)', () => {
  it('AC-4: the last-known-position marker and the noise ripple are settings, both off by default and in the options menu', () => {
    const defaults = defaultSettings();
    expect(defaults.gameplay.lastKnownMarker).toBe(false);
    expect(defaults.gameplay.noiseRipples).toBe(false);
    const keys = settingDefs('gameplay').map((d) => d.key);
    expect(keys).toContain('gameplay.lastKnownMarker');
    expect(keys).toContain('gameplay.noiseRipples');
  });
});

describe('AwarenessFx', () => {
  it('draws an indicator over a Suspicious creature at its suspicion, and none for Unaware', () => {
    const agents = [reading({ entity: 1 }), reading({ entity: 2, state: 'unaware' })];
    const { fx } = setup(() => agents);
    fx.frame(CAMERA);
    expect(fx.view.indicators).toHaveLength(1);
    const [i] = fx.view.indicators;
    expect(i).toMatchObject({ entity: 1, state: 'suspicious', shape: 'disc', fill: 0.4 });
    expect(i?.y).toBeCloseTo(1.8 + INDICATOR_LIFT_M);
  });

  it('mw-e09.5: a friend of the player shows no indicator and no ghost, a stranger still does', () => {
    const agents = [
      reading({ entity: 1, lkp: { x: 1, y: 0, z: 1 } }),
      reading({ entity: 2, lkp: { x: 2, y: 0, z: 2 } }),
    ];
    const { fx } = setup(() => agents, { ghost: true, friendly: (e) => e === 1 });
    fx.frame(CAMERA);
    expect(fx.view.indicators.map((i) => i.entity)).toEqual([2]);
    expect(fx.view.ghosts).toHaveLength(1);
    expect(fx.view.ghosts[0]?.entity).toBe(2);
  });

  it('pops in on a state change only, and resets after the creature stands down', () => {
    let state: AgentReading['state'] = 'suspicious';
    const { fx, advance } = setup(() => [reading({ state })]);
    fx.frame(CAMERA);
    const first = fx.view.indicators[0]?.scale ?? 0;
    advance(1000);
    fx.frame(CAMERA);
    const settled = fx.view.indicators[0]?.scale ?? 0;
    expect(settled).toBeGreaterThan(first);
    state = 'alerted';
    fx.frame(CAMERA);
    expect(fx.view.indicators[0]?.scale).toBeLessThan(settled);
    advance(1000);
    state = 'unaware';
    fx.frame(CAMERA);
    expect(fx.view.indicators).toHaveLength(0);
    state = 'alerted';
    fx.frame(CAMERA);
    expect(fx.view.indicators[0]?.scale).toBeLessThan(settled);
  });

  it('drops an indicator out of range, but keeps its pop-in clock', () => {
    const { fx } = setup(() => [reading({ feet: { x: 0, y: 0, z: 90 } })]);
    fx.frame(CAMERA);
    expect(fx.view.indicators).toHaveLength(0);
  });

  it('reduced motion skips the pop-in and the alarm pulse', () => {
    const { fx } = setup(() => [reading({ state: 'combat' })], { reduced: true });
    fx.frame(CAMERA);
    expect(fx.view.indicators[0]).toMatchObject({ opacity: 1 });
    const { fx: full } = setup(() => [reading({ state: 'combat' })]);
    full.frame(CAMERA);
    expect(full.view.indicators[0]?.scale).toBeLessThan(fx.view.indicators[0]?.scale ?? 0);
  });

  it('the ghost marker is off by default, and on shows where the creature believes the target is', () => {
    const lkp = { x: 4, y: 0, z: 3 };
    const agents = [reading({ state: 'searching', lkp, confidence: 0.8 })];
    const off = setup(() => agents);
    off.fx.frame(CAMERA);
    expect(off.fx.view.ghosts).toHaveLength(0);
    const on = setup(() => agents, { ghost: true });
    on.fx.frame(CAMERA);
    expect(on.fx.view.ghosts).toEqual([
      { entity: 1, colour: 0xe8a24a, x: 4, y: 0, z: 3, opacity: ghostOpacity(0.8) },
    ]);
  });

  it('AC-4: with the noise ripple assist off (the default) a noise event draws no ripple', () => {
    const { fx, noise, advance } = setup(() => []);
    fx.attach();
    noise({ x: 1, y: 0, z: 1 });
    advance(100);
    fx.frame(CAMERA);
    expect(fx.view.ripples).toHaveLength(0);
    expect(fx.ripplesStarted).toBe(0);
  });

  it('with the assist on, a noise draws one ring that grows and fades out, and detaches cleanly', () => {
    const { fx, noise, advance } = setup(() => [], { ripples: true, at: { x: 0, y: 0, z: 0 } });
    const off = fx.attach();
    noise({ x: 3, y: 0, z: 4 }, 70);
    fx.frame(CAMERA);
    expect(fx.view.ripples).toHaveLength(1);
    const early = fx.view.ripples[0];
    expect(early).toMatchObject({ x: 3, z: 4 });
    advance(800);
    fx.frame(CAMERA);
    expect(fx.view.ripples[0]?.radius).toBeGreaterThan(early?.radius ?? 0);
    advance(600);
    fx.frame(CAMERA);
    expect(fx.view.ripples).toHaveLength(0);
    off();
    off();
    noise({ x: 3, y: 0, z: 4 });
    expect(fx.ripplesStarted).toBe(1);
  });

  it('mw-e09.5: footsteps ring only when heard at the player, and steady steps stay at the pulse ceiling', () => {
    const at = { x: 0, y: 0, z: 0 };
    const quiet = setup(() => [], { ripples: true, at });
    quiet.fx.attach();
    quiet.noise({ x: 0, y: 0, z: 0 }, 15, 'footstep'); // your own sneak
    quiet.noise({ x: 5, y: 0, z: 0 }, 40, 'footstep'); // a guard's walk 5 m off: 26 dB
    quiet.noise({ x: 5, y: 0, z: 0 }, 29, 'landing');
    expect(quiet.fx.ripplesStarted).toBe(0);
    quiet.noise({ x: 0, y: 0, z: 0 }, 55, 'footstep'); // your own run
    expect(quiet.fx.ripplesStarted).toBe(1);
    quiet.advance(1000);
    quiet.noise({ x: 2, y: 0, z: 0 }, 40, 'footstep'); // a guard's walk 2 m off: 34 dB
    expect(quiet.fx.ripplesStarted).toBe(2);
    quiet.advance(1000);
    quiet.noise({ x: 5, y: 0, z: 0 }, 40, 'break'); // other noises are untouched
    expect(quiet.fx.ripplesStarted).toBe(3);

    // Ten seconds of a walk, a step every 0.4 s, is about two rings a second, never a flood.
    const walk = setup(() => [], { ripples: true, at });
    walk.fx.attach();
    for (let i = 0; i < 25; i++) {
      walk.noise({ x: 0, y: 0, z: 0 }, 40, 'footstep');
      walk.advance(400);
    }
    expect(walk.fx.ripplesStarted).toBeGreaterThanOrEqual(15);
    expect(walk.fx.ripplesStarted).toBeLessThanOrEqual(21);
  });

  it('attaching twice listens once', () => {
    const { fx, noise } = setup(() => [], { ripples: true });
    fx.attach();
    fx.attach();
    noise({ x: 0, y: 0, z: 0 });
    expect(fx.ripplesStarted).toBe(1);
  });

  it('ignores noises beyond the listener range, and with no listener counts them all', () => {
    const near = setup(() => [], { ripples: true, at: { x: 0, y: 0, z: 0 } });
    near.fx.attach();
    near.noise({ x: RIPPLE_RANGE_M + 1, y: 0, z: 0 });
    expect(near.fx.ripplesStarted).toBe(0);
    const any = setup(() => [], { ripples: true });
    any.fx.attach();
    any.noise({ x: 500, y: 0, z: 0 });
    expect(any.fx.ripplesStarted).toBe(1);
  });

  it('never starts rings faster than the pulse ceiling: a burst is spaced out or dropped', () => {
    const { fx, noise, advance } = setup(() => [], { ripples: true });
    fx.attach();
    for (let i = 0; i < 10; i++) noise({ x: i, y: 0, z: 0 });
    // The first starts now, the second waits one interval, the rest would wait too long.
    expect(fx.ripplesStarted).toBe(2);
    // The second is queued: until its turn comes only the first is drawn.
    fx.frame(CAMERA);
    expect(fx.view.ripples).toHaveLength(1);
    advance(RIPPLE_INTERVAL_S * 1000 * 2);
    for (let i = 0; i < MAX_RIPPLES + 3; i++) {
      noise({ x: i, y: 0, z: 0 });
      advance(RIPPLE_INTERVAL_S * 1000);
    }
    fx.frame(CAMERA);
    expect(fx.view.ripples.length).toBeLessThanOrEqual(MAX_RIPPLES);
    expect(RIPPLE_QUEUE_MS).toBeLessThan(RIPPLE_LIFE_S * 1000);
  });

  it('reduced motion holds a ring at its reach', () => {
    const { fx, noise } = setup(() => [], { ripples: true, reduced: true });
    fx.attach();
    noise({ x: 0, y: 0, z: 0 }, 50);
    fx.frame(CAMERA);
    expect(fx.view.ripples[0]?.radius).toBeCloseTo(rippleRadius(50));
  });
});

describe('readAgents', () => {
  it('reads nothing from a world with no creature rules (an unknown scene)', () => {
    expect(readAgents(new World<never>({ seed: 1 }))).toEqual([]);
  });

  const memory = (source: string, confidence: number): MemoryRecord =>
    ({
      source,
      kind: 'seen-target',
      origin: 'own',
      lkp: { x: 2, y: 0, z: 2 },
      velocity: { x: 0, y: 0, z: 0 },
      firstTick: 0,
      seenTick: 0,
      confidence,
    }) as unknown as MemoryRecord;

  function world() {
    return new World<never>({ seed: 1 }).register(
      BrainComponent,
      PlacementComponent,
      CreatureNavComponent,
      ...DAMAGE_COMPONENTS,
    );
  }
  const brain = (over: Partial<Brain['blackboard']>, state: Brain['state'] = 'searching'): Brain =>
    ({
      state,
      memory: [],
      blackboard: {
        awareness: 0.5,
        lkp: null,
        targetSource: null,
        targetVisible: false,
        ...over,
      },
    }) as unknown as Brain;
  const place = (w: ReturnType<typeof world>, e: EntityId, x: number): void => {
    w.add(e, PlacementComponent, { x, y: 0, z: 0, radius: 0.4 });
  };

  it('reads each living creature: state, suspicion, feet, head height, remembered position and confidence', () => {
    const w = world();
    const a = w.spawn();
    place(w, a, 1);
    w.add(a, BrainComponent, brain({ awareness: 0.7 }));
    const b = w.spawn();
    place(w, b, 2);
    const target = entitySource(w.spawn());
    const remembering = brain({ lkp: { x: 2, y: 0, z: 2 }, targetSource: target });
    remembering.memory = [memory(target, 0.9)];
    w.add(b, BrainComponent, remembering);
    w.add(b, CreatureNavComponent, { height: 2.4 } as never);
    const c = w.spawn();
    place(w, c, 3);
    w.add(c, BrainComponent, brain({ lkp: { x: 9, y: 0, z: 9 } }));
    const got = readAgents(w);
    expect(got.map((r) => r.entity)).toEqual([a, b, c]);
    expect(got[0]).toMatchObject({
      state: 'searching',
      awareness: 0.7,
      lkp: null,
      confidence: 0.7,
      height: DEFAULT_HEAD_M,
    });
    expect(got[0]?.feet).toEqual({ x: 1, y: 0, z: 0 });
    expect(got[1]).toMatchObject({ height: 2.4 });
    expect(got[1]?.confidence).toBeGreaterThan(0.8);
    // No memory of its target: its suspicion stands in.
    expect(got[2]?.confidence).toBe(0.5);
  });

  it('skips the dead, and reuses the list it is given', () => {
    const w = world();
    const live = w.spawn();
    place(w, live, 0);
    w.add(live, BrainComponent, brain({}));
    const dead = w.spawn();
    place(w, dead, 1);
    w.add(dead, BrainComponent, brain({}));
    giveCombatant(w, dead, { health: 10, poise: 5 });
    w.set(dead, HealthComponent, { max: 10, current: 0 });
    const into: AgentReading[] = [reading()];
    expect(readAgents(w, into)).toBe(into);
    expect(into.map((r) => r.entity)).toEqual([live]);
  });
});
