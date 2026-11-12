// The dialogue graph runtime (mw-e22.5): plays a dialogue (src/content/types/dialogue.ts, format in
// docs/design/dialogue-format.md) deterministically. `start(dialogueId, npcId)` picks the first entry
// whose condition holds and walks the graph until something needs the player: a `line` waits for
// `advance()`, a `choice` for `choose(i)`. Silent nodes (`branch`, `effect`, `check`, `jump`) run in
// between. `abort()` ends a conversation from outside (combat, the player walking away).
//
// State. Visited counts per NPC, dialogue and node-or-option id are world facts
// (`entity:<dialogue>/<npc>-<id>.visits`, an int each, declared by the content fact template
// `entity:*.visits` so a production save load keeps them), so they ride the existing world-facts save
// and snapshot with no save section of their own; a world that never talks hashes as before. The
// conversation in progress is not saved: it is runtime state, and a restored world (`World.restores`
// moved) drops it silently, leaving the facts (and so everything already said) intact.
//
// Conditions are evaluated with `dialogueLogicRegistry()` against the given `LogicHost` with the
// `dialogue` service added (`dialogue.visitedCount`). Effects go through `applyLogicEffects`, one
// atomic batch per option, effect node or check outcome; the host supplies the checkpoint (compose
// inventory, facts and disposition with `composeCheckpoints`). Any `LogicHost` works, so a
// quest-aware host plugs in unchanged. Batches change the world through the host, and World.add and
// World.remove are deferred mid-step: call `start`, `advance`, `choose` and `abort` between sim
// steps (from the UI or an input handler), never from inside a system.
//
// Persuasion checks are a seam: `check` nodes are decided by `DialogueOptions.checks`, a
// `CheckResolver` (`createPersuasion` in ./persuasion.ts builds the deterministic one, mw-e22.7). The
// default `failClosed` always fails the check, so an unwired runtime sends every check to its
// `failure` node, which the format guarantees continues the story. A resolver may return the
// breakdown it decided by; the runtime publishes it as `dialogue.checkResolved`, and an optional
// `preview` computes the same breakdown ahead of time, so a choice whose option leads straight to a
// check carries `check` (label, score, every modifier) for the UI to show the odds.
//
// Options carry `tags` (mw-e22.6, ./tags.ts), derived from their condition.
//
// Events (each carries the tick): `dialogue.started`, `dialogue.nodeVisited` (every node entered and
// every option chosen), `dialogue.ended` { reason: completed | aborted, cause } and `dialogue.error`
// (a refused effect batch, a missing node or dialogue, a loop).

import type {
  DialogueApproach,
  DialogueDef,
  DialogueNode,
  DialogueOption,
} from '../../content/types/dialogue';
import type { World } from '../core/world';
import { entityFactKey } from '../facts/store';
import { defineEvent, type EventType } from '../core/events';
import {
  applyLogicEffects,
  describeCondition,
  describeConditionParts,
  evaluateLogic,
  type LogicApplyResult,
  type LogicDescription,
  type LogicHost,
  type LogicNode,
} from '../logic';
import { deriveOptionTags, type DialogueTag, type TagSources } from './tags';
import {
  DIALOGUE_SERVICE,
  dialogueLogicRegistry,
  type DialogueVisits,
} from '../logic/dialogue-kinds';

type CheckNode = Extract<DialogueNode, { kind: 'check' }>;

/** Why a conversation ended. */
export type DialogueEndReason = 'completed' | 'aborted';

