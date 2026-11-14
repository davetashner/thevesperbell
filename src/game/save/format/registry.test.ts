// Whole-world save and load through the section registry (mw-e30.1 AC-1…AC-6).
import {
  defineComponent,
  encodeCanonical,
  hashWorld,
  Rng,
  World,
  type ComponentType,
  type EntityId,
} from '@sim/index';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  decodeSave,
  encodeSave,
  MissingMigrationError,
  SaveApplyError,
  SaveCorruptError,
  SaveFromNewerBuildError,
  SaveRegistry,
  SaveSectionInvalidError,
  WORLD_SECTION_ID,
  type SaveSection,
} from './index';

interface Vec {
  x: number;
  y: number;
}
const Position = defineComponent<Vec>('Position');
const Health = defineComponent<number>('Health');
const Bag = defineComponent<{ items: string[] }>('Bag');
const Name = defineComponent<string>('Name'); // claimed by no section: saved with the world

/** Any number, non-finite included (z.number() rejects NaN and ±Infinity). */
const anyNumber = z.custom<number>((v) => typeof v === 'number');

const build = { gameVersion: '0.1.0', buildSha: 'deadbee', contentHash: 'c0ffee' };
const options = { build, wallClockSavedAt: 1_790_000_000_000 };

/** A section that saves one component's rows itself. */
function componentSection<T>(
  id: string,
  type: ComponentType<T>,
  value: z.ZodType<T>,
): SaveSection<[EntityId, T][]> {
  return {
    id,
    version: 1,
    schema: z.array(z.tuple([z.number(), value])),
    components: [type],
    serialize: (world) => {
      const rows: [EntityId, T][] = [];
      world.query(type).forEach((entity, v) => rows.push([entity, structuredClone(v)]));
      return rows;
    },
    deserialize: (world, rows) => {
      for (const [entity, v] of rows) world.add(entity, type, v);
    },
  };
}

/** The three sections of AC-1. */
function threeSections(): SaveRegistry {
  return new SaveRegistry()
    .register(componentSection('positions', Position, z.object({ x: z.number(), y: z.number() })))
    .register(componentSection('health', Health, anyNumber))
    .register(componentSection('bags', Bag, z.object({ items: z.array(z.string()) })));
}

function freshWorld(): World {
  return new World({ seed: 0 }).register(Position, Health, Bag, Name);
}

/** A random world: spawns, destroys, every component kind, RNG streams advanced by a system. */
function randomWorld(seed: number): World {
  const rng = Rng.create(seed);
  const world = new World({ seed, hz: rng.chance(0.5) ? 60 : 30 }).register(
    Position,
    Health,
    Bag,
    Name,
  );
  world.addSystem({
    name: 'wander',
    run: ({ world: w }) => {
      w.query(Position).forEach((_, p) => {
        p.x += w.random('wander').float() - 0.5;
      });
    },
  });
  const ids: EntityId[] = [];
  for (let i = rng.int(1, 40); i > 0; i--) {
    const id = world.spawn();
    ids.push(id);
    if (rng.chance(0.7)) world.add(id, Position, { x: rng.float() * 100, y: -0 });
    if (rng.chance(0.5)) world.add(id, Health, rng.chance(0.1) ? Infinity : rng.int(0, 100));
    if (rng.chance(0.3)) world.add(id, Bag, { items: ['rope', 'é漢😀'].slice(rng.int(0, 2)) });
    if (rng.chance(0.4)) world.add(id, Name, `n${String(rng.nextU32())}`);
  }
  for (const id of ids) if (rng.chance(0.2)) world.destroy(id);
  for (let t = rng.int(0, 5); t > 0; t--) world.step();
  world.random('loot').int(0, 9);
  return world;
}

const errorOf = (result: ReturnType<SaveRegistry['read']>): unknown =>
  result.ok ? undefined : result.error;

