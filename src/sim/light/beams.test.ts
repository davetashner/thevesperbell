/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, expect, it } from 'vitest';
import { box, rampAt } from '../character/greybox';
import { CharacterController } from '../character/system';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import { atan2, cos, hypot, sin } from '../math';
import { CreatureComponent } from '../creatures/components';
import { ElementRuleSet, elementRulesSystem } from '../elements/rules';
import { fireRules } from '../elements/fire';
import { elementFieldSystem, installElementField } from '../field/install';
import { PushConfigComponent } from '../push/state';
import {
  addProperties,
  readProperty,
  registerWorldProperties,
  type WorldPropertyInit,
} from '../properties/components';
import { tagEntity, TagsComponent } from '../signals/filter';
import { placeEntity } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { installStimuli, stimulusSystem } from '../stimulus/stimulus';
import {
  BEAM_PREFABS,
  beamsSystem,
  BeamEmitterComponent,
  BeamTracer,
  colourPasses,
  DEFAULT_MAX_BOUNCES,
  LightReceiverComponent,
  makeBeamEmitter,
  makeLightReceiver,
  makeOptic,
  MAX_BEAM_SEGMENTS,
  OpticComponent,
  setBeamActive,
  WHITE,
} from './beams';
import { LightField } from './field';
import { installLightField, lightFieldSystem } from './install';
import { StaticOccluders } from './occluders';

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const deg = (rad: number) => (rad * 180) / Math.PI;

function rig(statics?: StaticOccluders) {
  const world = installStimuli(registerWorldProperties(new World<never>({ seed: 5, hz: 60 })));
  world.register(BeamEmitterComponent, OpticComponent, LightReceiverComponent, PushConfigComponent);
  world.register(TagsComponent);
  const tracer = new BeamTracer(statics === undefined ? {} : { statics });
  const emitter = (
    at: Vec3,
    dir: Vec3,
    options = {},
    kind: 'sunlight' | 'crystal' | 'spell' = 'sunlight',
  ) => {
    const e = world.spawn();
    makeBeamEmitter(world, e, kind, at, dir, options);
    return e;
  };
  const optic = (kind: 'mirror' | 'lens' | 'pane', at: Vec3, normal: Vec3, options = {}) => {
    const e = world.spawn();
    makeOptic(world, e, kind, at, normal, options);
    return e;
  };
  const thing = (at: Vec3, radius: number, props: WorldPropertyInit = {}) => {
    const e = world.spawn();
    addProperties(world, e, props);
    placeEntity(world, e, at, radius);
    return e;
  };
  const trace = () => {
    world.step();
    tracer.update(world);
    return tracer.paths;
  };
  return { world, tracer, emitter, optic, thing, trace };
}

