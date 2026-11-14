// Impact noise (mw-e03.25): the one place a physics contact becomes a sound. Every `physicsImpact`
// (a crate dropped, a thrown flask, a chandelier landing, a pile that falls in) is a noise whose
// loudness follows from its kinetic energy and the materials that met, never from what kind of
// object it was:
//
//   loudness = refDb + dbPerDecade · log10(energy / refEnergy) + max(offset(a), offset(b)), ≤ maxDb
//
// Below `minEnergy` it is silent, so a settling pile's 50 micro-impacts a second make no noise
// (spam suppression). The offset is the material's surface loudness (dB relative to stone; its
// `footstepLoudness`): glass rings, cloth thuds, and the louder of the two surfaces speaks. The
// curve is data (`noise.impact` of the stealth table). Who gets the blame: whoever dropped or threw
// the item, or the instigator the damage rules recorded; a creature never hears its own noise
// (propagation skips a listener that is the source or the sounding entity).
//
// What sounds like what is the cue sheets' (physicsImpact plays the material's impact set); this
// module never reads that. Docs: docs/design/noise-events.md. Pure sim maths through simMath.

import type { NoiseTuning } from '@content/index';
import { BlameComponent } from '../combat/environment/environment';
import type { EntityId } from '../core/component';
import type { World } from '../core/world';
import { WorldItemComponent } from '../items/world-items';
import { log } from '../math';
import { liquidEntered } from '../liquids/volumes';
import { kineticEnergyOf, physicsImpact } from '../physics/objects';
import { readProperty } from '../properties/components';
import { PlacementComponent } from '../stimulus/placement';
import { noiseEmitted } from './events';

/** The noise kind of a world item's impact (a dropped key, a thrown flask). */
export const ITEM_IMPACT_NOISE = 'item-impact';
/** The noise kind of any other physics object's impact (a crate, a chandelier, a boulder). */
export const OBJECT_IMPACT_NOISE = 'object-impact';

/** The noise kind of a body going into liquid. */
export const SPLASH_NOISE = 'splash';

/** The impact curve (the stealth table's `noise.impact`). */
export type ImpactCurve = NoiseTuning['impact'];

/**
 * Loudness, dB at 1 m, of an impact of `energy` J between surfaces whose loudness offsets are
 * `offsetA` and `offsetB`; null when it is below the curve's minimum energy (or not a number).
 */
export function impactLoudness(
  curve: ImpactCurve,
  energy: number,
  offsetA = 0,
  offsetB = 0,
): number | null {
  if (!(energy >= curve.minEnergy)) return null;
  const level =
    curve.refDb +
    (curve.dbPerDecade * log(energy / curve.refEnergy)) / Math.LN10 +
    Math.max(offsetA, offsetB);
  return Math.min(curve.maxDb, Math.max(0, level));
}

/** What impact noise reads. */
export interface ImpactNoiseOptions {
  readonly curve: ImpactCurve;
  /** Material id → surface loudness offset, dB relative to stone; unknown materials: 0. */
  readonly offsetOf?: (material: string) => number | undefined;
}

const isItem = (w: World<never>, entity: EntityId): boolean =>
  w.isRegistered(WorldItemComponent) && w.has(entity, WorldItemComponent);

/** Whoever dropped or threw an item, else the instigator the damage rules recorded, else null. */
function sourceOf(w: World<never>, entity: EntityId): EntityId | null {
  const item = w.isRegistered(WorldItemComponent) ? w.get(entity, WorldItemComponent) : undefined;
  if (item !== undefined) return item.by;
  return w.isRegistered(BlameComponent)
    ? (w.get(entity, BlameComponent)?.instigator ?? null)
    : null;
}

/**
 * Makes every physics impact a `noiseEmitted` by the curve (see the file header). Install once,
 * after the physics objects; the world needs the world-item component registered only if it has
 * world items. Returns a function that stops it.
 */
export function installImpactNoise<T>(world: World<T>, options: ImpactNoiseOptions): () => void {
  const w = world as unknown as World<never>;
  const offset = (material: string): number => options.offsetOf?.(material) ?? 0;
  const offs = [
    w.events.on(physicsImpact, ({ entity, position, energy, materials }) => {
      const loudness = impactLoudness(
        options.curve,
        energy,
        offset(materials[0]),
        offset(materials[1]),
      );
      if (loudness === null) return;
      w.events.emit(noiseEmitted, {
        tick: w.tick,
        position,
        loudness,
        kind: isItem(w, entity) ? ITEM_IMPACT_NOISE : OBJECT_IMPACT_NOISE,
        entity,
        source: sourceOf(w, entity),
      });
    }),
    // A body that goes under a liquid's surface splashes by the energy it carries in; water rising
    // over a resting crate carries none, so it is silent.
    w.events.on(liquidEntered, ({ entity, volume }) => {
      const at = w.get(entity, PlacementComponent);
      if (at === undefined) return;
      const loudness = impactLoudness(
        options.curve,
        kineticEnergyOf(w, entity),
        offset(readProperty(w, volume, 'material')),
      );
      if (loudness === null) return;
      w.events.emit(noiseEmitted, {
        tick: w.tick,
        position: { x: at.x, y: at.y, z: at.z },
        loudness,
        kind: SPLASH_NOISE,
        entity,
        source: sourceOf(w, entity),
      });
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
