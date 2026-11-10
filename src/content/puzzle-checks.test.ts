import { describe, expect, it } from 'vitest';
import { GAME_CONTENT_ROOT, gameContentSources } from './game-content.ts';
import { ContentLoadError, loadContent, type ContentSource } from './loader.ts';
import { checkPuzzles } from './puzzle-checks.ts';
import { contentChecks, contentTypes } from './registry.ts';
import type { PuzzleInput } from './types/puzzle.ts';

const EXAMPLE = `${GAME_CONTENT_ROOT}/puzzle/testbed-room-lever.json`;
const FILE = `${GAME_CONTENT_ROOT}/puzzle/zz-test.json`;
const SCENE = `${GAME_CONTENT_ROOT}/scene/testbed.json`;

/** The shipped example puzzle, re-id'd as a test file, with `change` applied. */
function puzzle(change: (p: PuzzleInput) => PuzzleInput): ContentSource {
  const example = gameContentSources().find((s) => s.path === EXAMPLE);
  if (example === undefined) throw new Error(`no ${EXAMPLE}`);
  const base = { ...(JSON.parse(example.text) as PuzzleInput), id: 'zz-test' };
  return { path: FILE, text: JSON.stringify(change(base)) };
}

function loadIssues(extra: readonly ContentSource[]): string[] {
  try {
    loadContent(contentTypes, [...gameContentSources(), ...extra], contentChecks);
  } catch (error) {
    if (!(error instanceof ContentLoadError)) throw error;
    return error.issues.map((i) => `${i.file}#${i.pointer}: ${i.message}`);
  }
  return [];
}

