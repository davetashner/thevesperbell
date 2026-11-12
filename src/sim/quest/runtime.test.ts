import { describe, expect, it } from 'vitest';
import type { QuestDef, QuestFailure } from '../../content/types/quest';
import { World } from '../core/world';
import { factChanged, FactStore } from '../facts/store';
import {
  LogicRegistry,
  registerLogicBuiltins,
  type LogicCheckpoint,
  type LogicFailure,
  type LogicHost,
  type LogicNode,
  type LogicScalar,
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
import {
  declareQuestFacts,
  installQuests,
  QUEST_MAX_PASSES,
  QUEST_POLL_TICKS,
  QuestRuntime,
  questRuntimeOf,
} from './runtime';

const fact = (key: string): LogicNode => ({ kind: 'fact', fact: key });
const questIs = (quest: string, state: string): LogicNode => ({ kind: 'questState', quest, state });

const res = (id: string, when: LogicNode, over: Record<string, unknown> = {}) => ({
  id,
  approach: 'other',
  when,
  priority: 0,
  journal: `${id}.`,
  ...over,
});
const objective = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  kind: 'event',
  text: id,
  optional: false,
  hidden: false,
  params: { event: 'e' },
  ...over,
});
const failure = (id: string, when: LogicNode, over: Record<string, unknown> = {}) => ({
  id,
  when,
  journal: `${id}.`,
  continuation: { kind: 'setStage', stage: 'one' },
  ...over,
});

function quest(over: Record<string, unknown> = {}): QuestDef {
  return {
    givers: [],
    stages: [],
    objectives: [],
    failures: [],
    id: 'q',
    title: 'Q',
    summary: 'S',
    resolutions: [res('win', fact('q.won'))],
    ...over,
  } as unknown as QuestDef;
}

/** The game's host, for tests: items and gold in maps, facts in the world's store. */
class TestHost implements LogicHost {
  readonly items = new Map<string, number>();
  readonly capabilities = new Set<string>();
  readonly emitted: string[] = [];
  readonly rumors: string[] = [];
  readsOfFacts = 0;
  goldAmount = 0;
  minute = 0;
  readonly services = { tag: 'svc' };

  constructor(readonly store: FactStore) {}

  readonly facts = {
    get: (key: string) => {
      this.readsOfFacts++;
      return this.store.get(key);
    },
    entries: (prefix?: string) => this.store.entries(prefix),
  };
  itemCount = (item: string) => this.items.get(item) ?? 0;
  hasCapability = (c: string) => this.capabilities.has(c);
  playerClass = () => 'thief';
  disposition = () => 7;
  gold = () => this.goldAmount;
  minuteOfDay = () => this.minute;
  questState = (): never => {
    throw new Error('the runtime never asks the base host about quests');
  };
  objectiveState = this.questState;
  startQuest = this.questState;
  completeObjective = this.questState;
  resolveQuest = this.questState;
  failQuest = this.questState;

  checkpoint(): LogicCheckpoint {
    const items = new Map(this.items);
    const caps = new Set(this.capabilities);
    const gold = this.goldAmount;
    const facts = this.store.snapshot();
    return {
      commit: () => undefined,
      rollback: () => {
        this.items.clear();
        for (const [k, v] of items) this.items.set(k, v);
        this.capabilities.clear();
        for (const c of caps) this.capabilities.add(c);
        this.goldAmount = gold;
        this.store.prepareRestore(facts)();
      },
    };
  }
  setFact(key: string, value: boolean | number | string): LogicFailure | undefined {
    this.store.set(key, value);
    return undefined;
  }
  giveItem(item: string, count: number): LogicFailure | undefined {
    this.items.set(item, this.itemCount(item) + count);
    return undefined;
  }
  takeItem(item: string, count: number): LogicFailure | undefined {
    if (this.itemCount(item) < count) return `missing-item:${item}`;
    this.items.set(item, this.itemCount(item) - count);
    return undefined;
  }
  adjustGold(delta: number): LogicFailure | undefined {
    this.goldAmount += delta;
    return undefined;
  }
  adjustDisposition(): LogicFailure | undefined {
    return undefined;
  }
  learnCapability(c: string): LogicFailure | undefined {
    this.capabilities.add(c);
    return undefined;
  }
  emit(event: string, data: Readonly<Record<string, LogicScalar>>): void {
    this.emitted.push(`${event}:${JSON.stringify(data)}`);
  }
  revealRumor(rumor: string): void {
    this.rumors.push(rumor);
  }
}

interface Setup {
  readonly world: World<never>;
  readonly host: TestHost;
  readonly runtime: QuestRuntime;
  readonly events: string[];
}

type Extra = Partial<ConstructorParameters<typeof QuestRuntime>[0]>;

