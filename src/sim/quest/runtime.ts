// The quest runtime (mw-e23.2): the state machine every quest runs on.
//
//   unstarted -> active -> resolved(<resolution id>) | failed(<failure id>)
//
// A quest starts by its `startWhen` condition or by an effect (`startQuest`), tracks its objectives,
// and ends the first time one of its resolutions' `when` holds (highest `priority`, then file order,
// when several hold in the same evaluation) or one of its failures' does. Resolved and failed are
// terminal: nothing later changes them (AC-4). When a quest resolves, the objectives it did not
// complete are `skipped`, so a resolution never waits for an optional objective (AC-3); when it
// fails they are `failed`. Resolutions are checked before failures, so an outcome that is both is a
// resolution.
//
// State lives in world facts (the world-state store), so it is in snapshots, hashes and saves with
// no section of its own, and dialogue and level variants can read it like any fact:
//   quest.<id>.state       unstarted | active | resolved | failed   (default unstarted)
//   quest.<id>.stage       the current stage (quests with stages)
//   quest.<id>.resolution  the resolution id once resolved
//   quest.<id>.failure     the failure id once failed
//   quest.<id>.objective.<oid>   inactive | active | complete | skipped | failed
//   quest.<id>.seen.<oid>        true: an event-bound objective's event happened before it was
//                                active (see `observe`); written only then, so play that no quest
//                                cares about saves nothing
// `declareQuestFacts` declares them (the constructor does it), and it must run before a save loads,
// or the load drops them as undeclared. A world that never builds a runtime never gets a key.
//
// Changes are atomic: a batch of quest changes (and, for resolutions and failures, their effects) is
// buffered in an overlay over the fact store and written in one fact transaction at the outermost
// commit; a refusal rolls the overlay, the base host and the queued events back together.
//
// Evaluation is incremental. At registration every condition is walked once into a dependency index
// (deps.ts): a quest is re-evaluated only when a fact it reads changed (the runtime listens to
// `factChanged`), an item, capability or other quest it reads was reported, or it reads something
// unannounced (gold, time, disposition) and the poll interval came round. `update()` is the per-tick
// entry point; `settle()` evaluates the dirty quests now, repeating while evaluation cascades.
//
// Extension points: mw-e23.3 marks event-bound objectives with `completeObjective` (and finds what
// to watch with `activeObjectives`); mw-e23.4 adds failure triggers (`npcRemoved`, `itemDestroyed`,
// `deadlineDays`) and passes `onFail` to apply a failure's continuation inside the failure's batch.

import type { QuestDef, QuestFailure, QuestObjective } from '../../content/types/quest';
import type { EventType } from '../core/events';
import type { System, World } from '../core/world';
import { factChanged, type FactStore, type FactValue } from '../facts/store';
import {
  applyLogicEffects,
  evaluateLogic,
  logicRegistry,
  LOGIC_OBJECTIVE_STATES,
  LOGIC_QUEST_STATES,
  type LogicCheckpoint,
  type LogicFailure,
  type LogicHost,
  type LogicNode,
  type LogicObjectiveState,
  type LogicQuestState,
  type LogicRegistry,
} from '../logic';
import { collectDependencies, emptyDependencies } from './deps';
import {
  QuestFailed,
  QuestObjectiveChanged,
  QuestRefused,
  QuestResolved,
  QuestStageChanged,
  QuestStarted,
} from './events';
import { questLogicHost, type QuestOps } from './host';

/** Ticks between re-evaluations of quests that read unannounced state (gold, time, disposition). */
export const QUEST_POLL_TICKS = 30;

/** Evaluation passes `settle` makes before it leaves the rest for the next tick. */
export const QUEST_MAX_PASSES = 8;

/** Where quest events go and where `factChanged` comes from: `World.events`. */
export interface QuestEventSink {
  emit<T>(type: EventType<T>, payload: T): void;
  on<T>(type: EventType<T>, handler: (payload: T) => void): () => void;
}

/** Applies a failure's continuation (mw-e23.4) inside the failure's batch; a refusal undoes it all. */
export type QuestFailHook = (failure: QuestFailure, quest: QuestDef) => LogicFailure | undefined;

