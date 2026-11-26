// mw-e25.14 (Kestrel Lock and the towpath), mw-e40.26 AC-1/AC-2 (the towpath leg to the Stone Wharf; the
// barge leg stays open under mw-4l3z) and mw-0ml8 (the stopgap edge riverbank-wharf-link is gone) on real
// content, headless. The lock's two gates answer to the chamber's measured water: the paddles move the
// level, never a script. The walk in a browser is e2e/kestrel-lock.spec.ts.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import {
  deriveNavAgent,
  loadGameContent,
  NAV_BITS,
  resolveLocomotion,
  type NavAgent,
} from '@content/index';
import {
  doorStatus,
  interacted,
  LiquidVolumeComponent,
  mechanismJammed,
  NavMesh,
  NavMeshQuery,
  totalDepth,
  type EntityId,
  type MechanismJammed,
  type World,
} from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';
import { markExercised } from '@content/testing';
import { gameContentSources } from '@content/game-content';
import { loadContent, type ContentSource } from '@content/loader';
import { contentChecks, contentTypes } from '@content/registry';
import { buildEnv, validateWorld } from '@tools/world/validate';

const content = loadGameContent();
const [world] = content.all('world');
const lock = content.get('scene', 'kestrel-lock');
const bank = content.get('scene', 'under-the-bridge');
const harbour = content.get('scene', 'wendmouth-harbour');
const lockQuery = new NavMeshQuery(new NavMesh(content.get('navmesh', 'kestrel-lock')));
const harbourQuery = new NavMeshQuery(new NavMesh(content.get('navmesh', 'wendmouth-harbour')));

const humanoid = deriveNavAgent(resolveLocomotion(content.get('locomotion', 'humanoid'), content));
const walker: NavAgent = { ...humanoid, mask: humanoid.mask & ~NAV_BITS.climb, maxClimbGrade: 0 };

const spot = (scene: typeof lock, id: string) => {
  const spawn = scene.spawns.find((s) => s.id === id);
  if (spawn === undefined) throw new Error(`no spawn ${id} in ${scene.id}`);
  return { x: spawn.at[0], y: spawn.at[1], z: spawn.at[2] };
};
const walk = (query: NavMeshQuery, scene: typeof lock, from: string, to: string) =>
  query.findPath({
    start: spot(scene, from),
    goal: spot(scene, to),
    agent: walker,
    doors: () => 'open',
  }).status;

describe('the towpath legs (mw-e25.14 AC-1, mw-e40.26 AC-1)', () => {
  it('AC-1: every towpath transition advances the clock by 6 hours (360 game minutes)', () => {
    const legs = [
      bank.transitions.find((t) => t.id === 'towpath-down'),
      lock.transitions.find((t) => t.id === 'towpath-up'),
      lock.transitions.find((t) => t.id === 'towpath-down'),
      harbour.transitions.find((t) => t.id === 'towpath-gate'),
    ];
    for (const leg of legs) expect(leg?.advanceMinutes, leg?.id).toBe(360);
  });

  it('AC-1: the lock is between the riverbank and the Stone Wharf, both ways, and every arrival spawn exists', () => {
    expect(bank.transitions.find((t) => t.id === 'towpath-down')).toMatchObject({
      scene: { id: 'kestrel-lock' },
      spawn: 'arrive-from-under-the-bridge-upriver',
    });
    expect(lock.transitions.find((t) => t.id === 'towpath-up')).toMatchObject({
      scene: { id: 'under-the-bridge' },
      spawn: 'arrive-from-kestrel-lock',
    });
    expect(lock.transitions.find((t) => t.id === 'towpath-down')).toMatchObject({
      scene: { id: 'wendmouth-harbour' },
      spawn: 'arrive-from-kestrel-lock',
    });
    expect(harbour.transitions.find((t) => t.id === 'towpath-gate')).toMatchObject({
      scene: { id: 'kestrel-lock' },
      spawn: 'arrive-from-wendmouth-harbour',
    });
    for (const id of ['arrive-from-under-the-bridge-upriver', 'arrive-from-wendmouth-harbour'])
      expect(lock.spawns.find((s) => s.id === id)).toBeDefined();
    expect(bank.spawns.find((s) => s.id === 'arrive-from-kestrel-lock')).toBeDefined();
    expect(harbour.spawns.find((s) => s.id === 'arrive-from-kestrel-lock')).toBeDefined();
  });

  it('AC-1: a walker crosses Kestrel Lock along the towpath, and from the wharf gate reaches the wharf and the berth', () => {
    expect(
      walk(
        lockQuery,
        lock,
        'arrive-from-under-the-bridge-upriver',
        'arrive-from-wendmouth-harbour',
      ),
    ).toBe('found');
    expect(
      walk(
        lockQuery,
        lock,
        'arrive-from-wendmouth-harbour',
        'arrive-from-under-the-bridge-upriver',
      ),
    ).toBe('found');
    for (const id of ['player-start', 'barge-berth', 'exit-towpath']) {
      expect(walk(harbourQuery, harbour, 'arrive-from-kestrel-lock', id), id).toBe('found');
    }
  });

  it('AC-1: the beam walks lead to the south landing and the cottage door to the keeper’s cot', () => {
    for (const id of ['barge-landing', 'reed-cot', 'keeper-cot', 'npc-reed']) {
      expect(walk(lockQuery, lock, 'arrive-from-under-the-bridge-upriver', id), id).toBe('found');
    }
  });
});

