// Synthetic puzzles and scenes for the solver's tests (mw-e15.6): built through the real schemas so
// they are valid content, without being shipped content.
import { puzzleSchema, sceneSpawnSchema, type Puzzle } from '@content/index';

type PuzzleOverrides = Record<string, unknown>;

/** A scene's spawns from loose data (position defaults to the origin). */
export function spawns(...list: (Partial<Record<string, unknown>> & { id: string })[]) {
  return {
    spawns: list.map((spawn) => sceneSpawnSchema.parse({ at: [0, 0, 0], ...spawn })),
  };
}

/** A valid puzzle in scene "room" with `overrides` applied over a one-lamp default. */
export function puzzleWith(overrides: PuzzleOverrides = {}): Puzzle {
  return puzzleSchema.parse({
    id: 'fixture',
    name: 'Fixture',
    notes: 'A synthetic puzzle for solver tests.',
    scene: 'room',
    goal: {
      entities: { entity: 'lamp' },
      where: [{ test: 'element', element: 'fire' }],
      match: 'all',
    },
    solutions: [
      {
        id: 'cast',
        name: 'Cast',
        capabilities: ['spell.ember'],
        steps: [{ do: 'stimulus', element: 'heat', target: 'lamp', using: 'spell.ember' }],
      },
    ],
    outputs: { solvedFact: 'fixture.solved' },
    ...overrides,
    entities: [
      { id: 'lamp', role: 'lamp' },
      ...((overrides['entities'] as object[] | undefined) ?? []),
    ],
  });
}

export const lamp = { id: 'lamp', lightSource: { variant: 'brazier', unlit: true } };
