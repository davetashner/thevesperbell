// @vitest-environment happy-dom
// The contest screens and play input (mw-opf6): entry through Oona's dialogue request and the dice
// table, the fee, the odds and the throw-the-match offer on the entry window, the arm-wrestling and
// dice keys, a caught or unseen cheat, walking away, the clock, and resuming a contest in progress.
import { beforeEach, describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import type { ContestEntry } from '@content/types/contest';
import {
  ContestEnded,
  entitySource,
  interacted,
  MemoryLogicHost,
  perceived,
  SceneSpawnComponent,
  SpellCast,
  World,
  type EntityId,
  type Vec3,
} from '@sim/index';
import { UiRoot } from '@ui/index';
import { rectFromData } from '@ui/testing/layout';
import { logicEmitted } from '../logic/host';
import {
  CHEAT_KEY,
  CONTEST_REFUSALS,
  CONTEST_TAG,
  ContestController,
  gameOf,
  LEAVE_KEY,
  npcName,
  PRESSES_PER_PUSH,
  PUSH_KEY,
  WALK_AWAY_METRES,
} from './controller';
import { contestsIn, installContests } from './install';

const ARM = 'drowned-gull-arm-wrestling';
const DICE = 'drowned-gull-dice';
const content = loadGameContent();
const defs = contestsIn(content);
const nell = 50 as EntityId;

function el(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector);
  if (found === null) throw new Error(`no element ${selector}`);
  return found;
}

function def(id: string): ContestEntry {
  const found = defs.find((d) => d.id === id);
  if (found === undefined) throw new Error(`no contest ${id}`);
  return found;
}

function setup(options: { gold?: number; position?: () => Vec3 } = {}) {
  document.body.innerHTML = '';
  const world = new World<never>({ seed: 7 });
  world.register(SceneSpawnComponent);
  const host = new MemoryLogicHost({ gold: options.gold ?? 30 });
  const player = world.spawn();
  const installed = installContests(world, {
    contests: defs,
    host,
    player: () => player,
    resolve: (creature) => (creature === 'npc-nell' ? nell : undefined),
  });
  const ui = new UiRoot(document.body, { unstyled: true, focus: { rectOf: rectFromData } });
  const toasts: string[] = [];
  const published: string[] = [];
  const controller = new ContestController({
    ui,
    world,
    player,
    runner: installed.runner,
    contests: defs,
    host,
    toast: (text) => toasts.push(text),
    publish: (_key, value) => published.push(value),
    ...(options.position !== undefined && { positionOf: options.position }),
  });
  const press = (code: string, repeat = false): boolean => controller.keydown({ code, repeat });
  const click = (selector: string): void => {
    el(selector).click();
  };
  const step = (ticks: number): void => {
    for (let i = 0; i < ticks; i++) {
      world.step();
      installed.update();
      controller.afterStep();
    }
    world.events.flush();
  };
  const watch = (): void => {
    world.events.emit(perceived, {
      tick: world.tick,
      agent: nell,
      seconds: 0.2,
      percepts: [
        {
          source: entitySource(player),
          kind: 'seen-target',
          sense: 'sight',
          position: { x: 0, y: 0, z: 0 },
          strength: 1,
          certainty: 1,
        },
      ],
    });
    world.events.flush();
  };
  const interact = (tags: string[]): void => {
    const target = world.spawn();
    world.add(target, SceneSpawnComponent, { id: 'table', tags });
    world.events.emit(interacted, { actor: player, target, verb: 'use', affordance: 0 });
    world.events.flush();
    controller.afterStep();
  };
  return {
    world,
    host,
    player,
    installed,
    ui,
    toasts,
    published,
    controller,
    press,
    click,
    step,
    watch,
    interact,
  };
}

const ask = (t: ReturnType<typeof setup>): void => {
  t.world.events.emit(logicEmitted, { event: 'armwrestle.requested', data: {} });
  t.world.events.flush();
  t.controller.afterStep();
};