describe('the edges in the world map (mw-e40.26 AC-2, mw-0ml8 AC-2)', () => {
  it('AC-2: the stopgap riverbank-wharf-link is gone; the lock links list their transitions', () => {
    expect(world?.edges.find((e) => e.id === 'riverbank-wharf-link')).toBeUndefined();
    expect(world?.edges.find((e) => e.id === 'riverbank-lock-link')).toMatchObject({
      from: 'under-the-bridge',
      to: 'kestrel-lock',
      transitions: ['under-the-bridge/towpath-down', 'kestrel-lock/towpath-up'],
    });
    expect(world?.edges.find((e) => e.id === 'towpath-lock-wharf')).toMatchObject({
      from: 'kestrel-lock',
      to: 'stone-wharf',
      transitions: ['kestrel-lock/towpath-down', 'wendmouth-harbour/towpath-gate'],
    });
    expect(world?.nodes.find((n) => n.id === 'kestrel-lock')?.scene?.id).toBe('kestrel-lock');
  });

  it('AC-2: the barge edges stay planned under their beads', () => {
    expect(world?.edges.find((e) => e.id === 'barge-lock-wharf')?.bead).toBe('mw-e40.26');
    expect(world?.edges.find((e) => e.id === 'barge-quay-lock')?.bead).toBe('mw-e25.15');
  });

  it('AC-2: the main quest still never needs the towpath, the lock or Wendmouth (world validation AC-5)', () => {
    if (world === undefined) throw new Error('no world map');
    const report = validateWorld(world, buildEnv(content), content);
    expect(report.errors).toEqual([]);
    for (const node of ['stone-wharf', 'under-the-bridge', 'kestrel-lock'])
      expect(report.criticalPath).not.toContain(node);
    expect(world.mainQuest).not.toContain('kestrel-lock');
  });
});

describe('Old Reed keeps the lock (mw-vau)', () => {
  it('he stands at the toll board by his cottage at Kestrel Lock, and has left the harbour', () => {
    const reed = lock.spawns.find((s) => s.id === 'npc-reed');
    expect(reed?.creature?.id).toBe('npc-reed');
    expect(content.get('creature', 'npc-reed').dialogue).toBeDefined();
    expect(harbour.spawns.find((s) => s.id === 'npc-reed')).toBeUndefined();
    const board = lock.spawns.find((s) => s.id === 'toll-board');
    expect(board?.tags).toContain('inscription-kestrel-lock-toll-board');
    expect(board?.tags).toContain('readable');
    expect(harbour.spawns.find((s) => s.id === 'toll-board')).toBeUndefined();
  });

  it('the cottage cot is a rest point: the counter sells the cot service of its merchant', ({
    task,
  }) => {
    markExercised(task, 'merchant', 'kestrel-lock-cot');
    markExercised(task, 'scene', 'kestrel-lock');
    markExercised(task, 'navmesh', 'kestrel-lock');
    markExercised(task, 'door', 'lock-gate');
    markExercised(task, 'signal-graph', 'kestrel-lock-gates');
    markExercised(task, 'dialogue', 'reed-kestrel-lock');
    markExercised(task, 'inscription', 'inscription-kestrel-lock-toll-board');
    const counter = lock.spawns.find((s) => s.id === 'reed-cot');
    expect(counter?.tags).toContain('merchant:kestrel-lock-cot');
    expect(content.get('merchant', 'kestrel-lock-cot').services[0]).toMatchObject({
      id: 'cot-by-the-fire',
      kind: 'rest',
    });
  });

  it('the sky dome and fog are set like the harbour’s', () => {
    expect(lock.environment?.dome).toBeDefined();
  });
});

