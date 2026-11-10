import { describe, expect, it } from 'vitest';
import { loadGameContent, type GameContent } from '@content/index';
import { capabilityElementsOf } from './abstract';
import type { ConcreteResult } from './concrete';
import { lamp, puzzleWith, spawns } from './fixtures';
import { formatReport, main, validatePuzzle, verdictOf, type ValidateIo } from './validate';

const content = loadGameContent();
const capabilityElements = capabilityElementsOf(content.all('spell'));
const confirmed: ConcreteResult = { status: 'confirmed', ticks: 10 };
const diverged: ConcreteResult = { status: 'diverged', step: 1, reason: 'it did not burn' };
const reachable = { status: 'reachable', steps: 1, path: ['x'] } as const;
const unreachable = { status: 'unreachable', missing: [], explored: 3 } as const;
const inconclusive = { status: 'inconclusive', reason: 'bound', explored: 3 } as const;

describe('verdicts', () => {
  it('combine the abstract proof and the concrete run', () => {
    expect(verdictOf(reachable, undefined)).toBe('ok');
    expect(verdictOf(reachable, confirmed)).toBe('ok');
    expect(verdictOf(reachable, diverged)).toBe('diverged');
    expect(verdictOf(unreachable, undefined)).toBe('unreachable');
    expect(verdictOf(unreachable, diverged)).toBe('diverged');
    expect(verdictOf(unreachable, confirmed)).toBe('abstraction-gap');
    expect(verdictOf(inconclusive, undefined)).toBe('inconclusive');
    expect(verdictOf(inconclusive, confirmed)).toBe('ok');
  });
});

describe('validatePuzzle', () => {
  it('reports each solution, its shortcut and whether anything failed', () => {
    const report = validatePuzzle(puzzleWith(), spawns(lamp), { capabilityElements });
    expect(report).toMatchObject({ id: 'fixture', mvp: false, failed: false });
    expect(report.solutions[0]).toMatchObject({ id: 'cast', verdict: 'ok', shortcut: undefined });
    const broken = validatePuzzle(puzzleWith(), spawns({ id: 'lamp' }), {
      capabilityElements,
      concrete: () => diverged,
    });
    expect(broken.failed).toBe(true);
    expect(broken.solutions[0]?.verdict).toBe('diverged');
  });

  it('formats every kind of finding', () => {
    const missing = puzzleWith({
      tags: ['mvp'],
      solutions: [
        { id: 'a', name: 'A', steps: [{ do: 'wait', seconds: 1 }] },
        {
          id: 'b',
          name: 'B',
          capabilities: ['spell.ember'],
          steps: [{ do: 'move', target: 'crate', to: 'lamp' }],
        },
      ],
      entities: [{ id: 'crate', role: 'crate' }],
    });
    const lines = formatReport(
      validatePuzzle(missing, spawns(lamp), { capabilityElements, concrete: () => confirmed }),
    );
    expect(lines).toContain('puzzle fixture (mvp)');
    expect(lines.join('\n')).toContain(
      'the level lacks: step 1 (move): the level has no entity "crate"',
    );
    expect(lines.join('\n')).toContain('ABSTRACTION-GAP b');
    expect(lines.join('\n')).toContain('warning: abstraction gap');
    expect(lines.join('\n')).toContain('concrete: goal true after 10 ticks');
    expect(lines.join('\n')).toContain('abstract: unreachable, no action sequence');

    const text = formatReport({
      id: 'p',
      mvp: false,
      failed: true,
      solutions: [
        {
          id: 's',
          capabilities: [],
          abstract: inconclusive,
          concrete: { status: 'diverged', reason: 'stayed false' },
          shortcut: { capabilities: [], steps: 2 },
          softlock: { status: 'none', explored: 1 },
          verdict: 'diverged',
        },
        {
          id: 't',
          capabilities: ['spell.ember'],
          abstract: reachable,
          concrete: diverged,
          shortcut: undefined,
          softlock: { status: 'inconclusive', reason: 'bound', explored: 2 },
          verdict: 'diverged',
        },
        {
          id: 'u',
          capabilities: [],
          abstract: reachable,
          concrete: undefined,
          shortcut: undefined,
          softlock: { status: 'softlock', lost: ['crate'], path: ['burn crate'], explored: 4 },
          verdict: 'ok',
        },
        {
          id: 'v',
          capabilities: [],
          abstract: reachable,
          concrete: undefined,
          shortcut: undefined,
          softlock: { status: 'covered', by: ['burn of crate'], explored: 4 },
          verdict: 'ok',
        },
      ],
    }).join('\n');
    expect(text).toContain('softlock search: inconclusive, bound');
    expect(text).toContain('SOFTLOCK: after burn crate (crate lost for good)');
    expect(text).toContain('softlock avoided by recovery: burn of crate');
    expect(text).toContain('abstract: inconclusive, bound (3 states)');
    expect(text).toContain('concrete: diverged: stayed false');
    expect(text).toContain('concrete: diverged at step 1: it did not burn');
    expect(text).toContain(
      'info: shortcut, the goal is also reachable in 2 action(s) with capabilities: none',
    );
    expect(text).toContain('abstract: goal reachable in 1 action(s): x');
  });
});