describe('puzzle load checks (mw-e15.1)', () => {
  it('AC-1: the shipped content, with the example puzzle, passes', () => {
    expect(loadIssues([])).toEqual([]);
    expect(loadIssues([puzzle((p) => p)])).toEqual([]);
  });

  it('AC-2: a puzzle naming an entity its level does not place fails, naming the id and level', () => {
    const issues = loadIssues([
      puzzle((p) => ({
        ...p,
        entities: [...p.entities, { id: 'west-brazier', role: 'brazier' }],
      })),
    ]);
    expect(issues).toEqual([
      `${FILE}#/entities/2/id: puzzle:zz-test names entity "west-brazier", which level "testbed" (${SCENE}) does not place`,
    ]);
  });

  it('AC-4: a solution or hint naming an unknown capability fails with the id', () => {
    const issues = loadIssues([
      puzzle((p) => ({
        ...p,
        solutions: p.solutions.map((s) =>
          s.id === 'mage-hand'
            ? {
                ...s,
                capabilities: ['spell.mage-hand', 'spell.telekinesis'],
              }
            : s,
        ),
        hints: [
          {
            afterSeconds: 60,
            bark: 'Hm.',
            variants: [{ capability: 'arrow.zz-unknown', bark: 'Rope!' }],
          },
        ],
      })),
    ]);
    expect(issues).toEqual([
      `${FILE}#/solutions/1/capabilities/1: puzzle:zz-test names unknown capability "spell.telekinesis": declare it in src/content/data/capability/`,
      `${FILE}#/hints/0/variants/0/capability: puzzle:zz-test names unknown capability "arrow.zz-unknown": declare it in src/content/data/capability/`,
    ]);
  });

  it('checks the goal and output facts against the fact registry', () => {
    const undeclared = loadIssues([
      puzzle((p) => ({
        ...p,
        goal: { all: [{ fact: 'testbed.room-lever.thrown' }, { fact: 'testbed.nope' }] },
        outputs: {
          solvedFact: 'testbed.nope-solved',
          set: [
            { fact: 'testbed.room-lever.thrown', value: 3 },
            { fact: 'kestrel-lock.gate-open', value: true },
            { fact: 'testbed.missing', value: true },
          ],
        },
      })),
    ]);
    expect(undeclared).toEqual([
      `${FILE}#/goal/all/1/fact: puzzle:zz-test names undeclared fact "testbed.nope": declare it in src/content/data/fact/`,
      `${FILE}#/outputs/solvedFact: puzzle:zz-test names undeclared fact "testbed.nope-solved": declare it in src/content/data/fact/`,
      `${FILE}#/outputs/set/0: puzzle:zz-test "testbed.room-lever.thrown" is bool: 3 is not a bool`,
      `${FILE}#/outputs/set/2: puzzle:zz-test names undeclared fact "testbed.missing": declare it in src/content/data/fact/`,
    ]);
    const notBool = loadIssues([puzzle((p) => ({ ...p, outputs: { solvedFact: 'horn.fate' } }))]);
    expect(notBool).toEqual([
      `${FILE}#/outputs/solvedFact: puzzle:zz-test solved fact "horn.fate" must be bool, not enum`,
    ]);
  });

  it('mw-e15.7: a respawned entity must be a prop, and a reset fact a declared int', () => {
    const issues = loadIssues([
      puzzle((p) => ({
        ...p,
        entities: [
          ...p.entities,
          { id: 'player-start', role: 'a marker', critical: true },
          { id: 'ghost', role: 'not placed', critical: true },
        ],
        policy: {
          repeatable: false,
          recovery: [
            { kind: 'respawn', entity: 'player-start', seconds: 5 },
            { kind: 'respawn', entity: 'ghost', seconds: 5 },
            { kind: 'reset', trigger: 'room-lever' },
            { kind: 'reset', trigger: 'room-lever', fact: 'testbed.nope' },
            { kind: 'reset', trigger: 'room-lever', fact: 'testbed.room-lever.thrown' },
            { kind: 'reset', trigger: 'room-lever', fact: 'ownership.thefts' },
          ],
        },
      })),
    ]);
    expect(issues).toEqual([
      `${FILE}#/entities/3/id: puzzle:zz-test names entity "ghost", which level "testbed" (${SCENE}) does not place`,
      `${FILE}#/policy/recovery/0/entity: puzzle:zz-test respawns "player-start", which is not a prop spawn of level "testbed": only a prop can be dropped again`,
      `${FILE}#/policy/recovery/3/fact: puzzle:zz-test names undeclared fact "testbed.nope": declare it in src/content/data/fact/`,
      `${FILE}#/policy/recovery/4/fact: puzzle:zz-test reset fact "testbed.room-lever.thrown" must be int, not bool`,
    ]);
  });

  it('a puzzle in a missing scene is reported once, by the reference check', () => {
    const issues = loadIssues([puzzle((p) => ({ ...p, scene: 'no-such-level' }))]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('no-such-level');
  });

  it('ignores entries of other types', () => {
    expect(checkPuzzles([{ type: 'testprop', file: 'x.json', value: { id: 'x' } }])).toEqual([]);
  });

  it('mw-e15.2: a goal may read only entities the puzzle lists, and signals that exist', () => {
    const goal = (g: unknown) => puzzle((p) => ({ ...p, goal: g }));
    expect(
      loadIssues([
        goal({
          all: [
            { entities: { entity: 'room-lever' }, match: 'any' },
            { sustained: { entities: { entity: 'loose-crate' }, match: 'any' }, seconds: 2 },
            { entities: { tag: 'brazier' }, match: 'all' },
            { signal: 'greybox-rune-plates/west-plate', port: 'active' },
          ],
        }),
      ]),
    ).toEqual([]);
    expect(
      loadIssues([
        goal({
          all: [
            { entities: { entity: 'west-brazier' }, match: 'any' },
            { not: { entities: { entity: 'room-lever' }, match: 'none' } },
            { signal: 'greybox-rune-plates/missing' },
          ],
        }),
      ]),
    ).toEqual([
      `${FILE}#/goal/all/2/signal: puzzle:zz-test reads node "missing", which signal graph "greybox-rune-plates" does not have`,
      `${FILE}#/goal/all/0/entities/entity: puzzle:zz-test goal reads entity "west-brazier", which the puzzle does not list in \`entities\``,
    ]);
  });

  it('mw-e15.3: the signals a puzzle drives are lever or button nodes of a graph its scene places', () => {
    const drive = (...signals: string[]) =>
      loadIssues([puzzle((p) => ({ ...p, outputs: { ...p.outputs, signals } }))]);
    expect(drive('nowhere/gate')).toEqual([
      `${FILE}#/outputs/signals/0: puzzle:zz-test drives signal "nowhere/gate", but there is no signal graph "nowhere"`,
    ]);
    expect(drive('mechanism-room/missing')).toEqual([
      `${FILE}#/outputs/signals/0: puzzle:zz-test drives signal "mechanism-room/missing", but graph "mechanism-room" has no node "missing"`,
    ]);
    expect(drive('mechanism-room/north-gate')).toEqual([
      `${FILE}#/outputs/signals/0: puzzle:zz-test drives signal "mechanism-room/north-gate", a receiver node: only a lever (switched on) or a button (pressed) can be driven from outside the graph`,
    ]);
    expect(drive('mechanism-room/north-lever', 'mechanism-room/east-button')).toEqual([
      `${FILE}#/outputs/signals/0: puzzle:zz-test drives signal "mechanism-room/north-lever", but level "testbed" (${SCENE}) does not place signal graph "mechanism-room"`,
      `${FILE}#/outputs/signals/1: puzzle:zz-test drives signal "mechanism-room/east-button", but level "testbed" (${SCENE}) does not place signal graph "mechanism-room"`,
    ]);
  });
});
