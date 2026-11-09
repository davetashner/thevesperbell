// Arrows at rest and level deltas (mw-e05.7): an arrow stuck in the level stays with the level, so it
// is still there when the player comes back; arrows in moving bodies do not persist; and at most 64
// arrows rest in a world, so the delta stays small.
import { describe, expect, it } from 'vitest';
import { ArrowRestComponent } from '../combat/arrows/components';
import { ArrowRested } from '../combat/arrows/events';
import { gatherable, installArrowRetrieval } from '../combat/arrows/retrieval';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import { TEST_ARROWS } from '../testing/arrows';
import { InteractableComponent, installInteraction } from '../interaction/system';
import { registerWorldProperties } from '../properties/components';
import { PlacementComponent } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import {
  arrowSpawner,
  persistRestingArrows,
  PersistentSpawnComponent,
  registerPersistence,
  WorldPersistence,
} from './persistence';

const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const ARROWS = TEST_ARROWS;
const LEVEL = 'inn';

function level() {
  const world = registerWorldProperties(new World<never>({ seed: 3 }));
  world.register(PlacementComponent);
  installInteraction(world);
  registerPersistence(world);
  world.register(ArrowRestComponent);
  const retrieval = installArrowRetrieval(world, { arrows: ARROWS });
  const persistence = new WorldPersistence({ spawners: [arrowSpawner()] });
  const baseline = persistence.baseline(world, LEVEL, []);
  return { world, retrieval, persistence, baseline };
}

/** An arrow comes to rest, as the arrow system leaves it, and tells the world. */
function land(
  world: World<never>,
  position: Vec3,
  host: EntityId | null = null,
  over: { intact?: boolean; arrow?: string; tick?: number } = {},
): EntityId {
  const entity = world.spawn();
  const intact = over.intact ?? true;
  const arrow = over.arrow ?? 'standard';
  world.add(entity, ArrowRestComponent, {
    arrow,
    shooter: null,
    state: 'stuck',
    position,
    direction: v3(0, 0, -1),
    in: host,
    tick: over.tick ?? world.tick,
    intact,
  });
  world.events.emit(ArrowRested, {
    tick: world.tick,
    entity,
    arrow,
    state: 'stuck',
    intact,
    in: host,
    position,
  });
  world.events.flush();
  return entity;
}

describe('arrows at rest persist with their level (mw-e05.7)', () => {
  it('an arrow stuck in the level is still there, whole or broken, when the level is entered again', () => {
    const first = level();
    persistRestingArrows(first.world, () => LEVEL);
    for (let i = 0; i < 5; i++) first.world.step();
    const wall = land(first.world, v3(1, 2, -3), null, { arrow: 'broadhead' });
    const snapped = land(first.world, v3(4, 1, 0), null, { intact: false, tick: 2 });
    for (let i = 0; i < 3; i++) first.world.step();
    const deltas = first.persistence.capture(first.world, first.baseline);
    expect(deltas.spawned.map((s) => s.kind)).toEqual(['arrow', 'arrow']);
    expect(deltas.spawned[0]?.data).toMatchObject({
      arrow: 'broadhead',
      state: 'stuck',
      intact: true,
      position: v3(1, 2, -3),
      age: 3,
    });
    expect(deltas.spawned[1]?.data).toMatchObject({ intact: false, age: 6 });
    expect(first.world.has(wall, PersistentSpawnComponent)).toBe(true);
    expect(first.world.has(snapped, PersistentSpawnComponent)).toBe(true);

    const second = level();
    const report = second.persistence.apply(second.world, second.baseline, deltas);
    expect(report.skipped).toEqual([]);
    expect(report.applied).toBe(2);
    const back = second.world.query(ArrowRestComponent).ids();
    expect(back).toHaveLength(2);
    const [whole, broken] = back as [EntityId, EntityId];
    expect(second.world.get(whole, ArrowRestComponent)).toMatchObject({
      arrow: 'broadhead',
      intact: true,
      position: v3(1, 2, -3),
    });
    // Whole ones can be taken again; broken ones lie there, and keep their first ids.
    expect(second.world.has(whole, InteractableComponent)).toBe(true);
    expect(gatherable(second.world, whole)).toEqual([whole]);
    expect(second.world.get(broken, ArrowRestComponent)?.intact).toBe(false);
    expect(second.world.has(broken, InteractableComponent)).toBe(false);
    expect(second.world.get(whole, PersistentSpawnComponent)).toMatchObject({ level: LEVEL });
    expect(second.persistence.capture(second.world, second.baseline).spawned).toHaveLength(2);
  });

  it('arrows in a moving body are not saved: its entity id is not stable', () => {
    const t = level();
    persistRestingArrows(t.world, () => LEVEL);
    const host = t.world.spawn();
    const inBody = land(t.world, v3(0, 1, 0), host);
    expect(t.world.has(inBody, PersistentSpawnComponent)).toBe(false);
    expect(t.persistence.capture(t.world, t.baseline).spawned).toEqual([]);
  });

  it('an arrow taken back is gone from the next save, and none is saved with no level', () => {
    const t = level();
    const stop = persistRestingArrows(t.world, () => LEVEL);
    const taken = land(t.world, v3(0, 1, 0));
    t.world.destroy(taken);
    t.world.step();
    expect(t.persistence.capture(t.world, t.baseline).spawned).toEqual([]);
    stop();
    const after = land(t.world, v3(1, 1, 0));
    expect(t.world.has(after, PersistentSpawnComponent)).toBe(false);
    const nowhere = level();
    persistRestingArrows(nowhere.world, () => undefined);
    const lost = land(nowhere.world, v3(1, 1, 0));
    expect(nowhere.world.has(lost, PersistentSpawnComponent)).toBe(false);
  });

  it('64 resting arrows add a few kilobytes to a level delta, not more', () => {
    const t = level();
    persistRestingArrows(t.world, () => LEVEL);
    for (let i = 0; i < 64; i++) land(t.world, v3(i * 0.37, 1.25 + i * 0.011, -3.14159 * i));
    const deltas = t.persistence.capture(t.world, t.baseline);
    expect(deltas.spawned).toHaveLength(64);
    const bytes = JSON.stringify(deltas).length;
    expect(bytes).toBeLessThan(16 * 1024);
  });

  it('skips what it cannot re-create: a spawner without the retrieval rules, an arrow gone from content', () => {
    const t = level();
    const spawner = arrowSpawner();
    expect(spawner.capture(t.world, t.world.spawn())).toBeUndefined();
    const bare = new World<never>({ seed: 1 });
    expect(spawner.capture(bare, bare.spawn())).toBeUndefined();
    const data = {
      arrow: 'standard',
      state: 'stuck' as const,
      intact: true,
      position: v3(0, 0, 0),
      direction: v3(0, 0, 1),
      age: 0,
    };
    expect(spawner.spawn(bare, data)).toBeUndefined();
    const warnings: string[] = [];
    const persistence = new WorldPersistence({
      spawners: [spawner],
      warn: (message) => warnings.push(message),
    });
    const report = persistence.apply(t.world, t.baseline, {
      level: LEVEL,
      entities: [],
      spawned: [{ id: 'spawned:9', kind: 'arrow', data: { ...data, arrow: 'ghost' } }],
    });
    expect(report.skipped.map((s) => s.reason)).toEqual(['spawn-failed']);
    expect(warnings).toHaveLength(1);
  });
});