export interface QuestRuntimeOptions {
  readonly quests: readonly QuestDef[];
  /** Where state lives; the runtime declares its keys here. */
  readonly facts: FactStore;
  /** What the game already has: items, gold, facts, events. Its quest methods are never called. */
  readonly host: LogicHost;
  /** Quest events are published here, and `factChanged` read from here. Without it: neither. */
  readonly events?: QuestEventSink;
  readonly registry?: LogicRegistry;
  readonly pollEveryTicks?: number;
  readonly onFail?: QuestFailHook;
}

const CLOSED: ReadonlySet<string> = new Set(['complete', 'skipped', 'failed']);

interface ObjectiveMeta {
  readonly def: QuestObjective;
  readonly key: string;
  /** For `fact` objectives: what to watch. */
  readonly watch: { readonly fact: string; readonly value: FactValue } | undefined;
  /** For `haveItem` objectives: the stack to hold, and whether reaching it is permanent. */
  readonly holds:
    { readonly item: string; readonly count: number; readonly latch: boolean } | undefined;
  /** For event-bound kinds: the fact that remembers the event happened before the objective was active. */
  readonly seenKey: string | undefined;
}

interface QuestMeta {
  readonly index: number;
  readonly def: QuestDef;
  readonly stateKey: string;
  readonly stageKey: string;
  readonly resolutionKey: string;
  readonly failureKey: string;
  readonly objectives: readonly ObjectiveMeta[];
  /** Resolutions by priority (high first), then file order. */
  readonly ordered: QuestDef['resolutions'];
}

export const questFactKey = (quest: string, part: 'state' | 'stage' | 'resolution' | 'failure') =>
  `quest.${quest}.${part}`;
/** Remembers that the event of an event-bound objective happened while it was not yet active. */
export const questSeenFactKey = (quest: string, objective: string) =>
  `quest.${quest}.seen.${objective}`;
export const questObjectiveFactKey = (quest: string, objective: string) =>
  `quest.${quest}.objective.${objective}`;

/**
 * Declares the facts `quests` use on `store` (those not declared already). The runtime does this
 * itself; call it directly to declare them before the runtime is built, e.g. ahead of a save load.
 */
export function declareQuestFacts(store: FactStore, quests: readonly QuestDef[]): void {
  const declare = (key: string, spec: Parameters<FactStore['declare']>[1]): void => {
    if (!store.isDeclared(key)) store.declare(key, spec);
  };
  for (const quest of quests) {
    declare(questFactKey(quest.id, 'state'), {
      type: 'enum',
      values: [...LOGIC_QUEST_STATES],
      default: 'unstarted',
    });
    declare(questFactKey(quest.id, 'resolution'), {
      type: 'enum',
      values: quest.resolutions.map((r) => r.id),
    });
    if (quest.stages.length > 0) {
      declare(questFactKey(quest.id, 'stage'), {
        type: 'enum',
        values: quest.stages.map((s) => s.id),
      });
    }
    if (quest.failures.length > 0) {
      declare(questFactKey(quest.id, 'failure'), {
        type: 'enum',
        values: quest.failures.map((f) => f.id),
      });
    }
    for (const objective of quest.objectives) {
      declare(questObjectiveFactKey(quest.id, objective.id), {
        type: 'enum',
        values: [...LOGIC_OBJECTIVE_STATES],
        default: 'inactive',
      });
      if (isEventBound(objective))
        declare(questSeenFactKey(quest.id, objective.id), { type: 'bool' });
    }
  }
}

/** Event-bound kinds are one-shot happenings; `fact` and `haveItem` read durable state instead. */
export const isEventBound = (objective: QuestObjective): boolean =>
  objective.kind !== 'fact' && objective.kind !== 'haveItem';

function index<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

export class QuestRuntime implements QuestOps {
  /**
   * The host to run logic against (dialogue effects, shop conditions...): the game's host with quest
   * conditions and effects served by this runtime, and one checkpoint over both.
   */
  readonly host: LogicHost;

