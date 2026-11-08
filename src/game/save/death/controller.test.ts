// @vitest-environment happy-dom
// Death → reload (mw-e30.7): the death screen's choices, the reload hand-off, and the load on boot
// through corruption recovery. AC-2 and AC-3 run end to end in e2e/death-reload.spec.ts; here the
// same flows run against a real save store and registry with the page reload stubbed out. AC-4
// [integration]: a corrupt latest save chosen on the death screen goes through the recovery flow,
// which restores the backup and says so.
import 'fake-indexeddb/auto';
import { defineComponent, hashWorld, World } from '@sim/index';
import { DEATH_SCREEN, LOADING_SCREEN, SAVE_NOTICE_SCREEN, UiRoot } from '@ui/index';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeSave, encodeSave, SaveRegistry, WORLD_SECTION_ID } from '../format/index';
import { createGameSaveRegistry } from '../sections';
import type { SlotId } from '../slots/index';
import { MemorySaveStore, openSaveStore, type SaveStore } from '../storage/index';
import {
  DeathReload,
  deathSaveEntry,
  recoveryText,
  slotName,
  type DeathReloadReadout,
} from './controller';
import { takePendingLoad, writePendingLoad, type PendingLoadStorage } from './pending';

const Position = defineComponent<{ x: number }>('Position');
const build = { gameVersion: '0.2.0', buildSha: 'abc1234', contentHash: 'c0ffee' };
const T0 = 1_790_000_000_000;
const MIN = 60_000;

/** A world at `tick`. */
function world(tick = 0): World<never> {
  const w = new World({ seed: 7 }).register(Position);
  w.add(w.spawn(), Position, { x: tick });
  w.restore({ ...w.snapshot(), clock: { tick, hz: 60 } });
  return w;
}

function session(): PendingLoadStorage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
    removeItem: (key) => {
      items.delete(key);
    },
  };
}

interface Setup {
  store?: SaveStore;
  storage?: PendingLoadStorage;
  areaId?: string | undefined;
  tick?: number;
  clock?: { now: number };
  /** The session's chosen class (default knight); undefined: none. */
  chosenClass?: string | undefined;
  registry?: SaveRegistry;
}

/** A DeathReload over a real registry, with the page reload and outputs recorded. */
function setup(options: Setup = {}) {
  document.body.innerHTML = '';
  const ui = new UiRoot(document.body, { unstyled: true });
  const store = options.store ?? new MemorySaveStore();
  const storage = options.storage ?? session();
  const clock = options.clock ?? { now: T0 };
  const w = world(options.tick ?? 0);
  const navigations: (string | undefined)[] = [];
  const restarts: (string | undefined)[] = [];
  const titles: number[] = [];
  const readouts: DeathReloadReadout[] = [];
  const warnings: string[] = [];
  const areaId = 'areaId' in options ? options.areaId : 'testbed';
  const reload = new DeathReload({
    ui,
    world: w,
    store,
    registry: options.registry ?? createGameSaveRegistry(),
    build,
    now: () => clock.now,
    session: storage,
    areaId,
    navigate: (area, classId) => {
      navigations.push(area);
      restarts.push(classId);
    },
    chosenClass: () => ('chosenClass' in options ? options.chosenClass : 'knight'),
    toTitle: () => titles.push(1),
    describe: () => ({ characterName: 'Knight', classId: 'knight', areaId: areaId ?? '' }),
    publish: (readout) => readouts.push(readout),
    warn: (message) => warnings.push(message),
  });
  return {
    ui,
    store,
    storage,
    clock,
    world: w,
    reload,
    navigations,
    restarts,
    titles,
    readouts,
    warnings,
  };
}

type Session = ReturnType<typeof setup>;

/** Saves the session's world as it is at `tick` into `slot` at wall-clock `at`. */
async function save(s: Session, slot: SlotId, tick: number, at: number): Promise<string> {
  s.world.restore({ ...s.world.snapshot(), clock: { tick, hz: 60 } });
  s.clock.now = at;
  await s.reload.debugSave(slot);
  const saved = s.readouts.at(-1);
  if (saved?.kind !== 'saved') throw new Error('no save readout');
  return saved.hash;
}

const buttons = (root: ParentNode): string[] =>
  [...root.querySelectorAll('button')]
    .filter((b) => !b.closest('[hidden]'))
    .map((b) => b.textContent);

const screen = (id: string): HTMLElement | null => document.querySelector(`[data-screen="${id}"]`);

