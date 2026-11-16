// Who has a face (mw-e37.433): the dialogue box and the shop window show a character's approved
// concept portrait (public/assets/portrait/<id>.webp) when their creature names one in
// `presentation.portrait`. Characters without art keep the generic silhouette.

/** What a portrait lookup needs of a creature definition. */
export interface PortraitCreature {
  readonly id: string;
  readonly presentation: { readonly portrait?: string | undefined };
}

/** The portrait asset id of NPC creature `npc`, or undefined when it has none (or is no creature). */
export function npcPortrait(
  creatures: Iterable<PortraitCreature>,
  npc: string | undefined,
): string | undefined {
  if (npc === undefined) return undefined;
  for (const creature of creatures) {
    if (creature.id === npc) return creature.presentation.portrait;
  }
  return undefined;
}

/** What a dialogue's speaker list says of who speaks. */
export interface PortraitDialogue {
  readonly speakers: readonly {
    readonly id: string;
    readonly npc?: { readonly id: string } | undefined;
  }[];
}

/**
 * Resolves a dialogue's speaker id to a portrait asset id: speaker, then the NPC creature it
 * names, then that creature's `presentation.portrait`. The narrator, the player and NPCs
 * without art resolve to undefined.
 */
export function speakerPortraitResolver(
  dialogueOf: (dialogue: string) => PortraitDialogue | undefined,
  creatures: readonly PortraitCreature[],
): (dialogue: string, speaker: string) => string | undefined {
  return (dialogue, speaker) =>
    npcPortrait(creatures, dialogueOf(dialogue)?.speakers.find((s) => s.id === speaker)?.npc?.id);
}
