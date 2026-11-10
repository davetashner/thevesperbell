import { SaveRegistry, type SaveSection } from '@game/save/format';
import { replayScenarios, World, type ReplayScenario } from '@sim/index';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  buildFixtureWorld,
  createFixture,
  FIXTURE_WORLDS,
  FixtureLoadError,
  loadFixture,
  parseFixture,
  serializeFixture,
  type FixtureWorld,
  type SaveFixture,
} from './fixtures';

const PATH = 'tests/save-fixtures/1/probe.json';

/** A scenario whose only system throws: fine to save at tick 0, fails once a loaded world steps. */
const explodes: ReplayScenario<unknown> = {
  name: 'explodes',
  usesContent: false,
  command: z.unknown(),
  create: ({ seed, hz }) => {
    const world = new World<unknown>({ seed, hz });
    world.addSystem({
      name: 'boom',
      run: () => {
        throw new Error('system exploded');
      },
    });
    return world;
  },
  drive: () => [],
};
const scenarios = { ...replayScenarios, explodes };

const core: FixtureWorld = {
  name: 'probe',
  description: 'probe',
  scenario: 'core',
  seed: 3,
  ticks: 30,
};

type Hooks = Partial<Pick<SaveSection, 'version' | 'migrations' | 'serialize' | 'deserialize'>>;

/** A registry with an extra `inventory` section (v1 unless overridden). */
function withInventory(hooks: Hooks = {}): SaveRegistry {
  return new SaveRegistry().register({
    id: 'inventory',
    version: 1,
    schema: z.strictObject({ items: z.array(z.string()) }),
    serialize: () => ({ items: ['lantern'] }),
    deserialize: () => undefined,
    ...hooks,
  });
}

const fixtureWith = (registry: SaveRegistry, spec: FixtureWorld = core): SaveFixture =>
  createFixture(spec, 1, registry, scenarios);

function loadError(run: () => unknown): FixtureLoadError {
  try {
    run();
  } catch (error) {
    if (error instanceof FixtureLoadError) return error;
    throw error;
  }
  throw new Error('expected a FixtureLoadError');
}

describe('fixture worlds', () => {
  it('are deterministic: the same spec saves the same bytes', () => {
    const registry = new SaveRegistry();
    for (const spec of FIXTURE_WORLDS) {
      expect(createFixture(spec, 1, registry)).toEqual(createFixture(spec, 1, registry));
    }
  });

  it('runs the scenario script and applies difficulty overrides', () => {
    const world = buildFixtureWorld({ ...core, difficulty: { fallDamage: 2 } });
    expect(world.tick).toBe(30);
    expect(world.difficulty.fallDamage).toBe(2);
    expect(world.facts.size).toBe(0);
    const withFacts = buildFixtureWorld({ ...core, facts: { 'bell.rung': true } });
    expect(withFacts.facts.get('bell.rung')).toBe(true);
    expect(() => buildFixtureWorld({ ...core, scenario: 'nope' })).toThrow(
      /unknown scenario "nope" \(registered: core, creature-guards\)/,
    );
  });

  it('records the section versions and round-trips through its file form', () => {
    const fixture = fixtureWith(withInventory());
    expect(fixture.sections).toEqual({ world: 6, inventory: 1 });
    const text = serializeFixture(fixture);
    expect(text.endsWith('\n')).toBe(true);
    expect(parseFixture(JSON.parse(text))).toEqual(fixture);
    expect(() => parseFixture({ ...fixture, save: 'not base64!' })).toThrow(
      /malformed save fixture: save:/,
    );
    expect(() => parseFixture(null)).toThrow(/\(root\)/);
  });
});

