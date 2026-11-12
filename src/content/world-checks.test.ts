/* eslint-disable @typescript-eslint/no-non-null-assertion -- fixtures index content known to exist */
import { describe, expect, it } from 'vitest';
import type { LoadedEntry } from './loader.ts';
import { loadGameContent } from './game-content.ts';
import { checkWorld, classesWithRoute } from './world-checks.ts';
import { contentChecks } from './registry.ts';

const content = loadGameContent();
const others: LoadedEntry[] = (['scene', 'class', 'game', 'capability'] as const).flatMap((type) =>
  content.all(type).map((value) => ({ type, file: `${type}/${value.id}.json`, value })),
);
const real = content.all('world')[0]!;

/** The shipped map with one edge replaced (refs stay refs, as the checks expect). */
function check(edgeId: string, change: Record<string, unknown>) {
  const edges = real.edges.map((e) => (e.id === edgeId ? { ...e, ...change } : e));
  const world = { ...real, edges };
  return checkWorld([...others, { type: 'world', file: 'world/connectivity.json', value: world }]);
}

describe('world map load checks', () => {
  it('AC-1: pass on the shipped map, and are part of every content load', () => {
    expect(checkWorld([...others, { type: 'world', file: 'w', value: real }])).toEqual([]);
    expect(contentChecks).toContain(checkWorld);
  });

  it('derives the classes whose capabilities include a route', () => {
    const classes = [
      { id: 'thief', mvpCapabilities: ['tool.lockpick'] },
      { id: 'archer', mvpCapabilities: ['arrow.rope', 'tool.lockpick'] },
    ];
    expect(classesWithRoute(classes, ['tool.lockpick'])).toEqual(['archer', 'thief']);
    expect(classesWithRoute(classes, [])).toEqual([]);
  });

  it('AC-2: rejects a shortcut without an unlock', () => {
    const issues = check('glen-well-cistern', { unlock: undefined });
    expect(issues.map((i) => i.message)).toEqual([
      expect.stringContaining('needs an unlock condition'),
    ]);
  });

  it('rejects unknown capabilities, clock phases and wrong class hints', () => {
    expect(
      check('mine-gate-winch', { routes: ['spell.nope'] })
        .map((i) => i.message)
        .join('\n'),
    ).toContain('unknown capability "spell.nope"');
    expect(check('barge-quay-lock', { time: ['teatime'] })[0]!.message).toContain(
      'unknown clock phase "teatime"',
    );
    expect(check('jail-drain', { classesHint: ['knight'] })[0]!.message).toContain(
      'class files grant a route to [knight, thief]',
    );
  });

  it('rejects built transitions that do not exist or do not join the edge', () => {
    expect(check('marsh-door', { transitions: ['marsh-store/nowhere'] })[0]!.message).toContain(
      'no scene has',
    );
    expect(check('marsh-door', { transitions: ['valley-01/north-gate'] })[0]!.message).toContain(
      'leads scene "valley-01" to "valley-02"',
    );
  });
});