function setup(quests: QuestDef[], extra: Extra = {}): Setup {
  const world = new World<never>({ seed: 1 });
  const host = new TestHost(world.facts);
  const runtime = new QuestRuntime({
    quests,
    facts: world.facts,
    host,
    events: world.events,
    ...extra,
  });
  const events: string[] = [];
  for (const type of [
    QuestStarted,
    QuestStageChanged,
    QuestObjectiveChanged,
    QuestResolved,
    QuestFailed,
    QuestRefused,
  ]) {
    world.events.on(type as never, (payload: unknown) => {
      events.push(`${type.name} ${JSON.stringify(payload)}`);
    });
  }
  return { world, host, runtime, events };
}

/** Sets facts as the sim would, delivers the events and runs one update. */
function step(s: Setup, facts: Record<string, boolean | number | string> = {}): void {
  s.world.facts.transaction(() => {
    for (const [key, value] of Object.entries(facts)) s.world.facts.set(key, value);
  });
  s.world.events.flush();
  s.runtime.update();
  s.world.events.flush();
}

const started = (quests: QuestDef[], extra: Extra = {}) => {
  const s = setup(quests, extra);
  expect(s.runtime.startQuest(quests[0]?.id ?? 'q')).toBeUndefined();
  s.runtime.settle();
  s.world.events.flush();
  s.events.length = 0;
  return s;
};

describe('quest runtime: resolutions', () => {
  const slayOrPersuade = () =>
    quest({
      resolutions: [
        res('slay', fact('q.slain'), { effects: [{ kind: 'giveItem', item: 'trophy', count: 1 }] }),
        res('persuade', fact('q.persuaded'), {
          effects: [
            { kind: 'giveItem', item: 'favour', count: 1 },
            { kind: 'setFact', fact: 'q.thanked', value: true },
          ],
        }),
      ],
    });

  it('AC-1: the resolution whose conditions become true first resolves the quest and applies its effects', () => {
    const s = started([slayOrPersuade()]);
    step(s, { 'q.persuaded': true });
    expect(s.runtime.questState('q')).toBe('resolved');
    expect(s.runtime.resolution('q')).toBe('persuade');
    expect(s.host.items.get('favour')).toBe(1);
    expect(s.world.facts.get('q.thanked')).toBe(true);
    expect(s.world.facts.get('quest.q.state')).toBe('resolved');
    expect(s.world.facts.get('quest.q.resolution')).toBe('persuade');
    expect(s.events).toEqual(['quest.resolved {"quest":"q","resolution":"persuade"}']);
  });

  it('AC-1: the other resolution can no longer resolve the quest', () => {
    const s = started([slayOrPersuade()]);
    step(s, { 'q.persuaded': true });
    step(s, { 'q.slain': true });
    expect(s.runtime.resolution('q')).toBe('persuade');
    expect(s.host.items.has('trophy')).toBe(false);
    expect(s.runtime.resolveQuest('q', 'slay')).toBe('quest-not-active:q');
    expect(s.runtime.host.resolveQuest('q', undefined)).toBe('quest-not-active:q');
  });

  it('AC-2: two resolutions satisfied in the same tick: the higher priority wins', () => {
    const q = quest({
      resolutions: [
        res('first', fact('q.a')),
        res('second', fact('q.b'), { priority: 5 }),
        res('third', fact('q.c'), { priority: 5 }),
      ],
    });
    const s = started([q]);
    step(s, { 'q.a': true, 'q.b': true, 'q.c': true });
    expect(s.runtime.resolution('q')).toBe('second');
  });

  it('AC-2: equal priority: the one earlier in the file wins, whatever the order of the changes', () => {
    const q = quest({ resolutions: [res('one', fact('q.a')), res('two', fact('q.b'))] });
    const s = started([q]);
    step(s, { 'q.b': true, 'q.a': true });
    expect(s.runtime.resolution('q')).toBe('one');
  });

  it('AC-3: an incomplete optional objective is skipped when the quest resolves', () => {
    const q = quest({
      objectives: [
        objective('main', { params: { event: 'm' } }),
        objective('bonus', { optional: true }),
      ],
    });
    const s = started([q]);
    expect(s.runtime.completeObjective('q', 'main')).toBeUndefined();
    step(s, { 'q.won': true });
    expect(s.runtime.questState('q')).toBe('resolved');
    expect(s.runtime.objectiveState('q', 'bonus')).toBe('skipped');
    expect(s.runtime.objectiveState('q', 'main')).toBe('complete');
    expect(s.world.facts.get('quest.q.objective.bonus')).toBe('skipped');
  });

  it('AC-3: a required objective left undone is skipped as well', () => {
    const q = quest({ objectives: [objective('main')] });
    const s = started([q]);
    step(s, { 'q.won': true });
    expect(s.runtime.objectiveState('q', 'main')).toBe('skipped');
  });

  it('a resolution may wait for an objective by naming it', () => {
    const q = quest({
      objectives: [objective('main')],
      resolutions: [
        res('win', { kind: 'objectiveState', quest: 'q', objective: 'main', state: 'complete' }),
      ],
    });
    const s = started([q]);
    step(s);
    expect(s.runtime.questState('q')).toBe('active');
    expect(s.runtime.completeObjective('q', 'main')).toBeUndefined();
    s.runtime.settle();
    expect(s.runtime.resolution('q')).toBe('win');
  });

  it('resolveQuest without an id ends the quest without a resolution, and rejects unknown ids', () => {
    const s = started([quest()]);
    expect(s.runtime.resolveQuest('q', 'nope')).toBe('unknown-resolution:q/nope');
    expect(s.runtime.resolveQuest('missing', undefined)).toBe('unknown-quest:missing');
    expect(s.runtime.resolveQuest('q', undefined)).toBeUndefined();
    expect(s.runtime.questState('q')).toBe('resolved');
    expect(s.runtime.resolution('q')).toBeUndefined();
  });

  it('an effect can resolve a quest with a named resolution, applying that resolution’s effects', () => {
    const q = quest({
      resolutions: [res('win', fact('q.won'), { effects: [{ kind: 'gold', delta: 5 }] })],
    });
    const s = started([q]);
    const done = s.runtime.host.checkpoint();
    expect(s.runtime.resolveQuest('q', 'win')).toBeUndefined();
    done.commit();
    expect(s.host.goldAmount).toBe(5);
    expect(s.runtime.resolution('q')).toBe('win');
  });
});