  private readonly metas = new Map<string, QuestMeta>();
  private readonly list: QuestMeta[] = [];
  private readonly facts: FactStore;
  private readonly sink: QuestEventSink | undefined;
  private readonly registry: LogicRegistry;
  private readonly pollEvery: number;
  private readonly onFail: QuestFailHook | undefined;
  private readonly byFact = new Map<string, QuestMeta[]>();
  private readonly byItem = new Map<string, QuestMeta[]>();
  private readonly byCapability = new Map<string, QuestMeta[]>();
  private readonly byQuest = new Map<string, QuestMeta[]>();
  private readonly polled: QuestMeta[] = [];
  private readonly dirty = new Set<QuestMeta>();
  private readonly unsubscribe: (() => void) | undefined;
  /** Uncommitted writes, read before the facts; written to the facts at the outermost commit. */
  private overlay = new Map<string, FactValue>();
  private queued: (() => void)[] = [];
  /** Quests changed by the open batch; marked dirty only if it commits. */
  private touched: QuestMeta[] = [];
  private depth = 0;
  private ticks = 0;

  /** @throws the fact store's errors for an id that is not a fact key segment. */
  constructor(options: QuestRuntimeOptions) {
    this.facts = options.facts;
    this.sink = options.events;
    this.registry = options.registry ?? logicRegistry;
    this.pollEvery = options.pollEveryTicks ?? QUEST_POLL_TICKS;
    this.onFail = options.onFail;
    declareQuestFacts(this.facts, options.quests);
    for (const def of options.quests) this.register(def);
    this.host = questLogicHost(options.host, this);
    this.unsubscribe = this.sink?.on(factChanged, ({ key }) => {
      this.notifyFact(key);
    });
    this.refresh();
  }

  private register(def: QuestDef): void {
    const at = this.list.length;
    const deps = emptyDependencies();
    const need = (condition: LogicNode | undefined): void => {
      if (condition !== undefined) collectDependencies(condition, deps);
    };
    need(def.startWhen);
    const objectives = def.objectives.map((objective): ObjectiveMeta => {
      need(objective.activeWhen);
      const watch =
        objective.kind === 'fact'
          ? { fact: objective.params.fact, value: objective.params.value }
          : undefined;
      if (watch !== undefined) deps.facts.add(watch.fact);
      const holds =
        objective.kind === 'haveItem'
          ? {
              item: objective.params.item.id,
              count: objective.params.count,
              latch: objective.params.latch,
            }
          : undefined;
      if (holds !== undefined) deps.items.add(holds.item);
      return {
        def: objective,
        key: questObjectiveFactKey(def.id, objective.id),
        watch,
        holds,
        seenKey: isEventBound(objective) ? questSeenFactKey(def.id, objective.id) : undefined,
      };
    });
    for (const stage of def.stages) for (const t of stage.transitions) need(t.when);
    for (const resolution of def.resolutions) need(resolution.when);
    for (const failure of def.failures) need(failure.when);
    const meta: QuestMeta = {
      index: at,
      def,
      stateKey: questFactKey(def.id, 'state'),
      stageKey: questFactKey(def.id, 'stage'),
      resolutionKey: questFactKey(def.id, 'resolution'),
      failureKey: questFactKey(def.id, 'failure'),
      objectives,
      ordered: [...def.resolutions].sort((a, b) => b.priority - a.priority),
    };
    this.metas.set(def.id, meta);
    this.list.push(meta);
    for (const key of deps.facts) index(this.byFact, key, meta);
    for (const item of deps.items) index(this.byItem, item, meta);
    for (const capability of deps.capabilities) index(this.byCapability, capability, meta);
    for (const quest of deps.quests) index(this.byQuest, quest, meta);
    if (deps.polled) this.polled.push(meta);
  }

  /** Stops listening for fact changes. */
  dispose(): void {
    this.unsubscribe?.();
  }

  // ---------------------------------------------------------------------------------------------
  // Reading

  has(quest: string): boolean {
    return this.metas.has(quest);
  }

