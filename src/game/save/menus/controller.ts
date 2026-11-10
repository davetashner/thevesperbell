// The save menus (mw-e30.11): the title menu (Continue, New Game, Load) and the Load and Save slot
// screens the title menu and the pause menu (mw-e01.3) open. The screens are src/ui/save-menus.ts;
// this joins them to the save slots. Continue and Load hand the chosen save to `load`, which in the
// game is DeathReload.reload (mw-e30.7): the page reloads into the save's area and loads it there
// through corruption recovery, exactly as the death screen does. Saving goes through the slot
// manager's rules: an occupied slot is only overwritten, and a save only deleted, after the player
// confirmed in a dialog (focus starts on Cancel). Storage failures show on the screen as errors,
// never as a silently missing save, and while saves live only in memory every slot screen says so.
// Nothing here steps the sim: the screens pause it, and saves happen between frames.

import { hashWorld, type World } from '@sim/index';
import {
  confirmDialog,
  openLoadingScreen,
  openSlotList,
  openTitleMenu,
  type SlotEntry,
  type SlotList,
  type SlotListMessage,
  type TitleMenu,
  type UiRoot,
} from '@ui/index';
import { deathSaveEntry, slotName } from '../death/controller';
import { findSaves, type SaveChoice } from '../death/last-save';
import type { PendingLoad } from '../death/pending';
import type { BuildInfo, SaveRegistry } from '../format/index';
import {
  MANUAL_SLOTS,
  SaveSlots,
  type SlotDescription,
  type SlotId,
  type SlotSummary,
  type SlotThumbnail,
  type ThumbnailCapture,
} from '../slots/index';
import type { SaveStore } from '../storage/index';
import type { SaveMenuId } from './request';

/** What the e2e and debug tools read back (published as JSON on #app[data-save-menu]). */
export type SaveMenuReadout =
  /** The title menu opened; `last` is the save Continue loads (null: Continue is disabled). */
  | { readonly kind: 'title'; readonly saves: number; readonly last: SlotId | null }
  /** A slot list opened or was redrawn, with `slots` rows. */
  | { readonly kind: 'list'; readonly mode: 'load' | 'save'; readonly slots: number }
  /** The Save screen wrote `slot`: the tick saved and the world's state hash then. */
  | { readonly kind: 'saved'; readonly slot: SlotId; readonly tick: number; readonly hash: string }
  /** The player deleted `slot`. */
  | { readonly kind: 'deleted'; readonly slot: SlotId };

export interface SaveMenusOptions {
  readonly ui: UiRoot;
  readonly world: World<never>;
  readonly store: SaveStore;
  /** Usually `createGameSaveRegistry()`. */
  readonly registry: SaveRegistry;
  readonly build: BuildInfo;
  /** Wall-clock milliseconds since the Unix epoch. */
  readonly now: () => number;
  /** Who and where the player is, for saves. */
  readonly describe: () => SlotDescription;
  /** Captures the save's thumbnail; omitted or failing saves with the placeholder. */
  readonly captureThumbnail?: ThumbnailCapture | undefined;
  /** Set while saves live only in memory (`OpenedSaveStore.warning`); every slot screen shows it. */
  readonly warning?: string | undefined;
  /** Loads a save: in the game, DeathReload.reload (the page reloads into the save's area). */
  readonly load: (load: Omit<PendingLoad, 'requestedAt'>) => void;
  /** New Game on the title menu, called once the title menu has closed. */
  readonly newGame: (back: () => void) => void;
  readonly publish?: (readout: SaveMenuReadout) => void;
  readonly warn?: (message: string) => void;
}

export const SAVE_MENU_MESSAGES = Object.freeze({
  emptySlot: 'Empty slot',
  damaged: 'Damaged save',
  unloadable: 'Damaged, and no backup could be read',
  unreadable: 'Saves could not be read',
  overwriteTitle: 'Overwrite save?',
  overwriteConfirm: 'Overwrite',
  deleteTitle: 'Delete save?',
  deleteConfirm: 'Delete',
});

/** A thumbnail as an image URL for the slot list. */
export function thumbnailUrl(thumbnail: SlotThumbnail): string {
  let binary = '';
  for (let i = 0; i < thumbnail.bytes.length; i += 8192) {
    binary += String.fromCharCode(...thumbnail.bytes.subarray(i, i + 8192));
  }
  return `data:${thumbnail.mimeType};base64,${btoa(binary)}`;
}

