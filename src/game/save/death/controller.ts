// Death → reload (mw-e30.7). When the player dies, the death screen offers "Load last save" (the most
// recent save of any slot type, see last-save.ts) and "Load…", or "Restart area" when there is no
// save. Either choice tears the world down and builds it again: the page reloads into the save's area
// with a pending load (pending.ts), and on boot `resume` loads the save into the fresh world before
// the first sim step. The load goes through corruption recovery (mw-e30.8): a damaged save restores
// its backup and says so, a save with no good copy offers the next most recent one, and when nothing
// can be recovered the freshly built area is the restart. Nothing here steps the sim; loads happen
// between frames, while a pausing screen is open or before the loop starts.

import { hashWorld, type World } from '@sim/index';
import {
  confirmDialog,
  formatAge,
  formatPlaytime,
  openDeathScreen,
  openLoadingScreen,
  openSaveNotice,
  type DeathSaveEntry,
  type UiRoot,
} from '@ui/index';
import type { BuildInfo, SaveRegistry } from '../format/index';
import {
  SaveRecovery,
  type RecoveryLoadResult,
  type RecoveryMessage,
  type RecoveryOffer,
} from '../recovery/index';
import { SaveSlots, type SlotDescription, type SlotId } from '../slots/index';
import type { SaveStore } from '../storage/index';
import { findSaves, type SaveChoice } from './last-save';
import {
  clearPendingLoad,
  writePendingLoad,
  type PendingLoad,
  type PendingLoadStorage,
} from './pending';

/** What the e2e and debug tools read back (published as JSON on #app data attributes). */
export type DeathReloadReadout =
  /** The death screen opened, with `saves` loadable saves (0: Restart area). */
  | { readonly kind: 'death'; readonly saves: number; readonly last: SlotId | null }
  /** A debug save was written: its slot, the tick saved and the world's state hash then. */
  | { readonly kind: 'saved'; readonly slot: SlotId; readonly tick: number; readonly hash: string }
  /**
   * A save was loaded on boot: the recovery status, the tick and the state hash right after, and
   * when the player chose it (wall-clock ms; null when unknown), to time the reload.
   */
  | {
      readonly kind: 'loaded';
      readonly slot: SlotId;
      readonly status: 'loaded' | 'restored';
      readonly tick: number;
      readonly hash: string;
      readonly requestedAt: number | null;
    };

export interface DeathReloadOptions {
  readonly ui: UiRoot;
  readonly world: World<never>;
  readonly store: SaveStore;
  /** Usually `createGameSaveRegistry()`. */
  readonly registry: SaveRegistry;
  readonly build: BuildInfo;
  /** Wall-clock milliseconds since the Unix epoch. */
  readonly now: () => number;
  /** Session storage: the pending load crosses the reload here. */
  readonly session: PendingLoadStorage;
  /** The area (scene id) the world was built for; undefined when no scene loaded. */
  readonly areaId: string | undefined;
  /**
   * Reloads the page into `areaId`, or into the current area when undefined. With `classId` the new
   * game hand-off applies that class to the fresh world (Restart area), as `?class=` does.
   */
  readonly navigate: (areaId: string | undefined, classId?: string) => void;
  /**
   * The class chosen this session (mw-e19.5), the one on the player now; undefined when there is none
   * (state lost, or a scene booted without class selection).
   */
  readonly chosenClass: () => string | undefined;
  /** Leaves for the title screen (Restart area with no chosen class to restart as). */
  readonly toTitle: () => void;
  /** Who and where the player is, for saves. */
  readonly describe: () => SlotDescription;
  readonly publish?: (readout: DeathReloadReadout) => void;
  readonly warn?: (message: string) => void;
}

/** Display name of a slot: "Manual save 3", "Autosave 2", "Quicksave". */
export function slotName(slot: SlotId): string {
  if (slot === 'quick') return 'Quicksave';
  const [prefix, n] = slot.split('-') as [string, string];
  return prefix === 'auto' ? `Autosave ${n}` : `Manual save ${n}`;
}