describe('quest runtime: failure and terminal states', () => {
  const failing = () =>
    quest({
      objectives: [objective('main')],
      failures: [
        failure('lost', fact('q.lost'), {
          effects: [{ kind: 'setFact', fact: 'q.sad', value: true }],
        }),
      ],
    });

  it('AC-4: a failure condition after resolution changes nothing', () => {
    const s = started([failing()]);
    step(s, { 'q.won': true });
    s.events.length = 0;
    const before = s.world.facts.snapshot();
    step(s, { 'q.lost': true });
    expect(s.runtime.questState('q')).toBe('resolved');
    expect(s.events).toEqual([]);
    expect(s.world.facts.snapshot()).toEqual({ ...before, 'q.lost': true });
    expect(s.world.facts.get('q.sad')).toBeUndefined();
    expect(s.runtime.failQuest('q')).toBe('quest-not-active:q');
  });

  it('a failure fails an active quest: effects, failure id, objectives failed, terminal', () => {
    const s = started([failing()]);
    step(s, { 'q.lost': true });
    expect(s.runtime.questState('q')).toBe('failed');
    expect(s.runtime.failure('q')).toBe('lost');
    expect(s.runtime.objectiveState('q', 'main')).toBe('failed');
    expect(s.world.facts.get('q.sad')).toBe(true);
    expect(s.events).toContain('quest.failed {"quest":"q","failure":"lost"}');
    step(s, { 'q.won': true });
    expect(s.runtime.questState('q')).toBe('failed');
    expect(s.runtime.resolveQuest('q', 'win')).toBe('quest-not-active:q');
  });

  it('when a resolution and a failure hold together, the resolution wins', () => {
    const s = started([failing()]);
    step(s, { 'q.lost': true, 'q.won': true });
    expect(s.runtime.questState('q')).toBe('resolved');
  });

  it('a failQuest effect fails the quest without a failure id', () => {
    const s = started([failing()]);
    expect(s.runtime.host.failQuest('q')).toBeUndefined();
    expect(s.runtime.questState('q')).toBe('failed');
    expect(s.runtime.failure('q')).toBeUndefined();
    expect(s.runtime.failQuest('nope')).toBe('unknown-quest:nope');
  });

  it('a failure without a condition (a trigger for mw-e23.4) never fails by evaluation', () => {
    const q = quest({
      failures: [
        {
          id: 'gone',
          npcRemoved: [],
          journal: 'x',
          continuation: { kind: 'setStage', stage: 'one' },
        },
      ],
    });
    const s = started([q]);
    step(s);
    expect(s.runtime.questState('q')).toBe('active');
  });

  it('the failure hook runs inside the failure’s batch: a refusal undoes the failure', () => {
    const seen: string[] = [];
    const onFail = (f: QuestFailure, def: QuestDef): LogicFailure | undefined => {
      seen.push(`${def.id}/${f.id}`);
      return 'continuation-refused';
    };
    const q = quest({ failures: [failure('lost', fact('q.lost'))] });
    const s = started([q], { onFail });
    step(s, { 'q.lost': true });
    expect(seen).toEqual(['q/lost']);
    expect(s.runtime.questState('q')).toBe('active');
    expect(s.events).toEqual([
      'quest.refused {"quest":"q","outcome":"failure:lost","reason":"continuation-refused"}',
    ]);
  });

  it('the failure hook may continue the story, and its success keeps the failure', () => {
    const q = quest({ failures: [failure('lost', fact('q.lost'))] });
    const onFail = (): LogicFailure | undefined => s.runtime.host.startQuest('next');
    const s = started([q, quest({ id: 'next' })], { onFail });
    step(s, { 'q.lost': true });
    expect(s.runtime.questState('q')).toBe('failed');
    expect(s.runtime.questState('next')).toBe('active');
  });

  it('a refused failure leaves everything as it was (effects undone)', () => {
    const q = quest({
      objectives: [objective('main')],
      failures: [
        failure('lost', fact('q.lost'), {
          effects: [{ kind: 'takeItem', item: 'coin', count: 1 }],
        }),
      ],
    });
    const s = started([q]);
    step(s, { 'q.lost': true });
    expect(s.runtime.questState('q')).toBe('active');
    expect(s.runtime.objectiveState('q', 'main')).toBe('active');
    expect(s.world.facts.get('quest.q.failure')).toBeUndefined();
    expect(s.events).toEqual([
      'quest.refused {"quest":"q","outcome":"failure:lost","reason":"effect-refused:takeItem:missing-item:coin"}',
    ]);
  });
});

