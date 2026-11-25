/* eslint-disable @typescript-eslint/no-non-null-assertion -- fixtures index content known to exist */
import { describe, expect, it } from 'vitest';
import { loadGameContent } from './game-content.ts';

// mw-e25.23: the Miners' Stair links the bridge's town end (briar-glen-lane) to the boarded mine gate
// (deepworks) and back.
const content = loadGameContent();
const world = content.all('world')[0]!;
const scene = (id: string) => content.all('scene').find((s) => s.id === id)!;
const lane = scene('briar-glen-lane');
const mine = scene('deepworks');

describe('the Miners’ Bridge link to the mine gate', () => {
  it('AC-2: the miners-bridge edge lists its transitions', () => {
    const edge = world.edges.find((e) => e.id === 'miners-bridge')!;
    expect(edge.transitions).toEqual([
      'briar-glen-lane/miners-stair',
      'deepworks/miners-track-gate',
    ]);
  });

  it('AC-1: the stair’s foot volume leads from the lane to the mine gate arrival, and back', () => {
    const down = lane.transitions.find((t) => t.id === 'miners-stair')!;
    expect(down.scene.id).toBe('deepworks');
    const arrival = mine.spawns.find((s) => s.id === down.spawn)!;
    expect(arrival.tags).toContain('arrival');

    const up = mine.transitions.find((t) => t.id === 'miners-track-gate')!;
    expect(up.scene.id).toBe('briar-glen-lane');
    const back = lane.spawns.find((s) => s.id === up.spawn)!;
    expect(back.tags).toContain('arrival');
    // Both arrivals stand clear of the volume they came through.
    expect(arrival.at[0]).toBeGreaterThan(up.max[0]);
    expect(back.at[0]).toBeGreaterThan(down.max[0]);
  });
});
