// mw-e25.9 on real content: the collapse in Mooring's Watch's supply tunnel, a class-gated shortcut
// into the Deepworks' old galleries. The scene is loaded through the game's own wiring
// (createGameWorld: Rapier physics, breakables, supports, fire, signal graphs, environment damage);
// every route is the stimulus the game sends (a blow, an arrow's pierce, a flame), never a scripted
// pair. The walk through the transition in the browser is e2e/supply-tunnel.spec.ts.
import { readFileSync } from 'node:fs';
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { loadGameContent, PLAYER_CONTROLLER_ID } from '@content/index';
import { markExercised } from '@content/testing';
import { createGameSaveRegistry } from '@game/save/sections';
import {
  applyStimulus,
  breakableBroken,
  canAttachClimb,
  CLIMB_ROUGH_CAPABILITY,
  DamageApplied,
  extractLedges,
  healthOf,
  layoutScene,
  passageRevealed,
  PhysicsObjectComponent,
  supportReleased,
  teleportCommand,
  type DamageResult,
  type EntityId,
  type StimulusElement,
  type SupportRelease,
  type Vec3,
  type World,
} from '@sim/index';
import { buildEnv, validateWorld } from '@tools/world/validate';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';

const HZ = 60;
const FACT = 'world.supply-tunnel.cleared';
const content = loadGameContent();
const [worldMap] = content.all('world');
const scene = content.get('scene', 'moorings-watch');
const deepworks = content.get('scene', 'deepworks');
const ledgeTuning = content.get('controller', PLAYER_CONTROLLER_ID).ledge;
const hangReach = ledgeTuning?.hangReach ?? 0;
const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/** The rubble fall: the scene's one rubble-fall breakable, by its placement index. */
const rubbleIndex = scene.placements.findIndex((p) => p.breakable?.profile.id === 'rubble-fall');
const rubble = scene.placements[rubbleIndex];
/** The rubble's footprint in world metres (a 2 x 3 x 0.2 wall scaled [2, 1, 5]). */
const RUBBLE_TOP = 3;
const RUBBLE_NEAR_FACE = 82;

/** Mooring's Watch as the game wires it, with ids for its spawns and the rubble. */
function watch(magic = false) {
  const game = createGameWorld<unknown>(RAPIER, {
    seed: 1,
    hz: HZ,
    scene: 'moorings-watch',
    magic,
  });
  const sim = game.world as unknown as World<never>;
  const byId = new Map<string, EntityId>();
  for (const { entity, spawn } of game.scene.spawns) byId.set(spawn.id, entity);
  const id = (name: string): EntityId => {
    const entity = byId.get(name);
    if (entity === undefined) throw new Error(`no spawn ${name}`);
    return entity;
  };
  const rubbleEntity = game.scene.pieces[rubbleIndex];
  if (rubbleEntity === undefined) throw new Error('no rubble piece');
  const released: SupportRelease[] = [];
  sim.events.on(supportReleased, (e) => released.push(e));
  const hits: DamageResult[] = [];
  sim.events.on(DamageApplied, (r) => hits.push(r));
  const broken: string[] = [];
  sim.events.on(breakableBroken, (e) => broken.push(e.profile));
  const passages: string[] = [];
  sim.events.on(passageRevealed, (e) => passages.push(e.passage));
  const steps = (n: number) => {
    for (let i = 0; i < n; i++) sim.step();
  };
  const teleport = (to: Vec3) => {
    game.world.step([teleportCommand(game.player, to)]);
  };
  const strike = (target: EntityId, element: StimulusElement, intensity: number) => {
    applyStimulus(sim, {
      shape: { kind: 'contact', target },
      element,
      intensity,
      source: game.player,
    });
    steps(1);
  };
  const slab = () => sim.get(id('supply-tunnel-slab'), PhysicsObjectComponent);
  const cleared = () => game.world.facts.get(FACT) ?? false;
  steps(10); // settle
  return {
    game,
    sim,
    id,
    rubbleEntity,
    released,
    hits,
    broken,
    passages,
    steps,
    teleport,
    strike,
    slab,
    cleared,
  };
}

type Watch = ReturnType<typeof watch>;

/** Past the fall, on the mine side's floor, then a moment for the volume to see the player. */
const crossOver = (w: Watch) => {
  w.teleport(v(78, 0.2, 89.5));
  w.steps(HZ / 2);
};