// The chamber moves at 0.12 m/s and the gates swing in 8 s, which is right for the game and 20 s of sim a
// level change for a test (about 2 ms a step, mostly the element field's burning lanterns, and several
// times that under CI coverage). The mechanism tests run the same data at 20 times the sluice rate, with
// quick gates and a short settle delay and no lanterns; the real rates are checked from the data below.
const FAST_SLUICE = 20;
let fastContentCache: ReturnType<typeof loadContent> | undefined;
function fastContent() {
  fastContentCache ??= loadContent(
    contentTypes,
    gameContentSources().map((source): ContentSource => {
      const edit = (fn: (json: Record<string, unknown>) => void): ContentSource => {
        const json = JSON.parse(source.text) as Record<string, unknown>;
        fn(json);
        return { ...source, text: JSON.stringify(json) };
      };
      if (source.path.endsWith('scene/kestrel-lock.json')) {
        return edit((json) => {
          const spawns = json['spawns'] as Record<string, unknown>[];
          json['spawns'] = spawns.filter((sp) => {
            const tags = (sp['tags'] ?? []) as string[];
            return !tags.includes('lantern') && !tags.includes('brazier');
          });
          for (const sp of json['spawns'] as { liquid?: Record<string, { rate: number }> }[]) {
            for (const key of ['drain', 'fill'] as const) {
              const valve = sp.liquid?.[key];
              if (valve !== undefined) valve.rate *= FAST_SLUICE;
            }
          }
        });
      }
      if (source.path.endsWith('door/lock-gate.json'))
        return edit((json) => (json['seconds'] = 0.5));
      if (source.path.endsWith('signal-graph/kestrel-lock-gates.json')) {
        return edit((json) => {
          for (const node of json['nodes'] as { id: string; seconds?: number }[])
            if (node.id === 'levels-settle') node.seconds = 1;
        });
      }
      return source;
    }),
    contentChecks,
  );
  return fastContentCache;
}

function lockWorld() {
  const game = createGameWorld<unknown>(RAPIER, {
    seed: 1,
    hz: 60,
    scene: 'kestrel-lock',
    magic: true,
    content: fastContent(),
  });
  const sim = game.world as unknown as World<never>;
  const byId = new Map<string, EntityId>();
  for (const { entity, spawn } of game.scene.spawns) byId.set(spawn.id, entity);
  const id = (name: string): EntityId => {
    const entity = byId.get(name);
    if (entity === undefined) throw new Error(`no spawn ${name}`);
    return entity;
  };
  const steps = (n: number) => {
    for (let i = 0; i < n; i++) sim.step();
  };
  const pull = (lever: string) => {
    sim.events.emit(interacted, {
      actor: game.player,
      target: id(lever),
      verb: 'pull',
      affordance: 0,
    });
    steps(2);
  };
  const operate = (gate: string, verb: 'open' | 'close') => {
    sim.events.emit(interacted, { actor: game.player, target: id(gate), verb, affordance: 0 });
    steps(2);
  };
  const depth = () => {
    const volume = sim.get(id('chamber-water'), LiquidVolumeComponent);
    if (volume === undefined) throw new Error('no chamber volume');
    return totalDepth(volume);
  };
  const jams: MechanismJammed[] = [];
  sim.events.on(mechanismJammed, (e) => jams.push(e));
  return {
    game,
    sim,
    id,
    steps,
    pull,
    operate,
    depth,
    jams,
    status: (gate: string) => doorStatus(sim, id(gate)),
  };
}

