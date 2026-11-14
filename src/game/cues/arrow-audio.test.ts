// The arrow cue sheet (mw-e05.19): arrows loosed and landing in a real sim run, heard through the
// cue bridge on the world's bus with the shipped content.

import { describe, expect, it } from 'vitest';
import type { PlayOptions } from '@audio/index';
import { loadGameContent, type CueRuleDef } from '@content/index';
import {
  addProperties,
  arrowLookup,
  box,
  DAMAGE_COMPONENTS,
  DamageModel,
  FakeCollisionWorld,
  fireArrow,
  giveCombatant,
  giveHurtboxes,
  HIT_VOLUME_COMPONENTS,
  installArrows,
  PhysicsColliderComponent,
  PlacementComponent,
  placeEntity,
  registerWorldProperties,
  World,
  type EntityId,
  type Vec3,
} from '@sim/index';
import { AudioCueBridge, worldCueLookups } from './audio-bridge.ts';

const content = loadGameContent();
const ARROWS = arrowLookup(content.all('arrow'));

/** A world with arrows flying against a wall at x = 10 (collider 1) made of `wall`. */
/** A cue sheet as the bridge reads it. */
interface Sheet {
  readonly rules: readonly CueRuleDef[];
}

function range(sheet: Sheet, wall: Record<string, unknown> = {}) {
  const world = registerWorldProperties(new World<never>({ seed: 1 }));
  world.register(...DAMAGE_COMPONENTS, ...HIT_VOLUME_COMPONENTS, PlacementComponent);
  world.register(PhysicsColliderComponent);
  const collision = new FakeCollisionWorld([box({ x: 10, y: -5, z: -5 }, { x: 11, y: 5, z: 5 })]);
  installArrows(world, { arrows: ARROWS, damage: new DamageModel(), collision });
  const wallEntity = world.spawn();
  if (Object.keys(wall).length > 0) addProperties(world, wallEntity, wall);
  world.add(wallEntity, PhysicsColliderComponent, { colliders: [1] });
  const played: { cue: string; options: PlayOptions }[] = [];
  new AudioCueBridge({
    sheets: [sheet],
    player: { play: (cue, options) => played.push({ cue, options }) },
    now: () => world.tick * 1000,
    lookups: worldCueLookups(world, content.all('material'), { arrows: content.all('arrow') }),
  }).attach(world.events);
  const fire = (arrow: string, velocity: Vec3, shooter?: EntityId) =>
    fireArrow(world, ARROWS, {
      arrow,
      origin: { x: 0, y: 0, z: 0 },
      velocity,
      ...(shooter !== undefined && { shooter }),
    });
  const run = (ticks: number) => {
    for (let i = 0; i < ticks; i++) world.step();
  };
  return { world, played, fire, run, wall: wallEntity };
}

const arrowsSheet = content.get('cue-sheet', 'arrows');

