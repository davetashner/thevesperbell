// mw-e29.11: arrow effects with the shipped arrows, the shipped arrows cue sheets and the real VFX
// runtime, driven by the real arrow system against a wall. No renderer: what the Three.js layer would
// draw is the ArrowFx view, and the particle effects are the real VfxSystem's.
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import { markExercised } from '@content/testing';
import { attachGameVfx } from '@game/cues/game-vfx';
import { readArrowTransform } from '@game/combat/arrows-view';
import { ArrowFx, VfxSystem, type VfxSpawnOptions } from '@game/vfx/index';
import {
  arrowImpact,
  arrowLookup,
  box,
  DAMAGE_COMPONENTS,
  DamageModel,
  FakeCollisionWorld,
  fireArrow,
  HIT_VOLUME_COMPONENTS,
  installArrows,
  PlacementComponent,
  registerWorldProperties,
  World,
  type ArrowImpactInfo,
  type EntityId,
  type Vec3,
} from '@sim/index';

const content = loadGameContent();
const ARROWS = arrowLookup(content.all('arrow'));
const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/** A wall 20 m east (x = 20); `hardness` of the default material decides stick or ricochet. */
function range() {
  const world = registerWorldProperties(new World<never>({ seed: 1, hz: 60 }));
  world.register(PlacementComponent, ...DAMAGE_COMPONENTS, ...HIT_VOLUME_COMPONENTS);
  const collision = new FakeCollisionWorld([box(v3(20, -5, -10), v3(21, 20, 10))]);
  installArrows(world, { arrows: ARROWS, damage: new DamageModel(), collision });
  const impacts: ArrowImpactInfo[] = [];
  world.events.on(arrowImpact, (e) => impacts.push(e));
  // Arrows are found where the sim has them, in flight or at rest, exactly as the game's anchor does.
  const anchor = (entity: EntityId) => readArrowTransform(world, entity);
  const vfx = new VfxSystem({ effects: content.all('vfx-effect'), anchors: anchor });
  const spawned: { effect: string; options: VfxSpawnOptions }[] = [];
  const stopped: number[] = [];
  const recording = {
    spawn: (effect: string, options: VfxSpawnOptions) => {
      const handle = vfx.spawn(effect, options);
      spawned.push({ effect, options });
      return handle;
    },
    stop: (handle: number) => {
      stopped.push(handle);
      vfx.stop(handle);
    },
    alive: (handle: number) => vfx.alive(handle),
    has: (effect: string) => vfx.has(effect),
  };
  let now = 0;
  attachGameVfx({
    world,
    vfx: recording,
    sheets: content.all('vfx-cue-sheet'),
    materials: content.all('material'),
    arrows: content.all('arrow'),
    locate: anchor,
    now: () => now,
    dev: false,
  });
  const fx = new ArrowFx({ world, arrows: content.all('arrow'), now: () => now });
  fx.attach();
  const shoot = (arrow: string, speed = 40): EntityId => {
    const entity = fireArrow(world, ARROWS, {
      arrow,
      origin: v3(0, 1.5, 0),
      velocity: v3(speed, 0.4, 0),
    });
    return entity;
  };
  const fly = (): void => {
    for (let i = 0; i < 120 && impacts.length === 0; i++) {
      world.step();
      now += 1000 / 60;
    }
    world.events.flush();
  };
  return {
    world,
    vfx,
    fx,
    impacts,
    spawned,
    stopped,
    shoot,
    fly,
    advance: (ms: number) => (now += ms),
  };
}

describe('every arrow cue names an effect that exists (mw-e29.11)', () => {
  it('the trail and impact cues of the shipped arrows, and the arrows sheet, all resolve', () => {
    const effects = new Set(content.all('vfx-effect').map((e) => e.id));
    for (const arrow of content.all('arrow')) {
      expect(effects, arrow.id).toContain(arrow.cues.trailVfx);
      if (arrow.cues.impactVfx !== undefined)
        expect(effects, arrow.id).toContain(arrow.cues.impactVfx);
    }
    const sheet = content.get('vfx-cue-sheet', 'arrows');
    for (const rule of sheet.rules) {
      if (!rule.effect.includes('{')) expect(effects, rule.effect).toContain(rule.effect);
    }
  });
});

