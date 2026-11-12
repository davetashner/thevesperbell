// Talking to NPCs in the world (mw-e22.9): the game's side of the dialogue runtime
// (src/sim/dialogue), the Interact verb and the AI.
//
// - A creature whose definition has a `dialogue` is talkable: this adds the `talk` affordance to it
//   (as it appears, scene spawns and console spawns alike), so the Interact prompt reads "Talk".
//   Whether it will (a hostile NPC refuses unless its dialogue has a parley entry) is the sim's rule,
//   `installTalkGate` (src/sim/dialogue/talk.ts).
// - The player's `talk` on it, seen after the step that did it, starts the dialogue with the creature
//   as the NPC and puts the NPC in conversation: its routine paused, facing the player
//   (src/sim/ai/conversing.ts). The conversation is advanced and answered from between sim steps (the
//   runtime must not run inside a system): `advance`, `choose`, or the keys while one is open (Enter
//   or E continues, 1 to 9 picks an option).
// - Danger ends it, and the NPC goes back to its routine: the player walking further than `maxDistance`
//   from the NPC (cause `walked-away`), a creature other than the NPC turning on the player (entering
//   Alerted or Combat toward the player or no one yet) or anyone hitting the NPC or the player (cause
//   `combat`), the NPC gone (`gone`). All are seen in the step they happen, so the conversation is over
//   within one sim tick.
// - It publishes `#app[data-dialogue]` (JSON; the e2e's readout) and the minimal box the player reads
//   (`dialogueBoxModel`); mw-e22.10's real dialogue screen replaces the box and keeps the controller.
//
// Persuasion checks and option tags are wired where the runtime is built (src/main.ts).

import {
  AlertStateChanged,
  beginConversing,
  conversingEntities,
  DamageApplied,
  DialogueRuntimeError,
  endConversing,
  brainOf,
  interactableOf,
  InteractableComponent,
  interacted,
  isConversing,
  PlacementComponent,
  CreatureComponent,
  type DialogueRuntime,
  type DialogueView,
  type EntityId,
  type Vec3,
  type World,
} from '@sim/index';
import type { DialogueBoxModel } from '@ui/index';
import { creatureIdOf } from './npcs';

/** The player walking further from the NPC than this (metres) ends the conversation. */
export const TALK_RANGE_M = 6;
/** Where the camera looks at the NPC: this high above its feet, metres. */
export const NPC_HEAD_M = 1.6;

export const CONVERSATION_TEXT = Object.freeze({
  line: 'Enter to continue',
  choice: 'Press the number of your answer',
});

/** How a conversation ended, as the readout reports it. */
export interface ConversationEnd {
  readonly npc: string;
  readonly reason: string;
  readonly cause?: string;
}

export interface ConversationOptions {
  readonly world: World<never>;
  readonly player: EntityId;
  readonly runtime: DialogueRuntime;
  /** The dialogue a creature (content id) talks, if any. */
  readonly dialogueOf: (creature: string) => string | undefined;
  /** Who a speaker id of a dialogue is, for the box ("Ottilie Marsh"); default: the id. */
  readonly speakerName?: (dialogue: string, speaker: string) => string;
  /** Metres the player may be from the NPC; default `TALK_RANGE_M`. */
  readonly maxDistance?: number;
  /** Shows the conversation (null hides it). */
  readonly show?: (model: DialogueBoxModel | null) => void;
  /** Publishes a `data-*` readout value. */
  readonly publish?: (key: string, value: string) => void;
}

/** What the readout says (`#app[data-dialogue]`). */
export interface ConversationReadout {
  readonly open: boolean;
  readonly npc: string | null;
  readonly kind: 'line' | 'choice' | null;
  readonly speaker: string;
  readonly text: string;
  readonly choices: readonly { readonly text: string; readonly locked: boolean }[];
  /** The NPC's routine is paused. */
  readonly conversing: boolean;
  /** How the last conversation ended; absent before the first. */
  readonly last?: ConversationEnd;
}

const CHOICE_KEY = /^(?:Digit|Numpad)([1-9])$/;
const ADVANCE_KEYS: readonly string[] = ['Enter', 'NumpadEnter', 'KeyE'];

export class Conversations {
  readonly #world: World<never>;
  readonly #options: ConversationOptions;
  readonly #offs: (() => void)[] = [];
  #partner: EntityId | undefined;
  #npc: string | undefined;
  #pending: EntityId | undefined;
  #alarm: string | undefined;
  #last: ConversationEnd | undefined;
  #published = '';