export interface DialogueStartedEvent {
  readonly tick: number;
  readonly dialogue: string;
  readonly npc: string;
  readonly entry: string;
}
export interface DialogueNodeVisitedEvent {
  readonly tick: number;
  readonly dialogue: string;
  readonly npc: string;
  /** Node id, or option id when `what` is `option`. */
  readonly id: string;
  readonly what: 'node' | 'option';
  /** How many times it has now been visited with this NPC. */
  readonly count: number;
}
export interface DialogueEndedEvent {
  readonly tick: number;
  readonly dialogue: string;
  readonly npc: string;
  readonly reason: DialogueEndReason;
  /** Why, for an abort: the caller's cause (`combat`), or what the runtime hit (`loop`). */
  readonly cause?: string;
}
export interface DialogueErrorEvent {
  readonly tick: number;
  readonly dialogue: string;
  readonly npc: string;
  /** The node or option the problem is at. */
  readonly at: string;
  /** `effects-failed`, `unknown-node`, `unknown-dialogue`, `no-choices`, `loop`. */
  readonly code: string;
  /** The failure reason from the host (`missing-item:key-a`) or a short description. */
  readonly detail: string;
}

export interface DialogueCheckResolvedEvent {
  readonly tick: number;
  readonly dialogue: string;
  readonly npc: string;
  /** The check node. */
  readonly node: string;
  readonly success: boolean;
  /** Present when the resolver explained itself (persuasion does). */
  readonly breakdown?: CheckBreakdown;
}

export const DialogueStarted = defineEvent<DialogueStartedEvent>('dialogue.started');
export const DialogueNodeVisited = defineEvent<DialogueNodeVisitedEvent>('dialogue.nodeVisited');
export const DialogueEnded = defineEvent<DialogueEndedEvent>('dialogue.ended');
export const DialogueError = defineEvent<DialogueErrorEvent>('dialogue.error');
export const DialogueCheckResolved =
  defineEvent<DialogueCheckResolvedEvent>('dialogue.checkResolved');

/** What a `CheckResolver` is asked to decide. */
export interface CheckRequest {
  readonly dialogue: string;
  readonly npc: string;
  readonly node: CheckNode;
  /** The NPC being worked on: the check's `target` speaker's NPC, else the one being talked to. */
  readonly target: string;
  /** A context to evaluate the node's modifiers against (includes the `dialogue` service). */
  readonly context: LogicHost;
}

/** One line of a check's score: where it comes from, why, and how much. */
export interface ScoreModifier {
  /** `base`, `disposition` (label is the band), `rule` (persuasion table), `node` or `personality`. */
  readonly source: 'base' | 'disposition' | 'rule' | 'node' | 'personality';
  /** Shown to the player (for `disposition`, the band name; for `base`, "base"). */
  readonly label: string;
  readonly value: number;
}

/** The odds label of a check, from how far the score is from the difficulty. */
export type DifficultyLabel = 'easy' | 'fair' | 'hard' | 'impossible';

/** Everything a persuasion check was decided by. */
export interface CheckBreakdown {
  readonly approach: DialogueApproach;
  readonly difficulty: number;
  readonly target: string;
  /** Sum of `modifiers`. */
  readonly score: number;
  /** `score - difficulty`: the check succeeds from 0. */
  readonly margin: number;
  readonly label: DifficultyLabel;
  readonly success: boolean;
  readonly modifiers: readonly ScoreModifier[];
}

/** A decision with its explanation. */
export interface CheckOutcome {
  readonly success: boolean;
  readonly breakdown?: CheckBreakdown;
}

/** Decides a persuasion check: true is success. Must be deterministic (`createPersuasion` is). */
export type CheckResolver = (request: CheckRequest) => boolean | CheckOutcome;

/** The default resolver: every check fails. */
export const failClosed: CheckResolver = () => false;

/** One option of a `choice`, as the UI shows it. */
export interface DialogueChoice {
  /** Position in the list; pass it to `choose`. */
  readonly index: number;
  readonly id: string;
  readonly text: string;
  readonly textKey: string;
  readonly locked: boolean;
  /** For a locked option: why, as a localization key with parameters (`describeCondition`). */
  readonly reason?: string;
  readonly reasonParts?: LogicDescription;
  /** Class, capability and item tags derived from the option's condition (mw-e22.6). */
  readonly tags: readonly DialogueTag[];
  /** When the option leads straight to a check and the runtime has a `preview`: the odds. */
  readonly check?: CheckBreakdown;
}

