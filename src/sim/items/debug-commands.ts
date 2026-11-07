// The debug console's item commands beyond `give` (mw-e17.12): `item.remove`, `equip` and `gold`. Like
// every input they are plain JSON fed to `World.step`, so a recording replays them on the same tick.
// The rules are the inventory's and the equipment's; these only call them. Stale commands (an item
// the catalogue lacks, an actor that is gone or has no pack, a refusal) are ignored, never thrown.

import type { EntityId } from '../core/component';
import type { World } from '../core/world';
import { equipmentOf, type EquipmentRules } from '../inventory/equipment';
import { inventoryOf } from '../inventory/inventory';
import type { ItemGiver } from './give-command';

/** `actor` loses `count` units of `item` (clean or stolen, newest first). */
export interface RemoveItemCommand {
  readonly type: 'remove-item';
  readonly actor: EntityId;
  readonly item: string;
  readonly count: number;
}

/** `actor` equips the first held instance of `item`. */
export interface EquipItemCommand {
  readonly type: 'equip-item';
  readonly actor: EntityId;
  readonly item: string;
}

/** `actor`'s gold changes by `amount` (negative spends, down to nothing). */
export interface GiveGoldCommand {
  readonly type: 'give-gold';
  readonly actor: EntityId;
  readonly amount: number;
}

export type ItemDebugCommand = RemoveItemCommand | EquipItemCommand | GiveGoldCommand;

export const removeItemCommand = (actor: EntityId, item: string, count = 1): RemoveItemCommand => ({
  type: 'remove-item',
  actor,
  item,
  count,
});

export const equipItemCommand = (actor: EntityId, item: string): EquipItemCommand => ({
  type: 'equip-item',
  actor,
  item,
});

export const giveGoldCommand = (actor: EntityId, amount: number): GiveGoldCommand => ({
  type: 'give-gold',
  actor,
  amount,
});

/** Whether an input command is an item debug command. */
export function isItemDebugCommand(input: unknown): input is ItemDebugCommand {
  if (typeof input !== 'object' || input === null) return false;
  const type = (input as { type?: unknown }).type;
  return type === 'remove-item' || type === 'equip-item' || type === 'give-gold';
}

/** Carries out `command` through `giver` (and `equipment` for equip); see the file header. */
export function runItemDebugCommand(
  world: World<never>,
  command: ItemDebugCommand,
  giver: ItemGiver,
  equipment?: EquipmentRules,
): void {
  const pack = world.isAlive(command.actor) ? inventoryOf(world, command.actor) : undefined;
  if (pack === undefined) return;
  switch (command.type) {
    case 'give-gold': {
      const { amount } = command;
      if (!Number.isSafeInteger(amount) || amount === 0) return;
      if (amount > 0) giver.inventory.addGold(world, command.actor, amount);
      else if (pack.gold > 0)
        giver.inventory.spendGold(world, command.actor, Math.min(-amount, pack.gold));
      return;
    }
    case 'remove-item': {
      if (!giver.known(command.item)) return;
      if (!Number.isSafeInteger(command.count) || command.count < 1) return;
      giver.inventory.remove(world, command.actor, {
        defId: command.item,
        count: command.count,
      });
      return;
    }
    case 'equip-item': {
      const held = pack.items.find((item) => item.defId === command.item);
      if (held !== undefined && equipmentOf(world, command.actor) !== undefined) {
        equipment?.equip(world, command.actor, held.instanceId);
      }
      return;
    }
  }
}