describe('quest runtime: atomic effects', () => {
  it('a resolution whose effect refuses is undone entirely, and the next satisfied one resolves', () => {
    const q = quest({
      objectives: [objective('main')],
      resolutions: [
        res('rich', fact('q.a'), {
          priority: 1,
          effects: [
            { kind: 'giveItem', item: 'gem', count: 1 },
            { kind: 'takeItem', item: 'key', count: 1 },
          ],
        }),
        res('plain', fact('q.a')),
      ],
    });
    const s = started([q]);
    step(s, { 'q.a': true });
    expect(s.host.items.has('gem')).toBe(false);
    expect(s.runtime.resolution('q')).toBe('plain');
    expect(s.events).toEqual([
      'quest.refused {"quest":"q","outcome":"resolution:rich","reason":"effect-refused:takeItem:missing-item:key"}',
      'quest.objective {"quest":"q","objective":"main","state":"skipped"}',
      'quest.resolved {"quest":"q","resolution":"plain"}',
    ]);
  });

  it('a throwing effect rolls the quest back and rethrows', () => {
    const registry = new LogicRegistry();
    registerLogicBuiltins(registry);
    registry.registerEffect({
      kind: 'boom',
      schema: { parse: (x: unknown) => x } as never,
      apply: () => {
        throw new Error('boom');
      },
    });
    const q = quest({ resolutions: [res('win', fact('q.won'), { effects: [{ kind: 'boom' }] })] });
    const s = started([q], { registry });
    expect(() => s.runtime.resolveQuest('q', 'win')).toThrow('boom');
    expect(s.runtime.questState('q')).toBe('active');
  });

  it('a throw inside a quest-only change rolls it back and rethrows', () => {
    let blow = false;
    const registry = new LogicRegistry();
    registerLogicBuiltins(registry);
    registry.registerCondition({
      kind: 'flaky',
      schema: { parse: (x: unknown) => x } as never,
      evaluate: () => {
        if (blow) throw new Error('flaky');
        return false;
      },
    });
    const q = quest({
      stages: [{ id: 'one' }, { id: 'two' }],
      objectives: [objective('main', { activeWhen: { kind: 'flaky' } })],
    });
    const s = started([q], { registry });
    blow = true;
    expect(() => s.runtime.setStage('q', 'two')).toThrow('flaky');
    expect(s.runtime.stage('q')).toBe('one');
    expect(s.world.facts.get('quest.q.stage')).toBe('one');
    blow = false;
    expect(s.runtime.setStage('q', 'two')).toBeUndefined();
  });

  it('a batch of effects that starts a quest and then rolls back starts nothing', () => {
    const s = setup([quest()]);
    const batch = s.runtime.host.checkpoint();
    expect(s.runtime.host.startQuest('q')).toBeUndefined();
    expect(s.runtime.host.questState('q')).toBe('active');
    expect(s.world.facts.get('quest.q.state')).toBe('unstarted');
    batch.rollback();
    expect(s.runtime.questState('q')).toBe('unstarted');
    expect(s.world.facts.has('quest.q.state')).toBe(false);
  });

  it('a change made inside a batch is written at the last commit', () => {
    const s = setup([quest()]);
    const outer = s.runtime.host.checkpoint();
    const inner = s.runtime.host.checkpoint();
    s.runtime.host.startQuest('q');
    inner.commit();
    expect(s.world.facts.has('quest.q.state')).toBe(false);
    outer.commit();
    expect(s.world.facts.get('quest.q.state')).toBe('active');
  });

  it('an inner rollback keeps what the outer batch did before it', () => {
    const s = setup([quest({ id: 'a' }), quest({ id: 'b' })]);
    const outer = s.runtime.host.checkpoint();
    s.runtime.host.startQuest('a');
    const inner = s.runtime.host.checkpoint();
    s.runtime.host.startQuest('b');
    inner.rollback();
    outer.commit();
    expect(s.runtime.questState('a')).toBe('active');
    expect(s.runtime.questState('b')).toBe('unstarted');
  });
});