describe('the entry window (mw-opf6)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it("AC-4: Oona's request opens the window with the fee, the 2:1 odds and Nell's offer", () => {
    const t = setup();
    ask(t);
    expect(t.controller.isOpen).toBe(true);
    expect(document.querySelector('[data-testid=contest-fee]')?.textContent).toContain(
      'Entry fee: 2',
    );
    expect(document.querySelector('[data-choice=onPlayer]')?.textContent).toBe(
      'Nell pays 2:1 on you',
    );
    expect(document.querySelector('[data-choice=throw]')?.textContent).toContain(
      'Nell offers 15 crowns to throw the match',
    );
    expect(document.querySelector('[data-testid=contest-window]')?.textContent).toContain(
      'Against Big Oona. First to 5.',
    );
  });

  it('AC-4: the dice table opens the dice window (no book: no bet rows)', () => {
    const t = setup();
    t.interact([`${CONTEST_TAG}${DICE}`]);
    expect(t.controller.isOpen).toBe(true);
    expect(document.querySelector('[data-choice=onPlayer]')).toBeNull();
    expect(document.querySelector('[data-choice=throw]')).toBeNull();
    expect(document.querySelector('[data-testid=contest-fee]')?.textContent).toContain(
      'Entry fee: 1',
    );
  });

  it('AC-4: a request waits for the conversation to close, and other interactions are ignored', () => {
    const t = setup();
    const blocker = t.ui.push({
      id: 'dialogue',
      label: 'Talk',
      content: document.createElement('div'),
    });
    ask(t);
    expect(t.controller.isOpen).toBe(false);
    t.interact(['counter']);
    blocker.close();
    t.controller.afterStep();
    expect(t.controller.isOpen).toBe(true);
    t.world.events.emit(logicEmitted, { event: 'something.else', data: {} });
    t.world.events.flush();
    // an actor other than the player does nothing
    const other = t.world.spawn();
    const table = t.world.spawn();
    t.world.add(table, SceneSpawnComponent, { id: 't', tags: [`${CONTEST_TAG}${DICE}`] });
    t.world.events.emit(interacted, { actor: other, target: table, verb: 'use', affordance: 0 });
    t.world.events.flush();
    expect(t.controller.start('no-such-contest')).toBe(false);
    expect(t.controller.start(ARM)).toBe(false); // a window is already open
  });

  it('AC-4: a player who cannot pay the fee is told so and no window opens', () => {
    const t = setup({ gold: 1 });
    ask(t);
    expect(t.controller.isOpen).toBe(false);
    expect(t.toasts).toEqual([CONTEST_REFUSALS['cannot-afford']]);
  });

  it('AC-4: a stake the purse cannot cover with the fee keeps the window open and says why', () => {
    const t = setup({ gold: 5 });
    ask(t);
    t.click('[data-step=more]');
    t.click('[data-step=more]');
    t.click('[data-step=more]');
    t.click('[data-action=enter]');
    expect(t.controller.isOpen).toBe(true);
    expect(document.querySelector('[data-testid=contest-status]')?.textContent).toContain(
      'cannot cover the entry fee and that stake',
    );
    expect(t.host.gold()).toBe(5);
    expect(t.installed.runner.isActive(ARM)).toBe(false);
  });

  it('walking away from the window closes it without paying', () => {
    const t = setup();
    ask(t);
    t.click('[data-action=leave]');
    expect(t.controller.isOpen).toBe(false);
    expect(t.host.gold()).toBe(30);
    ask(t);
    t.controller.close();
    expect(t.controller.window).toBeUndefined();
  });

  it('a refused entry (the player is already in) is reported on the window', () => {
    const t = setup();
    ask(t);
    t.installed.runner.enter(ARM, 0);
    t.click('[data-action=enter]');
    expect(document.querySelector('[data-testid=contest-status]')?.textContent).toBe(
      CONTEST_REFUSALS['already-active'],
    );
  });
});