/** A row of the Load or Save screen; `save` is set when choosing the row can load it. */
export interface MenuSlotEntry extends SlotEntry {
  readonly id: SlotId;
  readonly save?: SaveChoice | undefined;
}

/** A save as the Load screen lists it. */
export function loadEntry(save: SaveChoice, now: number): MenuSlotEntry {
  const { title, detail } = deathSaveEntry(save, now);
  const thumbnail = save.details?.thumbnail;
  return {
    id: save.slot,
    title,
    detail,
    empty: false,
    thumbnail: thumbnail === undefined || thumbnail === null ? undefined : thumbnailUrl(thumbnail),
    save,
  };
}

/** A manual slot as the Save screen lists it. */
export function saveEntry(summary: SlotSummary, now: number): MenuSlotEntry {
  const title = slotName(summary.slot);
  switch (summary.state) {
    case 'empty':
      return { id: summary.slot, title, detail: SAVE_MENU_MESSAGES.emptySlot, empty: true };
    case 'unreadable':
      return { id: summary.slot, title, detail: SAVE_MENU_MESSAGES.damaged, empty: false };
    case 'ready':
      return loadEntry({ ...summary, damaged: false }, now);
  }
}

/** Player-facing text for a storage failure. */
function failure(action: string, error: unknown): string {
  return `${action}: ${error instanceof Error ? error.message : String(error)}`;
}

/** A slot list's rows, or why they could not be read. */
interface Rows {
  readonly entries: MenuSlotEntry[];
  readonly error?: string;
}

type Mode = 'load' | 'save';

/** The title menu and the Load / Save screens over one save store. */
export class SaveMenus {
  private readonly slots: SaveSlots;
  private busy = false;

  constructor(private readonly options: SaveMenusOptions) {
    const { store, registry, build, now } = options;
    this.slots = new SaveSlots({ store, registry, build, now });
  }

  /** Opens one of the menus (`?menu=` at boot). */
  async open(menu: SaveMenuId): Promise<void> {
    if (menu === 'title') await this.openTitle();
    else if (menu === 'load') await this.openLoad();
    else await this.openSave();
  }

  /**
   * Opens the title menu. Continue loads the most recent save of any kind (as "Load last save" does);
   * with none, or when saves cannot be read, it is disabled with the reason. New Game closes the menu
   * and hands over to `newGame` (class selection, mw-e01.2). The build SHA shows under the menu.
   */
  async openTitle(): Promise<TitleMenu> {
    let saves: SaveChoice[] = [];
    let unavailable: string | undefined;
    try {
      saves = await findSaves(this.options.store);
    } catch (error) {
      unavailable = SAVE_MENU_MESSAGES.unreadable;
      this.warn(`title menu: could not list saves (${String(error)})`);
    }
    const last = saves[0];
    const menu: TitleMenu = openTitleMenu(this.options.ui, {
      last: last === undefined ? undefined : { ...deathSaveEntry(last, this.options.now()), last },
      unavailable,
      build: this.options.build.buildSha,
      onContinue: (entry) => {
        this.loadSave(entry.last);
      },
      onNewGame: () => {
        menu.screen.close();
        // `back` is class selection's Back: it returns to this title menu.
        this.options.newGame(() => {
          void this.openTitle();
        });
      },
      onLoad: () => {
        void this.openLoad();
      },
    });
    this.emit({ kind: 'title', saves: saves.length, last: last?.slot ?? null });
    return menu;
  }

  /** Opens the Load screen: every save, most recent first, then damaged slots that cannot load. */
  openLoad(): Promise<SlotList<MenuSlotEntry>> {
    return this.openList('load', (entry) => {
      if (entry.save !== undefined) this.loadSave(entry.save);
    });
  }

  /** Opens the Save screen: the ten manual slots in order. */
  openSave(): Promise<SlotList<MenuSlotEntry>> {
    return this.openList('save', (entry, list) => {
      void this.save(list, entry.id);
    });
  }

  private async openList(
    mode: Mode,
    choose: (entry: MenuSlotEntry, list: SlotList<MenuSlotEntry>) => void,
  ): Promise<SlotList<MenuSlotEntry>> {
    const rows = await this.read(mode);
    const list: SlotList<MenuSlotEntry> = openSlotList(this.options.ui, {
      mode,
      entries: rows.entries,
      warning: this.options.warning,
      error: rows.error,
      onChoose: (entry) => {
        choose(entry, list);
      },
      onDelete: (entry) => {
        void this.remove(list, mode, entry.id);
      },
    });
    this.emit({ kind: 'list', mode, slots: rows.entries.length });
    return list;
  }

