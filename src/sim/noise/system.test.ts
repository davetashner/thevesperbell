import { describe, expect, it } from 'vitest';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import { DoorComponent, type Door, type DoorProfile } from '../mechanisms/components';
import { closeDoor, installMechanisms, makeDoor } from '../mechanisms/system';
import { registerWorldProperties } from '../properties/components';
import { placeEntity } from '../stimulus/placement';
import { installStimuli, stimulusSystem } from '../stimulus/stimulus';
import { noiseEmitted, type NoiseEvent } from './events';
import { buildSoundGraph, type SoundPortal } from './graph';
import { DEFAULT_NOISE_TUNING, distanceGainDb } from './propagation';
import {
  doorSoundState,
  emitNoise,
  installNoisePropagation,
  NoiseListenerComponent,
  noiseHeard,
  worldPortalGain,
  type NoiseHeard,
} from './system';

const v = (x: number, y: number, z: number) => ({ x, y, z });

const WOODEN_DOOR: DoorProfile = {
  id: 'wooden-door',
  kind: 'hinged',
  size: v(1.2, 2.2, 0.06),
  seconds: 1,
  crush: 0,
  manual: true,
  blocks: { light: true, gas: true, sound: true },
  loudness: 50,
};
const GRILLE: DoorProfile = {
  ...WOODEN_DOOR,
  id: 'grille',
  blocks: { light: false, gas: false, sound: false },
};

/** Two rooms 1 m apart joined only by a doorway at x = 10.5 holding `door`. */
const graphWith = (door: EntityId | null) =>
  buildSoundGraph({
    rooms: [
      { id: 'a', min: v(0, 0, 0), max: v(10, 3, 10) },
      { id: 'b', min: v(11, 0, 0), max: v(21, 3, 10) },
    ],
    portals: [{ id: 'door', rooms: ['a', 'b'], position: v(10.5, 1, 5), door }],
  });

/** A world with properties, stimuli and mechanisms (what doors need). */
function mechanismWorld(): World<never> {
  const world = installStimuli(registerWorldProperties(new World<never>({ seed: 3 })));
  world.addSystem(stimulusSystem());
  installMechanisms(world);
  return world;
}

function setup(profile: DoorProfile = WOODEN_DOOR, state: 'open' | 'closed' = 'open') {
  const world = mechanismWorld();
  const door = world.spawn();
  makeDoor(world, door, profile, { origin: v(10.5, 0, 5), yaw: 90, state });
  const propagation = installNoisePropagation(world, { graph: graphWith(door) });
  const guard = world.spawn();
  placeEntity(world, guard, v(16, 1, 5), 0.4);
  world.add(guard, NoiseListenerComponent, { thresholdDb: 0, range: 50 });
  const heard: NoiseHeard[] = [];
  world.events.on(noiseHeard, (e) => {
    if (e.noise.kind === 'bottle') heard.push(e);
  });
  const bottle = () => {
    emitNoise(world, { position: v(5, 1, 5), loudness: 60, kind: 'bottle' });
    world.events.flush();
    return heard.at(-1)?.level;
  };
  return { world, door, guard, propagation, heard, bottle };
}

const doorOf = (world: World<never>, door: EntityId): Door => {
  const found = world.get(door, DoorComponent);
  if (found === undefined) throw new Error('no door');
  return found;
};

const OPEN_LEVEL = 60 + distanceGainDb(11);

