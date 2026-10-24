import { describe, expect, it } from 'vitest';
import { DAMAGE_COMPONENTS, giveCombatant, HealthComponent } from '../combat/damage/components';
import { giveStamina, StaminaComponent } from '../combat/stamina';
import { World } from '../core/world';
import { installGameClock } from '../gametime/clock';
import { DEFAULT_CLOCK_CONFIG } from '../gametime/config';
import {
  DAY_CLOCK_FACTS,
  factDayClock,
  MORNING_MINUTE,
  type DayClock,
  type TimeOfDay,
} from './day-clock';
import { restBlocked, restCompleted, restUntilMorning, type RestCompleted } from './rest';

function setup(start: TimeOfDay = { day: 1, minute: 21 * 60 }) {
  const world = new World<never>({ seed: 1 });
  for (const [key, spec] of Object.entries(DAY_CLOCK_FACTS)) world.facts.declare(key, spec);
  world.register(...DAMAGE_COMPONENTS, StaminaComponent);
  const actor = world.spawn();
  giveCombatant(world, actor, { health: 100 });
  world.set(actor, HealthComponent, { max: 100, current: 12.5 });
  giveStamina(world, actor);
  const full = world.get(actor, StaminaComponent)?.current ?? 0;
  const pool = world.get(actor, StaminaComponent);
  if (pool !== undefined) world.set(actor, StaminaComponent, { ...pool, current: 3 });
  const clock = factDayClock(world.facts);
  clock.set(start);
  const events: RestCompleted[] = [];
  world.events.on(restCompleted, (e) => events.push(e));
  return { world, actor, clock, events, full };
}

describe('resting at an inn (mw-ju8.6)', () => {
  it('sleeps until 06:00 the next morning, fully restores health and stamina and announces it', () => {
    const s = setup({ day: 1, minute: 21 * 60 });
    const result = restUntilMorning(s.world, s.actor, { kind: 'inn', point: 'sleeping-ox' });
    expect(result).toEqual({
      ok: true,
      hours: 9,
      wakes: { day: 2, minute: MORNING_MINUTE },
      restored: { health: 87.5, stamina: s.full - 3 },
    });
    expect(s.clock.now()).toEqual({ day: 2, minute: MORNING_MINUTE });
    expect(s.world.get(s.actor, HealthComponent)).toEqual({ max: 100, current: 100 });
    expect(s.world.get(s.actor, StaminaComponent)?.current).toBe(s.full);
    s.world.events.flush();
    expect(s.events).toEqual([
      {
        tick: 0,
        actor: s.actor,
        kind: 'inn',
        hours: 9,
        point: 'sleeping-ox',
        wakes: { day: 2, minute: MORNING_MINUTE },
      },
    ]);
  });

  it('before dawn it sleeps to this day’s morning; hours can be fractional', () => {
    const s = setup({ day: 3, minute: 5 * 60 + 15 });
    const result = restUntilMorning(s.world, s.actor, { kind: 'inn', point: 'p' });
    expect(result).toMatchObject({ ok: true, hours: 0.75, wakes: { day: 3, minute: 360 } });
  });

  it('a mana pool is restored when the caller supplies its restorer', () => {
    const s = setup();
    let mana = 4;
    const result = restUntilMorning(s.world, s.actor, {
      kind: 'inn',
      point: 'p',
      pools: {
        mana: (_world, _actor, amount) => {
          const gained = Math.min(amount, 10 - mana);
          mana += gained;
          return gained;
        },
      },
    });
    expect(mana).toBe(10);
    expect(result).toMatchObject({ ok: true, restored: { mana: 6 } });
  });

  it('refuses as unsafe, with the reason, and changes nothing (the autosave veto registry’s verdict)', () => {
    const s = setup();
    const before = JSON.stringify([
      s.clock.now(),
      s.world.get(s.actor, HealthComponent),
      s.world.get(s.actor, StaminaComponent),
    ]);
    const safety = () => 'enemies are hunting you';
    expect(restBlocked({ safety })).toBe('enemies are hunting you');
    expect(restUntilMorning(s.world, s.actor, { kind: 'inn', point: 'p', safety })).toEqual({
      ok: false,
      reason: 'unsafe',
      detail: 'enemies are hunting you',
    });
    s.world.events.flush();
    expect(s.events).toEqual([]);
    expect(
      JSON.stringify([
        s.clock.now(),
        s.world.get(s.actor, HealthComponent),
        s.world.get(s.actor, StaminaComponent),
      ]),
    ).toBe(before);
    expect(restBlocked({})).toBeNull();
    expect(restBlocked({ safety: () => null })).toBeNull();
  });

  it('uses the clock it is given (a time-of-day source), not the facts', () => {
    const s = setup();
    let time: TimeOfDay = { day: 9, minute: 23 * 60 };
    const clock: DayClock = {
      now: () => time,
      set: (next) => {
        time = next;
      },
    };
    restUntilMorning(s.world, s.actor, { kind: 'inn', point: 'p', clock });
    expect(time).toEqual({ day: 10, minute: MORNING_MINUTE });
    expect(s.clock.now()).toEqual({ day: 1, minute: 21 * 60 });
  });

  it('does not heal the dead: a creature at 0 health stays at 0', () => {
    const s = setup();
    s.world.set(s.actor, HealthComponent, { max: 100, current: 0 });
    const result = restUntilMorning(s.world, s.actor, { kind: 'inn', point: 'p' });
    expect(result).toMatchObject({ ok: true, restored: { health: 0 } });
    expect(s.world.get(s.actor, HealthComponent)?.current).toBe(0);
  });
});

describe('resting with the game clock installed (mw-e27.12)', () => {
  it('passes the night through the game clock, so its hour and day events fire', () => {
    const { world, actor, full } = setup();
    const clock = installGameClock(world, DEFAULT_CLOCK_CONFIG);
    clock.setTime({ day: 1, minute: 21 * 60 });
    const hours: number[] = [];
    const days: number[] = [];
    clock.subscribe('hourChanged', (e) => hours.push(e.hour));
    clock.subscribe('dayStarted', (e) => days.push(e.day));
    const result = restUntilMorning(world, actor, { kind: 'inn', point: 'ox' });
    expect(result.ok).toBe(true);
    expect(clock.time()).toEqual({ day: 2, minute: MORNING_MINUTE });
    expect(hours).toEqual([22, 23, 0, 1, 2, 3, 4, 5, 6]);
    expect(days).toEqual([2]);
    expect(world.get(actor, StaminaComponent)?.current).toBe(full);
  });
});
