// World-space awareness feedback (mw-e29.12): the indicator over a creature that shows how aware it
// is of the player, and two assists that are off unless the player turns them on.
//
// - Indicator: Unaware shows nothing. Suspicious shows a disc that fills with the creature's
//   suspicion (its blackboard awareness, 0-1), Investigating a diamond, Searching a crescent, Alerted
//   a triangle and Combat a star: shape as well as colour (src/render/stealth/indicator-shapes.ts).
//   It hovers above the head, grows with distance so it keeps a readable size on screen, fades out
//   past INDICATOR_RANGE_M, and is drawn depth tested, so a creature behind a wall shows nothing a
//   player could not already see (the lock-on ring and damage numbers are projected 2D and have no
//   such limit; this is the first world-space marker, so it is held to what the camera can see).
// - Last-known-position ghost (setting `gameplay.lastKnownMarker`): where an alarmed creature that
//   cannot see its target believes it is, fainter as its memory fades. It only shows the player where
//   the player was, nothing the player did not already know.
// - Noise ripple (setting `gameplay.noiseRipples`): one ring on the ground per noise event, as far
//   as the noise carries in open air before it falls under what a person hears (30 dB, capped for
//   drawing), spaced at most MAX_MAGIC_PULSE_HZ apart. Footsteps and landings (mw-e09.5) ring only
//   when they would be heard (30 dB) at the player, so sneaking draws nothing. Off by default: with the setting off an event
//   draws nothing (the setting is read when the event arrives). Reduced motion holds the ring still
//   and only fades it.
//
// Presentation only: it reads the sim and its events and never writes to it, and builds plain data
// each frame (`view`) for the Three.js side (src/render/stealth/awareness.ts). Every rule is unit
// tested without a renderer. Nothing flashes faster than 2 Hz: the alarm pulse is capped at
// MAX_MAGIC_PULSE_HZ, and reduced motion removes it and the pop-in.

import type { AlertState } from '@content/index';
import {
  BrainComponent,
  CreatureNavComponent,
  isDead,
  isMovementNoise,
  noiseEmitted,
  PlacementComponent,
  recallTarget,
  type EntityId,
  type NoiseEvent,
  type Vec3,
  type World,
} from '@sim/index';
import { magicPulse, MAX_MAGIC_PULSE_HZ } from '@render/magic-materials/rules';
import { at, known } from './indexing.ts';
import {
  INDICATOR_STYLES,
  type IndicatorShape,
  type VisibleAlertState,
} from '@render/stealth/indicator-shapes';

/** Metres above the top of a creature's nav height the indicator hovers. */
export const INDICATOR_LIFT_M = 0.45;
/** Head height of a creature without a nav agent, metres. */
export const DEFAULT_HEAD_M = 1.8;
/** Farther than this from the camera, an indicator is gone; it fades over the last FADE_M. */
export const INDICATOR_RANGE_M = 40;
export const INDICATOR_FADE_M = 10;
/** The distance at which an indicator is its base size; farther ones grow so they stay readable. */
export const INDICATOR_REFERENCE_M = 5;
/** Largest growth factor of an indicator, and the smallest. */
export const INDICATOR_MAX_SCALE = 4;
export const INDICATOR_MIN_SCALE = 0.8;
/** Seconds an indicator takes to pop in when it appears or its state changes. */
export const POP_IN_S = 0.2;
/** The alarm pulse of Alerted and Combat, hertz: well under the 2 Hz ceiling. */
export const ALARM_PULSE_HZ = 1.5;

/** How long a noise ripple lasts, seconds. */
export const RIPPLE_LIFE_S = 1.2;
/** Seconds between two ripples: never faster than the pulse ceiling. */
export const RIPPLE_INTERVAL_S = 1 / MAX_MAGIC_PULSE_HZ;
/** A ripple that would have to wait longer than this for its turn is not drawn, ms. */
export const RIPPLE_QUEUE_MS = 600;
/** Quietest level a ripple's radius reaches, dB (a person's hearing threshold), and its drawing cap. */
export const RIPPLE_FLOOR_DB = 30;
export const RIPPLE_MAX_RADIUS_M = 30;
/** Noises farther than this from the player are not drawn. */
export const RIPPLE_RANGE_M = 45;
/** Peak opacity of a ripple. */
export const RIPPLE_OPACITY = 0.8;
export const MAX_RIPPLES = 6;

