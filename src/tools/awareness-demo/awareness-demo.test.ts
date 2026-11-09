import { describe, expect, it } from 'vitest';
import {
  AWARENESS_DEMO_DISTANCE,
  AWARENESS_DEMO_STATES,
  AWARENESS_DEMO_SUSPICION,
  AWARENESS_DEMO_NOISE_MS,
  awarenessDemoAgents,
  awarenessDemoNoise,
  parseAwarenessDemoParam,
} from './index.ts';

describe('the awareness demo probe (mw-e29.12)', () => {
  it('is on only for ?awareness=demo', () => {
    expect(parseAwarenessDemoParam('?awareness=demo')).toBe(true);
    expect(parseAwarenessDemoParam('?awareness=other')).toBe(false);
    expect(parseAwarenessDemoParam('')).toBe(false);
  });

  it('lines up one stand-in per alert state ahead of the player, level with the ground', () => {
    const agents = awarenessDemoAgents({ x: 1, y: 0.5, z: 2 }, 0, []);
    expect(agents.map((a) => a.state)).toEqual([...AWARENESS_DEMO_STATES]);
    for (const a of agents) {
      expect(a.feet.y).toBe(0.5);
      expect(a.feet.z).toBeCloseTo(2 - AWARENESS_DEMO_DISTANCE);
    }
    expect(agents[1]?.awareness).toBe(AWARENESS_DEMO_SUSPICION);
    expect(agents[1]?.lkp).toBeNull();
    expect(agents[3]?.lkp).not.toBeNull();
    // Turned a quarter turn the row runs the other way round.
    const turned = awarenessDemoAgents({ x: 0, y: 0, z: 0 }, Math.PI / 2, agents);
    expect(turned).toBe(agents);
    expect(turned[0]?.feet.x).toBeCloseTo(-AWARENESS_DEMO_DISTANCE);
  });

  it('makes a noise by the player now and then, for the ripple only', () => {
    const noise = awarenessDemoNoise({ x: 1, y: 0, z: 1 }, 7);
    expect(noise).toMatchObject({ tick: 7, kind: 'demo', entity: null, source: null });
    expect(noise.position.y).toBe(0);
    expect(AWARENESS_DEMO_NOISE_MS).toBeGreaterThan(500);
  });
});
