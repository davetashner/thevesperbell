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
// - It publishes `#app[data-dialogue]` (JSON; the e2e's readout) and the dialogue screen's view model
//   (src/ui/dialogue-box.ts, mw-e22.10): the line or options with tags, locked reasons and odds, the
//   cursor, the last check's breakdown and the history of what was said and chosen (kept across
//   conversations for the session, not saved). The controller also owns the cursor and the keys.
//
// Persuasion checks and option tags are wired where the runtime is built (src/main.ts).

import {
  AlertStateChanged,
  DialogueCheckResolved,
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
  type DialogueChoice,
  type DialogueView,
  type EntityId,
  type Vec3,
  type World,
} from '@sim/index';
import { formatString } from '@content/index';
import type {
  DialogueBoxChoice,
  DialogueBoxModel,
  DialogueBoxOutcome,
  DialogueHistoryEntry,
  UiIntent,
} from '@ui/index';
import { creatureIdOf } from './npcs';
import { humanize, oddsView, outcomeView, reasonText, tagView } from './text';

/** The player walking further from the NPC than this (metres) ends the conversation. */
export const TALK_RANGE_M = 6;
/** Where the camera looks at the NPC: this high above its feet, metres. */
export const NPC_HEAD_M = 1.6;

/** The most entries the history keeps; the oldest go first. */
export const HISTORY_LIMIT = 200;

/** Pixels the arrow keys scroll the open history by. */
export const HISTORY_SCROLL_PX = 48;

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
  /** The line being typed out (the box's reveal): Enter finishes it before it continues. */
  readonly reveal?: { readonly active: () => boolean; readonly finish: () => void };
  /** Scrolls the open history panel by this many pixels. */
  readonly scrollHistory?: (pixels: number) => void;
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
  readonly choices: readonly {
    readonly text: string;
    readonly locked: boolean;
    readonly reason: string;
  }[];
  /** The option the cursor is on (0 while a line shows). */
  readonly focus: number;
  readonly historyOpen: boolean;
  /** How many entries the history holds. */
  readonly history: number;
  /** The NPC's routine is paused. */
  readonly conversing: boolean;
  /** How the last conversation ended; absent before the first. */
  readonly last?: ConversationEnd;
}

const CHOICE_KEY = /^(?:Digit|Numpad)([1-9])$/;
const ADVANCE_KEYS: readonly string[] = ['Enter', 'NumpadEnter', 'KeyE'];
const KEY_INTENTS: Readonly<Record<string, UiIntent>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  KeyH: 'secondary',
  Escape: 'back',
};

export class Conversations {
  readonly #world: World<never>;
  readonly #options: ConversationOptions;
  readonly #offs: (() => void)[] = [];
  #partner: EntityId | undefined;
  /** The talking NPC's content id; meaningful only while `#partner` is set. */
  #npc = '';
  #pending: EntityId | undefined;
  #alarm: string | undefined;
  #last: ConversationEnd | undefined;
  #published = '';
  #focus = 0;
  #historyOpen = false;
  #history: DialogueHistoryEntry[] = [];
  /** Counts the lines shown; the box restarts its reveal when it changes. */
  #seq = 0;
  #outcome: DialogueBoxOutcome | undefined;
  /** Where in the history the check just chosen belongs (after the choice, before the answer). */
  #checkAt = 0;
  #lastLine = { speaker: '', text: '', portrait: '' };
  #divide = false;

