import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import {
  arrowLookup,
  box,
  DAMAGE_COMPONENTS,
  DamageModel,
  FakeCollisionWorld,
  HIT_VOLUME_COMPONENTS,
  installArrows,
  PlacementComponent,
  registerWorldProperties,
  World,
} from '@sim/index';
import {
  ARROW_DEMO_INTERVAL,
  ARROW_DEMO_LANES,
  ARROW_DEMO_ORDER,
  ArrowDemo,
  demoVelocity,
  parseArrowDemoParam,
} from './index';

const content = loadGameContent();
const ARROWS = arrowLookup(content.all('arrow'));

function room(arrows = ARROWS) {
  const world = registerWorldProperties(new World<never>({ seed: 1, hz: 60 }));
  world.register(PlacementComponent, ...DAMAGE_COMPONENTS, ...HIT_VOLUME_COMPONENTS);
  const wall = new FakeCollisionWorld([box({ x: -10, y: -1, z: -5 }, { x: 10, y: 10, z: -4.6 })]);
  installArrows(world, { arrows, damage: new DamageModel(), collision: wall });
  return world;
}

describe('?arrows demo (mw-e29.11)', () => {
  it('parses demo, a single arrow id, and off', () => {
    expect(parseArrowDemoParam('?scene=testbed')).toBeUndefined();
    expect(parseArrowDemoParam('?arrows=')).toBeUndefined();
    expect(parseArrowDemoParam('?arrows=demo')).toBe(ARROW_DEMO_ORDER);
    expect(parseArrowDemoParam('?arrows=water')).toEqual(['water']);
  });

  it('every shipped arrow has a lane, and the launch carries it level to the wall', () => {
    for (const arrow of content.all('arrow'))
      expect(ARROW_DEMO_LANES[arrow.id], arrow.id).toBeDefined();
    expect(ARROW_DEMO_ORDER.slice().sort()).toEqual(
      content
        .all('arrow')
        .map((a) => a.id)
        .sort(),
    );
    const v = demoVelocity();
    expect(v.z).toBeLessThan(0);
    expect(v.y).toBeGreaterThan(0);
  });

  it('looses one arrow every 2.5 s, in order, and records where each lands', () => {
    const world = room();
    const demo = new ArrowDemo(world, ARROWS, ['water', 'blunt']);
    expect(demo.update(0)).toBeDefined(); // the first goes at once
    expect(demo.update(1)).toBeUndefined();
    for (let i = 0; i < 90; i++) world.step();
    world.events.flush();
    expect(demo.update(ARROW_DEMO_INTERVAL)).toBeDefined();
    for (let i = 0; i < 90; i++) world.step();
    world.events.flush();
    expect(demo.stats.shots).toBe(2);
    expect(demo.stats.impacts.map((i) => i.arrow)).toEqual(['water', 'blunt']);
    expect(demo.stats.impacts[0]?.outcome).toBe('shatter');
    // The list keeps the latest 32 and stops when disposed; with nothing to loose it does nothing.
    demo.dispose();
    expect(new ArrowDemo(world, ARROWS, []).update(10)).toBeUndefined();
  });

  it('aims an arrow with no lane of its own at the middle of the wall', () => {
    const custom = { ...content.get('arrow', 'standard'), id: 'unlaned' };
    const lookup = arrowLookup([custom]);
    const world = room(lookup);
    const demo = new ArrowDemo(world, lookup, ['unlaned']);
    expect(demo.update(0)).toBeDefined();
    for (let i = 0; i < 90; i++) world.step();
    world.events.flush();
    expect(demo.stats.impacts.map((hit) => hit.arrow)).toContain('unlaned');
  });

  it('keeps only the latest impacts', () => {
    const world = room();
    const demo = new ArrowDemo(world, ARROWS, ['blunt']);
    for (let i = 0; i < 40; i++) {
      demo.update(ARROW_DEMO_INTERVAL);
      for (let t = 0; t < 70; t++) world.step();
      world.events.flush();
    }
    expect(demo.stats.shots).toBe(40);
    expect(demo.stats.impacts.length).toBeLessThanOrEqual(32);
  });
});
