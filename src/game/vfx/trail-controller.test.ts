import type { MoveTable, RuntimeMove } from '@content/index';
import {
  ACTION_TIMELINE_COMPONENTS,
  actionButton,
  actionFrame,
  actionTimelineSystem,
  actionVector,
  ArrowComponent,
  ChargeReady,
  giveActionInput,
  giveActionTimeline,
  actionOf,
  HIT_VOLUME_COMPONENTS,
  giveHitboxes,
  HitboxComponent,
  IDLE_ACTION_FRAME,
  MELEE_COMPONENTS,
  openHitbox,
  PlacementComponent,
  placeEntity,
  StaminaComponent,
  World,
  type ActionFrame,
  type EntityId,
  type GeomShape,
  type SocketTrackLookup,
} from '@sim/index';
import { describe, expect, it } from 'vitest';
import type { VfxSpawnOptions } from './system';
import {
  CHARGE_BURST_EFFECT,
  edgeBase,
  edgeTip,
  GLOW_OPACITY,
  glowStep,
  REDUCED_MOTION_ALPHA,
  SwingTrails,
  volumeCentre,
  type SwingTrailsOptions,
} from './trail-controller';
import { TRAIL_MAX } from '@render/vfx/trail-ribbon';
import { known } from './indexing';
import { trailTints } from './trail-tints';

const V = (x: number, y: number, z: number) => ({ x, y, z });

describe('glow steps (mw-e29.6)', () => {
  it('steps at 33%, 66% and 100% of the full hold', () => {
    const steps = [0, 19, 20, 39, 40, 59, 60, 90].map((held) => glowStep(held, 60));
    expect(steps).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    expect(glowStep(5, 0)).toBe(0);
    expect(GLOW_OPACITY[3]).toBeGreaterThan(GLOW_OPACITY[1]);
  });
});

describe('hit-volume edges', () => {
  const capsule: GeomShape = { kind: 'capsule', from: V(0, 0, 0), to: V(0, 2, 0), radius: 0.1 };
  const sphere: GeomShape = { kind: 'sphere', center: V(1, 1, 1), radius: 0.5 };
  const box: GeomShape = { kind: 'box', center: V(2, 2, 2), halfExtents: V(1, 1, 1) } as GeomShape;

  it('a capsule is a blade from its start to its end; others are their centre', () => {
    expect([edgeBase(capsule), edgeTip(capsule)]).toEqual([V(0, 0, 0), V(0, 2, 0)]);
    expect([edgeBase(sphere), edgeTip(sphere)]).toEqual([V(1, 1, 1), V(1, 1, 1)]);
    expect(edgeTip(box)).toEqual(V(2, 2, 2));
    expect(volumeCentre(capsule)).toEqual(V(0, 1, 0));
    expect(volumeCentre(sphere)).toEqual(V(1, 1, 1));
  });
});

// A small world with the real action timeline and synthetic heavy moves.
const move = (id: string, overrides: Partial<RuntimeMove> = {}): RuntimeMove =>
  Object.freeze({
    id,
    verb: 'attack',
    startup: 24,
    active: 5,
    recovery: 26,
    totalTicks: 55,
    activeFrom: 24,
    recoveryFrom: 29,
    staminaCost: 0,
    cancelWindows: [],
    damage: null,
    hitbox: {
      track: 'arc',
      shape: { kind: 'capsule', from: V(0, 1, 0.5), to: V(0, 1, 1.5), radius: 0.1 },
      reach: 'medium',
      swing: 'vertical',
    },
    parryable: true,
    blockable: true,
    unblockable: false,
    interruptible: false,
    hyperarmor: null,
    iframes: null,
    telegraphTick: 0,
    hitStop: 'heavy',
    chainNext: null,
    charge: null,
    motion: null,
    presentation: { anim: `anim-${id}` },
    ...overrides,
  } satisfies RuntimeMove);