/** A content stand-in holding one synthetic scene and the given puzzles, with the real spells. */
function ioFor(puzzles: ReturnType<typeof puzzleWith>[], extra: Partial<ValidateIo> = {}) {
  const lines: string[] = [];
  const errors: string[] = [];
  const scene = { id: 'room', ...spawns(lamp) };
  const stub = {
    all: (type: string) =>
      type === 'puzzle' ? puzzles : type === 'scene' ? [scene] : content.all(type as 'spell'),
  } as unknown as GameContent;
  let t = 0;
  const io: ValidateIo = {
    log: (line) => lines.push(line),
    error: (line) => errors.push(line),
    content: stub,
    now: () => (t += 1),
    ...extra,
  };
  return { io, lines, errors };
}

describe('puzzle:validate main', () => {
  it('AC-6: an mvp puzzle with an unreachable declared solution fails the run', () => {
    const broken = puzzleWith({
      id: 'broken',
      tags: ['mvp'],
      solutions: [
        { id: 'a', name: 'A', steps: [{ do: 'wait', seconds: 1 }] },
        {
          id: 'b',
          name: 'B',
          steps: [{ do: 'move', target: 'crate', to: 'lamp' }],
        },
      ],
      entities: [{ id: 'crate', role: 'crate' }],
    });
    const { io, lines } = ioFor([broken]);
    expect(main([], io)).toBe(1);
    expect(lines.join('\n')).toContain(
      '1 puzzle(s) with an unreachable, diverging or softlocking declared solution',
    );
  });

  it('a broken puzzle that is not mvp is reported but passes, unless it is asked for by id', () => {
    const broken = puzzleWith({
      id: 'greybox',
      solutions: [{ id: 'b', name: 'B', steps: [{ do: 'move', target: 'crate', to: 'lamp' }] }],
      entities: [{ id: 'crate', role: 'crate' }],
    });
    const everything = ioFor([broken]);
    expect(main([], everything.io)).toBe(0);
    expect(everything.lines.join('\n')).toContain('UNREACHABLE b');
    expect(main(['greybox'], ioFor([broken]).io)).toBe(1);
  });

  it('runs the concrete layer unless --abstract-only, and honours --time-box', () => {
    const good = puzzleWith({
      tags: ['mvp'],
      solutions: [
        {
          id: 'cast',
          name: 'Cast',
          capabilities: ['spell.ember'],
          steps: [{ do: 'stimulus', element: 'heat', target: 'lamp', using: 'spell.ember' }],
        },
        {
          id: 'cast-again',
          name: 'Cast again',
          capabilities: ['spell.ember'],
          steps: [{ do: 'stimulus', element: 'heat', target: 'lamp', using: 'spell.ember' }],
        },
      ],
    });
    const ran: string[] = [];
    const concrete = (puzzle: { id: string }, solution: { id: string }): ConcreteResult => {
      ran.push(`${puzzle.id}/${solution.id}`);
      return confirmed;
    };
    expect(main(['--time-box', '500'], ioFor([good], { concrete }).io)).toBe(0);
    expect(ran).toEqual(['fixture/cast', 'fixture/cast-again']);
    expect(main(['--abstract-only', 'fixture'], ioFor([good], { concrete }).io)).toBe(0);
    expect(ran).toHaveLength(2);
    const failing = ioFor([good], { concrete: () => diverged });
    expect(main(['fixture'], failing.io)).toBe(1);
  });

  it('rejects an unknown puzzle, a bad time box and a puzzle whose scene is missing', () => {
    const unknown = ioFor([puzzleWith()]);
    expect(main(['nope'], unknown.io)).toBe(2);
    expect(unknown.errors[0]).toContain('no puzzle "nope" (have: fixture)');
    const bad = ioFor([puzzleWith()]);
    expect(main(['--time-box', 'soon'], bad.io)).toBe(2);
    expect(bad.errors[0]).toContain('--time-box needs a positive number');
    const stray = ioFor([puzzleWith({ scene: 'elsewhere' })]);
    expect(main([], stray.io)).toBe(1);
    expect(stray.errors[0]).toContain('scene "elsewhere" is missing');
  });
});