describe('arm-wrestling at the table (mw-opf6)', () => {
  it('AC-1: backing yourself, then pushing five times wins the prize and the bet at 2:1', () => {
    const t = setup();
    ask(t);
    t.click('[data-step=more]'); // stake 2
    t.click('[data-action=enter]');
    expect(t.host.gold()).toBe(30 - 2 - 2);
    expect(t.controller.playing).toBe(ARM);
    expect(document.querySelector('[data-testid=contest-hud]')?.hasAttribute('hidden')).toBe(false);
    expect(document.querySelector('[data-testid=contest-hints]')?.textContent).toContain('F: push');
    for (let push = 0; push < 5; push++) {
      for (let i = 0; i < PRESSES_PER_PUSH; i++) expect(t.press(PUSH_KEY)).toBe(true);
    }
    t.step(1);
    expect(t.installed.runner.result(ARM)).toBe('won');
    expect(t.host.gold()).toBe(30 - 2 - 2 + 10 + 6);
    expect(t.controller.playing).toBeUndefined();
    expect(t.toasts.at(-1)).toBe('You won the contest.');
    expect(JSON.parse(t.published.at(-1) ?? '{}')).toMatchObject({
      playing: null,
      last: `${ARM}:won`,
    });
  });

  it('AC-1: the meter fills a press at a time and held keys do not repeat', () => {
    const t = setup();
    ask(t);
    t.click('[data-action=enter]');
    t.press(PUSH_KEY);
    expect(document.querySelector('[data-testid=contest-message]')?.textContent).toContain(
      'strain',
    );
    expect(t.press(PUSH_KEY, true)).toBe(true);
    expect((el('[data-testid=contest-meter]') as HTMLProgressElement).value).toBe(
      1 / PRESSES_PER_PUSH,
    );
    expect(t.press(CHEAT_KEY)).toBe(false); // no loaded die at this table
    expect(t.press('KeyQ')).toBe(false);
  });

  it("AC-1: Oona's own pace beats a player who stops pushing", () => {
    const t = setup();
    ask(t);
    t.click('[data-action=enter]');
    t.step(5 * 90 + 1);
    expect(t.installed.runner.result(ARM)).toBe('lost');
    expect(t.toasts.at(-1)).toContain('You lost the contest, placing second.');
    expect(t.press(PUSH_KEY)).toBe(false);
  });

  it("AC-3: taking Nell's offer and walking away is a clean loss that pays 15", () => {
    const t = setup();
    ask(t);
    t.click('[data-choice=throw]');
    t.click('[data-action=enter]');
    expect(t.press(LEAVE_KEY, true)).toBe(true); // a held key does nothing
    expect(t.installed.runner.isActive(ARM)).toBe(true);
    expect(t.press(LEAVE_KEY)).toBe(true);
    expect(t.installed.runner.result(ARM)).toBe('forfeit');
    expect(t.host.gold()).toBe(30 - 2 + 15);
    t.world.events.flush();
    expect(t.toasts.at(-1)).toBe('You walked away from the contest.');
  });

  it('AC-2: casting at the table while Nell is watching disqualifies you', () => {
    const t = setup();
    ask(t);
    t.click('[data-action=enter]');
    t.step(3);
    t.watch();
    t.world.events.emit(SpellCast, {
      tick: t.world.tick,
      caster: t.player,
      spell: 'frost-bolt',
      source: 'wand',
      delivery: 99 as EntityId,
      deliveryKind: 'bolt',
    } as never);
    t.world.events.flush();
    expect(t.installed.runner.result(ARM)).toBe('disqualified');
    expect(t.host.disposition('npc-nell')).toBe(-3);
    t.step(1);
    expect(t.toasts.at(-1)).toBe('You were caught cheating and are out.');
  });

  it("AC-2: someone else's cast, or one nobody saw, does not disqualify", () => {
    const t = setup();
    ask(t);
    t.click('[data-action=enter]');
    const cast = (caster: EntityId): void => {
      t.world.events.emit(SpellCast, {
        tick: t.world.tick,
        caster,
        spell: 'frost-bolt',
        source: 'wand',
        delivery: 99 as EntityId,
        deliveryKind: 'bolt',
      } as never);
      t.world.events.flush();
    };
    cast(77);
    cast(t.player); // nobody watching
    expect(t.installed.runner.isActive(ARM)).toBe(true);
    expect(t.installed.runner.standings(ARM).find((s) => s.id === 'player')?.score).toBe(2);
  });

  it('AC-1: walking more than the allowed distance from the table forfeits', () => {
    let x = 0;
    const t = setup({ position: () => ({ x, y: 0, z: 0 }) });
    ask(t);
    t.click('[data-action=enter]');
    t.step(1); // sets nothing: the anchor was taken when the contest began
    x = WALK_AWAY_METRES - 1;
    t.step(1);
    expect(t.installed.runner.isActive(ARM)).toBe(true);
    x = WALK_AWAY_METRES + 1;
    t.step(1);
    expect(t.installed.runner.result(ARM)).toBe('forfeit');
  });
});

