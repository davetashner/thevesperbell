// The effect ops the pipeline ships with (mw-e06.2): damage, stimulus and status. Every other op
// (force, summon, light, noise…) is one `OpRegistry.register` call in its own bead. Ops speak the
// sim's shared vocabularies — the damage model and the one stimulus API — and never script a pair
// of things against each other.

import { applyStimulus } from '../stimulus/stimulus';
import type { StimulusInput } from '../stimulus/stimulus';
import type { StimulusShape } from '../stimulus/shapes';
import { placementOf } from '../stimulus/placement';
import {
  MAX_STATUS_STACKS,
  statusLedger,
  StatusLedgerComponent,
  type AppliedStatus,
} from './components';
import { OpRegistry, type OpContext } from './registry';

/**
 * The shape a stimulus op acts through: a ray (capsule) from the caster to the hit point, else a
 * sphere of its radius at the hit, else the thing struck (or the bare point).
 */
function stimulusShape(
  ctx: OpContext,
  op: { readonly radius: number; readonly ray?: { readonly width: number } | undefined },
): StimulusShape {
  if (op.ray !== undefined) {
    const from = placementOf(ctx.world, ctx.caster) ?? ctx.point;
    return {
      kind: 'capsule',
      from: { x: from.x, y: from.y, z: from.z },
      to: ctx.point,
      radius: op.ray.width,
    };
  }
  if (op.radius > 0) return { kind: 'sphere', center: ctx.point, radius: op.radius };
  if (ctx.target !== null) return { kind: 'contact', target: ctx.target };
  return { kind: 'point', at: ctx.point };
}

/** A registry holding the built-in ops. */
export function builtInOps(): OpRegistry {
  return new OpRegistry()
    .register('damage', (ctx, op) => {
      if (ctx.target === null) return undefined;
      const result = ctx.damage.apply(ctx.world, ctx.target, {
        instigator: ctx.caster,
        source: ctx.delivery,
        amounts: op.amounts,
        poiseDamage: op.poiseDamage,
        staminaDamage: op.staminaDamage,
        impulse: op.impulse,
        impactForce: op.impactForce,
        tags: op.tags,
      });
      return result === undefined ? undefined : { total: result.total, died: result.died };
    })
    .register('stimulus', (ctx, op) => {
      const input: StimulusInput = {
        shape: stimulusShape(ctx, op),
        element: op.element,
        intensity: op.intensity,
        duration: op.duration,
        falloff: op.falloff,
        source: ctx.caster,
        ...(op.gas === undefined ? {} : { gas: op.gas }),
      };
      return applyStimulus(ctx.world, input)
        ? { element: op.element, intensity: op.intensity }
        : undefined;
    })
    .register('status', (ctx, op) => {
      if (ctx.target === null) return undefined;
      const [id, ledger] = statusLedger(ctx.world);
      const expiresTick =
        ctx.world.tick + Math.max(1, Math.round(op.duration * ctx.world.clock.hz));
      const held = ledger.entries.find(
        (entry) => entry.target === ctx.target && entry.status === op.status,
      );
      const next: AppliedStatus = {
        target: ctx.target,
        status: op.status,
        stacks: Math.min(MAX_STATUS_STACKS, (held?.stacks ?? 0) + op.stacks),
        expiresTick: Math.max(held?.expiresTick ?? 0, expiresTick),
        source: ctx.caster,
      };
      const entries =
        held === undefined
          ? [...ledger.entries, next]
          : ledger.entries.map((entry) => (entry === held ? next : entry));
      ctx.world.set(id, StatusLedgerComponent, { entries });
      return { status: op.status, stacks: next.stacks };
    });
}
