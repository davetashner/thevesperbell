import { describe, expect, it } from 'vitest';
import { loadQuestFixtureContent } from '../test-fixtures.ts';
import { QUEST_OBJECTIVE_KINDS, questSchema, questTextKey, type QuestDefInput } from './quest.ts';

const fact = (key: string) => ({ kind: 'fact', fact: key });

/** A small valid quest; tests change one thing at a time. */
function quest(over: Record<string, unknown> = {}): QuestDefInput {
  return {
    id: 'test-quest',
    title: 'Test quest',
    summary: 'A test.',
    stages: [{ id: 'one' }, { id: 'two', text: 'Stage two.' }],
    objectives: [{ id: 'go', kind: 'enterArea', text: 'Go there.', params: { area: 'the-adit' } }],
    resolutions: [{ id: 'win', approach: 'combat', when: fact('test.won'), journal: 'You won.' }],
    failures: [
      {
        id: 'lose',
        when: fact('test.lost'),
        journal: 'You lost.',
        continuation: { kind: 'setStage', stage: 'two' },
      },
    ],
    ...over,
  };
}

/** Every issue `json` produces, as `path: message`. */
function issues(json: unknown): string[] {
  const result = questSchema.safeParse(json);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
}

describe('quest format', () => {
  it('a valid quest parses and fills defaults', () => {
    const parsed = questSchema.parse(quest());
    expect(parsed.givers).toEqual([]);
    expect(parsed.objectives[0]).toMatchObject({ optional: false, hidden: false });
    expect(parsed.resolutions[0]?.priority).toBe(0);
    expect(parsed.failures[0]).toMatchObject({ npcRemoved: [], itemDestroyed: [] });
  });

  it('AC-1: the fixture quests load with the game and validate', () => {
    const content = loadQuestFixtureContent();
    expect(content.all('quest').map((q) => q.id)).toEqual([
      'quest-empty-barge',
      'the-captain-below',
      'the-captains-boots',
      'the-name-on-the-bones',
    ]);
    const boots = content.get('quest', 'the-captains-boots');
    expect(boots.resolutions.map((r) => r.approach)).toEqual([
      'other',
      'diplomacy',
      'trickery',
      'stealth',
    ]);
    expect(boots.failures[0]?.continuation.kind).toBe('startQuest');
  });

  it('AC-2: a quest with zero resolutions is rejected', () => {
    expect(issues(quest({ resolutions: [] }))).toEqual([
      'resolutions: a quest needs at least one resolution, or it can never be finished',
    ]);
  });

  it('AC-3: a failure without a continuation is rejected', () => {
    const [failure] = quest().failures ?? [];
    const bare = { ...failure } as Record<string, unknown>;
    delete bare['continuation'];
    expect(issues(quest({ failures: [bare] }))).toEqual([
      'failures.0.continuation: a failure must continue the story: give a continuation (startQuest, setStage or resolve)',
    ]);
  });

  it('AC-3: a continuation of an unknown kind is rejected, naming it', () => {
    const failure = { ...quest().failures?.[0], continuation: { kind: 'shrug' } };
    expect(issues(quest({ failures: [failure] }))[0]).toMatch(
      /unknown continuation kind "shrug"; expected startQuest, setStage or resolve/,
    );
  });

  it('AC-4: an objective of an unknown kind is rejected, naming it', () => {
    const objective = { id: 'x', kind: 'summonGhost', text: 'Boo.', params: {} };
    const [message] = issues(quest({ objectives: [objective] }));
    expect(message).toContain('unknown objective kind "summonGhost"');
    expect(message).toContain(QUEST_OBJECTIVE_KINDS.join(', '));
  });

  it('every objective kind accepts its params and rejects stray ones', () => {
    const params: Record<string, Record<string, unknown>> = {
      haveItem: { item: 'bellwort-root' },
      deliverItem: { item: 'bellwort-root', npc: 'npc-juniper', count: 2 },
      fact: { fact: 'test.won' },
      entityState: { creature: 'npc-oswin', state: 'removed' },
      enterArea: { area: 'the-adit' },
      talkTo: { npc: 'npc-hollis' },
      dialogueNode: { dialogue: 'greeting', node: 'hello' },
      learnCapability: { capability: 'spell-levitate' },
      event: { event: 'bell-rung' },
    };
    expect(Object.keys(params)).toEqual([...QUEST_OBJECTIVE_KINDS]);
    for (const kind of QUEST_OBJECTIVE_KINDS) {
      const make = (p: unknown) => ({ id: 'o', kind, text: 'Do it.', params: p });
      expect(issues(quest({ objectives: [make(params[kind])] })), kind).toEqual([]);
      expect(
        issues(quest({ objectives: [make({ ...params[kind], stray: 1 })] })),
        kind,
      ).not.toEqual([]);
    }
    const bad = {
      id: 'o',
      kind: 'entityState',
      text: 'Do it.',
      params: { creature: 'npc-oswin', state: 'asleep' },
    };
    expect(issues(quest({ objectives: [bad] }))).not.toEqual([]);
  });

  it('a missing objective kind is reported as unknown', () => {
    expect(issues(quest({ objectives: [{ id: 'x', text: 'Boo.', params: {} }] }))[0]).toMatch(
      /unknown objective kind undefined/,
    );
  });

  it('ids must be unique within their kind', () => {
    const win = quest().resolutions[0];
    const messages = issues(
      quest({
        stages: [{ id: 'one' }, { id: 'one' }],
        objectives: [
          { id: 'go', kind: 'enterArea', text: 'A.', params: { area: 'a' } },
          { id: 'go', kind: 'enterArea', text: 'B.', params: { area: 'b' } },
        ],
        resolutions: [win, win],
        failures: [quest().failures?.[0], quest().failures?.[0]],
      }),
    );
    for (const what of ['stage', 'objective', 'resolution', 'failure']) {
      expect(messages.join('\n')).toContain(`duplicate ${what} id`);
    }
  });

  it('stage references must name stages of the quest', () => {
    expect(issues(quest({ initialStage: 'nowhere' }))).toEqual([
      'initialStage: initialStage names unknown stage "nowhere"',
    ]);
    expect(issues(quest({ stages: [], failures: [], initialStage: 'one' }))).toContain(
      'initialStage: initialStage needs `stages`',
    );
    expect(issues(quest({ initialStage: 'two' }))).toEqual([]);
    const lost = { ...quest().failures?.[0], continuation: { kind: 'setStage', stage: 'nowhere' } };
    expect(issues(quest({ failures: [lost] }))).toEqual([
      'failures.0.continuation.stage: failure "lose" continues in unknown stage "nowhere"',
    ]);
    const go = {
      id: 'go',
      kind: 'enterArea',
      text: 'Go.',
      stage: 'nowhere',
      params: { area: 'a' },
    };
    expect(issues(quest({ objectives: [go] }))).toEqual([
      'objectives.0.stage: objective "go" names unknown stage "nowhere"',
    ]);
  });

  it('a failure may continue with a resolution of the quest, not a missing one', () => {
    const lost = (resolution: string) => ({
      ...quest().failures?.[0],
      continuation: { kind: 'resolve', resolution },
    });
    expect(issues(quest({ failures: [lost('win')] }))).toEqual([]);
    expect(issues(quest({ failures: [lost('nope')] }))).toEqual([
      'failures.0.continuation.resolution: failure "lose" continues with unknown resolution "nope"',
    ]);
  });

  it('a failure may start a successor, but not its own quest', () => {
    const start = (quest_: string) => ({
      ...quest().failures?.[0],
      continuation: { kind: 'startQuest', quest: quest_ },
    });
    expect(issues(quest({ failures: [start('other-quest')] }))).toEqual([]);
    expect(issues(quest({ failures: [start('test-quest')] }))).toEqual([
      'failures.0.continuation.quest: failure "lose" continues with its own quest; give a successor',
    ]);
  });

  it('a failure needs a way to happen', () => {
    const none = { id: 'lose', journal: 'x', continuation: { kind: 'setStage', stage: 'two' } };
    expect(issues(quest({ failures: [none] }))[0]).toContain('a failure needs a way to happen');
    for (const trigger of [
      { npcRemoved: ['npc-oswin'] },
      { itemDestroyed: ['bellwort-root'] },
      { deadlineDays: 3 },
    ]) {
      expect(issues(quest({ failures: [{ ...none, ...trigger }] }))).toEqual([]);
    }
    expect(issues(quest({ failures: [{ ...none, deadlineDays: 0 }] }))).not.toEqual([]);
  });

  it('text keys default from the ids and must not collide', () => {
    expect(questTextKey('q', 'title')).toBe('quest.q.title');
    expect(questTextKey('q', 'objective', 'go')).toBe('quest.q.objective.go');
    expect(issues(quest({ titleKey: 'quest.test-quest.summary' }))[0]).toMatch(
      /duplicate text key id "quest.test-quest.summary"/,
    );
    const go = { id: 'go', kind: 'enterArea', text: 'Go.', textKey: 'x.go', params: { area: 'a' } };
    const win = { ...quest().resolutions[0], journalKey: 'x.go' };
    expect(issues(quest({ objectives: [go], resolutions: [win] }))[0]).toMatch(
      /duplicate text key/,
    );
    expect(issues(quest({ summaryKey: 'x.summary', objectives: [go] }))).toEqual([]);
    // a stage without text has no key to collide with
    expect(issues(quest({ stages: [{ id: 'one' }, { id: 'two' }] }))).toEqual([]);
  });

  it('text must not carry stray whitespace and the file must be strict', () => {
    expect(issues(quest({ title: ' Padded' }))[0]).toMatch(/whitespace/);
    expect(issues(quest({ surprise: true }))[0]).toMatch(/Unrecognized key/);
    expect(issues(quest({ id: 'Not Kebab' }))[0]).toMatch(/kebab-case/);
  });
});
