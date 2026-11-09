// @vitest-environment happy-dom
// mw-e27.6: inspect, edit and diff world state from the debug console.
import {
  defineComponent,
  installDebugCommands,
  levelDeltasOf,
  onConditionChanged,
  registerPersistence,
  World,
  WorldPersistence,
  type EntityId,
  type LevelDeltas,
  type PersistenceDeclaration,
} from '@sim/index';
import { createGameSaveRegistry } from '@game/save/sections';
import { LEVEL_DELTAS_SECTION_ID } from '@game/save/level-deltas';
import { worldFactsSaveSection } from '@game/save/world-facts';
import { decodeSave, encodeSave } from '@game/save/format';
import { describe, expect, it, vi } from 'vitest';
import type { ConsoleHost } from '../console/builtins';
import { CommandRegistry } from '../console/registry';
import { registerWorldStateCommands } from './commands';
import { diffStates, formatDiff } from './diff';
import { readSaveState, sectionData, type SaveStateResult } from './save-state';
import { panelLines, PANEL_MAX_FACTS, PANEL_REFRESH_FRAMES, startWorldState } from './start';

const build = { gameVersion: '0.1.0', buildSha: 'deadbee', contentHash: 'c0ffee' };
const options = { build, wallClockSavedAt: 1_790_000_000_000 };

const Lid = defineComponent<'shut' | 'open'>('test.lid');
const lidPersistence: PersistenceDeclaration<string, string> = {
  key: 'lid',
  capture: (world, entity) => world.get(entity, Lid),
  diff: (baseline, current) => (current === baseline ? undefined : current),
  apply: (world, entity, delta) => {
    world.set(entity, Lid, delta as 'shut' | 'open');
    return true;
  },
};
const persistence = new WorldPersistence({ declarations: [lidPersistence] });

function newWorld(): World<never> {
  const world = registerPersistence(new World<never>({ seed: 1 }));
  world.register(Lid);
  installDebugCommands(world, { spawners: new Map() });
  world.facts.declare('quest.x.stage', { type: 'int', default: 0 });
  world.facts.declare('gate.open', { type: 'bool', default: false });
  world.facts.declare('mood', { type: 'enum', values: ['calm', 'angry'], default: 'calm' });
  world.facts.declare('bell.rung', { type: 'tick' });
  world.facts.declare('rival.name', { type: 'id' });
  return world;
}

/** Enters `level` with one authored chest, shut or open. */
function enterWithChest(world: World<never>, level: string, open: boolean): void {
  const chest: EntityId = world.spawn();
  world.add(chest, Lid, 'shut');
  levelDeltasOf(world).enter(world, persistence, level, [['chest-1', chest]]);
  if (open) world.set(chest, Lid, 'open');
}

function setup(
  readSlot: (slot: string) => Promise<SaveStateResult | undefined> = () =>
    Promise.resolve(undefined),
) {
  const world = newWorld();
  const sent: unknown[] = [];
  const host = { submit: (command: unknown) => sent.push(command) } as unknown as ConsoleHost;
  const registry = new CommandRegistry<ConsoleHost>(host);
  registerWorldStateCommands(registry, { world, readSlot });
  /** Hands what the console queued to the next tick, as the frame loop does. */
  const tick = (): void => {
    world.step(sent.splice(0) as never[]);
  };
  return { world, registry, sent, tick };
}

