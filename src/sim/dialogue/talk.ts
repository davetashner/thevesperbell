// Who will talk (mw-e22.9): the rule that keeps the Interact verb's Talk off an NPC that refuses.
// A hostile NPC talks only when its dialogue has an entry written for that state (a parley, see
// `DialogueRuntime.canParley`); otherwise Talk is offered greyed with the reason below and starts
// nothing. Talk on anything that is not a talkable NPC (a shop counter) is none of this rule's
// business.

import type { EntityId } from '../core/component';
import type { World } from '../core/world';
import { addAffordanceGate } from '../interaction/system';

/** The prompt's reason when an NPC will not talk. */
export const WONT_TALK = 'They won’t talk to you.';

/** What the rule reads of the game. */
export interface TalkRules {
  /** The dialogue and NPC id of a talkable NPC; undefined for anything else. */
  talkable(entity: EntityId): { readonly dialogue: string; readonly npc: string } | undefined;
  /** Whether the NPC is hostile to the player now (its disposition band). */
  hostile(entity: EntityId): boolean;
  /** Whether the dialogue has an entry for a hostile NPC that holds now. */
  canParley(dialogue: string, npc: string): boolean;
}

/** Why `entity` will not talk, or undefined when it will (or is not an NPC to talk to). */
export function talkRefusal(rules: TalkRules, entity: EntityId): string | undefined {
  const talkable = rules.talkable(entity);
  if (talkable === undefined) return undefined;
  if (rules.hostile(entity) && !rules.canParley(talkable.dialogue, talkable.npc)) return WONT_TALK;
  return undefined;
}

/** Adds the rule to `world`'s Interact verb; returns a function that removes it. */
export function installTalkGate(world: World<never>, rules: TalkRules): () => void {
  return addAffordanceGate(world, (_world, _actor, target, affordance) =>
    affordance.verb === 'talk' ? talkRefusal(rules, target) : undefined,
  );
}
