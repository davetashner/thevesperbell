import type { DialogueDef } from '../../content/types/dialogue';
import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { MemoryLogicHost } from '../logic';
import {
  DialogueEnded,
  DialogueError,
  DialogueNodeVisited,
  DialogueRuntime,
  DialogueRuntimeError,
  DialogueStarted,
  MAX_SILENT_STEPS,
  dialogueVisitKey,
  type CheckResolver,
  type DialogueView,
} from './runtime';

/** A tiny dialogue literal; `nodes` is written loosely and cast (the schema is tested elsewhere). */
function dlg(id: string, nodes: unknown[], entries?: unknown[]): DialogueDef {
  const first = (nodes[0] as { id: string }).id;
  return {
    id,
    speakers: [{ id: 'npc', name: 'Npc' }],
    entries: entries ?? [{ id: 'default', node: first }],
    nodes,
  } as unknown as DialogueDef;
}

const jumpTo = (dialogue: string, node?: string) => ({
  id: 'go',
  kind: 'jump',
  dialogue: { type: 'dialogue', id: dialogue },
  ...(node === undefined && {}),
  ...(node !== undefined && { node }),
});

function setup(
  dialogues: readonly DialogueDef[],
  init: ConstructorParameters<typeof MemoryLogicHost>[0] = {},
  checks?: CheckResolver,
) {
  const world = new World<never>({ seed: 1, hz: 60 });
  const host = new MemoryLogicHost(init);
  const map = new Map(dialogues.map((d) => [d.id, d]));
  const runtime = new DialogueRuntime({
    world,
    host,
    dialogues: (id) => map.get(id),
    ...(checks !== undefined && { checks }),
  });
  const events: { name: string; payload: Record<string, unknown> }[] = [];
  for (const type of [DialogueStarted, DialogueNodeVisited, DialogueEnded, DialogueError]) {
    world.events.on(
      type as never,
      ((payload: Record<string, unknown>) => events.push({ name: type.name, payload })) as never,
    );
  }
  const flush = () => {
    world.events.flush();
  };
  return { world, host, runtime, events, flush };
}

const line = (id: string, next?: string) => ({
  id,
  kind: 'line',
  speaker: 'npc',
  text: id,
  ...(next === undefined ? { end: true } : { next }),
});
const option = (id: string, extra: object = {}) => ({
  id,
  text: id,
  showWhenLocked: false,
  once: false,
  end: true,
  ...extra,
});
const choice = (id: string, ...options: object[]) => ({ id, kind: 'choice', options });
const kindOf = (view: DialogueView | undefined) => view?.kind;

/** The shape of the marsh-greeting fixture: first meeting versus return, a once-only option. */
const marsh = dlg(
  'marsh-greeting',
  [
    line('welcome', 'menu'),
    line('welcome-back', 'menu'),
    choice(
      'menu',
      option('browse', { effects: [{ kind: 'emit', event: 'shop.open', data: {} }] }),
      option('news', { once: true, end: undefined, next: 'news-line' }),
      option('leave'),
    ),
    line('news-line', 'menu'),
  ],
  [
    {
      id: 'return',
      when: { kind: 'dialogue.visitedCount', id: 'welcome', op: 'gte', value: 1 },
      node: 'welcome-back',
    },
    { id: 'first-meeting', node: 'welcome' },
  ],
);

