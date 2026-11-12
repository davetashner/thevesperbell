import { describe, expect, it } from 'vitest';
import {
  describeDialogueIssue,
  formatDialogueIssue,
  validateDialogueText,
} from '../dialogue-source.ts';
import { ContentLoadError, loadContent, type ContentSource } from '../loader.ts';
import { gameContentSources } from '../game-content.ts';
import { contentChecks, contentTypes } from '../registry.ts';
import { dialogueFixtureSources, loadDialogueFixtureContent } from '../test-fixtures.ts';
import {
  dialogueTextKey,
  nodeTargets,
  type DialogueDefInput,
  type DialogueNode,
} from './dialogue.ts';

/** A minimal valid dialogue; tests change one thing about it. */
const base = (): DialogueDefInput => ({
  id: 'test-talk',
  speakers: [{ id: 'host', name: 'The Host' }],
  entries: [{ id: 'default', node: 'hello' }],
  nodes: [
    { id: 'hello', kind: 'line', speaker: 'host', text: 'Hello.', next: 'ask' },
    {
      id: 'ask',
      kind: 'choice',
      options: [{ id: 'bye', text: 'Goodbye.', end: true }],
    },
  ],
});

const run = (json: unknown) => validateDialogueText('talk.json', JSON.stringify(json, null, 2));
const messages = (json: unknown): string[] => {
  const result = run(json);
  return result.ok ? [] : result.issues.map((i) => i.message);
};