  /** The registered quest ids, in registration order. */
  ids(): readonly string[] {
    return this.list.map((meta) => meta.def.id);
  }

  questState(quest: string): LogicQuestState {
    const meta = this.metas.get(quest);
    return meta === undefined ? 'unstarted' : (this.read(meta.stateKey) as LogicQuestState);
  }

  objectiveState(quest: string, objective: string): LogicObjectiveState {
    const found = this.metas.get(quest)?.objectives.find((o) => o.def.id === objective);
    return found === undefined ? 'inactive' : (this.read(found.key) as LogicObjectiveState);
  }

  /** The current stage of a quest that has stages (and has started). */
  stage(quest: string): string | undefined {
    const meta = this.metas.get(quest);
    return meta === undefined ? undefined : (this.read(meta.stageKey) as string | undefined);
  }

  /** The resolution a resolved quest ended with, if it named one. */
  resolution(quest: string): string | undefined {
    const meta = this.metas.get(quest);
    return meta === undefined ? undefined : (this.read(meta.resolutionKey) as string | undefined);
  }

  /** The failure a failed quest ended with, if it named one. */
  failure(quest: string): string | undefined {
    const meta = this.metas.get(quest);
    return meta === undefined ? undefined : (this.read(meta.failureKey) as string | undefined);
  }

  /**
   * Every active objective of every active quest, in quest then file order: what objective trackers
   * (mw-e23.3) watch for.
   */
  activeObjectives(): readonly { readonly quest: string; readonly objective: QuestObjective }[] {
    const result: { quest: string; objective: QuestObjective }[] = [];
    for (const meta of this.list) {
      if (this.read(meta.stateKey) !== 'active') continue;
      for (const o of meta.objectives) {
        if (this.read(o.key) === 'active') result.push({ quest: meta.def.id, objective: o.def });
      }
    }
    return result;
  }

  // ---------------------------------------------------------------------------------------------
  // Changing (each returns undefined on success or the reason it refused, like `LogicHost`)

  /** Starts a quest that has not started: it becomes active in its first stage. */
  startQuest(quest: string): LogicFailure | undefined {
    const meta = this.metas.get(quest);
    if (meta === undefined) return `unknown-quest:${quest}`;
    return this.run(() => {
      if (this.read(meta.stateKey) !== 'unstarted') return `quest-already-started:${quest}`;
      this.put(meta.stateKey, 'active');
      const first = meta.def.initialStage ?? meta.def.stages[0]?.id;
      if (first !== undefined) this.put(meta.stageKey, first);
      this.queue(QuestStarted, { quest });
      if (first !== undefined) this.queue(QuestStageChanged, { quest, stage: first });
      this.refreshObjectives(meta);
      this.touch(meta);
      return undefined;
    });
  }

  /**
   * Marks an objective complete: the hook for event-bound objective kinds (mw-e23.3) and the
   * `completeObjective` effect. Completing a complete objective is a no-op, and a quest that is not
   * active refuses (its objectives are closed). An inactive objective may be completed (an effect
   * knows best).
   */
  completeObjective(quest: string, objective: string): LogicFailure | undefined {
    const meta = this.metas.get(quest);
    if (meta === undefined) return `unknown-quest:${quest}`;
    const found = meta.objectives.find((o) => o.def.id === objective);
    if (found === undefined) return `unknown-objective:${quest}/${objective}`;
    return this.run(() => {
      if (this.read(meta.stateKey) !== 'active') return `quest-not-active:${quest}`;
      if (this.read(found.key) === 'complete') return undefined;
      this.setObjective(meta, found, 'complete');
      this.touch(meta);
      return undefined;
    });
  }

  /**
   * Reports a happening to the event-bound objectives (mw-e23.12): every objective of an active quest
   * that `matches` and is not closed. An active one completes now. One that is not active yet (a later
   * stage, an unmet `activeWhen`) records the event in its `seen` fact, so it completes the moment it
   * becomes active: killing the chief or entering an area early still counts. The fact is saved with
   * the world and is written only in that case.
   */
  observe(matches: (objective: QuestObjective) => boolean): void {
    this.run(() => {
      for (const meta of this.list) {
        if (this.read(meta.stateKey) !== 'active') continue;
        for (const o of meta.objectives) {
          if (o.seenKey === undefined || !matches(o.def)) continue;
          const now = this.read(o.key);
          if (now === 'active') this.setObjective(meta, o, 'complete');
          else if (now === 'inactive') this.put(o.seenKey, true);
          else continue;
          this.touch(meta);
        }
      }
      return undefined;
    });
  }