/** A save as the death screen lists it. */
export function deathSaveEntry(save: SaveChoice, now: number): DeathSaveEntry {
  const { details } = save;
  const age = formatAge(now - save.savedAt);
  const parts =
    details === undefined
      ? [age]
      : [
          // The character (mw-e30.14): its class's display name; saves made before a class was
          // chosen have none.
          ...(details.characterName === '' ? [] : [details.characterName]),
          details.areaId,
          `${formatPlaytime(details.playtimeSeconds)} played`,
          age,
        ];
  if (save.damaged) parts.push('damaged: loads its backup');
  return { id: save.slot, title: details?.label ?? slotName(save.slot), detail: parts.join(' · ') };
}

/** The player-facing text for a recovery message. */
export function recoveryText(message: RecoveryMessage): { title: string; body: string } {
  switch (message.key) {
    case 'save.recovery.restored-backup':
      return {
        title: 'Save restored',
        body: `${slotName(message.params.slot)} was damaged, so its backup from ${formatAge(message.params.ageMs)} was loaded instead.`,
      };
    case 'save.recovery.restored-other':
      return {
        title: 'Save restored',
        body: `${slotName(message.params.slot)} was damaged, so ${slotName(message.params.from.slot)} from ${formatAge(message.params.ageMs)} was loaded instead.`,
      };
    case 'save.recovery.offer-other':
      return {
        title: 'Save damaged',
        body: `${slotName(message.params.slot)} and its backup are damaged. Load ${slotName(message.params.candidate.slot)} from ${formatAge(message.params.candidate.ageMs)} instead?`,
      };
    case 'save.recovery.unrecoverable':
      return {
        title: 'Save damaged',
        body: `No save could be recovered from ${slotName(message.params.slot)}. The area starts again from the beginning.`,
      };
    case 'save.recovery.newer-build': {
      const { slot, candidate } = message.params;
      const instead =
        candidate === undefined
          ? 'The area starts again from the beginning.'
          : `Load ${slotName(candidate.slot)} from ${formatAge(candidate.ageMs)} instead?`;
      return {
        title: 'Save from a newer version',
        body: `${slotName(slot)} needs a newer version of the game; it has not been changed. ${instead}`,
      };
    }
  }
}

/** The death screen, the reload hand-off and the load on boot. */
export class DeathReload {
  private readonly slots: SaveSlots;
  private readonly recovery: SaveRecovery;
  private dead = false;

  constructor(private readonly options: DeathReloadOptions) {
    const { store, registry, build, now } = options;
    this.slots = new SaveSlots({ store, registry, build, now });
    this.recovery = new SaveRecovery({ store, registry, now });
  }

  /**
   * The player died: opens the death screen (once). A save list that cannot be read counts as no
   * saves, so the player can always at least restart the area. `respawn` (the death beat's rule,
   * mw-e01.8) rides the pending load, so boot can announce the respawn once the save has loaded.
   */
  async playerDied(respawn?: PendingLoad['respawn']): Promise<void> {
    if (this.dead) return;
    this.dead = true;
    let saves: SaveChoice[] = [];
    try {
      saves = await findSaves(this.options.store);
    } catch (error) {
      this.warn(`death screen: could not list saves (${String(error)})`);
    }
    const now = this.options.now();
    openDeathScreen(this.options.ui, {
      saves: saves.map((save) => ({ ...deathSaveEntry(save, now), save })),
      onLoad: ({ save }) => {
        this.reload({
          slot: save.slot,
          areaId: save.details?.areaId,
          ...(respawn !== undefined && { respawn }),
        });
      },
      onRestart: () => {
        this.restart();
      },
    });
    this.options.publish?.({ kind: 'death', saves: saves.length, last: saves[0]?.slot ?? null });
  }

  /** Reloads the page into `load.areaId` and loads the save there. */
  reload(load: Omit<PendingLoad, 'requestedAt'>): void {
    writePendingLoad(this.options.session, { ...load, requestedAt: this.options.now() });
    this.options.navigate(load.areaId);
  }

  /**
   * Reloads the current area from its start, with no save (Restart area), through the New Game
   * hand-off: fresh world facts, the class chosen this session applied (mw-e01.16). With no chosen
   * class it warns and returns to the title instead.
   */
  restart(): void {
    clearPendingLoad(this.options.session);
    const classId = this.options.chosenClass();
    if (classId === undefined) {
      this.warn('restart area: no class was chosen this session, returning to the title');
      this.options.toTitle();
      return;
    }
    this.options.navigate(undefined, classId);
  }