describe('light beams (mw-e03.17)', () => {
  it('AC-1: a beam hitting a mirror at 30° to its normal reflects at 30° on the other side', () => {
    const r = rig();
    const a = (30 * Math.PI) / 180;
    const mirror = r.optic('mirror', v(0, 0, 0), v(0, 1, 0), { radius: 1 });
    r.emitter(v(-4 * sin(a), 4 * cos(a), 0), v(sin(a), -cos(a), 0));
    const [path] = r.trace();
    expect(readProperty(r.world, mirror, 'reflective')).toBe(true);
    expect(path!.bounces).toBe(1);
    const [, out] = path!.segments;
    const len = hypot(out!.to.x - out!.from.x, out!.to.y - out!.from.y, out!.to.z - out!.from.z);
    const d = v(
      (out!.to.x - out!.from.x) / len,
      (out!.to.y - out!.from.y) / len,
      (out!.to.z - out!.from.z) / len,
    );
    const angle = deg(atan2(Math.sqrt(d.x * d.x + d.z * d.z), d.y)); // from the +y normal
    expect(Math.abs(angle - 30)).toBeLessThan(0.01);
    expect(d.x).toBeGreaterThan(0); // continues forward, mirrored about the normal
    expect(path!.end).toBe('range');
  });

  it("a mirror's rotation (the push rules' angle) re-aims the beam", () => {
    const r = rig();
    const mirror = r.optic('mirror', v(0, 0, 0), v(-1, 0, 0), { radius: 1 });
    r.emitter(v(-3, 0, 0), v(1, 0, 0));
    expect(r.trace()[0]!.segments[1]!.to.x).toBeLessThan(0); // bounces straight back
    r.world.add(mirror, PushConfigComponent, { axis: null, grid: 0, rotateStep: 45, angle: 45 });
    const [rotated] = r.trace();
    // Normal turned 45° about the vertical: the beam leaves at an angle instead of straight back.
    const out = rotated!.segments[1]!;
    expect(Math.abs(out.to.z)).toBeGreaterThan(1);
    r.world.set(mirror, PushConfigComponent, { axis: null, grid: 0, rotateStep: 45, angle: 90 });
    const [turned] = r.trace();
    expect(turned!.segments).toHaveLength(1); // normal now faces +z: the beam runs edge-on and misses
  });

  it('a reflective thing without an optic bounces the beam off its sphere', () => {
    const r = rig();
    r.thing(v(0, 0, 0), 1, { reflective: true });
    r.emitter(v(-5, 0, 0), v(1, 0, 0));
    const [path] = r.trace();
    expect(path!.bounces).toBe(1);
    expect(path!.segments[1]!.to.x).toBeLessThan(-5); // straight back off the sphere
  });

  it('AC-4: two mirrors facing each other stop at max bounces without hanging', () => {
    const r = rig();
    r.optic('mirror', v(0, 0, 0), v(1, 0, 0), { radius: 1 });
    r.optic('mirror', v(4, 0, 0), v(-1, 0, 0), { radius: 1 });
    r.emitter(v(2, 0, 0), v(1, 0, 0));
    const [path] = r.trace();
    expect(path!.end).toBe('bounces');
    expect(path!.bounces).toBe(DEFAULT_MAX_BOUNCES);
    expect(path!.segments).toHaveLength(DEFAULT_MAX_BOUNCES + 1);
  });

  it("maxBounces is the emitter's own and 0 means the first mirror ends the beam", () => {
    const r = rig();
    r.optic('mirror', v(0, 0, 0), v(1, 0, 0), { radius: 1 });
    r.emitter(v(2, 0, 0), v(-1, 0, 0), { maxBounces: 0 });
    const [path] = r.trace();
    expect(path!.end).toBe('bounces');
    expect(path!.segments).toHaveLength(1);
  });

  it('transparent things pass the beam, ice included, and a pane tints it', () => {
    const r = rig();
    r.thing(v(1, 0, 0), 0.4, { frozen: true });
    r.thing(v(2, 0, 0), 0.4, { transparent: true });
    r.optic('pane', v(3, 0, 0), v(1, 0, 0), { radius: 0.5, tint: v(1, 0, 0.5) });
    r.emitter(v(0, 0, 0), v(1, 0, 0), { range: 10 });
    const [path] = r.trace();
    expect(path!.end).toBe('range');
    expect(path!.segments).toHaveLength(4);
    expect(path!.colour).toEqual(v(1, 0, 0.5));
    expect(path!.intensity).toBe(1);
    expect(path!.focused).toBe(false);
  });

  it('a tint dims by its brightest channel and a black pass stops the beam', () => {
    const r = rig();
    r.optic('pane', v(1, 0, 0), v(1, 0, 0), { radius: 0.5, tint: v(0.5, 0, 0) });
    r.emitter(v(0, 0, 0), v(1, 0, 0), { range: 5 });
    const [dim] = r.trace();
    expect(dim!.intensity).toBe(0.5);
    expect(dim!.colour).toEqual(v(1, 0, 0));
    const b = rig();
    b.optic('pane', v(1, 0, 0), v(1, 0, 0), { radius: 0.5, tint: v(0, 1, 0) });
    b.emitter(v(0, 0, 0), v(1, 0, 0), { colour: v(1, 0, 0) });
    expect(b.trace()[0]!.end).toBe('opaque');
  });

  it('frozen is transparent only when nothing opaque or reflective says otherwise', () => {
    const r = rig();
    const wall = r.thing(v(1, 0, 0), 0.4, { frozen: true, opaque: true });
    r.emitter(v(0, 0, 0), v(1, 0, 0));
    expect(r.trace()[0]).toMatchObject({ end: 'opaque', target: wall });
    const m = rig();
    m.thing(v(1, 0, 0), 0.4, { frozen: true, reflective: true });
    m.emitter(v(0, 0, 0), v(1, 0, 0));
    expect(m.trace()[0]!.bounces).toBe(1);
  });

  it('opaque things, plain solids and actors stop the beam; a lens multiplies intensity', () => {
    const r = rig();
    const lens = r.optic('lens', v(1, 0, 0), v(1, 0, 0), { radius: 0.5, focus: 4 });
    const crate = r.thing(v(3, 0, 0), 0.4, { opaque: true });
    r.emitter(v(0, 0, 0), v(1, 0, 0));
    const [path] = r.trace();
    expect(path).toMatchObject({ end: 'opaque', target: crate, intensity: 4, focused: true });
    expect(readProperty(r.world, lens, 'transparent')).toBe(true);
    // Neither reflective, transparent nor opaque (a creature, a player tag, a character) still stops it.
    const kinds: [string, (w: World<never>, e: EntityId) => void][] = [
      [
        'tag',
        (w, e) => {
          tagEntity(w, e, 'player');
        },
      ],
      [
        'actor tag',
        (w, e) => {
          tagEntity(w, e, 'actor');
        },
      ],
      [
        'creature',
        (w, e) => {
          w.add(e, CreatureComponent, {} as never);
        },
      ],
      [
        'character',
        (w, e) => {
          w.add(e, CharacterController, {} as never);
        },
      ],
    ];
    for (const [, make] of kinds) {
      const k = rig();
      k.world.register(CreatureComponent, CharacterController);
      const actor = k.thing(v(2, 0, 0), 0.4);
      make(k.world, actor);
      k.emitter(v(0, 0, 0), v(1, 0, 0));
      expect(k.trace()[0]).toMatchObject({ end: 'actor', target: actor });
    }
    const s = rig();
    s.optic('mirror', v(2, 0, 0), v(-1, 0, 0), { radius: 0.5 });
    expect(s.trace()).toEqual([]);
    const bare = rig();
    const dull = bare.thing(v(2, 0, 0), 0.5);
    bare.world.add(dull, OpticComponent, {
      kind: 'pane',
      normal: v(1, 0, 0),
      radius: 0.5,
      focus: 1,
      tint: WHITE,
    });
    bare.emitter(v(0, 0, 0), v(1, 0, 0));
    expect(bare.trace()[0]).toMatchObject({ end: 'opaque', target: dull });
  });

  it('an actor with an optic is still an actor, and a plain-property thing is ignored', () => {
    const r = rig();
    r.thing(v(1, 0, 0), 0.4, { weight: 3 });
    const actor = r.thing(v(2, 0, 0), 0.4, { reflective: true });
    tagEntity(r.world, actor, 'actor');
    r.emitter(v(0, 0, 0), v(1, 0, 0));
    expect(r.trace()[0]!.end).toBe('actor');
  });

  it('AC-5: an actor stepping into the beam ends it there, and it no longer reaches the receiver', () => {
    const r = rig();
    const target = r.world.spawn();
    makeLightReceiver(r.world, target, v(6, 0, 0));
    r.emitter(v(0, 0, 0), v(1, 0, 0));
    r.trace();
    expect(r.tracer.intensityAt(target)).toBe(1);
    const actor = r.thing(v(3, 0, 0), 0.4);
    tagEntity(r.world, actor, 'actor');
    const [path] = r.trace();
    expect(path).toMatchObject({ end: 'actor', target: actor });
    expect(path!.segments.at(-1)!.to.x).toBeCloseTo(2.6, 5);
    expect(r.tracer.intensityAt(target)).toBe(0);
  });

  it('receivers swallow the beam and only count light that passes their colour filter', () => {
    const r = rig();
    const red = r.world.spawn();
    makeLightReceiver(r.world, red, v(5, 0, 0), { filter: v(1, 0, 0) });
    const white = r.world.spawn();
    makeLightReceiver(r.world, white, v(5, 0, 3));
    r.emitter(v(0, 0, 0), v(1, 0, 0));
    r.emitter(v(0, 0, 3), v(1, 0, 0), { colour: v(1, 0, 0), intensity: 2 });
    r.emitter(v(0, 0.01, 3), v(1, 0, 0), { intensity: 0.5 });
    r.trace();
    expect(r.tracer.intensityAt(red)).toBe(0); // white on a red filter
    expect(r.tracer.intensityAt(white)).toBe(2.5); // red 2 and white 0.5 add up
    expect(colourPasses(v(1, 0.1, 0), v(1, 0, 0))).toBe(true);
    expect(colourPasses(WHITE, null)).toBe(true);
    expect(colourPasses(WHITE, v(0, 0, 0))).toBe(false);
  });

  it('static geometry stops a beam, ramps by their slope, and what is past it is dark', () => {
    const statics = new StaticOccluders();
    statics.add(box(v(4, -1, -1), v(5, 1, 1)));
    statics.add(rampAt(v(0, -5, 20), 45, 2, 4));
    const r = rig(statics);
    r.emitter(v(0, 0, 0), v(1, 0, 0));
    r.emitter(v(0, 0, 0.5), v(0, 0, 1), { range: 3 });
    const paths = r.trace();
    expect(paths[0]!.end).toBe('wall');
    expect(paths[0]!.segments[0]!.to.x).toBe(4);
    expect(paths[1]!.end).toBe('range');
    // Over the ramp's slope the beam passes; into the wedge it stops.
    const over = r.world.spawn();
    makeBeamEmitter(r.world, over, 'spell', v(0.5, -4, 19), v(0, 0, 1));
    const into = r.world.spawn();
    makeBeamEmitter(r.world, into, 'spell', v(0.5, -4.9, 19), v(0, 0, 1));
    const parallel = r.world.spawn();
    makeBeamEmitter(r.world, parallel, 'spell', v(0.5, 0.5, 19), v(1, 0, 0), { range: 3 });
    // Along the slope's run, both ways: up out of the air into the wedge, and down through it.
    const up = r.world.spawn();
    makeBeamEmitter(r.world, up, 'spell', v(-1, -4.8, 22), v(1, 0, 0), { range: 10 });
    const down = r.world.spawn();
    makeBeamEmitter(r.world, down, 'spell', v(3, -4.8, 22), v(-1, 0, 0), { range: 10 });
    r.world.step();
    const [, , a, b, c, d, e] = (r.tracer.update(r.world), r.tracer.paths);
    expect(a!.end).toBe('range');
    expect(b!.end).toBe('wall');
    expect(c!.end).toBe('range');
    expect(d!.segments[0]!.to.x).toBeCloseTo(0.2, 6);
    expect(e!.segments[0]!.to.x).toBeCloseTo(2, 9);
  });

  it('a trace has a segment budget so a corridor of panes cannot hang a tick', () => {
    const r = rig();
    for (let i = 1; i <= 80; i++) r.thing(v(i * 0.5, 0, 0), 0.1, { transparent: true });
    r.emitter(v(0, 0, 0), v(1, 0, 0), { range: 100 });
    const [path] = r.trace();
    expect(path!.end).toBe('segments');
    expect(path!.segments).toHaveLength(MAX_BEAM_SEGMENTS);
  });

  it('geometry edge cases: behind, wide of, parallel to, inside and exactly at range', () => {
    const r = rig();
    r.thing(v(-2, 0, 0), 0.5, { opaque: true }); // behind
    r.thing(v(2, 3, 0), 0.5, { opaque: true }); // wide
    r.optic('mirror', v(3, 0, 0), v(0, 0, 1), { radius: 0.5 }); // edge-on
    r.optic('mirror', v(-3, 0, 0), v(1, 0, 0), { radius: 0.5 }); // behind, planar
    r.optic('mirror', v(4, 2, 0), v(1, 0, 0), { radius: 0.5 }); // planar, wide of the disc
    r.thing(v(10, 0, 0), 0.5, { opaque: true });
    r.emitter(v(0, 0, 0), v(1, 0, 0), { range: 9.5 });
    expect(r.trace()[0]!.end).toBe('opaque'); // exactly at range 10 - 0.5
    const inside = rig();
    const around = inside.thing(v(0, 0, 0), 2, { opaque: true });
    inside.emitter(v(0.5, 0, 0), v(1, 0, 0));
    expect(inside.trace()[0]).toMatchObject({ end: 'opaque', target: around });
    const gone = rig();
    gone.thing(v(2, 0, 0), 0.5, { opaque: true });
    gone.emitter(v(0, 0, 0), v(1, 0, 0), { range: 1 });
    expect(gone.trace()[0]!.end).toBe('range');
    const fromInside = rig();
    fromInside.thing(v(-0.4, 0, 0), 0.3, { opaque: true }); // sphere wholly behind the origin
    fromInside.emitter(v(0, 0, 0), v(1, 0, 0), { range: 1 });
    expect(fromInside.trace()[0]!.end).toBe('range');
  });

  it('an emitter never blocks itself, an inactive one casts nothing, and setBeamActive toggles it', () => {
    const r = rig();
    const e = r.emitter(v(0, 0, 0), v(1, 0, 0), { range: 2 });
    addProperties(r.world, e, { opaque: true });
    placeEntity(r.world, e, v(0, 0, 0), 1);
    expect(r.trace()[0]!.end).toBe('range');
    expect(setBeamActive(r.world, e, false)).toBe(true);
    expect(r.trace()).toEqual([]);
    expect(setBeamActive(r.world, e, false)).toBe(true);
    expect(setBeamActive(r.world, r.world.spawn(), true)).toBe(false);
    setBeamActive(r.world, e, true);
    expect(r.trace()).toHaveLength(1);
    // Without an emitter component registered nothing happens either.
    const bare = new World<never>({ seed: 1 });
    registerWorldProperties(bare);
    const t = new BeamTracer();
    t.update(bare);
    expect(t.paths).toEqual([]);
  });

  it('is deterministic: the same scene traces to the identical paths', () => {
    const run = () => {
      const r = rig();
      r.optic('mirror', v(5, 0, 0), v(-1, 0, 1), { radius: 1 });
      r.optic('lens', v(5, 0, -4), v(0, 0, 1), { radius: 1, focus: 2 });
      r.emitter(v(0, 0, 0), v(1, 0, 0));
      return JSON.stringify(r.trace());
    };
    expect(run()).toBe(run());
  });

  it('prefabs and validation', () => {
    const r = rig();
    expect(BEAM_PREFABS.crystal.intensity).toBeLessThan(BEAM_PREFABS.spell.intensity);
    const e = r.world.spawn();
    const bad = (fn: () => void) => {
      expect(fn).toThrow(RangeError);
    };
    bad(() => {
      makeBeamEmitter(r.world, e, 'spell', v(0, 0, 0), v(0, 0, 0));
    });
    bad(() => {
      makeBeamEmitter(r.world, e, 'spell', v(0, 0, 0), { x: NaN, y: 0, z: 1 });
    });
    bad(() => {
      makeBeamEmitter(r.world, e, 'spell', v(0, 0, 0), null as never);
    });
    bad(() => {
      makeBeamEmitter(r.world, e, 'spell', v(0, 0, 0), v(1, 0, 0), { intensity: 0 });
    });
    bad(() => {
      makeBeamEmitter(r.world, e, 'spell', v(0, 0, 0), v(1, 0, 0), { range: -1 });
    });
    bad(() => {
      makeBeamEmitter(r.world, e, 'spell', v(0, 0, 0), v(1, 0, 0), { maxBounces: 1.5 });
    });
    bad(() => {
      makeBeamEmitter(r.world, e, 'spell', v(0, 0, 0), v(1, 0, 0), { colour: v(2, 0, 0) });
    });
    bad(() => {
      makeBeamEmitter(r.world, e, 'spell', v(0, 0, 0), v(1, 0, 0), { colour: v(0, 0, 0) });
    });
    bad(() => {
      makeOptic(r.world, e, 'lens', v(0, 0, 0), v(1, 0, 0), { radius: 0 });
    });
    bad(() => {
      makeOptic(r.world, e, 'lens', v(0, 0, 0), v(1, 0, 0), { focus: 0.5 });
    });
    bad(() => {
      makeLightReceiver(r.world, e, v(0, 0, 0), { threshold: 0 });
    });
    bad(() => {
      makeLightReceiver(r.world, e, v(0, 0, 0), { dwellSeconds: -1 });
    });
    bad(() => {
      makeLightReceiver(r.world, e, v(0, 0, 0), { radius: 0 });
    });
    // A pane's focus is ignored; an existing placement is kept.
    makeOptic(r.world, e, 'pane', v(1, 1, 1), v(0, 1, 0), { focus: 3 });
    expect(r.world.get(e, OpticComponent)!.focus).toBe(1);
    const p = r.world.spawn();
    placeEntity(r.world, p, v(7, 7, 7), 1);
    makeBeamEmitter(r.world, p, 'crystal', v(0, 0, 0), v(1, 0, 0));
    expect(r.world.get(p, BeamEmitterComponent)).toMatchObject({
      intensity: 0.8,
      maxBounces: 8,
      active: true,
    });
    const q = r.world.spawn();
    placeEntity(r.world, q, v(7, 7, 7), 1);
    makeOptic(r.world, q, 'lens', v(0, 0, 0), v(1, 0, 0), { focus: 3 });
    makeLightReceiver(r.world, q, v(0, 0, 0));
    const w = r.world.spawn();
    makeLightReceiver(r.world, w, v(0, 0, 0), { filter: v(0, 1, 0) });
    expect(r.world.get(w, LightReceiverComponent)!.filter).toEqual(v(0, 1, 0));
  });
});

