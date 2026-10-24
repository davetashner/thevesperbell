// The give-item command (mw-ju8.17): the debug console's `give <itemId> [n]` puts items in an actor's
// pack. Like every input it is plain JSON fed to `World.step`, so a recording replays it on the same
// tick. The pack rules (stacking, limits) are `InventoryRules.add`'s; this system only calls it.

import type { EntityId } from '../core/component';
import type { World } from '../core/world';
import { inventoryOf, type InventoryRules } from '../inventory/inventory';

/** The `give-item` input command: `actor` receives `count` of item `item`. */
export interface GiveItemCommand {
  readonly type: 'give-item';
  readonly actor: EntityId;
  readonly item: string;
  readonly count: number;
}

/** Builds the command that gives `actor` `count` of `item`. */
export function giveItemCommand(actor: EntityId, item: string, count = 1): GiveItemCommand {
  return { type: 'give-item', actor, item, count };
}

/** Whether an input command is a give-item command. */
export function isGiveItemCommand(input: unknown): input is GiveItemCommand {
  return (
    typeof input === 'object' &&
    input !== null &&
    (input as { type?: unknown }).type === 'give-item'
  );
}

/** The pack rules and item catalogue a give-item command works through. */
export interface ItemGiver {
  readonly inventory: Pick<InventoryRules, 'add'>;
  /** Whether `item` is a defined item. */
  readonly known: (item: string) => boolean;
}

/**
 * Carries out `command` through `giver`. An item `known` rejects, a bad count, and an actor that is
 * gone or has no pack are ignored (a stale command from a recording must not throw), as is anything
 * the pack refuses. Run by the inventory action system, so it adds no system of its own.
 */
export function giveItems(world: World<never>, command: GiveItemCommand, giver: ItemGiver): void {
  if (!giver.known(command.item)) return;
  if (!Number.isSafeInteger(command.count) || command.count < 1) return;
  if (!world.isAlive(command.actor) || inventoryOf(world, command.actor) === undefined) return;
  giver.inventory.add(world, command.actor, command.item, command.count);
}