const CHARGE = { from: 'heavy', minHoldTicks: 12, fullHoldTicks: 60, autoReleaseTicks: 90 };
const HEAVY = move('heavy');
const CHARGED = move('charged', { charge: { ...CHARGE, holdTick: 18 } });
const BARE = move('bare', { hitbox: null });
const BARE_CHARGED = move('bare-charged', {
  hitbox: null,
  charge: { ...CHARGE, from: 'bare', holdTick: 18 },
});
const table = (...moves: RuntimeMove[]): MoveTable => new Map(moves.map((m) => [m.id, m]));
const MOVES = table(HEAVY, CHARGED, BARE, BARE_CHARGED);
const IDENTITY = { position: V(0, 0, 0), rotation: { x: 0, y: 0, z: 0, w: 1 } };
const TRACKS: SocketTrackLookup = new Map([['arc', { id: 'arc', keys: [IDENTITY] }]]);

function hold(codes: readonly string[]): ActionFrame {
  return actionFrame({
    move: actionVector(0, 0),
    look: actionVector(0, 0),
    buttons: (b) =>
      codes.includes(b) ? actionButton(true, true, false) : actionButton(false, false, false),
  });
}

function rig(options: { placed?: boolean; extra?: Partial<SwingTrailsOptions> } = {}) {
  const world = new World<ActionFrame>({ seed: 1 }).register(
    ...ACTION_TIMELINE_COMPONENTS,
    ...HIT_VOLUME_COMPONENTS,
    PlacementComponent,
    StaminaComponent,
    ...MELEE_COMPONENTS,
  );
  world.addSystem(actionTimelineSystem({ moves: MOVES }));
  const knight = world.spawn();
  giveActionTimeline(world, knight);
  giveActionInput(world, knight, { ability1: 'heavy', ability2: 'bare' });
  if (options.placed ?? true) placeEntity(world, knight, V(1, 0, 2), 0.3);
  const spawned: { effect: string; options: VfxSpawnOptions }[] = [];
  const trails = new SwingTrails(
    {
      world,
      moves: MOVES,
      tracks: TRACKS,
      tints: trailTints(),
      vfx: {
        spawn: (effect, o) => {
          spawned.push({ effect, options: o });
          return 1;
        },
        stop: () => undefined,
        alive: () => true,
        has: () => true,
      },
      ...options.extra,
    },
    [knight],
  );
  const steps = (n: number, input: ActionFrame = IDLE_ACTION_FRAME) => {
    for (let i = 0; i < n; i++) {
      world.step([input]);
      trails.frame();
    }
  };
  return { world, knight, trails, spawned, steps };
}

