import { describe, expect, it } from 'vitest';
import { SOUND_MANIFEST } from '@audio/sounds';
import { compileElementFeedback, loadGameContent } from '@content/index';
import {
  propertyChanged,
  registerWorldProperties,
  World,
  type EntityId,
  type Vec3,
} from '@sim/index';
import { ElementFeedbackBridge, type ElementBounds } from './element-feedback.ts';
import type { VfxSpawnOptions } from './system.ts';

const content = loadGameContent();
const table = compileElementFeedback(content.get('element-feedback', 'element-feedback'));
const CAMERA: Vec3 = { x: 0, y: 0, z: 0 };

function setup(
  over: { reduced?: boolean; bounds?: (e: EntityId) => ElementBounds | undefined } = {},
) {
  const world = registerWorldProperties(new World({ seed: 1 }));
  const spawns: { effect: string; options: VfxSpawnOptions; handle: number }[] = [];
  const stopped: number[] = [];
  const live = new Set<number>();
  const cues: [string, EntityId][] = [];
  const places = new Map<EntityId, ElementBounds>();
  let next = 1;
  const bridge = new ElementFeedbackBridge({
    table,
    vfx: {
      spawn: (effect, options) => {
        const handle = next++;
        spawns.push({ effect, options, handle });
        live.add(handle);
        return handle;
      },
      stop: (handle) => {
        stopped.push(handle);
        live.delete(handle);
      },
      alive: (handle) => live.has(handle),
    },
    events: world.events,
    isAlive: (entity) => world.isAlive(entity),
    boundsOf: over.bounds ?? ((entity) => places.get(entity)),
    reducedMotion: () => over.reduced ?? false,
    playCue: (cue, entity) => cues.push([cue, entity]),
  });
  bridge.attach();
  const thing = (distance = 5, radius = 0.4): EntityId => {
    const entity = world.spawn();
    places.set(entity, { position: { x: distance, y: 0, z: 0 }, radius });
    return entity;
  };
  const change = (
    entity: EntityId,
    key: 'burning' | 'wetness' | 'frozen' | 'charge',
    value: boolean | number,
  ) => {
    world.events.emit(propertyChanged, {
      entity,
      key,
      old: false,
      new: value,
      source: null,
    } as never);
  };
  const flush = () => {
    world.events.flush();
  };
  return { world, bridge, spawns, stopped, live, cues, places, thing, change, flush };
}

