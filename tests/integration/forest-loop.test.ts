// mw-e25.25 on real content, headless: the forest-watchtower-priory loop. hub-moorings (built in the
// first PR of this bead, tested in moorings-watch.test.ts), moorings-priory-ridge (the watch's
// ridge-gate and the Briarwood's, both ways) and hub-priory-road (the walk inside the Briarwood from
// the hub to the priory road and on to the priory-road-gate), plus priory-road-gate both ways.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import { placeEntity } from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';

const content = loadGameContent();
const [world] = content.all('world');
const briarwood = content.get('scene', 'briarwood');
const watch = content.get('scene', 'moorings-watch');
const priory = content.get('scene', 'bellwater-priory');

type Scene = typeof briarwood;
const spot = (from: Scene, id: string) => {
  const s = from.spawns.find((x) => x.id === id);
  if (s === undefined) throw new Error(`no spawn ${id} in ${from.id}`);
  return { x: s.at[0], y: s.at[1], z: s.at[2] };
};
/** Is the transition volume inside the scene's floor, and does its spawn exist in the target? */
const leadsTo = (from: Scene, id: string, to: Scene, spawn: string) => {
  const t = from.transitions.find((x) => x.id === id);
  expect(t, `${from.id}/${id}`).toMatchObject({ scene: { id: to.id }, spawn });
  expect(to.spawns.find((s) => s.id === spawn), `${to.id}/${spawn}`).toBeDefined();
  expect(from.spawns.find((s) => s.id === id)?.tags).toContain('transition');
};

describe('the forest loop edges list their transitions (mw-e25.25 AC-2)', () => {
  const edge = (id: string) => world?.edges.find((e) => e.id === id);

  it('AC-2: moorings-priory-ridge lists the ridge gate at each end', () => {
    expect(edge('moorings-priory-ridge')?.transitions).toEqual([
      'moorings-watch/ridge-gate',
      'briarwood/ridge-gate',
    ]);
  });

  it('AC-2: hub-moorings and priory-road-gate list theirs', () => {
    expect(edge('hub-moorings')?.transitions).toEqual([
      'briarwood/moorings-gate',
      'moorings-watch/spur-gate',
    ]);
    expect(edge('priory-road-gate')?.transitions).toEqual([
      'briarwood/priory-road-gate',
      'bellwater-priory/road-gate',
    ]);
  });

  it('AC-2: hub-priory-road is the in-scene walk and needs no transition volume', () => {
    expect(edge('hub-priory-road')?.transitions ?? []).toEqual([]);
    expect(edge('hub-priory-road')?.notes).toMatch(/inside the briarwood scene/);
  });
});

describe('each path of the loop arrives at the matching scene and returns (mw-e25.25 AC-1)', () => {
  it('AC-1: the moorings gate and spur gate', () => {
    leadsTo(briarwood, 'moorings-gate', watch, 'arrive-from-briarwood');
    leadsTo(watch, 'spur-gate', briarwood, 'arrive-from-moorings-watch');
  });

  it('AC-1: the ridge gates', () => {
    leadsTo(watch, 'ridge-gate', briarwood, 'arrive-from-moorings-watch-ridge');
    leadsTo(briarwood, 'ridge-gate', watch, 'arrive-from-briarwood-ridge');
  });

  it('AC-1: the priory road gate and the priory’s road gate', () => {
    leadsTo(briarwood, 'priory-road-gate', priory, 'arrive-from-briarwood');
    leadsTo(priory, 'road-gate', briarwood, 'arrive-from-bellwater-priory');
  });
});

describe('the loop is walkable on the navmeshes (mw-e25.25 AC-1)', () => {
  const game = createGameWorld<never>(RAPIER, { seed: 1, hz: 60, scene: 'briarwood' });
  const probe = game.world.spawn();
  const dist = (from: string, to: string) => {
    placeEntity(game.world, probe, spot(briarwood, from), 0.35);
    return game.navigation.distance(game.world, probe, spot(briarwood, to));
  };

  it('AC-1: the hub reaches the priory road and the priory-road gate (hub-priory-road)', () => {
    for (const id of ['priory-road', 'arrive-from-bellwater-priory', 'priory-road-gate']) {
      expect(Number.isFinite(dist('briarwood-hub', id)), id).toBe(true);
    }
  });

  it('AC-1: the Briarwood’s ridge arrival reaches the priory road and the hub', () => {
    for (const id of ['priory-road', 'briarwood-hub', 'ridge-gate']) {
      expect(Number.isFinite(dist('arrive-from-moorings-watch-ridge', id)), id).toBe(true);
    }
    expect(Number.isFinite(dist('arrive-from-moorings-watch-ridge', 'moorings-gate'))).toBe(true);
  });

  it('AC-1: the watch’s ridge gate is reachable from the spur gate and the courtyard', () => {
    const probeWatch = createGameWorld<never>(RAPIER, { seed: 1, hz: 60, scene: 'moorings-watch' });
    const p = probeWatch.world.spawn();
    for (const from of ['arrive-from-briarwood', 'moorings-courtyard']) {
      for (const to of ['ridge-gate', 'arrive-from-briarwood-ridge']) {
        placeEntity(probeWatch.world, p, spot(watch, from), 0.35);
        const m = probeWatch.navigation.distance(probeWatch.world, p, spot(watch, to));
        expect(Number.isFinite(m), `${from} -> ${to}`).toBe(true);
      }
    }
  });
});
