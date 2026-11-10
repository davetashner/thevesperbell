// mw-e15.6: the puzzle solvability validator against the shipped content and the headless sim. The
// concrete layer runs declared step lists through the game's own wiring (Rapier, spells, fire rules,
// the puzzle runtime); the CLI's main is run over the shipped puzzles and over a broken mvp puzzle.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { loadGameContent, type GameContent } from '@content/index';
import { markExercised } from '@content/testing';
import { runSolution } from '@tools/puzzle/concrete';
import { main } from '@tools/puzzle/validate';
import { puzzleWith } from '@tools/puzzle/fixtures';

const content = loadGameContent();
const puzzleOf = (id: string) => {
  const found = content.all('puzzle').find((p) => p.id === id);
  if (found === undefined) throw new Error(id);
  return found;
};
const hall = puzzleOf('brazier-hall');
type Puzzle = Parameters<typeof runSolution>[2];
type Solution = Parameters<typeof runSolution>[3];
const solution = (steps: unknown[], capabilities: string[] = []) =>
  ({ id: 'probe', name: 'Probe', capabilities, steps }) as unknown as Solution;
const run = (puzzle: typeof hall, steps: unknown[], capabilities: string[] = []) =>
  runSolution(RAPIER, content, puzzle, solution(steps, capabilities));

describe('declared step lists run in the headless sim (mw-e15.6)', { timeout: 120_000 }, () => {
  it('AC-4: every declared step list of the brazier hall makes its goal true', ({ task }) => {
    markExercised(task, 'scene', 'brazier-hall');
    markExercised(task, 'spell', 'ember');
    for (const declared of hall.solutions) {
      const result = runSolution(RAPIER, content, hall, declared);
      expect(result, declared.id).toMatchObject({ status: 'confirmed' });
    }
  });

  it('AC-4: a step that does not do what it says fails with the index of that step', () => {
    const cast = { do: 'stimulus', element: 'heat', target: 'brazier-west', using: 'spell.ember' };
    const gate = { do: 'stimulus', element: 'heat', target: 'vault-gate' };
    expect(run(hall, [cast, gate], ['spell.ember'])).toEqual({
      status: 'diverged',
      step: 1,
      reason: '"vault-gate" did not catch fire',
    });
    expect(run(hall, [{ do: 'interact', verb: 'pull', target: 'brazier-west' }])).toEqual({
      status: 'diverged',
      step: 0,
      reason: '"brazier-west" offers nothing to the player, not "pull"',
    });
    expect(run(hall, [{ do: 'stimulus', element: 'heat', target: 'nowhere' }])).toEqual({
      status: 'diverged',
      step: 0,
      reason: 'the scene has no entity "nowhere"',
    });
    expect(run(hall, [{ do: 'move', target: 'torch-barrel', to: 'nowhere' }])).toMatchObject({
      step: 0,
      reason: 'the scene has no entity "nowhere"',
    });
    expect(
      run(hall, [
        { do: 'move', target: 'torch-barrel', to: 'vault-gate' },
        { do: 'wait', seconds: 0.5 },
      ]),
    ).toMatchObject({
      status: 'diverged',
      reason: expect.stringContaining('the goal stayed false') as string,
    });
  });

  it('reach and wait steps run, and a goal that never comes true says why', () => {
    const result = run(hall, [
      { do: 'reach', target: 'brazier-east' },
      { do: 'wait', seconds: 0.5 },
    ]);
    expect(result.status).toBe('diverged');
    expect(result.status === 'diverged' ? result.step : 0).toBeUndefined();
    expect(run(hall, [{ do: 'reach', target: 'nowhere' }])).toMatchObject({ step: 0 });
  });

  it('a player is moved to a place like any other thing, and an interact step must name the verb on offer', () => {
    expect(run(hall, [{ do: 'move', target: 'player', to: 'brazier-west' }])).toMatchObject({
      status: 'diverged',
    });
    const lever = puzzleOf('testbed-room-lever');
    expect(run(lever, [{ do: 'interact', verb: 'search', target: 'room-lever' }])).toEqual({
      status: 'diverged',
      step: 0,
      reason: '"room-lever" offers "pull" to the player, not "search"',
    });
  });

  it('a marker spawn has no body to move, reach or heat', () => {
    // vault-prize is a spawn point with nothing placed in the sim: steps that need a position say so.
    expect(run(hall, [{ do: 'reach', target: 'vault-prize' }])).toMatchObject({ step: 0 });
    expect(run(hall, [{ do: 'move', target: 'torch-barrel', to: 'vault-prize' }])).toMatchObject({
      step: 0,
    });
    expect(run(hall, [{ do: 'move', target: 'vault-prize', to: 'brazier-west' }])).toMatchObject({
      step: 0,
    });
    expect(run(hall, [{ do: 'stimulus', element: 'heat', target: 'vault-prize' }])).toMatchObject({
      step: 0,
    });
    expect(
      run(hall, [
        { do: 'stimulus', element: 'cold', target: 'brazier-west', using: 'spell.ember' },
      ]),
    ).toMatchObject({ status: 'diverged' });
  });

  it('a scene without puzzles runs none', () => {
    const probe = { ...hall, scene: { id: 'mechanism-room' } } as typeof hall;
    expect(run(probe, [{ do: 'wait', seconds: 0.1 }])).toEqual({
      status: 'diverged',
      reason: 'scene "mechanism-room" runs no puzzles',
    });
  });

  it('the testbed lever puzzle: its steps run (reach, pull, shove) though its stand-in fact stays false', () => {
    const lever = puzzleOf('testbed-room-lever');
    for (const declared of lever.solutions) {
      expect(runSolution(RAPIER, content, lever, declared), declared.id).toMatchObject({
        status: 'diverged',
        reason: expect.stringContaining('the goal stayed false') as string,
      });
    }
  });
});