describe('the supply tunnel collapse in the obstacle registry (mw-e25.9 AC-1)', () => {
  it('AC-1: the supply tunnel declares at least 4 class routes and an any-class route', () => {
    const matrix = JSON.parse(readFileSync('docs/design/route-matrix.json', 'utf8')) as {
      obstacles: { id: string; edge?: string; routes: { classes: string[] }[] }[];
    };
    const tunnel = matrix.obstacles.find((o) => o.id === 'supply-tunnel');
    const classes = ['knight', 'archer', 'sorcerer', 'thief'].filter((c) =>
      tunnel?.routes.some((r) => r.classes.includes(c)),
    );
    expect(classes).toHaveLength(4);
    expect(tunnel?.routes.some((r) => r.classes.includes('any'))).toBe(true);
    expect(tunnel?.edge).toBe('supply-tunnel-collapse');
    const edge = worldMap?.edges.find((e) => e.id === 'supply-tunnel-collapse');
    expect(edge?.routes.length).toBeGreaterThanOrEqual(3);
    expect(edge?.unlock).toEqual({ fact: FACT });
  });

  it('AC-1: the collapse is built from the routes’ parts: a rubble fall, a rotten prop and the roof it holds', ({
    task,
  }) => {
    markExercised(task, 'breakable', 'rubble-fall');
    markExercised(task, 'testprop', 'tunnel-roof-slab');
    markExercised(task, 'signal-graph', 'supply-tunnel-collapse');
    expect(rubble?.breakable?.reveals).toBe('supply-tunnel-collapse');
    expect(rubble?.properties?.hp).toBe(300);
    const prop = scene.spawns.find((s) => s.id === 'supply-tunnel-prop');
    expect(prop?.rope?.support).toBeDefined();
    expect(scene.spawns.find((s) => s.id === 'supply-tunnel-slab')?.suspendedFrom).toBe(
      'supply-tunnel-prop',
    );
    expect(scene.signals.map((s) => s.graph.id)).toContain('supply-tunnel-collapse');
  });
});

describe('the transitions both ways (mw-e25.9)', () => {
  it('each end of the tunnel leads to the other scene’s arrival, and the edge lists both', () => {
    const there = scene.transitions.find((t) => t.id === 'supply-tunnel-gate');
    expect(there).toMatchObject({
      scene: { id: 'deepworks' },
      spawn: 'arrive-from-moorings-watch',
    });
    const back = deepworks.transitions.find((t) => t.id === 'supply-tunnel-gate');
    expect(back).toMatchObject({ scene: { id: 'moorings-watch' }, spawn: 'arrive-from-deepworks' });
    expect(deepworks.spawns.some((s) => s.id === 'arrive-from-moorings-watch')).toBe(true);
    expect(scene.spawns.some((s) => s.id === 'arrive-from-deepworks')).toBe(true);
    // Neither arrival stands in the volume that would send the player straight back.
    const inside = (t: typeof there, at: readonly number[]) =>
      t !== undefined &&
      [0, 1, 2].every((i) => (at[i] ?? 0) >= (t.min[i] ?? 0) && (at[i] ?? 0) <= (t.max[i] ?? 0));
    const arrival = scene.spawns.find((s) => s.id === 'arrive-from-deepworks');
    const mine = deepworks.spawns.find((s) => s.id === 'arrive-from-moorings-watch');
    expect(inside(there, arrival?.at ?? [])).toBe(false);
    expect(inside(back, mine?.at ?? [])).toBe(false);
    expect(worldMap?.edges.find((e) => e.id === 'supply-tunnel-collapse')?.transitions).toEqual([
      'moorings-watch/supply-tunnel-gate',
      'deepworks/supply-tunnel-gate',
    ]);
  });

  it('the world map validates with the tunnel’s fact produced', () => {
    if (worldMap === undefined) throw new Error('no world map');
    const report = validateWorld(worldMap, buildEnv(content), content);
    expect(report.errors).toEqual([]);
    expect(report.warnings.join('\n')).not.toContain(FACT);
  });
});