  constructor(options: ConversationOptions) {
    this.#world = options.world;
    this.#options = options;
    const { events } = options.world;
    this.#offs.push(
      events.on(interacted, ({ actor, target, verb }) => {
        if (actor !== options.player || verb !== 'talk' || this.#partner !== undefined) return;
        if (this.#dialogueOf(target) !== undefined) this.#pending = target;
      }),
      events.on(AlertStateChanged, (change) => {
        if (this.#partner === undefined || change.entity === this.#partner) return;
        if (change.to !== 'alerted' && change.to !== 'combat') return;
        const target = brainOf(options.world, change.entity)?.blackboard.target ?? null;
        if (target === null || target === options.player) this.#alarm = 'combat';
      }),
      events.on(DamageApplied, ({ target }) => {
        if (
          this.#partner !== undefined &&
          (target === this.#partner || target === options.player)
        ) {
          this.#alarm = 'combat';
        }
      }),
    );
  }

  /** A conversation is in progress. */
  get active(): boolean {
    return this.#partner !== undefined;
  }

  /** The NPC being talked to. */
  get partner(): EntityId | undefined {
    return this.#partner;
  }

  /** Where the camera looks while talking (the NPC's head), or undefined when not talking. */
  focusPoint(): Vec3 | undefined {
    if (this.#partner === undefined) return undefined;
    const at = this.#world.get(this.#partner, PlacementComponent);
    return at === undefined ? undefined : { x: at.x, y: at.y + NPC_HEAD_M, z: at.z };
  }

  /** Call after every sim step: makes talkable creatures talkable, starts and watches conversations. */
  afterStep(): void {
    this.#makeTalkable();
    this.#reconcile();
    const pending = this.#pending;
    this.#pending = undefined;
    if (pending !== undefined && this.#partner === undefined) this.#start(pending);
    this.#watch();
    this.#present();
  }

  /** Moves past the current line. Returns whether a conversation was waiting on one. */
  advance(): boolean {
    if (this.#partner === undefined || this.#options.runtime.view?.kind !== 'line') return false;
    this.#settle(this.#options.runtime.advance());
    this.#present();
    return true;
  }

  /** Picks option `index` (from 0) of the current choice. Returns whether it was taken. */
  choose(index: number): boolean {
    if (this.#partner === undefined) return false;
    const result = this.#options.runtime.choose(index);
    if (!result.ok) return false;
    this.#settle(result.view);
    this.#present();
    return true;
  }

  /** Ends the conversation from outside, with `cause`. Returns whether one was running. */
  end(cause: string): boolean {
    if (this.#partner === undefined) return false;
    this.#options.runtime.abort(cause);
    this.#finish('aborted', cause);
    this.#present();
    return true;
  }

  /**
   * The keys of an open conversation: Enter or E continues a line, 1 to 9 picks an option. Returns
   * true for a key it took (every one of those, while a conversation is open, so none reaches the
   * game); a held key's repeats are taken and ignored.
   */
  keydown(event: { readonly code: string; readonly repeat?: boolean }): boolean {
    if (this.#partner === undefined) return false;
    const digit = CHOICE_KEY.exec(event.code)?.[1];
    if (digit === undefined && !ADVANCE_KEYS.includes(event.code)) return false;
    if (event.repeat === true) return true;
    if (digit === undefined) this.advance();
    else this.choose(Number(digit) - 1);
    return true;
  }

  /** Stops listening and returns the NPC to its routine. */
  dispose(): void {
    for (const off of this.#offs.splice(0)) off();
    if (this.#partner !== undefined) this.end('disposed');
  }

  /** The readout as of now. */
  readout(): ConversationReadout {
    const view = this.#partner === undefined ? undefined : this.#options.runtime.view;
    const base = {
      open: view !== undefined,
      npc: view === undefined ? null : (this.#npc ?? null),
      conversing: this.#partner !== undefined && isConversing(this.#world, this.#partner),
      ...(this.#last !== undefined && { last: this.#last }),
    };
    if (view?.kind === 'line') {
      const speaker = this.#options.speakerName?.(view.dialogue, view.speaker) ?? view.speaker;
      return { ...base, kind: 'line', speaker, text: view.text, choices: [] };
    }
    if (view?.kind === 'choice') {
      const choices = view.choices.map(({ text, locked }) => ({ text, locked }));
      return { ...base, kind: 'choice', speaker: '', text: '', choices };
    }
    return { ...base, kind: null, speaker: '', text: '', choices: [] };
  }

  #dialogueOf(entity: EntityId): string | undefined {
    const id = creatureIdOf(this.#world, entity);
    return id === undefined ? undefined : this.#options.dialogueOf(id);
  }

  /** Gives every creature with a dialogue the Talk affordance. */
  #makeTalkable(): void {
    const world = this.#world;
    if (!world.isRegistered(CreatureComponent) || !world.isRegistered(InteractableComponent))
      return;
    world.query(CreatureComponent).forEach((entity) => {
      if (world.has(entity, InteractableComponent) || this.#dialogueOf(entity) === undefined)
        return;
      world.add(entity, InteractableComponent, interactableOf({ affordances: [{ verb: 'talk' }] }));
    });
  }

  /** Drops what the world no longer agrees with: a conversation the runtime lost, an orphaned NPC. */
  #reconcile(): void {
    if (this.#partner !== undefined && !this.#options.runtime.active) {
      this.#finish('aborted', 'restored');
    }
    for (const entity of conversingEntities(this.#world)) {
      if (entity !== this.#partner) endConversing(this.#world, entity);
    }
  }

  #start(target: EntityId): void {
    const npc = creatureIdOf(this.#world, target);
    const dialogue = this.#dialogueOf(target);
    if (npc === undefined || dialogue === undefined) return;
    this.#alarm = undefined;
    const from = this.#world.get(target, PlacementComponent);
    const to = this.#world.get(this.#options.player, PlacementComponent);
    const toward =
      from === undefined || to === undefined ? undefined : { x: to.x - from.x, z: to.z - from.z };
    if (!beginConversing(this.#world, target, this.#options.player, toward)) return;
    this.#partner = target;
    this.#npc = npc;
    try {
      this.#settle(this.#options.runtime.start(dialogue, npc));
    } catch (error) {
      if (!(error instanceof DialogueRuntimeError)) throw error;
      // No entry holds for this NPC now: nothing to say.
      this.#finish('aborted', 'no-entry');
    }
  }

  /** Ends the conversation when the player has gone, danger has come, or the NPC is gone. */
  #watch(): void {
    const partner = this.#partner;
    if (partner === undefined) return;
    const alarm = this.#alarm;
    this.#alarm = undefined;
    const world = this.#world;
    const npc = world.isAlive(partner) ? world.get(partner, PlacementComponent) : undefined;
    const player = world.get(this.#options.player, PlacementComponent);
    const max = this.#options.maxDistance ?? TALK_RANGE_M;
    let cause = alarm;
    if (npc === undefined) cause = 'gone';
    else if (cause === undefined && player !== undefined) {
      const away = Math.hypot(npc.x - player.x, npc.y - player.y, npc.z - player.z);
      if (away > max) cause = 'walked-away';
    }
    if (cause !== undefined) this.end(cause);
  }

  /** Reacts to what a runtime call returned: when the conversation is over, the NPC walks on. */
  #settle(view: DialogueView): void {
    if (view.kind === 'ended') this.#finish(view.reason, view.cause);
  }

  #finish(reason: string, cause?: string): void {
    const partner = this.#partner;
    if (partner !== undefined && this.#world.isAlive(partner)) endConversing(this.#world, partner);
    this.#last = { npc: this.#npc ?? '', reason, ...(cause !== undefined && { cause }) };
    this.#partner = undefined;
    this.#npc = undefined;
  }

  #present(): void {
    const readout = this.readout();
    const json = JSON.stringify(readout);
    if (json === this.#published) return;
    this.#published = json;
    this.#options.publish?.('dialogue', json);
    this.#options.show?.(boxModel(readout));
  }
}

/** The box's view of a readout; null when no conversation is open. */
export function boxModel(readout: ConversationReadout): DialogueBoxModel | null {
  if (!readout.open || readout.kind === null) return null;
  return {
    speaker: readout.speaker,
    text: readout.text,
    hint: readout.kind === 'line' ? CONVERSATION_TEXT.line : CONVERSATION_TEXT.choice,
    choices: readout.choices.map((choice, i) => ({
      text: `${String(i + 1)}. ${choice.text}`,
      locked: choice.locked,
      reason: 'locked',
    })),
  };
}

/** The id of the safety veto that holds autosaves back while the player is in conversation. */
export const DIALOGUE_VETO_ID = 'dialogue';

/** The veto itself: not safe to save mid-conversation (the dialogue is not saved). */
export function dialogueVeto(
  conversations: () => Pick<Conversations, 'active'> | undefined,
): () => string | null {
  return () => (conversations()?.active === true ? 'you are in conversation' : null);
}
