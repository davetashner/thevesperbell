// Light receivers (mw-e03.17): a sensor that a light beam (src/sim/light/beams.ts) lands on. It is on
// once the intensity it receives (beams of its colour filter only) has been at or above its
// `threshold` for `dwellSeconds` without a break; a break of even one tick restarts the dwell. A
// `momentary` receiver goes off the tick the light does (an actor stepping into the beam, a mirror
// turned away); a `latching` one stays on until a signal resets it (`mechanism` receiver bound to
// it, on; or `resetLightReceiver`). Like any switch it drives the lever nodes bound to it in signal
// graphs, and `lightReceiverChanged` reports every change.

import type { EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { System, World } from '../core/world';
import { LightReceiverComponent, type BeamTracer, type LightReceiver } from '../light/beams';
import { setLever } from '../signals/runtime';
import { boundNodes } from './bindings';

/** A receiver turned on or off. */
export interface LightReceiverChange {
  readonly tick: number;
  readonly entity: EntityId;
  readonly active: boolean;
  /** Intensity it had at the time. */
  readonly intensity: number;
  /** The signal that reset it, else null. */
  readonly source: EntityId | null;
}

export const lightReceiverChanged = defineEvent<LightReceiverChange>('lightReceiverChanged');

const known = <T>(value: T | undefined): T => value as T;

function write(
  world: World<never>,
  entity: EntityId,
  before: LightReceiver,
  next: LightReceiver,
  source: EntityId | null,
): void {
  if (
    next.active === before.active &&
    next.held === before.held &&
    next.intensity === before.intensity
  ) {
    return;
  }
  world.set(entity, LightReceiverComponent, next);
  if (next.active === before.active) return;
  for (const [graph, node, kind] of boundNodes(world, entity)) {
    if (kind === 'lever') setLever(world, graph, node, next.active);
  }
  world.events.emit(lightReceiverChanged, {
    tick: world.tick,
    entity,
    active: next.active,
    intensity: next.intensity,
    source,
  });
}

function stepReceiver(
  world: World<never>,
  entity: EntityId,
  receiver: LightReceiver,
  intensity: number,
): void {
  if (receiver.active && receiver.mode === 'latching') {
    write(world, entity, receiver, { ...receiver, intensity }, null);
    return;
  }
  const lit = intensity >= receiver.threshold;
  const held = lit ? receiver.held + 1 : 0;
  const needed = Math.round(receiver.dwellSeconds * world.clock.hz);
  const active = lit && (receiver.active || held >= needed);
  write(world, entity, receiver, { ...receiver, intensity, held, active }, null);
}

/** Turns a receiver off and restarts its dwell (a latching receiver's way off). False: it was off. */
export function resetLightReceiver(
  world: World<never>,
  entity: EntityId,
  source: EntityId | null = null,
): boolean {
  const receiver = world.get(entity, LightReceiverComponent);
  if (!receiver?.active) return false;
  write(world, entity, receiver, { ...receiver, active: false, held: 0 }, source);
  return true;
}

/** Sets every lever node bound to `entity`'s receiver to its state (a scene's start). */
export function syncLightReceiverNodes(world: World<never>, entity: EntityId): void {
  const receiver = world.get(entity, LightReceiverComponent);
  if (receiver === undefined) return;
  for (const [graph, node, kind] of boundNodes(world, entity)) {
    if (kind === 'lever') setLever(world, graph, node, receiver.active);
  }
}

/** The receivers system: reads what `tracer` traced this tick. Add it after the beams system. */
export function lightReceiversSystem<TInput>(tracer: BeamTracer): System<TInput> {
  return {
    name: 'light-receivers',
    run: ({ world: w }) => {
      const world: World<never> = w;
      for (const entity of [...world.query(LightReceiverComponent).ids()]) {
        stepReceiver(
          world,
          entity,
          known(world.get(entity, LightReceiverComponent)),
          tracer.intensityAt(entity),
        );
      }
    },
  };
}
