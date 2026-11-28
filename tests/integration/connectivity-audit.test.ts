// mw-0qcf on real content, headless: every connectivity edge between two different built scenes is
// either wired with transitions or named here with the open bead (or service) that carries it. A new
// cross-scene edge with no transition fails this test until it is wired or listed with its reason.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import { placeEntity } from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';

const content = loadGameContent();
const [world] = content.all('world');
const green = content.get('scene', 'briar-glen-green');
const briarwood = content.get('scene', 'briarwood');

/** Cross-scene edges with no transition volume, and why (checked against bd on 2026-11-27). */
const UNWIRED: Readonly<Record<string, string>> = {
  'sleepers-path-mine-gate': 'mw-e25.2 (open)',
  'glen-well-cistern': 'mw-e24.10 (open)',
  'sounding-shaft': 'mw-e26.18 (open)',
  'ossuary-crypt': 'mw-e26.20 (open)',
  'barge-quay-lock': 'barge ride service (mw-e25.33)',
  'barge-wharf-lock': 'barge ride service (mw-e25.33)',
  'barge-lock-wharf': 'barge ride service (mw-4l3z)',
  'barge-quay-wharf': 'barge ride service (mw-e25.15)',
};

type Scene = typeof green;
const spot = (from: Scene, id: string) => {
  const s = from.spawns.find((x) => x.id === id);
  if (s === undefined) throw new Error(`no spawn ${id} in ${from.id}`);
  return { x: s.at[0], y: s.at[1], z: s.at[2] };
};

describe('connectivity audit (mw-0qcf AC-1)', { timeout: 60_000 }, () => {
  it('AC-1: every edge between two built scenes lists transitions or a named open bead', () => {
    const nodes = new Map(world?.nodes.map((n) => [n.id, n.scene?.id]));
    const unwired = (world?.edges ?? [])
      .filter((e) => {
        const a = nodes.get(e.from);
        const b = nodes.get(e.to);
        return a !== undefined && b !== undefined && a !== b && e.transitions.length === 0;
      })
      .map((e) => e.id)
      .sort();
    expect(unwired).toEqual(Object.keys(UNWIRED).sort());
  });

  it('AC-1: green-priory-road joins the green east gate and the Briarwood west wall both ways', () => {
    expect(world?.edges.find((e) => e.id === 'green-priory-road')?.transitions).toEqual([
      'briar-glen-green/priory-road-gate',
      'briarwood/town-road-gate',
    ]);
    expect(green.transitions.find((t) => t.id === 'priory-road-gate')).toMatchObject({
      scene: { id: 'briarwood' },
      spawn: 'arrive-from-briar-glen-green',
    });
    expect(briarwood.transitions.find((t) => t.id === 'town-road-gate')).toMatchObject({
      scene: { id: 'briar-glen-green' },
      spawn: 'arrive-from-briarwood',
    });
    expect(spot(briarwood, 'arrive-from-briar-glen-green')).toBeDefined();
    expect(spot(green, 'arrive-from-briarwood')).toBeDefined();
  });

  it('AC-1: the Briarwood arrival reaches the priory road and the green arrival reaches Market Green', () => {
    const wood = createGameWorld<never>(RAPIER, { seed: 1, hz: 60, scene: 'briarwood' });
    const p = wood.world.spawn();
    for (const to of ['priory-road', 'briarwood-hub', 'town-road-gate']) {
      placeEntity(wood.world, p, spot(briarwood, 'arrive-from-briar-glen-green'), 0.35);
      const m = wood.navigation.distance(wood.world, p, spot(briarwood, to));
      expect(Number.isFinite(m), to).toBe(true);
    }
    const town = createGameWorld<never>(RAPIER, { seed: 1, hz: 60, scene: 'briar-glen-green' });
    const q = town.world.spawn();
    for (const to of ['market-green', 'exit-priory-road', 'arrive-from-briar-glen-lane']) {
      placeEntity(town.world, q, spot(green, 'arrive-from-briarwood'), 0.35);
      const m = town.navigation.distance(town.world, q, spot(green, to));
      expect(Number.isFinite(m), to).toBe(true);
    }
  });
});