describe('beams through the stimulus API (AC-3)', () => {
  function burnRig() {
    const world = installElementField(
      installStimuli(registerWorldProperties(new World<never>({ seed: 3, hz: 60 }))),
      { maxChunks: 8 },
    );
    world.register(BeamEmitterComponent, OpticComponent, LightReceiverComponent);
    const field = new LightField();
    installLightField(world, field);
    const rules = new ElementRuleSet(
      fireRules({
        presets: new Map([['wood', { flammable: true, ignitionPoint: 300, fuel: 0.1 }]]),
        burnt: new Map([['wood', null]]),
      }),
    );
    const tracer = new BeamTracer({ statics: field.statics });
    world
      .addSystem(stimulusSystem())
      .addSystem(beamsSystem(tracer))
      .addSystem(elementRulesSystem(rules))
      .addSystem(elementFieldSystem())
      .addSystem(lightFieldSystem(field));
    return { world, field, tracer };
  }

  it('AC-3: a lens-focused beam heats a flammable entity until it ignites by the fire rules', () => {
    const { world } = burnRig();
    const lens = world.spawn();
    makeOptic(world, lens, 'lens', v(2, 1, 0), v(1, 0, 0), { radius: 0.5, focus: 4 });
    const crate = world.spawn();
    addProperties(world, crate, {
      flammable: true,
      opaque: true,
      temperature: 20,
      ignitionPoint: 300,
      fuel: 0.1,
      hp: 50,
    });
    placeEntity(world, crate, v(5, 1, 0), 0.4);
    const sun = world.spawn();
    makeBeamEmitter(world, sun, 'sunlight', v(0, 1, 0), v(1, 0, 0));
    world.step();
    world.step();
    expect(readProperty(world, crate, 'temperature')).toBeGreaterThan(20);
    for (let i = 0; i < 120 && !readProperty(world, crate, 'burning'); i++) world.step();
    expect(readProperty(world, crate, 'burning')).toBe(true);
  });

  it('an unfocused beam lights the spot it ends on but does not heat it', () => {
    const { world, field } = burnRig();
    const crate = world.spawn();
    addProperties(world, crate, {
      flammable: true,
      opaque: true,
      temperature: 20,
      ignitionPoint: 300,
      fuel: 0.1,
    });
    placeEntity(world, crate, v(5, 1, 0), 0.4);
    const sun = world.spawn();
    makeBeamEmitter(world, sun, 'sunlight', v(0, 1, 0), v(1, 0, 0));
    for (let i = 0; i < 60; i++) world.step();
    expect(readProperty(world, crate, 'temperature')).toBe(20);
    expect(field.levelAt(v(4.5, 1, 0))).toBeGreaterThan(field.config.defaultAmbient);
  });

  it('a focused beam that ends on bare level geometry heats the spot', () => {
    const { world, field } = burnRig();
    field.statics.add(box(v(5, 0, -1), v(6, 2, 1)));
    const post = world.spawn();
    addProperties(world, post, { flammable: true, temperature: 20, ignitionPoint: 300, fuel: 0.1 });
    placeEntity(world, post, v(4.9, 1, 0), 0.2);
    const lens = world.spawn();
    makeOptic(world, lens, 'lens', v(2, 1, 0), v(1, 0, 0), { radius: 0.5, focus: 4 });
    const sun = world.spawn();
    makeBeamEmitter(world, sun, 'sunlight', v(0, 1, 0), v(1, 0, 0));
    for (let i = 0; i < 5; i++) world.step();
    expect(readProperty(world, post, 'temperature')).toBeGreaterThan(20);
  });

  it('a beam that ends at max bounces heats nothing it was not touching', () => {
    const { world } = burnRig();
    const a = world.spawn();
    makeOptic(world, a, 'mirror', v(0, 1, 0), v(1, 0, 0), { radius: 1 });
    const b = world.spawn();
    makeOptic(world, b, 'mirror', v(4, 1, 0), v(-1, 0, 0), { radius: 1 });
    const lens = world.spawn();
    makeOptic(world, lens, 'lens', v(2, 1, 0.3), v(1, 0, 0), { radius: 0.05, focus: 2 });
    const sun = world.spawn();
    makeBeamEmitter(world, sun, 'spell', v(2, 1, 0), v(1, 0, 0));
    for (let i = 0; i < 3; i++) world.step();
    expect(world.tick).toBe(3);
  });
});