describe('start and entries', () => {
  it('AC-1: the second start uses the returning entry once the first was visited', () => {
    const { runtime } = setup([marsh]);
    const first = runtime.start('marsh-greeting', 'npc-ottilie');
    expect(first).toMatchObject({ kind: 'line', node: 'welcome' });
    runtime.advance();
    expect(runtime.active).toBe(true);
    runtime.choose(2); // leave
    expect(runtime.active).toBe(false);
    const second = runtime.start('marsh-greeting', 'npc-ottilie');
    expect(second).toMatchObject({ kind: 'line', node: 'welcome-back' });
  });

  it('AC-1: visits are per NPC', () => {
    const { runtime } = setup([marsh]);
    runtime.start('marsh-greeting', 'npc-ottilie');
    runtime.abort();
    expect(runtime.start('marsh-greeting', 'npc-other')).toMatchObject({ node: 'welcome' });
    expect(runtime.visitCount('npc-ottilie', 'marsh-greeting', 'welcome')).toBe(1);
    expect(runtime.visitCount('npc-other', 'marsh-greeting', 'nothing')).toBe(0);
  });

  it('throws for an unknown dialogue or when no entry holds', () => {
    const { runtime } = setup([
      dlg(
        'd',
        [line('a')],
        [{ id: 'never', node: 'a', when: { kind: 'gold', op: 'gte', value: 9 } }],
      ),
    ]);
    expect(() => runtime.start('missing', 'n')).toThrow(DialogueRuntimeError);
    expect(() => runtime.start('d', 'n')).toThrow('no entry');
  });

  it('starting while a conversation runs aborts it first with cause restarted', () => {
    const { runtime, events, flush } = setup([dlg('d', [line('a', 'b'), line('b')])]);
    runtime.start('d', 'n');
    runtime.start('d', 'n');
    flush();
    expect(events.filter((e) => e.name === 'dialogue.ended').map((e) => e.payload)).toEqual([
      expect.objectContaining({ reason: 'aborted', cause: 'restarted' }),
    ]);
  });

  it('reads the dialogue.visitedCount condition of another dialogue', () => {
    const other = dlg('other', [line('x')]);
    const main = dlg(
      'main',
      [line('a')],
      [
        {
          id: 'seen',
          node: 'a',
          when: { kind: 'dialogue.visitedCount', dialogue: 'other', id: 'x', op: 'gte', value: 1 },
        },
        { id: 'default', node: 'a' },
      ],
    );
    const { runtime, events, flush } = setup([other, main]);
    runtime.start('main', 'n');
    runtime.abort();
    runtime.start('other', 'n');
    runtime.advance();
    runtime.start('main', 'n');
    flush();
    const entries = events
      .filter((e) => e.name === 'dialogue.started')
      .map((e) => e.payload['entry']);
    expect(entries).toEqual(['default', 'default', 'seen']);
  });
});