  /** Moves an active quest to another of its stages; objectives of the stages follow. */
  setStage(quest: string, stage: string): LogicFailure | undefined {
    const meta = this.metas.get(quest);
    if (meta === undefined) return `unknown-quest:${quest}`;
    if (!meta.def.stages.some((s) => s.id === stage)) return `unknown-stage:${quest}/${stage}`;
    return this.run(() => {
      if (this.read(meta.stateKey) !== 'active') return `quest-not-active:${quest}`;
      if (this.read(meta.stageKey) !== stage) {
        this.put(meta.stageKey, stage);
        this.queue(QuestStageChanged, { quest, stage });
      }
      this.refreshObjectives(meta);
      this.touch(meta);
      return undefined;
    });
  }

  /**
   * Resolves an active quest, applying the resolution's effects in the same batch. Without a
   * resolution id it just ends the quest. Refuses (changing nothing) when the quest is not active,
   * the id is unknown or an effect refuses.
   */
  resolveQuest(quest: string, resolution: string | undefined): LogicFailure | undefined {
    const meta = this.metas.get(quest);
    if (meta === undefined) return `unknown-quest:${quest}`;
    const chosen = meta.def.resolutions.find((r) => r.id === resolution);
    if (resolution !== undefined && chosen === undefined) {
      return `unknown-resolution:${quest}/${resolution}`;
    }
    return this.within(() => {
      if (this.read(meta.stateKey) !== 'active') return `quest-not-active:${quest}`;
      this.put(meta.stateKey, 'resolved');
      if (chosen !== undefined) this.put(meta.resolutionKey, chosen.id);
      this.closeObjectives(meta, 'skipped');
      this.queue(QuestResolved, { quest, resolution });
      this.touch(meta);
      return chosen?.effects === undefined ? undefined : this.apply(chosen.effects);
    });
  }

  /** Fails an active quest without naming a failure (the `failQuest` effect). */
  failQuest(quest: string): LogicFailure | undefined {
    const meta = this.metas.get(quest);
    return meta === undefined ? `unknown-quest:${quest}` : this.failWith(meta, undefined);
  }

