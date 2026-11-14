// mw-e24.13: Briar Glen's people keep daily schedules. A schedule is a creature's scene spawns, each
// with a `presence.hours` window of the world clock (the spawn is where the person is for those
// hours; a person who is somewhere with no scene, upstairs or at home, has no spawn then). Scenes
// load with the people scheduled for the hour they load at (AC-2: no off-screen catch-up engine);
// `watchPresence` moves them as the clock's minute changes while the player is there, and not while
// they talk (AC-3). Shop hours are the merchant's hours: the counter and its keeper share them.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import { markExercised } from '@content/testing';
import {
  beginConversing,
  CreatureComponent,
  endConversing,
  InteractableComponent,
  MINUTE_FACT,
  PlacementComponent,
  presentIn,
  SceneSpawnComponent,
  type World,
} from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';

const content = loadGameContent();
const BRIAR_GLEN = ['briar-glen-lane', 'briar-glen-green', 'sleeping-ox', 'marsh-store'] as const;
const hm = (h: number, m = 0): number => h * 60 + m;

/** Every spawn of the Briar Glen scenes that a schedule places, with its scene. */
function scheduled() {
  return BRIAR_GLEN.flatMap((scene) =>
    content
      .get('scene', scene)
      .spawns.filter((s) => s.presence?.hours !== undefined)
      .map((s) => ({ scene, ...s })),
  );
}

/** The person a spawn schedules (its `schedule:<person>` tag), if any. */
const personOf = (tags: readonly string[]): string | undefined =>
  tags.find((t) => t.startsWith('schedule:'))?.slice('schedule:'.length);

function load(scene: string, minute: number) {
  const game = createGameWorld<unknown>(RAPIER, { seed: 1, hz: 60, scene, minute });
  const world = game.world as unknown as World<never>;
  const points = (): string[] =>
    world
      .query(CreatureComponent)
      .ids()
      .map((e) => world.get(e, CreatureComponent)?.origin.point ?? '')
      .sort();
  return { game, world, points };
}