describe('lines and silent nodes', () => {
  it('advance walks lines and a line with end completes the conversation', () => {
    const { runtime } = setup([dlg('d', [line('a', 'b'), line('b')])]);
    expect(runtime.start('d', 'n')).toMatchObject({
      kind: 'line',
      speaker: 'npc',
      text: 'a',
      textKey: 'dialogue.d.a',
    });
    expect(runtime.advance()).toMatchObject({ kind: 'line', node: 'b' });
    expect(runtime.advance()).toEqual({ kind: 'ended', reason: 'completed' });
    expect(runtime.view).toBeUndefined();
    expect(runtime.advance()).toEqual({ kind: 'ended', reason: 'completed' });
    expect(runtime.abort()).toBe(false);
  });

  it('advance on a choice node changes nothing', () => {
    const { runtime } = setup([dlg('d', [choice('c', option('o'))])]);
    runtime.start('d', 'n');
    expect(kindOf(runtime.advance())).toBe('choice');
  });

  it('an end node completes; a custom textKey is reported', () => {
    const { runtime } = setup([
      dlg('d', [
        { ...line('a', 'e'), textKey: 'custom.key' },
        { id: 'e', kind: 'end' },
      ]),
    ]);
    expect(runtime.start('d', 'n')).toMatchObject({ textKey: 'custom.key' });
    expect(runtime.advance()).toEqual({ kind: 'ended', reason: 'completed' });
  });

  it('branch picks the first holding route, else its else node', () => {
    const nodes = [
      {
        id: 'br',
        kind: 'branch',
        routes: [{ when: { kind: 'hasItem', item: 'key', count: 1 }, next: 'yes' }],
        else: 'no',
      },
      line('yes'),
      line('no'),
    ];
    expect(setup([dlg('d', nodes)], { items: { key: 1 } }).runtime.start('d', 'n')).toMatchObject({
      node: 'yes',
    });
    expect(setup([dlg('d', nodes)]).runtime.start('d', 'n')).toMatchObject({ node: 'no' });
  });

  it('effect nodes apply silently and continue or end', () => {
    const { runtime, host } = setup([
      dlg('d', [
        {
          id: 'fx',
          kind: 'effect',
          effects: [{ kind: 'giveItem', item: 'coin', count: 2 }],
          next: 'a',
        },
        line('a', 'fx2'),
        {
          id: 'fx2',
          kind: 'effect',
          effects: [{ kind: 'giveItem', item: 'coin', count: 1 }],
          end: true,
        },
      ]),
    ]);
    expect(runtime.start('d', 'n')).toMatchObject({ node: 'a' });
    expect(runtime.advance()).toEqual({ kind: 'ended', reason: 'completed' });
    expect(host.itemCount('coin')).toBe(3);
  });

  it('an effect node that fails goes to onFail, else aborts with an error', () => {
    const take = [{ kind: 'takeItem', item: 'key', count: 1 }];
    const withFail = setup([
      dlg('d', [
        { id: 'fx', kind: 'effect', effects: take, next: 'ok', onFail: 'bad' },
        line('ok'),
        line('bad'),
      ]),
    ]);
    expect(withFail.runtime.start('d', 'n')).toMatchObject({ node: 'bad' });
    const without = setup([
      dlg('d', [{ id: 'fx', kind: 'effect', effects: take, next: 'ok' }, line('ok')]),
    ]);
    expect(without.runtime.start('d', 'n')).toEqual({
      kind: 'ended',
      reason: 'aborted',
      cause: 'effects-failed',
    });
    without.flush();
    expect(without.events.some((e) => e.name === 'dialogue.error')).toBe(true);
  });

  it('jump continues in another dialogue at a node or by its entries', () => {
    const target = dlg(
      'target',
      [line('first', 'second'), line('second')],
      [
        { id: 'late', node: 'second', when: { kind: 'gold', op: 'gte', value: 5 } },
        { id: 'default', node: 'first' },
      ],
    );
    const at = setup([dlg('d', [jumpTo('target', 'second')]), target]);
    expect(at.runtime.start('d', 'n')).toMatchObject({ dialogue: 'target', node: 'second' });
    const byEntry = setup([dlg('d', [jumpTo('target')]), target]);
    expect(byEntry.runtime.start('d', 'n')).toMatchObject({ dialogue: 'target', node: 'first' });
    const rich = setup([dlg('d', [jumpTo('target')]), target], { gold: 9 });
    expect(rich.runtime.start('d', 'n')).toMatchObject({ node: 'second' });
    // Visits of the node land under the dialogue it ran in.
    expect(rich.runtime.visitCount('n', 'target', 'second')).toBe(1);
  });

  it('a jump to a missing dialogue, or one with no entry, aborts with an error', () => {
    const missing = setup([dlg('d', [jumpTo('nope')])]);
    expect(missing.runtime.start('d', 'n')).toMatchObject({
      reason: 'aborted',
      cause: 'unknown-dialogue',
    });
    const closed = dlg(
      'closed',
      [line('a')],
      [{ id: 'e', node: 'a', when: { kind: 'gold', op: 'gte', value: 9 } }],
    );
    const noEntry = setup([dlg('d', [jumpTo('closed')]), closed]);
    expect(noEntry.runtime.start('d', 'n')).toMatchObject({ cause: 'no-entry' });
  });

  it('a missing node and a silent loop abort with an error', () => {
    const lost = setup([dlg('d', [{ id: 'br', kind: 'branch', routes: [], else: 'ghost' }])]);
    expect(lost.runtime.start('d', 'n')).toMatchObject({ cause: 'unknown-node' });
    const loop = setup([dlg('d', [{ id: 'br', kind: 'branch', routes: [], else: 'br' }])]);
    expect(loop.runtime.start('d', 'n')).toMatchObject({ cause: 'loop' });
    loop.flush();
    const visits = loop.events.filter((e) => e.name === 'dialogue.nodeVisited');
    expect(visits).toHaveLength(MAX_SILENT_STEPS);
  });

  it('a choice with nothing to pick aborts instead of hanging', () => {
    const { runtime } = setup([
      dlg('d', [
        choice(
          'c',
          option('locked', { when: { kind: 'gold', op: 'gte', value: 9 }, showWhenLocked: true }),
        ),
      ]),
    ]);
    expect(runtime.start('d', 'n')).toMatchObject({ cause: 'no-choices' });
    const hidden = setup([
      dlg('d', [choice('c', option('gone', { when: { kind: 'gold', op: 'gte', value: 9 } }))]),
    ]);
    expect(hidden.runtime.start('d', 'n')).toMatchObject({ cause: 'no-choices' });
  });
});

