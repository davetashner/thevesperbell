// Conversing NPCs (mw-e22.9): an NPC who is talking to the player does not run its routine. The
// `ai.conversing` component marks it; the AI system skips a marked agent entirely (no thinks, no
// steps, so it stands where it is, its alert machine and patrol route frozen as they were) until the
// mark is removed, when it thinks and walks again from where it stands. It turns to face the player
// when the conversation starts.
//
// The component is registered when the first conversation starts and unregistered when the last one
// ends, so a world that never talks has no `ai.conversing` store and hashes as before. Start and end
// conversations between sim steps (like the dialogue runtime itself).

import type { EntityId } from '../core/component';
import { defineComponent } from '../core/component';
import type { World } from '../core/world';
import { face } from './navigation';
import { getIf } from './util';

/** Who an NPC is talking to, and since when. */
export interface Conversing {
  /** The entity it is talking with. */
  readonly with: EntityId;
  /** The tick the conversation started. */
  readonly sinceTick: number;
}

/** The marker (`ai.conversing`; a snapshot key, never renamed). */
export const ConversingComponent = defineComponent<Conversing>('ai.conversing');

/** Whether `entity` is in a conversation (its routine is paused). */
export function isConversing(world: World<never>, entity: EntityId): boolean {
  return getIf(world, entity, ConversingComponent) !== undefined;
}

/** Every entity in a conversation, in entity order. */
export function conversingEntities(world: World<never>): EntityId[] {
  if (!world.isRegistered(ConversingComponent)) return [];
  const found: EntityId[] = [];
  world.query(ConversingComponent).forEach((entity) => {
    found.push(entity);
  });
  return found;
}

/**
 * Pauses `npc`'s routine and turns it to face `toward`, a horizontal direction (the caller, which
 * may see the partner, works it out: agent code never reads another entity's position). Does
 * nothing for an entity that is gone. Returns false when `npc` is already in a conversation.
 */
export function beginConversing(
  world: World<never>,
  npc: EntityId,
  partner: EntityId,
  toward?: { readonly x: number; readonly z: number },
): boolean {
  if (!world.isAlive(npc) || isConversing(world, npc)) return false;
  if (!world.isRegistered(ConversingComponent)) world.register(ConversingComponent);
  world.add(npc, ConversingComponent, Object.freeze({ with: partner, sinceTick: world.tick }));
  if (toward !== undefined) face(world, npc, toward.x, toward.z);
  return true;
}

/** Returns `npc` to its routine. Returns false when it was not in a conversation. */
export function endConversing(world: World<never>, npc: EntityId): boolean {
  if (!isConversing(world, npc)) return false;
  world.remove(npc, ConversingComponent);
  world.unregisterIfEmpty(ConversingComponent);
  return true;
}
