import { describe, expect, it } from 'vitest';
import { factIndex, FACT_USAGES, lookupFact } from './fact-checks.ts';
import { loadGameContent } from './game-content.ts';
import { ContentLoadError, loadContent, type ContentSource } from './loader.ts';
import { contentChecks, contentTypes } from './registry.ts';

const fact = { description: 'Test fact.', owner: 'signals' } as const;

const source = (path: string, json: unknown): ContentSource => ({
  path,
  text: JSON.stringify(json),
});

const registry = source('data/fact/test.json', {
  id: 'test',
  name: 'Test',
  notes: 'Test.',
  facts: [
    { ...fact, key: 'vault.open', type: 'bool', default: false },
    { ...fact, key: 'entity:*.opened', type: 'bool', default: false },
  ],
});

/** A signal graph whose fact receiver writes `key`. */
const graph = (id: string, key: string): ContentSource =>
  source(`data/signal-graph/${id}.json`, {
    id,
    name: 'Graph',
    notes: 'Test.',
    nodes: [
      { id: 'lever', kind: 'lever' },
      { id: 'cue', kind: 'receiver', receiver: 'audio-cue', key: 'sfx-clunk' },
      { id: 'fact', kind: 'receiver', receiver: 'fact', key },
    ],
    wires: [
      { from: 'lever', to: 'fact' },
      { from: 'lever', to: 'cue' },
    ],
  });

const issuesOf = (sources: readonly ContentSource[]) => {
  try {
    loadContent(contentTypes, sources, contentChecks);
  } catch (error) {
    if (error instanceof ContentLoadError) return error.issues;
    throw error;
  }
  return [];
};

describe('fact checks', () => {
  it('AC-2: a puzzle file naming an undeclared fact fails validation naming the file and fact', () => {
    expect(issuesOf([registry, graph('vault', 'vault.opn')])).toEqual([
      {
        file: 'data/signal-graph/vault.json',
        pointer: '/nodes/2/key',
        message:
          'signal-graph:vault names undeclared fact "vault.opn": declare it in src/content/data/fact/',
      },
    ]);
  });

  it('rejects former keys (renamedFrom) that are still declared or claimed twice (mw-e27.4)', () => {
    const renames = source('data/fact/renames.json', {
      id: 'renames',
      name: 'Renames',
      notes: 'Test.',
      facts: [
        {
          ...fact,
          key: 'vault.unsealed',
          type: 'bool',
          default: false,
          renamedFrom: ['vault.open'],
        },
        {
          ...fact,
          key: 'cellar.open',
          type: 'bool',
          default: false,
          renamedFrom: ['cellar_door_open'],
        },
        {
          ...fact,
          key: 'cellar.ajar',
          type: 'bool',
          default: false,
          renamedFrom: ['cellar_door_open'],
        },
      ],
    });
    expect(issuesOf([registry, renames])).toEqual([
      {
        file: 'data/fact/renames.json',
        pointer: '/facts/0/renamedFrom/0',
        message: 'fact "vault.unsealed" is renamed from "vault.open", which is still declared',
      },
      {
        file: 'data/fact/renames.json',
        pointer: '/facts/2/renamedFrom/0',
        message:
          'fact "cellar.ajar" is renamed from "cellar_door_open", which "cellar.open" already claims',
      },
    ]);
  });

  it('accepts declared facts and entity keys covered by a template', () => {
    expect(
      issuesOf([
        registry,
        graph('vault', 'vault.open'),
        graph('door', 'entity:crypt/door-2.opened'),
      ]),
    ).toEqual([]);
  });

  it('reports a malformed fact key and entity keys with no template', () => {
    expect(
      issuesOf([registry, graph('a', 'Vault Open'), graph('b', 'entity:crypt/door-2.looted')]).map(
        (i) => i.message,
      ),
    ).toEqual([
      'signal-graph:a names "Vault Open", which is not a fact key',
      'signal-graph:b names undeclared fact "entity:crypt/door-2.looted": declare it in src/content/data/fact/',
    ]);
  });

  it('AC-1: a key declared in two registry files fails, naming both files', () => {
    const copy = source('data/fact/copy.json', {
      id: 'copy',
      name: 'Copy',
      notes: 'Test.',
      facts: [{ ...fact, key: 'vault.open', type: 'bool', default: true }],
    });
    expect(issuesOf([registry, copy])).toEqual([
      {
        file: 'data/fact/test.json',
        pointer: '/facts/0/key',
        message: 'fact "vault.open" is already declared in data/fact/copy.json',
      },
    ]);
  });

  it('does not run until every file parsed (a broken registry is not reported as missing facts)', () => {
    const broken = source('data/fact/test.json', { id: 'test' });
    expect(issuesOf([broken, graph('vault', 'vault.open')]).map((i) => i.file)).toEqual([
      'data/fact/test.json',
      'data/fact/test.json',
      'data/fact/test.json',
    ]);
  });

  it('finds fact usages only in fact receivers', () => {
    const content = loadGameContent();
    const usages = content
      .all('signal-graph')
      .flatMap((g) => FACT_USAGES['signal-graph']?.(g as never) ?? []);
    expect(usages.map((u) => u.key).sort()).toEqual([
      'briar-glen.arrived',
      'chapel-of-echoes.portcullis-dropped',
      'kestrel-lock.gate-open',
      'slice.complete',
    ]);
  });

  it('indexes facts by key (first wins) and looks up templates', () => {
    const content = loadGameContent();
    const groups = content.all('fact');
    const index = factIndex([...groups, ...groups]);
    expect(lookupFact(index, 'horn.fate')?.type).toBe('enum');
    expect(lookupFact(index, 'entity:mine/chest-3.looted')?.key).toBe('entity:*.looted');
    expect(lookupFact(index, 'horn.unknown')).toBeUndefined();
  });
});
