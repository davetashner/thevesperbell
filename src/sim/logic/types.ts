// The context a logic condition reads and the host an effect batch changes (mw-e22.2). Both are
// plain interfaces so the DSL stays pure and engine-agnostic: the quest, disposition and dialogue
// systems that do not exist yet plug in by implementing them, and tests use `MemoryLogicHost`.

import type { FactReader } from '../facts/conditions';
import type { FactValue } from '../facts/store';

/** A scalar parameter of an emitted event or a described node. */
export type LogicScalar = string | number | boolean;

/** Every condition and effect is a JSON object with a `kind`; the rest of its fields depend on it. */
export interface LogicNode {
  readonly kind: string;
  readonly [field: string]: unknown;
}

export const LOGIC_QUEST_STATES = ['unstarted', 'active', 'resolved', 'failed'] as const;
export type LogicQuestState = (typeof LOGIC_QUEST_STATES)[number];

export const LOGIC_OBJECTIVE_STATES = ['inactive', 'active', 'complete', 'failed'] as const;
export type LogicObjectiveState = (typeof LOGIC_OBJECTIVE_STATES)[number];

/** What conditions read. Everything is a query: reading never changes the world. */
export interface LogicContext {
  /** World facts; `fact` and `factCmp` delegate to the shared condition API over this. */
  readonly facts: FactReader;
  /** How many of item `item` the player holds (0 when none). */
  itemCount(item: string): number;
  hasCapability(capability: string): boolean;
  /** The player's class id, if one is chosen. */
  playerClass(): string | undefined;
  /** An NPC's disposition score toward the player (0 when unknown). */
  disposition(npc: string): number;
  questState(quest: string): LogicQuestState;
  objectiveState(quest: string, objective: string): LogicObjectiveState;
  gold(): number;
  /** Minutes since midnight of the game clock, 0..1439. */
  minuteOfDay(): number;
  /** Data for extension kinds (their own systems); built-ins never read it. */
  readonly services?: Readonly<Record<string, unknown>> | undefined;
}

/** A failure reason: a short machine-readable string such as `missing-item:key-a`. */
export type LogicFailure = string;

/** An undo point opened before a batch: exactly one of `commit` or `rollback` is called. */
export interface LogicCheckpoint {
  commit(): void;
  rollback(): void;
}

/**
 * What effects change. Each mutator returns `undefined` on success or the reason it refused; a
 * refusal must leave that mutator's own state unchanged, and `checkpoint` lets the applier undo the
 * earlier ones, so a batch is all or nothing.
 */
export interface LogicHost extends LogicContext {
  checkpoint(): LogicCheckpoint;
  setFact(key: string, value: FactValue): LogicFailure | undefined;
  giveItem(item: string, count: number): LogicFailure | undefined;
  takeItem(item: string, count: number): LogicFailure | undefined;
  /** Adds `delta` gold (negative spends); refuses when it would go below zero. */
  adjustGold(delta: number): LogicFailure | undefined;
  adjustDisposition(npc: string, delta: number): LogicFailure | undefined;
  startQuest(quest: string): LogicFailure | undefined;
  completeObjective(quest: string, objective: string): LogicFailure | undefined;
  resolveQuest(quest: string, resolution: string | undefined): LogicFailure | undefined;
  failQuest(quest: string): LogicFailure | undefined;
  learnCapability(capability: string): LogicFailure | undefined;
  /** Publishes a sim event. Called only after the whole batch committed. */
  emit(event: string, data: Readonly<Record<string, LogicScalar>>): void;
  /** Reveals a rumor. Called only after the whole batch committed. */
  revealRumor(rumor: string): void;
}

/** A reference from a node to content, for load-time checks: `{ type: 'item', id: 'key-a' }`. */
export interface LogicRef {
  readonly type: string;
  readonly id: string;
}

/** Returns a problem description when `ref` does not resolve, otherwise `undefined`. */
export type LogicRefChecker = (ref: LogicRef) => string | undefined;