  private failWith(meta: QuestMeta, failure: QuestFailure | undefined): LogicFailure | undefined {
    const quest = meta.def.id;
    return this.within(() => {
      if (this.read(meta.stateKey) !== 'active') return `quest-not-active:${quest}`;
      this.put(meta.stateKey, 'failed');
      if (failure !== undefined) this.put(meta.failureKey, failure.id);
      this.closeObjectives(meta, 'failed');
      this.queue(QuestFailed, { quest, failure: failure?.id });
      this.touch(meta);
      if (failure === undefined) return undefined;
      const refused = failure.effects === undefined ? undefined : this.apply(failure.effects);
      return refused ?? this.onFail?.(failure, meta.def);
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Evaluating

  /** Reports a changed fact (the runtime also hears `factChanged` itself, when it has events). */
  notifyFact(key: string): void {
    this.markAll(this.byFact.get(key));
  }

  /** Reports that the player's count of `item` changed. */
  notifyItem(item: string): void {
    this.markAll(this.byItem.get(item));
  }

  /** Reports that the player learned (or lost) `capability`. */
  notifyCapability(capability: string): void {
    this.markAll(this.byCapability.get(capability));
  }

  /** Re-evaluates every quest at the next `settle`: call after loading a save. */
  refresh(): void {
    for (const meta of this.list) this.dirty.add(meta);
  }

  /** The per-tick entry point: polls quests that read unannounced state, then settles. */
  update(): void {
    this.ticks++;
    if (this.ticks % this.pollEvery === 0) this.markAll(this.polled);
    this.settle();
  }

  /** Evaluates the dirty quests now, again while that dirties others, up to `QUEST_MAX_PASSES`. */
  settle(): void {
    for (let pass = 0; pass < QUEST_MAX_PASSES && this.dirty.size > 0; pass++) {
      const batch = [...this.dirty].sort((a, b) => a.index - b.index);
      this.dirty.clear();
      for (const meta of batch) this.evaluate(meta);
    }
  }

  private evaluate(meta: QuestMeta): void {
    let state = this.read(meta.stateKey);
    if (
      state === 'unstarted' &&
      meta.def.startWhen !== undefined &&
      this.holds(meta.def.startWhen)
    ) {
      this.startQuest(meta.def.id);
      state = this.read(meta.stateKey);
    }
    if (state !== 'active') return;
    this.run(() => {
      this.refreshObjectives(meta);
      return undefined;
    });
    for (const resolution of meta.ordered) {
      if (!this.holds(resolution.when)) continue;
      const refused = this.resolveQuest(meta.def.id, resolution.id);
      if (refused === undefined) return;
      this.refused(meta, `resolution:${resolution.id}`, refused);
    }
    for (const failure of meta.def.failures) {
      if (failure.when === undefined || !this.holds(failure.when)) continue;
      const refused = this.failWith(meta, failure);
      if (refused === undefined) return;
      this.refused(meta, `failure:${failure.id}`, refused);
    }
    this.advance(meta);
  }

  /** Moves the quest out of its stage by the first transition whose condition holds (one per pass). */
  private advance(meta: QuestMeta): void {
    const stage = this.read(meta.stageKey);
    const transitions = meta.def.stages.find((s) => s.id === stage)?.transitions ?? [];
    for (const [i, transition] of transitions.entries()) {
      if (!this.holds(transition.when)) continue;
      const refused = this.within(() => {
        const moved = this.setStage(meta.def.id, transition.stage);
        return (
          moved ?? (transition.effects === undefined ? undefined : this.apply(transition.effects))
        );
      });
      if (refused === undefined) return;
      this.refused(meta, `transition:${String(stage)}/${String(i)}`, refused);
    }
  }

  private refused(meta: QuestMeta, outcome: string, reason: string): void {
    this.sink?.emit(QuestRefused, { quest: meta.def.id, outcome, reason });
  }

  private holds(condition: LogicNode): boolean {
    return evaluateLogic(condition, this.host, this.registry);
  }

  /** Recomputes which objectives are active and completes `fact` and `haveItem` objectives that hold. */
  private refreshObjectives(meta: QuestMeta): void {
    const stage = this.read(meta.stageKey);
    for (const o of meta.objectives) {
      const now = this.read(o.key) as string;
      // A held-item objective that is not latched follows the stack: complete while held, active again after.
      const follows = now === 'complete' && o.holds !== undefined && !o.holds.latch;
      if (CLOSED.has(now) && !follows) continue;
      const active =
        (o.def.stage === undefined || o.def.stage === stage) &&
        (o.def.activeWhen === undefined || this.holds(o.def.activeWhen));
      const done =
        active &&
        ((o.seenKey !== undefined && this.read(o.seenKey) === true) ||
          (o.watch !== undefined && this.facts.get(o.watch.fact) === o.watch.value) ||
          (o.holds !== undefined && this.host.itemCount(o.holds.item) >= o.holds.count));
      this.setObjective(meta, o, done ? 'complete' : active ? 'active' : 'inactive');
    }
  }

  private closeObjectives(meta: QuestMeta, state: 'skipped' | 'failed'): void {
    for (const o of meta.objectives) {
      if (!CLOSED.has(this.read(o.key) as string)) this.setObjective(meta, o, state);
    }
  }

  private setObjective(meta: QuestMeta, o: ObjectiveMeta, state: LogicObjectiveState): void {
    if (this.read(o.key) === state) return;
    this.put(o.key, state);
    this.queue(QuestObjectiveChanged, { quest: meta.def.id, objective: o.def.id, state });
  }

  /** Notes that `meta` changed: it and whatever reads it are re-evaluated once the batch commits. */
  private touch(meta: QuestMeta): void {
    this.touched.push(meta);
  }

  private markAll(metas: readonly QuestMeta[] | undefined): void {
    if (metas === undefined) return;
    for (const meta of metas) this.dirty.add(meta);
  }

  // ---------------------------------------------------------------------------------------------
  // Batches

  private read(key: string): FactValue | undefined {
    return this.overlay.get(key) ?? this.facts.get(key);
  }

  private put(key: string, value: FactValue): void {
    this.overlay.set(key, value);
  }

  private queue<T>(type: EventType<T>, payload: T): void {
    const { sink } = this;
    if (sink !== undefined)
      this.queued.push(() => {
        sink.emit(type, payload);
      });
  }

  /** Opens an undo point over the quest state; the facts are written when the last one commits. */
  openBatch(): LogicCheckpoint {
    const saved = {
      overlay: new Map(this.overlay),
      queued: this.queued.length,
      touched: this.touched.length,
    };
    this.depth++;
    const close = (commit: boolean): void => {
      this.depth--;
      if (!commit) {
        this.overlay = saved.overlay;
        this.queued.length = saved.queued;
        this.touched.length = saved.touched;
      }
      if (this.depth === 0) this.flush();
    };
    return {
      commit: () => {
        close(true);
      },
      rollback: () => {
        close(false);
      },
    };
  }

  /** Writes the overlay to the facts in one transaction, then publishes the queued events. */
  private flush(): void {
    const { overlay, queued, touched } = this;
    this.overlay = new Map();
    this.queued = [];
    this.touched = [];
    for (const meta of touched) {
      this.dirty.add(meta);
      this.markAll(this.byQuest.get(meta.def.id));
    }
    this.facts.transaction(() => {
      for (const [key, value] of overlay) this.facts.set(key, value);
    });
    for (const publish of queued) publish();
  }

  /** Runs `change` over the quest state alone: undone if it refuses or throws. */
  private run(change: () => LogicFailure | undefined): LogicFailure | undefined {
    const batch = this.openBatch();
    let refused: LogicFailure | undefined;
    try {
      refused = change();
    } catch (error) {
      batch.rollback();
      throw error;
    }
    if (refused === undefined) batch.commit();
    else batch.rollback();
    return refused;
  }

  /** Like `run`, over the game's host too: the effects `change` applies are undone with it. */
  private within(change: () => LogicFailure | undefined): LogicFailure | undefined {
    const batch = this.host.checkpoint();
    let refused: LogicFailure | undefined;
    try {
      refused = change();
    } catch (error) {
      batch.rollback();
      throw error;
    }
    if (refused === undefined) batch.commit();
    else batch.rollback();
    return refused;
  }

  private apply(effects: readonly LogicNode[]): LogicFailure | undefined {
    const result = applyLogicEffects(effects, this.host, this.registry);
    return result.ok ? undefined : `effect-refused:${result.kind}:${result.reason}`;
  }
}

const runtimes = new WeakMap<World<never>, QuestRuntime>();

/** The quest runtime installed on `world`, if any. */
export function questRuntimeOf(world: World<never>): QuestRuntime | undefined {
  return runtimes.get(world);
}

/**
 * Builds a quest runtime over `world`'s facts and events and adds the `quests` system, which
 * updates it every tick. Nothing is declared or written until a quest exists, so a world without
 * quests is unchanged.
 * @throws RangeError when the world has a quest runtime already.
 */
export function installQuests<TInput>(
  world: World<TInput>,
  options: Omit<QuestRuntimeOptions, 'facts' | 'events'>,
): QuestRuntime {
  const sim = world as unknown as World<never>;
  if (runtimes.has(sim)) throw new RangeError('quests are already installed on this world');
  const runtime = new QuestRuntime({ ...options, facts: world.facts, events: world.events });
  runtimes.set(sim, runtime);
  const system: System<TInput> = {
    name: 'quests',
    run: () => {
      runtime.update();
    },
  };
  world.addSystem(system);
  return runtime;
}