describe('check nodes (seam for mw-e22.7)', () => {
  const nodes = (extra: object = {}) => [
    {
      id: 'chk',
      kind: 'check',
      approach: 'persuade',
      difficulty: 3,
      modifiers: [],
      success: 'won',
      failure: 'lost',
      successEffects: [{ kind: 'giveItem', item: 'prize', count: 1 }],
      failureEffects: [{ kind: 'giveItem', item: 'pity', count: 1 }],
      ...extra,
    },
    line('won'),
    line('lost'),
  ];

  it('the default resolver fails closed: the failure branch and its effects', () => {
    const { runtime, host } = setup([dlg('d', nodes())]);
    expect(runtime.start('d', 'n')).toMatchObject({ node: 'lost' });
    expect(host.itemCount('pity')).toBe(1);
    expect(host.itemCount('prize')).toBe(0);
  });

  it('a resolver decides, and sees the node and a context with the dialogue service', () => {
    let seen: { id: string; visits: number } | undefined;
    const { runtime, host } = setup([dlg('d', nodes())], {}, ({ node, context, dialogue, npc }) => {
      const visits = (
        context.services?.['dialogue'] as { visitCount(id: string): number }
      ).visitCount('chk');
      seen = { id: node.id, visits };
      expect([dialogue, npc]).toEqual(['d', 'n']);
      return true;
    });
    expect(runtime.start('d', 'n')).toMatchObject({ node: 'won' });
    expect(host.itemCount('prize')).toBe(1);
    expect(seen).toEqual({ id: 'chk', visits: 1 });
  });

  it('check effects that fail still route the story and report the error', () => {
    const { runtime, flush, events } = setup([
      dlg('d', nodes({ failureEffects: [{ kind: 'takeItem', item: 'missing', count: 1 }] })),
    ]);
    expect(runtime.start('d', 'n')).toMatchObject({ node: 'lost' });
    flush();
    expect(events.some((e) => e.name === 'dialogue.error')).toBe(true);
  });

  it('a check without effects just routes', () => {
    const { runtime } = setup([
      dlg('d', nodes({ successEffects: undefined, failureEffects: undefined })),
    ]);
    expect(runtime.start('d', 'n')).toMatchObject({ node: 'lost' });
  });
});

