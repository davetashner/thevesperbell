// Swing trails and charge glow (mw-e29.6): presentation of the sim's combat timeline. Presentation
// only: it reads the world (the timeline's phase, the swept hitbox, the charge hold, arrows in
// flight) and never writes to it.
//
// - A tracked entity's trail exists only while its move's hit volume is live (`activeHitbox`, the
//   timeline's active phase); the ribbon runs along the hitbox's swept socket pose, one sample per
//   sim sweep, so what is drawn is what hits. Its tint is the dominant damage type of the move as
//   performed (a charged swing's lerped numbers), looked up in the tint data.
// - While a chargeable move is held, a glow at the weapon steps up at 33%, 66% and 100% of the full
//   hold; `ChargeReady` spawns a burst effect at the weapon socket (skipped under reduced motion).
// - Arrows the caller says are focused get a faint trail along their flight.
// - TRAIL_MAX trails at once, oldest released first (trail-ribbon.ts).
//
// `frame()` allocates nothing once running except while a charge is held (the weapon's rest pose).

import type { MoveTable, RuntimeMove } from '@content/index';
import {
  ActionTimelineComponent,
  activeHitbox,
  ArrowComponent,
  arrowDirection,
  chargeIndex,
  ChargeReady,
  composePose,
  effectiveMove,
  entityFrame,
  facingOf,
  liveHitboxes,
  moveTrack,
  placeShape,
  type EntityId,
  type GeomShape,
  type SocketTrackLookup,
  type Vec3,
  type World,
} from '@sim/index';
import type { VfxSpawner } from '../cues/vfx-bridge.ts';
import { Trail, TrailSet } from '@render/vfx/trail-ribbon';
import { at, known } from './indexing.ts';
import { swingTint, type Rgb, type TrailTints } from './trail-tints.ts';

/** Glow steps: the fraction of the full hold at which step 1, 2 and 3 begin. */
export const GLOW_STEPS = [0.33, 0.66, 1] as const;

/** Glow sprite size (metres) and opacity per step, 0 = none. */
export const GLOW_SIZE = [0, 0.16, 0.24, 0.34] as const;
export const GLOW_OPACITY = [0, 0.35, 0.6, 0.95] as const;

/** The VFX effect spawned at the weapon socket when a charge is ready. */
export const CHARGE_BURST_EFFECT = 'vfx-charge-burst';

/** Opacity multiplier for trails under reduced motion. */
export const REDUCED_MOTION_ALPHA = 0.5;

/** Which glow step a hold of `held` ticks out of `full` is on: 0 below 33%, then 1, 2, 3 (full). */
export function glowStep(held: number, full: number): 0 | 1 | 2 | 3 {
  if (!(full > 0)) return 0;
  const fraction = held / full;
  if (fraction >= GLOW_STEPS[2]) return 3;
  if (fraction >= GLOW_STEPS[1]) return 2;
  if (fraction >= GLOW_STEPS[0]) return 1;
  return 0;
}

/** The charge glow of one entity, for the renderer; the object is reused every frame. */
export interface GlowState {
  readonly entity: EntityId;
  /** 0 = off. */
  step: 0 | 1 | 2 | 3;
  x: number;
  y: number;
  z: number;
  r: number;
  g: number;
  b: number;
  size: number;
  opacity: number;
}

export interface SwingTrailsOptions {
  readonly world: World<never>;
  readonly moves: MoveTable;
  readonly tracks: SocketTrackLookup;
  readonly tints: TrailTints;
  /** The VFX runtime, for the ready burst; without it no burst. */
  readonly vfx?: VfxSpawner;
  /** Whether an arrow in flight is focused (gets a faint trail); default: none are. */
  readonly arrowFocused?: (arrow: EntityId) => boolean;
  /** Reduced-motion preference, read when a trail or burst starts; default: off. */
  readonly reducedMotion?: () => boolean;
}

interface Slot {
  readonly entity: EntityId;
  trail: Trail | null;
  /** The swept shape last sampled (identity: the sim replaces it each sweep). */
  last: GeomShape | null;
  /** Arrow slots: the frame it was last seen flying. */
  seen: number;
}

/** The ribbon's base edge of a hit volume: a capsule's start; anything else, its centre. */
export function edgeBase(shape: GeomShape): Vec3 {
  return shape.kind === 'capsule' ? shape.from : shape.center;
}