describe('charge glow and burst (mw-e29.6)', () => {
  it('glows at the socket in the knight’s frame and bursts there on ChargeReady', () => {
    const t = rig();
    t.steps(25, hold(['ability1']));
    const [glow] = t.trails.glows;
    expect(glow?.step).toBe(1);
    // Knight at (1, 0, 2) facing +z: the blade's middle (0, 1, 1) lands at (1, 1, 3).
    expect([glow?.x, glow?.y, glow?.z]).toEqual([1, 1, 3]);
    expect(glow?.size).toBeGreaterThan(0);
    t.steps(40, hold(['ability1']));
    expect(glow?.step).toBe(3);
    expect(t.spawned).toEqual([{ effect: CHARGE_BURST_EFFECT, options: { position: V(1, 1, 3) } }]);
    t.steps(2);
    expect(glow?.step).toBe(0);
    expect(glow?.opacity).toBe(0);
  });

  it('draws no glow and spawns no burst for an entity without a placement', () => {
    const t = rig({ placed: false });
    t.steps(70, hold(['ability1']));
    // Without placement entityFrame is undefined; the glow stays off.
    expect(t.trails.glows[0]?.step).toBe(0);
    expect(t.spawned).toEqual([]);
  });

  it('draws no glow for a chargeable move without a hit volume', () => {
    const t = rig();
    t.steps(30, hold(['ability2']));
    expect(t.trails.glows[0]?.step).toBe(0);
    expect(t.spawned).toEqual([]);
  });

  it('skips the burst under reduced motion, without a VFX runtime, for unknown effects or entities', () => {
    const reduced = rig({ extra: { reducedMotion: () => true } });
    reduced.steps(70, hold(['ability1']));
    expect(reduced.spawned).toEqual([]);
    expect(reduced.trails.glows[0]?.step).toBe(3);

    const noVfx = rig();
    const spawnless = new SwingTrails(
      { world: noVfx.world, moves: MOVES, tracks: TRACKS, tints: trailTints() },
      [noVfx.knight],
    );
    noVfx.steps(70, hold(['ability1']));
    expect(noVfx.spawned).toHaveLength(1);
    spawnless.dispose();

    const missing = rig({
      extra: {
        vfx: { spawn: () => 1, stop: () => undefined, alive: () => true, has: () => false },
      },
    });
    missing.steps(70, hold(['ability1']));
    expect(missing.spawned).toEqual([]);

    const other = rig();
    const stranger = other.world.spawn();
    const info = { tick: 1, entity: stranger, move: 'heavy', charged: 'charged', held: 60 };
    other.world.events.emit(ChargeReady, info);
    other.world.events.emit(ChargeReady, { ...info, entity: other.knight, move: 'nope' });
    other.world.events.flush();
    expect(other.spawned).toEqual([]);
  });

  it('stops listening for ChargeReady once disposed', () => {
    const t = rig();
    t.trails.dispose();
    t.trails.dispose();
    t.steps(70, hold(['ability1']));
    expect(t.spawned).toEqual([]);
  });

  it('draws no trail while a move is active without a swept hitbox, or before its first sweep', () => {
    const t = rig();
    // Press the bare move's cousin: heavy tapped, released into its swing; no hit system sweeps.
    t.steps(1, hold(['ability1']));
    t.steps(40);
    expect(t.trails.visible).toBe(0);
    // A hitbox opened but never swept has no pose yet.
    const mover = rig();
    mover.steps(1, hold(['ability1']));
    mover.steps(1);
    openHitbox(mover.world, mover.knight, {
      id: 'heavy',
      shape: { kind: 'sphere', center: V(0, 1, 1), radius: 0.3 },
      track: { id: 'arc', keys: [IDENTITY] },
      activeTicks: 5,
      aim: V(0, 0, 1),
      friendlyFire: false,
    });
    mover.steps(30);
    expect(mover.trails.visible).toBe(0);
  });
});