describe('choices', () => {
  const locked = option('vault', {
    text: 'Open the vault',
    when: { kind: 'hasItem', item: 'key', count: 1 },
    showWhenLocked: true,
  });

  it('AC-2: a failing condition with showWhenLocked is listed locked with a reason and cannot be chosen', () => {
    const { runtime } = setup([
      dlg('d', [
        choice(
          'c',
          option('free'),
          locked,
          option('hidden', { when: { kind: 'gold', op: 'gte', value: 9 } }),
        ),
      ]),
    ]);
    runtime.start('d', 'n');
    const listed = runtime.choices();
    expect(listed.map((c) => [c.index, c.id, c.locked])).toEqual([
      [0, 'free', false],
      [1, 'vault', true],
    ]);
    expect(listed[1]).toMatchObject({
      reason: 'logic.condition.hasItem(item=key,count=1)',
      reasonParts: { key: 'logic.condition.hasItem', params: { item: 'key', count: 1 } },
      textKey: 'dialogue.d.c.vault',
    });
    expect(listed[0]?.reason).toBeUndefined();
    expect(runtime.choose(1)).toMatchObject({ ok: false, reason: 'locked' });
    expect(runtime.active).toBe(true);
  });

  it('an option unlocks when its condition holds', () => {
    const { runtime } = setup([dlg('d', [choice('c', locked)])], { items: { key: 1 } });
    runtime.start('d', 'n');
    expect(runtime.choices()[0]?.locked).toBe(false);
    expect(runtime.choose(0)).toMatchObject({
      ok: true,
      view: { kind: 'ended', reason: 'completed' },
    });
  });

  it('choose rejects a bad index, and choose or choices outside a choice do nothing', () => {
    const { runtime } = setup([dlg('d', [line('a', 'c'), choice('c', option('o'))])]);
    expect(runtime.choose(0)).toMatchObject({ ok: false, reason: 'not-waiting-for-choice' });
    expect(runtime.choices()).toEqual([]);
    runtime.start('d', 'n');
    expect(runtime.choose(0)).toMatchObject({
      ok: false,
      reason: 'not-waiting-for-choice',
      view: { kind: 'line' },
    });
    expect(runtime.choices()).toEqual([]);
    runtime.advance();
    expect(runtime.choose(7)).toMatchObject({ ok: false, reason: 'no-such-choice' });
    expect(runtime.choose(-1)).toMatchObject({ ok: false, reason: 'no-such-choice' });
  });

  it('a chosen option applies its effects and moves to next', () => {
    const { runtime, host } = setup([
      dlg('d', [
        choice(
          'c',
          option('buy', {
            effects: [{ kind: 'giveItem', item: 'bread', count: 1 }],
            next: 'thanks',
            end: undefined,
          }),
        ),
        line('thanks'),
      ]),
    ]);
    runtime.start('d', 'n');
    expect(runtime.choose(0)).toMatchObject({ ok: true, view: { kind: 'line', node: 'thanks' } });
    expect(host.itemCount('bread')).toBe(1);
    expect(runtime.visitCount('n', 'd', 'buy')).toBe(1);
  });

  it('AC-3: a failing effect batch applies nothing and routes to onFail', () => {
    const effects = [
      { kind: 'giveItem', item: 'reward', count: 1 },
      { kind: 'takeItem', item: 'absent', count: 1 },
    ];
    const { runtime, host, flush, events } = setup([
      dlg('d', [
        choice('c', option('trade', { effects, onFail: 'sorry', end: undefined, next: 'done' })),
        line('sorry'),
        line('done'),
      ]),
    ]);
    runtime.start('d', 'n');
    expect(runtime.choose(0)).toMatchObject({ ok: true, view: { node: 'sorry' } });
    expect(host.itemCount('reward')).toBe(0);
    expect(runtime.visitCount('n', 'd', 'trade')).toBe(0);
    flush();
    expect(events.find((e) => e.name === 'dialogue.error')?.payload).toMatchObject({
      code: 'effects-failed',
      detail: 'missing-item:absent',
      at: 'trade',
    });
  });

  it('AC-3: without onFail it stays on the node with an error event', () => {
    const effects = [
      { kind: 'giveItem', item: 'reward', count: 1 },
      { kind: 'takeItem', item: 'absent', count: 1 },
    ];
    const { runtime, host, flush, events } = setup([
      dlg('d', [choice('c', option('trade', { effects }))]),
    ]);
    runtime.start('d', 'n');
    const result = runtime.choose(0);
    expect(result).toMatchObject({
      ok: false,
      reason: 'effects-failed',
      detail: 'missing-item:absent',
      view: { kind: 'choice', node: 'c' },
    });
    expect(runtime.active).toBe(true);
    expect(host.itemCount('reward')).toBe(0);
    flush();
    expect(events.filter((e) => e.name === 'dialogue.error')).toHaveLength(1);
    expect(events.some((e) => e.name === 'dialogue.ended')).toBe(false);
  });

  it('AC-4: a once option already chosen is not offered after a restart', () => {
    const { runtime } = setup([marsh]);
    runtime.start('marsh-greeting', 'npc-ottilie');
    runtime.advance();
    expect(runtime.choices().map((c) => c.id)).toEqual(['browse', 'news', 'leave']);
    runtime.choose(1);
    expect(runtime.view).toMatchObject({ kind: 'line', node: 'news-line' });
    runtime.advance();
    expect(runtime.choices().map((c) => c.id)).toEqual(['browse', 'leave']);
    runtime.choose(1); // leave
    runtime.start('marsh-greeting', 'npc-ottilie');
    runtime.advance();
    expect(runtime.choices().map((c) => c.id)).toEqual(['browse', 'leave']);
  });
});