describe('dialogue schema', () => {
  it('accepts the minimal dialogue and fills defaults', () => {
    const result = run(base());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const choice = result.dialogue.nodes[1];
    expect(choice?.kind === 'choice' && choice.options[0]).toMatchObject({
      showWhenLocked: false,
      once: false,
    });
  });

  it('AC-1: the fixture dialogues compile and validate', () => {
    const sources = dialogueFixtureSources();
    expect(sources.map((s) => s.path.split('/').at(-1))).toEqual([
      'brand-commission.json',
      'marsh-greeting.json',
    ]);
    for (const source of sources) {
      const result = validateDialogueText(source.path, source.text);
      expect(result.ok, source.path).toBe(true);
    }
    expect(
      loadDialogueFixtureContent()
        .all('dialogue')
        .map((d) => d.id),
    ).toEqual(['brand-commission', 'marsh-greeting']);
  });

  it('AC-2: a node with an unknown kind fails with file, node id and line', () => {
    const json = base();
    (json.nodes[0] as { kind: string }).kind = 'shout';
    const result = validateDialogueText('talk.json', JSON.stringify(json, null, 2));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const [issue, ...rest] = result.issues;
    expect(rest).toEqual([]);
    expect(issue).toMatchObject({ file: 'talk.json', nodeId: 'hello', pointer: '/nodes/0/kind' });
    expect(issue?.message).toMatch(/unknown node kind "shout"; expected one of line, choice/);
    const text = JSON.stringify(json, null, 2).split('\n');
    expect(text[(issue?.line ?? 0) - 1]).toContain('"kind": "shout"');
    expect(formatDialogueIssue(issue as never)).toMatch(
      /^talk\.json:\d+ \(node "hello"\): unknown node kind "shout"/,
    );
  });

  it('AC-3: duplicate node ids fail, listing both', () => {
    const json = base();
    json.nodes.push({ id: 'hello', kind: 'end' });
    expect(messages(json)).toEqual([
      'duplicate node id "hello": at nodes[0].id and nodes[2].id (at nodes[2].id)',
    ]);
  });

  it('AC-4: an option with neither next nor end fails; with both fails too', () => {
    const json = base();
    const choice = json.nodes[1] as { options: Record<string, unknown>[] };
    choice.options = [{ id: 'bye', text: 'Goodbye.' }];
    expect(messages(json)).toEqual([
      'option "bye" needs `next` or `end: true` (at nodes[1].options[0])',
    ]);
    choice.options = [{ id: 'bye', text: 'Goodbye.', next: 'hello', end: true }];
    expect(messages(json)).toEqual([
      'option "bye" has both `next` and `end` (at nodes[1].options[0])',
    ]);
  });

  it('lines and effects must continue or end', () => {
    const json = base();
    json.nodes = [
      { id: 'hello', kind: 'line', speaker: 'host', text: 'Hello.' },
      { id: 'fx', kind: 'effect', effects: [{ kind: 'gold', delta: 1 }], next: 'hello', end: true },
    ];
    expect(messages(json)).toEqual([
      'line "hello" needs `next` or `end: true` (at nodes[0])',
      'effect "fx" has both `next` and `end` (at nodes[1])',
    ]);
  });

  it('reports every dangling reference with its pointer', () => {
    const json = base();
    json.entries = [{ id: 'default', node: 'nowhere' }];
    json.nodes = [
      { id: 'a', kind: 'line', speaker: 'host', text: 'A.', next: 'b1' },
      {
        id: 'c',
        kind: 'choice',
        options: [{ id: 'o', text: 'O.', next: 'b2', onFail: 'b3' }],
      },
      {
        id: 'br',
        kind: 'branch',
        routes: [{ when: { kind: 'gold', op: 'gte', value: 1 }, next: 'b4' }],
        else: 'b5',
      },
      {
        id: 'ck',
        kind: 'check',
        approach: 'persuade',
        difficulty: 5,
        success: 'b6',
        failure: 'b7',
      },
      { id: 'fx', kind: 'effect', effects: [{ kind: 'gold', delta: 1 }], next: 'a', onFail: 'b8' },
    ];
    const result = run(json);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((i) => i.pointer)).toEqual([
      '/entries/0/node',
      '/nodes/0/next',
      '/nodes/1/options/0/next',
      '/nodes/1/options/0/onFail',
      '/nodes/2/routes/0/next',
      '/nodes/2/else',
      '/nodes/3/success',
      '/nodes/3/failure',
      '/nodes/4/onFail',
    ]);
    expect(result.issues[2]?.message).toBe(
      'node "c" continues to unknown node "b2" (at nodes[1].options[0].next)',
    );
  });

  it('checks speakers: declared, not reserved, unique, with a name or npc', () => {
    const json = base();
    json.speakers = [
      { id: 'host', name: 'The Host' },
      { id: 'host', name: 'Again' },
      { id: 'player', name: 'Me' },
      { id: 'ghost' },
    ];
    json.nodes = [
      { id: 'hello', kind: 'line', speaker: 'nobody', text: 'A.', end: true },
      { id: 'b', kind: 'line', speaker: 'narrator', text: 'B.', end: true },
      {
        id: 'c',
        kind: 'check',
        approach: 'charm',
        difficulty: 1,
        target: 'stranger',
        success: 'hello',
        failure: 'b',
      },
    ];
    expect(messages(json)).toEqual([
      'give an `npc` or a `name` (at speakers[3])',
      'duplicate speaker id "host": at speakers[0].id and speakers[1].id (at speakers[1].id)',
      '"player" is built in; do not declare it (at speakers[2].id)',
      'node "hello" names undeclared speaker "nobody" (at nodes[0].speaker)',
      'node "c" names undeclared speaker "stranger" (at nodes[2].target)',
    ]);
  });

  it('entries: unique ids, the last unconditional, nodes exist', () => {
    const json = base();
    const when = { kind: 'gold', op: 'gte', value: 5 };
    json.entries = [
      { id: 'one', when, node: 'hello' },
      { id: 'one', when, node: 'hello' },
    ];
    expect(messages(json)).toEqual([
      'duplicate entry id "one": at entries[0].id and entries[1].id (at entries[1].id)',
      'the last entry must have no condition, so a conversation can always start (at entries[1].when)',
    ]);
  });

  it('option ids are unique across the dialogue and distinct from node ids', () => {
    const json = base();
    json.nodes.push({
      id: 'more',
      kind: 'choice',
      options: [
        { id: 'bye', text: 'Again.', end: true },
        { id: 'hello', text: 'Hello.', end: true },
      ],
    });
    expect(messages(json)).toEqual([
      'duplicate option id "bye": at nodes[1].options[0].id and nodes[2].options[0].id (at nodes[2].options[0].id)',
      'option id "hello" is also a node id; ids share one namespace (at nodes[2].options[1].id)',
    ]);
  });

  it('text keys are unique and default from the ids', () => {
    expect(dialogueTextKey('talk', 'hello')).toBe('dialogue.talk.hello');
    expect(dialogueTextKey('talk', 'ask', 'bye')).toBe('dialogue.talk.ask.bye');
    const json = base();
    (json.nodes[0] as { textKey?: string }).textKey = 'shared.key';
    (json.nodes[1] as unknown as { options: [{ textKey?: string }] }).options[0].textKey =
      'shared.key';
    expect(messages(json)).toEqual([
      'duplicate text key id "shared.key": at nodes[0].textKey and nodes[1].options[0].textKey (at nodes[1].options[0].textKey)',
    ]);
  });

  it('rejects malformed fields', () => {
    const json = base();
    (json.nodes[0] as { text: string }).text = ' padded ';
    json.nodes.push({ id: 'Bad_Id', kind: 'end' });
    const found = messages(json);
    expect(found).toContain('must not start or end with whitespace (at nodes[0].text)');
    expect(found.some((m) => m.includes('kebab-case'))).toBe(true);
  });

  it('rejects nodes that are not objects or have no kind', () => {
    const json = base();
    json.nodes = [5 as never, {} as never, { id: 'x', kind: 7 } as never, null as never];
    const found = messages(json);
    expect(found).toHaveLength(4);
    expect(found[0]).toMatch(/unknown node kind undefined/);
    expect(found[3]).toMatch(/unknown node kind undefined/);
    expect(found[1]).toMatch(/unknown node kind undefined/);
    expect(found[2]).toMatch(/unknown node kind 7/);
  });

  it('reports invalid JSON with its line', () => {
    const result = validateDialogueText('talk.json', '{\n  "id": "x",\n  oops\n}');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]).toMatchObject({ file: 'talk.json', pointer: '' });
    expect(result.issues[0]?.message).toMatch(/^invalid JSON/);
    expect(result.issues[0]?.line).toBeGreaterThanOrEqual(1);
    const noLine = validateDialogueText('talk.json', '');
    expect(noLine.ok).toBe(false);
  });

  it('locates an issue from another validator by pointer', () => {
    const text = JSON.stringify(base(), null, 2);
    const issue = describeDialogueIssue('talk.json', text, {
      pointer: '/nodes/1/options/0/when',
      message: 'bad condition',
    });
    expect(issue.nodeId).toBe('ask');
    expect(text.split('\n')[issue.line - 1]).toBe('        {'); // a missing key reports its option
    expect(issue.message).toBe('bad condition');
    expect(
      describeDialogueIssue('talk.json', text, { pointer: '/entries/0/when', message: 'm' }).nodeId,
    ).toBeUndefined();
  });

  it('describes issues for odd documents without a node', () => {
    const where = (text: string, pointer: string) =>
      describeDialogueIssue('f.json', text, { pointer, message: 'm' });
    expect(where('{"nodes": 5}', '/nodes').nodeId).toBeUndefined();
    expect(where('{"nodes": 5}', '/nodes/0/x').nodeId).toBeUndefined();
    expect(where('{"nodes": []}', '/nodes/3/x').nodeId).toBeUndefined();
    expect(where('{"nodes": [{}]}', '/nodes/0/x').nodeId).toBeUndefined();
    expect(where('{"nodes": [{"id": "n"}]}', '/nodes/0/x').nodeId).toBe('n');
    expect(formatDialogueIssue({ file: 'f.json', line: 2, pointer: '', message: 'm' })).toBe(
      'f.json:2: m',
    );
    const root = validateDialogueText('f.json', '[]');
    expect(root.ok).toBe(false);
    if (!root.ok) expect(root.issues[0]).toMatchObject({ pointer: '', line: 1 });
  });

  it('nodeTargets lists every continuation of every kind', () => {
    const node = (data: unknown) => data as DialogueNode;
    expect(nodeTargets(node({ kind: 'jump', id: 'j' }))).toEqual([]);
    expect(nodeTargets(node({ kind: 'end', id: 'e' }))).toEqual([]);
    expect(nodeTargets(node({ kind: 'line', id: 'l' }))).toEqual([]);
  });
});

