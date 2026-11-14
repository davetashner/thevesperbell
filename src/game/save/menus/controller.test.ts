// @vitest-environment happy-dom
// The save menus (mw-e30.11) over a real registry and save store, with the page reload stubbed out:
// the title menu's Continue (AC-1) and its disabled state with no saves (AC-2), the Load and Save
// screens with their overwrite and delete confirmations (AC-3's actions; keyboard reachability is
// in src/ui/save-menus.test.ts and the e2e), and the empty and error states.
import { defineComponent, hashWorld, World } from '@sim/index';
import { LOADING_SCREEN, SAVE_SLOTS_SCREEN, TITLE_SCREEN, UiRoot } from '@ui/index';
import { describe, expect, it, vi } from 'vitest';
import type { PendingLoad } from '../death/pending';
import { createGameSaveRegistry } from '../sections';
import { MANUAL_SLOT_COUNT, type SlotId, type ThumbnailCapture } from '../slots/index';
import {
  MemorySaveStore,
  SaveQuotaError,
  SaveStorageError,
  type SaveStore,
} from '../storage/index';
import {
  SAVE_MENU_MESSAGES,
  SaveMenus,
  thumbnailUrl,
  type SaveMenuReadout,
  type SaveMenusOptions,
} from './controller';

const Position = defineComponent<{ x: number }>('Position');
const build = { gameVersion: '0.2.0', buildSha: 'abc1234', contentHash: 'c0ffee' };
const T0 = 1_790_000_000_000;
const MIN = 60_000;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

/** A world at `tick`. */
function world(tick = 0): World<never> {
  const w = new World({ seed: 7 }).register(Position);
  w.add(w.spawn(), Position, { x: tick });
  w.restore({ ...w.snapshot(), clock: { tick, hz: 60 } });
  return w;
}

/** A store whose operations can be made to fail. */
class FlakyStore implements SaveStore {
  readonly kind = 'memory';
  readonly durable = false;
  readonly inner = new MemorySaveStore();
  failList = false;
  failRead = false;
  failWrite: Error | undefined;
  failDelete: Error | undefined;
  /** Runs after each successful write. */
  afterWrite: (() => void) | undefined;

  async write(slot: string, bytes: Uint8Array): Promise<void> {
    if (this.failWrite !== undefined) throw this.failWrite;
    await this.inner.write(slot, bytes);
    this.afterWrite?.();
  }
  async read(slot: string, copy?: 'current' | 'backup') {
    if (this.failRead) throw new SaveStorageError(`read slot "${slot}"`, 'blocked');
    return this.inner.read(slot, copy);
  }
  async list(): Promise<readonly string[]> {
    if (this.failList) throw new SaveStorageError('list saves', 'blocked');
    return this.inner.list();
  }
  async delete(slot: string): Promise<void> {
    if (this.failDelete !== undefined) throw this.failDelete;
    await this.inner.delete(slot);
  }
}

interface Setup {
  readonly quiet?: boolean;
  readonly warning?: string;
  readonly captureThumbnail?: ThumbnailCapture;
}

function setup(options: Setup = {}) {
  document.body.innerHTML = '';
  const ui = new UiRoot(document.body, { unstyled: true });
  const store = new FlakyStore();
  const clock = { now: T0 };
  const w = world(5);
  const loads: Omit<PendingLoad, 'requestedAt'>[] = [];
  const readouts: SaveMenuReadout[] = [];
  const warnings: string[] = [];
  const newGame = vi.fn();
  const registry = createGameSaveRegistry();
  const menuOptions: SaveMenusOptions = {
    ui,
    world: w,
    store,
    registry,
    build,
    now: () => clock.now,
    describe: () => ({ characterName: 'Knight', classId: 'knight', areaId: 'testbed' }),
    load: (load) => loads.push(load),
    newGame,
    ...(options.captureThumbnail !== undefined && { captureThumbnail: options.captureThumbnail }),
    ...(options.warning !== undefined && { warning: options.warning }),
    ...(options.quiet !== true && {
      publish: (readout: SaveMenuReadout) => readouts.push(readout),
      warn: (message: string) => warnings.push(message),
    }),
  };
  const menus = new SaveMenus(menuOptions);
  return { ui, store, clock, world: w, registry, menus, loads, readouts, warnings, newGame };
}