describe('swing trail sampling', () => {
  it('starts from the first sweep alone, then adds each new swept pose, tinted neutral for a move with no damage', () => {
    const t = rig();
    t.steps(1, hold(['ability1']));
    t.steps(1);
    // Run to the move's active phase, where a hit system would have opened and swept its hitbox.
    while ((actionOf(t.world, t.knight)?.tick ?? 0) < 25) t.steps(1);
    const blade = (z: number): GeomShape => ({
      kind: 'capsule',
      from: V(0, 1, z),
      to: V(0, 1, z + 1),
      radius: 0.1,
    });
    const live = (pose: GeomShape, sweptFrom: GeomShape | null) =>
      Object.freeze({
        id: 'heavy',
        shape: { kind: 'sphere' as const, center: V(0, 1, 1), radius: 0.3 },
        track: { id: 'arc', keys: [IDENTITY] },
        activeTicks: 5,
        aim: V(0, 0, 1),
        friendlyFire: false,
        elapsed: 1,
        sweptFrom,
        pose,
        hit: Object.freeze([]),
      });
    giveHitboxes(t.world, t.knight);
    const set = (pose: GeomShape, sweptFrom: GeomShape | null) => {
      t.world.set(t.knight, HitboxComponent, { live: [live(pose, sweptFrom)] });
      t.trails.frame();
    };
    expect(actionOf(t.world, t.knight)?.move).toBe('heavy');
    const b0 = blade(0);
    const b1 = blade(1);
    set(b0, null);
    const trail = t.trails.set.trails.find((x) => x.live);
    expect(trail?.length).toBe(1);
    expect(trail?.visible).toBe(false);
    set(b0, null); // the same pose is not sampled twice
    expect(trail?.length).toBe(1);
    set(b1, b0);
    expect(trail?.length).toBe(2);
    expect(trail?.visible).toBe(true);
    expect([trail?.r, trail?.g, trail?.b]).toEqual([...trailTints().neutral]);
  });

  it('seeds a new trail with the pose the sweep started from', () => {
    const t = rig();
    t.steps(2, hold(['ability1']));
    while ((actionOf(t.world, t.knight)?.tick ?? 0) < 25) t.steps(1);
    giveHitboxes(t.world, t.knight);
    const from: GeomShape = { kind: 'capsule', from: V(0, 1, 0), to: V(0, 1, 1), radius: 0.1 };
    const to: GeomShape = { kind: 'capsule', from: V(0, 1, 1), to: V(0, 1, 2), radius: 0.1 };
    t.world.set(t.knight, HitboxComponent, {
      live: [
        {
          id: 'heavy',
          shape: { kind: 'sphere', center: V(0, 1, 1), radius: 0.3 },
          track: { id: 'arc', keys: [IDENTITY] },
          activeTicks: 5,
          aim: V(0, 0, 1),
          friendlyFire: false,
          elapsed: 1,
          sweptFrom: from,
          pose: to,
          hit: [],
        },
      ],
    });
    t.trails.frame();
    expect(t.trails.visible).toBe(1);
  });

  it('ignores a tracked entity that has no action timeline', () => {
    const world = new World<ActionFrame>({ seed: 1 }).register(...ACTION_TIMELINE_COMPONENTS);
    const bare = world.spawn();
    const trails = new SwingTrails({ world, moves: MOVES, tracks: TRACKS, tints: trailTints() }, [
      bare,
    ]);
    trails.frame();
    expect(trails.visible).toBe(0);
    expect(trails.glows[0]?.step).toBe(0);
  });
});