describe('abort', () => {
  it('AC-5: keeps applied effects, applies nothing pending and emits ended aborted', () => {
    const { runtime, host, flush, events } = setup([
      dlg('d', [
        {
          id: 'fx',
          kind: 'effect',
          effects: [{ kind: 'giveItem', item: 'coin', count: 1 }],
          next: 'a',
        },
        line('a', 'c'),
        choice('c', option('later', { effects: [{ kind: 'giveItem', item: 'coin', count: 5 }] })),
      ]),
    ]);
    runtime.start('d', 'n');
    runtime.advance();
    expect(runtime.abort('combat')).toBe(true);
    expect(runtime.active).toBe(false);
    expect(runtime.choose(0)).toMatchObject({ ok: false });
    expect(host.itemCount('coin')).toBe(1);
    flush();
    expect(events.filter((e) => e.name === 'dialogue.ended').map((e) => e.payload)).toEqual([
      { tick: 0, dialogue: 'd', npc: 'n', reason: 'aborted', cause: 'combat' },
    ]);
  });

  it('abort without a cause omits it', () => {
    const { runtime, flush, events } = setup([dlg('d', [line('a', 'a')])]);
    runtime.start('d', 'n');
    runtime.abort();
    flush();
    expect(events.find((e) => e.name === 'dialogue.ended')?.payload).not.toHaveProperty('cause');
  });
});

describe('events', () => {
  it('emits started, nodeVisited for nodes and options, and ended completed, with the tick', () => {
    const { runtime, world, flush, events } = setup([
      dlg('d', [line('a', 'c'), choice('c', option('o'))]),
    ]);
    runtime.start('d', 'n');
    runtime.advance();
    runtime.choose(0);
    flush();
    expect(
      events.map((e) => [e.name, e.payload['id'] ?? e.payload['entry'] ?? e.payload['reason']]),
    ).toEqual([
      ['dialogue.started', 'default'],
      ['dialogue.nodeVisited', 'a'],
      ['dialogue.nodeVisited', 'c'],
      ['dialogue.nodeVisited', 'o'],
      ['dialogue.ended', 'completed'],
    ]);
    expect(events[1]?.payload).toMatchObject({ what: 'node', count: 1, tick: world.tick });
    expect(events[3]?.payload).toMatchObject({ what: 'option' });
  });
});

describe('state', () => {
  it('visit counts are int facts under the entity:*.visits template, so a strict store accepts them', () => {
    const { runtime, world } = setup([dlg('d', [line('a', 'a2'), line('a2')])]);
    world.facts.declare('entity:*.visits', { type: 'int', default: 0 });
    world.facts.setUndeclaredPolicy({ mode: 'throw' });
    runtime.start('d', 'npc-x');
    const key = dialogueVisitKey('npc-x', 'd', 'a');
    expect(key).toBe('entity:d/2-npc-x-a.visits');
    expect(world.facts.get(key)).toBe(1);
    runtime.advance();
    runtime.start('d', 'npc-x');
    expect(world.facts.get(key)).toBe(2);
  });

  it('keys of different NPC and node splits never collide', () => {
    expect(dialogueVisitKey('a-b', 'd', 'c')).not.toBe(dialogueVisitKey('a', 'd', 'b-c'));
  });

  it('a restored world drops the conversation silently and keeps the visits', () => {
    const { runtime, world, flush, events } = setup([dlg('d', [line('a', 'a2'), line('a2')])]);
    runtime.start('d', 'n');
    const saved = world.snapshot();
    world.restore(saved);
    expect(runtime.active).toBe(false);
    expect(runtime.view).toBeUndefined();
    expect(runtime.visitCount('n', 'd', 'a')).toBe(1);
    flush();
    expect(events.some((e) => e.name === 'dialogue.ended')).toBe(false);
    expect(kindOf(runtime.start('d', 'n'))).toBe('line');
  });

  it('keeps the host`s own services next to the dialogue service', () => {
    const marker = { v: 1 };
    const { runtime } = setup(
      [dlg('d', [line('a')])],
      { services: { other: marker } },
      ({ context }) => context.services?.['other'] === marker,
    );
    expect(runtime.start('d', 'n')).toMatchObject({ node: 'a' });
  });
});