/** The ribbon's tip edge of a hit volume: a capsule's end; anything else, its centre. */
export function edgeTip(shape: GeomShape): Vec3 {
  return shape.kind === 'capsule' ? shape.to : shape.center;
}

/** The middle of a hit volume: a capsule's midpoint, else its centre. */
export function volumeCentre(shape: GeomShape): Vec3 {
  if (shape.kind !== 'capsule') return shape.center;
  return {
    x: (shape.from.x + shape.to.x) / 2,
    y: (shape.from.y + shape.to.y) / 2,
    z: (shape.from.z + shape.to.z) / 2,
  };
}

/** Attaches swing trails and charge glow to a world; see the file header. */
export class SwingTrails {
  readonly set = new TrailSet();
  /** One glow per tracked entity. */
  readonly glows: readonly GlowState[];
  readonly #o: SwingTrailsOptions;
  readonly #charges: ReadonlyMap<string, RuntimeMove>;
  readonly #tracked: EntityId[];
  readonly #slots = new Map<EntityId, Slot>();
  readonly #glowOf = new Map<EntityId, GlowState>();
  readonly #arrowSlots = new Map<EntityId, Slot>();
  readonly #visit = (entity: EntityId): void => {
    this.#arrow(entity);
  };
  #frame = 0;
  #off: (() => void) | undefined;

  constructor(options: SwingTrailsOptions, entities: readonly EntityId[] = []) {
    this.#o = options;
    this.#charges = chargeIndex(options.moves);
    this.#tracked = [...entities];
    const glows: GlowState[] = [];
    for (const entity of entities) {
      const glow: GlowState = {
        entity,
        step: 0,
        x: 0,
        y: 0,
        z: 0,
        r: 1,
        g: 1,
        b: 1,
        size: 0,
        opacity: 0,
      };
      glows.push(glow);
      this.#glowOf.set(entity, glow);
      this.#slots.set(entity, { entity, trail: null, last: null, seen: 0 });
    }
    this.glows = glows;
    this.#off = options.world.events.on(ChargeReady, ({ entity, move }) => {
      this.#burst(entity, move);
    });
  }

  /** Stops listening for ChargeReady. */
  dispose(): void {
    this.#off?.();
    this.#off = undefined;
  }

  /** Trails currently drawable. */
  get visible(): number {
    let n = 0;
    for (const trail of this.set.trails) if (trail.visible) n++;
    return n;
  }

  /** Samples the world; call once per rendered frame after the sim has stepped. */
  frame(): void {
    this.#frame++;
    for (const entity of this.#tracked) {
      this.#swing(entity);
      this.#charge(entity);
    }
    const focused = this.#o.arrowFocused;
    if (focused !== undefined && this.#o.world.isRegistered(ArrowComponent)) {
      this.#o.world.query(ArrowComponent).forEach(this.#visit);
      for (const [entity, slot] of this.#arrowSlots) {
        if (slot.seen === this.#frame) continue;
        this.#drop(slot);
        this.#arrowSlots.delete(entity);
        this.#slots.delete(entity);
      }
    }
  }

  #alpha(base: number): number {
    return this.#o.reducedMotion?.() === true ? base * REDUCED_MOTION_ALPHA : base;
  }

  #drop(slot: Slot): void {
    if (slot.trail !== null) this.set.release(slot.trail);
    slot.trail = null;
    slot.last = null;
  }

  #start(slot: Slot, kind: Trail['kind'], rgb: Rgb, alpha: number): Trail {
    const { trail, evicted } = this.set.request(slot.entity, kind, rgb, this.#alpha(alpha));
    if (evicted !== undefined) {
      known(this.#slots.get(evicted)).trail = null;
    }
    slot.trail = trail;
    return trail;
  }

  #swing(entity: EntityId): void {
    const slot = known(this.#slots.get(entity));
    const active = activeHitbox(this.#o.world, entity, this.#o.moves);
    if (active === undefined) {
      this.#drop(slot);
      return;
    }
    const hitbox = liveHitboxes(this.#o.world, entity).find((h) => h.id === active.move.id);
    const pose = hitbox?.pose ?? null;
    if (hitbox === undefined || pose === null) return;
    let trail = slot.trail;
    if (trail === null) {
      const performed = effectiveMove(this.#o.world, this.#o.moves, entity, active.move);
      const rgb = swingTint(this.#o.tints, performed.damage?.amounts ?? {});
      trail = this.#start(slot, 'swing', rgb, this.#o.tints.swingAlpha);
      if (hitbox.sweptFrom !== null) this.#sample(trail, hitbox.sweptFrom);
    }
    if (pose !== slot.last) this.#sample(trail, pose);
    slot.last = pose;
  }

  #sample(trail: Trail, shape: GeomShape): void {
    trail.push(edgeBase(shape), edgeTip(shape));
  }

  #arrow(entity: EntityId): void {
    const focused = this.#o.arrowFocused as (arrow: EntityId) => boolean;
    if (!focused(entity)) return;
    const flight = known(this.#o.world.get(entity, ArrowComponent));
    let slot = this.#arrowSlots.get(entity);
    if (slot === undefined) {
      slot = { entity, trail: null, last: null, seen: 0 };
      this.#arrowSlots.set(entity, slot);
      this.#slots.set(entity, slot);
    }
    slot.seen = this.#frame;
    slot.trail ??= this.#start(slot, 'arrow', this.#o.tints.arrow, this.#o.tints.arrowAlpha);
    // The ribbon's width runs sideways across the flight, a hand's breadth.
    const d = arrowDirection(flight);
    const length = Math.hypot(d.z, d.x);
    const sx = length > 1e-6 ? d.z / length : 1;
    const sz = length > 1e-6 ? -d.x / length : 0;
    const p = flight.position;
    slot.trail.push(
      { x: p.x + sx * ARROW_HALF_WIDTH, y: p.y, z: p.z + sz * ARROW_HALF_WIDTH },
      { x: p.x - sx * ARROW_HALF_WIDTH, y: p.y, z: p.z - sz * ARROW_HALF_WIDTH },
    );
  }

  /** The weapon socket of `entity` while it holds `move`: the tip of its hit volume at the arc's start. */
  #restSocket(entity: EntityId, move: RuntimeMove): Vec3 | undefined {
    const { hitbox } = move;
    if (hitbox === null) return undefined;
    const frame = entityFrame(this.#o.world, entity, facingOf(this.#o.world, entity));
    if (frame === undefined) return undefined;
    const track = moveTrack(move, this.#o.tracks);
    return volumeCentre(placeShape(hitbox.shape, composePose(frame, at(track.keys, 0))));
  }

  #charge(entity: EntityId): void {
    const glow = known(this.#glowOf.get(entity));
    const current = this.#o.world.get(entity, ActionTimelineComponent)?.current ?? null;
    const hold = current?.hold;
    const charged = current === null ? undefined : this.#charges.get(current.move);
    if (current === null || hold === undefined || charged === undefined) {
      glow.step = 0;
      glow.size = 0;
      glow.opacity = 0;
      return;
    }
    const rules = known(charged.charge);
    const step = glowStep(hold.held, rules.fullHoldTicks);
    glow.step = step;
    glow.size = GLOW_SIZE[step];
    glow.opacity = GLOW_OPACITY[step];
    if (step === 0) return;
    const move = known(this.#o.moves.get(current.move));
    const at = this.#restSocket(entity, move);
    if (at === undefined) {
      glow.step = 0;
      glow.opacity = 0;
      return;
    }
    glow.x = at.x;
    glow.y = at.y;
    glow.z = at.z;
    const rgb = known(this.#o.tints.glow[step - 1]);
    glow.r = rgb[0];
    glow.g = rgb[1];
    glow.b = rgb[2];
  }

  #burst(entity: EntityId, move: string): void {
    const { vfx } = this.#o;
    if (vfx === undefined || !this.#glowOf.has(entity)) return;
    if (this.#o.reducedMotion?.() === true || !vfx.has(CHARGE_BURST_EFFECT)) return;
    const held = this.#o.moves.get(move);
    if (held === undefined) return;
    const at = this.#restSocket(entity, held);
    if (at !== undefined) vfx.spawn(CHARGE_BURST_EFFECT, { position: at });
  }
}

/** Half the width of a focused arrow's ribbon, metres. */
const ARROW_HALF_WIDTH = 0.025;
