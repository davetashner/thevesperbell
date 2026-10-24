import { describe, expect, it } from 'vitest';
import type { SpellEntry } from '@content/index';
import { FakeCollisionWorld } from '../character/fake-collision-world';
import { box } from '../character/greybox';
import { DAMAGE_COMPONENTS } from '../combat/damage';
import { HIT_VOLUME_COMPONENTS } from '../combat/hits/components';
import { World } from '../core/world';
import { installLightField, lightFieldSystem } from '../light/install';
import { LightField } from '../light/field';
import { noiseEmitted, type NoiseEvent } from '../noise/events';
import { PhysicsColliderComponent } from '../physics/objects';
import { registerWorldProperties } from '../properties/components';
import { PlacementComponent, placeEntity } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { installStimuli, stimulusSystem } from '../stimulus/stimulus';
import {
  CASTER_LIGHT_HEIGHT,
  emitSpellNoise,
  installSpellEmission,
  SCHOOL_NOISE_DB,
  spellLights,
  SpellLightLedgerComponent,
  spellNoiseDb,
} from './emission';
import { SpellCast, SpellEffectApplied, SpellHit } from './events';
import { installSpells, type CastCommand } from './pipeline';
import { installSpellProjectiles } from './projectile';
import { makeSpell, projectileDelivery, stimulusOp } from './testing';

const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
type Effect = SpellEntry['effects'][number];

const light = (
  intensity: number,
  radius: number,
  attach: 'caster' | 'delivery' | 'point' = 'point',
  duration = 0,
): Effect => ({ op: 'light', intensity, radius, duration, attach });
const noise = (phase: 'windup' | 'release' | 'impact', loudness: number): Effect => ({
  op: 'noise',
  phase,
  loudness,
});

function setup(spells: readonly SpellEntry[], ambient = 0, walls: readonly Vec3[] = []) {
  const byId = new Map(spells.map((s) => [s.id, s]));
  const world = installStimuli(registerWorldProperties(new World<CastCommand>({ seed: 5 })));
  world.register(...DAMAGE_COMPONENTS, ...HIT_VOLUME_COMPONENTS, PhysicsColliderComponent);
  const field = new LightField({ defaultAmbient: ambient });
  installLightField(world, field);
  const pipeline = installSpells(world, { spells: (id) => byId.get(id) });
  installSpellProjectiles(world, pipeline, {
    collision: new FakeCollisionWorld(walls.map((w) => box(w, v3(w.x + 0.1, 50, 50)))),
    muzzleHeight: 0,
  });
  installSpellEmission(world, pipeline);
  world.addSystem(stimulusSystem());
  world.addSystem(lightFieldSystem(field));
  const noises: NoiseEvent[] = [];
  world.events.on(noiseEmitted, (n) => noises.push(n));
  const caster = world.spawn();
  placeEntity(world, caster, v3(0, 0, 0), 0.5);
  const cast = (spell: string, aim?: Vec3) => {
    pipeline.cast(world, { caster, spell, source: 'free', ...(aim === undefined ? {} : { aim }) });
    world.step();
  };
  const run = (ticks: number) => {
    for (let i = 0; i < ticks; i++) world.step();
  };
  return { world, field, pipeline, caster, cast, run, noises };
}

const bolt = (effects: Effect[], overrides: Partial<SpellEntry> = {}) =>
  makeSpell('bolt', {
    delivery: projectileDelivery({ speed: 10, maxRange: 40, lifetime: 10 }),
    effects,
    ...overrides,
  });