/** What the conversation is waiting on, or that it is over. */
export type DialogueView =
  | {
      readonly kind: 'line';
      readonly dialogue: string;
      readonly npc: string;
      readonly node: string;
      readonly speaker: string;
      readonly text: string;
      readonly textKey: string;
    }
  | {
      readonly kind: 'choice';
      readonly dialogue: string;
      readonly npc: string;
      readonly node: string;
      readonly choices: readonly DialogueChoice[];
    }
  | { readonly kind: 'ended'; readonly reason: DialogueEndReason; readonly cause?: string };

/** Result of `choose`. */
export type ChooseResult =
  | { readonly ok: true; readonly view: DialogueView }
  | {
      readonly ok: false;
      /** `locked`, `no-such-choice`, `not-waiting-for-choice` or `effects-failed` (stayed). */
      readonly reason: string;
      readonly detail?: string;
      readonly view: DialogueView;
    };

export interface DialogueOptions {
  readonly world: World<never>;
  /** Conditions and effects run against this; any host works (compose checkpoints). */
  readonly host: LogicHost;
  /** Looks up a dialogue by id. */
  readonly dialogues: (id: string) => DialogueDef | undefined;
  /** Decides `check` nodes. Default: `failClosed`. */
  readonly checks?: CheckResolver;
  /** Works out a check without deciding it, for `DialogueChoice.check`. */
  readonly preview?: (request: CheckRequest) => CheckBreakdown;
  /** Class tags and item icons for option tags. */
  readonly tags?: TagSources;
}

/** Thrown for a call that cannot mean anything: an unknown dialogue at `start`, no entry holds. */
export class DialogueRuntimeError extends Error {
  override readonly name = 'DialogueRuntimeError';
}

/** Most silent nodes one step may run before it is called a loop. */
export const MAX_SILENT_STEPS = 256;

/**
 * The fact that counts visits of `id` in `dialogue` with `npc`: the entity-scoped
 * `entity:<dialogue>/<n>-<npc>-<id>.visits`, governed by the template `entity:*.visits` (content
 * fact `dialogue`), so the game's fact registry already declares it when a save loads. `n` is the
 * number of hyphen-separated parts of the NPC id, so `(a-b, c)` and `(a, b-c)` never collide.
 */
export function dialogueVisitKey(npc: string, dialogue: string, id: string): string {
  return entityFactKey(dialogue, `${String(npc.split('-').length)}-${npc}-${id}`, 'visits');
}

/** Localization key of a node's text, or an option's: mirrors content `dialogueTextKey`. */
function textKey(dialogue: string, node: string, option?: string): string {
  return `dialogue.${dialogue}.${node}${option === undefined ? '' : `.${option}`}`;
}

/** Whether a condition tree has a `disposition` node anywhere in it. */
function readsDisposition(node: unknown): boolean {
  if (typeof node !== 'object' || node === null) return false;
  if ((node as { kind?: unknown }).kind === 'disposition') return true;
  return Object.values(node).some(readsDisposition);
}

/** Where a conversation is: the dialogue (a `jump` changes it) and who is being talked to. */
interface Position {
  dialogue: DialogueDef;
  readonly npc: string;
}

/** A conversation waiting on the player at `node`. */
interface Session extends Position {
  readonly node: Extract<DialogueNode, { kind: 'line' | 'choice' }>;
}

/** `host` with `services` extended by the dialogue service, without changing the host. */
function withVisits(host: LogicHost, visits: DialogueVisits): LogicHost {
  return Object.create(host, {
    services: { value: { ...host.services, [DIALOGUE_SERVICE]: visits } },
  }) as LogicHost;
}

export class DialogueRuntime {
  private readonly registry = dialogueLogicRegistry();
  private session: Session | undefined;
  private seenRestores: number;

  constructor(private readonly options: DialogueOptions) {
    this.seenRestores = options.world.restores;
  }

  /** How often node or option `id` of `dialogue` has been visited with `npc`. */
  visitCount(npc: string, dialogue: string, id: string): number {
    const value = this.options.world.facts.get(dialogueVisitKey(npc, dialogue, id));
    return typeof value === 'number' ? value : 0;
  }

