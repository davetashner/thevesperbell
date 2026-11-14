import { describe, expect, it } from 'vitest';
import type { DialogueDef } from '../../content/types/dialogue';
import type { LogicNode } from '../logic';
import { contradiction, validateDialogueGraph } from './graph';

type Node = Record<string, unknown>;
const OPTIONS = { maxTextLength: 40 };

/** A dialogue from loose node data (the schema's own checks are bypassed on purpose). */
function dialogue(
  nodes: Node[],
  entries: Node[] = [{ id: 'main', node: nodes[0]?.['id'] }],
): DialogueDef {
  return { id: 'test', speakers: [], entries, nodes } as unknown as DialogueDef;
}
const line = (id: string, extra: Node = {}): Node => ({
  id,
  kind: 'line',
  speaker: 'player',
  text: 'Hi.',
  ...extra,
});
const choice = (id: string, options: Node[]): Node => ({ id, kind: 'choice', options });
const option = (id: string, extra: Node = {}): Node => ({
  id,
  text: 'Ok.',
  showWhenLocked: false,
  once: false,
  ...extra,
});
const cls = (name: string): Node => ({ kind: 'playerClass', class: name });
const run = (d: DialogueDef) => validateDialogueGraph(d, OPTIONS);
const codes = (d: DialogueDef) => run(d).errors.map((e) => e.code);

describe('contradiction', () => {
  const c = (data: Node | undefined) => contradiction(data as LogicNode | undefined);
  it('finds nothing in no condition, one class, or undecidable conditions', () => {
    expect(c(undefined)).toBeUndefined();
    expect(c(cls('knight'))).toBeUndefined();
    expect(
      c({ kind: 'all', of: [cls('knight'), cls('knight'), { kind: 'gold', op: 'gte', value: 1 }] }),
    ).toBeUndefined();
    expect(c({ kind: 'not', condition: cls('thief') })).toBeUndefined();
    expect(
      c({ kind: 'any', of: [cls('knight'), { kind: 'all', of: [cls('a'), cls('b')] }] }),
    ).toBeUndefined();
  });
  it('finds two different classes, nested or not', () => {
    expect(c({ kind: 'all', of: [cls('knight'), cls('thief')] })).toMatch(/knight and thief/);
    expect(
      c({ kind: 'all', of: [cls('knight'), { kind: 'all', of: [cls('thief')] }] }),
    ).toBeDefined();
    expect(c({ kind: 'all', of: [{ kind: 'all', of: [cls('a'), cls('b')] }] })).toBeDefined();
  });
  it('finds a fact required to equal two values, but not the same value twice', () => {
    const eq = (value: unknown): Node => ({ kind: 'factCmp', fact: 'door.state', op: 'eq', value });
    expect(c({ kind: 'all', of: [eq('open'), eq('shut')] })).toMatch(/door.state/);
    expect(c({ kind: 'all', of: [eq('open'), eq('open')] })).toBeUndefined();
    expect(
      c({
        kind: 'all',
        of: [
          { kind: 'factCmp', fact: 'a.b', op: 'gt', value: 1 },
          { kind: 'factCmp', fact: 'a.b', op: 'gt', value: 2 },
        ],
      }),
    ).toBeUndefined();
  });
  it('finds a condition together with its negation, whatever the key order', () => {
    const item = { kind: 'hasItem', item: 'key', count: 1 };
    expect(
      c({
        kind: 'all',
        of: [item, { kind: 'not', condition: { count: 1, item: 'key', kind: 'hasItem' } }],
      }),
    ).toMatch(/negation/);
    expect(
      c({
        kind: 'all',
        of: [item, { kind: 'not', condition: { kind: 'hasItem', item: 'other', count: 1 } }],
      }),
    ).toBeUndefined();
    expect(
      c({
        kind: 'all',
        of: [
          { kind: 'x', list: [1, { b: 1, a: 2 }] },
          { kind: 'not', condition: { kind: 'x', list: [1, { a: 2, b: 1 }] } },
        ],
      }),
    ).toBeDefined();
  });
  it('treats an empty any, and any whose alternatives all fail, as unsatisfiable', () => {
    expect(c({ kind: 'any', of: [] })).toMatch(/empty/);
    const bad = { kind: 'all', of: [cls('a'), cls('b')] };
    expect(c({ kind: 'any', of: [bad, bad] })).toMatch(/every alternative/);
    expect(c({ kind: 'all', of: [cls('a'), { kind: 'any', of: [] }] })).toMatch(/empty/);
    expect(c({ kind: 'any', of: [bad, cls('a')] })).toBeUndefined();
  });
  it('treats not of an empty all as unsatisfiable', () => {
    expect(c({ kind: 'not', condition: { kind: 'all', of: [] } })).toMatch(/empty/);
    expect(c({ kind: 'not', condition: { kind: 'all', of: [cls('a')] } })).toBeUndefined();
  });
});

