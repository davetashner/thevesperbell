import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { elementFieldOf, installElementField } from '../field/install';
import { addProperties, readProperty, registerWorldProperties } from '../properties/components';
import { placeEntity } from '../stimulus/placement';
import { installStimuli, stimulusSystem } from '../stimulus/stimulus';
import { hashWorld } from '../snapshot';
import {
  DEBUG_COMMAND,
  DEBUG_STIM_ELEMENTS,
  isDebugCommand,
  MAX_STIM_INTENSITY,
  MAX_STIM_RADIUS,
  stimCommand,
} from './commands';
import { installDebugCommands } from './system';

const ORIGIN = { x: 0, y: 0, z: 0 };

function stimWorld() {
  const world = installElementField(
    installStimuli(registerWorldProperties(new World<unknown>({ seed: 5 }))),
  );
  installDebugCommands(world, { spawners: new Map() });
  world.addSystem(stimulusSystem());
  return world;
}

describe('stim (mw-e03.29)', () => {
  it('builds a JSON-safe command and rejects bad values at the call site', () => {
    const stim = stimCommand('heat', { x: -0, y: 1, z: 2 }, 2, 500);
    expect(stim).toEqual({
      kind: DEBUG_COMMAND,
      op: 'stim',
      element: 'heat',
      at: { x: 0, y: 1, z: 2 },
      radius: 2,
      intensity: 500,
    });
    expect(Object.is(stim.at.x, 0)).toBe(true);
    expect(isDebugCommand(stim)).toBe(true);
    for (const element of DEBUG_STIM_ELEMENTS) {
      expect(stimCommand(element, ORIGIN, 1, 1).element).toBe(element);
    }
    expect(() => stimCommand('force', ORIGIN, 1, 1)).toThrow(/element/);
    expect(() => stimCommand('heat', ORIGIN, 0, 1)).toThrow(/radius/);
    expect(() => stimCommand('heat', ORIGIN, MAX_STIM_RADIUS + 1, 1)).toThrow(/radius/);
    expect(() => stimCommand('heat', ORIGIN, 1, 0)).toThrow(/intensity/);
    expect(() => stimCommand('heat', ORIGIN, 1, MAX_STIM_INTENSITY + 1)).toThrow(/intensity/);
    expect(() => stimCommand('heat', { x: Infinity, y: 0, z: 0 }, 1, 1)).toThrow(/finite/);
  });

  it('heats the element field and the entities in the sphere through the stimulus API', () => {
    const world = stimWorld();
    const crate = world.spawn();
    addProperties(world, crate, { temperature: 20 });
    placeEntity(world, crate, { x: 0.5, y: 0, z: 0 }, 0.25);
    world.step([stimCommand('heat', ORIGIN, 2, 500)]);
    expect(elementFieldOf(world).readAt('temperature', ORIGIN)).toBeGreaterThan(20);
    expect(readProperty(world, crate, 'temperature')).toBeGreaterThan(20);
  });

  it('water wets the field', () => {
    const world = stimWorld();
    world.step([stimCommand('water', ORIGIN, 2, 1)]);
    expect(elementFieldOf(world).readAt('moisture', ORIGIN)).toBeGreaterThan(0);
  });

  it('is skipped in a world without stimuli', () => {
    const world = new World<unknown>({ seed: 5 });
    installDebugCommands(world, { spawners: new Map() });
    const other = new World<unknown>({ seed: 5 });
    installDebugCommands(other, { spawners: new Map() });
    world.step([stimCommand('heat', ORIGIN, 2, 500)]);
    other.step([]);
    expect(hashWorld(world)).toBe(hashWorld(other));
  });
});
