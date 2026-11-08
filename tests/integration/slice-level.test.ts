// mw-e01.4: the m1 vertical slice's grey-box level (src/content/data/scene/slice.json), laid out as
// docs/design/vertical-slice.md §4 records it. AC-1 validates the scene and its kit; AC-2 queries the
// committed navmesh; AC-3 loads the scene headless as the game wires it (createGameWorld: Rapier
// physics, the player with interaction and a keyring, the scene's mechanisms and signal graph) and
// walks the player to the locked exit without the key. The checkpoint and slice-complete volumes are
// driven the same way. AC-4 (frame time at spawn) is e2e/perf.spec.ts.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  deriveNavAgent,
  loadGameContent,
  resolveLocomotion,
  sceneSchema,
  type NavAgent,
} from '@content/index';
import { markExercised } from '@content/testing';
import { autosaveAtCheckpoints, type AutosaveTrigger } from '@game/save/autosave/index';
import { sceneCheckpoints } from '@game/mechanisms/index';
import {
  actionButton,
  actionFrame,
  actionVector,
  doorStatus,
  interactionPrompt,
  layoutScene,
  lockOpened,
  NavMesh,
  NavMeshQuery,
  PlacementComponent,
  PlayerLook,
  SceneSpawnComponent,
  teleportCommand,
  type ActionFrame,
  type EntityId,
  type NavPathPoint,
  type NavPathResult,
  type Vec3,
  type World,
} from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';

const content = loadGameContent();
const scene = content.get('scene', 'slice');
const layout = layoutScene(scene, (id) => content.get('kit', id));
const mesh = new NavMesh(content.get('navmesh', 'slice'));
const query = new NavMeshQuery(mesh);
const humanoid = deriveNavAgent(resolveLocomotion(content.get('locomotion', 'humanoid'), content));
const forgotten = deriveNavAgent(
  resolveLocomotion(content.get('locomotion', 'forgotten'), content),
);

/** player-start and the middle of the vestibule's floor (vertical-slice §4). */
const SPAWN = { x: 0, y: 0, z: -2 };
const EXIT = { x: 0, y: 0, z: 39 };
const ARENA_CENTRE = { x: 0, y: 0, z: 31 };

const pointsOf = (r: NavPathResult): readonly NavPathPoint[] =>
  r.status === 'off-mesh' ? [] : r.points;

/** Every straight leg of a path stays on the mesh (links are jumps and climbs, not legs). */
function onMesh(points: readonly NavPathPoint[]): boolean {
  for (let n = 1; n < points.length; n++) {
    const a = points[n - 1];
    const b = points[n];
    if (a === undefined || b === undefined || a.link !== undefined) continue;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.05));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
      if (mesh.locate(p, 0.45, 0.45) < 0) return false;
    }
  }
  return true;
}

/** The bounds of the scene's parts of one kit piece, in scene order. */
const partsOf = (piece: string) => layout.parts.filter((part) => part.piece === piece);