describe('Briar Glen schedules, as data (mw-e24.13)', () => {
  it('AC-1: Mirela keeps the Stacks counter at 08:00, sits up late at 22:00 and is upstairs at 03:00', ({
    task,
  }) => {
    markExercised(task, 'creature', 'npc-mirela');
    markExercised(task, 'scene', 'briar-glen-green');
    const at = (minute: number) =>
      load('briar-glen-green', minute)
        .points()
        .filter((p) => p.startsWith('npc-mirela'));
    expect(at(hm(8))).toEqual(['npc-mirela']);
    // Past closing she sits up in the Stacks: the Bookshop Burglar stakeout (22:00 to 04:00) and
    // Hale's sleepwalk (23:00 to 04:00) are played by talking to them (mw-e39.10).
    expect(at(hm(22))).toEqual(['npc-mirela-late']);
    expect(at(hm(3))).toEqual([]);
    expect(at(hm(6))).toEqual(['npc-mirela']);
  });

  it('AC-1: every scheduled person is in one place at a time, whatever the hour', () => {
    const spawns = scheduled();
    const people = new Set(spawns.flatMap((s) => personOf(s.tags) ?? []));
    expect(people.size).toBeGreaterThanOrEqual(8 + 6);
    for (let minute = 0; minute < 24 * 60; minute += 15) {
      const where = new Map<string, string[]>();
      for (const s of spawns) {
        const person = personOf(s.tags);
        if (person === undefined) continue;
        if (!presentIn(s as never, undefined, minute / 60)) continue;
        where.set(person, [...(where.get(person) ?? []), `${s.scene}:${s.id}`]);
      }
      for (const [person, places] of where) {
        expect(places, `${person} at ${String(minute / 60)}h`).toHaveLength(1);
      }
    }
  });

  it('AC-1: every scheduled spawn names its person, or is a shop counter on merchant hours', () => {
    for (const s of scheduled()) {
      const counter = s.tags.some((t) => t.startsWith('merchant:'));
      expect(personOf(s.tags) !== undefined || counter, s.id).toBe(true);
    }
  });

  it('shop hours are the merchant hours: the counter and its keeper share them', ({ task }) => {
    const shops = [
      ['briar-glen-lane', 'brand-forge', 'brand-forge-counter', 'npc-oswin'],
      [
        'briar-glen-lane',
        'fenn-fletchery-simples',
        'fenn-fletchery-simples-counter',
        'npc-juniper',
      ],
      ['briar-glen-lane', 'pell-bakery', 'pell-bakery-counter', 'npc-hollis'],
      ['marsh-store', 'marsh-general-store', 'shop-counter', 'npc-ottilie'],
    ] as const;
    for (const [scene, merchant, counter, keeper] of shops) {
      markExercised(task, 'merchant', merchant);
      const { hours } = content.get('merchant', merchant);
      expect(hours, merchant).toBeDefined();
      const spawns = content.get('scene', scene).spawns;
      const window = [hours?.open, hours?.close];
      expect(spawns.find((s) => s.id === counter)?.presence?.hours, counter).toEqual(window);
      expect(spawns.find((s) => s.id === keeper)?.presence?.hours, keeper).toEqual(window);
    }
  });

  it('every merchant with hours that has a counter in Briar Glen is bound to them', () => {
    for (const scene of BRIAR_GLEN) {
      for (const s of content.get('scene', scene).spawns) {
        const merchant = s.tags.find((t) => t.startsWith('merchant:'))?.slice('merchant:'.length);
        if (merchant === undefined) continue;
        const { hours } = content.get('merchant', merchant);
        expect(s.presence?.hours, `${scene}:${s.id}`).toEqual(
          hours === undefined ? undefined : [hours.open, hours.close],
        );
      }
    }
  });

  it('AC-1: there are 10 generic townsfolk, each with a schedule that puts them in the market at midday', ({
    task,
  }) => {
    const generic = scheduled().filter((s) => s.tags.includes('townsfolk'));
    const people = new Set(generic.flatMap((s) => personOf(s.tags) ?? []));
    expect(people.size).toBe(10);
    for (const kind of ['carter', 'weaver', 'miner', 'neighbour']) {
      markExercised(task, 'creature', `npc-townsfolk-${kind}`);
    }
    for (const person of people) {
      const market = generic.find((s) => personOf(s.tags) === person && s.id.endsWith('-market'));
      expect(market?.presence?.hours, person).toEqual([11, 15]);
    }
  });
});

