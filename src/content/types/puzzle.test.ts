import { describe, expect, it } from 'vitest';
import { serializeContent } from '../schema.ts';
import { describeContent } from '../testing.ts';
import { MVP_TAG, puzzleSchema, type PuzzleInput } from './puzzle.ts';

/** A small valid puzzle: two plates, a crate, a lever; tests change one thing at a time. */
const valid = {
  id: 'test-plates',
  name: 'Test plates',
  notes: 'Test.',
  scene: 'testbed',
  entities: [
    { id: 'plate', role: 'pressure plate' },
    { id: 'crate', role: 'weight', critical: true },
    { id: 'lever', role: 'reset lever' },
  ],
  goal: { fact: 'test.plate-down' },
  solutions: [
    {
      id: 'crate',
      name: 'Crate on the plate',
      steps: [{ do: 'move', target: 'crate', to: 'plate' }],
    },
    {
      id: 'stand',
      name: 'Stand on it',
      capabilities: ['spell.levitate'],
      steps: [
        { do: 'reach', target: 'plate', using: 'spell.levitate' },
        { do: 'move', target: 'player', to: 'plate' },
        { do: 'wait', seconds: 2 },
        { do: 'interact', verb: 'pull', target: 'lever' },
        { do: 'stimulus', element: 'force', target: 'crate', note: 'Anyone can shove it.' },
      ],
    },
  ],
  policy: {
    recovery: [
      { kind: 'respawn', entity: 'crate', seconds: 10 },
      { kind: 'reset', trigger: 'lever' },
    ],
  },
  hints: [
    { afterSeconds: 180, afterAttempts: 3, bark: 'Heavy.' },
    {
      afterSeconds: 360,
      highlight: ['plate'],
      variants: [{ capability: 'spell.levitate', bark: 'Float it.' }],
    },
  ],
  tags: [MVP_TAG],
  focus: ['knight', 'sorcerer'],
  discovery: {
    volume: { kind: 'box', center: { x: 0, y: 1, z: 0 }, halfExtents: { x: 2, y: 2, z: 2 } },
    interact: 'lever',
  },
  outputs: {
    solvedFact: 'test.solved',
    set: [{ fact: 'test.door-open', value: true }],
    signals: ['test-room/gate-open'],
    rewards: ['test-reward'],
  },
} satisfies PuzzleInput;

const problems = (value: unknown) =>
  (puzzleSchema.safeParse(value).error?.issues ?? []).map(
    (i) => `${i.path.join('.')}: ${i.message}`,
  );