describe('SaveRegistry', () => {
  it('AC-1: a world with 3 registered sections loads into a fresh world with the same state hash', () => {
    const registry = threeSections();
    const world = randomWorld(7);
    const bytes = registry.write(world, options);
    const loaded = freshWorld();
    const result = registry.read(loaded, bytes);
    expect(result).toMatchObject({ ok: true, warnings: [], unknownSections: {} });
    expect(hashWorld(loaded)).toBe(hashWorld(world));
    expect(loaded.snapshot()).toEqual(world.snapshot());
  });

  it('capture serializes now: bytes encoded after the world changed hold the world as captured (mw-e01.21)', () => {
    const registry = threeSections();
    const world = randomWorld(11);
    const hash = hashWorld(world);
    const captured = registry.capture(world);
    world.step();
    world.step();
    const loaded = freshWorld();
    expect(registry.read(loaded, captured.encode(options)).ok).toBe(true);
    expect(hashWorld(loaded)).toBe(hash);
    expect(hashWorld(world)).not.toBe(hash);
  });

  it('AC-1: saves owned components only in their own section', () => {
    const decoded = decodeSave(threeSections().write(randomWorld(3), options));
    const sections = decoded.ok ? decoded.envelope.sections : {};
    expect(Object.keys(sections).sort()).toEqual(['bags', 'health', 'positions', 'world']);
    const world = sections[WORLD_SECTION_ID]?.data as { components: Record<string, unknown> };
    expect(Object.keys(world.components)).toEqual(['Name']);
  });

  it('round-trips 25 random worlds to identical state hashes (property)', () => {
    const registry = threeSections();
    const mismatches: number[] = [];
    for (let seed = 1; seed <= 25; seed++) {
      const world = randomWorld(seed);
      const loaded = freshWorld();
      const result = registry.read(loaded, registry.write(world, options));
      if (!result.ok || hashWorld(loaded) !== hashWorld(world)) mismatches.push(seed);
    }
    expect(mismatches).toEqual([]);
  });

  it('records build info, tick, wall-clock time and metadata in the envelope', () => {
    const world = randomWorld(9);
    const bytes = threeSections().write(world, { ...options, metadata: { area: 'testbed-arena' } });
    expect(decodeSave(bytes)).toMatchObject({
      ok: true,
      envelope: {
        ...build,
        createdAtTick: world.tick,
        wallClockSavedAt: options.wallClockSavedAt,
        metadata: { area: 'testbed-arena' },
      },
    });
    const bare = decodeSave(threeSections().write(world, options));
    expect(bare.ok && bare.envelope.metadata).toEqual({});
  });

  it('AC-2: migrates a v1 section to v3 (1→2, 2→3) and applies data valid under the v3 schema', () => {
    const v1: SaveSection<{ hp: number }> = {
      id: 'vitals',
      version: 1,
      schema: z.object({ hp: z.number() }),
      serialize: () => ({ hp: 12 }),
      deserialize: () => undefined,
    };
    const bytes = new SaveRegistry().register(v1).write(freshWorld(), options);

    const order: string[] = [];
    let applied: unknown;
    const v3: SaveSection<{ health: { current: number; max: number } }> = {
      id: 'vitals',
      version: 3,
      schema: z.strictObject({ health: z.strictObject({ current: z.number(), max: z.number() }) }),
      migrations: {
        1: (d) => {
          order.push('1→2');
          return { health: (d as { hp: number }).hp };
        },
        2: (d) => {
          order.push('2→3');
          return { health: { current: (d as { health: number }).health, max: 20 } };
        },
      },
      serialize: () => ({ health: { current: 0, max: 0 } }),
      deserialize: (_, data) => {
        applied = data;
      },
    };
    const result = new SaveRegistry().register(v3).read(freshWorld(), bytes);
    expect(result.ok).toBe(true);
    expect(order).toEqual(['1→2', '2→3']);
    expect(applied).toEqual({ health: { current: 12, max: 20 } });
  });

  it('AC-3: a save whose checksum does not match its sections returns SaveCorruptError and leaves the world untouched', () => {
    const registry = threeSections();
    const bytes = registry.write(randomWorld(4), options);
    bytes.set([(bytes.at(-20) ?? 0) ^ 0x40], bytes.length - 20);
    const target = randomWorld(5);
    const before = hashWorld(target);
    const error = errorOf(registry.read(target, bytes));
    expect(error).toBeInstanceOf(SaveCorruptError);
    expect(hashWorld(target)).toBe(before);
  });

  it('AC-4: loads a save with an unknown section, warns about it, and preserves it verbatim on re-save', () => {
    const newer = threeSections().register({
      id: 'reputation',
      version: 4,
      schema: z.record(z.string(), anyNumber),
      serialize: () => ({ guild: -0, temple: NaN }),
      deserialize: () => undefined,
    });
    const world = randomWorld(11);
    const saved = newer.write(world, options);

    const older = threeSections();
    const loaded = freshWorld();
    const result = older.read(loaded, saved);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([
      expect.objectContaining({ kind: 'unknown-section', section: 'reputation' }),
    ]);
    expect(result.warnings[0]?.message).toMatch(/"reputation" \(v4\) is not known/);
    expect(hashWorld(loaded)).toBe(hashWorld(world));

    const resaved = older.write(loaded, { ...options, preserve: result.unknownSections });
    const original = decodeSave(saved);
    const again = decodeSave(resaved);
    const section = (r: typeof original): Uint8Array =>
      encodeCanonical(r.ok ? r.envelope.sections['reputation'] : null);
    expect(section(again)).toEqual(section(original));
    expect(resaved).toEqual(saved);
  });

  it('AC-4: a registered section wins over a preserved section with the same id', () => {
    const registry = threeSections();
    const world = randomWorld(12);
    const bytes = registry.write(world, {
      ...options,
      preserve: { health: { version: 9, data: 'stale' } },
    });
    expect(bytes).toEqual(registry.write(world, options));
  });

  it('AC-5: a missing migration step returns MissingMigrationError naming section and versions', () => {
    const v1: SaveSection<number> = {
      id: 'vitals',
      version: 1,
      schema: z.number(),
      serialize: () => 1,
      deserialize: () => undefined,
    };
    const bytes = new SaveRegistry().register(v1).write(freshWorld(), options);
    const target = randomWorld(2);
    const before = hashWorld(target);
    const result = new SaveRegistry()
      .register({ ...v1, version: 3, migrations: { 2: (d) => d } })
      .read(target, bytes);
    const error = errorOf(result);
    expect(error).toBeInstanceOf(MissingMigrationError);
    expect(error).toMatchObject({ section: 'vitals', from: 1, to: 2 });
    expect((error as Error).message).toBe('section "vitals" has no migration from v1 to v2');
    expect(hashWorld(target)).toBe(before);
  });

  it('AC-6: refuses a save from a newer saveSchemaVersion with SaveFromNewerBuildError', () => {
    const bytes = threeSections().write(randomWorld(6), options);
    new DataView(bytes.buffer).setUint16(6, 999);
    const target = freshWorld();
    const before = hashWorld(target);
    const error = errorOf(threeSections().read(target, bytes));
    expect(error).toBeInstanceOf(SaveFromNewerBuildError);
    expect(error).toMatchObject({ part: 'schema', found: 999 });
    expect(hashWorld(target)).toBe(before);
  });

  it('refuses a section written by a newer build', () => {
    const section: SaveSection<number> = {
      id: 'vitals',
      version: 2,
      schema: z.number(),
      serialize: () => 1,
      deserialize: () => undefined,
    };
    const bytes = new SaveRegistry().register(section).write(freshWorld(), options);
    const error = errorOf(
      new SaveRegistry().register({ ...section, version: 1 }).read(freshWorld(), bytes),
    );
    expect(error).toMatchObject({ kind: 'newer-build', part: 'section', section: 'vitals' });
  });

  it('warns about a registered section missing from the save and loads the rest', () => {
    const bytes = new SaveRegistry().write(randomWorld(8), options);
    let called = false;
    const result = new SaveRegistry()
      .register({
        id: 'quests',
        version: 1,
        schema: z.array(z.string()),
        serialize: () => [],
        deserialize: () => {
          called = true;
        },
      })
      .read(freshWorld(), bytes);
    expect(result).toMatchObject({
      ok: true,
      warnings: [{ kind: 'missing-section', section: 'quests' }],
    });
    expect(called).toBe(false);
  });

  it('reports a save without a world section as corrupt', () => {
    const bytes = encodeSave({
      ...build,
      createdAtTick: 0,
      wallClockSavedAt: 0,
      metadata: {},
      sections: {},
    });
    const error = errorOf(new SaveRegistry().read(freshWorld(), bytes));
    expect(error).toBeInstanceOf(SaveCorruptError);
    expect((error as Error).message).toMatch(/world section is missing/);
  });

  it('rejects migrated data that fails the current schema', () => {
    const v1: SaveSection<number> = {
      id: 'vitals',
      version: 1,
      schema: z.number(),
      serialize: () => 1,
      deserialize: () => undefined,
    };
    const bytes = new SaveRegistry().register(v1).write(freshWorld(), options);
    const error = errorOf(
      new SaveRegistry()
        .register({ ...v1, version: 2, migrations: { 1: () => 'not a number' } })
        .read(freshWorld(), bytes),
    );
    expect(error).toBeInstanceOf(SaveSectionInvalidError);
    expect(error).toMatchObject({ section: 'vitals', version: 2 });
  });

  it('rolls the world back and returns SaveApplyError when a section fails to apply', () => {
    const boom = new Error('boom');
    const registry = threeSections().register({
      id: 'fragile',
      version: 1,
      schema: z.null(),
      serialize: () => null,
      deserialize: () => {
        throw boom;
      },
    });
    const bytes = registry.write(randomWorld(13), options);
    const target = randomWorld(14);
    const before = target.snapshot();
    const error = errorOf(registry.read(target, bytes));
    expect(error).toBeInstanceOf(SaveApplyError);
    expect(error).toMatchObject({ section: 'fragile', cause: boom });
    expect(target.snapshot()).toEqual(before);
  });

  it('mw-e23.11: afterRead runs once every section applied, and a throw rolls the load back', () => {
    const seen: number[] = [];
    const sections = (afterRead: (world: World) => void) =>
      new SaveRegistry({ afterRead })
        .register(
          componentSection('positions', Position, z.object({ x: z.number(), y: z.number() })),
        )
        .register(componentSection('health', Health, anyNumber))
        .register(componentSection('bags', Bag, z.object({ items: z.array(z.string()) })));
    const source = randomWorld(21);
    const bytes = sections(() => undefined).write(source, options);
    const target = freshWorld();
    const loaded = sections((world) => {
      seen.push(world.query(Position).ids().length);
    }).read(target, bytes);
    expect(loaded).toMatchObject({ ok: true });
    expect(seen).toEqual([source.query(Position).ids().length]);

    const boom = new Error('late');
    const failing = freshWorld();
    const before = failing.snapshot();
    const error = errorOf(
      sections(() => {
        throw boom;
      }).read(failing, bytes),
    );
    expect(error).toBeInstanceOf(SaveApplyError);
    expect(error).toMatchObject({ section: 'after-read', cause: boom });
    expect(failing.snapshot()).toEqual(before);
  });

  it('checks a save without touching any world: everything but apply', () => {
    const registry = threeSections().register({
      id: 'fragile',
      version: 1,
      schema: z.null(),
      serialize: () => null,
      deserialize: () => {
        throw new Error('boom');
      },
    });
    const bytes = registry.write(randomWorld(16), options);
    const checked = registry.check(bytes);
    expect(checked.ok && checked.envelope.wallClockSavedAt).toBe(options.wallClockSavedAt);
    const damaged = bytes.slice();
    damaged[damaged.length - 1] = (damaged[damaged.length - 1] ?? 0) ^ 0xff;
    expect(registry.check(damaged)).toMatchObject({ ok: false, error: { kind: 'corrupt' } });
  });

  it('returns SaveApplyError for the world section when the target world lacks a component type', () => {
    const bytes = threeSections().write(randomWorld(15), options);
    const bare = new World({ seed: 1 }).register(Position, Health, Bag);
    const error = errorOf(threeSections().read(bare, bytes));
    expect(error).toMatchObject({ kind: 'apply-failed', section: WORLD_SECTION_ID });
  });

  it('refuses to write data a section schema rejects', () => {
    const registry = new SaveRegistry().register({
      id: 'vitals',
      version: 1,
      schema: z.number(),
      serialize: () => 'oops' as unknown as number,
      deserialize: () => undefined,
    });
    expect(() => registry.write(freshWorld(), options)).toThrow(SaveSectionInvalidError);
  });

  it('lists sections in apply order, world first', () => {
    expect(threeSections().sections.map((s) => s.id)).toEqual([
      'world',
      'positions',
      'health',
      'bags',
    ]);
  });

  it('rejects duplicate section ids, including the built-in world section', () => {
    const section = componentSection(
      'positions',
      Position,
      z.object({ x: z.number(), y: z.number() }),
    );
    expect(() => threeSections().register({ ...section, components: [] })).toThrow(
      /"positions" is already registered/,
    );
    expect(() => new SaveRegistry().register({ ...section, id: 'world' })).toThrow(
      /"world" is already registered/,
    );
  });

  it('rejects a component claimed by two sections', () => {
    const other = componentSection('other', Health, z.number());
    expect(() => threeSections().register(other)).toThrow(
      /component "Health" is already saved by section "health"/,
    );
    // Nothing from the rejected section is left behind.
    expect(threeSections().sections).toHaveLength(4);
  });

  it('rejects a malformed section definition', () => {
    expect(() =>
      new SaveRegistry().register({ ...componentSection('x', Health, z.number()), version: 0 }),
    ).toThrow(RangeError);
  });
});

