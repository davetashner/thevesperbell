import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { loadGameContent, materialPresets } from '@content/index';
import {
  applyStimulus,
  DebrisComponent,
  PhysicsObjectComponent,
  RapierPhysics,
  SpilledComponent,
  registerSceneComponents,
  World,
  type EntityId,
  type SceneLayout,
  type Vec3,
} from '@sim/index';
import { describe, expect, it } from 'vitest';
import { RenderSync } from '../loop/render-sync';
import { installGamePhysics, propBodies } from '../physics-objects';
import { SceneLoader } from '../scene/scene-loader';
import { bindBreakLeftovers, BreakWatch, breakableProfiles, cracked, hasBreakables } from './index';

function room() {
  const content = loadGameContent();
  const physics = new RapierPhysics(RAPIER);
  const world = installGamePhysics(
    registerSceneComponents(new World<never>({ seed: 3, physics })),
    {
      breakables: {
        props: propBodies(content),
        materials: materialPresets(content.all('material')),
      },
    },
  );
  const sync = new RenderSync(world);
  const loader = new SceneLoader({
    world,
    sync,
    colliders: physics,
    content,
    objects: { staticGeometry: () => ({}), spawn: () => ({}) },
    binding: (object, read) => ({ object, read, apply: () => undefined, dispose: () => undefined }),
    physics: {},
  });
  const loaded = loader.load('weak-wall-room');
  const watch = new BreakWatch(world);
  const smash = (entity: EntityId, intensity = 500): void => {
    applyStimulus(world, {
      shape: { kind: 'contact', target: entity },
      element: 'blunt',
      intensity,
    });
    world.step();
  };
  return { content, world, sync, loaded, watch, smash };
}

describe('breakables in the game (mw-e03.11)', () => {
  it('turns content profiles into the sim’s, leaving out resistances a profile does not set', () => {
    const content = loadGameContent();
    const profiles = breakableProfiles(content);
    expect(profiles('old-wall')).toEqual({
      id: 'old-wall',
      resistances: { blunt: 0.2, slash: 0.9, pierce: 1, force: 0.2 },
      debris: { count: 6, size: 0.3 },
      breakLoudness: 85,
    });
    expect(profiles('pottery')?.resistances).toEqual({});
    expect(profiles('nope')).toBeUndefined();
    expect(cracked(content, 'old-wall')).toBe(true);
    expect(cracked(content, 'crate')).toBe(false);
    expect(cracked(content, 'nope')).toBe(false);
  });

  it('knows which scenes have breakables', () => {
    const content = loadGameContent();
    const layoutOf = (pieces: object[], spawns: object[]) =>
      ({ pieces, spawns }) as unknown as SceneLayout;
    expect(hasBreakables(layoutOf([{}], [{}]))).toBe(false);
    expect(hasBreakables(layoutOf([{ breakable: {} }], []))).toBe(true);
    expect(hasBreakables(layoutOf([], [{ breakable: {} }]))).toBe(true);
    expect(content.all('scene').filter((s) => s.id === 'weak-wall-room')).toHaveLength(1);
  });

  it('draws every piece of debris and spilled prop once, at its body’s size', () => {
    const { world, sync, loaded, smash } = room();
    const crate = loaded.spawns.find((s) => s.spawn.id === 'loot-crate')?.entity ?? -1;
    smash(crate);
    const made: { entity: EntityId; size: Vec3 }[] = [];
    const create = (entity: EntityId, size: Vec3) => {
      made.push({ entity, size });
      return {
        object: {},
        read: () => undefined,
        apply: () => undefined,
        dispose: () => undefined,
      };
    };
    expect(bindBreakLeftovers(world, sync, create)).toBe(5); // four chunks and a plank
    expect(made.slice(0, 4).map((m) => m.size)).toEqual(
      Array.from({ length: 4 }, () => ({ x: 0.25, y: 0.25, z: 0.25 })),
    );
    expect(made[4]?.size).toEqual({ x: 1.2, y: 0.08, z: 0.25 });
    expect(bindBreakLeftovers(world, sync, create)).toBe(0);
  });

  it('skips leftovers without a box body', () => {
    const world = new World<never>({ seed: 1 }).register(
      DebrisComponent,
      SpilledComponent,
      PhysicsObjectComponent,
    );
    const ball = world.spawn();
    world.add(ball, DebrisComponent, { spawned: 0, from: 1 });
    world.add(ball, PhysicsObjectComponent, {
      body: 1,
      shape: { kind: 'sphere', radius: 0.2 },
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      sleeping: false,
      awakeSince: 0,
    });
    const bodiless = world.spawn();
    world.add(bodiless, SpilledComponent, { prop: 'lever', from: 1 });
    const create = () => {
      throw new Error('nothing to draw');
    };
    expect(bindBreakLeftovers(world, new RenderSync(world), create)).toBe(0);
  });

  it('the watch reports breaks, noises, opened passages and live debris until disposed', () => {
    const { loaded, watch, smash } = room();
    expect(watch.readout()).toEqual({ broken: [], noises: [], passages: [], debris: 0 });
    const wall = loaded.pieces[6] ?? -1;
    smash(wall, 150);
    expect(watch.readout()).toEqual({
      broken: [{ tick: 0, profile: 'old-wall', cause: 'structure', by: 'blunt' }],
      noises: [{ tick: 0, kind: 'break', loudness: 85 }],
      passages: ['weak-wall-passage'],
      debris: 6,
    });
    watch.dispose();
    const crate = loaded.spawns.find((s) => s.spawn.id === 'loot-crate')?.entity ?? -1;
    smash(crate);
    expect(watch.readout().broken).toHaveLength(1);
    expect(watch.readout().noises).toHaveLength(1);
    expect(watch.readout().debris).toBe(10);
  });
});