  /** True while a conversation waits on the player. */
  get active(): boolean {
    return this.live() !== undefined;
  }

  /** What the running conversation waits on; undefined when none runs. */
  get view(): DialogueView | undefined {
    const session = this.live();
    return session === undefined ? undefined : this.viewOf(session);
  }

  /** The options of the current `choice` node (empty otherwise), locked ones included. */
  choices(): readonly DialogueChoice[] {
    const view = this.view;
    return view?.kind === 'choice' ? view.choices : [];
  }

  /**
   * Starts a conversation with `npc`: the first entry whose condition holds. A conversation already
   * running is aborted first (cause `restarted`).
   * @throws DialogueRuntimeError for an unknown dialogue or when no entry holds.
   */
  start(dialogueId: string, npc: string): DialogueView {
    if (this.live() !== undefined) this.abort('restarted');
    const dialogue = this.options.dialogues(dialogueId);
    if (dialogue === undefined) throw new DialogueRuntimeError(`unknown dialogue "${dialogueId}"`);
    const context = this.contextFor(npc, dialogueId);
    const entry = this.pickEntry(dialogue, context);
    if (entry === undefined) {
      throw new DialogueRuntimeError(`no entry of "${dialogueId}" holds for "${npc}"`);
    }
    this.emit(DialogueStarted, { dialogue: dialogueId, npc, entry: entry.id });
    return this.enter({ dialogue, npc }, entry.node);
  }

  /**
   * Whether `npc` can be talked to while hostile (mw-e22.9): some entry of the dialogue is written
   * for that state, meaning its condition reads a `disposition`, and holds now (a parley). A
   * hostile NPC whose dialogue has none refuses to talk. Authors put such an entry before any
   * entry a hostile NPC should not reach, since `start` takes the first that holds.
   */
  canParley(dialogueId: string, npc: string): boolean {
    const dialogue = this.options.dialogues(dialogueId);
    if (dialogue === undefined) return false;
    const context = this.contextFor(npc, dialogueId);
    return dialogue.entries.some(
      (e) =>
        e.when !== undefined &&
        readsDisposition(e.when) &&
        evaluateLogic(e.when, context, this.registry),
    );
  }

  /** Moves past the current `line`: to its `next`, or ends the conversation. */
  advance(): DialogueView {
    const session = this.live();
    if (session === undefined) return { kind: 'ended', reason: 'completed' };
    const node = session.node;
    if (node.kind !== 'line') return this.viewOf(session);
    return node.next === undefined ? this.finish(session) : this.enter(session, node.next);
  }

  /** Chooses option `index` of the current `choice`, as listed by `choices()`. */
  choose(index: number): ChooseResult {
    const session = this.live();
    if (session === undefined) {
      return {
        ok: false,
        reason: 'not-waiting-for-choice',
        view: { kind: 'ended', reason: 'completed' },
      };
    }
    const node = session.node;
    if (node.kind !== 'choice') {
      return { ok: false, reason: 'not-waiting-for-choice', view: this.viewOf(session) };
    }
    const listed = this.listChoices(session, node);
    const picked = listed[index];
    if (picked === undefined) {
      return { ok: false, reason: 'no-such-choice', view: this.viewOf(session) };
    }
    if (picked.choice.locked) {
      return { ok: false, reason: 'locked', view: this.viewOf(session) };
    }
    const option = picked.option;
    const result = this.apply(option.effects ?? [], session, option.id);
    if (!result.ok) {
      if (option.onFail !== undefined)
        return { ok: true, view: this.enter(session, option.onFail) };
      return {
        ok: false,
        reason: 'effects-failed',
        detail: result.reason,
        view: this.viewOf(session),
      };
    }
    this.visit(session, option.id, 'option');
    const view =
      option.next === undefined ? this.finish(session) : this.enter(session, option.next);
    return { ok: true, view };
  }

  /**
   * Ends the running conversation from outside (combat, the player walks away). Effects already
   * applied stay; nothing is pending, because each batch is applied whole at the moment of choice.
   * Returns false when no conversation runs.
   */
  abort(cause?: string): boolean {
    const session = this.live();
    if (session === undefined) return false;
    this.close(session, 'aborted', cause);
    return true;
  }