  constructor(options: ConversationOptions) {
    this.#world = options.world;
    this.#options = options;
    const { events } = options.world;
    this.#offs.push(
      events.on(interacted, ({ actor, target, verb }) => {
        if (actor !== options.player || verb !== 'talk' || this.#partner !== undefined) return;
        if (this.#dialogueOf(target) !== undefined) this.#pending = target;
      }),
      events.on(DialogueCheckResolved, ({ breakdown }) => {
        if (this.#partner === undefined || breakdown === undefined) return;
        const outcome = outcomeView(breakdown);
        this.#outcome = outcome;
        const at = Math.min(this.#checkAt, this.#history.length);
        this.#history.splice(at, 0, {
          kind: 'check',
          speaker: '',
          text: [outcome.title, ...outcome.lines].join('. '),
        });
        this.#checkAt = at + 1;
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
    const { reveal } = this.#options;
    if (reveal?.active() === true) {
      // Enter first shows the rest of the line, then goes on.
      reveal.finish();
      return true;
    }
    this.#outcome = undefined;
    this.#settle(this.#options.runtime.advance());
    this.#present();
    return true;
  }

  /** Picks option `index` (from 0) of the current choice. Returns whether it was taken. */
  choose(index: number): boolean {
    if (this.#partner === undefined) return false;
    const { view } = this.#options.runtime;
    const result = this.#options.runtime.choose(index);
    if (!result.ok) return false;
    // The runtime's events are delivered at the next step, so the check's result lands after this.
    this.#opening(humanize(this.#npc));
    // A taken option exists, so the view was a choice that lists it.
    const { choices } = view as Extract<DialogueView, { kind: 'choice' }>;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    this.#push({ kind: 'choice', speaker: '', text: choices[index]!.text });
    this.#checkAt = this.#history.length;
    this.#outcome = undefined;
    this.#settle(result.view);
    this.#present();
    return true;
  }

  /** Moves the cursor to option `index` (a pointer over it); returns whether there is one. */
  focus(index: number): boolean {
    const view = this.#partner === undefined ? undefined : this.#options.runtime.view;
    if (view?.kind !== 'choice' || index < 0 || index >= view.choices.length) return false;
    this.#focus = index;
    this.#present();
    return true;
  }

  /** A click on option `index`: the cursor goes there, and a free option is taken. */
  activate(index: number): boolean {
    return this.focus(index) && this.choose(index);
  }

  /** Opens or closes the history panel while a conversation is open. */
  toggleHistory(): boolean {
    if (this.#partner === undefined) return false;
    this.#historyOpen = !this.#historyOpen;
    this.#present();
    return true;
  }

  /** Confirm: continues a line, or takes the option the cursor is on (a locked one does nothing). */
  confirm(): boolean {
    if (this.#partner === undefined) return false;
    if (this.#historyOpen) return this.toggleHistory();
    if (this.#options.runtime.view?.kind === 'choice') return this.choose(this.#focus);
    return this.advance();
  }

  /**
   * A menu intent (the pad, and the arrows, H and Esc of the keyboard): up and down move the cursor,
   * or scroll the history; confirm continues or picks; secondary (X, H) toggles the history; back
   * closes it. Returns whether the conversation took it.
   */
  intent(intent: UiIntent): boolean {
    if (this.#partner === undefined) return false;
    switch (intent) {
      case 'up':
      case 'down': {
        const sign = intent === 'up' ? -1 : 1;
        if (this.#historyOpen) {
          this.#options.scrollHistory?.(sign * HISTORY_SCROLL_PX);
          return true;
        }
        return this.#step(sign);
      }
      case 'confirm':
        this.confirm();
        return true;
      case 'secondary':
        return this.toggleHistory();
      case 'back':
        return this.#historyOpen && this.toggleHistory();
      default:
        return false;
    }
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
   * The keys of an open conversation: Enter or E continues a line or takes the option under the
   * cursor, 1 to 9 picks an option, Up and Down move the cursor (or scroll the history), H opens
   * the history and Esc closes it. Returns true for a key it took (every one of those, while a
   * conversation is open, so none reaches the game); a held key's repeats are taken and ignored,
   * except that Up and Down repeat.
   */
  keydown(event: { readonly code: string; readonly repeat?: boolean }): boolean {
    if (this.#partner === undefined) return false;
    const digit = CHOICE_KEY.exec(event.code)?.[1];
    const intent = KEY_INTENTS[event.code];
    const advances = ADVANCE_KEYS.includes(event.code);
    if (digit === undefined && intent === undefined && !advances) return false;
    // Escape belongs to the pause menu unless the history is open to close.
    if (event.code === 'Escape' && !this.#historyOpen) return false;
    const moves = intent === 'up' || intent === 'down';
    if (event.repeat === true && !moves) return true;
    if (digit !== undefined) {
      if (!this.#historyOpen) this.choose(Number(digit) - 1);
    } else if (advances) this.confirm();
    // Neither a digit nor an advance key, so one of the mapped intents.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    else this.intent(intent!);
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
      npc: view === undefined ? null : this.#npc,
      conversing: this.#partner !== undefined && isConversing(this.#world, this.#partner),
      focus: view?.kind === 'choice' ? this.#focus : 0,
      historyOpen: view !== undefined && this.#historyOpen,
      history: this.#history.length,
      ...(this.#last !== undefined && { last: this.#last }),
    };
    if (view?.kind === 'line') {
      return {
        ...base,
        kind: 'line',
        speaker: this.#speakerName(view),
        text: view.text,
        choices: [],
      };
    }
    if (view?.kind === 'choice') {
      const choices = view.choices.map(({ text, locked, reason, reasonParts }) => ({
        text,
        locked,
        reason: locked ? this.#reason(reason, reasonParts) : '',
      }));
      return { ...base, kind: 'choice', speaker: '', text: '', choices };
    }
    return { ...base, kind: null, speaker: '', text: '', choices: [] };
  }

  #speakerName(view: { readonly dialogue: string; readonly speaker: string }): string {
    return this.#options.speakerName?.(view.dialogue, view.speaker) ?? view.speaker;
  }

  /** A locked option's reason in words; the key itself when the runtime gave no parts. */
  #reason(key: string | undefined, parts: DialogueChoice['reasonParts']): string {
    return parts === undefined ? (key ?? '') : reasonText(parts);
  }

  /** Moves the cursor one option, wrapping. */
  #step(sign: number): boolean {
    const view = this.#options.runtime.view;
    if (view?.kind !== 'choice') return true;
    const n = view.choices.length;
    this.#focus = (this.#focus + sign + n) % n;
    this.#present();
    return true;
  }

  /** The option the cursor starts on: the first one that can be taken. */
  #firstFree(view: Extract<DialogueView, { kind: 'choice' }>): number {
    // The runtime ends a conversation with nothing to take, so there is one; 0 if there is not.
    return Math.max(
      0,
      view.choices.findIndex((choice) => !choice.locked),
    );
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
    this.#divide = true;
    this.#historyOpen = false;
    this.#outcome = undefined;
    const from = this.#world.get(target, PlacementComponent);
    const to = this.#world.get(this.#options.player, PlacementComponent);
    const toward =
      from === undefined || to === undefined ? undefined : { x: to.x - from.x, z: to.z - from.z };
    // Alive (creatureIdOf found it) and free (afterStep released any orphan first), so this holds.
    beginConversing(this.#world, target, this.#options.player, toward);
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
    this.#seq += 1;
    if (view.kind === 'ended') this.#finish(view.reason, view.cause);
    else if (view.kind === 'choice') this.#focus = this.#firstFree(view);
    else this.#remember(view);
  }

  /** Puts a line into the history (with a divider when it opens a conversation) and keeps it as the last said. */
  #remember(view: Extract<DialogueView, { kind: 'line' }>): void {
    const speaker = this.#speakerName(view);
    this.#opening(speaker);
    this.#push({ kind: 'line', speaker, text: view.text });
    this.#lastLine = { speaker, text: view.text, portrait: view.speaker };
  }

  /** The first entry of a conversation starts with a divider naming who it is with. */
  #opening(who: string): void {
    if (!this.#divide) return;
    this.#divide = false;
    this.#push({
      kind: 'divider',
      speaker: '',
      text: formatString('dialogue.history.divider', { speaker: who }),
    });
  }

  #push(entry: DialogueHistoryEntry): void {
    this.#history.push(entry);
    if (this.#history.length > HISTORY_LIMIT) this.#history.shift();
  }

  #finish(reason: string, cause?: string): void {
    const partner = this.#partner;
    if (partner !== undefined && this.#world.isAlive(partner)) endConversing(this.#world, partner);
    this.#last = { npc: this.#npc, reason, ...(cause !== undefined && { cause }) };
    this.#partner = undefined;
    this.#npc = '';
    this.#historyOpen = false;
    this.#outcome = undefined;
  }

  #present(): void {
    const readout = this.readout();
    const model = this.#boxModel(readout);
    const json = JSON.stringify(readout);
    const modelJson = JSON.stringify(model);
    if (json + modelJson === this.#published) return;
    this.#published = json + modelJson;
    this.#options.publish?.('dialogue', json);
    this.#options.show?.(model);
  }

  /** The dialogue screen's view of now; null when no conversation is open. */
  #boxModel(readout: ConversationReadout): DialogueBoxModel | null {
    const view = this.#options.runtime.view;
    if (!readout.open || readout.kind === null) return null;
    const history = this.#historyOpen
      ? formatString('dialogue.ui.historyOpen')
      : formatString('dialogue.ui.history');
    const last = this.#lastLine;
    const choices: DialogueBoxChoice[] =
      view?.kind === 'choice'
        ? view.choices.map((choice) => ({
            text: choice.text,
            locked: choice.locked,
            reason: choice.locked ? this.#reason(choice.reason, choice.reasonParts) : '',
            tags: choice.tags.map(tagView),
            ...(choice.check !== undefined && { odds: oddsView(choice.check) }),
          }))
        : [];
    return {
      speaker: readout.kind === 'line' ? readout.speaker : last.speaker,
      portrait: readout.kind === 'line' && view?.kind === 'line' ? view.speaker : last.portrait,
      text: readout.kind === 'line' ? readout.text : last.text,
      lineKey: this.#seq,
      choices,
      focus: readout.focus,
      hint: `${formatString(readout.kind === 'line' ? 'dialogue.ui.line' : 'dialogue.ui.choice')}. ${history}`,
      ...(this.#outcome !== undefined && { outcome: this.#outcome }),
      history: [...this.#history],
      historyOpen: readout.historyOpen,
      labels: {
        replies: formatString('dialogue.ui.replies'),
        locked: formatString('dialogue.ui.locked'),
        history: formatString('dialogue.ui.historyButton'),
        historyTitle: formatString('dialogue.ui.historyTitle'),
        historyEmpty: formatString('dialogue.ui.historyEmpty'),
      },
    };
  }
}

/** The id of the safety veto that holds autosaves back while the player is in conversation. */
export const DIALOGUE_VETO_ID = 'dialogue';

/** The veto itself: not safe to save mid-conversation (the dialogue is not saved). */
export function dialogueVeto(
  conversations: () => Pick<Conversations, 'active'> | undefined,
): () => string | null {
  return () => (conversations()?.active === true ? 'you are in conversation' : null);
}