describe('facts.set (mw-e27.6)', () => {
  it('AC-1: sets the fact on the next tick and dependent conditions re-evaluate', () => {
    const { world, registry, tick, sent } = setup();
    const seen: boolean[] = [];
    onConditionChanged(world, { fact: 'quest.x.stage', gte: 3 }, (value) => seen.push(value));
    const result = registry.execute('facts.set quest.x.stage 3');
    expect(result.ok).toBe(true);
    expect(result.lines[0]).toContain('quest.x.stage = 3');
    expect(sent).toHaveLength(1); // a sim command: replays record it
    expect(world.facts.get('quest.x.stage')).toBe(0);
    tick();
    world.step([]); // events arrive at the next phase boundary
    expect(world.facts.get('quest.x.stage')).toBe(3);
    expect(seen).toEqual([true]);
  });

  it('AC-3: an undeclared key reports an error without throwing or queueing anything', () => {
    const { registry, sent } = setup();
    const result = registry.execute('facts.set quest.nope.stage 3');
    expect(result.ok).toBe(false);
    expect(result.lines[0]).toContain('not declared');
    expect(sent).toEqual([]);
  });

  it('AC-3: malformed keys and values of the wrong type are errors too', () => {
    const { registry, sent } = setup();
    expect(registry.execute('facts.set Bad!Key 1').lines[0]).toContain('not a fact key');
    expect(registry.execute('facts.set gate.open maybe').lines[0]).toContain('use true or false');
    expect(registry.execute('facts.set quest.x.stage three').lines[0]).toContain('whole number');
    expect(registry.execute('facts.set quest.x.stage 1.5').lines[0]).toContain('an int');
    expect(registry.execute('facts.set bell.rung ').ok).toBe(false);
    expect(registry.execute('facts.set bell.rung soon').lines[0]).toContain('a tick');
    expect(registry.execute('facts.set mood furious').lines[0]).toContain('does not accept');
    expect(sent).toEqual([]);
  });

  it('writes bools, enums, ids and ticks', () => {
    const { world, registry, tick } = setup();
    for (const line of [
      'facts.set gate.open true',
      'facts.set mood angry',
      'facts.set rival.name miller',
      'facts.set bell.rung 12',
    ]) {
      expect(registry.execute(line).ok).toBe(true);
    }
    tick();
    expect(world.facts.snapshot()).toEqual({
      'bell.rung': 12,
      'gate.open': true,
      mood: 'angry',
      'rival.name': 'miller',
    });
  });
});

describe('facts.list and facts.get', () => {
  it('lists set facts, optionally under a prefix', () => {
    const { world, registry } = setup();
    expect(registry.execute('facts.list').lines).toEqual(['no facts are set']);
    expect(registry.execute('facts.list quest.').lines).toEqual([
      'no set fact starts with "quest."',
    ]);
    world.facts.set('quest.x.stage', 2);
    world.facts.set('gate.open', true);
    expect(registry.execute('facts.list').lines).toEqual([
      '2 facts:',
      '  gate.open = true',
      '  quest.x.stage = 2',
    ]);
    expect(registry.execute('facts.list quest.').lines).toEqual([
      '1 fact under "quest.":',
      '  quest.x.stage = 2',
    ]);
  });

  it('shows one fact with its type and whether it is set or defaulted', () => {
    const { world, registry } = setup();
    expect(registry.execute('facts.get quest.x.stage').lines).toEqual([
      'quest.x.stage = 0 (int, default 0)',
    ]);
    world.facts.set('quest.x.stage', 4);
    expect(registry.execute('facts.get quest.x.stage').lines).toEqual([
      'quest.x.stage = 4 (int, set)',
    ]);
    expect(registry.execute('facts.get bell.rung').lines).toEqual([
      'bell.rung = (unset) (tick, default (unset))',
    ]);
    expect(registry.execute('facts.get Bad!').ok).toBe(false);
    expect(registry.execute('facts.get nothing.here').lines[0]).toContain('no fact');
  });

  it('shows an undeclared fact that a save left set', () => {
    const { world, registry } = setup();
    world.facts.prepareRestore({ 'legacy.flag': true })();
    expect(registry.execute('facts.get legacy.flag').lines).toEqual([
      'legacy.flag = true (bool, set)',
    ]);
  });
});

describe('deltas.list', () => {
  it('lists levels, then one level’s changed entities', () => {
    const { world, registry } = setup();
    expect(registry.execute('deltas.list').lines).toEqual(['no level has changes yet']);
    levelDeltasOf(world).restore([
      {
        level: 'crypt',
        entities: [
          { id: 'urn', destroyed: true },
          { id: 'door', aspects: { lock: 'open', door: 1 } },
          { id: 'same' },
        ],
        spawned: [{ id: 'spawned:9', kind: 'item', data: {} }],
      },
    ]);
    enterWithChest(world, 'nave', true);
    expect(registry.execute('deltas.list').lines).toEqual([
      'crypt: 3 changed, 1 spawned',
      'nave (loaded): 1 changed, 0 spawned',
    ]);
    expect(registry.execute('deltas.list crypt').lines).toEqual([
      'crypt: 3 changed, 1 spawned',
      '  urn: destroyed',
      '  door: door, lock',
      '  same: no changes',
      '  spawned:9 (spawned item)',
    ]);
    expect(registry.execute('deltas.list nave').lines).toContain('  chest-1: lid');
    expect(registry.execute('deltas.list nowhere').lines[0]).toContain('levels: crypt, nave');
    expect(registry.complete('deltas.list c').line).toBe('deltas.list crypt ');
    expect(registry.complete('deltas.list crypt x').options).toEqual([]);
  });

  it('says so when no level has deltas', () => {
    const { registry } = setup();
    expect(registry.execute('deltas.list nowhere').lines[0]).toContain('levels: none');
  });
});

