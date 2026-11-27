// mw-e25.15: Mags Oakum's barge between Briar Glen Quay, Kestrel Lock and the Wendmouth Stone Wharf,
// played by the real DialogueRuntime against the shipped dialogue and services. AC-1..AC-3 build on the
// service-layer coverage of mw-e20.14; AC-4 covers the stowaway flag the customs inspection will read.
import { describe, expect, it } from 'vitest';
import { markExercised } from '@content/testing';
import { loadGameContent } from '@content/index';
import type { DialogueDef } from '@content/types/dialogue';
import { World } from '@sim/core/world';
import { MemoryLogicHost } from '@sim/logic';
import { DialogueRuntime } from '@sim/dialogue/runtime';
import { contentServices } from './service-host';

const content = loadGameContent();
const MORNING = 8 * 60;

interface Init {
  scene?: string;
  minute?: number;
  day?: number;
  gold?: number;
  cls?: string;
  facts?: Record<string, boolean | number | string>;
}

function ride(init: Init) {
  const world = new World<never>({ seed: 1, hz: 60 });
  const host = new MemoryLogicHost({
    gold: init.gold ?? 20,
    minuteOfDay: init.minute ?? MORNING,
    ...(init.cls !== undefined && { playerClass: init.cls }),
    facts: {
      'time.day': init.day ?? 2,
      ...init.facts,
    },
    services: {
      ...contentServices(content),
      ...(init.scene !== undefined && { scene: init.scene }),
    },
  });
  const runtime = new DialogueRuntime({
    world,
    host,
    dialogues: (id) => content.get('dialogue', id) as unknown as DialogueDef,
  });
  runtime.start('mags-patient-ann', 'npc-mags');
  const settle = () => {
    for (let i = 0; i < 50 && runtime.view?.kind === 'line'; i++) runtime.advance();
  };
  settle();
  const pick = (id: string) => {
    const index = runtime.choices().findIndex((c) => c.id === id);
    expect(index, `option ${id} offered`).toBeGreaterThanOrEqual(0);
    expect(runtime.choose(index).ok, id).toBe(true);
    settle();
  };
  const ids = () => runtime.choices().map((c) => c.id);
  return { host, runtime, pick, ids };
}

