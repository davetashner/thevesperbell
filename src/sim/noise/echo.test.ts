// Echoes (mw-e24.10): landings inside an echo volume are heard again, later and quieter.
import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { ECHO_TAG, installNoiseEcho, LANDING_NOISE_KINDS, type EchoVolume } from './echo';
import { noiseEmitted, type NoiseEvent } from './events';
import { FOOTSTEP_NOISE, LANDING_NOISE } from './footsteps';
import { OBJECT_IMPACT_NOISE, SPLASH_NOISE } from './impacts';
import { emitNoise } from './system';

const v = (x: number, y: number, z: number) => ({ x, y, z });
const SHAFT: EchoVolume = { id: 'shaft', min: v(0, -8, 0), max: v(2, 1, 2), delay: 0.4, loss: 6 };

function setup(volumes: readonly EchoVolume[] = [SHAFT]) {
  const world = new World<never>({ seed: 1, hz: 60 });
  const heard: NoiseEvent[] = [];
  world.events.on(noiseEmitted, (n) => heard.push(n));
  const echo = installNoiseEcho(world, volumes);
  const steps = (n: number) => {
    for (let i = 0; i < n; i++) world.step();
  };
  return { world, heard, echo, steps };
}

describe('noise echo', () => {
  it('repeats a landing inside the volume once, delay later and loss quieter, tagged echo', () => {
    const { world, heard, steps } = setup();
    steps(2);
    emitNoise(world, {
      position: v(1, -8, 1),
      loudness: 60,
      kind: OBJECT_IMPACT_NOISE,
      entity: 7,
      source: 3,
      tags: ['stone'],
    });
    steps(60);
    expect(heard).toHaveLength(2);
    const [first, second] = heard;
    expect((second?.tick ?? 0) - (first?.tick ?? 0)).toBe(24);
    expect(second).toMatchObject({
      kind: OBJECT_IMPACT_NOISE,
      loudness: 54,
      entity: 7,
      source: 3,
      position: v(1, -8, 1),
      tags: ['stone', ECHO_TAG],
    });
  });

  it('echoes every landing kind and nothing else, and never outside a volume', () => {
    const { world, heard, steps } = setup();
    for (const kind of [...LANDING_NOISE_KINDS, FOOTSTEP_NOISE, 'break']) {
      emitNoise(world, { position: v(1, 0, 1), loudness: 40, kind });
    }
    emitNoise(world, { position: v(5, 0, 1), loudness: 40, kind: LANDING_NOISE });
    steps(30);
    const echoes = heard.filter((n) => n.tags?.includes(ECHO_TAG));
    expect(echoes.map((n) => n.kind)).toEqual([...LANDING_NOISE_KINDS]);
  });

  it('drops an echo that would be silent, and waits at least one tick', () => {
    const { world, heard, steps } = setup([
      { ...SHAFT, loss: 50 },
      { id: 'near', min: v(10, 0, 0), max: v(11, 1, 1), delay: 0.001, loss: 0 },
    ]);
    emitNoise(world, { position: v(1, 0, 1), loudness: 40, kind: SPLASH_NOISE });
    emitNoise(world, { position: v(10.5, 0.5, 0.5), loudness: 40, kind: SPLASH_NOISE });
    steps(2);
    expect(heard.filter((n) => n.tags?.includes(ECHO_TAG))).toHaveLength(1);
    expect(heard).toHaveLength(3);
    steps(40);
    expect(heard).toHaveLength(3);
  });

  it('swaps volumes with the scene, dropping pending echoes, and stops', () => {
    const { world, heard, echo, steps } = setup();
    emitNoise(world, { position: v(1, 0, 1), loudness: 40, kind: LANDING_NOISE });
    echo.setVolumes([]);
    steps(30);
    emitNoise(world, { position: v(1, 0, 1), loudness: 40, kind: LANDING_NOISE });
    steps(30);
    expect(heard).toHaveLength(2);
    echo.setVolumes([SHAFT]);
    emitNoise(world, { position: v(1, 0, 1), loudness: 40, kind: LANDING_NOISE });
    steps(30);
    expect(heard).toHaveLength(4);
    emitNoise(world, { position: v(1, 0, 1), loudness: 40, kind: LANDING_NOISE });
    echo.stop();
    echo.setVolumes([SHAFT]);
    emitNoise(world, { position: v(1, 0, 1), loudness: 40, kind: LANDING_NOISE });
    steps(30);
    expect(heard).toHaveLength(6);
  });

  it('echoes a raw noise event that has no tags', () => {
    const { world, heard, steps } = setup();
    world.events.emit(noiseEmitted, {
      tick: world.tick,
      position: v(1, 0, 1),
      loudness: 30,
      kind: LANDING_NOISE,
      entity: null,
      source: null,
    });
    steps(30);
    expect(heard[1]?.tags).toEqual([ECHO_TAG]);
  });

  it('rejects a delay that is not positive and a negative loss', () => {
    expect(() => setup([{ ...SHAFT, delay: 0 }])).toThrow(RangeError);
    expect(() => setup([{ ...SHAFT, loss: -1 }])).toThrow(RangeError);
  });
});