/** The ghost marker's opacity at full and no confidence. */
export const GHOST_MAX_OPACITY = 0.6;
export const GHOST_MIN_OPACITY = 0.18;

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** What the indicator rules need to know of one creature. */
export interface AgentReading {
  readonly entity: EntityId;
  readonly state: AlertState;
  /** Its suspicion, 0-1 (blackboard awareness). */
  readonly awareness: number;
  /** Feet position. */
  readonly feet: Vec3;
  /** Height of its head above its feet, metres. */
  readonly height: number;
  /** Where it believes its target is, or null. */
  readonly lkp: Vec3 | null;
  /** How sure it is of that, 0-1. */
  readonly confidence: number;
  /** It sees its target now. */
  readonly targetVisible: boolean;
}

/** One indicator to draw. */
export interface IndicatorDraw {
  readonly entity: EntityId;
  readonly state: VisibleAlertState;
  readonly shape: IndicatorShape;
  readonly colour: number;
  /** Centre, world space. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** How much of the shape is filled, 0-1 (1 except for Suspicious). */
  readonly fill: number;
  /** Size multiplier: distance growth times the pop-in. */
  readonly scale: number;
  readonly opacity: number;
}

/** One ghost marker to draw. */
export interface GhostDraw {
  readonly entity: EntityId;
  readonly colour: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly opacity: number;
}

/** One ripple to draw, flat on the ground. */
export interface RippleDraw {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
  readonly opacity: number;
}

/** Whether `state` shows an indicator (every state but Unaware). */
export function showsIndicator(state: AlertState): state is VisibleAlertState {
  return state !== 'unaware';
}

/** The fill of a state's shape: Suspicious fills with suspicion, the rest are full. */
export function indicatorFill(state: VisibleAlertState, awareness: number): number {
  return state === 'suspicious' ? clamp01(awareness) : 1;
}

/** Growth of an indicator at `distance` metres from the camera, so it keeps a readable screen size. */
export function indicatorScale(distance: number): number {
  return Math.min(
    INDICATOR_MAX_SCALE,
    Math.max(INDICATOR_MIN_SCALE, distance / INDICATOR_REFERENCE_M),
  );
}

/** Opacity of an indicator `distance` metres from the camera: 1, then out to nothing at the range. */
export function indicatorRangeFade(distance: number): number {
  return clamp01((INDICATOR_RANGE_M - distance) / INDICATOR_FADE_M);
}

/** Pop-in of an indicator `age` seconds after it appeared: small and growing, steady with reduced motion. */
export function popIn(age: number, reducedMotion: boolean): number {
  if (reducedMotion || age >= POP_IN_S) return 1;
  const t = clamp01(age / POP_IN_S);
  return 0.5 + 0.5 * (2 * t - t * t);
}

/** The alarm pulse of a state at `seconds`: a gentle breathing for Alerted and Combat, steady otherwise. */
export function indicatorPulse(
  state: VisibleAlertState,
  seconds: number,
  reducedMotion: boolean,
): number {
  const alarmed = state === 'alerted' || state === 'combat';
  return magicPulse(alarmed ? ALARM_PULSE_HZ : 0, seconds, reducedMotion);
}

/** The ghost marker's opacity for a memory `confidence` (0-1). */
export function ghostOpacity(confidence: number): number {
  return GHOST_MIN_OPACITY + (GHOST_MAX_OPACITY - GHOST_MIN_OPACITY) * clamp01(confidence);
}

/** Whether a creature's last-known position is worth showing: it is alarmed and cannot see its target. */
export function showsGhost(
  reading: Pick<AgentReading, 'state' | 'lkp' | 'targetVisible'>,
): boolean {
  return showsIndicator(reading.state) && reading.lkp !== null && !reading.targetVisible;
}

/** How far a noise of `loudness` dB at 1 m carries in the open before it is inaudible, metres (capped). */
export function rippleRadius(loudness: number): number {
  const r = 10 ** ((loudness - RIPPLE_FLOOR_DB) / 20);
  return Math.min(RIPPLE_MAX_RADIUS_M, Math.max(0.5, r));
}

