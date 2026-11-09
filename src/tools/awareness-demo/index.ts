// Awareness indicator testbed (mw-e29.12): the `?awareness=demo` URL parameter lines six stand-in
// creatures up in front of the player, one in each alert state (Unaware shows nothing), each Alerted
// or less alarmed one in view at a typical fight distance, so the indicator shapes can be looked at
// and the e2e can read what was drawn from #app[data-awareness]. The stand-ins are readings fed to
// the same indicator rules as real creatures (src/game/vfx/awareness-fx.ts); they are not in the
// sim, so nothing here can touch a golden. Nothing runs without the parameter.

import type { AgentReading } from '@game/vfx/awareness-fx';
import type { AlertState } from '@content/index';
import type { NoiseEvent, Vec3 } from '@sim/index';

/** The demo row, left to right: every alert state, calmest first. */
export const AWARENESS_DEMO_STATES: readonly AlertState[] = [
  'unaware',
  'suspicious',
  'investigating',
  'searching',
  'alerted',
  'combat',
];

/** Suspicion shown on the Suspicious stand-in. */
export const AWARENESS_DEMO_SUSPICION = 0.4;
/** Metres in front of the player the row stands, and between neighbours. */
export const AWARENESS_DEMO_DISTANCE = 4;
export const AWARENESS_DEMO_SPACING = 1.5;
/** Entity ids of the stand-ins (far from any real entity's id range). */
const BASE_ID = 900_000;

/** `?awareness=demo` → true; otherwise false (off). */
export function parseAwarenessDemoParam(search: string): boolean {
  return new URLSearchParams(search).get('awareness') === 'demo';
}

/**
 * The stand-ins for a player at `origin` facing `yaw` (radians; 0 faces -z, as the camera does by
 * default). The Searching stand-in has lost its target and remembers it two metres to the side.
 */
export function awarenessDemoAgents(
  origin: Vec3,
  yaw: number,
  into: AgentReading[],
): AgentReading[] {
  into.length = 0;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const rx = -fz;
  const rz = fx;
  const half = (AWARENESS_DEMO_STATES.length - 1) / 2;
  AWARENESS_DEMO_STATES.forEach((state, i) => {
    const across = (i - half) * AWARENESS_DEMO_SPACING;
    const feet = {
      x: origin.x + fx * AWARENESS_DEMO_DISTANCE + rx * across,
      y: origin.y,
      z: origin.z + fz * AWARENESS_DEMO_DISTANCE + rz * across,
    };
    into.push({
      entity: BASE_ID + i,
      state,
      awareness: state === 'suspicious' ? AWARENESS_DEMO_SUSPICION : 1,
      feet,
      height: 1.8,
      lkp: state === 'searching' ? { x: feet.x + rx * 2, y: feet.y, z: feet.z + rz * 2 } : null,
      confidence: 0.8,
      targetVisible: false,
    });
  });
  return into;
}

/** Milliseconds between the demo's noises. */
export const AWARENESS_DEMO_NOISE_MS = 3000;

/**
 * A noise a few metres ahead of the player's feet, for the ripple to draw. It is fed to the effect
 * directly, never to the sim's bus, so no creature hears it and no recording can see it.
 */
export function awarenessDemoNoise(origin: Vec3, tick: number): NoiseEvent {
  return {
    tick,
    position: { x: origin.x + 1.5, y: origin.y, z: origin.z - 2 },
    loudness: 48,
    kind: 'demo',
    entity: null,
    source: null,
  };
}
