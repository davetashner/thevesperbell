// mw-opf6: every shipped contest can be started by a player in the game. A contest is entered through
// a dialogue `emit` the controller maps to it (Oona's armwrestle.requested) or a scene spawn tagged
// `contest:<id>` with an affordance (the Drowned Gull's dice table), and each contest scores events
// the play input or the sim reports.
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import { CONTEST_REQUESTS, CONTEST_TAG, gameOf } from '@game/contest/controller';
import { contestsIn } from '@game/contest/install';

const content = loadGameContent();
const contests = contestsIn(content);

const spawnTags = content
  .all('scene')
  .flatMap((scene) => scene.spawns.map((spawn) => ({ scene: scene.id, spawn })))
  .flatMap(({ scene, spawn }) =>
    spawn.tags
      .filter((tag) => tag.startsWith(CONTEST_TAG))
      .map((tag) => ({ scene, spawn, contest: tag.slice(CONTEST_TAG.length) })),
  );

const emittedBy = (event: string): boolean =>
  content
    .all('dialogue')
    .some((d) =>
      JSON.stringify(d).includes(`"event":"${event}"`.replace('"event":"', '"event":"')),
    );

describe('contest entry points', () => {
  it('AC-4: every shipped contest has an entry point a player can reach', () => {
    for (const contest of contests) {
      const byRequest = Object.entries(CONTEST_REQUESTS).some(
        ([event, id]) => id === contest.id && emittedBy(event),
      );
      const byTable = spawnTags.some(
        (t) => t.contest === contest.id && (t.spawn.interact?.affordances.length ?? 0) > 0,
      );
      expect(byRequest || byTable, `${contest.id} cannot be started`).toBe(true);
    }
  });

  it('AC-4: the dice table in the Drowned Gull starts the dice game', () => {
    const table = spawnTags.find((t) => t.contest === 'drowned-gull-dice');
    expect(table?.scene).toBe('wendmouth-harbour');
    expect(table?.spawn.id).toBe('dice-table');
    expect(table?.spawn.interact?.affordances[0]?.label).toBe('Play dice');
  });

  it("AC-4: Oona's dialogue asks for the arm-wrestling contest", () => {
    expect(CONTEST_REQUESTS['armwrestle.requested']).toBe('drowned-gull-arm-wrestling');
    expect(emittedBy('armwrestle.requested')).toBe(true);
  });

  it('AC-1: every contest is playable: the game plays it or the sim scores it', () => {
    for (const contest of contests) {
      expect(gameOf(contest) !== 'none' || contest.cheats.length > 0, contest.id).toBe(true);
    }
  });
});