describe('arrow cues (mw-e05.19)', () => {
  it('AC-2: a ricochet rule fires once when a standard arrow ricochets off stone', () => {
    const sheet: Sheet = {
      rules: [
        {
          event: 'arrowImpact',
          match: { outcome: 'ricochet' },
          layer: 'main',
          cue: 'sfx-arrow-ricochet-{other}',
          pitchJitter: 0,
          volumeJitterDb: 0,
          volumeDb: 0,
          cooldownMs: 0,
          gameplayCritical: false,
        },
      ],
    };
    const r = range(sheet, { material: 'stone', surfaceHardness: 'hard' });
    const shooter = r.world.spawn();
    r.fire('standard', { x: 60, y: 0, z: 0 }, shooter);
    r.run(120);
    expect(r.played.map((p) => p.cue)).toEqual(['sfx-arrow-ricochet-stone']);
  });

  it('the bow twangs at the shooter, louder for a faster arrow', () => {
    const r = range(arrowsSheet);
    const shooter = r.world.spawn();
    r.fire('standard', { x: 0, y: 0, z: 60 }, shooter);
    r.run(1);
    r.fire('standard', { x: 0, y: 0, z: 18 }, shooter);
    r.run(1);
    expect(r.played.map((p) => [p.cue, p.options.entity])).toEqual([
      ['sfx-bow-release-twang', shooter],
      ['sfx-bow-release-twang', shooter],
    ]);
    const [full, weak] = r.played.map((p) => p.options.volume ?? 1);
    expect(full ?? 0).toBeGreaterThan((weak ?? 1) * 2); // ≥ 6 dB louder
  });

  it('an arrow into wood thunks with the arrow’s wood set at the contact', () => {
    const r = range(arrowsSheet, { material: 'wood' });
    r.fire('standard', { x: 60, y: 0, z: 0 });
    r.run(60);
    expect(r.played.map((p) => p.cue)).toEqual(['sfx-bow-release-twang', 'sfx-arrow-impact-wood']);
    // Anchored on the arrow, which now rests stuck in the wall.
    expect(r.played[1]?.options.position?.x).toBeCloseTo(10, 6);
  });

  it('stone cracks, metal rings off, other surfaces play their material’s impact set', () => {
    const cues = (wall: Record<string, unknown>) => {
      const r = range(arrowsSheet, wall);
      r.fire('standard', { x: 60, y: 0, z: 0 });
      r.run(60);
      return r.played.map((p) => p.cue).filter((cue) => cue !== 'sfx-bow-release-twang');
    };
    expect(cues({ material: 'stone', surfaceHardness: 'hard' })[0]).toBe('sfx-arrow-impact-stone');
    expect(cues({ material: 'iron', surfaceHardness: 'hard' })[0]).toBe('sfx-arrow-ricochet-metal');
    expect(cues({ material: 'iron', surfaceHardness: 'medium' })).toEqual([
      'sfx-arrow-impact-metal',
    ]);
    expect(cues({ material: 'straw', surfaceHardness: 'soft' })).toEqual(['sfx-impact-straw']);
  });

  it('a payload arrow layers its own impact sound over the surface', () => {
    const r = range(arrowsSheet, { material: 'wood' });
    r.fire('water', { x: 60, y: 0, z: 0 });
    r.run(60);
    expect(r.played.map((p) => p.cue)).toEqual([
      'sfx-bow-release-twang',
      'sfx-arrow-impact-wood',
      'sfx-arrow-water-splash',
    ]);
  });

  it('a creature hit is left to the damage cues; a glance off a creature plays the glance', () => {
    const r = range(arrowsSheet);
    const creature = (at: Vec3, properties: Record<string, unknown> = {}) => {
      const entity = r.world.spawn();
      placeEntity(r.world, entity, at, 0.5);
      giveCombatant(r.world, entity, { health: 100 });
      giveHurtboxes(r.world, entity, {
        boxes: [
          {
            id: 'body',
            socket: 'root',
            region: 'torso',
            armored: false,
            multiplier: 1,
            shape: { kind: 'sphere', center: { x: 0, y: 0, z: 0 }, radius: 0.5 },
          },
        ],
      });
      if (Object.keys(properties).length > 0) addProperties(r.world, entity, properties);
      return entity;
    };
    creature({ x: 5, y: 0, z: 0 });
    r.fire('standard', { x: 60, y: 0, z: 0 });
    r.run(30);
    expect(r.played.map((p) => p.cue)).toEqual(['sfx-bow-release-twang']);
    creature({ x: 0, y: 0, z: 5 }, { surfaceHardness: 'hard' });
    r.fire('standard', { x: 0, y: 0, z: 60 });
    r.run(10);
    expect(r.played.map((p) => p.cue)).toEqual([
      'sfx-bow-release-twang',
      'sfx-bow-release-twang',
      'sfx-combat-glance',
    ]);
  });
});