describe('the routes past the collapse (mw-e25.9 AC-2)', { timeout: 120_000 }, () => {
  it('the fall stands: nobody reaches its top from the floor, and standing before it clears nothing', () => {
    const w = watch();
    expect(RUBBLE_TOP).toBeGreaterThan(hangReach); // beyond a jump and a grab from the floor
    w.teleport(v(78, 0.2, 81));
    w.steps(HZ);
    expect(w.cleared()).toBe(false);
    // Arrows and blades do nothing to it.
    w.strike(w.rubbleEntity, 'pierce', 500);
    w.strike(w.rubbleEntity, 'slash', 100);
    expect(w.broken).toEqual([]);
  });

  it('AC-2: knight: four heavy blows batter the rubble down, the passage opens and getting past sets the fact', () => {
    const w = watch();
    // The heavy overhead's world impact is 150 blunt; rubble resists 40% and holds 300 hp.
    for (let i = 0; i < 3; i++) w.strike(w.rubbleEntity, 'blunt', 150);
    expect(w.broken).toEqual([]);
    w.strike(w.rubbleEntity, 'blunt', 150);
    expect(w.broken).toEqual(['rubble-fall']);
    expect(w.passages).toEqual(['supply-tunnel-collapse']);
    expect(w.cleared()).toBe(false);
    crossOver(w);
    expect(w.cleared()).toBe(true);
  });

  it('AC-2: archer: an arrow through the rotten prop drops the roof section into a step from which the top of the fall is in reach', () => {
    const w = watch();
    const before = w.slab()?.position.y ?? Number.NaN;
    w.strike(w.id('supply-tunnel-prop'), 'pierce', 60); // 42 through its 30% resistance, over 6 hp
    w.steps(3 * HZ);
    expect(w.released).toMatchObject([{ cause: 'damage', held: [w.id('supply-tunnel-slab')] }]);
    const landed = w.slab();
    expect(landed?.position.y ?? before).toBeLessThan(before - 3);
    // The slab's top (half its 1 m height above its centre) is a step: from it, the fall's top
    // is within a jump and a grab (verb.climb.ledge, every class).
    const top = (landed?.position.y ?? 0) + 1 / 2;
    expect(top).toBeGreaterThan(0.9);
    expect(RUBBLE_TOP - top).toBeLessThanOrEqual(hangReach);
    expect(RUBBLE_NEAR_FACE - ((landed?.position.z ?? 0) + 0.625)).toBeLessThan(
      ledgeTuning?.reach ?? 0,
    );
    // And the fall's top is a ledge to grab: the layout has one along it.
    const layout = layoutScene(scene, (kit) =>
      content.has('kit', kit) ? content.get('kit', kit) : undefined,
    );
    const ledges = extractLedges(layout).filter(
      (l) =>
        l.start.y === RUBBLE_TOP && l.start.z === RUBBLE_NEAR_FACE && l.end.z === RUBBLE_NEAR_FACE,
    );
    expect(ledges.length).toBeGreaterThan(0);
    crossOver(w);
    expect(w.cleared()).toBe(true);
  });

  it('AC-2: sorcerer: a flame burns the rotten prop away and the roof section drops the same way', () => {
    const w = watch(true);
    const before = w.slab()?.position.y ?? Number.NaN;
    applyStimulus(w.sim, {
      shape: { kind: 'contact', target: w.id('supply-tunnel-prop') },
      element: 'heat',
      intensity: 600,
    });
    w.steps(20 * HZ); // the fire wears the rotten timber's 6 hp down in about 12 s
    expect(w.released).toMatchObject([{ cause: 'burnt', held: [w.id('supply-tunnel-slab')] }]);
    expect(w.slab()?.position.y ?? before).toBeLessThan(before - 3);
  });

  it('AC-2: thief: the face of the fall is rough stone, climbable with verb.climb.rough and by no one without it', () => {
    const w = watch();
    expect(canAttachClimb(w.sim, w.rubbleEntity, [CLIMB_ROUGH_CAPABILITY]).ok).toBe(true);
    expect(canAttachClimb(w.sim, w.rubbleEntity, ['verb.climb.ledge']).ok).toBe(false);
    // The climber's hands reach the top: the face is 3 m, the gap above it 3 m high.
    crossOver(w);
    expect(w.cleared()).toBe(true);
  });

  it('AC-2: cleared by any route, the fact persists after a save and a reload', () => {
    const w = watch();
    for (let i = 0; i < 4; i++) w.strike(w.rubbleEntity, 'blunt', 150);
    crossOver(w);
    expect(w.cleared()).toBe(true);
    const registry = createGameSaveRegistry();
    const bytes = registry.write(w.game.world, {
      build: { gameVersion: '0.1.0', buildSha: 'deadbee', contentHash: 'c0ffee' },
      wallClockSavedAt: 1_790_000_000_000,
    });
    const back = watch();
    expect(back.cleared()).toBe(false);
    const loaded = registry.read(back.game.world, bytes);
    if (!loaded.ok) throw loaded.error;
    expect(back.cleared()).toBe(true);
    // The fall stays broken too: the level delta records it gone.
    back.strike(back.rubbleEntity, 'blunt', 150);
    expect(back.broken).toEqual([]);
  });
});

describe('the crush (mw-e25.9 AC-3)', { timeout: 120_000 }, () => {
  it('AC-3: edge: the archer drops the rotten prop while standing under it, and the roof section crushes them through environmental damage', () => {
    const w = watch();
    const { player } = w.game;
    w.teleport(v(78, 0.2, 80.75)); // under the slab, beside the prop
    w.steps(HZ / 2);
    const health = healthOf(w.sim, player)?.current ?? 0;
    expect(health).toBeGreaterThan(0);
    w.strike(w.id('supply-tunnel-prop'), 'pierce', 60);
    w.steps(2 * HZ);
    const crush = w.hits.filter((h) => h.packet.tags.includes('crush') && h.target === player);
    expect(crush).toHaveLength(1);
    expect(crush[0]?.packet).toMatchObject({
      instigator: player,
      source: w.id('supply-tunnel-slab'),
    });
    expect(crush[0]?.amounts.blunt).toBeGreaterThan(0);
    expect(healthOf(w.sim, player)?.current ?? health).toBeLessThan(health);
  });
});