describe('the slice grey-box level (mw-e01.4)', () => {
  it('AC-1: slice.json passes the scene schema and references only greybox kit pieces', ({
    task,
  }) => {
    markExercised(task, 'scene', 'slice');
    const file = join(import.meta.dirname, '../../src/content/data/scene/slice.json');
    const { $schema, ...json } = JSON.parse(readFileSync(file, 'utf8')) as {
      $schema: string;
      placements: { piece: string }[];
    };
    expect($schema).toBe('../scene.schema.json');
    expect(sceneSchema.safeParse(json).success).toBe(true);
    const raw = json.placements;
    // The e00 grey-box kit is exactly the files in src/content/data/kit.
    const kit = readdirSync(join(import.meta.dirname, '../../src/content/data/kit'))
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -'.json'.length));
    const used = [...new Set(raw.map((p) => p.piece))].sort();
    expect(used.every((piece) => kit.includes(piece))).toBe(true);
    expect(used).toEqual(['doorway', 'floor', 'pillar', 'platform', 'wall']);
    // Its props are the kit's loose crate (the step to the loot alcove's sill) and the liftable
    // bottle, barrel and clay pot (mw-e02.38).
    expect(scene.spawns.flatMap((s) => (s.prop === undefined ? [] : [s.prop.id]))).toEqual([
      'crate',
      'bottle',
      'barrel',
      'clay-pot',
    ]);
  });

  it('AC-1: lays out the spaces of the layout of record', () => {
    // Floors: spawn room 10 × 10, corridor 2 × 20, side alcove 3 × 4, arena 12 × 12, vestibule 2 × 3.
    const floors = partsOf('floor').map(({ min, max }) => [min.x, min.z, max.x, max.z]);
    expect(floors).toEqual([
      [-5, -5, 5, 5],
      [-1, 5, 1, 25],
      [1, 13, 4, 17],
      [-6, 25, 6, 37],
      [-1, 37, 1, 40],
    ]);
    // Two pillars break lines of attack in the arena.
    expect(partsOf('pillar').map((p) => [p.center.x, p.center.z])).toEqual([
      [-2.5, 29.5],
      [2.5, 33.5],
    ]);
    // The side alcove's 2 m ledge, its ivy face, and the loot alcove 1.4 m up off the arena.
    const platforms = partsOf('platform').map(({ min, max }) => [
      min.x,
      max.x,
      max.y,
      min.z,
      max.z,
    ]);
    expect(platforms).toEqual([
      [3, 4, 2, 13, 17],
      [2.55, 2.95, 2, 14, 16],
      [6, 9, 1.4, 33, 37],
    ]);
    const ivy = scene.placements.find((p) => p.properties?.material?.id === 'ivy');
    expect(ivy?.purpose).toBe('climbable');
    // Doors: the wooden spawn door (closed, unlocked) and the iron exit (locked by slice-exit).
    const doors = layout.spawns.flatMap((s) => (s.door === undefined ? [] : [s]));
    expect(doors.map((s) => [s.id, s.position.z, s.door?.profile, s.door?.lock])).toEqual([
      ['spawn-door', 5, 'wooden-door', undefined],
      ['exit-door', 37, 'iron-door', 'slice-exit'],
    ]);
    expect(layout.spawns.find((s) => s.id === 'player-start')?.position).toEqual(SPAWN);
  });

  it('AC-2: the navmesh has a path from spawn to exit through both doors, identical across runs', ({
    task,
  }) => {
    markExercised(task, 'navmesh', 'slice');
    expect(mesh.doors).toEqual(['spawn-door', 'exit-door']);
    const open = query.findPath({ start: SPAWN, goal: EXIT, agent: humanoid, doors: () => 'open' });
    expect(open.status).toBe('found');
    expect(onMesh(pointsOf(open))).toBe(true);
    // The required route is flat: no jumps, drops or climbs on it (vertical-slice §2).
    expect(pointsOf(open).some((p) => p.link !== undefined)).toBe(false);
    const again = new NavMeshQuery(new NavMesh(loadGameContent().get('navmesh', 'slice')));
    expect(
      again.findPath({ start: SPAWN, goal: EXIT, agent: humanoid, doors: () => 'open' }),
    ).toEqual(open);
    // Closed doors are opened on the way; the locked exit keeps everyone out of the vestibule.
    const closed = query.findPath({
      start: SPAWN,
      goal: EXIT,
      agent: humanoid,
      doors: () => 'closed',
    });
    expect(closed.status).toBe('found');
    const locked = query.findPath({
      start: SPAWN,
      goal: EXIT,
      agent: humanoid,
      doors: (id) => (id === 'exit-door' ? 'locked' : 'closed'),
    });
    expect(locked.status).toBe('unreachable');
    // The optional branches are off the flat route. A humanoid climber reaches the 2 m ledge only
    // up the ivy; the loot alcove 1.4 m up is above every creature's 0.6 m jump (the knight mantles
    // it), so the skeleton never follows into it.
    const ledge = query.findPath({
      start: ARENA_CENTRE,
      goal: { x: 3.5, y: 2, z: 15 },
      agent: humanoid,
    });
    expect(ledge.status).toBe('found');
    expect(pointsOf(ledge).filter((p) => p.link === 'climb')).toHaveLength(1);
    const alcove = { x: 7.5, y: 1.4, z: 35 };
    expect(mesh.locate(alcove, 0.45, 0.45)).toBeGreaterThanOrEqual(0);
    expect(query.findPath({ start: ARENA_CENTRE, goal: alcove, agent: humanoid }).status).toBe(
      'unreachable',
    );
  });

  it('AC-2: the arena is fully connected for the skeleton, around both pillars', () => {
    // Every 0.5 m floor point clear of the walls and pillars (by the agent radius and a margin).
    const clear = 0.35 + 0.15;
    const pillars = partsOf('pillar');
    const near = (x: number, z: number) =>
      pillars.some(
        ({ min, max }) =>
          x > min.x - clear && x < max.x + clear && z > min.z - clear && z < max.z + clear,
      );
    const walker: NavAgent = forgotten;
    let checked = 0;
    for (let x = -6 + clear; x <= 6 - clear; x += 0.5) {
      for (let z = 25 + clear; z <= 37 - clear; z += 0.5) {
        if (near(x, z)) continue;
        const goal = { x, y: 0, z };
        const path = query.findPath({ start: ARENA_CENTRE, goal, agent: walker });
        expect(path.status, `(${String(x)}, ${String(z)})`).toBe('found');
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(400);
    // From the corridor too: the arena doorway has no door, so retreat is always possible.
    expect(
      query.findPath({ start: { x: 0, y: 0, z: 20 }, goal: ARENA_CENTRE, agent: walker }).status,
    ).toBe('found');
  });
});

const UP = actionButton(false, false, false);
const DOWN = actionButton(true, true, false);
function frame(forward: number, ...pressed: string[]): ActionFrame {
  return actionFrame({
    move: actionVector(0, forward),
    look: actionVector(0, 0),
    buttons: (action) => (pressed.includes(action) ? DOWN : UP),
  });
}
const IDLE = frame(0);
const INTERACT = frame(0, 'interact');
const FORWARD = frame(1);
/** Yaw π faces +z (north, towards the exit); 0 faces −z. */
const FACE_NORTH = Math.PI;

