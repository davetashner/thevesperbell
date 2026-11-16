// @vitest-environment happy-dom
// The shanghai glue (mw-e40.30): the crew-table loss wakes the player in the hold behind a narration
// window, and the Captain stands where the story needs him. The harbour end to end is
// tests/integration/shanghai-loop.test.ts.
import { describe, expect, it } from 'vitest';
import {
  ContestEnded,
  CreatureComponent,
  beginConversing,
  endConversing,
  installGameClock,
  gameClockOf,
  PlacementComponent,
  SceneSpawnComponent,
  SceneTransformComponent,
  World,
  type EntityId,
  type Vec3,
} from '@sim/index';
import { DEFAULT_CLOCK_CONFIG } from '@sim/gametime';
import { UiRoot } from '@ui/index';
import { find, rectFromData } from '@ui/testing/layout';
import {
  CAPTAIN_SPAWN,
  SHANGHAIED_FACT,
  SHANGHAI_CONTEST,
  SHANGHAI_PAGES,
  SHANGHAI_SCREEN,
  WAKE_HOURS,
  WAKE_SPAWN,
  WAKE_TOAST,
  startShanghaiUi,
} from './shanghai';

const QUAY: Vec3 = { x: 35, y: 0, z: 96 };
const DECK: Vec3 = { x: 35, y: 2, z: 124.5 };
const HOLD: Vec3 = { x: 33, y: -1.5, z: 122 };

interface Options {
  readonly spawns?: boolean;
  readonly captain?: 'leashed' | 'unleashed' | 'absent' | 'unplaced';
  readonly registered?: boolean;
  readonly clock?: boolean;
  readonly captainSpawn?: boolean;
}

function setup(options: Options = {}) {
  const world = new World<never>({ seed: 2 });
  world.register(CreatureComponent, PlacementComponent);
  if (options.registered !== false) world.register(SceneSpawnComponent, SceneTransformComponent);
  const spawn = (id: string, at: Vec3) => {
    if (options.registered === false) return;
    const e = world.spawn();
    world.add(e, SceneSpawnComponent, { id, tags: [] });
    world.add(e, SceneTransformComponent, {
      position: at,
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    });
  };
  if (options.spawns !== false) spawn(WAKE_SPAWN, HOLD);
  if (options.captainSpawn !== false) spawn(CAPTAIN_SPAWN, DECK);
  // A spawn with no transform is not a place.
  if (options.registered !== false) {
    const bare = world.spawn();
    world.add(bare, SceneSpawnComponent, { id: 'bare', tags: [] });
  }
  const player = world.spawn();
  let captain: EntityId | undefined;
  if (options.captain !== 'absent') {
    captain = world.spawn();
    world.add(captain, CreatureComponent, {
      origin: {
        creature: 'npc-hesketh',
        at: QUAY,
        facing: { x: 0, y: 0, z: 1 },
        ...(options.captain === 'unleashed' ? {} : { leash: { radius: 1.5, post: QUAY } }),
      },
      behaviour: 'shopkeeper',
      tuning: {},
      needs: {},
    });
    if (options.captain !== 'unplaced')
      world.add(captain, PlacementComponent, { ...QUAY, radius: 0.35 });
  }
  if (options.clock !== false) installGameClock(world, DEFAULT_CLOCK_CONFIG);
  const ui = new UiRoot(document.body, { unstyled: true, focus: { rectOf: rectFromData } });
  const toasts: string[] = [];
  const teleports: [EntityId, Vec3][] = [];
  const glue = startShanghaiUi({
    ui,
    world,
    player,
    teleport: (entity, to) => teleports.push([entity, to]),
    toast: (text) => toasts.push(text),
  });
  const lose = (outcome = 'lost', contest = SHANGHAI_CONTEST) => {
    world.events.emit(ContestEnded, {
      contest,
      outcome,
      placement: 2,
      score: 0,
      standings: [],
    } as never);
    world.step();
  };
  const post = () => world.get(captain ?? -1, CreatureComponent)?.origin.leash?.post;
  const at = () => world.get(captain ?? -1, PlacementComponent);
  return {
    world,
    ui,
    player,
    captain: captain ?? -1,
    toasts,
    teleports,
    glue,
    lose,
    post,
    at,
  };
}