describe('section load hooks (mw-e27.4)', () => {
  /** A section that owns the world's facts, recording what its hooks saw. */
  function factsSection(seen: string[]): SaveSection<Record<string, boolean>> {
    return {
      id: 'facts',
      version: 1,
      schema: z.record(z.string(), z.boolean()),
      ownsFacts: true,
      serialize: (world) => Object.fromEntries(world.facts.entries()) as Record<string, boolean>,
      deserialize: (world, facts, context) => {
        seen.push(`deserialize ${JSON.stringify(context.worldFacts ?? null)}`);
        context.warn('dropped one');
        world.facts.prepareRestore({ ...context.worldFacts, ...facts })();
      },
      missing: (world, context) => {
        seen.push(`missing ${JSON.stringify(context.worldFacts ?? null)}`);
        world.facts.prepareRestore(context.worldFacts)();
      },
    };
  }

  it('a facts-owning section takes the facts out of the world section and restores them', () => {
    const seen: string[] = [];
    const registry = new SaveRegistry().register(factsSection(seen));
    const world = new World({ seed: 2 });
    world.facts.set('gate.open', true);
    const bytes = registry.write(world, options);
    const decoded = decodeSave(bytes);
    expect(decoded.ok && decoded.envelope.sections[WORLD_SECTION_ID]?.data).not.toHaveProperty(
      'facts',
    );
    expect(decoded.ok && decoded.envelope.sections['facts']?.data).toEqual({ 'gate.open': true });
    const target = new World({ seed: 9 });
    const result = registry.read(target, bytes);
    expect(result.ok && result.warnings).toEqual([
      { kind: 'recovered', section: 'facts', message: 'dropped one' },
    ]);
    expect(seen).toEqual(['deserialize null']);
    expect(hashWorld(target)).toBe(hashWorld(world));
  });

  it('an older save keeps its facts in the world section; the missing hook gets them, unwarned', () => {
    const world = new World({ seed: 2 });
    world.facts.set('gate.open', true);
    const old = new SaveRegistry().write(world, options);
    const seen: string[] = [];
    const target = new World({ seed: 9 });
    target.facts.set('stale.fact', false);
    const result = new SaveRegistry().register(factsSection(seen)).read(target, old);
    expect(result.ok && result.warnings).toEqual([]);
    expect(seen).toEqual(['missing {"gate.open":true}']);
    expect(target.facts.snapshot()).toEqual({ 'gate.open': true });
  });

  it('allows one facts-owning section per registry', () => {
    const registry = new SaveRegistry().register(factsSection([]));
    expect(() => registry.register({ ...factsSection([]), id: 'more-facts' })).toThrow(
      'world facts are already saved by section "facts"',
    );
  });
});