describe('arrow trails (mw-e29.6, mw-e29.11)', () => {
  function arrows(options: Partial<SwingTrailsOptions> = {}) {
    const world = new World<ActionFrame>({ seed: 1 }).register(ArrowComponent);
    const focused = new Set<EntityId>();
    const trails = new SwingTrails({
      world,
      moves: MOVES,
      tracks: TRACKS,
      tints: trailTints(),
      arrowFocused: (arrow) => focused.has(arrow),
      ...options,
    });
    const shoot = (x: number, velocity = V(30, 0, 0), isFocused = true): EntityId => {
      const arrow = world.spawn();
      world.add(arrow, ArrowComponent, {
        arrow: 'arrow-plain',
        shooter: null,
        position: V(x, 1, 0),
        velocity,
        launchSpeed: 30,
        flown: 0,
        spent: false,
        dodged: [],
      });
      if (isFocused) focused.add(arrow);
      return arrow;
    };
    return { world, trails, shoot, focused };
  }

  it('gives an arrow a faint trail sideways across its flight, and releases it on landing', () => {
    const { world, trails, shoot } = arrows();
    const arrow = shoot(0, V(30, 0, 0), false);
    trails.frame();
    for (let i = 1; i <= 3; i++) {
      world.set(arrow, ArrowComponent, {
        ...known(world.get(arrow, ArrowComponent)),
        position: V(i, 1, 0),
      });
      trails.frame();
    }
    const live = trails.set.trails.filter((t) => t.live);
    expect(live).toHaveLength(1);
    expect(live[0]?.kind).toBe('arrow');
    expect(Math.abs(live[0]?.at(0, 2) ?? 0)).toBeCloseTo(0.025);
    expect(live[0]?.alpha).toBeCloseTo(trailTints().arrowAlpha);
    expect(live[0]?.alpha).toBeLessThan(trailTints().swingAlpha);
    // Flying along +x the ribbon is across z.
    expect(live[0]?.at(0, 2)).not.toBe(live[0]?.at(0, 5));
    expect(live[0]?.at(0, 0)).toBeCloseTo(live[0]?.at(0, 3) ?? NaN);
    expect(trails.visible).toBe(1);
    world.remove(arrow, ArrowComponent);
    trails.frame();
    expect(trails.set.live).toBe(0);
  });

  it('AC-4: a focused shot gets the focused trail variant: brighter, wider, same hue', () => {
    const { world, trails, shoot } = arrows();
    const plain = shoot(0, V(30, 0, 0), false);
    shoot(0, V(30, 0, 0), true);
    trails.frame();
    const live = trails.set.trails.filter((t) => t.live);
    expect(live.map((t) => t.kind).sort()).toEqual(['arrow', 'arrow-focused']);
    const [standard, focused] = [
      live.find((t) => t.kind === 'arrow'),
      live.find((t) => t.kind === 'arrow-focused'),
    ];
    expect(focused?.alpha).toBe(trailTints().arrowFocusedAlpha);
    expect(focused?.alpha).toBeGreaterThan((standard?.alpha ?? 1) * 2);
    expect(focused?.r).toBeGreaterThan(standard?.r ?? 1);
    expect(focused?.b).toBeGreaterThan(standard?.b ?? 1);
    expect(plain).toBeDefined();
    world.set(plain, ArrowComponent, {
      ...known(world.get(plain, ArrowComponent)),
      position: V(1, 1, 0),
    });
    trails.frame();
    expect(Math.abs((focused?.at(0, 2) ?? 0) - (focused?.at(0, 5) ?? 0))).toBeCloseTo(0.1);
  });

  it('copes with an arrow falling straight down', () => {
    const { world, trails, shoot } = arrows();
    const arrow = shoot(0, V(0, -10, 0));
    trails.frame();
    world.set(arrow, ArrowComponent, {
      ...known(world.get(arrow, ArrowComponent)),
      position: V(0, 0.5, 0),
    });
    trails.frame();
    expect(trails.visible).toBe(1);
  });

  it('AC-3 (in play): with 9 focused arrows the oldest trail is released and 8 remain', () => {
    const { trails, shoot } = arrows();
    const flying = Array.from({ length: TRAIL_MAX + 1 }, (_, i) => shoot(i));
    trails.frame();
    expect(trails.set.live).toBe(TRAIL_MAX);
    const owners = trails.set.trails.map((t) => t.owner);
    // Arrows are visited in spawn order, so the first is the one released.
    expect(owners).not.toContain(flying[0]);
    expect(owners).toContain(flying[TRAIL_MAX]);
    // The released arrow's slot is empty; it takes a fresh trail next frame, releasing the next oldest.
    trails.frame();
    expect(trails.set.live).toBe(TRAIL_MAX);
  });

  it('halves trail opacity under reduced motion', () => {
    const { trails, shoot } = arrows({ reducedMotion: () => true });
    shoot(0, V(30, 0, 0), false);
    trails.frame();
    const live = trails.set.trails.find((t) => t.live);
    expect(live?.alpha).toBeCloseTo(trailTints().arrowAlpha * REDUCED_MOTION_ALPHA);
  });

  it('tints a trick arrow by its type and draws nothing in a world with no arrows', () => {
    const none = new World<ActionFrame>({ seed: 1 }).register(ArrowComponent);
    const a = new SwingTrails({ world: none, moves: MOVES, tracks: TRACKS, tints: trailTints() });
    const arrow = none.spawn();
    none.add(arrow, ArrowComponent, {
      arrow: 'fire',
      shooter: null,
      position: V(0, 0, 0),
      velocity: V(1, 0, 0),
      launchSpeed: 1,
      flown: 0,
      spent: false,
      dodged: [],
    });
    a.frame();
    expect(a.set.live).toBe(1);
    expect(a.set.trails.find((t) => t.live)?.r).toBeCloseTo(1);
    expect(a.set.trails.find((t) => t.live)?.b).toBeCloseTo(0x3c / 255);
    const empty = new World<ActionFrame>({ seed: 1 });
    const b = new SwingTrails({
      world: empty,
      moves: MOVES,
      tracks: TRACKS,
      tints: trailTints(),
      arrowFocused: () => true,
    });
    b.frame();
    expect(b.set.live).toBe(0);
  });
});
