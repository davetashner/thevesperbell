// A scene's air temperature (mw-e03.62): the element field's ambient, authored per scene. It is
// proved on the scales room's ice block, whose weight is the ice's remaining mass (mw-e03.60).

import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';
import { elementFieldOf, readProperty, type EntityId, type World } from '@sim/index';

const HZ = 60;
const content = loadGameContent();
const SCENE = 'scales-room';

/** The content with the scales room's air set to `temperature` (undefined: no air setting). */
function withAir(temperature: number | undefined): typeof content {
  const scene = content.get('scene', SCENE);
  const changed = { ...scene, air: temperature === undefined ? undefined : { temperature } };
  return {
    ...content,
    get: (type: string, id: string) =>
      type === 'scene' && id === SCENE ? changed : content.get(type as never, id),
  } as typeof content;
}

function open(temperature: number | undefined) {
  const game = createGameWorld<never>(RAPIER, {
    seed: 5,
    hz: HZ,
    scene: SCENE,
    magic: true,
    content: withAir(temperature),
  });
  const sim: World<never> = game.world;
  const ice: EntityId | undefined = game.scene.spawns.find(
    ({ spawn }) => spawn.id === 'ice-block',
  )?.entity;
  if (ice === undefined) throw new Error('no ice block');
  return { sim, ice };
}

/** Seconds until the ice block has melted away in air of `temperature` (capped at `limit`). */
function secondsToMelt(temperature: number | undefined, limit: number): number {
  const { sim, ice } = open(temperature);
  for (let tick = 0; tick < limit * HZ; tick++) {
    sim.step();
    if (readProperty(sim, ice, 'weight') === 0) return tick / HZ;
  }
  return limit;
}

describe('scene air temperature (mw-e03.62)', () => {
  it('AC-1: the scales room as authored is a cold vault; a scene with no air setting has the 20 °C ambient', () => {
    expect(content.get('scene', SCENE).air).toEqual({ temperature: -5 });
    expect(elementFieldOf(open(-5).sim).config.temperature.ambient).toBe(-5);
    expect(elementFieldOf(open(undefined).sim).config.temperature.ambient).toBe(20);
  }, 30_000);

  it('AC-2: air at -5 °C keeps the ice block frozen through three idle minutes', () => {
    // Three minutes is long past the ~1 minute 20 °C air takes to melt it. The full ten idle minutes
    // run once, in reference-puzzles.test.ts (scales-room AC-2); doing them twice timed out the
    // coverage shard (PR #538).
    const { sim, ice } = open(-5);
    for (let tick = 0; tick < 180 * HZ; tick++) sim.step();
    expect(readProperty(sim, ice, 'weight')).toBe(60);
    expect(readProperty(sim, ice, 'frozen')).toBe(true);
  }, 60_000);

  it('AC-3: ice melts faster in 30 °C air than in the default 20 °C air, and never in the cold', () => {
    const cold = secondsToMelt(-5, 120);
    const normal = secondsToMelt(undefined, 120);
    const warm = secondsToMelt(30, 120);
    expect(cold).toBe(120);
    expect(normal).toBeLessThan(120);
    expect(warm).toBeLessThan(normal);
  }, 60_000);
});
