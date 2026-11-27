// Effect kinds that move the player through the world (mw-e20.14), for services such as a barge
// fare (mw-e25.15) or an inn bed, registered through the DSL's extension registry:
//   `heal`        { amount } or { full: true }: restores the player's health, never past the maximum.
//   `advanceTime` { minutes?, hours?, days? }: jumps the game clock; they add up, at least a minute.
//   `travelTo`    { scene, spawn }: asks the game to enter `scene` at its spawn `spawn`.
// None changes anything until its batch committed (they `defer`, as `emit` does), so a refused
// purchase, or a condition such as a time-of-day window, leaves health, clock and place untouched.
// Deferred actions run in the order the effects are written: the host jumps the clock, then asks to
// travel, so the traveller arrives at the new time (list `advanceTime` before `travelTo`; the service
// validation insists). The host decides how: the game clock's `advanceTime` fires every day start,
// phase change, hour and scheduled event it crosses in order; `travelTo` becomes the `travelRequested`
// event the transition controller answers by swapping the scene in place.

import { z } from 'zod';
import { MINUTES_PER_DAY } from '../rest/day-clock';
import type { LogicRegistry } from './registry';

const id = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'expected a kebab-case id');

const duration = z
  .strictObject({
    minutes: z
      .int()
      .min(1)
      .max(MINUTES_PER_DAY * 30)
      .optional(),
    hours: z
      .int()
      .min(1)
      .max(24 * 30)
      .optional(),
    days: z.int().min(1).max(30).optional(),
  })
  .refine((d) => d.minutes !== undefined || d.hours !== undefined || d.days !== undefined, {
    message: 'give at least one of `minutes`, `hours` and `days`',
  });

/** Game minutes an `advanceTime` node stands for. */
export function advanceMinutes(node: {
  readonly minutes?: number | undefined;
  readonly hours?: number | undefined;
  readonly days?: number | undefined;
}): number {
  return (node.minutes ?? 0) + (node.hours ?? 0) * 60 + (node.days ?? 0) * MINUTES_PER_DAY;
}

/** Registers `heal`, `advanceTime` and `travelTo` into `registry`. */
export function registerTravelKinds(registry: LogicRegistry): void {
  registry.registerEffect({
    kind: 'heal',
    schema: z.union([
      z.strictObject({ amount: z.int().min(1).max(10_000) }),
      z.strictObject({ full: z.literal(true) }),
    ]),
    apply: (node, host, defer) => {
      defer(() => {
        host.heal('full' in node ? 'full' : node.amount);
      });
      return undefined;
    },
  });
  registry.registerEffect({
    kind: 'advanceTime',
    schema: duration,
    apply: (node, host, defer) => {
      defer(() => {
        host.advanceTime(advanceMinutes(node));
      });
      return undefined;
    },
  });
  registry.registerEffect({
    kind: 'travelTo',
    schema: z.strictObject({ scene: id, spawn: id }),
    apply: (node, host, defer) => {
      defer(() => {
        host.travelTo(node.scene, node.spawn);
      });
      return undefined;
    },
    refs: (node) => [
      { type: 'scene', id: node.scene },
      { type: 'spawn', id: `${node.scene}/${node.spawn}` },
    ],
  });
}