  /** The session, unless the world was restored since (then it is dropped without events). */
  private live(): Session | undefined {
    if (this.seenRestores !== this.options.world.restores) {
      this.seenRestores = this.options.world.restores;
      this.session = undefined;
    }
    return this.session;
  }

  private contextFor(npc: string, dialogue: string): LogicHost {
    return withVisits(this.options.host, {
      visitCount: (id, other) => this.visitCount(npc, other ?? dialogue, id),
    });
  }

  private pickEntry(dialogue: DialogueDef, context: LogicHost) {
    return dialogue.entries.find(
      (e) => e.when === undefined || evaluateLogic(e.when, context, this.registry),
    );
  }

  private holds(session: Position, condition: LogicNode): boolean {
    return evaluateLogic(
      condition,
      this.contextFor(session.npc, session.dialogue.id),
      this.registry,
    );
  }

  private listChoices(
    session: Session,
    node: Extract<DialogueNode, { kind: 'choice' }>,
  ): { choice: DialogueChoice; option: DialogueOption }[] {
    const listed: { choice: DialogueChoice; option: DialogueOption }[] = [];
    for (const option of node.options) {
      if (option.once && this.visitCount(session.npc, session.dialogue.id, option.id) > 0) continue;
      const open = option.when === undefined || this.holds(session, option.when);
      if (!open && !option.showWhenLocked) continue;
      const base = {
        index: listed.length,
        id: option.id,
        text: option.text,
        textKey: option.textKey ?? textKey(session.dialogue.id, node.id, option.id),
        tags: deriveOptionTags(option.when, this.options.tags),
        ...this.oddsOf(session, option),
      };
      const choice: DialogueChoice =
        open || option.when === undefined
          ? { ...base, locked: false }
          : {
              ...base,
              locked: true,
              reason: describeCondition(option.when),
              reasonParts: describeConditionParts(option.when),
            };
      listed.push({ choice, option });
    }
    return listed;
  }

  /** `{ check }` when `option` leads straight to a check node and a previewer is wired. */
  private oddsOf(session: Position, option: DialogueOption): { check?: CheckBreakdown } {
    const { preview } = this.options;
    const target = option.next === undefined ? undefined : this.nodeOf(session, option.next);
    return preview === undefined || target?.kind !== 'check'
      ? {}
      : { check: preview(this.requestFor(session, target)) };
  }

  private nodeOf(position: Position, id: string): DialogueNode | undefined {
    return position.dialogue.nodes.find((n) => n.id === id);
  }

  private requestFor(position: Position, node: CheckNode): CheckRequest {
    const speaker = position.dialogue.speakers.find((s) => s.id === node.target);
    return {
      dialogue: position.dialogue.id,
      npc: position.npc,
      node,
      target: speaker?.npc?.id ?? position.npc,
      context: this.contextFor(position.npc, position.dialogue.id),
    };
  }

  private viewOf(session: Session): DialogueView {
    const { node } = session;
    const where = { dialogue: session.dialogue.id, npc: session.npc, node: node.id };
    if (node.kind === 'line') {
      return {
        kind: 'line',
        ...where,
        speaker: node.speaker,
        text: node.text,
        textKey: node.textKey ?? textKey(session.dialogue.id, node.id),
      };
    }
    return {
      kind: 'choice',
      ...where,
      choices: this.listChoices(session, node).map(({ choice }) => choice),
    };
  }

  private apply(effects: readonly LogicNode[], session: Position, at: string): LogicApplyResult {
    if (effects.length === 0) return { ok: true, applied: 0 };
    const result = applyLogicEffects(effects, this.options.host, this.registry);
    if (!result.ok) this.fail(session, at, 'effects-failed', result.reason);
    return result;
  }

  private fail(session: Position, at: string, code: string, detail: string): void {
    this.emit(DialogueError, { dialogue: session.dialogue.id, npc: session.npc, at, code, detail });
  }

