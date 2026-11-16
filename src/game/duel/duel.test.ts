// The duel glue (mw-e39.35): a dialogue's duel request waits for a free screen and a free duellist,
// starts the engine's duel, and the result becomes the facts the dialogue reads.
import { describe, expect, it } from 'vitest';
import {
  beginConversing,
  CreatureComponent,
  DuelEnded,
  MemoryLogicHost,
  World,
  type EntityId,
  type FirstBloodDuels,
} from '@sim/index';
import type { UiRoot } from '@ui/index';
import { logicEmitted } from '../logic/host';
import { DUEL_BEHAVIOUR, DUELS, startDuelUi } from './duel';

const SPEC = DUELS['tereza.duel-start'];

function setup(options: { present?: boolean; accept?: boolean } = {}) {
  const world = new World<never>({ seed: 1 });
  world.register(CreatureComponent);
  const player = world.spawn();
  const tereza = world.spawn();
  if (options.present !== false) {
    world.add(tereza, CreatureComponent, {
      origin: { creature: 'npc-tereza', at: { x: 0, y: 0, z: 0 }, facing: { x: 0, y: 0, z: 1 } },
      behaviour: 'shopkeeper',
      tuning: {},
      needs: {},
    });
  }
  const started: [EntityId, EntityId][] = [];
  let updates = 0;
  const duels = {
    start: (p: EntityId, d: EntityId) => {
      started.push([p, d]);
      return options.accept !== false;
    },
    update: () => {
      updates++;
    },
  } as unknown as FirstBloodDuels;
  const screen = { top: undefined as unknown };
  const host = new MemoryLogicHost({});
  const toasts: string[] = [];
  const duelUi = startDuelUi({
    ui: screen as UiRoot,
    world,
    player,
    duels,
    host,
    toast: (text) => toasts.push(text),
  });
  const request = (event = 'tereza.duel-start'): void => {
    world.events.emit(logicEmitted, { event, data: {} });
    world.step();
  };
  const end = (victor: 'player' | 'duellist' | 'none'): void => {
    world.events.emit(DuelEnded, { tick: 0, player, duellist: tereza, victor });
    world.step();
  };
  return {
    world,
    player,
    tereza,
    started,
    updates: () => updates,
    screen,
    host,
    toasts,
    duelUi,
    request,
    end,
  };
}

describe('the duel glue', () => {
  it('AC-1: a duel request starts the duel against the player once nothing blocks it', () => {
    const s = setup();
    s.request();
    expect(s.started).toEqual([]);
    s.duelUi.afterStep();
    expect(s.started).toEqual([[s.player, s.tereza]]);
    expect(s.toasts).toEqual([SPEC?.begun]);
    s.duelUi.afterStep();
    expect(s.started).toHaveLength(1);
    expect(s.updates()).toBe(2);
  });

  it('AC-1: other emitted events are ignored', () => {
    const s = setup();
    s.request('rumor.told');
    s.duelUi.afterStep();
    expect(s.started).toEqual([]);
  });

  it('AC-1: the request waits while a screen is open and while she is in conversation', () => {
    const s = setup();
    s.screen.top = {};
    s.request();
    s.duelUi.afterStep();
    expect(s.started).toEqual([]);
    s.screen.top = undefined;
    beginConversing(s.world, s.tereza, s.player, { x: 0, z: 1 });
    s.duelUi.afterStep();
    expect(s.started).toEqual([]);
  });

  it('AC-1: a duellist who is not in this scene lets the request lapse', () => {
    const s = setup({ present: false });
    s.request();
    s.duelUi.afterStep();
    s.duelUi.afterStep();
    expect(s.started).toEqual([]);
    expect(s.toasts).toEqual([]);
  });

  it('AC-1: a duel the engine refuses starts nothing and writes no result', () => {
    const s = setup({ accept: false });
    s.request();
    s.duelUi.afterStep();
    expect(s.started).toHaveLength(1);
    expect(s.toasts).toEqual([]);
    s.end('player');
    expect(s.host.facts.get('tereza.duel.fought')).toBeUndefined();
  });

  it('AC-2: the player landing the first hit writes fought and victor player', () => {
    const s = setup();
    s.request();
    s.duelUi.afterStep();
    s.end('player');
    expect(s.host.facts.get('tereza.duel.fought')).toBe(true);
    expect(s.host.facts.get('tereza.duel.victor')).toBe('player');
    expect(s.toasts.at(-1)).toBe(SPEC?.won);
  });

  it('AC-3: Tereza landing the first hit writes victor tereza', () => {
    const s = setup();
    s.request();
    s.duelUi.afterStep();
    s.end('duellist');
    expect(s.host.facts.get('tereza.duel.victor')).toBe('tereza');
    expect(s.toasts.at(-1)).toBe(SPEC?.lost);
  });

  it('AC-4: an abandoned duel writes nothing, and the next result is not misread', () => {
    const s = setup();
    s.request();
    s.duelUi.afterStep();
    s.end('none');
    expect(s.host.facts.get('tereza.duel.fought')).toBeUndefined();
    s.end('player');
    expect(s.host.facts.get('tereza.duel.fought')).toBeUndefined();
  });

  it('names the behaviour the engine swaps in', () => {
    expect(DUEL_BEHAVIOUR).toBe('duellist');
  });
});