type Session = ReturnType<typeof setup>;

/** Writes the session's world (at `tick`) into `slot` at wall-clock `at`, with slot metadata. */
async function saveAt(s: Session, slot: SlotId, tick: number, at: number, metadata = true) {
  s.world.restore({ ...s.world.snapshot(), clock: { tick, hz: 60 } });
  const bytes = s.registry.write(s.world, {
    build,
    wallClockSavedAt: at,
    metadata: metadata
      ? {
          characterName: 'Knight',
          classId: 'knight',
          areaId: 'testbed',
          playtimeTicks: tick,
          tickRateHz: 60,
          thumbnail: null,
        }
      : {},
    preserve: {},
  });
  await s.store.inner.write(slot, bytes);
}

/** Lets the async menu flows (storage, dialogs) run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const screenOpen = (id: string): boolean =>
  document.querySelector(`[data-screen="${id}"]`) !== null;

const rows = (): { slot: string; text: string; actions: string[] }[] =>
  [...document.querySelectorAll<HTMLElement>('[data-slot]')].map((row) => ({
    slot: row.dataset['slot'] ?? '',
    text: row.querySelector('[data-action="choose"]')?.textContent ?? '',
    actions: [...row.querySelectorAll<HTMLElement>('[data-action]')].map(
      (el) => el.dataset['action'] ?? '',
    ),
  }));

/** Clicks a row action, e.g. `act('manual-1', 'delete')`. */
function act(slot: string, action: 'choose' | 'delete'): void {
  const el = document.querySelector<HTMLElement>(`[data-slot="${slot}"] [data-action="${action}"]`);
  if (el === null) throw new Error(`no ${action} on ${slot}`);
  el.click();
}

/** Answers the open confirmation dialog. */
function answer(confirm: boolean): { title: string; body: string } {
  const dialog = document.querySelector('[data-screen="confirm"]');
  if (dialog === null) throw new Error('no confirmation dialog');
  const result = {
    title: dialog.querySelector('h2')?.textContent ?? '',
    body: dialog.querySelector('p')?.textContent ?? '',
  };
  const buttons = dialog.querySelectorAll('button');
  // Focus starts on Cancel (first), Confirm second.
  expect(document.activeElement).toBe(buttons[0]);
  buttons[confirm ? 1 : 0]?.click();
  return result;
}

const text = (testid: string): string =>
  document.querySelector(`[data-testid="${testid}"]`)?.textContent ?? '';