describe('dialogue content checks', () => {
  const file = (json: unknown, id: string): ContentSource => ({
    path: `src/content/data/dialogue/${id}.json`,
    text: JSON.stringify(json),
  });
  const load = (...dialogues: DialogueDefInput[]): string[] => {
    try {
      loadContent(
        contentTypes,
        [...gameContentSources(), ...dialogues.map((d) => file(d, d.id))],
        contentChecks,
      );
    } catch (error) {
      if (!(error instanceof ContentLoadError)) throw error;
      return error.issues.map((i) => `${i.pointer}: ${i.message}`);
    }
    return [];
  };

  it('a jump to a node of another dialogue must name an existing node', () => {
    const target = { ...base(), id: 'target' };
    const jumper = (node?: string): DialogueDefInput => ({
      ...base(),
      id: 'jumper',
      nodes: [
        { id: 'hello', kind: 'jump', dialogue: 'target', ...(node === undefined ? {} : { node }) },
        { id: 'ask', kind: 'end' },
      ],
    });
    expect(load(target, jumper())).toEqual([]);
    expect(load(target, jumper('ask'))).toEqual([]);
    expect(load(target, jumper('nope'))).toEqual([
      '/nodes/0/node: jump "hello" names unknown node "nope" of dialogue dialogue:target',
    ]);
  });

  it('a jump to a missing dialogue is a missing reference', () => {
    const lonely: DialogueDefInput = {
      ...base(),
      id: 'lonely',
      nodes: [
        { id: 'hello', kind: 'jump', dialogue: 'nobody' },
        { id: 'ask', kind: 'end' },
      ],
    };
    expect(load(lonely)[0]).toMatch(/references missing dialogue:nobody/);
  });

  it('a speaker npc must be a creature', () => {
    const json = base();
    json.speakers = [{ id: 'host', npc: 'npc-nobody' }];
    expect(load(json)[0]).toMatch(/references missing creature:npc-nobody/);
  });
});