describe('loadFixture', () => {
  it('AC-1: loads a fixture into a world with the saved state', () => {
    const registry = new SaveRegistry();
    const saved = buildFixtureWorld(core);
    const { world, hash } = loadFixture(PATH, fixtureWith(registry), registry);
    expect(world.tick).toBe(saved.tick + 1);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it('AC-1: an older section version migrates up to the current one', () => {
    const fixture = fixtureWith(withInventory());
    const current = new SaveRegistry().register({
      id: 'inventory',
      version: 2,
      schema: z.strictObject({ items: z.array(z.string()), gold: z.number() }),
      migrations: { 1: (data) => ({ ...(data as object), gold: 0 }) },
      serialize: () => ({ items: [], gold: 0 }),
      deserialize: () => undefined,
    });
    expect(loadFixture(PATH, fixture, current, scenarios).world.tick).toBe(31);
  });

  it('AC-4: a migration that throws names the fixture path and the failing step', () => {
    const fixture = fixtureWith(withInventory());
    const current = withInventory({
      version: 2,
      migrations: {
        1: () => {
          throw new Error('items moved');
        },
      },
    });
    const error = loadError(() => loadFixture(PATH, fixture, current, scenarios));
    expect(error.path).toBe(PATH);
    expect(error.step).toEqual({ section: 'inventory', from: 1, to: 2 });
    expect(error.message).toContain(PATH);
    expect(error.message).toContain('migration step "inventory" v1 → v2 failed');
    expect(error.message).toContain('items moved');
  });

  it('AC-4: a missing migration step is named too', () => {
    const fixture = fixtureWith(withInventory());
    const current = withInventory({ version: 3, migrations: { 2: (data) => data } });
    const error = loadError(() => loadFixture(PATH, fixture, current, scenarios));
    expect(error.step).toEqual({ section: 'inventory', from: 1, to: 2 });
    expect(error.message).toMatch(/^tests\/save-fixtures\/1\/probe\.json: migration step/);
  });

  it('AC-4: other load failures name the path and the error kind', () => {
    const fixture = fixtureWith(new SaveRegistry());
    const corrupt = { ...fixture, save: Buffer.from('VBSV').toString('base64') };
    const error = loadError(() => loadFixture(PATH, corrupt, new SaveRegistry()));
    expect(error.step).toBeUndefined();
    expect(error.message).toContain(`${PATH}: failed to load (corrupt)`);
    const unknown = loadError(() =>
      loadFixture(PATH, { ...fixture, scenario: 'gone' }, new SaveRegistry()),
    );
    expect(unknown.message).toContain(`${PATH}: unknown scenario "gone"`);
  });

  it('fails when the loaded world is not at the saved tick', () => {
    const fixture = fixtureWith(withInventory());
    const current = withInventory({
      deserialize: (world) => {
        world.step([]);
      },
    });
    expect(() => loadFixture(PATH, fixture, current, scenarios)).toThrow(
      /loaded world is at tick 31 but the save was made at tick 30/,
    );
  });

  it('fails when the loaded world cannot be saved again', () => {
    const fixture = fixtureWith(withInventory());
    let loaded = false;
    const current = withInventory({
      serialize: () => {
        if (loaded) throw new Error('lost the lantern');
        return { items: [] };
      },
      deserialize: () => {
        loaded = true;
      },
    });
    expect(() => loadFixture(PATH, fixture, current, scenarios)).toThrow(
      /cannot be saved again: lost the lantern/,
    );
  });

  it('fails when the re-saved world does not load', () => {
    const fixture = fixtureWith(withInventory());
    let loads = 0;
    const current = withInventory({
      deserialize: () => {
        if (++loads > 1) throw new Error('second load');
      },
    });
    expect(() => loadFixture(PATH, fixture, current, scenarios)).toThrow(
      /re-saved world does not load: applying section "inventory" failed/,
    );
  });

  it('fails when the re-saved world loads into a different state', () => {
    const fixture = fixtureWith(withInventory());
    const current = withInventory({ deserialize: (world) => void world.spawn() });
    expect(() => loadFixture(PATH, fixture, current, scenarios)).toThrow(/hash mismatch/);
  });

  it('fails when the loaded world cannot simulate a tick', () => {
    const registry = new SaveRegistry();
    const fixture = fixtureWith(registry, { ...core, scenario: 'explodes', ticks: 0 });
    expect(() => loadFixture(PATH, fixture, registry, scenarios)).toThrow(
      /cannot simulate a tick: system exploded/,
    );
  });
});