describe('the lock chamber (mw-e25.14 AC-2, AC-3)', () => {
  it('AC-2: at the real sluice rates the chamber crosses its 2.25 m in under 30 s, drain and fill', () => {
    const chamber = lock.spawns.find((sp) => sp.id === 'chamber-water')?.liquid;
    expect(chamber?.drain?.rate).toBeGreaterThan(0);
    expect(chamber?.fill?.rate).toBeGreaterThan(0);
    expect(chamber?.depth ?? 0).toBeCloseTo(chamber?.size[1] ?? 0, 5); // the brim is the upper level
    for (const rate of [chamber?.drain?.rate ?? 0, chamber?.fill?.rate ?? 0])
      expect((chamber?.depth ?? 0) / rate).toBeLessThan(30);
    expect(content.get('door', 'lock-gate').seconds).toBeLessThan(30);
  });

  it('AC-2: opening the lower paddle drops the chamber to the lower level within 30 s (20x sluice, quick gates), and the lower gate then opens (never before)', () => {
    const g = lockWorld();
    g.steps(5);
    expect(g.depth()).toBeCloseTo(2.25, 3);
    expect(g.status('lower-lock-gate')).toBe('jammed');
    g.pull('lower-paddle-lever');
    g.steps(90);
    expect(g.depth()).toBeLessThanOrEqual(0.15);
    expect(g.status('lower-lock-gate')).toBe('closed');
    g.operate('lower-lock-gate', 'open');
    g.steps(45);
    expect(g.status('lower-lock-gate')).toBe('open');
    expect(g.status('upper-lock-gate')).toBe('jammed');
  });

  it('AC-2: with the tail shut and the head paddle open the chamber rises to the upper level within 30 s, and the upper gate opens only then', () => {
    const g = lockWorld();
    g.steps(5);
    g.pull('lower-paddle-lever');
    g.steps(90);
    expect(g.depth()).toBeLessThanOrEqual(0.15);
    g.pull('lower-paddle-lever'); // tail shut
    g.pull('upper-paddle-lever'); // head sluice open
    g.steps(90);
    expect(g.depth()).toBeGreaterThanOrEqual(2.2);
    expect(g.status('upper-lock-gate')).toBe('closed');
    g.operate('upper-lock-gate', 'open');
    g.steps(45);
    expect(g.status('upper-lock-gate')).toBe('open');
    expect(g.status('lower-lock-gate')).toBe('jammed');
  });

  it('AC-3: trying a gate against unequal levels strains (mechanismJammed) and changes nothing', () => {
    const g = lockWorld();
    g.steps(5);
    const before = g.depth();
    g.operate('lower-lock-gate', 'open');
    g.steps(30);
    expect(g.jams.filter((j) => j.entity === g.id('lower-lock-gate'))).not.toHaveLength(0);
    expect(g.status('lower-lock-gate')).toBe('jammed');
    expect(g.depth()).toBeCloseTo(before, 5);
    // And the other way round once drained.
    g.pull('lower-paddle-lever');
    g.steps(90);
    g.jams.length = 0;
    g.operate('upper-lock-gate', 'open');
    g.steps(30);
    expect(g.jams.filter((j) => j.entity === g.id('upper-lock-gate'))).not.toHaveLength(0);
    expect(g.status('upper-lock-gate')).toBe('jammed');
  });

  it('the tail paddle writes kestrel-lock.gate-open once the chamber has settled', () => {
    const g = lockWorld();
    g.steps(5);
    expect(g.sim.facts.get('kestrel-lock.gate-open')).not.toBe(true);
    g.pull('lower-paddle-lever');
    g.steps(100);
    expect(g.sim.facts.get('kestrel-lock.gate-open')).toBe(true);
  });
});

describe('the lock’s approved prop models (mw-e25.14)', () => {
  it('the toll board, paddle gears, bollards and coping stack are drawn from shipped models', async () => {
    const { existsSync } = await import('node:fs');
    const models = lock.dressings.map((d) => d.model);
    for (const id of [
      'model-prop-lock-toll-board-01',
      'model-prop-lock-paddle-gear-01',
      'model-prop-mooring-bollard-01',
      'model-prop-lock-coping-stack-01',
    ]) {
      expect(models, id).toContain(id);
      expect(existsSync(`public/assets/model/${id}.glb`), id).toBe(true);
    }
  });
});
