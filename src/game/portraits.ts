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
    readonly name?: string | undefined;
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

/** "npc-mags" → "Mags", "npc-townsfolk-miner" → "Townsfolk miner": an NPC creature id made readable. */
export function npcLabel(npc: string): string {
  const words = npc.replace(/^npc-/, '').replaceAll('-', ' ');
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/**
 * Resolves a dialogue's speaker id to the name the dialogue box, history and screen-reader
 * announcements show (mw-2ute): the speaker's own `name`, else the NPC creature it names made
 * readable ("mags" → npc-mags → "Mags"). Creatures carry no display name, so the readable id is
 * the short form. The narrator, the player and unknown speakers keep their id.
 */
export function speakerNameResolver(
  dialogueOf: (dialogue: string) => PortraitDialogue | undefined,
): (dialogue: string, speaker: string) => string {
  return (dialogue, speaker) => {
    const found = dialogueOf(dialogue)?.speakers.find((s) => s.id === speaker);
    if (found?.name !== undefined) return found.name;
    return found?.npc === undefined ? speaker : npcLabel(found.npc.id);
  };
}
