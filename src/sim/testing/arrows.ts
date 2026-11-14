// Arrow definitions for sim tests (mw-e05.7): the shipped arrows' numbers and payload shapes, written
// out because src/sim may not import content values. Only what a test reads is faithful: which arrows
// carry a payload, spawn a rope, burn in flight, or cannot be retrieved.
import type { ArrowEntry } from '@content/index';
import { arrowLookup, type ArrowLookup } from '../combat/arrows/system';

const ZERO = { x: 0, y: 0, z: 0 };

/** An arrow definition as content would load it (the standard arrow's numbers by default). */
export function arrowDef(id: string, over: Partial<ArrowEntry> = {}): ArrowEntry {
  return {
    id,
    schemaVersion: 1,
    name: id,
    massGrams: 25,
    dragK: 0.00005,
    damage: {
      amounts: { pierce: 25 },
      poiseDamage: 15,
      staminaDamage: 0,
      impulse: ZERO,
      impactForce: 0,
      tags: [],
    },
    penetration: 20,
    onImpact: 'stick',
    retrievable: true,
    payload: [],
    cues: { trailVfx: 'vfx-arrow-trail-standard', flightSfx: 'sfx-arrow-flyby' },
    tags: [],
    ...over,
  };
}

/** Standard, broadhead, water (spent payload), rope (spawns a rope), fire (burns) and noise arrows. */
export const TEST_ARROWS: ArrowLookup = arrowLookup([
  arrowDef('standard'),
  arrowDef('broadhead', { penetration: 30 }),
  arrowDef('water', {
    payload: [
      { op: 'applyProperty', property: 'wetness', value: 1, radius: 1.5 },
      { op: 'applyProperty', property: 'burning', value: false, radius: 1.5 },
    ],
  }),
  arrowDef('rope', {
    payload: [{ op: 'spawn', entity: 'rope', length: 8, anchor: 'softAnchor' }],
  }),
  arrowDef('fire', {
    properties: { flammable: true, burning: true, fuel: 3 },
    payload: [{ op: 'applyProperty', property: 'burning', radius: 0.3 }],
  }),
  arrowDef('noise', { payload: [{ op: 'noise', loudness: 70, duration: 2 }] }),
]);