/** The slice headless as the game wires it, with what the tests watch. */
function slice() {
  const game = createGameWorld<unknown>(RAPIER, { seed: 1, hz: 60, scene: 'slice' });
  const { world, player } = game;
  const sim = world as unknown as World<never>;
  const spawn = (id: string): EntityId => {
    const found = world
      .query(SceneSpawnComponent)
      .ids()
      .find((entity) => world.get(entity, SceneSpawnComponent)?.id === id);
    if (found === undefined) throw new Error(`no slice spawn ${id}`);
    return found;
  };
  const requests: AutosaveTrigger[] = [];
  autosaveAtCheckpoints(
    world.events,
    { request: (trigger) => requests.push(trigger) },
    sceneCheckpoints(layout),
  );
  const at = (): Vec3 => {
    const placement = world.get(player, PlacementComponent);
    if (placement === undefined) throw new Error('the player is not placed');
    return { x: placement.x, y: placement.y, z: placement.z };
  };
  const step = (input: ActionFrame, ticks = 1): void => {
    for (let i = 0; i < ticks; i++) world.step([input]);
  };
  const teleport = (to: Vec3, yaw = FACE_NORTH): void => {
    world.step([teleportCommand(player, to)]);
    world.set(player, PlayerLook, { yaw, pitch: 0 });
    step(IDLE, 10);
  };
  const complete = () => world.facts.get('slice.complete');
  return { world, sim, player, spawn, requests, at, step, teleport, complete };
}

describe('the slice triggers and the locked exit (mw-e01.4)', () => {
  it('AC-3: walking into the exit without the key leaves it locked with a "Locked." prompt, and the slice is not complete', ({
    task,
  }) => {
    markExercised(task, 'lock', 'slice-exit');
    markExercised(task, 'door', 'iron-door');
    const t = slice();
    const door = t.spawn('exit-door');
    const opened: unknown[] = [];
    t.world.events.on(lockOpened, (e) => opened.push(e));
    expect(doorStatus(t.sim, door)).toBe('locked');
    // In the arena, a step in front of the iron door, facing it with an empty keyring.
    t.teleport({ x: 0, y: 0, z: 35.5 });
    expect(interactionPrompt(t.sim, t.player)).toMatchObject({
      target: door,
      verb: 'unlock',
      available: false,
      reason: 'Locked.',
    });
    t.step(INTERACT);
    t.step(IDLE, 30);
    expect(opened).toEqual([]);
    expect(doorStatus(t.sim, door)).toBe('locked');
    // Walking on into it for two seconds gets nowhere: the leaf holds the player in the arena.
    t.step(FORWARD, 120);
    t.step(IDLE, 10);
    expect(t.at().z).toBeGreaterThan(35.5);
    expect(t.at().z).toBeLessThan(37);
    expect(doorStatus(t.sim, door)).toBe('locked');
    expect(interactionPrompt(t.sim, t.player)).toMatchObject({ target: door, reason: 'Locked.' });
    expect(t.complete()).not.toBe(true);
    expect(t.world.facts.snapshot()).toEqual({});
  });

  it('CP-1 and CP-2 request a checkpoint autosave as the player passes them, once each', ({
    task,
  }) => {
    markExercised(task, 'signal-graph', 'slice');
    const t = slice();
    // Spawn room: nothing yet.
    t.step(IDLE, 10);
    expect(t.requests).toEqual([]);
    // Through the opened spawn door into the corridor: CP-1 at z 5.5–7.
    t.teleport({ x: 0, y: 0, z: 4 });
    t.step(INTERACT);
    t.step(IDLE, 90);
    expect(doorStatus(t.sim, t.spawn('spawn-door'))).toBe('open');
    t.step(FORWARD, 30);
    expect(t.requests).toEqual([{ kind: 'checkpoint', source: 'slice/cp-1' }]);
    // The corridor's end, before the arena: CP-2 at z 22–24.
    t.teleport({ x: 0, y: 0, z: 20.5 });
    t.step(FORWARD, 30);
    expect(t.requests).toEqual([
      { kind: 'checkpoint', source: 'slice/cp-1' },
      { kind: 'checkpoint', source: 'slice/cp-2' },
    ]);
    // The vestibule's volume is not a checkpoint.
    t.teleport({ x: 0, y: 0, z: 39 });
    expect(t.requests).toHaveLength(2);
  });

  it('the vestibule volume writes slice.complete = true once, and it stays true', ({ task }) => {
    markExercised(task, 'fact', 'slice');
    const t = slice();
    expect(t.complete()).not.toBe(true);
    // Behind the exit door (as if the key had opened it, mw-e01.6).
    t.teleport({ x: 0, y: 0, z: 39 });
    expect(t.complete()).toBe(true);
    // Stepping back out does not undo the pass.
    t.teleport({ x: 0, y: 0, z: 34 });
    expect(t.complete()).toBe(true);
  });
});