  private visit(session: Position, id: string, what: 'node' | 'option'): void {
    const { facts } = this.options.world;
    const count = facts.increment(dialogueVisitKey(session.npc, session.dialogue.id, id));
    this.emit(DialogueNodeVisited, {
      dialogue: session.dialogue.id,
      npc: session.npc,
      id,
      what,
      count,
    });
  }

  /** Enters `nodeId` and runs silent nodes until the player is needed or the conversation ends. */
  private enter(position: Position, nodeId: string): DialogueView {
    let target = nodeId;
    for (let steps = 0; steps < MAX_SILENT_STEPS; steps++) {
      const node = this.nodeOf(position, target);
      if (node === undefined) {
        this.fail(position, target, 'unknown-node', `no node "${target}"`);
        return this.close(position, 'aborted', 'unknown-node');
      }
      this.visit(position, node.id, 'node');
      switch (node.kind) {
        case 'line':
          return this.wait(position, node);
        case 'choice':
          if (this.listChoices({ ...position, node }, node).every(({ choice }) => choice.locked)) {
            this.fail(position, node.id, 'no-choices', 'no option can be chosen');
            return this.close(position, 'aborted', 'no-choices');
          }
          return this.wait(position, node);
        case 'end':
          return this.finish(position);
        case 'branch':
          target = node.routes.find((route) => this.holds(position, route.when))?.next ?? node.else;
          break;
        case 'effect': {
          const result = this.apply(node.effects, position, node.id);
          if (result.ok) {
            if (node.next === undefined) return this.finish(position);
            target = node.next;
          } else if (node.onFail !== undefined) {
            target = node.onFail;
          } else {
            return this.close(position, 'aborted', 'effects-failed');
          }
          break;
        }
        case 'check': {
          const decided = (this.options.checks ?? failClosed)(this.requestFor(position, node));
          const outcome = typeof decided === 'boolean' ? { success: decided } : decided;
          const success = outcome.success;
          this.emit(DialogueCheckResolved, {
            dialogue: position.dialogue.id,
            npc: position.npc,
            node: node.id,
            success,
            ...(outcome.breakdown !== undefined && { breakdown: outcome.breakdown }),
          });
          const effects = (success ? node.successEffects : node.failureEffects) ?? [];
          this.apply(effects, position, node.id);
          target = success ? node.success : node.failure;
          break;
        }
        case 'jump': {
          const other = this.options.dialogues(node.dialogue.id);
          if (other === undefined) {
            this.fail(position, node.id, 'unknown-dialogue', node.dialogue.id);
            return this.close(position, 'aborted', 'unknown-dialogue');
          }
          position.dialogue = other;
          const entry =
            node.node ?? this.pickEntry(other, this.contextFor(position.npc, other.id))?.node;
          if (entry === undefined) {
            this.fail(position, node.id, 'no-entry', `no entry of "${other.id}" holds`);
            return this.close(position, 'aborted', 'no-entry');
          }
          target = entry;
          break;
        }
      }
    }
    this.fail(position, target, 'loop', `more than ${String(MAX_SILENT_STEPS)} silent nodes`);
    return this.close(position, 'aborted', 'loop');
  }

  private wait(position: Position, node: Session['node']): DialogueView {
    const session: Session = { ...position, node };
    this.session = session;
    return this.viewOf(session);
  }

  private finish(session: Position): DialogueView {
    return this.close(session, 'completed');
  }

  private close(session: Position, reason: DialogueEndReason, cause?: string): DialogueView {
    this.session = undefined;
    this.emit(DialogueEnded, {
      dialogue: session.dialogue.id,
      npc: session.npc,
      reason,
      ...(cause !== undefined && { cause }),
    });
    return { kind: 'ended', reason, ...(cause !== undefined && { cause }) };
  }

  private emit<T extends { readonly tick: number }>(
    type: EventType<T>,
    payload: Omit<T, 'tick'>,
  ): void {
    this.options.world.events.emit(type, { tick: this.options.world.tick, ...payload } as T);
  }
}