describe('the validator over shipped content (mw-e15.6)', { timeout: 120_000 }, () => {
  const io = (content: Pick<GameContent, 'all'>, lines: string[] = []) => ({
    log: (line: string) => lines.push(line),
    error: (line: string) => lines.push(line),
    content,
    now: () => performance.now(),
    concrete: (puzzle: Puzzle, declared: Solution) =>
      runSolution(RAPIER, content as GameContent, puzzle, declared),
  });

  it('every shipped mvp puzzle passes, abstractly and in the sim', ({ task }) => {
    markExercised(task, 'scene', 'brazier-hall');
    const lines: string[] = [];
    expect(main([], io(content, lines))).toBe(0);
    expect(lines.join('\n')).toContain('OK carry-flame');
    expect(lines.join('\n')).toContain('OK fire-from-range');
    expect(main(['brazier-hall'], io(content))).toBe(0);
  });

  it('AC-6: an mvp puzzle with an unreachable declared solution fails the job', () => {
    const broken = puzzleWith({
      id: 'broken-hall',
      scene: 'brazier-hall',
      tags: ['mvp'],
      entities: [{ id: 'crate', role: 'a crate the hall does not have' }],
      solutions: [
        { id: 'wait', name: 'Wait', steps: [{ do: 'wait', seconds: 1 }] },
        { id: 'push', name: 'Push', steps: [{ do: 'move', target: 'crate', to: 'lamp' }] },
      ],
    });
    const stub: Pick<GameContent, 'all'> = {
      all: ((type: string) =>
        type === 'puzzle' ? [broken] : content.all(type as 'scene')) as GameContent['all'],
    };
    const lines: string[] = [];
    expect(main([], { ...io(stub, lines), concrete: undefined })).toBe(1);
    expect(lines.join('\n')).toContain(
      'the level lacks: step 1 (move): the level has no entity "crate"',
    );
  });
});
