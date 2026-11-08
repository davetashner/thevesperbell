// Charge receivers (mw-e03.8): a mechanism input that electric charge reaches (an arcane conduit, an
// old dwarven lift). It is on while the charge it holds is at or above its `chargeActivated`
// threshold (a world property, so level data and materials set it like any other). A `momentary`
// receiver goes off when the charge drains; a `latching` one stays on until a signal resets it
// (`mechanism` receiver bound to it, on; or `resetChargeReceiver`). Like any switch it drives the
// lever nodes bound to it in signal graphs, and `chargeReceiverChanged` reports every change.
//
// The receiver holds no charge of its own: it reads the entity's `charge` property, which the
// conduction rules (src/sim/electricity) fill when the receiver touches a charged network. So it
// must be conductive, or soaked, to be part of one.

import type { EntityId } from '../core/component';
import { defineComponent } from '../core/component';
import { defineEvent } from '../core/events';
import type { World } from '../core/world';
import { addProperties, readProperty } from '../properties/components';
import { setLever } from '../signals/runtime';
import { boundNodes } from './bindings';

const known = <T>(value: T | undefined): T => value as T;

/** How a charge receiver behaves once its charge drains. */
export const CHARGE_RECEIVER_MODES = ['momentary', 'latching'] as const;
export type ChargeReceiverMode = (typeof CHARGE_RECEIVER_MODES)[number];

/** What defines a charge receiver. */
export interface ChargeReceiverSpec {
  /** Charge at or above which it turns on (stored as the entity's `chargeActivated`), > 0. */
  readonly threshold: number;
  readonly mode: ChargeReceiverMode;
}

/** A charge receiver (`mechanisms.chargeReceiver`; a snapshot and save key, never renamed). */
export interface ChargeReceiver {
  readonly mode: ChargeReceiverMode;
  readonly active: boolean;
}

export const ChargeReceiverComponent = defineComponent<ChargeReceiver>('mechanisms.chargeReceiver');

/** A charge receiver turned on or off. */
export interface ChargeReceiverChange {
  readonly tick: number;
  readonly entity: EntityId;
  readonly active: boolean;
  /** Charge it held at the time. */
  readonly charge: number;
  /** The signal that reset it, else null. */
  readonly source: EntityId | null;
}

export const chargeReceiverChanged = defineEvent<ChargeReceiverChange>('chargeReceiverChanged');

/**
 * Makes `entity` a charge receiver (outside a step, or it appears at the end of the tick). Throws a
 * RangeError for a threshold that is not a finite number above 0.
 */
export function makeChargeReceiver(
  world: World<never>,
  entity: EntityId,
  spec: Partial<ChargeReceiverSpec> & Pick<ChargeReceiverSpec, 'threshold'>,
): void {
  const { threshold, mode = 'momentary' } = spec;
  if (!(Number.isFinite(threshold) && threshold > 0)) {
    throw new RangeError('a charge receiver needs a threshold above 0');
  }
  addProperties(world, entity, { chargeActivated: threshold });
  world.add(entity, ChargeReceiverComponent, { mode, active: false });
}

function write(
  world: World<never>,
  entity: EntityId,
  receiver: ChargeReceiver,
  active: boolean,
  charge: number,
  source: EntityId | null,
): void {
  if (receiver.active === active) return;
  world.set(entity, ChargeReceiverComponent, { ...receiver, active });
  for (const [graph, node, kind] of boundNodes(world, entity)) {
    if (kind === 'lever') setLever(world, graph, node, active);
  }
  world.events.emit(chargeReceiverChanged, { tick: world.tick, entity, active, charge, source });
}

/** Turns every receiver on or off from the charge it holds now (ascending entity id). */
export function stepChargeReceivers(world: World<never>): void {
  if (!world.isRegistered(ChargeReceiverComponent)) return;
  for (const entity of [...world.query(ChargeReceiverComponent).ids()]) {
    const receiver = known(world.get(entity, ChargeReceiverComponent));
    const charge = readProperty(world, entity, 'charge');
    const reached = charge >= readProperty(world, entity, 'chargeActivated');
    if (receiver.active && receiver.mode === 'latching') continue;
    write(world, entity, receiver, reached, charge, null);
  }
}

/** Turns a receiver off (a latching receiver's way off). False: it was off. */
export function resetChargeReceiver(
  world: World<never>,
  entity: EntityId,
  source: EntityId | null = null,
): boolean {
  const receiver = world.get(entity, ChargeReceiverComponent);
  if (receiver?.active !== true) return false;
  write(world, entity, receiver, false, readProperty(world, entity, 'charge'), source);
  return true;
}

/** Sets every lever node bound to `entity`'s receiver to its state (a scene's start). */
export function syncChargeReceiverNodes(world: World<never>, entity: EntityId): void {
  const receiver = world.get(entity, ChargeReceiverComponent);
  if (receiver === undefined) return;
  for (const [graph, node, kind] of boundNodes(world, entity)) {
    if (kind === 'lever') setLever(world, graph, node, receiver.active);
  }
}