describe('Briar Glen schedules, loaded (mw-e24.13)', () => {
  it('the game opens at 06:00 with the lane as it was: three keepers and the day watch', ({
    task,
  }) => {
    markExercised(task, 'scene', 'briar-glen-lane');
    const t = load('briar-glen-lane', hm(6));
    expect(t.points()).toEqual([
      'npc-hollis',
      'npc-juniper',
      'npc-oswin',
      'npc-watchman-day-1',
      'npc-watchman-day-2',
    ]);
  });

  it('AC-2: entering town at 14:00 places everyone where their schedule has them', ({ task }) => {
    markExercised(task, 'scene', 'briar-glen-green');
    const green = load('briar-glen-green', hm(14));
    const expected = scheduled()
      .filter((x) => x.scene === 'briar-glen-green' && presentIn(x as never, undefined, 14))
      .map((x) => x.id);
    expect(green.points()).toEqual([...expected].sort());
    expect(green.points().filter((p) => p.endsWith('-market'))).toHaveLength(10);
    // AC-4 (headcount): all ten townsfolk with Vane, Mirela and Hale at Market Green at midday; the
    // frame-time measure is the perf suite's.
    expect(green.points()).toHaveLength(13);
    const lane = load('briar-glen-lane', hm(14));
    expect(lane.points()).toEqual([
      'npc-hollis',
      'npc-juniper',
      'npc-oswin',
      'npc-watchman-day-1',
      'npc-watchman-day-2',
    ]);
  });

  it('AC-2: after closing the keepers are elsewhere: Oswin at the Ox, Juniper at the well, Ottilie upstairs', ({
    task,
  }) => {
    markExercised(task, 'scene', 'sleeping-ox');
    markExercised(task, 'scene', 'marsh-store');
    const lane = load('briar-glen-lane', hm(20, 30));
    expect(lane.points()).not.toContain('npc-oswin');
    expect(lane.points()).not.toContain('npc-juniper');
    expect(load('sleeping-ox', hm(21)).points()).toContain('npc-oswin-evening');
    expect(load('sleeping-ox', hm(21)).points()).toContain('npc-dot');
    expect(load('briar-glen-lane', hm(19, 30)).points()).not.toContain('npc-juniper');
    expect(load('briar-glen-green', hm(20)).points()).toContain('npc-juniper-evening');
    const shop = load('marsh-store', hm(22));
    expect(shop.points()).toEqual(['npc-ottilie-upstairs']);
    const upstairs = shop.world
      .query(CreatureComponent)
      .ids()
      .map((e) => shop.world.get(e, PlacementComponent)?.y);
    expect(upstairs).toEqual([3.5]);
  });

  it('Hale stands his post by day and walks the night watch from 23:00', ({ task }) => {
    markExercised(task, 'creature', 'npc-hale');
    const pointsAt = (m: number) =>
      load('briar-glen-green', m)
        .points()
        .filter((p) => p.startsWith('npc-hale'));
    expect(pointsAt(hm(12))).toEqual(['npc-hale']);
    expect(pointsAt(hm(22, 59))).toEqual(['npc-hale']);
    expect(pointsAt(hm(23))).toEqual(['npc-hale-night']);
    expect(pointsAt(hm(5))).toEqual([]);
  });

  it('the shop closes with its keeper: the counter does not answer outside merchant hours', ({
    task,
  }) => {
    markExercised(task, 'merchant', 'brand-forge');
    const answers = (minute: number): boolean => {
      const t = load('briar-glen-lane', minute);
      const counter = t.world
        .query(SceneSpawnComponent)
        .ids()
        .find((e) => t.world.get(e, SceneSpawnComponent)?.id === 'brand-forge-counter');
      return counter !== undefined && t.world.has(counter, InteractableComponent);
    };
    expect(answers(hm(7))).toBe(true);
    expect(answers(hm(19, 59))).toBe(true);
    expect(answers(hm(20))).toBe(false);
    expect(answers(hm(3))).toBe(false);
  });

  it('AC-3: a keeper in conversation when the window ends stays, then goes when it is over', ({
    task,
  }) => {
    markExercised(task, 'creature', 'npc-oswin');
    const t = load('briar-glen-lane', hm(19, 30));
    const oswin = () =>
      t.world
        .query(CreatureComponent)
        .ids()
        .find((e) => t.world.get(e, CreatureComponent)?.origin.point === 'npc-oswin');
    const player = t.game.player;
    const keeper = oswin();
    expect(keeper).toBeDefined();
    beginConversing(t.world, keeper as never, player);
    t.world.facts.set(MINUTE_FACT, hm(20, 5));
    t.game.world.step();
    expect(oswin()).toBe(keeper);
    expect(endConversing(t.world, keeper as never)).toBe(true);
    t.world.facts.set(MINUTE_FACT, hm(20, 6));
    t.game.world.step();
    expect(oswin()).toBeUndefined();
  });

  it('AC-2: a keeper arrives when the clock reaches opening time while the player is there', () => {
    const t = load('briar-glen-lane', hm(4));
    expect(t.points()).not.toContain('npc-hollis');
    t.world.facts.set(MINUTE_FACT, hm(5));
    t.game.world.step();
    expect(t.points()).toContain('npc-hollis');
    expect(t.points()).not.toContain('npc-oswin');
    t.world.facts.set(MINUTE_FACT, hm(6));
    t.game.world.step();
    expect(t.points()).toContain('npc-oswin');
  });
});

describe('schedules never disturb what has no schedule', () => {
  it('a world with no clock puts everyone in their first place (headless tools)', () => {
    const game = createGameWorld<unknown>(RAPIER, { seed: 1, hz: 60, scene: 'briar-glen-lane' });
    const world = game.world as unknown as World<never>;
    const points = world
      .query(CreatureComponent)
      .ids()
      .map((e) => world.get(e, CreatureComponent)?.origin.point);
    expect(points).toContain('npc-oswin');
    expect(points).toContain('townsfolk-1-morning');
  });
});
