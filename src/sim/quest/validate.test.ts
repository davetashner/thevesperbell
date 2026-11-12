import { describe, expect, it } from 'vitest';
import type { QuestDef, QuestObjective } from '../../content/types/quest';
import { objectiveRefs, validateQuestLogic } from './validate';

const fact = (key: string) => ({ kind: 'fact', fact: key });

/** Loaded content refs are `{ type, id }` objects; tests write them directly. */
const ref = (type: string, id: string) => ({ type, id });

function quest(over: Record<string, unknown> = {}): QuestDef {
  return {
    givers: [],
    stages: [],
    failures: [],
    id: 'test-quest',
    title: 'Test quest',
    summary: 'A test.',
    objectives: [{ id: 'go', kind: 'enterArea', text: 'Go.', params: { area: 'a' } }],
    resolutions: [{ id: 'win', approach: 'combat', when: fact('test.won'), journal: 'Won.' }],
    ...over,
  } as unknown as QuestDef;
}

describe('validateQuestLogic', () => {
  it('accepts a quest whose logic is valid', () => {
    expect(validateQuestLogic(quest())).toEqual([]);
    const effects = [{ kind: 'giveItem', item: 'rope', count: 1 }];
    const resolution = { id: 'win', approach: 'combat', when: fact('a.b'), effects, journal: 'W.' };
    expect(validateQuestLogic(quest({ resolutions: [resolution] }))).toEqual([]);
  });

  it('validates the conditions and effects of stage transitions, with pointers', () => {
    const stages = [
      {
        id: 'one',
        transitions: [
          {
            stage: 'two',
            when: { kind: 'moonPhase' },
            effects: [{ kind: 'giveItem', item: 'x', count: 0 }],
          },
        ],
      },
      { id: 'two', transitions: [] },
    ];
    const pointers = validateQuestLogic(quest({ stages })).map((i) => i.pointer);
    expect(pointers).toContain('/stages/0/transitions/0/when');
    expect(pointers.some((p) => p.startsWith('/stages/0/transitions/0/effects'))).toBe(true);
    const fine = [{ id: 'one', transitions: [{ stage: 'one', when: fact('a.b') }] }];
    expect(validateQuestLogic(quest({ stages: fine }))).toEqual([]);
  });

  it('reports unknown kinds and bad fields with pointers into the file', () => {
    const issues = validateQuestLogic(
      quest({
        startWhen: { kind: 'moonPhase' },
        objectives: [
          {
            id: 'go',
            kind: 'enterArea',
            text: 'Go.',
            activeWhen: { kind: 'hasItem', item: 3 },
            params: { area: 'a' },
          },
        ],
        resolutions: [
          {
            id: 'win',
            approach: 'combat',
            when: { kind: 'gold', op: 'gte', value: -1 },
            effects: [{ kind: 'giveItem', item: 'x', count: 0 }],
            journal: 'Won.',
          },
        ],
        failures: [
          {
            id: 'lose',
            when: { kind: 'all', of: [{ kind: 'bogus' }] },
            effects: [{ kind: 'teleport' }],
            journal: 'Lost.',
            continuation: { kind: 'resolve', resolution: 'win' },
          },
        ],
      }),
    );
    const at = issues.map((i) => i.pointer);
    expect(at).toEqual(
      expect.arrayContaining([
        '/startWhen',
        '/objectives/0/activeWhen/item',
        '/resolutions/0/when/value',
        '/resolutions/0/effects/0/count',
        '/failures/0/when/of/0',
        '/failures/0/effects/0',
      ]),
    );
    expect(issues.find((i) => i.pointer === '/startWhen')?.message).toMatch(/moonPhase/);
  });

  it('checks the objectives of the quest itself without a reference checker', () => {
    const own = (objective: string) => ({
      kind: 'objectiveState',
      quest: 'test-quest',
      objective,
      state: 'complete',
    });
    expect(validateQuestLogic(quest({ startWhen: own('go') }))).toEqual([]);
    expect(validateQuestLogic(quest({ startWhen: own('nope') }))).toEqual([
      {
        pointer: '/startWhen',
        message: 'condition "objectiveState": unknown objective "nope" of this quest',
      },
    ]);
  });

  it('leaves the objectives of other quests to the reference checker', () => {
    const other = { kind: 'objectiveState', quest: 'other', objective: 'x', state: 'active' };
    expect(validateQuestLogic(quest({ startWhen: other }))).toEqual([]);
    const refuse = (ref: { type: string }) => (ref.type === 'objective' ? 'nope' : undefined);
    expect(validateQuestLogic(quest({ startWhen: other }), refuse)).toEqual([
      { pointer: '/startWhen', message: 'condition "objectiveState": nope' },
    ]);
  });

  it('passes other references to the checker, including those objectives name', () => {
    const seen: string[] = [];
    const references = (ref: { type: string; id: string }) => {
      seen.push(`${ref.type}:${ref.id}`);
      return ref.id === 'missing' ? `unknown ${ref.type} "missing"` : undefined;
    };
    const issues = validateQuestLogic(
      quest({
        startWhen: { kind: 'hasItem', item: 'missing', count: 1 },
        objectives: [
          {
            id: 'bring',
            kind: 'deliverItem',
            text: 'Bring it.',
            params: { item: ref('item', 'missing'), npc: ref('creature', 'npc-oswin') },
          },
        ],
      }),
      references,
    );
    expect(issues.map((i) => i.pointer)).toEqual(['/startWhen', '/objectives/0/params']);
    expect(seen).toEqual(
      expect.arrayContaining(['item:missing', 'npc:npc-oswin', 'fact:test.won']),
    );
  });
});

describe('objectiveRefs', () => {
  const make = (kind: string, params: Record<string, unknown>) =>
    ({ id: 'o', kind, text: 'Do.', params }) as unknown as QuestObjective;
  const item = ref('item', 'rope');
  const bob = ref('creature', 'bob');

  it('lists what every objective kind names', () => {
    expect(objectiveRefs(make('haveItem', { item }))).toEqual([{ type: 'item', id: 'rope' }]);
    expect(objectiveRefs(make('deliverItem', { item, npc: bob }))).toEqual([
      { type: 'item', id: 'rope' },
      { type: 'npc', id: 'bob' },
    ]);
    expect(objectiveRefs(make('fact', { fact: 'a.b' }))).toEqual([{ type: 'fact', id: 'a.b' }]);
    expect(objectiveRefs(make('entityState', { creature: bob, state: 'dead' }))).toEqual([
      { type: 'npc', id: 'bob' },
    ]);
    expect(objectiveRefs(make('talkTo', { npc: bob }))).toEqual([{ type: 'npc', id: 'bob' }]);
    expect(objectiveRefs(make('dialogueNode', { dialogue: 'd', node: 'n' }))).toEqual([
      { type: 'dialogue', id: 'd' },
    ]);
    expect(objectiveRefs(make('learnCapability', { capability: 'c' }))).toEqual([
      { type: 'capability', id: 'c' },
    ]);
    expect(objectiveRefs(make('enterArea', { area: 'a' }))).toEqual([]);
    expect(objectiveRefs(make('event', { event: 'e' }))).toEqual([]);
  });
});
