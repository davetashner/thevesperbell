// The deliveries the pipeline ships with (mw-e06.2): self and touch, both instant. Projectile, area
// and beam deliveries are registered by their own beads (e06.6, e06.7); a spell that needs one that
// is not registered fizzles with `unsupported-delivery` before anything is spent.

import type { Placement } from '../stimulus/placement';
import { hypot } from '../math';
import { placementOf } from '../stimulus/placement';
import { DeliveryRegistry, type DeliveryContext, type DeliveryResult } from './registry';

function self(ctx: DeliveryContext<'self'>): DeliveryResult {
  const at = placementOf(ctx.world, ctx.request.caster);
  const point = at === undefined ? { x: 0, y: 0, z: 0 } : { x: at.x, y: at.y, z: at.z };
  return { kind: 'hits', hits: [{ target: ctx.request.caster, point }] };
}

function distance(a: Placement, b: Placement): number {
  return hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function touch(ctx: DeliveryContext<'touch'>): DeliveryResult {
  const { delivery, request, world } = ctx;
  const { target } = request;
  if (target === undefined || !world.isAlive(target))
    return { kind: 'fizzle', reason: 'no-target' };
  const from = placementOf(world, request.caster);
  const to = placementOf(world, target);
  if (from === undefined || to === undefined) return { kind: 'fizzle', reason: 'no-position' };
  if (distance(from, to) > delivery.reach + to.radius) {
    return { kind: 'fizzle', reason: 'out-of-reach' };
  }
  return { kind: 'hits', hits: [{ target, point: { x: to.x, y: to.y, z: to.z } }] };
}

/** A registry holding the built-in deliveries. */
export function builtInDeliveries(): DeliveryRegistry {
  return new DeliveryRegistry().register('self', self).register('touch', touch);
}