  private loadSave(save: SaveChoice): void {
    openLoadingScreen(this.options.ui);
    this.options.load({ slot: save.slot, areaId: save.details?.areaId });
  }

  private async read(mode: Mode): Promise<Rows> {
    const now = this.options.now();
    try {
      if (mode === 'save') {
        const summaries = await this.slots.list(MANUAL_SLOTS);
        return { entries: summaries.map((summary) => saveEntry(summary, now)) };
      }
      const saves = await findSaves(this.options.store);
      const listed = new Set<string>(saves.map((save) => save.slot));
      const lost = (await this.slots.list()).filter(
        (summary) => summary.state === 'unreadable' && !listed.has(summary.slot),
      );
      return {
        entries: [
          ...saves.map((save) => loadEntry(save, now)),
          ...lost.map((summary) => ({
            ...saveEntry(summary, now),
            unavailable: SAVE_MENU_MESSAGES.unloadable,
          })),
        ],
      };
    } catch (error) {
      return { entries: [], error: failure(SAVE_MENU_MESSAGES.unreadable, error) };
    }
  }

  /** Saves into `slot`, asking first when that would overwrite a save. */
  private async save(list: SlotList<MenuSlotEntry>, slot: SlotId): Promise<void> {
    await this.exclusive(async () => {
      const { world, captureThumbnail } = this.options;
      const input = {
        ...this.options.describe(),
        ...(captureThumbnail !== undefined && { captureThumbnail }),
      };
      let message: SlotListMessage;
      try {
        const outcome = await this.slots.save(slot, world, input);
        if (outcome.status === 'confirm-overwrite') {
          const confirmed = await this.confirm(
            SAVE_MENU_MESSAGES.overwriteTitle,
            `${slotName(slot)} will be replaced by this save. This cannot be undone.`,
            SAVE_MENU_MESSAGES.overwriteConfirm,
          );
          if (!confirmed) return;
          await this.slots.save(slot, world, input, { overwrite: true });
        }
        message = {
          status:
            outcome.status === 'confirm-overwrite'
              ? `Overwrote ${slotName(slot)}`
              : `Saved to ${slotName(slot)}`,
        };
        this.emit({ kind: 'saved', slot, tick: world.tick, hash: hashWorld(world) });
      } catch (error) {
        message = { error: failure(`Could not save to ${slotName(slot)}`, error) };
      }
      await this.redraw(list, 'save', message);
    });
  }

  /** Deletes `slot` once the player confirmed. */
  private async remove(list: SlotList<MenuSlotEntry>, mode: Mode, slot: SlotId): Promise<void> {
    await this.exclusive(async () => {
      const confirmed = await this.confirm(
        SAVE_MENU_MESSAGES.deleteTitle,
        `${slotName(slot)} and its backup will be deleted. This cannot be undone.`,
        SAVE_MENU_MESSAGES.deleteConfirm,
      );
      if (!confirmed) return;
      let message: SlotListMessage;
      try {
        await this.slots.delete(slot, { confirmed: true });
        message = { status: `Deleted ${slotName(slot)}` };
        this.emit({ kind: 'deleted', slot });
      } catch (error) {
        message = { error: failure(`Could not delete ${slotName(slot)}`, error) };
      }
      await this.redraw(list, mode, message);
    });
  }

  private async redraw(
    list: SlotList<MenuSlotEntry>,
    mode: Mode,
    message: SlotListMessage,
  ): Promise<void> {
    const rows = await this.read(mode);
    list.update(rows.entries, rows.error === undefined ? message : { error: rows.error });
    this.emit({ kind: 'list', mode, slots: rows.entries.length });
  }

  private confirm(title: string, body: string, confirmLabel: string): Promise<boolean> {
    return confirmDialog(this.options.ui, {
      title,
      body,
      confirmLabel,
      destructive: true,
      pausesSim: true,
    });
  }

  /** Runs one save or delete at a time; a press while one is in flight is ignored. */
  private async exclusive(action: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await action();
    } finally {
      this.busy = false;
    }
  }

  private emit(readout: SaveMenuReadout): void {
    this.options.publish?.(readout);
  }

  private warn(message: string): void {
    this.options.warn?.(message);
  }
}