describe('arrow effects against the real arrow system (mw-e29.11)', () => {
  it('AC-1: a water arrow impact spawns the burst at the contact and a wet decal at 1.5 m', ({
    task,
  }) => {
    markExercised(task, 'arrow', 'water');
    const r = range();
    r.shoot('water');
    r.fly();
    const [hit] = r.impacts;
    expect(hit?.outcome).toBe('shatter');
    const burst = r.spawned.find((s) => s.effect === 'vfx-arrow-impact-water');
    expect(burst?.options.position).toEqual(hit?.position);
    r.advance(300);
    r.fx.frame();
    expect(r.fx.view.decals).toHaveLength(1);
    expect(r.fx.view.decals[0]).toMatchObject({ radius: 1.5 });
    expect(r.fx.view.decals[0]?.x).toBeCloseTo(hit?.position.x ?? NaN);
    expect(r.fx.view.decals[0]?.opacity).toBeGreaterThan(0);
    // And the burst really emits particles in the real runtime.
    r.vfx.update(0.05, v3(0, 1.5, 0));
    expect(r.vfx.batches.reduce((n, b) => n + b.count, 0)).toBeGreaterThan(10);
    // The shattered arrow leaves the broken shaft in the wall.
    expect(r.fx.view.broken).toHaveLength(1);
  });

  it('AC-3: a deflected arrow throws deflect sparks at the contact point', ({ task }) => {
    markExercised(task, 'arrow', 'blunt');
    const r = range();
    r.shoot('blunt'); // blunt heads never embed: they glance off the wall
    r.fly();
    const [hit] = r.impacts;
    expect(hit?.outcome).toBe('ricochet');
    const sparks = r.spawned.filter((s) => s.effect === 'vfx-arrow-deflect-sparks');
    expect(sparks).toHaveLength(1);
    expect(sparks[0]?.options.position).toEqual(hit?.position);
    r.vfx.update(0.05, v3(0, 1.5, 0));
    expect(r.vfx.batches.reduce((n, b) => n + b.count, 0)).toBeGreaterThan(5);
  });

  it('a blunt impact throws the heavy dust, instead of the generic arrow puff', () => {
    const r = range();
    r.shoot('blunt');
    r.fly();
    const effects = r.spawned.map((s) => s.effect);
    expect(effects).toContain('vfx-arrow-impact-blunt');
    expect(effects).not.toContain('vfx-impact-dust');
  });

  it('a sharp arrow that sticks wobbles for 400 ms, with the plain dust puff and no deflect sparks', ({
    task,
  }) => {
    markExercised(task, 'arrow', 'standard');
    const r = range();
    const arrow = r.shoot('standard', 80);
    r.fly();
    const [hit] = r.impacts;
    expect(hit?.outcome).toBe('stick');
    r.advance(10);
    expect(Math.abs(r.fx.wobble(arrow))).toBeGreaterThan(0);
    r.advance(400);
    expect(r.fx.wobble(arrow)).toBe(0);
    const effects = r.spawned.map((s) => s.effect);
    expect(effects).not.toContain('vfx-arrow-deflect-sparks');
    expect(effects).toContain('vfx-impact-dust');
  });

  it('every arrow plays its own trail on the arrow from the moment it is loosed', ({ task }) => {
    for (const id of ['standard', 'fire', 'water', 'rope', 'noise', 'blunt']) {
      markExercised(task, 'arrow', id);
      const r = range();
      const arrow = r.shoot(id);
      r.world.events.flush();
      const trail = content.get('arrow', id).cues.trailVfx;
      const played = r.spawned.find((s) => s.effect === trail);
      expect(played, id).toBeDefined();
      expect(played?.options.entity, id).toBe(arrow);
    }
  });

  it('the flames follow the fire arrow along its flight, not its launch point', () => {
    const r = range();
    r.shoot('fire');
    r.world.events.flush();
    for (let i = 0; i < 20; i++) {
      r.world.step();
      r.vfx.update(1 / 60, v3(0, 1.5, 0));
    }
    // 20 ticks at ~40 m/s: well over 8 m downrange; flames are born along the way.
    let furthest = 0;
    for (const batch of r.vfx.batches) {
      for (let i = 0; i < batch.count; i++) furthest = Math.max(furthest, batch.data[i * 9] ?? 0);
    }
    expect(furthest).toBeGreaterThan(8);
  });

  it('the trail stops at the first impact, except the fire arrow’s flames, which burn on', () => {
    const water = range();
    water.shoot('water');
    water.fly();
    expect(water.stopped).toHaveLength(1);
    const fire = range();
    fire.shoot('fire', 80);
    fire.fly();
    expect(fire.stopped).toHaveLength(0);
    expect(fire.spawned.map((s) => s.effect)).toContain('vfx-arrow-trail-fire');
  });

  it('a noise arrow rings where it lands, and a rope arrow unfurls its rope down from the wall', () => {
    const noise = range();
    noise.shoot('noise');
    noise.fly();
    noise.fx.frame();
    expect(noise.fx.view.rings).toHaveLength(1);
    const rope = range();
    rope.shoot('rope', 80);
    rope.fly();
    expect(rope.impacts[0]?.outcome).toBe('stick');
    rope.advance(900);
    rope.fx.frame();
    expect(rope.fx.view.ropes[0]?.length).toBe(8);
  });
});