describe('title menu', () => {
  it('AC-1: with saves, Continue is focused and loads the most recent save', async () => {
    const s = setup();
    await saveAt(s, 'auto-1', 30, T0 - 10 * MIN);
    await saveAt(s, 'manual-1', 60, T0 - 2 * MIN);
    const menu = await s.menus.openTitle();
    expect(document.activeElement).toBe(menu.continueButton);
    expect(s.readouts.at(-1)).toEqual({ kind: 'title', saves: 2, last: 'manual-1' });
    expect(document.querySelector('.vb-title-last')?.textContent).toBe(
      'Last save: Manual save 1 · Knight · testbed · 0:01 played · 2 min ago',
    );
    menu.continueButton.click();
    expect(s.loads).toEqual([{ slot: 'manual-1', areaId: 'testbed' }]);
    expect(screenOpen(LOADING_SCREEN)).toBe(true);
  });

  it('AC-2: with no saves, Continue is disabled with "No saves yet"; New Game and Load still work', async () => {
    const s = setup();
    const menu = await s.menus.openTitle();
    expect(menu.continueButton.getAttribute('aria-disabled')).toBe('true');
    expect(menu.continueButton.dataset['reason']).toBe('No saves yet');
    expect(document.activeElement?.textContent).toBe('New Game');
    expect(s.readouts.at(-1)).toEqual({ kind: 'title', saves: 0, last: null });
    menu.continueButton.click();
    expect(s.loads).toEqual([]);
    expect(text('title-build')).toBe('Build abc1234');
    document.querySelector<HTMLElement>('[data-action="load"]')?.click();
    await flush();
    expect(s.ui.top?.id).toBe(SAVE_SLOTS_SCREEN);
    expect(text('save-slots-empty')).toMatch(/^No saves yet/);
    // Back returns to the title menu.
    s.ui.intent('back', 'keyboard');
    expect(s.ui.top?.id).toBe(TITLE_SCREEN);
  });

  it('mw-e01.2: New Game closes the title menu, then hands over to class selection', async () => {
    const s = setup();
    let topWhenCalled: string | undefined = 'unset';
    s.newGame.mockImplementation(() => {
      topWhenCalled = s.ui.top?.id;
    });
    await s.menus.openTitle();
    expect(document.activeElement?.textContent).toBe('New Game');
    s.ui.intent('confirm', 'keyboard');
    expect(s.newGame).toHaveBeenCalledOnce();
    expect(topWhenCalled).toBeUndefined();
    expect(s.ui.top).toBeUndefined();
  });

  it('mw-e31.11 AC-3: the Back handed to New Game returns to the title menu', async () => {
    const s = setup();
    let back: (() => void) | undefined;
    s.newGame.mockImplementation((handed: () => void) => {
      back = handed;
    });
    await s.menus.openTitle();
    s.ui.intent('confirm', 'keyboard');
    expect(s.ui.top).toBeUndefined();
    back?.();
    await vi.waitFor(() => {
      expect(s.ui.top?.id).toBe(TITLE_SCREEN);
    });
  });

  it('when saves cannot be read, Continue is disabled with that reason and a warning is logged', async () => {
    const s = setup();
    s.store.failList = true;
    const menu = await s.menus.openTitle();
    expect(menu.continueButton.dataset['reason']).toBe(SAVE_MENU_MESSAGES.unreadable);
    expect(s.warnings).toEqual([expect.stringMatching(/^title menu: could not list saves/)]);
  });
});

