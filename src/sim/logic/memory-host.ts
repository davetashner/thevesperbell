// An in-memory `LogicHost` (mw-e22.2): the reference implementation of the context and host
// interfaces over plain maps. Tests of every system that uses the DSL (dialogue, quests, shops) can
// build one instead of a world, and it documents the semantics the real quest, inventory and
// disposition systems must match: refusals are `reason:subject` strings and change nothing.

import type { FactReader } from '../facts/conditions';
import type { FactValue } from '../facts/store';
import type {
  LogicCheckpoint,
  LogicFailure,
  LogicHost,
  LogicScalar,
  LogicObjectiveState,
  LogicQuestState,
} from './types';

export interface LogicEmittedEvent {
  readonly event: string;
  readonly data: Readonly<Record<string, LogicScalar>>;
}

interface LogicMemoryState {
  facts: Map<string, FactValue>;
  items: Map<string, number>;
  gold: number;
  capabilities: Set<string>;
  dispositions: Map<string, number>;
  quests: Map<string, LogicQuestState>;
  resolutions: Map<string, string | undefined>;
  objectives: Map<string, LogicObjectiveState>;
}

function cloneState(state: LogicMemoryState): LogicMemoryState {
  return {
    facts: new Map(state.facts),
    items: new Map(state.items),
    gold: state.gold,
    capabilities: new Set(state.capabilities),
    dispositions: new Map(state.dispositions),
    quests: new Map(state.quests),
    resolutions: new Map(state.resolutions),
    objectives: new Map(state.objectives),
  };
}

export interface MemoryHostInit {
  readonly facts?: Readonly<Record<string, FactValue>>;
  readonly items?: Readonly<Record<string, number>>;
  readonly gold?: number;
  readonly capabilities?: readonly string[];
  readonly playerClass?: string;
  readonly dispositions?: Readonly<Record<string, number>>;
  readonly minuteOfDay?: number;
  readonly services?: Readonly<Record<string, unknown>>;
}

export class MemoryLogicHost implements LogicHost {
  private state: LogicMemoryState;
  /** Events and rumors published by committed batches, in order. */
  readonly emitted: LogicEmittedEvent[] = [];
  readonly rumors: string[] = [];
  playerClassId: string | undefined;
  minute: number;
  readonly services: Readonly<Record<string, unknown>> | undefined;

  constructor(init: MemoryHostInit = {}) {
    this.state = {
      facts: new Map(Object.entries(init.facts ?? {})),
      items: new Map(Object.entries(init.items ?? {})),
      gold: init.gold ?? 0,
      capabilities: new Set(init.capabilities),
      dispositions: new Map(Object.entries(init.dispositions ?? {})),
      quests: new Map(),
      resolutions: new Map(),
      objectives: new Map(),
    };
    this.playerClassId = init.playerClass;
    this.minute = init.minuteOfDay ?? 0;
    this.services = init.services;
  }

  readonly facts: FactReader = {
    get: (key) => this.state.facts.get(key),
    entries: (prefix = '') =>
      [...this.state.facts]
        .filter(([key]) => key.startsWith(prefix))
        .sort(([a], [b]) => Number(a > b) - Number(a < b)),
  };

  itemCount(item: string): number {
    return this.state.items.get(item) ?? 0;
  }

  hasCapability(capability: string): boolean {
    return this.state.capabilities.has(capability);
  }

  playerClass(): string | undefined {
    return this.playerClassId;
  }

  disposition(npc: string): number {
    return this.state.dispositions.get(npc) ?? 0;
  }

  questState(quest: string): LogicQuestState {
    return this.state.quests.get(quest) ?? 'unstarted';
  }

  objectiveState(quest: string, objective: string): LogicObjectiveState {
    return this.state.objectives.get(`${quest}/${objective}`) ?? 'inactive';
  }

  gold(): number {
    return this.state.gold;
  }

  minuteOfDay(): number {
    return this.minute;
  }

  /** How a resolved quest was resolved, if it was. */
  resolution(quest: string): string | undefined {
    return this.state.resolutions.get(quest);
  }

  checkpoint(): LogicCheckpoint {
    const saved = cloneState(this.state);
    return {
      commit: () => undefined,
      rollback: () => {
        this.state = saved;
      },
    };
  }

  setFact(key: string, value: FactValue): LogicFailure | undefined {
    this.state.facts.set(key, value);
    return undefined;
  }

  giveItem(item: string, count: number): LogicFailure | undefined {
    this.state.items.set(item, this.itemCount(item) + count);
    return undefined;
  }

  takeItem(item: string, count: number): LogicFailure | undefined {
    const held = this.itemCount(item);
    if (held < count) return `missing-item:${item}`;
    this.state.items.set(item, held - count);
    return undefined;
  }

  adjustGold(delta: number): LogicFailure | undefined {
    if (this.state.gold + delta < 0) return 'insufficient-gold';
    this.state.gold += delta;
    return undefined;
  }

  adjustDisposition(npc: string, delta: number): LogicFailure | undefined {
    this.state.dispositions.set(npc, this.disposition(npc) + delta);
    return undefined;
  }

  startQuest(quest: string): LogicFailure | undefined {
    if (this.questState(quest) !== 'unstarted') return `quest-already-started:${quest}`;
    this.state.quests.set(quest, 'active');
    return undefined;
  }

  completeObjective(quest: string, objective: string): LogicFailure | undefined {
    if (this.questState(quest) !== 'active') return `quest-not-active:${quest}`;
    this.state.objectives.set(`${quest}/${objective}`, 'complete');
    return undefined;
  }

  resolveQuest(quest: string, resolution: string | undefined): LogicFailure | undefined {
    if (this.questState(quest) !== 'active') return `quest-not-active:${quest}`;
    this.state.quests.set(quest, 'resolved');
    this.state.resolutions.set(quest, resolution);
    return undefined;
  }

  failQuest(quest: string): LogicFailure | undefined {
    if (this.questState(quest) !== 'active') return `quest-not-active:${quest}`;
    this.state.quests.set(quest, 'failed');
    return undefined;
  }

  learnCapability(capability: string): LogicFailure | undefined {
    this.state.capabilities.add(capability);
    return undefined;
  }

  emit(event: string, data: Readonly<Record<string, LogicScalar>>): void {
    this.emitted.push({ event, data });
  }

  revealRumor(rumor: string): void {
    this.rumors.push(rumor);
  }
}