describe('quest runtime: starting, stages and objectives', () => {
  it('a quest with startWhen starts when it holds, and not before', () => {
    const q = quest({ startWhen: fact('q.go'), objectives: [objective('main')] });
    const s = setup([q]);
    step(s);
    expect(s.runtime.questState('q')).toBe('unstarted');
    step(s, { 'q.go': true });
    expect(s.runtime.questState('q')).toBe('active');
    expect(s.runtime.objectiveState('q', 'main')).toBe('active');
    expect(s.events).toEqual([
      'quest.started {"quest":"q"}',
      'quest.objective {"quest":"q","objective":"main","state":"active"}',
    ]);
  });

  it('a quest without startWhen starts by effect, once', () => {
    const s = setup([quest()]);
    step(s);
    expect(s.runtime.questState('q')).toBe('unstarted');
    expect(s.runtime.host.startQuest('q')).toBeUndefined();
    expect(s.runtime.host.startQuest('q')).toBe('quest-already-started:q');
    expect(s.runtime.startQuest('nope')).toBe('unknown-quest:nope');
  });

  it('starting puts the quest in its first stage, or the initial one', () => {
    const first = started([quest({ stages: [{ id: 'one' }, { id: 'two' }] })]);
    expect(first.runtime.stage('q')).toBe('one');
    const initial = started([
      quest({ stages: [{ id: 'one' }, { id: 'two' }], initialStage: 'two' }),
    ]);
    expect(initial.runtime.stage('q')).toBe('two');
    expect(started([quest()]).runtime.stage('q')).toBeUndefined();
    expect(started([quest()]).runtime.stage('missing')).toBeUndefined();
  });

  it('stage events are published on start and on a stage change', () => {
    const s = setup([quest({ stages: [{ id: 'one' }, { id: 'two' }] })]);
    s.runtime.startQuest('q');
    s.runtime.setStage('q', 'two');
    s.runtime.setStage('q', 'two');
    s.world.events.flush();
    expect(s.events).toEqual([
      'quest.started {"quest":"q"}',
      'quest.stage {"quest":"q","stage":"one"}',
      'quest.stage {"quest":"q","stage":"two"}',
    ]);
  });

  it('objectives follow their stage and activeWhen', () => {
    const q = quest({
      stages: [{ id: 'one' }, { id: 'two' }],
      objectives: [
        objective('early', { stage: 'one' }),
        objective('late', { stage: 'two' }),
        objective('gated', { activeWhen: fact('q.open') }),
      ],
    });
    const s = started([q]);
    const state = () => ['early', 'late', 'gated'].map((o) => s.runtime.objectiveState('q', o));
    expect(state()).toEqual(['active', 'inactive', 'inactive']);
    step(s, { 'q.open': true });
    expect(state()).toEqual(['active', 'inactive', 'active']);
    expect(s.runtime.setStage('q', 'two')).toBeUndefined();
    expect(state()).toEqual(['inactive', 'active', 'active']);
    expect(s.runtime.setStage('q', 'nope')).toBe('unknown-stage:q/nope');
    expect(s.runtime.setStage('missing', 'two')).toBe('unknown-quest:missing');
    expect(s.runtime.activeObjectives().map((a) => a.objective.id)).toEqual(['late', 'gated']);
  });

  it('setStage refuses a quest that is not active', () => {
    const s = setup([quest({ stages: [{ id: 'one' }] })]);
    expect(s.runtime.setStage('q', 'one')).toBe('quest-not-active:q');
    expect(s.runtime.activeObjectives()).toEqual([]);
  });

  it('a completed objective stays complete when its stage moves on', () => {
    const q = quest({
      stages: [{ id: 'one' }, { id: 'two' }],
      objectives: [objective('early', { stage: 'one' })],
    });
    const s = started([q]);
    s.runtime.completeObjective('q', 'early');
    s.runtime.setStage('q', 'two');
    expect(s.runtime.objectiveState('q', 'early')).toBe('complete');
  });

  it('a fact objective completes when its fact has the value, and not for another value', () => {
    const q = quest({
      objectives: [
        objective('flag', { kind: 'fact', params: { fact: 'q.flag', value: true } }),
        objective('count', { kind: 'fact', params: { fact: 'q.count', value: 3 } }),
      ],
    });
    const s = started([q]);
    step(s, { 'q.count': 2 });
    expect(s.runtime.objectiveState('q', 'count')).toBe('active');
    step(s, { 'q.flag': true, 'q.count': 3 });
    expect(s.runtime.objectiveState('q', 'flag')).toBe('complete');
    expect(s.runtime.objectiveState('q', 'count')).toBe('complete');
  });

  it('a fact objective whose fact already holds completes as the quest starts', () => {
    const q = quest({
      objectives: [objective('flag', { kind: 'fact', params: { fact: 'q.flag', value: true } })],
    });
    const s = setup([q]);
    s.world.facts.set('q.flag', true);
    s.runtime.startQuest('q');
    expect(s.runtime.objectiveState('q', 'flag')).toBe('complete');
  });

  it('completeObjective: the hook for event-bound objectives and its refusals', () => {
    const q = quest({ objectives: [objective('main'), objective('side')] });
    const s = setup([q]);
    expect(s.runtime.completeObjective('q', 'main')).toBe('quest-not-active:q');
    s.runtime.startQuest('q');
    s.world.events.flush();
    s.events.length = 0;
    expect(s.runtime.host.completeObjective('q', 'main')).toBeUndefined();
    expect(s.runtime.completeObjective('q', 'main')).toBeUndefined();
    s.world.events.flush();
    expect(s.events).toEqual([
      'quest.objective {"quest":"q","objective":"main","state":"complete"}',
    ]);
    expect(s.runtime.completeObjective('q', 'nope')).toBe('unknown-objective:q/nope');
    expect(s.runtime.completeObjective('nope', 'main')).toBe('unknown-quest:nope');
    s.runtime.resolveQuest('q', 'win');
    expect(s.runtime.completeObjective('q', 'side')).toBe('quest-not-active:q');
  });

  it('failing a quest fails its open objectives', () => {
    const q = quest({ objectives: [objective('side')] });
    const s = started([q]);
    const batch = s.runtime.host.checkpoint();
    s.runtime.host.failQuest('q');
    batch.commit();
    expect(s.runtime.objectiveState('q', 'side')).toBe('failed');
  });

  it('objectiveState and questState of unknown ids read as inactive and unstarted', () => {
    const s = setup([quest({ objectives: [objective('main')] })]);
    expect(s.runtime.objectiveState('q', 'nope')).toBe('inactive');
    expect(s.runtime.objectiveState('nope', 'main')).toBe('inactive');
    expect(s.runtime.questState('nope')).toBe('unstarted');
    expect(s.runtime.has('q')).toBe(true);
    expect(s.runtime.has('nope')).toBe(false);
    expect(s.runtime.ids()).toEqual(['q']);
    expect(s.runtime.resolution('nope')).toBeUndefined();
    expect(s.runtime.failure('nope')).toBeUndefined();
  });
});