  /**
   * Boot: loads the pending save (if any) into the freshly built world. Resolves once the world is in
   * its final state for the first sim step; notices and offers stay open (pausing the sim) after.
   * A load meant for another area, or a storage failure, leaves the fresh area as it is.
   */
  async resume(pending: PendingLoad | undefined): Promise<void> {
    if (pending === undefined) return;
    const { areaId } = this.options;
    if (pending.areaId !== undefined && pending.areaId !== areaId) {
      this.warn(`pending load of ${pending.slot} is for ${pending.areaId}, not ${String(areaId)}`);
      return;
    }
    let result: RecoveryLoadResult;
    try {
      result = await this.recovery.load(pending.slot, this.options.world);
    } catch (error) {
      this.warn(`could not load ${pending.slot} (${String(error)})`);
      return;
    }
    void this.settle(result, pending.requestedAt ?? null);
  }

  /**
   * Debug `save [slot]`: writes the world into `slot` (overwriting) and publishes the tick and state
   * hash it saved. Call between sim steps. It draws no thumbnail, so the world is written at once, at
   * the tick it published: a recorded run (mw-e01.9) saves the same state however slowly frames draw.
   */
  async debugSave(slot: SlotId): Promise<void> {
    const { world } = this.options;
    // The game's describe() also carries its thumbnail capture; a debug save leaves it out.
    const { characterName, classId, areaId } = this.options.describe();
    const input = { characterName, classId, areaId };
    // Capturing settles what a save never stores (a carried object is set down, mw-e17.14), so the
    // hash published is the world a load of this save returns, not the one before it was settled.
    const saved = this.slots.capture(world, input);
    const tick = world.tick;
    const hash = hashWorld(world);
    await saved.writeTo(slot);
    this.options.publish?.({ kind: 'saved', slot, tick, hash });
  }

  /** Shows what a recovery result needs; the first screen it opens is pushed synchronously. */
  private async settle(result: RecoveryLoadResult, requestedAt: number | null): Promise<void> {
    const { ui, world } = this.options;
    switch (result.status) {
      case 'loaded':
      case 'restored':
        this.options.publish?.({
          kind: 'loaded',
          slot: result.slot,
          status: result.status,
          tick: world.tick,
          hash: hashWorld(world),
          requestedAt,
        });
        if (result.status === 'restored') {
          await openSaveNotice(ui, {
            ...recoveryText(result.message),
            actions: [{ label: 'Continue' }],
          });
        }
        return;
      case 'empty':
        this.warn(`pending load of ${result.slot}: the slot is empty`);
        return;
      case 'offer':
        return this.offer(result);
      case 'newer-build':
        if (result.candidate !== undefined)
          return this.offer({ ...result, candidate: result.candidate });
        break;
      case 'unrecoverable':
        break;
    }
    // Nothing loadable: the fresh area is the restart.
    await openSaveNotice(ui, {
      ...recoveryText(result.message),
      actions: [{ label: 'Restart area' }],
    });
  }

  /** Offers another save; accepted, it loads here (or reloads into its area), else the area restarts. */
  private async offer(offer: RecoveryOffer): Promise<void> {
    const { ui, world } = this.options;
    const { title, body } = recoveryText(offer.message);
    const accepted = await confirmDialog(ui, {
      title,
      body,
      confirmLabel: 'Load it',
      cancelLabel: 'Restart area',
      pausesSim: true,
    });
    if (!accepted) return;
    const { candidate } = offer;
    const area = candidate.details?.areaId;
    if (area !== undefined && area !== this.options.areaId) {
      this.reload({ slot: candidate.slot, areaId: area });
      return;
    }
    const hold = openLoadingScreen(ui);
    let next: RecoveryLoadResult;
    try {
      next = await this.recovery.accept(offer, world);
    } catch (error) {
      this.warn(`could not load ${candidate.slot} (${String(error)})`);
      return;
    } finally {
      hold.close();
    }
    await this.settle(next, null);
  }

  private warn(message: string): void {
    this.options.warn?.(message);
  }
}