describe('noise propagation in a world (mw-e09.3)', () => {
  it('a listener hears a noise with its perceived level and position', () => {
    const { heard, bottle, guard } = setup();
    expect(bottle()).toBeCloseTo(OPEN_LEVEL, 10);
    expect(heard[0]).toMatchObject({
      tick: 0,
      listener: guard,
      perceived: v(10.5, 1, 5),
      via: 'door',
      occlusion: 0,
    });
    expect(heard[0]?.noise).toMatchObject({ kind: 'bottle', source: null, entity: null, tags: [] });
  });

  it('AC-6: a door that closes between two noises changes the second (ajar on the way)', () => {
    const { world, door, bottle } = setup();
    expect(bottle()).toBeCloseTo(OPEN_LEVEL, 10);
    closeDoor(world, door);
    world.step();
    expect(doorSoundState(doorOf(world, door))).toBe('ajar');
    expect(bottle()).toBeCloseTo(OPEN_LEVEL - 6, 10);
    for (let i = 0; i < 120; i++) world.step();
    expect(doorSoundState(doorOf(world, door))).toBe('closed');
    expect(bottle()).toBeCloseTo(OPEN_LEVEL - 20, 10);
  });

  it('a door’s leaf material sets its gain through the tuning', () => {
    const world = mechanismWorld();
    const door = world.spawn();
    makeDoor(world, door, WOODEN_DOOR, { origin: v(0, 0, 0), state: 'closed' });
    const portal: SoundPortal = { id: 'p', rooms: [0, 1], position: v(0, 0, 0), door };
    expect(worldPortalGain(world)(portal)).toBe(-20);
    expect(worldPortalGain(world, DEFAULT_NOISE_TUNING, () => 'iron')(portal)).toBe(-25);
    expect(worldPortalGain(world, DEFAULT_NOISE_TUNING, () => undefined)(portal)).toBe(-20);
    expect(worldPortalGain(world)({ ...portal, door: null })).toBe(0);
    world.destroy(door);
    expect(worldPortalGain(world)(portal)).toBe(0);
  });

  it('door sound states: broken and grilles are open; shut is closed; part-way is ajar', () => {
    const base = { openness: 0, broken: false, blocks: WOODEN_DOOR.blocks } as Door;
    expect(doorSoundState(base)).toBe('closed');
    expect(doorSoundState({ ...base, openness: 0.5 })).toBe('ajar');
    expect(doorSoundState({ ...base, openness: 1 })).toBe('open');
    expect(doorSoundState({ ...base, broken: true })).toBe('open');
    expect(doorSoundState({ ...base, blocks: GRILLE.blocks })).toBe('open');
    const { bottle } = setup(GRILLE, 'closed');
    expect(bottle()).toBeCloseTo(OPEN_LEVEL, 10);
  });

  it('skips the source itself, listeners out of range and noises below their threshold', () => {
    const { world, guard, heard } = setup(WOODEN_DOOR, 'closed');
    emitNoise(world, { position: v(15, 1, 5), loudness: 60, kind: 'bottle', source: guard });
    // Nor the thing that sounded when it is the listener itself (its own arrow, its own footfall).
    emitNoise(world, { position: v(15, 1, 5), loudness: 60, kind: 'bottle', entity: guard });
    const far = world.spawn();
    placeEntity(world, far, v(20, 1, 9), 0.4);
    world.add(far, NoiseListenerComponent, { thresholdDb: 0, range: 5 });
    const deaf = world.spawn();
    placeEntity(world, deaf, v(15, 1, 5), 0.4);
    world.add(deaf, NoiseListenerComponent, { thresholdDb: 70, range: 50 });
    world.events.flush();
    expect(heard).toEqual([]);
    emitNoise(world, { position: v(5, 1, 5), loudness: 60, kind: 'bottle', entity: 9 });
    world.events.flush();
    // The guard (no threshold) hears the muffled bottle; the deaf one does not; the far one is out of range.
    expect(heard.map((e) => e.listener)).toEqual([guard]);
    expect(heard[0]?.noise.entity).toBe(9);
  });

  it('a noise nobody can reach is not propagated, and a heard-of-nothing listener gets no event', () => {
    const { world, propagation, heard } = setup(WOODEN_DOOR, 'closed');
    emitNoise(world, { position: v(5, 1, 5), loudness: 12, kind: 'bottle', tags: ['glass'] });
    world.events.flush();
    expect(heard).toEqual([]);
    expect(propagation.propagate(v(5, 1, 5), 12).hear(v(16, 1, 5))).toBeNull();
  });

  it('exposes the graph for swapping and the propagation hook for the audio engine; uninstalls', () => {
    const { world, propagation, bottle, heard } = setup();
    const before = propagation.graph;
    propagation.setGraph(graphWith(null));
    expect(propagation.graph).not.toBe(before);
    const field = propagation.propagate(v(5, 1, 5), 60);
    expect(field.hear(v(16, 1, 5))?.level).toBeCloseTo(OPEN_LEVEL, 10);
    propagation.uninstall();
    const count = heard.length;
    bottle();
    expect(heard).toHaveLength(count);
    expect(world.isRegistered(NoiseListenerComponent)).toBe(true);
  });
});

describe('emitNoise (mw-e09.3)', () => {
  it('raises a noiseEmitted at the world’s tick with frozen position and tags', () => {
    const world = new World<never>({ seed: 1 });
    const got: NoiseEvent[] = [];
    world.events.on(noiseEmitted, (e) => got.push(e));
    world.step();
    emitNoise(world, {
      position: v(1, 2, 3),
      loudness: 70,
      kind: 'shout',
      source: 4,
      tags: ['voice'],
    });
    world.events.flush();
    expect(got).toEqual([
      {
        tick: 1,
        position: v(1, 2, 3),
        loudness: 70,
        kind: 'shout',
        entity: null,
        source: 4,
        tags: ['voice'],
      },
    ]);
    expect(Object.isFrozen(got[0]?.position)).toBe(true);
    expect(Object.isFrozen(got[0]?.tags)).toBe(true);
  });

  it('rejects a loudness or position that is not finite', () => {
    const world = new World<never>({ seed: 1 });
    const noise = { position: v(0, 0, 0), loudness: 60, kind: 'step' };
    expect(() => {
      emitNoise(world, { ...noise, loudness: Infinity });
    }).toThrow(/loudness/);
    expect(() => {
      emitNoise(world, { ...noise, position: v(0, Number.NaN, 0) });
    }).toThrow(/position/);
    expect(world.events.pending).toBe(0);
  });
});