describe('state.snapshot and state.restore', () => {
  it('restores facts and unloaded levels’ deltas through a sim command', () => {
    const { world, registry, tick } = setup();
    world.facts.set('quest.x.stage', 2);
    levelDeltasOf(world).restore([
      { level: 'crypt', entities: [{ id: 'urn', destroyed: true }], spawned: [] },
    ]);
    expect(registry.execute('state.snapshot').lines).toEqual([
      'snapshot "default": 1 facts, 1 levels',
    ]);
    world.facts.set('quest.x.stage', 9);
    world.facts.set('gate.open', true);
    levelDeltasOf(world).restore([]);
    const restored = registry.execute('state.restore');
    expect(restored.ok).toBe(true);
    tick();
    expect(world.facts.snapshot()).toEqual({ 'quest.x.stage': 2 });
    expect(levelDeltasOf(world).levels()).toEqual(['crypt']);
  });

  it('names snapshots, completes their names and refuses bad ones', () => {
    const { registry } = setup();
    expect(registry.execute('state.snapshot before-boss').ok).toBe(true);
    expect(registry.complete('state.restore b').line).toBe('state.restore before-boss ');
    expect(registry.complete('state.restore ').line).toBe('state.restore before-boss ');
    expect(registry.complete('state.restore before-boss x').options).toEqual([]);
    for (const bad of ['live', 'quick', 'Big Name', '9lives']) {
      expect(registry.execute(`state.snapshot ${bad}`).ok).toBe(false);
    }
    expect(registry.execute('state.restore missing').lines[0]).toContain('snapshots: before-boss');
  });

  it('says there are none to restore', () => {
    const { registry } = setup();
    expect(registry.execute('state.restore').lines[0]).toContain('none (state.snapshot first)');
  });
});

/** Save bytes of a world with one chest in `nave`, shut or open, and the given stage. */
function saveBytes(chestOpen: boolean, stage: number): Uint8Array {
  const world = newWorld();
  world.facts.set('quest.x.stage', stage);
  enterWithChest(world, 'nave', chestOpen);
  return createGameSaveRegistry().write(world, options);
}