describe('quest runtime: incremental evaluation', () => {
  it('re-evaluates only the quests a changed fact can affect', () => {
    const quests = Array.from({ length: 20 }, (_, i) =>
      quest({ id: `q${String(i)}`, resolutions: [res('win', fact(`q${String(i)}.won`))] }),
    );
    const s = setup(quests);
    for (const q of quests) s.runtime.startQuest(q.id);
    step(s);
    s.host.readsOfFacts = 0;
    step(s, { 'unrelated.fact': true });
    expect(s.host.readsOfFacts).toBe(0);
    step(s, { 'q7.won': true });
    expect(s.host.readsOfFacts).toBeLessThanOrEqual(4);
    expect(s.runtime.questState('q7')).toBe('resolved');
    expect(s.runtime.questState('q8')).toBe('active');
  });

  it('cascades: a quest resolving can start and resolve quests that read it', () => {
    const quests = [
      quest({ id: 'a', resolutions: [res('win', fact('a.won'))] }),
      quest({
        id: 'b',
        startWhen: questIs('a', 'resolved'),
        resolutions: [res('win', questIs('a', 'resolved'))],
      }),
    ];
    const s = setup(quests);
    s.runtime.startQuest('a');
    step(s, { 'a.won': true });
    expect(s.runtime.questState('b')).toBe('resolved');
  });

  it('a long chain finishes over several ticks instead of looping forever', () => {
    const n = QUEST_MAX_PASSES * 2;
    const id = (i: number) => `c${String(i)}`;
    const quests = Array.from({ length: n }, (_, i) =>
      quest({
        id: id(i),
        resolutions: [res('win', i === 0 ? fact('go') : questIs(id(i - 1), 'resolved'))],
      }),
    );
    // Registered backwards, each pass resolves one link, so the pass limit is what stops it.
    const s = setup([...quests].reverse());
    for (const q of quests) s.runtime.startQuest(q.id);
    step(s, { go: true });
    const done = () => quests.filter((q) => s.runtime.questState(q.id) === 'resolved').length;
    expect(done()).toBeGreaterThan(0);
    expect(done()).toBeLessThan(n);
    for (let i = 0; i < n && done() < n; i++) step(s);
    expect(done()).toBe(n);
  });

  it('items, capabilities and other reports re-evaluate the quests that read them', () => {
    const q = quest({
      resolutions: [
        res('trade', { kind: 'hasItem', item: 'rope', count: 1 }),
        res('learn', { kind: 'hasCapability', capability: 'sneak' }),
      ],
    });
    const s = started([q]);
    step(s);
    s.host.items.set('rope', 1);
    step(s);
    expect(s.runtime.questState('q')).toBe('active');
    s.runtime.notifyItem('other');
    s.runtime.notifyItem('rope');
    s.runtime.settle();
    expect(s.runtime.resolution('q')).toBe('trade');

    const t = started([q]);
    t.host.capabilities.add('sneak');
    t.runtime.notifyCapability('other');
    t.runtime.settle();
    expect(t.runtime.questState('q')).toBe('active');
    t.runtime.notifyCapability('sneak');
    t.runtime.settle();
    expect(t.runtime.resolution('q')).toBe('learn');
  });

  it('quests that read unannounced state (gold, time) are polled every few ticks', () => {
    const q = quest({ resolutions: [res('rich', { kind: 'gold', op: 'gte', value: 10 })] });
    const s = started([q], { pollEveryTicks: 5 });
    s.runtime.settle();
    s.host.goldAmount = 50;
    for (let i = 0; i < 4; i++) s.runtime.update();
    expect(s.runtime.questState('q')).toBe('active');
    s.runtime.update();
    expect(s.runtime.resolution('q')).toBe('rich');
    expect(QUEST_POLL_TICKS).toBe(30);
  });

  it('refresh re-evaluates every quest', () => {
    const s = started([quest()]);
    s.world.facts.set('q.won', true);
    s.runtime.settle();
    expect(s.runtime.questState('q')).toBe('active');
    s.runtime.refresh();
    s.runtime.settle();
    expect(s.runtime.questState('q')).toBe('resolved');
  });

  it('works without an event sink: facts are reported by hand and nothing is published', () => {
    const store = new FactStore({ emit: () => undefined, tick: () => 0 });
    const host = new TestHost(store);
    const runtime = new QuestRuntime({ quests: [quest()], facts: store, host });
    runtime.startQuest('q');
    store.set('q.won', true);
    runtime.notifyFact('q.won');
    runtime.settle();
    expect(runtime.questState('q')).toBe('resolved');
    runtime.dispose();
  });

  it('dispose stops listening to fact changes', () => {
    const s = started([quest()]);
    s.runtime.dispose();
    step(s, { 'q.won': true });
    expect(s.runtime.questState('q')).toBe('active');
    s.world.events.emit(factChanged, {
      key: 'q.won',
      old: undefined,
      new: true,
      source: null,
      tick: 0,
    });
  });
});

