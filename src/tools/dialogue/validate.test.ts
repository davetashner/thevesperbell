import { describe, expect, it } from 'vitest';
import { gameContentSources, loadGameContent, type ContentSource } from '@content/index';
import {
  dialogueFixtureSources,
  loadDialogueFixtureContent,
  loadQuestFixtureContent,
} from '@content/test-fixtures';
import {
  contentReferences,
  isDialogueSource,
  isPersuasionSource,
  validateDialogues,
} from './validate';

const ENV = { maxTextLength: 240 };
const FILE = 'src/content/data/dialogue/talk.json';

/** A minimal valid dialogue file; tests change one thing about it. */
function file(patch: Record<string, unknown> = {}, nodes?: unknown[]): ContentSource {
  return {
    path: FILE,
    text: JSON.stringify(
      {
        id: 'talk',
        speakers: [{ id: 'host', name: 'The Host' }],
        entries: [{ id: 'main', node: (nodes?.[0] as { id: string } | undefined)?.id ?? 'hello' }],
        nodes: nodes ?? [
          { id: 'hello', kind: 'line', speaker: 'host', text: 'Hello.', next: 'ask' },
          { id: 'ask', kind: 'choice', options: [{ id: 'bye', text: 'Goodbye.', end: true }] },
        ],
        ...patch,
      },
      null,
      2,
    ),
  };
}
const messages = (items: readonly { message: string }[]) => items.map((i) => i.message);

describe('source classification', () => {
  it('recognises dialogue and persuasion files by path', () => {
    expect(isDialogueSource('src/content/data/dialogue/a.json')).toBe(true);
    expect(isDialogueSource('dialogue/a.json')).toBe(true);
    expect(isDialogueSource('src/content/data/fact/dialogue.json')).toBe(false);
    expect(isPersuasionSource('src/content/data/persuasion/persuasion.json')).toBe(true);
    expect(isPersuasionSource('src/content/data/dialogue/persuasion.json')).toBe(false);
  });
});