describe('Load screen', () => {
  it('lists every save most recent first, with thumbnails, then slots that cannot load', async () => {
    const s = setup({
      captureThumbnail: () => ({ mimeType: 'image/png', width: 4, height: 4, bytes: PNG }),
    });
    await saveAt(s, 'auto-1', 30, T0 - 10 * MIN);
    await saveAt(s, 'quick', 90, T0 - 1 * MIN, false);
    // A thumbnail: saved through the Save screen.
    s.clock.now = T0 - 5 * MIN;
    const save = await s.menus.openSave();
    act('manual-1', 'choose');
    await flush();
    save.screen.close();
    s.clock.now = T0;
    // A slot with nothing readable at all (no backup to restore).
    await s.store.inner.write('manual-3', new Uint8Array([1, 2, 3]));

    await s.menus.openLoad();
    expect(s.readouts.at(-1)).toEqual({ kind: 'list', mode: 'load', slots: 4 });
    expect(rows().map((r) => r.slot)).toEqual(['quick', 'manual-1', 'auto-1', 'manual-3']);
    expect(rows()[0]?.text).toBe('Quicksave1 min agoLoad');
    expect(document.querySelector('[data-slot="manual-1"] img')?.getAttribute('src')).toBe(
      thumbnailUrl({ mimeType: 'image/png', width: 4, height: 4, bytes: PNG }),
    );
    expect(document.querySelector('[data-slot="auto-1"] img')).toBeNull();
    const broken = document.querySelector<HTMLElement>(
      '[data-slot="manual-3"] [data-action="choose"]',
    );
    expect(broken?.dataset['reason']).toBe(SAVE_MENU_MESSAGES.unloadable);

    // The damaged slot does nothing; a save without slot metadata loads into any area.
    act('manual-3', 'choose');
    expect(s.loads).toEqual([]);
    act('quick', 'choose');
    expect(s.loads).toEqual([{ slot: 'quick', areaId: undefined }]);
    expect(screenOpen(LOADING_SCREEN)).toBe(true);
  });

  it('deletes a save only after confirmation, then drops its row', async () => {
    const s = setup();
    await saveAt(s, 'manual-1', 30, T0 - MIN);
    await saveAt(s, 'auto-1', 30, T0 - 2 * MIN);
    await s.menus.openLoad();
    act('manual-1', 'delete');
    await flush();
    expect(answer(false)).toEqual({
      title: 'Delete save?',
      body: 'Manual save 1 and its backup will be deleted. This cannot be undone.',
    });
    await flush();
    expect(await s.store.list()).toEqual(['auto-1', 'manual-1']);

    act('manual-1', 'delete');
    await flush();
    answer(true);
    await flush();
    expect(await s.store.list()).toEqual(['auto-1']);
    expect(rows().map((r) => r.slot)).toEqual(['auto-1']);
    expect(text('save-slots-status')).toBe('Deleted Manual save 1');
    expect(s.readouts.slice(-2)).toEqual([
      { kind: 'deleted', slot: 'manual-1' },
      { kind: 'list', mode: 'load', slots: 1 },
    ]);
    // Focus moved to the remaining row.
    expect(
      (document.activeElement as HTMLElement).closest<HTMLElement>('[data-slot]')?.dataset['slot'],
    ).toBe('auto-1');
  });

  it('shows a storage failure as an error instead of an empty list', async () => {
    const s = setup();
    s.store.failList = true;
    await s.menus.openLoad();
    expect(rows()).toEqual([]);
    expect(text('save-slots-error')).toBe(
      'Saves could not be read: save storage failed to list saves: blocked',
    );
  });
});

