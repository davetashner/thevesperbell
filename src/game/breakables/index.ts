// Breakables in the game (mw-e03.11): the glue between the sim's breakables (src/sim/breakables),
// content's breakable profiles and the renderer. Presentation only: nothing here writes to the sim.
//
// - `breakableProfiles` turns content `breakable` entries into the sim's profile lookup (the scene
//   loader hands it to `addSceneBreakables`).
// - `bindBreakLeftovers` gives every piece of debris and every spilled prop without one a box the
//   size of its body after each step; render sync drops it when the sim removes the entity (debris
//   past its lifetime or over the budget).
// - `BreakWatch` remembers what broke, the noises made and which passages opened, for the e2e (#app[data-breakables]).
//
// No breakables, no cost: the game only binds leftovers and publishes the readout in scenes that have
// breakables (`hasBreakables`).

import type { GameContent } from '@content/index';
import {
  breakableBroken,
  noiseEmitted,
  DebrisComponent,
  passageRevealed,
  PhysicsObjectComponent,
  SpilledComponent,
  type BreakableProfile,
  type BreakResistances,
  type BreakableProfileLookup,
  type BreakCause,
  type EntityId,
  type SceneLayout,
  type Vec3,
  type World,
} from '@sim/index';
import type { RenderSync, SceneBinding } from '../loop/render-sync';

/** The sim's profile lookup over content `breakable` entries. */
export function breakableProfiles(
  content: Pick<GameContent, 'get' | 'has'>,
): BreakableProfileLookup {
  return (id) => {
    if (!content.has('breakable', id)) return undefined;
    const { resistances, debris, breakLoudness } = content.get('breakable', id);
    // Loaded content never holds an explicit undefined: a share left out is simply absent.
    const own = { ...resistances } as BreakResistances;
    const profile: BreakableProfile = {
      id,
      resistances: own,
      debris: { count: debris.count, size: debris.size },
      breakLoudness,
    };
    return profile;
  };
}

/** Whether profile `id` telegraphs its weak spot with cracks (unknown profiles do not). */
export function cracked(content: Pick<GameContent, 'get' | 'has'>, id: string): boolean {
  return content.has('breakable', id) && content.get('breakable', id).crack;
}

/** Whether a scene has anything breakable. */
export function hasBreakables(layout: SceneLayout): boolean {
  return (
    layout.pieces.some((piece) => piece.breakable !== undefined) ||
    layout.spawns.some((spawn) => spawn.breakable !== undefined)
  );
}

/**
 * Binds an object to every piece of debris and spilled prop not bound yet (call after each sim step);
 * `create` builds one for a box body of `size` metres. Returns how many it bound.
 */
export function bindBreakLeftovers<TObject>(
  world: World<never>,
  sync: RenderSync,
  create: (entity: EntityId, size: Vec3) => SceneBinding<TObject>,
): number {
  const unbound: { entity: EntityId; size: Vec3 }[] = [];
  const collect = (entity: EntityId): void => {
    const body = world.get(entity, PhysicsObjectComponent);
    if (sync.has(entity) || body?.shape.kind !== 'box') return;
    const { x, y, z } = body.shape.halfExtents;
    unbound.push({ entity, size: { x: 2 * x, y: 2 * y, z: 2 * z } });
  };
  world.query(DebrisComponent).forEach(collect);
  world.query(SpilledComponent).forEach(collect);
  for (const { entity, size } of unbound) sync.bind(entity, create(entity, size));
  return unbound.length;
}

/** One break, as the readout reports it. */
export interface BreakRecord {
  readonly tick: number;
  readonly profile: string;
  readonly cause: BreakCause;
  readonly by: string;
}

/** One noise the world made, as the readout reports it. */
export interface NoiseRecord {
  readonly tick: number;
  readonly kind: string;
  readonly loudness: number;
}

/** What broke so far in a scene, the noises made, which passages opened, and the debris alive now. */
export interface BreakReadout {
  readonly broken: readonly BreakRecord[];
  readonly noises: readonly NoiseRecord[];
  readonly passages: readonly string[];
  readonly debris: number;
}

/** Remembers breaks and opened passages from the moment it is made. */
export class BreakWatch {
  private readonly broken: BreakRecord[] = [];
  private readonly noises: NoiseRecord[] = [];
  private readonly passages: string[] = [];
  private readonly offs: (() => void)[];

  constructor(private readonly world: World<never>) {
    this.offs = [
      world.events.on(breakableBroken, ({ tick, profile, cause, by }) => {
        this.broken.push({ tick, profile, cause, by });
      }),
      world.events.on(noiseEmitted, ({ tick, kind, loudness }) => {
        this.noises.push({ tick, kind, loudness });
      }),
      world.events.on(passageRevealed, ({ passage }) => {
        this.passages.push(passage);
      }),
    ];
  }

  /** The readout now. */
  readout(): BreakReadout {
    return {
      broken: [...this.broken],
      noises: [...this.noises],
      passages: [...this.passages],
      debris: this.world.query(DebrisComponent).ids().length,
    };
  }

  /** Stops listening. */
  dispose(): void {
    for (const off of this.offs) off();
  }
}