/**
 * A ripple `age` seconds after it began: it grows to `radius` and fades, so it never pops. Reduced
 * motion holds it at its full reach and only fades it. Opacity is 0 before and after its life.
 */
export function rippleAt(
  age: number,
  radius: number,
  reducedMotion: boolean,
): { readonly radius: number; readonly opacity: number } {
  if (age < 0 || age >= RIPPLE_LIFE_S) return { radius: 0, opacity: 0 };
  const t = age / RIPPLE_LIFE_S;
  return {
    radius: reducedMotion ? radius : radius * (0.1 + 0.9 * (1 - (1 - t) ** 2)),
    opacity: RIPPLE_OPACITY * (1 - t),
  };
}

/** Every creature with a living brain in `world`, as the rules read them. */
export function readAgents(world: World<never>, into: AgentReading[] = []): AgentReading[] {
  into.length = 0;
  // A world with no creature rules at all (an unknown scene's error page) has nothing to read.
  if (!world.isRegistered(BrainComponent)) return into;
  world.query(BrainComponent, PlacementComponent).forEach((entity, brain, at) => {
    if (isDead(world, entity)) return;
    const nav = world.get(entity, CreatureNavComponent);
    const board = brain.blackboard;
    const remembered = board.lkp === null ? undefined : recallTarget(world, entity);
    into.push({
      entity,
      state: brain.state,
      awareness: board.awareness,
      feet: { x: at.x, y: at.y, z: at.z },
      height: nav?.height ?? DEFAULT_HEAD_M,
      lkp: board.lkp,
      confidence: remembered?.confidence ?? board.awareness,
      targetVisible: board.targetVisible,
    });
  });
  return into;
}

/** The settings the effects follow, read live. */
export interface AwarenessFxOptions {
  readonly world: World<never>;
  /** Milliseconds, any steady clock. */
  readonly now: () => number;
  /** Where the creatures are read from; the world's brains by default (the dev probe swaps it). */
  readonly agents?: (into: AgentReading[]) => AgentReading[];
  readonly ghostEnabled?: () => boolean;
  readonly ripplesEnabled?: () => boolean;
  /**
   * Whether a creature is a friend of the player (a shopkeeper, the Watch): friends show no indicator
   * and no ghost, so a villager greeting you never flashes a disc over its head (mw-e09.5). Without
   * it every creature shows.
   */
  readonly friendly?: (entity: EntityId) => boolean;
  readonly reducedMotion?: () => boolean;
  /** The player's position, to keep far noises off the ground; omitted = every noise counts. */
  readonly listener?: () => Vec3 | undefined;
}

interface Ripple {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
  readonly start: number;
  readonly reduced: boolean;
}

/** What one creature's indicator last showed: when it appeared and in which state. */
interface Shown {
  state: VisibleAlertState;
  since: number;
}

/** The awareness effects (see the file header). One per world. */
export class AwarenessFx {
  readonly view: { indicators: IndicatorDraw[]; ghosts: GhostDraw[]; ripples: RippleDraw[] } = {
    indicators: [],
    ghosts: [],
    ripples: [],
  };
  readonly #o: AwarenessFxOptions;
  readonly #ripples: Ripple[] = [];
  readonly #shown = new Map<EntityId, Shown>();
  readonly #readings: AgentReading[] = [];
  #nextRipple = 0;
  #rippleCount = 0;
  #off: (() => void) | undefined;

  constructor(options: AwarenessFxOptions) {
    this.#o = options;
  }