describe('spell light (mw-e06.14)', () => {
  it('AC-1: a light op at a dark room’s centre lights it to at least 0.4 at 3 m (and 0.05 ambient shows beyond)', () => {
    // The field's falloff is (I / 100) × (1 − d / R)²: intensity 0.8 in the bead's text is a level, so
    // the same light is 160 sim units here (level 1.6; 0.4 at 3 m of 6, plus the 0.05 ambient).
    const t = setup([makeSpell('lamp', { effects: [light(160, 6)] })], 0.05);
    expect(t.field.levelAt(v3(3, 0, 0))).toBeCloseTo(0.05);
    t.cast('lamp');
    expect(t.field.levelAt(v3(3, 0, 0))).toBeGreaterThanOrEqual(0.4);
    expect(t.field.levelAt(v3(7, 0, 0))).toBeCloseTo(0.05);
  });

  it('AC-2: a light carried by a projectile follows it each tick and leaves its old position within one tick', () => {
    const t = setup([bolt([light(100, 2, 'delivery', 5)])]);
    t.cast('bolt', v3(1, 0, 0));
    for (let i = 0; i < 6; i++) {
      const [lamp] = spellLights(t.world);
      expect(lamp?.delivery).not.toBeNull();
      const before = lamp?.position.x ?? NaN;
      t.world.step();
      const after = spellLights(t.world)[0]?.position.x ?? NaN;
      expect(after).toBeGreaterThan(before);
      expect(t.field.levelAt(v3(after, 0, 0))).toBeGreaterThan(0.9);
      expect(t.field.levelAt(v3(before, 0, 2.5))).toBeCloseTo(0);
      expect(t.field.levelAt(v3(before, 0, 0))).toBeLessThan(t.field.levelAt(v3(after, 0, 0)));
    }
  });

  it('AC-2: when the projectile lands the light stays at the impact for its duration, a flash lasting one tick', () => {
    const t = setup([bolt([light(100, 3, 'delivery', 0)])], 0, [v3(5, -50, -50)]);
    t.cast('bolt', v3(1, 0, 0));
    expect(spellLights(t.world)).toHaveLength(1);
    t.run(60);
    expect(spellLights(t.world)).toHaveLength(0);
    expect(t.field.levelAt(v3(4.8, 0, 0))).toBeCloseTo(0);

    const held = setup([bolt([light(100, 3, 'delivery', 2)])], 0, [v3(5, -50, -50)]);
    held.cast('bolt', v3(1, 0, 0));
    held.run(60);
    const [stuck] = spellLights(held.world);
    expect(stuck?.delivery).toBeNull();
    expect(stuck?.position.x).toBeCloseTo(5, 0);
    expect(held.field.levelAt(v3(4.6, 0, 0))).toBeGreaterThan(0.5);
    held.run(100);
    expect(spellLights(held.world)).toHaveLength(0);
  });

  it('a delivery light on an instant delivery shines at the hit, and a caster light follows the caster', () => {
    const t = setup([
      makeSpell('glow', { effects: [light(100, 4, 'caster', 1), light(100, 4, 'delivery', 1)] }),
    ]);
    t.cast('glow');
    expect(spellLights(t.world).map((l) => l.followsCaster)).toEqual([false, true]);
    placeEntity(t.world, t.caster, v3(10, 0, 0), 0.5);
    t.world.step();
    const [atHit, following] = spellLights(t.world);
    expect(atHit?.position.x).toBe(0);
    expect(following?.position).toEqual(v3(10, CASTER_LIGHT_HEIGHT, 0));
    expect(t.field.levelAt(v3(10, CASTER_LIGHT_HEIGHT, 0))).toBeGreaterThan(0.9);
    t.run(61);
    expect(spellLights(t.world)).toHaveLength(0);
  });

  it('a caster-attached light does not start for a caster with no position', () => {
    const t = setup([makeSpell('glow', { effects: [light(100, 4, 'caster', 5)] })]);
    t.world.remove(t.caster, PlacementComponent);
    t.cast('glow');
    expect(spellLights(t.world)).toHaveLength(0);
  });

  it('a caster light stays where it was when the caster loses its position, and a delivery with none ends its light', () => {
    const t = setup([makeSpell('glow', { effects: [light(100, 4, 'caster', 5)] })]);
    t.cast('glow');
    const [shining] = spellLights(t.world);
    t.world.remove(t.caster, PlacementComponent);
    t.world.step();
    expect(spellLights(t.world)[0]?.position).toEqual(shining?.position);

    const beam = setup([
      makeSpell('ray', {
        delivery: { kind: 'beam', length: 5, width: 1, maxBounces: 0 },
        effects: [light(100, 4, 'delivery', 5)],
      }),
    ]);
    beam.pipeline.deliveries.register('beam', () => ({ kind: 'pending' }));
    beam.cast('ray');
    expect(spellLights(beam.world)).toHaveLength(0);
  });

  it('events for spells it cannot look up are ignored', () => {
    const t = setup([makeSpell('ward')]);
    const base = { tick: 0, caster: t.caster, spell: 'nope', delivery: t.caster };
    t.world.events.emit(SpellCast, { ...base, source: 'free', deliveryKind: 'self' });
    t.world.events.emit(SpellHit, { ...base, target: null, point: v3(0, 0, 0) });
    t.world.events.flush();
    expect(t.noises).toHaveLength(0);
    expect(spellLights(t.world)).toHaveLength(0);
  });

  it('AC-4: a light op with a 10 s duration is gone from the light field after 10 s', () => {
    const t = setup([makeSpell('lamp', { effects: [light(100, 6, 'point', 10)] })]);
    t.cast('lamp');
    const hz = t.world.clock.hz;
    t.run(10 * hz - 3);
    expect(t.field.levelAt(v3(1, 0, 0))).toBeGreaterThan(0.5);
    t.run(2);
    expect(t.field.levelAt(v3(1, 0, 0))).toBeGreaterThan(0.5);
    t.run(1);
    expect(spellLights(t.world)).toHaveLength(0);
    expect(t.field.levelAt(v3(1, 0, 0))).toBeCloseTo(0);
  });

  it('keeps every light in the snapshot, so a restored world shines the same', () => {
    const t = setup([makeSpell('lamp', { effects: [light(100, 6, 'point', 10)] })]);
    t.cast('lamp');
    const lights = spellLights(t.world);
    expect(lights).toHaveLength(1);
    expect(JSON.parse(JSON.stringify(lights))).toEqual(lights);
  });
});