describe('quest runtime: persistence', () => {
  const longQuest = () =>
    quest({
      stages: [{ id: 'one' }, { id: 'two' }],
      objectives: [
        objective('found', { stage: 'one' }),
        objective('told', { stage: 'two' }),
        objective('bonus', { optional: true, stage: 'two' }),
      ],
      resolutions: [
        res('win', fact('q.won'), {
          effects: [{ kind: 'setFact', fact: 'q.rewarded', value: true }],
        }),
      ],
    });

  it('AC-5: a quest mid-objective saves and loads identically, and evaluation continues', () => {
    const a = started([longQuest()]);
    a.runtime.completeObjective('q', 'found');
    a.runtime.setStage('q', 'two');
    a.world.events.flush();
    const saved = a.world.facts.snapshot();
    const hash = a.world.facts.hash();

    const b = setup([longQuest()]);
    b.world.facts.prepareRestore(saved)();
    b.runtime.refresh();
    b.runtime.settle();
    expect(b.world.facts.hash()).toBe(hash);
    expect(b.runtime.questState('q')).toBe('active');
    expect(b.runtime.stage('q')).toBe('two');
    expect(['found', 'told', 'bonus'].map((o) => b.runtime.objectiveState('q', o))).toEqual([
      'complete',
      'active',
      'active',
    ]);
    step(b, { 'q.won': true });
    expect(b.runtime.resolution('q')).toBe('win');
    expect(b.world.facts.get('q.rewarded')).toBe(true);
    expect(b.runtime.objectiveState('q', 'told')).toBe('skipped');
  });

  it('AC-5: a resolved quest loads resolved and stays terminal', () => {
    const a = started([longQuest()]);
    step(a, { 'q.won': true });
    const b = setup([longQuest()]);
    b.world.facts.prepareRestore(a.world.facts.snapshot())();
    b.runtime.refresh();
    b.runtime.settle();
    expect(b.runtime.resolution('q')).toBe('win');
    expect(b.world.facts.hash()).toBe(a.world.facts.hash());
  });

  it('a world that never starts a quest has no quest facts, so its hash does not move', () => {
    const plain = new World<never>({ seed: 1 });
    const s = setup([longQuest()]);
    step(s);
    expect(s.world.facts.hash()).toBe(plain.facts.hash());
    expect(s.world.facts.size).toBe(0);
  });

  it('declareQuestFacts is idempotent and the runtime uses declared facts', () => {
    const store = new FactStore({ emit: () => undefined, tick: () => 0 });
    declareQuestFacts(store, [longQuest()]);
    const host = new TestHost(store);
    expect(() => new QuestRuntime({ quests: [longQuest()], facts: store, host })).not.toThrow();
    expect(store.get('quest.q.state')).toBe('unstarted');
    expect(store.isDeclared('quest.q.stage')).toBe(true);
    expect(store.isDeclared('quest.q.failure')).toBe(false);
  });
});

