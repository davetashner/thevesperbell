// Persistent spell volumes (mw-e06.5): a fire wall, an ice sheet, a cloud of marsh gas. The
// `spawnVolume` op leaves a `magic.volume` entity at the hit point; each tick until it expires, the
// volume feeds the world through the ONE stimulus API (`applyStimulus`), a slice of its per-second
// intensity per tick. What that does (ignite, freeze, conduct, wet) is decided by the properties of
// whatever stands in it, exactly as for an instant spell; a volume knows no object and no spell.
//
// Shapes. The spell's area shape maps onto a stimulus shape at the hit point, aimed from the caster
// toward it (flattened to the ground; north when they coincide): sphere → sphere; cone → cone;
// line (a wall) → a capsule along the aim whose radius is the larger of half its width and half its
// height, raised half its height; decal (a ground patch) → a box of the patch's radius, 1 m tall.
// Capsules and boxes are the stimulus API's shapes; a wall's corners are rounded, a decal is square.
//
// Order. Add the volume system before `stimulusSystem` so a tick's emissions resolve in the same
// tick. Volumes are visited in ascending entity id, and the stimulus queue is order-independent, so
// replays agree whatever the spawn order.

import type { EntityId } from '../core/component';
import { defineComponent } from '../core/component';
import { defineEvent } from '../core/events';
import type { System, World } from '../core/world';
import { placementOf } from '../stimulus/placement';
import type { StimulusFalloff, StimulusShape, Vec3 } from '../stimulus/shapes';
import { applyStimulus, type StimulusElement } from '../stimulus/stimulus';
import type { SpellPipeline } from './pipeline';
import type { OpContext, OpOf } from './registry';

/** A stimulus volume (`magic.volume`; a snapshot and save key, never renamed). Plain data. */
export interface SpellVolume {
  readonly caster: EntityId;
  readonly shape: StimulusShape;
  readonly element: StimulusElement;
  /** Per second at full falloff, in the element's unit. */
  readonly intensity: number;
  readonly falloff: StimulusFalloff;
  /** Ticks it still emits; at 0 it is gone. */
  readonly ticksLeft: number;
  readonly gas?: string;
}
export const SpellVolumeComponent = defineComponent<SpellVolume>('magic.volume');

/** A volume appeared (render: start its loop). */
export interface SpellVolumeSpawnedInfo {
  readonly tick: number;
  readonly volume: EntityId;
  readonly caster: EntityId;
  readonly element: StimulusElement;
  readonly shape: StimulusShape;
}
export const SpellVolumeSpawned = defineEvent<SpellVolumeSpawnedInfo>('SpellVolumeSpawned');

/** A volume ran out and is gone (render: end its loop). */
export interface SpellVolumeExpiredInfo {
  readonly tick: number;
  readonly volume: EntityId;
  readonly caster: EntityId;
}
export const SpellVolumeExpired = defineEvent<SpellVolumeExpiredInfo>('SpellVolumeExpired');

type VolumeOp = OpOf<'spawnVolume'>;

/** Unit horizontal direction from `from` toward `to`; north (-z) when they coincide. */
function aimFlat(from: Vec3 | undefined, to: Vec3): Vec3 {
  const dx = from === undefined ? 0 : to.x - from.x;
  const dz = from === undefined ? 0 : to.z - from.z;
  const length = Math.sqrt(dx * dx + dz * dz);
  return length < 1e-9 ? { x: 0, y: 0, z: -1 } : { x: dx / length, y: 0, z: dz / length };
}

/** The stimulus shape of `op`'s area at `point`, aimed from `from` (the caster) toward it. */
export function volumeShape(op: VolumeOp, point: Vec3, from: Vec3 | undefined): StimulusShape {
  const aim = aimFlat(from, point);
  const area = op.shape;
  switch (area.kind) {
    case 'sphere':
      return { kind: 'sphere', center: point, radius: area.radius };
    case 'cone':
      return {
        kind: 'cone',
        apex: point,
        direction: aim,
        length: area.length,
        halfAngle: (area.angle / 2) * (Math.PI / 180),
      };
    case 'line': {
      const y = point.y + area.height / 2;
      return {
        kind: 'capsule',
        from: { x: point.x, y, z: point.z },
        to: { x: point.x + aim.x * area.length, y, z: point.z + aim.z * area.length },
        radius: Math.max(area.width, area.height) / 2,
      };
    }
    case 'decal':
      return {
        kind: 'box',
        center: point,
        halfExtents: { x: area.radius, y: 0.5, z: area.radius },
      };
  }
}

/** Leaves a volume for `op` at the hit point; the op handler's body. */
function spawnVolume(ctx: OpContext, op: VolumeOp) {
  const w = ctx.world;
  const ticks = Math.max(1, Math.round(op.duration * w.clock.hz));
  const volume: SpellVolume = {
    caster: ctx.caster,
    shape: volumeShape(op, ctx.point, placementOf(w, ctx.caster)),
    element: op.element,
    intensity: op.intensity,
    falloff: op.falloff,
    ticksLeft: ticks,
    ...(op.gas === undefined ? {} : { gas: op.gas }),
  };
  const entity = w.spawn();
  w.add(entity, SpellVolumeComponent, volume);
  w.events.emit(SpellVolumeSpawned, {
    tick: w.tick,
    volume: entity,
    caster: ctx.caster,
    element: op.element,
    shape: volume.shape,
  });
  return { element: op.element, intensity: op.intensity, duration: op.duration };
}

/**
 * Wires persistent volumes into a world that has `installSpells` and `installStimuli`: registers the
 * component, the `spawnVolume` op on `pipeline`, and the system that emits and expires volumes. Add
 * it before `stimulusSystem`. Call once at setup, outside a step.
 */
export function installSpellVolumes<TInput>(world: World<TInput>, pipeline: SpellPipeline): void {
  world.register(SpellVolumeComponent);
  pipeline.ops.register('spawnVolume', spawnVolume);
  const system: System<TInput> = {
    name: 'spell-volumes',
    run: ({ world: sim, clock }) => {
      const w: World<never> = sim;
      w.query(SpellVolumeComponent).forEach((id, volume) => {
        if (volume.ticksLeft <= 0) {
          w.destroy(id);
          w.events.emit(SpellVolumeExpired, { tick: w.tick, volume: id, caster: volume.caster });
          return;
        }
        w.set(id, SpellVolumeComponent, { ...volume, ticksLeft: volume.ticksLeft - 1 });
        applyStimulus(w, {
          shape: volume.shape,
          element: volume.element,
          intensity: volume.intensity / clock.hz,
          falloff: volume.falloff,
          source: volume.caster,
          ...(volume.gas === undefined ? {} : { gas: volume.gas }),
        });
      });
    },
  };
  world.addSystem(system);
}