/** The element matching `selector`; throws when there is none. */
function find(selector: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(selector);
  if (el === null) throw new Error(`nothing matches ${selector}`);
  return el;
}

function press(label: string, root: ParentNode = document): void {
  const target = [...root.querySelectorAll('button')].find(
    (b) => b.textContent === label && b.closest('[hidden]') === null,
  );
  if (target === undefined) throw new Error(`no button "${label}" in ${buttons(root).join(', ')}`);
  target.click();
}

/** Flips one body byte of the slot's current copy (its old copy becomes the backup). */
async function corrupt(store: SaveStore, slot: string): Promise<void> {
  const read = await store.read(slot);
  if (read.status !== 'ok') throw new Error(`${slot} is empty`);
  const at = read.bytes.length - read.generation;
  read.bytes[at] = (read.bytes[at] ?? 0) ^ 0xff;
  await store.write(slot, read.bytes);
}

/** Rewrites the slot's current copy as if a newer build wrote its world section. */
async function fromNewerBuild(store: SaveStore, slot: string): Promise<void> {
  const read = await store.read(slot);
  if (read.status !== 'ok') throw new Error(`${slot} is empty`);
  const decoded = decodeSave(read.bytes);
  if (!decoded.ok) throw decoded.error;
  const { envelope } = decoded;
  const section = envelope.sections[WORLD_SECTION_ID];
  // Written fresh, so the slot has no older backup to fall back to.
  await store.delete(slot);
  await store.write(
    slot,
    encodeSave({
      ...envelope,
      sections: { ...envelope.sections, [WORLD_SECTION_ID]: { version: 99, data: section?.data } },
    }),
  );
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('death screen', () => {
  it('offers Load last save (focused) and Load…, and reloads into the save’s area with a pending load', async () => {
    const s = setup();
    await save(s, 'auto-1', 100, T0);
    await save(s, 'manual-1', 120, T0 + MIN);
    await s.reload.playerDied();

    const death = screen(DEATH_SCREEN);
    expect(death).not.toBeNull();
    expect(buttons(find(`[data-screen="${DEATH_SCREEN}"]`))).toEqual(['Load last save', 'Load…']);
    expect(document.activeElement?.textContent).toBe('Load last save');
    expect(death?.textContent).toContain(
      'Last save: Manual save 1 · Knight · testbed · 0:02 played',
    );
    expect(s.readouts.at(-1)).toEqual({ kind: 'death', saves: 2, last: 'manual-1' });
    expect(s.ui.pausesSim).toBe(true);

    press('Load last save');
    expect(s.navigations).toEqual(['testbed']);
    expect(takePendingLoad(s.storage)).toEqual({
      slot: 'manual-1',
      areaId: 'testbed',
      requestedAt: T0 + MIN,
    });
  });

  it('carries the death’s respawn rule into the pending load (mw-e01.8)', async () => {
    const s = setup();
    await save(s, 'manual-1', 120, T0 + MIN);
    await s.reload.playerDied({ rule: 'testbed-reload' });
    press('Load last save');
    expect(takePendingLoad(s.storage)).toMatchObject({
      slot: 'manual-1',
      respawn: { rule: 'testbed-reload' },
    });
  });

  it('Load… lists every save most recent first; Back returns to the choices and never closes the screen', async () => {
    const s = setup();
    await save(s, 'auto-1', 100, T0);
    await save(s, 'manual-1', 120, T0 + MIN);
    await s.reload.playerDied();

    press('Load…');
    const list = find('[data-testid="death-saves"]');
    expect(list.hidden).toBe(false);
    expect(buttons(list)).toEqual([
      'Manual save 1 · Knight · testbed · 0:02 played · just now',
      'Autosave 1 · Knight · testbed · 0:01 played · 1 min ago',
      'Back',
    ]);
    expect(document.activeElement?.textContent).toContain('Manual save 1');
    // Back (the UI intent) returns to the choices; on the choices it keeps the screen open.
    s.ui.intent('back', 'keyboard');
    expect(list.hidden).toBe(true);
    s.ui.intent('back', 'keyboard');
    expect(screen(DEATH_SCREEN)).not.toBeNull();
    press('Load…');
    press('Back');
    expect(list.hidden).toBe(true);
    expect(document.activeElement?.textContent).toBe('Load last save');

    press('Load…');
    press('Autosave 1 · Knight · testbed · 0:01 played · 1 min ago');
    expect(takePendingLoad(s.storage)).toMatchObject({ slot: 'auto-1', areaId: 'testbed' });
  });

  it('opens once however many times the player dies', async () => {
    const s = setup();
    await s.reload.playerDied();
    await s.reload.playerDied();
    expect(document.querySelectorAll(`[data-screen="${DEATH_SCREEN}"]`)).toHaveLength(1);
  });

  it('AC-3: with no saves it offers Restart area instead, which reloads the area with no pending load and no error', async () => {
    const s = setup();
    writePendingLoad(s.storage, { slot: 'manual-1', areaId: 'testbed' });
    await s.reload.playerDied();
    const death = find(`[data-screen="${DEATH_SCREEN}"]`);
    expect(buttons(death)).toEqual(['Restart area']);
    expect(document.activeElement?.textContent).toBe('Restart area');
    expect(death.textContent).toContain('There is no save to return to.');
    expect(s.readouts.at(-1)).toEqual({ kind: 'death', saves: 0, last: null });

    press('Restart area');
    expect(s.navigations).toEqual([undefined]);
    expect(takePendingLoad(s.storage)).toBeUndefined();
    expect(s.warnings).toEqual([]);
  });

  it('mw-e01.16 AC-1: Restart area hands the class chosen this session to the new-game boot', async () => {
    const s = setup({ chosenClass: 'knight' });
    await s.reload.playerDied();
    press('Restart area');
    expect(s.restarts).toEqual(['knight']);
    expect(s.titles).toEqual([]);
  });

  it('mw-e01.16 AC-4: with no chosen class Restart area returns to the title with a warning instead of throwing', async () => {
    const s = setup({ chosenClass: undefined });
    writePendingLoad(s.storage, { slot: 'manual-1', areaId: 'testbed' });
    await s.reload.playerDied();
    expect(() => {
      press('Restart area');
    }).not.toThrow();
    expect(s.titles).toEqual([1]);
    expect(s.navigations).toEqual([]);
    expect(takePendingLoad(s.storage)).toBeUndefined();
    expect(s.warnings).toEqual([
      'restart area: no class was chosen this session, returning to the title',
    ]);
  });

  it('counts a save list it cannot read as no saves, so the area can still be restarted', async () => {
    const store = new MemorySaveStore();
    vi.spyOn(store, 'list').mockRejectedValue(new Error('blocked'));
    const s = setup({ store });
    await s.reload.playerDied();
    expect(buttons(find(`[data-screen="${DEATH_SCREEN}"]`))).toEqual(['Restart area']);
    expect(s.warnings).toEqual(['death screen: could not list saves (Error: blocked)']);
  });
});

describe('load on boot', () => {
  it('a debug save publishes the hash of the world it saved, after what a save settles (mw-e01.21)', async () => {
    // A save never stores a carried object: the registry sets it down first (here: moves the entity).
    const registry = new SaveRegistry({
      beforeWrite: (w) => {
        w.query(Position).forEach((entity) => {
          w.set(entity, Position, { x: -1 });
        });
      },
    });
    const s = setup({ registry, tick: 5 });
    const before = hashWorld(s.world);
    const hash = await save(s, 'manual-1', 5, T0);
    expect(hash).not.toBe(before);
    expect(hash).toBe(hashWorld(s.world));
    const loaded = world(0);
    const read = await s.reload['slots'].load('manual-1', loaded);
    expect(read.status).toBe('loaded');
    expect(hashWorld(loaded)).toBe(hash);
  });

  it('AC-2: loads the pending save into the fresh world before the first step, at the saved state hash', async () => {
    const before = setup();
    const hash = await save(before, 'manual-1', 120, T0);

    const after = setup({ store: before.store, tick: 0 });
    await after.reload.resume({ slot: 'manual-1', areaId: 'testbed' });
    expect(after.world.tick).toBe(120);
    expect(hashWorld(after.world)).toBe(hash);
    expect(after.readouts).toEqual([
      { kind: 'loaded', slot: 'manual-1', status: 'loaded', tick: 120, hash, requestedAt: null },
    ]);
    expect(after.ui.screens).toHaveLength(0);
  });

  it('does nothing without a pending load, or with one for another area', async () => {
    const s = setup();
    await s.reload.resume(undefined);
    await s.reload.resume({ slot: 'manual-1', areaId: 'bell-tower' });
    expect(s.readouts).toEqual([]);
    expect(s.warnings).toEqual(['pending load of manual-1 is for bell-tower, not testbed']);
    const none = setup({ areaId: undefined });
    await none.reload.resume({ slot: 'manual-1', areaId: 'bell-tower' });
    expect(none.warnings).toEqual(['pending load of manual-1 is for bell-tower, not undefined']);
  });

  it('warns when the slot turned out empty or storage fails, leaving the fresh area as it is', async () => {
    const s = setup();
    await s.reload.resume({ slot: 'quick', areaId: undefined });
    vi.spyOn(s.store, 'read').mockRejectedValue(new Error('gone'));
    await s.reload.resume({ slot: 'quick', areaId: 'testbed' });
    expect(s.warnings).toEqual([
      'pending load of quick: the slot is empty',
      'could not load quick (Error: gone)',
    ]);
    expect(s.world.tick).toBe(0);
  });

  it('AC-4: a corrupt latest save chosen on the death screen goes through recovery, which restores its backup and says so', async () => {
    const { store } = await openSaveStore({ indexedDB: new IDBFactory(), storage: undefined });
    const storage = session();
    const before = setup({ store, storage });
    await save(before, 'auto-1', 60, T0 - 10 * MIN);
    // Damaging the current copy is a write: the good copy becomes the backup.
    const backupHash = await save(before, 'manual-1', 120, T0 - 5 * MIN);
    await corrupt(store, 'manual-1');

    // The damaged slot is still the latest save: its backup dates it.
    await before.reload.playerDied();
    expect(screen(DEATH_SCREEN)?.textContent).toContain('damaged: loads its backup');
    press('Load last save');
    expect(before.navigations).toEqual(['testbed']);

    const after = setup({ store, storage, clock: { now: T0 } });
    await after.reload.resume(takePendingLoad(storage));
    expect(hashWorld(after.world)).toBe(backupHash);
    expect(after.readouts).toEqual([
      {
        kind: 'loaded',
        slot: 'manual-1',
        status: 'restored',
        tick: 120,
        hash: backupHash,
        // When the player chose it on the death screen, to time the reload.
        requestedAt: T0 - 5 * MIN,
      },
    ]);
    const notice = find(`[data-screen="${SAVE_NOTICE_SCREEN}"]`);
    expect(notice.textContent).toContain(
      'Manual save 1 was damaged, so its backup from 5 min ago was loaded instead.',
    );
    expect(after.ui.pausesSim).toBe(true);
    // Back acknowledges it like Continue.
    after.ui.intent('back', 'keyboard');
    expect(screen(SAVE_NOTICE_SCREEN)).toBeNull();
  });

  it('offers the next most recent save when both copies are damaged; accepted, it loads here', async () => {
    const before = setup();
    const otherHash = await save(before, 'auto-1', 60, T0 - 10 * MIN);
    await save(before, 'manual-1', 120, T0 - MIN);
    await corrupt(before.store, 'manual-1');
    await corrupt(before.store, 'manual-1');

    const after = setup({ store: before.store });
    await after.reload.resume({ slot: 'manual-1', areaId: 'testbed' });
    const confirm = find('[data-testid="confirm"]');
    expect(confirm.textContent).toContain(
      'Manual save 1 and its backup are damaged. Load Autosave 1 from 10 min ago instead?',
    );
    expect(after.ui.pausesSim).toBe(true);
    press('Load it');
    await flush();
    await flush();
    expect(screen(LOADING_SCREEN)).toBeNull();
    expect(hashWorld(after.world)).toBe(otherHash);
    expect(after.readouts.at(-1)).toMatchObject({ kind: 'loaded', status: 'restored' });
    expect(screen(SAVE_NOTICE_SCREEN)?.textContent).toContain(
      'Manual save 1 was damaged, so Autosave 1 from 10 min ago was loaded instead.',
    );
    press('Continue');
    expect(after.ui.screens).toHaveLength(0);
  });

  it('declining the offer keeps the freshly built area (the restart)', async () => {
    const before = setup();
    await save(before, 'auto-1', 60, T0 - 10 * MIN);
    await save(before, 'manual-1', 120, T0 - MIN);
    await corrupt(before.store, 'manual-1');
    await corrupt(before.store, 'manual-1');
    const after = setup({ store: before.store });
    await after.reload.resume({ slot: 'manual-1', areaId: 'testbed' });
    press('Restart area');
    await flush();
    expect(after.world.tick).toBe(0);
    expect(after.ui.screens).toHaveLength(0);
    expect(after.navigations).toEqual([]);
  });

  it('an offered save from another area reloads into that area', async () => {
    const elsewhere = setup({ areaId: 'bell-tower' });
    await save(elsewhere, 'auto-1', 60, T0 - 10 * MIN);
    const here = setup({ store: elsewhere.store });
    await save(here, 'manual-1', 120, T0 - MIN);
    await corrupt(here.store, 'manual-1');
    await corrupt(here.store, 'manual-1');

    const after = setup({ store: here.store });
    await after.reload.resume({ slot: 'manual-1', areaId: 'testbed' });
    press('Load it');
    await flush();
    expect(after.navigations).toEqual(['bell-tower']);
    expect(takePendingLoad(after.storage)).toMatchObject({ slot: 'auto-1', areaId: 'bell-tower' });
  });

  it('warns if the accepted save cannot be read, and releases the sim', async () => {
    const before = setup();
    await save(before, 'auto-1', 60, T0 - 10 * MIN);
    await save(before, 'manual-1', 120, T0 - MIN);
    await corrupt(before.store, 'manual-1');
    await corrupt(before.store, 'manual-1');
    const after = setup({ store: before.store });
    await after.reload.resume({ slot: 'manual-1', areaId: 'testbed' });
    vi.spyOn(after.store, 'read').mockRejectedValue(new Error('gone'));
    press('Load it');
    await flush();
    expect(after.warnings).toEqual(['could not load auto-1 (Error: gone)']);
    expect(after.ui.screens).toHaveLength(0);
  });

  it('with nothing recoverable, says so and the fresh area is the restart', async () => {
    const before = setup();
    await save(before, 'manual-1', 120, T0 - MIN);
    await corrupt(before.store, 'manual-1');
    await corrupt(before.store, 'manual-1');
    const after = setup({ store: before.store });
    await after.reload.resume({ slot: 'manual-1', areaId: 'testbed' });
    const notice = find(`[data-screen="${SAVE_NOTICE_SCREEN}"]`);
    expect(notice.textContent).toContain(
      'No save could be recovered from Manual save 1. The area starts again from the beginning.',
    );
    press('Restart area');
    expect(after.world.tick).toBe(0);
    expect(after.ui.screens).toHaveLength(0);
  });

  it('a save from a newer build is left alone: another save is offered, or the area restarts', async () => {
    const before = setup();
    await save(before, 'auto-1', 60, T0 - 10 * MIN);
    await save(before, 'manual-1', 120, T0 - MIN);
    await fromNewerBuild(before.store, 'manual-1');
    const after = setup({ store: before.store });
    await after.reload.resume({ slot: 'manual-1', areaId: 'testbed' });
    expect(document.querySelector('[data-testid="confirm"]')?.textContent).toContain(
      'Manual save 1 needs a newer version of the game; it has not been changed. Load Autosave 1 from 10 min ago instead?',
    );
    press('Restart area');
    await flush();

    await before.store.delete('auto-1');
    const alone = setup({ store: before.store });
    await alone.reload.resume({ slot: 'manual-1', areaId: 'testbed' });
    expect(screen(SAVE_NOTICE_SCREEN)?.textContent).toContain(
      'needs a newer version of the game; it has not been changed. The area starts again from the beginning.',
    );
  });
});

describe('save text', () => {
  it('names slots and describes saves', () => {
    expect(['manual-3', 'auto-2', 'quick'].map((s) => slotName(s as SlotId))).toEqual([
      'Manual save 3',
      'Autosave 2',
      'Quicksave',
    ]);
    const bare = { slot: 'quick', kind: 'quicksave', savedAt: T0, details: undefined } as const;
    expect(deathSaveEntry({ ...bare, damaged: false }, T0 + 3 * 3_600_000)).toEqual({
      id: 'quick',
      title: 'Quicksave',
      detail: '3 h ago',
    });
    expect(deathSaveEntry({ ...bare, damaged: true }, T0).detail).toBe(
      'just now · damaged: loads its backup',
    );
    const details = {
      characterName: 'Knight',
      classId: 'knight',
      areaId: 'testbed',
      label: 'Before the bridge',
      playtimeTicks: 0,
      tickRateHz: 60,
      playtimeSeconds: 3725,
      thumbnail: null,
    };
    expect(deathSaveEntry({ ...bare, details, damaged: false }, T0)).toEqual({
      id: 'quick',
      title: 'Before the bridge',
      detail: 'Knight · testbed · 1:02:05 played · just now',
    });
  });

  it('has a title for every recovery message', () => {
    expect(
      recoveryText({
        key: 'save.recovery.restored-backup',
        params: { slot: 'quick', savedAt: T0, ageMs: 0 },
      }).title,
    ).toBe('Save restored');
  });
});