describe('validateDialogues', () => {
  it('accepts a valid dialogue and ignores other files', () => {
    const report = validateDialogues(
      [file(), { path: 'src/content/data/fact/x.json', text: 'not json' }],
      ENV,
    );
    expect(report).toEqual({ dialogues: 1, errors: [], warnings: [] });
  });

  it('AC-6: all repository dialogue validates with no errors', () => {
    const content = loadGameContent();
    const report = validateDialogues(gameContentSources(), {
      ...ENV,
      references: contentReferences(content),
    });
    expect(report.errors).toEqual([]);
  });

  it('AC-6: the fixture dialogues validate against game content with no errors', () => {
    const content = loadDialogueFixtureContent();
    const report = validateDialogues(dialogueFixtureSources(), {
      ...ENV,
      references: contentReferences(content),
    });
    expect(report.dialogues).toBe(3);
    expect(report.errors).toEqual([]);
  });

  it('reports schema problems with file and line, and skips the other checks', () => {
    const report = validateDialogues([file({ entries: [{ id: 'main', node: 'nowhere' }] })], ENV);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toMatchObject({ file: FILE });
    expect(report.errors[0]?.message).toContain('unknown node "nowhere"');
  });

  it('AC-1: names an unreachable node with its file, node id and line', () => {
    const report = validateDialogues(
      [
        file(undefined, [
          { id: 'hello', kind: 'line', speaker: 'host', text: 'Hello.', end: true },
          { id: 'orphan', kind: 'line', speaker: 'host', text: 'Hmm.', end: true },
        ]),
      ],
      ENV,
    );
    expect(report.errors).toEqual([
      expect.objectContaining({
        file: FILE,
        nodeId: 'orphan',
        message: 'node "orphan" is not reachable from any entry',
      }),
    ]);
    expect(report.errors[0]?.line).toBeGreaterThan(1);
  });

  it('AC-2: a line with neither next nor end fails (the schema and the graph agree)', () => {
    const report = validateDialogues(
      [file(undefined, [{ id: 'hello', kind: 'line', speaker: 'host', text: 'Hello.' }])],
      ENV,
    );
    expect(report.errors.length).toBeGreaterThan(0);
    expect(messages(report.errors).join('\n')).toContain('needs `next` or `end: true`');
  });

  it('AC-3: a choice whose every option needs two classes fails as unsatisfiable', () => {
    const both = {
      kind: 'all',
      of: [
        { kind: 'playerClass', class: 'knight' },
        { kind: 'playerClass', class: 'thief' },
      ],
    };
    const report = validateDialogues(
      [
        file(undefined, [
          { id: 'ask', kind: 'choice', options: [{ id: 'a', text: 'A.', when: both, end: true }] },
        ]),
      ],
      ENV,
    );
    expect(messages(report.errors).join('\n')).toContain('choice "ask" is unsatisfiable');
  });

  it('AC-4: a loop with no exit fails with the path', () => {
    const report = validateDialogues(
      [
        file(undefined, [
          { id: 'hello', kind: 'line', speaker: 'host', text: 'Hello.', next: 'again' },
          { id: 'again', kind: 'line', speaker: 'host', text: 'Hello.', next: 'hello' },
        ]),
      ],
      ENV,
    );
    expect(messages(report.errors)).toEqual(['loop with no way out: hello -> again -> hello']);
  });

  it('AC-5: a long line warns with its node id and length, and exits clean', () => {
    const long = 'x'.repeat(30);
    const report = validateDialogues(
      [file(undefined, [{ id: 'hello', kind: 'line', speaker: 'host', text: long, end: true }])],
      { maxTextLength: 20 },
    );
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([
      expect.objectContaining({
        nodeId: 'hello',
        message: 'line "hello" is 30 characters, over the limit of 20',
      }),
    ]);
  });

  it('reports DSL problems and unknown references through the content checker', () => {
    const bad = {
      kind: 'hasItem',
      item: 'no-such-item',
    };
    const nodes = [
      { id: 'ask', kind: 'choice', options: [{ id: 'a', text: 'A.', when: bad, end: true }] },
    ];
    const content = loadGameContent();
    const withRefs = validateDialogues([file(undefined, nodes)], {
      ...ENV,
      references: contentReferences(content),
    });
    expect(messages(withRefs.errors).join()).toContain('unknown item "no-such-item"');
    expect(validateDialogues([file(undefined, nodes)], ENV).errors).toEqual([]);
  });

  it('warns when class-gated options serve only one class', () => {
    const nodes = [
      {
        id: 'ask',
        kind: 'choice',
        options: [
          { id: 'a', text: 'A.', when: { kind: 'playerClass', class: 'thief' }, end: true },
          { id: 'b', text: 'B.', end: true },
        ],
      },
    ];
    const report = validateDialogues([file(undefined, nodes)], ENV);
    expect(report.errors).toEqual([]);
    expect(messages(report.warnings).join()).toContain('give at least two classes a way in');
  });

  it('checks the persuasion table conditions against content', () => {
    const rules = {
      modifiers: [{ when: { kind: 'hasItem', item: 'no-such-item' } }],
    };
    const source = {
      path: 'src/content/data/persuasion/persuasion.json',
      text: JSON.stringify(rules, null, 2),
    };
    const report = validateDialogues([source], {
      ...ENV,
      references: contentReferences(loadGameContent()),
    });
    expect(report.dialogues).toBe(0);
    expect(messages(report.errors).join()).toContain('unknown item "no-such-item"');
    expect(report.errors[0]?.file).toBe(source.path);
  });
});

describe('contentReferences', () => {
  const content = loadDialogueFixtureContent();
  const check = contentReferences(content);

  it('resolves ids the content declares and rejects the rest', () => {
    expect(check({ type: 'class', id: 'knight' })).toBeUndefined();
    expect(check({ type: 'class', id: 'no-class' })).toContain('no-class');
    expect(check({ type: 'npc', id: 'npc-oswin' })).toBeUndefined();
    expect(check({ type: 'npc', id: 'nobody' })).toContain('nobody');
    expect(check({ type: 'capability', id: 'no-capability' })).toContain('no-capability');
    expect(check({ type: 'quest', id: 'no-quest' })).toContain('no-quest');
    expect(check({ type: 'fact', id: 'no.such.fact' })).toContain('no.such.fact');
    expect(check({ type: 'fact', id: 'entity:x/y.visits' })).toBeUndefined();
    expect(check({ type: 'rumor', id: 'anything' })).toBeUndefined();
  });

  it('resolves objectives of real quests only', () => {
    const questContent = loadQuestFixtureContent();
    const checkQuest = contentReferences(questContent);
    const quest = questContent.all('quest')[0];
    const objective = quest?.objectives[0];
    expect(quest === undefined || objective === undefined).toBe(false);
    if (quest === undefined || objective === undefined) return;
    expect(checkQuest({ type: 'objective', id: `${quest.id}/${objective.id}` })).toBeUndefined();
    expect(checkQuest({ type: 'objective', id: `${quest.id}/no-objective` })).toContain(
      'no-objective',
    );
    expect(checkQuest({ type: 'objective', id: 'no-quest/x' })).toContain('no-quest/x');
    expect(checkQuest({ type: 'objective', id: 'junk' })).toContain('junk');
  });
});
