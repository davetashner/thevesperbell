/* eslint-disable @typescript-eslint/no-non-null-assertion */
// Light receivers (mw-e03.17): threshold, dwell, colour filter, latching and signal output.
import { describe, expect, it } from 'vitest';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import {
  BeamTracer,
  LightReceiverComponent,
  makeBeamEmitter,
  makeLightReceiver,
  setBeamActive,
  type LightReceiverSpec,
} from '../light/beams';
import { registerWorldProperties } from '../properties/components';
import { tagEntity } from '../signals/filter';
import type { SignalGraphDef } from '../signals/graph';
import {
  addSignalGraph,
  installSignals,
  pressButton,
  signalOutput,
  signalSystem,
} from '../signals/runtime';
import { placeEntity } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { installStimuli, stimulusSystem } from '../stimulus/stimulus';
import {
  lightReceiverChanged,
  resetLightReceiver,
  syncLightReceiverNodes,
  type LightReceiverChange,
} from './receivers';
import { installMechanisms } from './system';

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

function rig() {
  const world = installSignals(
    installStimuli(registerWorldProperties(new World<never>({ seed: 4, hz: 60 }))),
  );
  world.addSystem(stimulusSystem()).addSystem(signalSystem());
  const tracer = new BeamTracer();
  installMechanisms(world, { beams: tracer });
  const changes: LightReceiverChange[] = [];
  world.events.on(lightReceiverChanged, (c) => changes.push(c));
  const steps = (n: number) => {
    for (let i = 0; i < n; i++) world.step();
  };
  const receiver = (spec: Partial<LightReceiverSpec> = {}) => {
    const e = world.spawn();
    makeLightReceiver(world, e, v(5, 0, 0), spec);
    return e;
  };
  const beam = (intensity: number, options = {}) => {
    const e = world.spawn();
    makeBeamEmitter(world, e, 'sunlight', v(0, 0, 0), v(1, 0, 0), { intensity, ...options });
    return e;
  };
  const on = (e: EntityId) => world.get(e, LightReceiverComponent)!.active;
  return { world, tracer, changes, steps, receiver, beam, on };
}

describe('light receivers (mw-e03.17)', () => {
  it('AC-2: threshold 0.5, dwell 1.0 s: 0.6 held for 1.0 s activates; interrupted at 0.9 s it does not', () => {
    const held = rig();
    const eye = held.receiver({ threshold: 0.5, dwellSeconds: 1 });
    held.beam(0.6);
    held.steps(59);
    expect(held.on(eye)).toBe(false);
    held.steps(1);
    expect(held.on(eye)).toBe(true);
    expect(held.changes).toMatchObject([{ active: true, intensity: 0.6, source: null }]);

    const broken = rig();
    const other = broken.receiver({ threshold: 0.5, dwellSeconds: 1 });
    const sun = broken.beam(0.6);
    broken.steps(54); // 0.9 s
    setBeamActive(broken.world, sun, false);
    broken.steps(1);
    setBeamActive(broken.world, sun, true);
    broken.steps(59); // a fresh dwell: the 0.9 s before do not count
    expect(broken.on(other)).toBe(false);
    broken.steps(1);
    expect(broken.on(other)).toBe(true);
    expect(broken.changes).toHaveLength(1);
  });

  it('light below the threshold never turns it on, and a momentary receiver follows the light', () => {
    const r = rig();
    const eye = r.receiver({ threshold: 0.5 });
    r.beam(0.4);
    r.steps(30);
    expect(r.on(eye)).toBe(false);
    expect(r.world.get(eye, LightReceiverComponent)!.intensity).toBe(0.4);
    const strong = r.beam(0.2);
    placeEntity(r.world, strong, v(0, 0.01, 0));
    r.steps(2);
    expect(r.on(eye)).toBe(true);
    setBeamActive(r.world, strong, false);
    r.steps(2);
    expect(r.on(eye)).toBe(false);
    expect(r.changes.map((c) => c.active)).toEqual([true, false]);
  });

  it('a colour filter only counts light of its colour', () => {
    const r = rig();
    const eye = r.receiver({ filter: v(1, 0, 0) });
    const white = r.beam(1);
    r.steps(5);
    expect(r.on(eye)).toBe(false);
    setBeamActive(r.world, white, false);
    r.beam(1, { colour: v(1, 0.1, 0) });
    r.steps(2);
    expect(r.on(eye)).toBe(true);
  });

  it('a latching receiver stays on after the light goes until a signal resets it, driving its lever node', () => {
    const r = rig();
    const graph: SignalGraphDef = {
      id: 'door-eye',
      nodes: [
        { id: 'eye', kind: 'lever', entity: 'eye' },
        { id: 'reset-button', kind: 'button' },
        { id: 'reset', kind: 'receiver', receiver: 'mechanism', entity: 'eye' },
      ],
      wires: [{ from: 'reset-button.out', to: 'reset.in' }],
    };
    const eye = r.receiver({ mode: 'latching' });
    const g = addSignalGraph(r.world, graph, { bindings: { eye } });
    syncLightReceiverNodes(r.world, eye);
    expect(signalOutput(r.world, g, 'eye')).toBe(false);
    const sun = r.beam(1);
    r.steps(3);
    expect(signalOutput(r.world, g, 'eye')).toBe(true);
    setBeamActive(r.world, sun, false);
    r.steps(30);
    expect(r.on(eye)).toBe(true);
    expect(signalOutput(r.world, g, 'eye')).toBe(true);
    expect(r.world.get(eye, LightReceiverComponent)!.intensity).toBe(0);
    pressButton(r.world, g, 'reset-button');
    r.steps(3);
    expect(r.on(eye)).toBe(false);
    expect(signalOutput(r.world, g, 'eye')).toBe(false);
    expect(r.changes.at(-1)!.source).toBe(g);
    expect(resetLightReceiver(r.world, eye)).toBe(false);
    expect(resetLightReceiver(r.world, r.world.spawn())).toBe(false);
    syncLightReceiverNodes(r.world, r.world.spawn()); // not a receiver: nothing
  });

  it('drives only the lever nodes bound to it, not buttons', () => {
    const r = rig();
    const eye = r.receiver();
    const graph: SignalGraphDef = {
      id: 'both',
      nodes: [
        { id: 'level', kind: 'lever', entity: 'p', observed: true },
        { id: 'tap', kind: 'button', entity: 'p', observed: true },
      ],
      wires: [],
    };
    const g = addSignalGraph(r.world, graph, { bindings: { p: eye } });
    syncLightReceiverNodes(r.world, eye);
    r.beam(1);
    r.steps(3);
    expect(signalOutput(r.world, g, 'level')).toBe(true);
    expect(signalOutput(r.world, g, 'tap')).toBe(false);
  });

  it('a player stepping into the beam turns a momentary receiver off', () => {
    const r = rig();
    const eye = r.receiver();
    r.beam(1);
    r.steps(2);
    expect(r.on(eye)).toBe(true);
    const hero = r.world.spawn();
    placeEntity(r.world, hero, v(2, 0, 0), 0.4);
    tagEntity(r.world, hero, 'player');
    r.steps(2);
    expect(r.on(eye)).toBe(false);
  });
});
