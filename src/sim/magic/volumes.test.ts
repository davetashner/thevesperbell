// Spell stimuli (mw-e06.5): the stimulus op's shapes and the persistent volume, with generic
// property-tagged things (a wet floor, a conductive chain, a flammable crate), never named props.
import { describe, expect, it } from 'vitest';
import type { SpellEntry } from '@content/index';
import {
  addProperties,
  applyStimulus,
  installSpells,
  installSpellVolumes,
  installStimuli,
  pendingStimuli,
  placeEntity,
  readProperty,
  registerWorldProperties,
  SpellEffectApplied,
  SpellFizzled,
  SpellVolumeComponent,
  SpellVolumeExpired,
  SpellVolumeSpawned,
  stimulusResolved,
  stimulusSystem,
  volumeShape,
  World,
  type CastCommand,
  type EntityId,
  type Vec3,
} from '@sim/index';
import { makeSpell, stimulusOp } from './testing';

type Effect = SpellEntry['effects'][number];
type VolumeOp = Extract<Effect, { op: 'spawnVolume' }>;

const volumeOp = (overrides: Partial<VolumeOp> = {}): Effect => ({
  op: 'spawnVolume',
  shape: { kind: 'sphere', radius: 2 },
  element: 'cold',
  intensity: 60,
  duration: 1,
  falloff: 'none',
  ...overrides,
});

const rayOp = (width = 0.25, intensity = 100): Effect => ({
  ...(stimulusOp('heat', intensity) as Extract<Effect, { op: 'stimulus' }>),
  contact: false,
  ray: { width },
});

function setup(spells: readonly SpellEntry[], installVolumes = true) {
  const world = installStimuli(registerWorldProperties(new World<CastCommand>({ seed: 9 })));
  const byId = new Map(spells.map((s) => [s.id, s]));
  const pipeline = installSpells(world, { spells: (id) => byId.get(id) });
  if (installVolumes) installSpellVolumes(world, pipeline);
  world.addSystem(stimulusSystem());
  const thing = (at: Vec3, props: Parameters<typeof addProperties>[2] = {}): EntityId => {
    const entity = world.spawn();
    addProperties(world, entity, { temperature: 20, ...props });
    placeEntity(world, entity, at, 0.5);
    return entity;
  };
  const caster = thing({ x: 0, y: 0, z: 0 });
  const cast = (spell: string, target?: EntityId) => {
    pipeline.cast(world, { caster, spell, source: 'free', ...(target ? { target } : {}) });
    world.step();
  };
  const run = (ticks: number) => {
    for (let i = 0; i < ticks; i++) world.step();
  };
  return { world, pipeline, caster, thing, cast, run };
}

describe('stimulus op shapes (mw-e06.5)', () => {
  it('a ray heats what lies between the caster and the hit point, and nothing beyond or beside it', () => {
    const lance = makeSpell('t-lance', {
      delivery: { kind: 'touch', reach: 10 },
      effects: [rayOp()],
    });
    const s = setup([lance]);
    const target = s.thing({ x: 6, y: 0, z: 0 });
    const between = s.thing({ x: 3, y: 0, z: 0 });
    const beside = s.thing({ x: 3, y: 0, z: 2 });
    const beyond = s.thing({ x: 9, y: 0, z: 0 });
    s.cast('t-lance', target);
    const t = (e: EntityId) => readProperty(s.world, e, 'temperature');
    expect(t(between)).toBeGreaterThan(20);
    expect(t(target)).toBeGreaterThan(20);
    expect(t(beside)).toBe(20);
    expect(t(beyond)).toBe(20);
  });

  it('a contact stimulus (radius 0) heats the struck entity only', () => {
    const ember = makeSpell('t-ember', {
      delivery: { kind: 'touch', reach: 10 },
      effects: [stimulusOp('heat', 100)],
    });
    const s = setup([ember]);
    const target = s.thing({ x: 1, y: 0, z: 0 });
    const near = s.thing({ x: 1.2, y: 0, z: 0 });
    s.cast('t-ember', target);
    expect(readProperty(s.world, target, 'temperature')).toBeGreaterThan(20);
    expect(readProperty(s.world, near, 'temperature')).toBe(20);
  });

  it('a ray from a caster with no position starts at the hit point', () => {
    const lance = makeSpell('t-lance', { effects: [rayOp(1)] });
    const s = setup([lance]);
    const bare = s.world.spawn();
    s.pipeline.cast(s.world, { caster: bare, spell: 't-lance', source: 'free' });
    expect(pendingStimuli(s.world)[0]?.stimulus.shape).toMatchObject({
      kind: 'capsule',
      from: { x: 0, y: 0, z: 0 },
      to: { x: 0, y: 0, z: 0 },
    });
  });
});

