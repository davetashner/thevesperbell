// mw-e11.7: the six-state alert machine on behaviour content. The alert thresholds are one set
// (content's built-in alert tuning equals awareness's bands); every shipped and fixture behaviour's
// table survives the AC-6 fuzz; and the frozen fixture guard, shot in the back by an archer it never
// saw, is Alerted (not in Combat), hunts toward where the arrow came from, searches there, and after
// the search timeout stands down to Unaware still on edge.
import { describe, expect, it } from 'vitest';
import {
  ALERT_STATES,
  ALERT_TUNING_DEFAULTS,
  compileCreatures,
  type Frozen,
  type BehaviourDef,
} from '@content/index';
import { loadGameContent } from '@content/game-content';
import { loadFixtureContent } from '@content/test-fixtures';
import { markExercised } from '@content/testing';
import {
  alertMoves,
  AlertStateChanged,
  brainOf,
  buildFactionTable,
  compileBehaviour,
  compileBehaviours,
  DamageModel,
  DEFAULT_AWARENESS_TUNING,
  factionSpecFromDef,
  fuzzAlertMachine,
  installAi,
  installAlertTriggers,
  installFactions,
  isPostAlert,
  registerCreatureComponents,
  spawnCreature,
  World,
  type AlertStateChange,
  type Brain,
} from '@sim/index';

const fixtures = loadFixtureContent();
const game = loadGameContent();

describe('the alert machine on content (mw-e11.7)', () => {
  it('one set of alert thresholds: the built-in alert tuning equals the awareness bands', () => {
    expect(ALERT_TUNING_DEFAULTS['suspiciousAt']).toBe(
      DEFAULT_AWARENESS_TUNING.thresholds.suspicious,
    );
    expect(ALERT_TUNING_DEFAULTS['investigateAt']).toBe(
      DEFAULT_AWARENESS_TUNING.thresholds.investigating,
    );
  });

  const behaviours: [string, Frozen<BehaviourDef>][] = [
    ['fixture-guard', fixtures.get('behaviour', 'fixture-guard')],
    ...game.all('behaviour').map((b): [string, Frozen<BehaviourDef>] => [b.id, b]),
  ];
  for (const [id, def] of behaviours) {
    it(`AC-6: ${id}: 10,000 random event sequences take only moves in its table, in its states`, ({
      task,
    }) => {
      markExercised(task, 'behaviour', id);
      const report = fuzzAlertMachine(compileBehaviours([def]), id, {
        sequences: 10_000,
        steps: 8,
        seed: 5,
      });
      const table = alertMoves(compileBehaviour(def));
      expect([...report.taken.keys()].filter((move) => !table.has(move))).toEqual([]);
      expect(report.taken.size).toBeGreaterThan(table.size / 2);
      for (const state of report.states) {
        expect(ALERT_STATES).toContain(state);
        expect(Object.keys(def.states)).toContain(state);
      }
    }, 30_000); // 10,000 fuzz sequences per behaviour; overran the 5 s default on loaded CI runners
  }

  it('AC-5: the fixture guard shot in the back by an unseen archer is Alerted, hunts toward the shot, searches and stands down on edge', ({
    task,
  }) => {
    markExercised(task, 'behaviour', 'fixture-guard');
    markExercised(task, 'creature', 'fixture-guard');
    const world = installFactions(registerCreatureComponents(new World<never>({ seed: 4 })));
    installAi(world, { behaviours: compileBehaviours(fixtures.all('behaviour')) });
    installAlertTriggers(world);
    const spawned = spawnCreature(
      world,
      {
        creatures: compileCreatures(fixtures.all('creature'), fixtures),
        factions: buildFactionTable(fixtures.all('faction').map(factionSpecFromDef)),
      },
      { creature: 'fixture-guard', at: { x: 0, y: 0, z: 0 } },
    );
    if (!spawned.ok) throw new Error('the guard did not spawn');
    const guard = spawned.entity;
    const archer = world.spawn();
    const changes: AlertStateChange[] = [];
    world.events.on(AlertStateChanged, (c) => changes.push(c));
    world.step();
    const brain = (): Readonly<Brain> => {
      const b = brainOf(world, guard);
      if (b === undefined) throw new Error('the guard has no brain');
      return b;
    };

    // An arrow flying +z hits it from behind; the archer stands 30 m back, unseen.
    new DamageModel().apply(world, guard, {
      amounts: { pierce: 5 },
      instigator: archer,
      direction: { x: 0, y: 0, z: 1 },
    });
    for (let i = 0; i < 6; i++) world.step();
    expect(brain().state).toBe('alerted');
    expect(brain().blackboard.lkp).toEqual({ x: 0, y: 0, z: -8 });

    for (let i = 0; i < 70 * 60 && brain().state !== 'unaware'; i++) world.step();
    expect(changes.map((c) => `${c.from}>${c.to} (${c.cause})`)).toEqual([
      'unaware>alerted (event:damaged-by-unseen)',
      'alerted>searching (done:hunt)',
      'searching>unaware (timeout)',
    ]);
    expect(changes.some((c) => c.to === 'combat')).toBe(false);
    const searched = changes[1]?.tick ?? 0;
    expect((changes[2]?.tick ?? 0) - searched).toBeGreaterThanOrEqual(60 * 60);
    expect(isPostAlert(brain(), world.tick)).toBe(true);
    expect(brain().postAlertRate).toBe(1.5);
  });
});