describe('element feedback bridge (mw-e03.28)', () => {
  it('every audioCue in the shipped table is a cue in the sound manifest (none exist yet)', () => {
    const ids = new Set(SOUND_MANIFEST.map((s) => s.id));
    for (const state of table.states) {
      if (state.audioCue !== undefined) expect(ids.has(state.audioCue)).toBe(true);
    }
  });

  it('AC-1: gaining burning requests exactly one fire effect sized to its bounds, released when it stops', () => {
    const s = setup();
    const crate = s.thing(5, 0.5);
    s.change(crate, 'burning', true);
    s.change(crate, 'burning', true); // a repeat changes nothing
    s.flush();
    s.bridge.update(CAMERA);
    s.bridge.update(CAMERA);
    expect(s.spawns).toHaveLength(1);
    expect(s.spawns[0]).toMatchObject({
      effect: 'vfx-fire-burn-loop',
      options: { entity: crate, scale: 2, params: { intensity: 1 } }, // 0.5 m over a 0.25 m reference
    });
    expect(s.stopped).toEqual([]);
    s.change(crate, 'burning', false);
    s.flush();
    s.bridge.update(CAMERA);
    expect(s.stopped).toEqual([s.spawns[0]?.handle]);
    expect(s.bridge.stats()).toMatchObject({ entities: 0, wanted: 0, live: 0 });
  });

  it('wet, frozen and charged map by property and value; a thing can be in several states', () => {
    const s = setup();
    const pot = s.thing();
    s.change(pot, 'wetness', 0.2); // below the wet threshold
    s.change(pot, 'frozen', true);
    s.change(pot, 'charge', 3);
    s.flush();
    s.bridge.update(CAMERA);
    expect(s.spawns.map((x) => x.effect).sort()).toEqual([
      'vfx-element-charge-arc',
      'vfx-element-frost-glint',
    ]);
    s.change(pot, 'wetness', 0.9);
    s.flush();
    s.bridge.update(CAMERA);
    expect(s.spawns.map((x) => x.effect)).toContain('vfx-element-wet-drip');
    expect(s.bridge.stats().perState).toEqual({ wet: 1, frozen: 1, charged: 1 });
    // Wetness rising further, or a property the table does not know, changes nothing.
    const before = s.spawns.length;
    s.change(pot, 'wetness', 1);
    s.world.events.emit(propertyChanged, {
      entity: pot,
      key: 'weight',
      old: 1,
      new: 2,
      source: null,
    } as never);
    s.flush();
    s.bridge.update(CAMERA);
    expect(s.spawns).toHaveLength(before);
  });

  it('scale is clamped, and reduced motion thins the strobing charge arcs', () => {
    const s = setup({ reduced: true });
    const big = s.thing(5, 40);
    const tiny = s.thing(6, 0.01);
    s.change(big, 'charge', 5);
    s.change(tiny, 'burning', true);
    s.flush();
    s.bridge.update(CAMERA);
    const by = (e: EntityId) => s.spawns.find((x) => x.options.entity === e)?.options;
    expect(by(big)).toMatchObject({ scale: 3, params: { intensity: 0.25 } });
    expect(by(tiny)).toMatchObject({ scale: 0.6, params: { intensity: 1 } });
  });

  it('AC-2: 200 ignitions in one tick keep the 64 nearest, deterministically, and the rest are culled', () => {
    const run = () => {
      const s = setup();
      // Distances 1..100 each twice, so every pair ties and the entity id breaks it.
      const things = Array.from({ length: 200 }, (_, i) => s.thing(1 + Math.floor(i / 2)));
      for (const entity of things) s.change(entity, 'burning', true);
      s.flush();
      s.bridge.update(CAMERA);
      const kept = s.spawns.flatMap((x) =>
        x.options.entity === undefined ? [] : [x.options.entity],
      );
      return { s, things, kept };
    };
    const a = run();
    expect(a.kept).toHaveLength(64);
    expect(a.s.bridge.stats()).toMatchObject({ wanted: 200, live: 64, culled: 136 });
    // The nearest 64 are things[0..63] (32 distances, two each).
    expect([...a.kept].sort((x, y) => x - y)).toEqual(a.things.slice(0, 64));
    // The same input gives the same choice in the same order.
    expect(run().kept).toEqual(a.kept);
  });

  it('AC-2: a culled thing gets its effect when the camera moves toward it, and hysteresis stops swapping at ties', () => {
    const s = setup();
    const near = Array.from({ length: 64 }, () => s.thing(5));
    const far = s.thing(30);
    for (const e of [...near, far]) s.change(e, 'burning', true);
    s.flush();
    s.bridge.update(CAMERA);
    expect(s.spawns).toHaveLength(64);
    expect(s.spawns.some((x) => x.options.entity === far)).toBe(false);
    // Camera walks to the far one: it is now nearest and displaces the farthest of the rest.
    s.bridge.update({ x: 30, y: 0, z: 0 });
    expect(s.spawns.some((x) => x.options.entity === far)).toBe(true);
    expect(s.bridge.stats().live).toBe(64);
    // A frame later with the camera still: nothing respawns.
    const count = s.spawns.length;
    s.bridge.update({ x: 30, y: 0, z: 0.1 });
    expect(s.spawns).toHaveLength(count);
  });

  it('a destroyed entity is dropped and its effect released; one with no bounds gets no effect', () => {
    const s = setup();
    const doomed = s.thing();
    const ghost = s.world.spawn(); // no bounds at all
    s.change(doomed, 'burning', true);
    s.change(ghost, 'burning', true);
    s.flush();
    s.bridge.update(CAMERA);
    expect(s.spawns).toHaveLength(1);
    s.world.destroy(doomed);
    s.bridge.update(CAMERA);
    expect(s.stopped).toHaveLength(1);
    expect(s.bridge.stats().entities).toBe(1);
    expect(s.bridge.looks().has(doomed)).toBe(false);
  });

  it('an entity can lose a state that was never given a handle, and a refused spawn is retried', () => {
    const refusals = { on: true };
    const world = registerWorldProperties(new World({ seed: 1 }));
    const spawned: number[] = [];
    const bridge = new ElementFeedbackBridge({
      table,
      vfx: {
        spawn: () => (refusals.on ? null : spawned.push(1)),
        stop: () => undefined,
        alive: () => true,
      },
      events: world.events,
      isAlive: () => true,
      boundsOf: () => ({ position: { x: 1, y: 0, z: 0 }, radius: 0 }),
      reducedMotion: () => false,
    });
    bridge.attach();
    const e = world.spawn();
    world.events.emit(propertyChanged, {
      entity: e,
      key: 'burning',
      old: false,
      new: true,
      source: null,
    });
    world.events.flush();
    bridge.update(CAMERA);
    expect(bridge.stats()).toMatchObject({ wanted: 1, live: 0 });
    refusals.on = false;
    world.events.emit(propertyChanged, {
      entity: e,
      key: 'frozen',
      old: false,
      new: true,
      source: null,
    });
    world.events.flush();
    bridge.update(CAMERA);
    expect(spawned).toHaveLength(2); // both states spawn now: radius 0 falls back to the min scale
    world.events.emit(propertyChanged, {
      entity: e,
      key: 'frozen',
      old: true,
      new: false,
      source: null,
    });
    world.events.flush();
    expect(bridge.stats().wanted).toBe(1);
  });

  it('a state with no look draws its effect but leaves the mesh alone', () => {
    const world = registerWorldProperties(new World({ seed: 1 }));
    const bare = {
      ...table,
      states: table.states.map((st) => ({ ...st, look: undefined })),
    };
    const bridge = new ElementFeedbackBridge({
      table: bare,
      vfx: { spawn: () => 1, stop: () => undefined, alive: () => true },
      events: world.events,
      isAlive: () => true,
      boundsOf: () => ({ position: { x: 1, y: 0, z: 0 }, radius: 0.3 }),
      reducedMotion: () => false,
    });
    bridge.attach();
    world.events.emit(propertyChanged, {
      entity: world.spawn(),
      key: 'burning',
      old: false,
      new: true,
      source: null,
    });
    world.events.flush();
    expect(bridge.stats().wanted).toBe(1);
    expect(bridge.looks().size).toBe(0);
  });

  it('looks combine for the states an entity is in and clear when it leaves them', () => {
    const s = setup();
    const pot = s.thing();
    s.change(pot, 'wetness', 1);
    s.flush();
    const wet = s.bridge.looks().get(pot);
    expect(wet?.roughness).toBeLessThan(0.3);
    s.change(pot, 'frozen', true);
    s.flush();
    expect(s.bridge.looks().get(pot)?.roughness).toBeLessThanOrEqual(0.08);
    s.change(pot, 'wetness', 0);
    s.change(pot, 'frozen', false);
    s.flush();
    expect(s.bridge.looks().has(pot)).toBe(false);
  });

  it('plays a state’s audio cue where it is entered, when the table names one', () => {
    const world = registerWorldProperties(new World({ seed: 1 }));
    const cues: string[] = [];
    const withCue = compileElementFeedback(content.get('element-feedback', 'element-feedback'));
    const patched = {
      ...withCue,
      states: withCue.states.map((st) =>
        st.id === 'frozen' ? { ...st, audioCue: 'sfx-test' } : st,
      ),
    };
    new ElementFeedbackBridge({
      table: patched,
      vfx: { spawn: () => null, stop: () => undefined, alive: () => false },
      events: world.events,
      isAlive: () => true,
      boundsOf: () => undefined,
      reducedMotion: () => false,
      playCue: (cue) => cues.push(cue),
    }).attach();
    const e = world.spawn();
    for (const key of ['frozen', 'burning'] as const) {
      world.events.emit(propertyChanged, { entity: e, key, old: false, new: true, source: null });
    }
    world.events.flush();
    expect(cues).toEqual(['sfx-test']);
    // Without a cue sink the cue is simply not played.
    const quiet = registerWorldProperties(new World({ seed: 1 }));
    new ElementFeedbackBridge({
      table: patched,
      vfx: { spawn: () => null, stop: () => undefined, alive: () => false },
      events: quiet.events,
      isAlive: () => true,
      boundsOf: () => undefined,
      reducedMotion: () => false,
    }).attach();
    quiet.events.emit(propertyChanged, {
      entity: quiet.spawn(),
      key: 'frozen',
      old: false,
      new: true,
      source: null,
    });
    quiet.events.flush();
  });
});