describe('state.diff', () => {
  const registry = createGameSaveRegistry();
  const slots = new Map<string, Uint8Array>([
    ['manual-1', saveBytes(false, 1)],
    ['manual-2', saveBytes(true, 1)],
    ['manual-3', saveBytes(true, 2)],
  ]);
  const readSlot = (slot: string): Promise<SaveStateResult | undefined> => {
    const bytes = slots.get(slot);
    return Promise.resolve(bytes === undefined ? undefined : readSaveState(registry, bytes));
  };

  it('AC-2: two saves differing by one looted chest list exactly that delta', async () => {
    const { registry: console_ } = setup(readSlot);
    const result = console_.execute('state.diff manual-1 manual-2');
    const done = await result.later;
    expect(done?.ok).toBe(true);
    expect(done?.lines).toEqual([
      '- only in manual-1, + only in manual-2, ~ differs',
      'level nave:',
      '  + chest-1: lid',
    ]);
  });

  it('groups fact changes before level changes', async () => {
    const { registry: console_ } = setup(readSlot);
    const done = await console_.execute('state.diff manual-1 manual-3').later;
    expect(done?.lines).toEqual([
      '- only in manual-1, + only in manual-2, ~ differs'.replace('manual-2', 'manual-3'),
      'facts (1):',
      '  quest.x.stage: 1 -> 2',
      'level nave:',
      '  + chest-1: lid',
    ]);
  });

  it('reports identical states', async () => {
    const { registry: console_ } = setup(readSlot);
    const done = await console_.execute('state.diff manual-2 manual-2').later;
    expect(done?.lines).toEqual(['manual-2 and manual-2 hold the same facts and level deltas']);
  });

  it('compares live state and snapshots with saves', async () => {
    const { world, registry: console_ } = setup(readSlot);
    world.facts.set('quest.x.stage', 1);
    enterWithChest(world, 'nave', false);
    console_.execute('state.snapshot start');
    levelDeltasOf(world).leave(world);
    enterWithChest(world, 'nave', true);
    const live = await console_.execute('state.diff start live').later;
    expect(live?.lines).toEqual([
      '- only in start, + only in live, ~ differs',
      'level nave:',
      '  + chest-1: lid',
    ]);
    const saved = await console_.execute('state.diff manual-2 live').later;
    expect(saved?.lines[0]).toContain('hold the same');
    expect(console_.complete('state.diff s').line).toBe('state.diff start ');
    expect(console_.complete('state.diff start m').options).toContain('manual-1');
    expect(console_.complete('state.diff start live x').options).toEqual([]);
  });

  it('reads an empty slot, an unreadable slot and an unknown operand as errors', async () => {
    const { registry: console_ } = setup((slot) =>
      Promise.resolve(slot === 'manual-5' ? { ok: false, reason: 'damaged' } : undefined),
    );
    expect((await console_.execute('state.diff manual-4 live').later)?.lines).toEqual([
      'slot manual-4 is empty',
    ]);
    expect((await console_.execute('state.diff live manual-5').later)?.lines).toEqual([
      'slot manual-5 cannot be read: damaged',
    ]);
    expect((await console_.execute('state.diff live elsewhere').later)?.lines[0]).toContain(
      '"elsewhere" is not a save slot',
    );
  });

  it('shows removed and changed entities and spawns, and levels one side never visited', () => {
    const level = (over: Partial<LevelDeltas>): LevelDeltas => ({
      level: 'crypt',
      entities: [],
      spawned: [],
      ...over,
    });
    const a = {
      facts: { gone: true, kept: 1 },
      levels: [
        level({
          entities: [
            { id: 'a', destroyed: true },
            { id: 'b', aspects: { lock: 'shut', lid: 1 } },
            { id: 'c', aspects: { door: 1 } },
            { id: 'd', destroyed: true },
            { id: 'e', aspects: { lid: 1 } },
            { id: 'f' },
          ],
          spawned: [
            { id: 's1', kind: 'item', data: 1 },
            { id: 's2', kind: 'arrow', data: 1 },
          ],
        }),
        level({ level: 'attic' }),
      ],
    };
    const b = {
      facts: { kept: 2, fresh: 'x' },
      levels: [
        level({
          entities: [
            { id: 'b', aspects: { lock: 'open' } },
            { id: 'c', aspects: { door: 1 } },
            { id: 'd', aspects: { door: 2 } },
            { id: 'e' },
            { id: 'f', aspects: { lid: 2 } },
          ],
          spawned: [{ id: 's2', kind: 'arrow', data: 2 }],
        }),
        level({ level: 'cellar', entities: [{ id: 'jar', destroyed: true }] }),
      ],
    };
    expect(formatDiff(diffStates(a, b), { a: 'A', b: 'B' })).toEqual([
      '- only in A, + only in B, ~ differs',
      'facts (3):',
      '  fresh: (unset) -> "x"',
      '  gone: true -> (unset)',
      '  kept: 1 -> 2',
      'level cellar:',
      '  + jar: destroyed',
      'level crypt:',
      '  - a: destroyed',
      '  ~ b: lid 1 -> (none); lock "shut" -> "open"',
      '  ~ d: destroyed -> door',
      '  ~ e: lid 1 -> (none)',
      '  ~ f: lid (none) -> 2',
      '  - s1: spawned item',
      '  ~ s2: spawned arrow, its data differs',
    ]);
  });
});

describe('readSaveState', () => {
  const registry = createGameSaveRegistry();

  it('reads the facts and level deltas of a save', () => {
    const read = readSaveState(registry, saveBytes(true, 3));
    expect(read).toEqual({
      ok: true,
      state: {
        facts: { 'quest.x.stage': 3 },
        levels: [
          { level: 'nave', entities: [{ id: 'chest-1', aspects: { lid: 'open' } }], spawned: [] },
        ],
      },
    });
  });

  it('refuses bytes that are not a save', () => {
    const read = readSaveState(registry, new Uint8Array([1, 2, 3]));
    expect(read.ok).toBe(false);
  });

  it('reads missing sections as empty and leaves out a damaged level section', () => {
    const decoded = decodeSave(saveBytes(true, 3));
    if (!decoded.ok) throw decoded.error;
    const without = encodeSave({
      ...decoded.envelope,
      sections: Object.fromEntries(
        Object.entries(decoded.envelope.sections).filter(
          ([id]) => id !== 'world-facts' && id !== LEVEL_DELTAS_SECTION_ID,
        ),
      ),
    });
    expect(readSaveState(registry, without)).toEqual({
      ok: true,
      state: { facts: {}, levels: [] },
    });
    const damaged = encodeSave({
      ...decoded.envelope,
      sections: {
        ...decoded.envelope.sections,
        [LEVEL_DELTAS_SECTION_ID]: { version: 1, data: { levels: { nave: 'junk' } } },
      },
    });
    expect(readSaveState(registry, damaged)).toEqual({
      ok: true,
      state: { facts: { 'quest.x.stage': 3 }, levels: [] },
    });
  });

  it('refuses a record its check would have refused', () => {
    expect(() => sectionData(worldFactsSaveSection(), { version: 99, data: {} })).toThrow(/newer/);
    expect(() =>
      sectionData(worldFactsSaveSection(), { version: 1, data: { facts: { a: [] } } }),
    ).toThrow(/facts/);
    expect(sectionData(worldFactsSaveSection(), { version: 1, data: { facts: { a: 1 } } })).toEqual(
      {
        facts: { a: 1 },
      },
    );
  });
});