describe('the Patient Ann (mw-e25.15)', () => {
  it('sells her fares through services', ({ task }) => {
    for (const id of [
      'barge-quay-wharf',
      'barge-quay-wharf-stowaway',
      'barge-lock-wharf',
      'barge-lock-wharf-stowaway',
      'barge-wharf-quay',
    ]) {
      markExercised(task, 'service', id);
      expect(content.get('service', id).providerNpcId.id).toBe('npc-mags');
    }
  });

  it('AC-1: from the quay at 08:00 on day 2 the fare is paid, one day passes and the Stone Wharf is the arrival', () => {
    const r = ride({ scene: 'briar-glen-river' });
    r.pick('ask-ride');
    r.pick('ride-pay');
    expect(r.host.gold()).toBe(16);
    expect(r.host.advanced).toEqual([1440]);
    expect(r.host.travels).toEqual([{ scene: 'wendmouth-harbour', spawn: 'barge-berth' }]);
    expect(r.host.facts.get('barge.ride')).toBe('downriver');
  });

  it('AC-1: Kestrel Lock sells the same ride to the Stone Wharf', () => {
    const r = ride({ scene: 'kestrel-lock' });
    r.pick('ask-ride');
    expect(r.ids()).not.toContain('ride-adit');
    r.pick('ride-pay-lock');
    expect(r.host.gold()).toBe(16);
    expect(r.host.advanced).toEqual([1440]);
    expect(r.host.travels).toEqual([{ scene: 'wendmouth-harbour', spawn: 'barge-berth' }]);
    expect(r.host.facts.get('barge.ride')).toBe('lock-downriver');
  });

  it('AC-2: from the Stone Wharf the way upriver takes two days, towed, to the quay', () => {
    const r = ride({ scene: 'wendmouth-harbour' });
    r.pick('ask-ride');
    expect(r.ids()).not.toContain('ride-stowaway');
    r.pick('ride-pay-upriver');
    expect(r.host.gold()).toBe(16);
    expect(r.host.advanced).toEqual([2880]);
    expect(r.host.travels).toEqual([{ scene: 'briar-glen-river', spawn: 'barge-arrival' }]);
    expect(r.host.facts.get('barge.ride')).toBe('upriver');
  });

  it('AC-2: a class deal rides the same way for no fare', () => {
    const r = ride({
      scene: 'briar-glen-river',
      cls: 'knight',
      facts: { 'mags.fare-deal': 'tow-rope' },
    });
    r.pick('ask-ride');
    r.pick('ride-deal');
    expect(r.host.gold()).toBe(20);
    expect(r.host.advanced).toEqual([1440]);
    expect(r.host.travels).toHaveLength(1);
    expect(r.host.facts.get('barge.stowaway-arrival')).toBe(false);
  });

  it('AC-3: at night she refuses with the bible line and nothing is paid or moved', () => {
    for (const minute of [23 * 60, 3 * 60]) {
      const r = ride({ scene: 'briar-glen-river', minute });
      r.pick('ask-ride');
      expect(r.ids()).not.toContain('ride-pay');
      expect(r.host.advanced).toEqual([]);
      expect(r.host.travels).toEqual([]);
      expect(r.host.gold()).toBe(20);
    }
  });

  it('AC-3: before night 1 is resolved (day 1) she refuses too, even by day', () => {
    const r = ride({ scene: 'briar-glen-river', day: 1 });
    r.pick('ask-ride');
    expect(r.ids()).not.toContain('ride-pay');
    expect(r.host.advanced).toEqual([]);
    expect(r.host.travels).toEqual([]);
  });

  it('AC-3: with too little gold the fare is refused and nothing moves', () => {
    const r = ride({ scene: 'briar-glen-river', gold: 1 });
    r.pick('ask-ride');
    r.pick('ride-pay');
    expect(r.host.gold()).toBe(1);
    expect(r.host.travels).toEqual([]);
    expect(r.host.advanced).toEqual([]);
  });

  it('AC-4: a thief pays five crowns to stow away, which flags that arrival only', () => {
    const r = ride({ scene: 'briar-glen-river', cls: 'thief' });
    r.pick('ask-ride');
    r.pick('ride-stowaway');
    expect(r.host.gold()).toBe(15);
    expect(r.host.travels).toEqual([{ scene: 'wendmouth-harbour', spawn: 'barge-berth' }]);
    expect(r.host.facts.get('barge.stowaway-arrival')).toBe(true);
    // Any later fare rewrites the flag, so it never outlives the arrival it was bought for.
    const back = ride({
      scene: 'wendmouth-harbour',
      cls: 'thief',
      facts: { 'barge.stowaway-arrival': true },
    });
    back.pick('ask-ride');
    back.pick('ride-pay-upriver');
    expect(back.host.facts.get('barge.stowaway-arrival')).toBe(false);
    const again = ride({
      scene: 'kestrel-lock',
      cls: 'thief',
      facts: { 'barge.stowaway-arrival': true },
    });
    again.pick('ask-ride');
    again.pick('ride-pay-lock');
    expect(again.host.facts.get('barge.stowaway-arrival')).toBe(false);
  });

  it('AC-4: the tarpaulin deal stows a thief away without a fare; other classes cannot stow away', () => {
    const r = ride({
      scene: 'kestrel-lock',
      cls: 'thief',
      facts: { 'mags.fare-deal': 'tarpaulin' },
    });
    r.pick('ask-ride');
    r.pick('ride-deal-tarpaulin-lock');
    expect(r.host.facts.get('barge.stowaway-arrival')).toBe(true);
    expect(r.host.gold()).toBe(20);
    const knight = ride({ scene: 'briar-glen-river', cls: 'knight' });
    knight.pick('ask-ride');
    expect(knight.ids()).not.toContain('ride-stowaway');
  });

  it('AC-4: a thief without five crowns cannot stow away', () => {
    const r = ride({ scene: 'briar-glen-river', cls: 'thief', gold: 4 });
    r.pick('ask-ride');
    r.pick('ride-stowaway');
    expect(r.host.facts.get('barge.stowaway-arrival')).toBeUndefined();
    expect(r.host.travels).toEqual([]);
  });

  it('mw-e25.33: the quay sells a twelve-hour ride down to Kestrel Lock, landing at the barge landing', ({
    task,
  }) => {
    markExercised(task, 'service', 'barge-quay-lock');
    const r = ride({ scene: 'briar-glen-river' });
    r.pick('ask-ride');
    r.pick('ride-pay-kestrel');
    expect(r.host.gold()).toBe(16);
    expect(r.host.advanced).toEqual([720]);
    expect(r.host.travels).toEqual([{ scene: 'kestrel-lock', spawn: 'barge-landing' }]);
    expect(r.host.facts.get('barge.ride')).toBe('quay-lock-downriver');
    expect(r.host.facts.get('barge.stowaway-arrival')).toBe(false);
  });

  it('mw-e25.33: the Stone Wharf sells a one-day towed ride up to Kestrel Lock', ({ task }) => {
    markExercised(task, 'service', 'barge-wharf-lock');
    const r = ride({ scene: 'wendmouth-harbour' });
    r.pick('ask-ride');
    r.pick('ride-pay-wharf-lock');
    expect(r.host.gold()).toBe(16);
    expect(r.host.advanced).toEqual([1440]);
    expect(r.host.travels).toEqual([{ scene: 'kestrel-lock', spawn: 'barge-landing' }]);
    expect(r.host.facts.get('barge.ride')).toBe('wharf-lock-upriver');
  });

  it('mw-e25.33: the lock itself offers no ride to the lock, and a thief cannot stow away on it', () => {
    const lock = ride({ scene: 'kestrel-lock', cls: 'thief' });
    lock.pick('ask-ride');
    expect(lock.ids()).not.toContain('ride-pay-kestrel');
    expect(lock.ids()).not.toContain('ride-pay-wharf-lock');
    const quay = ride({ scene: 'briar-glen-river', cls: 'thief' });
    quay.pick('ask-ride');
    expect(quay.ids().filter((id) => id.includes('kestrel'))).toEqual(['ride-pay-kestrel']);
  });

  it('mw-e25.33: the lock rides refuse at night and for want of coin, and class deals ride them free', () => {
    for (const [scene, pay] of [
      ['briar-glen-river', 'ride-pay-kestrel'],
      ['wendmouth-harbour', 'ride-pay-wharf-lock'],
    ] as const) {
      const night = ride({ scene, minute: 23 * 60 });
      night.pick('ask-ride');
      expect(night.ids()).not.toContain(pay);
      const broke = ride({ scene, gold: 1 });
      broke.pick('ask-ride');
      broke.pick(pay);
      expect(broke.host.travels).toEqual([]);
      expect(broke.host.advanced).toEqual([]);
    }
    const down = ride({
      scene: 'briar-glen-river',
      cls: 'archer',
      facts: { 'mags.fare-deal': 'herons' },
    });
    down.pick('ask-ride');
    down.pick('ride-deal-kestrel');
    expect(down.host.gold()).toBe(20);
    expect(down.host.advanced).toEqual([720]);
    expect(down.host.travels).toEqual([{ scene: 'kestrel-lock', spawn: 'barge-landing' }]);
    expect(down.host.facts.get('barge.ride')).toBe('quay-lock-downriver');
    const up = ride({
      scene: 'wendmouth-harbour',
      cls: 'thief',
      facts: { 'mags.fare-deal': 'tarpaulin' },
    });
    up.pick('ask-ride');
    up.pick('ride-deal-wharf-lock');
    expect(up.host.gold()).toBe(20);
    expect(up.host.advanced).toEqual([1440]);
    expect(up.host.travels).toEqual([{ scene: 'kestrel-lock', spawn: 'barge-landing' }]);
    expect(up.host.facts.get('barge.stowaway-arrival')).toBe(false);
  });
});