describe('puzzle schema (mw-e15.1)', () => {
  it('accepts a puzzle using every field, and fills the defaults', () => {
    expect(problems(valid)).toEqual([]);
    const minimal = puzzleSchema.parse({
      ...valid,
      entities: [{ id: 'plate', role: 'plate' }],
      solutions: [valid.solutions[0]].map((s) => ({
        ...s,
        steps: [{ do: 'reach', target: 'plate' }],
      })),
      policy: undefined,
      discovery: undefined,
      hints: undefined,
      tags: undefined,
      focus: undefined,
      outputs: { solvedFact: 'test.solved' },
    });
    expect(minimal.policy).toEqual({ repeatable: false, recovery: [] });
    expect([minimal.hints, minimal.tags, minimal.focus, minimal.outputs.set]).toEqual([
      [],
      [],
      [],
      [],
    ]);
    expect([minimal.outputs.signals, minimal.outputs.rewards, minimal.discovery]).toEqual([
      [],
      [],
      undefined,
    ]);
    expect(minimal.entities[0]?.critical).toBe(false);
    expect(minimal.solutions[0]?.capabilities).toEqual([]);
  });

  it('AC-3: an mvp puzzle with fewer than 2 declared solutions fails', () => {
    expect(problems({ ...valid, solutions: [valid.solutions[0]] })).toEqual([
      'solutions: an mvp puzzle needs at least 2 declared solutions; it has 1',
    ]);
    // Without the mvp tag one solution is allowed.
    expect(problems({ ...valid, tags: ['greybox'], solutions: [valid.solutions[0]] })).toEqual([]);
  });

  it('names every step, hint and recovery that refers to an entity it does not list', () => {
    expect(
      problems({
        ...valid,
        entities: [...valid.entities, { id: 'plate', role: 'again' }],
        solutions: [
          {
            id: 'bad',
            name: 'Bad',
            steps: [
              { do: 'move', target: 'barrel', to: 'shelf' },
              { do: 'stimulus', element: 'heat', target: 'brazier' },
            ],
          },
          valid.solutions[1],
        ],
        hints: [{ afterSeconds: 60, highlight: ['plate', 'mirror'] }],
        policy: {
          recovery: [
            { kind: 'respawn', entity: 'ghost', seconds: 1 },
            { kind: 'reset', trigger: 'button' },
          ],
        },
      }),
    ).toEqual([
      'entities.3.id: entity "plate" is listed twice',
      'solutions.0.steps.0.target: "barrel" is not one of the puzzle\'s entities',
      'solutions.0.steps.0.to: "shelf" is not one of the puzzle\'s entities',
      'solutions.0.steps.1.target: "brazier" is not one of the puzzle\'s entities',
      'hints.0.highlight.1: "mirror" is not one of the puzzle\'s entities',
      'policy.recovery.0.entity: "ghost" is not one of the puzzle\'s entities',
      'policy.recovery.1.trigger: "button" is not one of the puzzle\'s entities',
    ]);
  });

  it('rejects repeated solutions, undeclared step capabilities, out-of-order hints and respawning non-critical entities', () => {
    expect(
      problems({
        ...valid,
        solutions: [
          {
            ...valid.solutions[0],
            steps: [{ do: 'reach', target: 'plate', using: 'spell.blink' }],
          },
          { ...valid.solutions[1], id: 'crate' },
        ],
        hints: [
          { afterSeconds: 300, bark: 'a' },
          { afterSeconds: 300, bark: 'b' },
        ],
        policy: { recovery: [{ kind: 'respawn', entity: 'plate', seconds: 5 }] },
      }),
    ).toEqual([
      'solutions.0.steps.0.using: "spell.blink" is not one of solution "crate"\'s capabilities',
      'solutions.1.id: solution "crate" twice',
      'hints.1.afterSeconds: must be later than the tier before',
      'policy.recovery.0.entity: "plate" is respawned, so mark it critical',
    ]);
  });

  it('rejects malformed fields: step kinds, capability ids, classes, fact keys and empty hints', () => {
    expect(
      problems({
        ...valid,
        solutions: [
          { ...valid.solutions[0], capabilities: ['levitate'] },
          { ...valid.solutions[1], steps: [{ do: 'teleport', target: 'plate' }] },
        ],
        hints: [{ afterSeconds: 60 }],
        focus: ['bard'],
        outputs: { solvedFact: 'Not A Key' },
      }),
    ).toEqual([
      'solutions.0.capabilities.0: must be a capability id, e.g. "spell.mage-hand"',
      "solutions.1.steps.0.do: Invalid discriminator value. Expected 'stimulus' | 'move' | 'interact' | 'reach' | 'wait'",
      'hints.0: a hint tier needs a bark or a highlight',
      'focus.0: Invalid option: expected one of "knight"|"archer"|"sorcerer"|"thief"',
      'outputs.solvedFact: must be a fact key',
    ]);
  });
});

describe('puzzle discovery and outputs (mw-e15.3)', () => {
  it('needs a volume or a trigger, names a listed trigger, and checks signal ids', () => {
    expect(problems({ ...valid, discovery: {} })).toEqual([
      'discovery: needs a volume or an interact trigger',
    ]);
    expect(problems({ ...valid, discovery: { interact: 'door' } })).toEqual([
      'discovery.interact: "door" is not one of the puzzle\'s entities',
    ]);
    expect(
      problems({
        ...valid,
        outputs: { solvedFact: 'test.solved', signals: ['gate'], rewards: ['No'] },
      }),
    ).toEqual([
      'outputs.signals.0: must be "<graph>/<node>"',
      'outputs.rewards.0: must be lowercase kebab-case, e.g. "forgotten-miner"',
    ]);
  });
});

describe('the shipped puzzles', () => {
  describeContent('puzzle', 'AC-1: the example puzzle validates and round-trips', (entry) => {
    expect(puzzleSchema.parse(JSON.parse(serializeContent(entry)))).toEqual(entry);
  });
});