describe('world state panel (mw-e27.6)', () => {
  function started(over: Partial<Parameters<typeof startWorldState>[0]> = {}) {
    document.body.innerHTML = '';
    const root = document.createElement('div');
    document.body.append(root);
    const world = newWorld();
    const registry = new CommandRegistry<ConsoleHost>({
      submit: vi.fn(),
    } as unknown as ConsoleHost);
    const publish = vi.fn();
    const session = startWorldState({
      world,
      registry,
      root,
      store: { read: () => Promise.resolve({ status: 'empty' }) },
      saves: createGameSaveRegistry(),
      publish,
      ...over,
    });
    const panel = () => root.querySelector<HTMLElement>('[data-testid="world-state-panel"]');
    return { world, registry, session, panel, publish, root };
  }

  it('is hidden and free until turned on, then lists facts and level deltas', () => {
    const { world, registry, session, panel, publish } = started();
    expect(panel()?.style.display).toBe('none');
    session.frame();
    expect(panel()?.textContent).toBe('');
    world.facts.set('quest.x.stage', 2);
    enterWithChest(world, 'nave', true);
    expect(registry.execute('state.panel on').lines).toEqual(['world state panel on']);
    expect(panel()?.style.display).toBe('block');
    expect(panel()?.textContent).toBe(
      ['facts (1)', '  quest.x.stage = 2', 'level deltas (1)', '  nave: 1 changed, 0 spawned'].join(
        '\n',
      ),
    );
    expect(publish).toHaveBeenCalledTimes(1);
    world.facts.set('gate.open', true);
    for (let i = 0; i < PANEL_REFRESH_FRAMES - 1; i++) session.frame();
    expect(panel()?.textContent).not.toContain('gate.open');
    session.frame();
    expect(panel()?.textContent).toContain('gate.open');
    expect(publish).toHaveBeenCalledTimes(2);
    for (let i = 0; i < PANEL_REFRESH_FRAMES; i++) session.frame(); // nothing changed: no republish
    expect(publish).toHaveBeenCalledTimes(2);
    expect(registry.execute('state.panel').lines).toEqual(['world state panel off']);
    expect(panel()?.style.display).toBe('none');
    expect(registry.complete('state.panel o').options).toEqual(['on', 'off']);
    expect(registry.complete('state.panel on ').options).toEqual([]);
    registry.execute('state.panel on');
    expect(publish).toHaveBeenCalledTimes(3);
    session.dispose();
    expect(panel()).toBeNull();
  });

  it('counts the facts beyond what fits', () => {
    const { world } = started();
    for (let i = 0; i < PANEL_MAX_FACTS + 2; i++) {
      world.facts.prepareRestore({
        ...world.facts.snapshot(),
        [`k${String(i).padStart(3, '0')}`]: i,
      })();
    }
    const lines = panelLines(world);
    expect(lines).toContain('  ... 2 more (facts.list)');
    expect(lines).toHaveLength(1 + PANEL_MAX_FACTS + 1 + 1);
  });

  it('reads save slots from the store: empty, damaged and readable', async () => {
    const reads: Record<string, unknown> = {
      'manual-1': { status: 'empty' },
      'manual-2': { status: 'corrupt', error: new Error('torn blob') },
      'manual-3': { status: 'ok', bytes: saveBytes(true, 1), generation: 1 },
    };
    const { registry } = started({
      store: { read: (slot) => Promise.resolve(reads[slot] as never) },
    });
    expect((await registry.execute('state.diff manual-1 live').later)?.lines).toEqual([
      'slot manual-1 is empty',
    ]);
    expect((await registry.execute('state.diff manual-2 live').later)?.lines).toEqual([
      'slot manual-2 cannot be read: torn blob',
    ]);
    const diff = await registry.execute('state.diff manual-3 live').later;
    expect(diff?.ok).toBe(true);
    expect(diff?.lines).toContain('  quest.x.stage: 1 -> (unset)');
  });
});