describe('Save screen', () => {
  it('lists the ten manual slots; an empty one saves at once, an occupied one asks first', async () => {
    const s = setup();
    await s.store.inner.write('manual-2', new Uint8Array([9]));
    await s.menus.openSave();
    expect(rows()).toHaveLength(MANUAL_SLOT_COUNT);
    expect(rows()[0]).toEqual({
      slot: 'manual-1',
      text: 'Manual save 1Empty slotSave here',
      actions: ['choose'],
    });
    expect(rows()[1]?.text).toBe('Manual save 2Damaged saveSave here');

    act('manual-1', 'choose');
    await flush();
    expect(screenOpen('confirm')).toBe(false);
    expect(s.readouts.slice(-2)).toEqual([
      { kind: 'saved', slot: 'manual-1', tick: 5, hash: hashWorld(s.world) },
      { kind: 'list', mode: 'save', slots: MANUAL_SLOT_COUNT },
    ]);
    expect(text('save-slots-status')).toBe('Saved to Manual save 1');
    expect(rows()[0]?.actions).toEqual(['choose', 'delete']);
    expect(rows()[0]?.text).toBe('Manual save 1Knight · testbed · 0:00 played · just nowSave here');
    const first = (await s.store.read('manual-1')).status === 'ok';
    expect(first).toBe(true);

    // Overwriting asks; Cancel writes nothing.
    s.world.restore({ ...s.world.snapshot(), clock: { tick: 600, hz: 60 } });
    act('manual-1', 'choose');
    await flush();
    expect(answer(false)).toEqual({
      title: 'Overwrite save?',
      body: 'Manual save 1 will be replaced by this save. This cannot be undone.',
    });
    await flush();
    expect(s.readouts.at(-1)?.kind).toBe('list');
    expect(rows()[0]?.text).toContain('0:00 played');

    act('manual-1', 'choose');
    await flush();
    answer(true);
    await flush();
    expect(s.readouts.at(-2)).toEqual({
      kind: 'saved',
      slot: 'manual-1',
      tick: 600,
      hash: hashWorld(s.world),
    });
    expect(rows()[0]?.text).toContain('0:10 played');
    expect(text('save-slots-status')).toBe('Overwrote Manual save 1');
    // The replaced save is the backup.
    expect((await s.store.read('manual-1', 'backup')).status).toBe('ok');
  });

  it('shows a failed save as an error and keeps the slot as it was', async () => {
    const s = setup();
    await s.menus.openSave();
    s.store.failWrite = new SaveQuotaError(new Error('full'));
    act('manual-1', 'choose');
    await flush();
    expect(text('save-slots-error')).toMatch(
      /^Could not save to Manual save 1: not enough storage space to save; free up space/,
    );
    expect(text('save-slots-status')).toBe('');
    expect(await s.store.list()).toEqual([]);
  });

  it('shows a failed delete as an error', async () => {
    const s = setup();
    await saveAt(s, 'manual-1', 30, T0);
    await s.menus.openSave();
    // Not every failure is an Error: a polyfilled store can reject with anything.
    s.store.failDelete = Object.assign(Object.create(null) as Error, {
      toString: () => 'database closed',
    });
    act('manual-1', 'delete');
    await flush();
    answer(true);
    await flush();
    expect(text('save-slots-error')).toBe('Could not delete Manual save 1: database closed');
    expect(await s.store.list()).toEqual(['manual-1']);
  });

  it('when the list cannot be read back after a save, says so', async () => {
    const s = setup();
    await s.menus.openSave();
    s.store.afterWrite = () => {
      s.store.failRead = true;
    };
    act('manual-1', 'choose');
    await flush();
    expect(rows()).toEqual([]);
    expect(text('save-slots-error')).toMatch(/^Saves could not be read/);
  });

  it('a second press while a save is in flight is ignored', async () => {
    const s = setup();
    await saveAt(s, 'manual-1', 30, T0);
    await s.menus.openSave();
    act('manual-1', 'choose');
    await flush();
    act('manual-1', 'delete');
    await flush();
    expect(document.querySelectorAll('[data-screen="confirm"]')).toHaveLength(1);
    answer(false);
    await flush();
  });

  it('works without publish, warn or a thumbnail capture', async () => {
    const s = setup({ quiet: true });
    s.store.failList = true;
    await s.menus.openTitle();
    s.store.failList = false;
    await s.menus.openSave();
    act('manual-1', 'choose');
    await flush();
    act('manual-1', 'delete');
    await flush();
    answer(true);
    await flush();
    expect(await s.store.list()).toEqual([]);
    expect(s.readouts).toEqual([]);
  });
});

describe('open', () => {
  it('opens the menu ?menu= names', async () => {
    const s = setup();
    await s.menus.open('title');
    expect(s.ui.top?.id).toBe(TITLE_SCREEN);
    await s.menus.open('load');
    expect(s.ui.top?.element.querySelector('[data-mode="load"]')).not.toBeNull();
    await s.menus.open('save');
    expect(s.ui.top?.element.querySelector('[data-mode="save"]')).not.toBeNull();
  });
});

describe('thumbnailUrl', () => {
  it('encodes the image bytes as a data URL of their type', () => {
    expect(thumbnailUrl({ mimeType: 'image/png', width: 1, height: 1, bytes: PNG })).toBe(
      `data:image/png;base64,${btoa(String.fromCharCode(...PNG))}`,
    );
    const big = new Uint8Array(20_000).fill(65);
    expect(thumbnailUrl({ mimeType: 'image/webp', width: 1, height: 1, bytes: big })).toBe(
      `data:image/webp;base64,${btoa('A'.repeat(20_000))}`,
    );
  });
});