describe('dice at the table (mw-opf6)', () => {
  it('AC-1: rolling against the house wins rounds until the match is won', () => {
    const t = setup();
    t.interact([`${CONTEST_TAG}${DICE}`]);
    t.click('[data-action=enter]');
    expect(t.host.gold()).toBe(29);
    let presses = 0;
    while (t.installed.runner.isActive(DICE) && presses < 300) {
      t.press(PUSH_KEY);
      presses++;
    }
    expect(t.installed.runner.result(DICE)).toBe('won');
    expect(t.host.gold()).toBe(29 + 5);
    expect(document.querySelector('[data-testid=contest-hud]')?.hasAttribute('hidden')).toBe(true);
  });

  it('AC-1: a roll says how it fell (win, loss and tie all happen)', () => {
    const t = setup();
    t.interact([`${CONTEST_TAG}${DICE}`]);
    t.click('[data-action=enter]');
    const lines = new Set<string>();
    for (let i = 0; i < 40 && t.installed.runner.isActive(DICE); i++) {
      t.step(1);
      t.press(PUSH_KEY);
      const line = document.querySelector('[data-testid=contest-message]')?.textContent ?? '';
      lines.add(line.replace(/\d/g, '#'));
      if (t.installed.runner.standings(DICE).some((s) => s.score >= 2)) break;
    }
    expect([...lines].some((l) => l.includes('take the round'))).toBe(true);
    expect([...lines].some((l) => l.includes('theirs') || l.includes('tie'))).toBe(true);
  });

  it('AC-2: a loaded die that Nell sees disqualifies you', () => {
    const t = setup();
    t.interact([`${CONTEST_TAG}${DICE}`]);
    t.click('[data-action=enter]');
    expect(document.querySelector('[data-testid=contest-hints]')?.textContent).toContain(
      'H: loaded die',
    );
    t.step(2);
    t.watch();
    expect(t.press(CHEAT_KEY)).toBe(true);
    expect(t.installed.runner.result(DICE)).toBe('disqualified');
    expect(t.host.disposition('npc-nell')).toBe(-2);
  });

  it('AC-2: a loaded die nobody saw is worth a point and costs a grudge at the end', () => {
    const t = setup();
    t.interact([`${CONTEST_TAG}${DICE}`]);
    t.click('[data-action=enter]');
    t.press(CHEAT_KEY);
    expect(t.installed.runner.standings(DICE).find((s) => s.id === 'player')?.score).toBe(1);
    t.press(LEAVE_KEY);
    expect(t.host.disposition('npc-nell')).toBe(1 - 1); // the loss warms Nell (+1), the die cools her (-1)
  });
});

describe('contests in progress (mw-opf6)', () => {
  it('AC-3: a contest already running when the controller starts is picked up and shown', () => {
    const first = setup();
    first.installed.runner.enter(ARM, 0);
    const second = new ContestController({
      ui: first.ui,
      world: first.world,
      player: first.player,
      runner: first.installed.runner,
      contests: defs,
      host: first.host,
      publish: () => undefined,
    });
    expect(second.playing).toBe(ARM);
    second.afterStep();
    second.dispose();
    expect(second.playing).toBe(ARM);
  });

  it('AC-3: a resumed contest takes its walk-away anchor on the first step, then forfeits past it', () => {
    let x = 3;
    const first = setup();
    first.installed.runner.enter(ARM, 0);
    const resumed = new ContestController({
      ui: first.ui,
      world: first.world,
      player: first.player,
      runner: first.installed.runner,
      contests: defs,
      host: first.host,
      publish: () => undefined,
      positionOf: () => ({ x, y: 0, z: 0 }),
    });
    resumed.afterStep(); // no anchor was saved: this step takes it where the player stands
    x = 3 + WALK_AWAY_METRES - 1;
    resumed.afterStep();
    expect(first.installed.runner.isActive(ARM)).toBe(true);
    x = 3 + WALK_AWAY_METRES + 1;
    resumed.afterStep();
    expect(first.installed.runner.result(ARM)).toBe('forfeit');
    resumed.dispose();
  });

  it('the push key is not taken by a contest that is neither arm-wrestling nor dice', () => {
    const first = setup();
    first.installed.runner.enter(ARM, 0);
    const odd = new ContestController({
      ui: first.ui,
      world: first.world,
      player: first.player,
      runner: first.installed.runner,
      contests: [{ ...def(ARM), scoring: [] }],
      host: first.host,
      publish: () => undefined,
    });
    expect(odd.playing).toBe(ARM);
    expect(odd.keydown({ code: PUSH_KEY, repeat: false })).toBe(false);
    odd.dispose();
  });

  it('a contest that ends refused says so in the toast, and the unknown outcome text falls back', () => {
    const t = setup();
    t.world.events.emit(ContestEnded, {
      contest: ARM,
      outcome: 'lost',
      placement: 9,
      score: 0,
      standings: [],
      refused: 'gold:short',
    });
    t.world.events.emit(ContestEnded, {
      contest: ARM,
      outcome: 'odd' as never,
      placement: 1,
      score: 0,
      standings: [],
    });
    t.world.events.flush();
    expect(t.toasts).toEqual(['You lost the contest, placing 9. (gold:short)', 'odd']);
  });

  it('names and games come from content', () => {
    expect(npcName('npc-big-oona')).toBe('Big oona');
    expect(gameOf(def(ARM))).toBe('armwrestle');
    expect(gameOf(def(DICE))).toBe('dice');
    expect(gameOf({ ...def(ARM), scoring: [] })).toBe('none');
  });
});