describe('quest runtime: installation and host', () => {
  it('installQuests adds the quests system, which updates the runtime every tick', () => {
    const world = new World<never>({ seed: 1 });
    const host = new TestHost(world.facts);
    const runtime = installQuests(world, { quests: [quest({ startWhen: fact('q.go') })], host });
    expect(questRuntimeOf(world)).toBe(runtime);
    expect(() => installQuests(world, { quests: [], host })).toThrow(RangeError);
    world.facts.set('q.go', true);
    world.step([]);
    expect(runtime.questState('q')).toBe('active');
    expect(questRuntimeOf(new World<never>({ seed: 2 }))).toBeUndefined();
  });

  it('the host delegates everything but quests to the game’s host', () => {
    const s = setup([quest()]);
    const h = s.runtime.host;
    s.host.items.set('rope', 2);
    s.host.capabilities.add('sneak');
    s.host.goldAmount = 9;
    s.host.minute = 600;
    expect(h.itemCount('rope')).toBe(2);
    expect(h.hasCapability('sneak')).toBe(true);
    expect(h.playerClass()).toBe('thief');
    expect(h.disposition('x')).toBe(7);
    expect(h.gold()).toBe(9);
    expect(h.minuteOfDay()).toBe(600);
    expect(h.services).toEqual({ tag: 'svc' });
    s.world.facts.set('some.fact', 4);
    expect(h.facts.get('some.fact')).toBe(4);
    expect(h.setFact('other.fact', true)).toBeUndefined();
    expect(h.giveItem('gem', 1)).toBeUndefined();
    expect(h.takeItem('gem', 2)).toBe('missing-item:gem');
    expect(h.adjustGold(1)).toBeUndefined();
    expect(h.adjustDisposition('x', 1)).toBeUndefined();
    expect(h.learnCapability('climb')).toBeUndefined();
    h.emit('ping', { a: 1 });
    h.revealRumor('r');
    expect(s.host.emitted).toEqual(['ping:{"a":1}']);
    expect(s.host.rumors).toEqual(['r']);
    expect(s.host.items.get('gem')).toBe(1);
    expect(s.host.goldAmount).toBe(10);
  });

  it('a batch that rolls back undoes the game’s host as well as the quest', () => {
    const s = setup([quest()]);
    const batch = s.runtime.host.checkpoint();
    s.runtime.host.giveItem('gem', 1);
    s.runtime.host.startQuest('q');
    batch.rollback();
    expect(s.host.items.has('gem')).toBe(false);
    expect(s.runtime.questState('q')).toBe('unstarted');
  });
});

describe('quest dependency index', () => {
  it('collects what every built-in condition kind reads, through combinators', () => {
    const deps = emptyDependencies();
    collectDependencies(
      {
        kind: 'all',
        of: [
          { kind: 'any', of: [fact('a.b'), { kind: 'factCmp', fact: 'c.d', op: 'gt', value: 1 }] },
          { kind: 'not', condition: { kind: 'hasItem', item: 'rope', count: 1 } },
          { kind: 'hasCapability', capability: 'sneak' },
          questIs('other', 'active'),
          { kind: 'objectiveState', quest: 'third', objective: 'o', state: 'complete' },
        ],
      },
      deps,
    );
    expect([...deps.facts]).toEqual(['a.b', 'c.d']);
    expect([...deps.items]).toEqual(['rope']);
    expect([...deps.capabilities]).toEqual(['sneak']);
    expect([...deps.quests]).toEqual(['other', 'third']);
    expect(deps.polled).toBe(false);
    collectDependencies({ kind: 'timeOfDay', from: '01:00', to: '02:00' }, deps);
    expect(deps.polled).toBe(true);
    const unknown = emptyDependencies();
    collectDependencies({ kind: 'shop.stocked' }, unknown);
    expect(unknown.polled).toBe(true);
  });
});
