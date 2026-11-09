// Arrow effects testbed (mw-e29.11): the `?arrows` URL parameter looses the shipped arrows at the
// testbed's back wall and its target board so each trick arrow's effect can be seen (and the e2e can
// read what happened from #app[data-arrow-fx]).
//
//   ?arrows=demo      every arrow type in turn, one every 2.5 s, repeating
//   ?arrows=<id>      that arrow type alone, e.g. ?arrows=water
//
// The shots are real: `fireArrow` through the sim's arrow system, so the trail, impact, cue sheets,
// decals and wobble all run exactly as they do for a player's shot. Nothing here runs without the
// parameter, and it only ever adds arrows to the world.

import {
  arrowImpact,
  fireArrow,
  type ArrowImpactOutcome,
  type ArrowLookup,
  type EntityId,
  type Vec3,
  type World,
} from '@sim/index';

/** Seconds between shots. */
export const ARROW_DEMO_INTERVAL = 2.5;

/**
 * Where each demo arrow is aimed along the back wall (x, metres): the target board is near 1.5, and
 * the rest keep clear of the player standing in the middle of the view.
 */
export const ARROW_DEMO_LANES: Readonly<Record<string, number>> = Object.freeze({
  standard: 1.5,
  fire: 2.7,
  rope: 0.9,
  water: -2,
  noise: -3.2,
  blunt: -1.3,
  broadhead: 3.3,
});

/** The arrow types `?arrows=demo` cycles through, in order. */
export const ARROW_DEMO_ORDER: readonly string[] = [
  'standard',
  'fire',
  'rope',
  'water',
  'noise',
  'blunt',
  'broadhead',
];

/** Shots start by the camera (2 m into the room) and fly to the back wall, showing the trail. */
const FROM_Z = 2;
const WALL_Z = -4.6;
const HEIGHT = 1.6;
const SPEED = 32;

/** `?arrows=demo` → every type; `?arrows=<id>` → that type; otherwise undefined (off). */
export function parseArrowDemoParam(search: string): readonly string[] | undefined {
  const value = new URLSearchParams(search).get('arrows');
  if (value === null || value === '') return undefined;
  return value === 'demo' ? ARROW_DEMO_ORDER : [value];
}

/** Launch velocity that carries an arrow level from FROM_Z to the wall, ignoring drag. */
export function demoVelocity(): Vec3 {
  const distance = FROM_Z - WALL_Z;
  const time = distance / SPEED;
  // Aim at the board's height: the arrow falls 1/2 g t^2 on the way, so lift the launch to match.
  const rise = 0.5 * 9.81 * time * time;
  return { x: 0, y: rise / time, z: -SPEED };
}

/** What the demo has seen, for the e2e probe. */
export interface ArrowDemoStats {
  readonly shots: number;
  readonly impacts: readonly { readonly arrow: string; readonly outcome: ArrowImpactOutcome }[];
}

/** Looses the arrows of `order` one after another and records their impacts. */
export class ArrowDemo {
  readonly #world: World<never>;
  readonly #arrows: ArrowLookup;
  readonly #order: readonly string[];
  readonly #impacts: { arrow: string; outcome: ArrowImpactOutcome }[] = [];
  #since = ARROW_DEMO_INTERVAL;
  #shots = 0;
  #off: () => void;

  constructor(world: World<never>, arrows: ArrowLookup, order: readonly string[]) {
    this.#world = world;
    this.#arrows = arrows;
    this.#order = order;
    this.#off = world.events.on(arrowImpact, ({ arrow, outcome }) => {
      this.#impacts.push({ arrow, outcome });
      if (this.#impacts.length > 32) this.#impacts.shift();
    });
  }

  get stats(): ArrowDemoStats {
    return { shots: this.#shots, impacts: this.#impacts };
  }

  /** Stops recording. */
  dispose(): void {
    this.#off();
  }

  /** Call once per frame with the seconds since the last. Returns the arrow it loosed, if any. */
  update(dt: number): EntityId | undefined {
    this.#since += dt;
    if (this.#since < ARROW_DEMO_INTERVAL) return undefined;
    this.#since = 0;
    const arrow = this.#order[this.#shots % this.#order.length];
    if (arrow === undefined) return undefined;
    this.#shots++;
    const lane = ARROW_DEMO_LANES[arrow] ?? 0;
    return fireArrow(this.#world, this.#arrows, {
      arrow,
      origin: { x: lane, y: HEIGHT, z: FROM_Z },
      velocity: demoVelocity(),
    });
  }
}