describe('spell noise (mw-e06.14)', () => {
  it('AC-3: a spell with impact loudness 90 emits a NoiseEvent of 90 at the impact position', () => {
    const t = setup([bolt([noise('impact', 90)])], 0, [v3(8, -50, -50)]);
    t.cast('bolt', v3(1, 0, 0));
    t.run(120);
    const impact = t.noises.filter((n) => n.loudness === 90);
    expect(impact).toHaveLength(1);
    expect(impact[0]?.position.x).toBeCloseTo(8, 0);
    expect(impact[0]).toMatchObject({ kind: 'spell', source: t.caster, tags: ['magic', 'arcane'] });
  });

  it('AC-3: the noise op reports its impact sound; release and wind-up ops are not impact effects', () => {
    const t = setup([bolt([noise('impact', 90), noise('release', 40), noise('windup', 20)])], 0, [
      v3(8, -50, -50),
    ]);
    const applied: string[] = [];
    t.world.events.on(SpellEffectApplied, (e) =>
      applied.push(`${e.op}:${String(e.detail['loudness'])}`),
    );
    t.cast('bolt', v3(1, 0, 0));
    t.run(120);
    expect(applied).toEqual(['noise:90']);
    expect(t.noises.map((n) => n.loudness)).toEqual([40, 90]);
  });

  it('AC-5: a spell with no noise data sounds at its school default instead of silence', () => {
    for (const school of Object.keys(SCHOOL_NOISE_DB) as (keyof typeof SCHOOL_NOISE_DB)[]) {
      const spell = makeSpell('quiet', { school });
      expect(SCHOOL_NOISE_DB[school]).toBeGreaterThan(0);
      expect(spellNoiseDb(spell, 'release')).toBe(SCHOOL_NOISE_DB[school]);
      expect(spellNoiseDb(spell, 'impact')).toBe(SCHOOL_NOISE_DB[school]);
      expect(spellNoiseDb(spell, 'windup')).toBeLessThan(SCHOOL_NOISE_DB[school]);
    }
    const t = setup([bolt([stimulusOp('cold', 1, 0.1)], { school: 'storm' })], 0, [
      v3(8, -50, -50),
    ]);
    t.cast('bolt', v3(1, 0, 0));
    t.run(120);
    expect(t.noises.map((n) => n.loudness)).toEqual([80, 80]);
    expect(t.noises[0]?.position).toEqual(v3(0, 0, 0));
  });

  it('only the phases a spell sets are overridden, and 0 is silence on purpose', () => {
    const spell = makeSpell('hush', { school: 'fire', effects: [noise('release', 0)] });
    expect(spellNoiseDb(spell, 'release')).toBe(0);
    expect(spellNoiseDb(spell, 'impact')).toBe(SCHOOL_NOISE_DB.fire);
    const t = setup([spell]);
    t.cast('hush');
    expect(t.noises).toHaveLength(0);
    const shy = makeSpell('shy', { school: 'shadow', effects: [noise('windup', 0)] });
    expect(spellNoiseDb(shy, 'windup')).toBe(0);
    expect(spellNoiseDb(makeSpell('x', { school: 'shadow' }), 'windup')).toBe(10);
    expect(spellNoiseDb(makeSpell('x', { school: 'somnomancy' }), 'windup')).toBe(15);
  });

  it('a self spell sounds once at release unless it sets an impact sound; wind-up noise is emitted on request', () => {
    const t = setup([
      makeSpell('ward', { school: 'arcane' }),
      makeSpell('thud', { school: 'arcane', effects: [noise('impact', 70)] }),
    ]);
    t.cast('ward');
    expect(t.noises.map((n) => n.loudness)).toEqual([55]);
    t.noises.length = 0;
    t.cast('thud');
    expect(t.noises.map((n) => n.loudness)).toEqual([55, 70]);
    t.noises.length = 0;
    const spell = makeSpell('mutter', { school: 'fire' });
    emitSpellNoise(t.world, spell, 'windup', v3(1, 2, 3), t.caster);
    t.world.events.flush();
    expect(t.noises).toMatchObject([{ loudness: 45, position: v3(1, 2, 3), entity: null }]);
  });

  it('ignores casts of spells it cannot look up and casts by a caster with no position', () => {
    const t = setup([makeSpell('ward')]);
    const ghost = t.world.spawn();
    t.pipeline.cast(t.world, { caster: ghost, spell: 'ward', source: 'free' });
    t.world.step();
    expect(t.noises).toHaveLength(0);
  });

  it('throws when read from a world without spell emission', () => {
    const world = new World<never>({ seed: 1 });
    world.register(SpellLightLedgerComponent);
    expect(() => spellLights(world)).toThrow(/not installed/);
  });
});