describe('validateDialogueGraph', () => {
  it('accepts a conversation with an exit and a loop that can leave', () => {
    const d = dialogue([
      line('a', { next: 'menu' }),
      choice('menu', [option('more', { next: 'again' }), option('bye', { end: true })]),
      line('again', { next: 'menu' }),
    ]);
    expect(run(d)).toEqual({ errors: [], warnings: [] });
  });

  it('AC-1: an unreachable node fails, naming it', () => {
    const d = dialogue([line('a', { end: true }), line('orphan', { end: true })]);
    const { errors } = run(d);
    expect(errors).toEqual([
      {
        pointer: '/nodes/1',
        code: 'unreachable-node',
        message: 'node "orphan" is not reachable from any entry',
      },
    ]);
  });

  it('AC-1: nodes reached from a later entry, or only through branches and checks, are reachable', () => {
    const d = dialogue(
      [
        line('a', { end: true }),
        {
          id: 'br',
          kind: 'branch',
          routes: [{ when: { kind: 'gold', op: 'gte', value: 1 }, next: 'ok' }],
          else: 'chk',
        },
        { id: 'chk', kind: 'check', success: 'ok', failure: 'fail' },
        line('ok', { next: 'fx' }),
        { id: 'fx', kind: 'effect', next: 'fx2', onFail: 'fail' },
        { id: 'fx2', kind: 'effect', end: true },
        line('fail', { end: true }),
        { id: 'j', kind: 'jump', dialogue: 'other' },
        { id: 'e', kind: 'end' },
      ],
      [
        { id: 'one', when: { kind: 'gold', op: 'gte', value: 1 }, node: 'br' },
        { id: 'two', node: 'a' },
        { id: 'three', node: 'j' },
        { id: 'four', node: 'e' },
      ],
    );
    expect(run(d).errors).toEqual([]);
  });

  it('AC-1: an entry that can never be chosen starts nothing, and an unknown start is ignored', () => {
    const never = { kind: 'all', of: [cls('a'), cls('b')] };
    const d = dialogue(
      [line('a', { end: true }), line('only-never', { end: true })],
      [
        { id: 'x', when: never, node: 'only-never' },
        { id: 'y', node: 'a' },
        { id: 'z', node: 'missing' },
      ],
    );
    expect(run(d).errors.map((e) => e.message)).toEqual([
      'node "only-never" is not reachable from any entry',
    ]);
  });

  it('AC-1: a node reachable only through an option that can never be offered is unreachable', () => {
    const d = dialogue([
      choice('menu', [
        option('bye', { end: true }),
        option('never', { next: 'secret', when: { kind: 'all', of: [cls('a'), cls('b')] } }),
      ]),
      line('secret', { end: true }),
    ]);
    expect(codes(d)).toEqual(['unreachable-node']);
  });

  it('AC-2: a line or effect with no next and not marked end fails', () => {
    const d = dialogue(
      [line('a', { next: 'b' }), { id: 'b', kind: 'effect' }, line('c')],
      [
        { id: 'main', node: 'a' },
        { id: 'other', node: 'c' },
      ],
    );
    const { errors } = run(d);
    expect(errors.map((e) => [e.code, e.pointer])).toEqual([
      ['missing-exit', '/nodes/1'],
      ['missing-exit', '/nodes/2'],
    ]);
    expect(errors[1]?.message).toBe('line "c" has no `next` and is not marked `end: true`');
  });

  it('AC-2: an option that neither continues nor ends fails', () => {
    const d = dialogue([choice('menu', [option('bye', { end: true }), option('dead')])]);
    const { errors } = run(d);
    expect(errors).toEqual([
      {
        pointer: '/nodes/0/options/1',
        code: 'missing-exit',
        message: 'option "dead" of "menu" has no `next` and is not marked `end: true`',
      },
    ]);
  });

  it('AC-3: a choice whose every option needs two different classes is unsatisfiable', () => {
    const both = { kind: 'all', of: [cls('knight'), cls('thief')] };
    const d = dialogue([
      choice('menu', [
        option('a', { end: true, when: both }),
        option('b', { end: true, when: both }),
      ]),
    ]);
    const { errors, warnings } = run(d);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ pointer: '/nodes/0', code: 'unsatisfiable-choice' });
    expect(errors[0]?.message).toContain('knight and thief');
    expect(warnings.map((w) => w.code)).toEqual(['unsatisfiable-option', 'unsatisfiable-option']);
  });

  it('AC-3: one dead option among live ones is a warning, not an error', () => {
    const d = dialogue([
      choice('menu', [
        option('a', { end: true }),
        option('b', { end: true, when: { kind: 'all', of: [cls('knight'), cls('thief')] } }),
      ]),
    ]);
    const { errors, warnings } = run(d);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([
      expect.objectContaining({ pointer: '/nodes/0/options/1/when', code: 'unsatisfiable-option' }),
    ]);
  });

  it('AC-4: a cycle A to B to A with no way out fails with the path', () => {
    const d = dialogue([line('a', { next: 'b' }), line('b', { next: 'a' })]);
    const { errors } = run(d);
    expect(errors).toEqual([
      {
        pointer: '/nodes/0',
        code: 'inescapable-cycle',
        message: 'loop with no way out: a -> b -> a',
      },
    ]);
  });

  it('AC-4: a self-loop and a cycle through a choice whose exits are all dead are inescapable', () => {
    const never = { kind: 'all', of: [cls('a'), cls('b')] };
    const d = dialogue([line('a', { next: 'a' })]);
    expect(run(d).errors.map((e) => e.message)).toEqual(['loop with no way out: a -> a']);
    const e = dialogue([
      choice('menu', [
        option('again', { next: 'back' }),
        option('bye', { end: true, when: never }),
      ]),
      line('back', { next: 'menu' }),
    ]);
    expect(run(e).errors.map((x) => x.code)).toEqual(
      ['unsatisfiable-choice'].slice(0, 0).concat('inescapable-cycle'),
    );
  });

  it('AC-4: a longer cycle reports its shortest path, starting at the first reachable member', () => {
    const d = dialogue([
      line('start', { next: 'x' }),
      line('x', { next: 'y' }),
      line('y', { next: 'z' }),
      line('z', { next: 'x' }),
    ]);
    expect(run(d).errors.map((e) => e.message)).toEqual(['loop with no way out: x -> y -> z -> x']);
  });

  it('AC-4: a loop with a diamond reports one path', () => {
    const d = dialogue([
      choice('a', [option('l', { next: 'b' }), option('r', { next: 'c' })]),
      line('b', { next: 'd' }),
      line('c', { next: 'd' }),
      line('d', { next: 'a' }),
    ]);
    expect(run(d).errors.map((e) => e.message)).toEqual(['loop with no way out: a -> b -> d -> a']);
  });

  it('AC-4: a cycle is fine when a member ends, leaves the file or steps outside', () => {
    expect(
      run(dialogue([line('a', { next: 'b' }), line('b', { next: 'a', end: true })])).errors,
    ).toEqual([]);
    expect(
      run(
        dialogue([
          line('a', { next: 'b' }),
          { id: 'b', kind: 'branch', routes: [{ when: cls('a'), next: 'a' }], else: 'j' },
          { id: 'j', kind: 'jump', dialogue: 'x' },
        ]),
      ).errors,
    ).toEqual([]);
  });

  it('AC-4: an unreachable cycle is still reported, from its first member', () => {
    const d = dialogue([
      line('a', { end: true }),
      line('p', { next: 'q' }),
      line('q', { next: 'p' }),
    ]);
    expect(run(d).errors.map((e) => e.message)).toEqual([
      'node "p" is not reachable from any entry',
      'node "q" is not reachable from any entry',
      'loop with no way out: p -> q -> p',
    ]);
  });

  it('AC-5: a long line and a long option warn with node id and length', () => {
    const long = 'x'.repeat(41);
    const d = dialogue([
      line('a', { text: long, next: 'menu' }),
      choice('menu', [
        option('o', { text: long, end: true }),
        option('fits', { text: 'x'.repeat(40), end: true }),
      ]),
    ]);
    const { errors, warnings } = run(d);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([
      {
        pointer: '/nodes/0/text',
        code: 'text-too-long',
        message: 'line "a" is 41 characters, over the limit of 40',
      },
      {
        pointer: '/nodes/1/options/0/text',
        code: 'text-too-long',
        message: 'option "o" of "menu" is 41 characters, over the limit of 40',
      },
    ]);
  });

  it('AC-5: length counts characters, not UTF-16 units', () => {
    const d = dialogue([line('a', { text: '😀'.repeat(40), end: true })]);
    expect(run(d).warnings).toEqual([]);
  });
});