describe('persistent volumes (mw-e06.5)', () => {
  const frostPatch = makeSpell('t-patch', {
    delivery: { kind: 'touch', reach: 10 },
    effects: [volumeOp()],
  });

  it('feeds the stimulus API every tick for its duration, then expires', () => {
    const s = setup([frostPatch]);
    const target = s.thing({ x: 4, y: 0, z: 0 }, { wetness: 1, waterSurface: true });
    const outside = s.thing({ x: 20, y: 0, z: 0 });
    const spawned: unknown[] = [];
    const expired: number[] = [];
    s.world.events.on(SpellVolumeSpawned, (e) => spawned.push(e));
    s.world.events.on(SpellVolumeExpired, (e) => expired.push(e.tick));
    s.cast('t-patch', target);
    expect(spawned.length).toBe(1);
    expect(s.world.query(SpellVolumeComponent).ids().length).toBe(1);
    s.run(29); // the casting step was the first emission: 30 of 60
    // 60 °C per second, no falloff: half a second in, 30 °C off.
    expect(readProperty(s.world, target, 'temperature')).toBeCloseTo(-10, 5);
    s.run(30);
    expect(readProperty(s.world, target, 'temperature')).toBeCloseTo(-40, 5);
    expect(expired.length).toBe(0);
    s.run(1);
    expect(expired.length).toBe(1);
    expect(s.world.query(SpellVolumeComponent).ids().length).toBe(0);
    expect(readProperty(s.world, outside, 'temperature')).toBe(20);
  });

  it('reports the volume as a spell effect and does not need a hit target', () => {
    const s = setup([frostPatch]);
    const seen: string[] = [];
    s.world.events.on(SpellEffectApplied, (e) => seen.push(e.op));
    const target = s.thing({ x: 1, y: 0, z: 0 });
    s.cast('t-patch', target);
    expect(seen).toEqual(['spawnVolume']);
  });

  it('charges conductive things standing in it, whatever they are', () => {
    const storm = makeSpell('t-storm', {
      effects: [volumeOp({ element: 'charge', intensity: 10, duration: 1 })],
    });
    const s = setup([storm]);
    const chain = s.thing({ x: 1, y: 0, z: 0 }, { conductive: true, charge: 0 });
    s.cast('t-storm');
    s.run(61);
    expect(readProperty(s.world, chain, 'charge')).toBeGreaterThan(9);
  });

  it('carries a gas id into the stimuli it emits', () => {
    const cloud = makeSpell('t-cloud', {
      effects: [volumeOp({ element: 'gas', gas: 'marsh-gas', duration: 1 })],
    });
    const s = setup([cloud]);
    s.cast('t-cloud');
    const seen: (string | undefined)[] = [];
    s.world.events.on(stimulusResolved, (e) => seen.push(e.stimulus.gas));
    s.world.step();
    expect(seen).toEqual(['marsh-gas']);
  });

  it('a spell with a volume op fizzles before spending where volumes are not installed', () => {
    const s = setup([frostPatch], false);
    const reasons: string[] = [];
    s.world.events.on(SpellFizzled, (e) => reasons.push(e.reason));
    s.cast('t-patch', s.thing({ x: 1, y: 0, z: 0 }));
    expect(reasons).toEqual(['unsupported-op']);
  });

  it('snapshots and restores a live volume', () => {
    const s = setup([frostPatch]);
    s.cast('t-patch', s.thing({ x: 1, y: 0, z: 0 }));
    s.run(10);
    const snapshot = s.world.snapshot();
    const before = s.world.query(SpellVolumeComponent).ids().length;
    s.run(100);
    s.world.restore(snapshot);
    expect(s.world.query(SpellVolumeComponent).ids().length).toBe(before);
  });

  it('a volume with no emission left in the stimulus queue emits nothing when stimuli are no-ops', () => {
    const s = setup([makeSpell('t-nil', { effects: [volumeOp({ intensity: 0 })] })]);
    s.cast('t-nil');
    s.run(5);
    expect(pendingStimuli(s.world)).toEqual([]);
    expect(
      applyStimulus(s.world, {
        shape: { kind: 'point', at: { x: 0, y: 0, z: 0 } },
        element: 'heat',
        intensity: 0,
      }),
    ).toBe(false);
  });
});

describe('volume shapes (mw-e06.5)', () => {
  const op = (shape: VolumeOp['shape']): VolumeOp => volumeOp({ shape }) as VolumeOp;
  const point = { x: 4, y: 1, z: 0 };
  const from = { x: 0, y: 0, z: 0 };

  it('maps a sphere onto a sphere at the point', () => {
    expect(volumeShape(op({ kind: 'sphere', radius: 3 }), point, from)).toEqual({
      kind: 'sphere',
      center: point,
      radius: 3,
    });
  });

  it('aims a cone from the point along the ground direction away from the caster', () => {
    const cone = volumeShape(op({ kind: 'cone', length: 5, angle: 90 }), point, from);
    expect(cone).toMatchObject({
      kind: 'cone',
      apex: point,
      direction: { x: 1, y: 0, z: 0 },
      length: 5,
    });
    expect(cone.kind === 'cone' && cone.halfAngle).toBeCloseTo(Math.PI / 4, 9);
  });

  it('lays a wall as a raised capsule along the aim', () => {
    const wall = volumeShape(op({ kind: 'line', length: 6, width: 1, height: 3 }), point, from);
    expect(wall).toEqual({
      kind: 'capsule',
      from: { x: 4, y: 2.5, z: 0 },
      to: { x: 10, y: 2.5, z: 0 },
      radius: 1.5,
    });
  });

  it('lays a decal as a one-metre-tall box', () => {
    expect(volumeShape(op({ kind: 'decal', radius: 2 }), point, from)).toEqual({
      kind: 'box',
      center: point,
      halfExtents: { x: 2, y: 0.5, z: 2 },
    });
  });

  it('aims north when the caster is unknown or stands on the point', () => {
    const cone = op({ kind: 'cone', length: 5, angle: 90 });
    expect(volumeShape(cone, point, undefined)).toMatchObject({ direction: { x: 0, y: 0, z: -1 } });
    expect(volumeShape(cone, point, point)).toMatchObject({ direction: { x: 0, y: 0, z: -1 } });
  });
});