  /** Starts listening for noises; returns the function that stops. */
  attach(): () => void {
    this.#off?.();
    this.#off = this.#o.world.events.on(noiseEmitted, (noise) => {
      this.ripple(noise);
    });
    return () => {
      this.#off?.();
      this.#off = undefined;
    };
  }

  /** Ripples started since the start (a probe for the e2e, which cannot catch a 1 s window). */
  get ripplesStarted(): number {
    return this.#rippleCount;
  }

  #reduced(): boolean {
    return this.#o.reducedMotion?.() === true;
  }

  /** Starts a ripple for `noise` (what the bus listener does); nothing with the assist off. */
  ripple(noise: NoiseEvent): void {
    if (this.#o.ripplesEnabled?.() !== true) return;
    const at = this.#o.listener?.();
    const p = noise.position;
    const distance = at === undefined ? 0 : Math.hypot(p.x - at.x, p.z - at.z);
    if (distance > RIPPLE_RANGE_M) return;
    // Footsteps are constant, so they draw only what a person would hear where the player stands:
    // your own sneak (15 to 30 dB) and a far guard's walk stay quiet, a run or a near guard rings.
    if (
      isMovementNoise(noise.kind) &&
      noise.loudness - 20 * Math.log10(Math.max(1, distance)) < RIPPLE_FLOOR_DB
    ) {
      return;
    }
    const now = this.#o.now();
    // However many noises arrive, rings start no closer together than the pulse ceiling allows; one
    // that would have to wait too long is skipped.
    const start = Math.max(now, this.#nextRipple);
    if (start - now > RIPPLE_QUEUE_MS) return;
    this.#nextRipple = start + RIPPLE_INTERVAL_S * 1000;
    while (this.#ripples.length >= MAX_RIPPLES) this.#ripples.shift();
    this.#ripples.push({
      x: p.x,
      y: p.y,
      z: p.z,
      radius: rippleRadius(noise.loudness),
      start,
      reduced: this.#reduced(),
    });
    this.#rippleCount++;
  }

  /** Rebuilds `view` for the camera at `camera`; call once per rendered frame. */
  frame(camera: Vec3): void {
    const now = this.#o.now();
    const reduced = this.#reduced();
    const { indicators, ghosts, ripples } = this.view;
    indicators.length = ghosts.length = ripples.length = 0;
    const read = this.#o.agents ?? ((into: AgentReading[]) => readAgents(this.#o.world, into));
    const seen = new Set<EntityId>();
    const ghostOn = this.#o.ghostEnabled?.() === true;
    for (const agent of read(this.#readings)) {
      if (!showsIndicator(agent.state) || this.#o.friendly?.(agent.entity) === true) continue;
      seen.add(agent.entity);
      let shown = this.#shown.get(agent.entity);
      if (shown?.state !== agent.state) {
        shown = { state: agent.state, since: now };
        this.#shown.set(agent.entity, shown);
      }
      const distance = Math.hypot(
        agent.feet.x - camera.x,
        agent.feet.y + agent.height - camera.y,
        agent.feet.z - camera.z,
      );
      const fade = indicatorRangeFade(distance);
      if (fade > 0) {
        const style = INDICATOR_STYLES[agent.state];
        const seconds = now / 1000;
        indicators.push({
          entity: agent.entity,
          state: agent.state,
          shape: style.shape,
          colour: style.colour,
          x: agent.feet.x,
          y: agent.feet.y + agent.height + INDICATOR_LIFT_M,
          z: agent.feet.z,
          fill: indicatorFill(agent.state, agent.awareness),
          scale: indicatorScale(distance) * popIn((now - shown.since) / 1000, reduced),
          opacity: fade * indicatorPulse(agent.state, seconds, reduced),
        });
      }
      if (ghostOn && showsGhost(agent)) {
        const lkp = known(agent.lkp);
        ghosts.push({
          entity: agent.entity,
          colour: INDICATOR_STYLES[agent.state].colour,
          x: lkp.x,
          y: lkp.y,
          z: lkp.z,
          opacity: ghostOpacity(agent.confidence),
        });
      }
    }
    // A creature that fell back to Unaware, or is gone, starts its pop-in afresh next time.
    for (const entity of this.#shown.keys()) if (!seen.has(entity)) this.#shown.delete(entity);
    for (let i = this.#ripples.length - 1; i >= 0; i--) {
      if (now - at(this.#ripples, i).start >= RIPPLE_LIFE_S * 1000) {
        this.#ripples.splice(i, 1);
      }
    }
    for (const r of this.#ripples) {
      const ring = rippleAt((now - r.start) / 1000, r.radius, r.reduced);
      if (ring.opacity > 0) ripples.push({ x: r.x, y: r.y, z: r.z, ...ring });
    }
  }
}