describe('component types registered on first use (mw-e01.7)', () => {
  const Class = defineComponent<string>('Class');
  const Stats = defineComponent<number>('Stats');

  it('a save holding an on-demand type the world has not registered yet registers it and loads', () => {
    const saved = new World({ seed: 3 }).register(Name);
    const hero = saved.spawn();
    saved.add(hero, Name, 'hero');
    saved.register(Class); // chosen mid-game: registered only then
    saved.add(hero, Class, 'thief');
    const registry = new SaveRegistry({ onDemand: [Class, Stats] });
    const bytes = registry.write(saved, options);

    const fresh = new World({ seed: 3 }).register(Name);
    fresh.spawn();
    expect(registry.read(fresh, bytes)).toMatchObject({ ok: true });
    expect(fresh.get(hero, Class)).toBe('thief');
    expect(fresh.isRegistered(Stats)).toBe(false);
    expect(hashWorld(fresh)).toBe(hashWorld(saved));

    // Loading again into a world that has the type already is just a load.
    expect(registry.read(fresh, bytes)).toMatchObject({ ok: true });
    // Without the on-demand list the fresh world refuses the save, unchanged.
    const strict = new World({ seed: 3 }).register(Name);
    strict.spawn();
    expect(new SaveRegistry().read(strict, bytes)).toMatchObject({ ok: false });
    expect(strict.isRegistered(Class)).toBe(false);
  });
});