describe('the shanghai glue (mw-e40.30)', () => {
  it('AC-1: a lost crew table with the fact set plays the narration, wakes the player in the hold, moves the clock and toasts on dismissal', () => {
    const t = setup();
    t.world.facts.set(SHANGHAIED_FACT, true);
    const before = gameClockOf(t.world)?.total() ?? 0;
    t.lose();
    t.glue.afterStep();
    expect(t.teleports).toEqual([[t.player, HOLD]]);
    expect((gameClockOf(t.world)?.total() ?? 0) - before).toBe(WAKE_HOURS * 60);
    expect(t.ui.top?.id).toBe(SHANGHAI_SCREEN);
    expect(find('[data-testid="epilogue-body"]').textContent).toBe(SHANGHAI_PAGES[0]?.text);
    expect(t.toasts).toEqual([]);
    t.glue.afterStep();
    expect(t.teleports).toHaveLength(1);
    t.ui.intent('back', 'keyboard');
    expect(t.ui.top).toBeUndefined();
    expect(t.toasts).toEqual([WAKE_TOAST]);
  });

  it('AC-2: an ordinary loss, a win or a lost crew table without the fact does nothing', () => {
    const t = setup();
    t.lose('lost', 'drowned-gull-dice');
    t.glue.afterStep();
    t.world.facts.set(SHANGHAIED_FACT, true);
    t.lose('won');
    t.glue.afterStep();
    t.world.facts.set(SHANGHAIED_FACT, false);
    t.lose();
    t.glue.afterStep();
    expect(t.teleports).toEqual([]);
    expect(t.ui.top).toBeUndefined();
  });

  it('AC-1: the wake waits for any open screen, and does nothing with no wake spawn or no clock', () => {
    const waiting = setup({ clock: false });
    waiting.world.facts.set(SHANGHAIED_FACT, true);
    const other = waiting.ui.push({
      id: 'other',
      label: 'Other',
      content: document.createElement('div'),
    });
    waiting.lose();
    waiting.glue.afterStep();
    expect(waiting.teleports).toEqual([]);
    other.close();
    waiting.glue.afterStep();
    expect(waiting.teleports).toHaveLength(1);

    const none = setup({ spawns: false });
    none.world.facts.set(SHANGHAIED_FACT, true);
    none.lose();
    none.glue.afterStep();
    expect(none.teleports).toEqual([]);
    expect(none.ui.top).toBeUndefined();
  });

  it('AC-3: Hesketh stands on deck while the fact is set, waits out a conversation, and goes back to the quay', () => {
    const t = setup();
    t.glue.afterStep();
    expect(t.post()).toEqual(QUAY);
    t.world.facts.set(SHANGHAIED_FACT, true);
    t.glue.afterStep();
    expect(t.post()).toEqual(DECK);
    expect(t.at()).toMatchObject(DECK);
    t.glue.afterStep();
    expect(t.post()).toEqual(DECK);
    t.world.facts.set(SHANGHAIED_FACT, false);
    beginConversing(t.world, t.captain, t.player, { x: 0, z: 1 });
    t.glue.afterStep();
    expect(t.post()).toEqual(DECK);
    endConversing(t.world, t.captain);
    t.glue.afterStep();
    expect(t.post()).toEqual(QUAY);
    expect(t.at()).toMatchObject(QUAY);
  });

  it('AC-3: no Captain, no leash or no deck post: nothing moves', () => {
    for (const captain of ['absent', 'unleashed'] as const) {
      const t = setup({ captain });
      t.world.facts.set(SHANGHAIED_FACT, true);
      t.glue.afterStep();
      expect(captain === 'absent' || t.at()?.z === QUAY.z).toBe(true);
    }
    const unplaced = setup({ captain: 'unplaced' });
    unplaced.world.facts.set(SHANGHAIED_FACT, true);
    unplaced.glue.afterStep();
    expect(unplaced.at()).toMatchObject({ ...DECK, radius: 0 });
    const nowhere = setup({ registered: false });
    nowhere.world.facts.set(SHANGHAIED_FACT, true);
    nowhere.lose();
    nowhere.glue.afterStep();
    expect(nowhere.teleports).toEqual([]);
    expect(nowhere.post()).toEqual(QUAY);
    const t = setup({ captainSpawn: false });
    t.world.facts.set(SHANGHAIED_FACT, true);
    t.glue.afterStep();
    expect(t.post()).toEqual(QUAY);
    expect(WAKE_TOAST).toMatch(/Hesketh/);
  });
});
